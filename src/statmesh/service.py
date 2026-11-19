"""Service layer: REST, MCP and CLI call only these functions."""

from __future__ import annotations

import json
import os
import re
import threading
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from statmesh.core.api_models import (
    ObservationsResult,
    SearchResult,
    SeriesDetail,
    SeriesHit,
    SourceStatus,
    SqlResult,
)
from statmesh.core.licence import can_serve
from statmesh.core.models import FetchRequest
from statmesh.ingest.ondemand import fetch_on_demand
from statmesh.query import QueryEngine
from statmesh.search.search import search
from statmesh.settings import Settings

MAX_LIMIT = 10_000  # observations rows per call
MAX_SEARCH = 100
_SUBNAT = re.compile(r"IN-[A-Z0-9]{2,3}")
_lock = threading.Lock()
_engine_: QueryEngine | None = None


def configure(settings: Settings | None = None) -> QueryEngine:
    """Set (or reset to env) the settings behind the service. Tests and `serve` call this."""
    global _engine_
    with _lock:
        if _engine_:
            _engine_.close()
        _engine_ = QueryEngine(settings or Settings.from_env())
        return _engine_


def _engine() -> QueryEngine:
    with _lock:
        eng = _engine_
    return eng or configure()


def _j(v: Any) -> Any:
    """Raw DuckDB values -> JSON-safe."""
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, dict):
        return {str(k): _j(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_j(x) for x in v]
    return v


_FKEY = re.compile(r"[A-Za-z0-9_.-]{1,64}")
_FVAL = re.compile(r"[A-Za-z0-9 _.,:+-]{0,256}")  # no / \ ? # % : filters go into URL paths


def parse_filters(items: list[str]) -> dict[str, str] | None:
    """`key=value` strings -> filters dict (REST/CLI form)."""
    out = {}
    for it in items:
        k, sep, v = it.partition("=")
        if not sep:
            raise ValueError(f"filter {it!r} must be key=value")
        out[k] = v
    return out or None


def _check_filters(f: dict[str, str] | None) -> dict[str, str]:
    f = dict(f or {})
    if len(f) > 16:
        raise ValueError("at most 16 filters")
    for k, v in f.items():
        if not (
            isinstance(k, str)
            and isinstance(v, str)
            and _FKEY.fullmatch(k)
            and _FVAL.fullmatch(v)
            and ".." not in v
            and "." not in re.split(r"[,+ ]+", v)  # a lone "." is an HTTP dot segment
        ):
            raise ValueError(f"bad filter {k!r}")
    return f


def _trunc_warning(cat, cites) -> str | None:
    bad = set()
    for c in cites:
        err = (cat.get_dataset(c.source_id, c.dataset_id) or {}).get("last_error") or ""
        if err.startswith("truncated:"):
            bad.add(f"{c.source_id}/{c.dataset_id}")
    return (
        f"Truncated at ingest, results may be incomplete: {', '.join(sorted(bad))}" if bad else None
    )


def _limit(limit: int | None, hi: int) -> int | None:
    if limit is not None and not 1 <= limit <= hi:
        raise ValueError(f"limit must be between 1 and {hi}")
    return limit


def _check_geo(eng: QueryEngine, geo: str | None) -> None:
    if geo is None or _SUBNAT.fullmatch(geo):
        return
    if not eng._run("SELECT 1 FROM geos WHERE geo=?", [geo], 1)[1]:
        raise ValueError(f"unknown geo {geo!r}")


def _cites(eng: QueryEngine, sql: str, cols: list[str], rows: list[list[Any]]):
    return eng.citations(sql, cols, rows)[0]


def _hit(eng: QueryEngine, series_id: str, key: str, row: dict, score: float) -> SeriesHit | None:
    cat = eng.catalog
    src, ds = key.split(":")[:2]
    lic = cat.licence_for(key)
    if not can_serve(lic, eng.settings.mode):
        return None
    parts = series_id.split(":", 3)
    return SeriesHit(
        series_id=series_id, title=row["title"], unit=row.get("unit"), freq=row.get("freq"),
        geo=parts[3] if len(parts) == 4 else None,
        start=row.get("start_date"), end=row.get("end_date"), source_id=src, dataset_id=ds,
        licence_name=lic.name, redistribute=lic.redistribute,
        status=(cat.get_dataset(src, ds) or {}).get("status", "remote"), score=score,
    )  # fmt: skip


def search_series(
    q: str,
    *,
    geo: str | None = None,
    freq: str | None = None,
    source: str | None = None,
    limit: int = 10,
) -> SearchResult:
    eng = _engine()
    _limit(limit, MAX_SEARCH)
    hits = [
        h
        for r in search(
            eng.catalog,
            q,
            geo=geo,
            freq=freq,
            source=source,
            limit=limit,
            keep=lambda r: can_serve(eng.catalog.licence_for(r["series_key"]), eng.settings.mode),
        )
        if (h := _hit(eng, r["series_id"], r["series_key"], r, r["score"]))
    ]
    return SearchResult(query=q, hits=hits)


def _series(eng: QueryEngine, series_id: str) -> tuple[str, dict]:
    parts = series_id.split(":", 3)
    key = ":".join(parts[:3])
    s = eng.catalog.get_series(key) if len(parts) >= 3 else None
    if not s or not can_serve(eng.catalog.licence_for(key), eng.settings.mode):
        raise KeyError(series_id)
    return key, s


def describe_series(series_id: str) -> SeriesDetail:
    eng = _engine()
    key, s = _series(eng, series_id)
    hit = _hit(eng, series_id, key, s, 0.0)
    assert hit
    cat = eng.catalog
    ds = cat.get_dataset(s["source_id"], s["dataset_id"]) or {}
    src = cat.get_source(s["source_id"]) or {}
    cites = _cites(eng, "", ["series_id"], [[series_id]])
    return SeriesDetail(
        **hit.model_dump(), description=s["description"], dims=json.loads(s["dims_json"]),
        geos=s["geos"].split(), source_url=ds.get("source_url") or src.get("endpoint"),
        last_updated=ds.get("source_updated_at"), last_ingested_at=ds.get("last_ingested_at"),
        citation=cites[0],
    )  # fmt: skip


def get_observations(
    series_id: str,
    *,
    start: date | None = None,
    end: date | None = None,
    geo: str | None = None,
    limit: int | None = None,
    filters: dict[str, str] | None = None,
) -> ObservationsResult:
    eng = _engine()
    cat = eng.catalog
    parts = series_id.split(":", 3)
    _limit(limit, MAX_LIMIT)
    filters = _check_filters(filters)
    _check_geo(eng, geo)
    if len(parts) == 4:
        _check_geo(eng, parts[3])

    def out(status, cols=(), rows=(), trunc=False, retry=None) -> ObservationsResult:
        ra = None
        if "retrieved_at" in cols:
            i = list(cols).index("retrieved_at")
            ra = max((r[i] for r in rows if r[i] is not None), default=None)
        cites = (
            []
            if status == "not_found"
            else _cites(eng, "", ["series_id", "retrieved_at"], [[series_id, ra]])
        )
        return ObservationsResult(
            series_id=series_id, status=status, columns=list(cols), rows=_j(list(rows)),
            truncated=trunc, retry_after=retry, citations=cites,
            warning=_trunc_warning(cat, cites),
        )  # fmt: skip

    s = cat.get_series(":".join(parts[:3])) if len(parts) >= 3 else None
    if not s:
        return out("not_found")
    if not can_serve(cat.licence_for(s["series_key"]), eng.settings.mode):
        return out("forbidden")
    remote = (cat.get_dataset(s["source_id"], s["dataset_id"]) or {}).get("status") == "remote"
    if remote:
        g = geo or (parts[3] if len(parts) == 4 else None)
        req = FetchRequest(
            s["dataset_id"], (s["indicator_id"],), geos=(g,) if g else (), start=start, end=end, filters=filters,
        )  # fmt: skip  # limit is a reply cap, not a fetch cap
        _, retry = fetch_on_demand(req, s["source_id"], eng.settings, cat)
        if retry is not None:
            return out("rate_limited", retry=retry)
    if "period" in filters:  # the fetch is already scoped to that frame; start/end would hide it
        start = end = None
    cols, rows, trunc = eng.observations(
        series_id, start, end, geo, limit, filters, strict=not remote
    )  # on-demand filters may be connector-only keys
    return out("ok", cols, rows, trunc)


def run_sql(sql: str) -> SqlResult:
    eng = _engine()
    cols, rows, trunc = eng.execute(sql)
    cites, warning = eng.citations(sql, cols, rows)
    warning = " ".join(w for w in (warning, _trunc_warning(eng.catalog, cites)) if w) or None
    return SqlResult(
        sql=sql, columns=cols, rows=_j(rows), truncated=trunc, citations=cites, warning=warning
    )


def python_enabled() -> bool:
    st = _engine().settings
    return st.python_sandbox and st.mode == "self_host"


def run_python(code: str):
    from statmesh.sandbox import run_python as run

    if not python_enabled():
        raise KeyError("run_python is disabled")
    return run(code, _engine().settings.data_dir / "obs")


def list_sources() -> list[SourceStatus]:
    eng = _engine()
    cat = eng.catalog
    out = []
    hosted = eng.settings.mode == "hosted"
    if hosted:  # the engine views hold exactly the servable datasets/series
        dq = (
            "SELECT count(*) n, max(last_ingested_at) last, coalesce(sum((status='stale')::int),0)"
            " stale FROM datasets WHERE source_id=?"
        )
        nq = "SELECT count(*) FROM series WHERE source_id=?"
    for s in cat.list_sources():
        if hosted:
            _, [[n0, last, stale]], _ = eng._run(dq, [s["id"]], 1)
            if not n0:
                continue
            d = {"n": n0, "last": last, "stale": stale}
            n = eng._run(nq, [s["id"]], 1)[1][0][0]
        else:
            d = cat._all(
                "SELECT COUNT(*) n, MAX(last_ingested_at) last, "
                "COALESCE(SUM(status='stale'),0) stale FROM datasets WHERE source_id=?",
                (s["id"],),
            )[0]
            n = cat._all("SELECT COUNT(*) n FROM series WHERE source_id=?", (s["id"],))[0]["n"]
        out.append(SourceStatus(
            id=s["id"], name=s["name"], kind=s["kind"], auth=s["auth"],
            key_configured=s["auth"] == "none" or bool(os.environ.get(s["key_env"] or "")),
            enabled=s["id"] not in eng.settings.disabled, redistribute=s["redistribute"],
            datasets=d["n"], series=n, last_ingested_at=d["last"], stale_datasets=d["stale"],
        ))  # fmt: skip
    return out
