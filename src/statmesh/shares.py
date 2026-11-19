"""Shareable answer links: a tiny SQLite store plus payload validation and citation rebuild.

A share is created only when a user clicks Share. It holds the question and the chat events
(text, tool calls, tool results); the model config and API key never reach this module. Citations
are not stored: `rebuild` derives them from the catalog on every read, so licence rules follow
the mode the server runs in now.
"""

from __future__ import annotations

import json
import re
import secrets
import sqlite3
from contextlib import closing
from datetime import UTC, datetime, timedelta
from typing import Any

from statmesh import service
from statmesh.settings import Settings

ID_RE = re.compile(r"[A-Za-z0-9_-]{12}")
MAX_SERIES = 50  # citations rebuilt for at most this many distinct series ids
MAX_IDS = 200  # ids considered per share; results mentioning others are blanked
_EVENT_FIELDS = {  # event type -> the only fields kept
    "text": ("text",),
    "call": ("id", "name", "input"),
    "result": ("id", "name", "output"),
    "error": ("message",),
}
_SECRET = re.compile(
    r"sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}"
    r"|gh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY|(?i:bearer)\s+[A-Za-z0-9._~+/=-]{20,}"
)  # ponytail: pattern list, not entropy; extend when a new provider's key shape shows up
_SID = re.compile(r"[^:\s]+:[^:\s]+:[^:\s]+(:[^:\s]+)?")
UNAVAILABLE = {"unavailable": True}


class Disabled(Exception):
    pass


class TooLarge(Exception):
    pass


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def _connect(settings: Settings) -> sqlite3.Connection:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(settings.data_dir / "shares.sqlite")
    db.execute(
        "CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, created_at TEXT, body TEXT)"
    )
    return db


def _strings(v: Any):
    if isinstance(v, str):
        yield v
    elif isinstance(v, dict):
        for k, x in v.items():
            yield str(k)
            yield from _strings(x)
    elif isinstance(v, list):
        for x in v:
            yield from _strings(x)


def clean(payload: Any) -> dict:
    """Validate and whitelist: {question, events}. Unknown fields (e.g. `config`) are dropped."""
    if not isinstance(payload, dict) or not isinstance(payload.get("question"), str):
        raise ValueError("payload needs a question string")  # noqa: TRY004 (API maps ValueError to 400)
    events = payload.get("events")
    if not isinstance(events, list) or not events:
        raise ValueError("payload needs a non-empty events list")
    out = []
    for e in events:
        t = e.get("t") if isinstance(e, dict) else None
        fields = _EVENT_FIELDS.get(t) if isinstance(t, str) else None
        if not fields:
            raise ValueError("unknown event type")
        out.append({"t": e["t"], **{k: e[k] for k in fields if k in e}})
    res = {"question": payload["question"], "events": out}
    if any(_SECRET.search(s) for s in _strings(res)):
        raise ValueError("payload contains what looks like an API key")
    return res


def create(settings: Settings, raw: bytes, now: datetime | None = None) -> str:
    if not settings.shares_enabled:
        raise Disabled
    if len(raw) > settings.share_max_bytes:
        raise TooLarge
    try:
        payload = json.loads(raw)
    except ValueError:
        raise ValueError("body is not JSON") from None
    body = json.dumps(clean(payload), separators=(",", ":"))
    if len(body.encode()) > settings.share_max_bytes:
        raise TooLarge
    now = now or _now()
    id_ = secrets.token_urlsafe(9)  # 12 url-safe chars
    with closing(_connect(settings)) as db, db:
        if settings.share_ttl_days:  # expired rows go on every insert
            db.execute(
                "DELETE FROM shares WHERE created_at < ?",
                (_iso(now - timedelta(days=settings.share_ttl_days)),),
            )
        db.execute("INSERT INTO shares VALUES (?,?,?)", (id_, _iso(now), body))
    return id_


def _series_ids(v: Any, out: dict[str, None]) -> None:
    if isinstance(v, dict):
        for k, x in v.items():
            if k == "series_id" and isinstance(x, str) and _SID.fullmatch(x):
                out[x] = None
            else:
                _series_ids(x, out)
    elif isinstance(v, list):
        for x in v:
            _series_ids(x, out)


def rebuild(events: list[dict]) -> tuple[list[dict], list[str], list[dict]]:
    """(citations, unavailable series ids, events with unservable results blanked).

    Only series the current mode can serve get a citation (service.describe_series applies the
    licence rules and raises KeyError otherwise); the rest are marked unavailable and any tool
    result that mentions one loses its data, so a hosted page never shows a series it may not serve.
    """
    per_event: list[dict[str, None]] = []
    ids: dict[str, None] = {}
    for e in events:  # each event is walked once
        found: dict[str, None] = {}
        _series_ids(e, found)
        per_event.append(found)
        ids.update(found)
    ids = dict.fromkeys(list(ids)[:MAX_IDS])
    cites: dict[tuple, dict] = {}
    served: set[str] = set()
    gone: list[str] = []
    for sid in list(ids)[:MAX_SERIES]:
        try:
            c = service.describe_series(sid).citation.model_dump(mode="json")
        except (KeyError, ValueError):
            gone.append(sid)
            continue
        served.add(sid)
        cites.setdefault((c["source_id"], c["dataset_id"], c.get("series_id")), c)
    gone += list(ids)[MAX_SERIES:]  # beyond the cap: no citation, so not shown as sourced
    events = [
        {**e, "output": UNAVAILABLE}
        if e["t"] == "result" and any(i not in served for i in found)
        else e
        for e, found in zip(events, per_event, strict=True)
    ]
    return list(cites.values()), gone, events


def get(settings: Settings, id_: str, now: datetime | None = None) -> dict:
    """The share plus rebuilt citations. KeyError when missing, expired or shares are off."""
    if not settings.shares_enabled or not ID_RE.fullmatch(id_):
        raise KeyError(id_)
    with closing(_connect(settings)) as db:
        row = db.execute("SELECT created_at, body FROM shares WHERE id=?", (id_,)).fetchone()
    if not row:
        raise KeyError(id_)
    created, body = row
    if settings.share_ttl_days and created < _iso(
        (now or _now()) - timedelta(days=settings.share_ttl_days)
    ):
        raise KeyError(id_)
    share = json.loads(body)
    cites, gone, share["events"] = rebuild(share["events"])
    return {"id": id_, "created_at": created, **share, "citations": cites, "unavailable": gone}
