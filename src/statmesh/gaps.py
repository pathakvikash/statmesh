"""Gap log: searches that found nothing, as a tiny SQLite file in the data dir.

Stores normalised query text, a count, minute-resolution first/last seen and the filter values
seen with it. Nothing personal: no IP, headers or user agent; query-shaped personal data (email,
URL, long digit runs, pasted sentences) is skipped. Logging never raises. Read it with
`statmesh gaps`; there is deliberately no REST or MCP endpoint.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
from contextlib import closing
from datetime import UTC, datetime, timedelta

from statmesh.settings import Settings

log = logging.getLogger(__name__)
MAX_ROWS = 5_000  # distinct queries; when full, the oldest n=1 row (else oldest) is evicted
MAX_VALUES = 5  # filter values kept per filter name
MAX_LEN = 80
MAX_WORDS = 8
_PERSONAL = re.compile(r"@|://|\bwww\.", re.IGNORECASE)
_CTRL = re.compile(r"[\x00-\x1f\x7f-\x9f]")
_PUNCT = re.compile(r"[^\w\s]|_")


def normalise(q: str | None) -> str | None:
    """Lowercase, no punctuation, single spaces, at most 80 chars; None when it must not be stored."""
    if not q or _PERSONAL.search(q):
        return None
    s = " ".join(_PUNCT.sub(" ", q.lower()).split())
    if sum(c.isdigit() for c in s) >= 6 or len(s) < 3 or len(s.split()) > MAX_WORDS:
        return None
    return s[:MAX_LEN].rstrip()


def _minute() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%MZ")


def _vals(v) -> list[str]:
    items = [v] if isinstance(v, str) else list(v or [])
    return [s for x in items if (s := _CTRL.sub("", str(x)).strip()[:40])]


def _connect(settings: Settings) -> sqlite3.Connection:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(settings.data_dir / "gaps.sqlite", timeout=0.1)
    db.execute(
        "CREATE TABLE IF NOT EXISTS gaps (q_norm TEXT PRIMARY KEY, n INTEGER, "
        "first_seen TEXT, last_seen TEXT, filters_json TEXT)"
    )
    return db


def record(settings: Settings, q, *, source=None, geo=None, topic=None, known_sources=None) -> None:
    """Count one zero-hit query. Never raises. With `known_sources`, a query that names any other
    source is not stored (a bogus filter makes it no gap)."""
    try:
        if known_sources is not None and not set(_vals(source)) <= set(known_sources):
            return
        if not settings.gap_log or (key := normalise(q)) is None:
            return
        new = {"source": _vals(source), "geo": _vals(geo), "topic": _vals(topic)}
        now = _minute()
        with closing(_connect(settings)) as db, db:
            row = db.execute("SELECT filters_json FROM gaps WHERE q_norm=?", (key,)).fetchone()
            if row is None:
                if db.execute("SELECT COUNT(*) FROM gaps").fetchone()[0] >= MAX_ROWS:
                    # evict the oldest one-off (else the oldest row) so spam cannot block real gaps
                    db.execute(
                        "DELETE FROM gaps WHERE q_norm = (SELECT q_norm FROM gaps "
                        "ORDER BY n > 1, last_seen, first_seen LIMIT 1)"
                    )
                f = {k: v[:MAX_VALUES] for k, v in new.items() if v}
                db.execute("INSERT INTO gaps VALUES (?,?,?,?,?)", (key, 1, now, now, json.dumps(f)))
                return
            f = json.loads(row[0] or "{}")
            for k, v in new.items():
                if merged := list(dict.fromkeys([*f.get(k, []), *v]))[:MAX_VALUES]:
                    f[k] = merged
            db.execute(
                "UPDATE gaps SET n=n+1, last_seen=?, filters_json=? WHERE q_norm=?",
                (now, json.dumps(f), key),
            )
    except Exception:
        log.debug("gap log failed", exc_info=True)


def top(settings: Settings, limit: int = 50, since_days: int | None = None) -> list[dict]:
    """Most-searched empty queries, newest activity within `since_days` only. Read-only."""
    path = settings.data_dir / "gaps.sqlite"
    if not path.exists():
        return []
    sql, args = "SELECT q_norm, n, first_seen, last_seen, filters_json FROM gaps", []
    if since_days is not None:
        cut = (datetime.now(UTC) - timedelta(days=since_days)).strftime("%Y-%m-%dT%H:%MZ")
        sql, args = sql + " WHERE last_seen >= ?", [cut]
    sql += " ORDER BY n DESC, last_seen DESC, q_norm LIMIT ?"
    with closing(sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=1)) as db:
        rows = db.execute(sql, [*args, max(1, limit)]).fetchall()
    return [
        {"q": r[0], "n": r[1], "first_seen": r[2], "last_seen": r[3], "filters": json.loads(r[4])}
        for r in rows
    ]


def gaps_cmd(args) -> int:
    from statmesh import service

    rows = service.top_gaps(limit=args.top, since_days=args.since)
    if args.json:
        print(json.dumps(rows, indent=2))
        return 0
    if not rows:
        print("no gaps recorded")
        return 0
    print(f"{'COUNT':>5}  {'LAST SEEN':<17}  QUERY  [FILTERS]")
    for r in rows:
        f = " ".join(f"{k}={','.join(v)}" for k, v in r["filters"].items())
        line = f"{r['n']:>5}  {r['last_seen']:<17}  {r['q']}" + (f"  [{f}]" if f else "")
        print(_CTRL.sub("", line))
    return 0
