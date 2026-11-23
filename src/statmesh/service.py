"""Service layer: REST, MCP and CLI call only these functions."""

from __future__ import annotations

import difflib
import json
import os
import re
import threading
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from functools import cache
from importlib import resources
from typing import Any

import yaml

from statmesh.core.api_models import (
    Citation,
    ObservationsResult,
    RecentObservations,
    RelatedHit,
    RelatedResult,
    SchemaResult,
    SearchResult,
    SeriesDetail,
    SeriesHit,
    SourceStatus,
    SqlResult,
)
from statmesh.core.connector import load_connector
from statmesh.core.geo import find_geos_in_text
from statmesh.core.http import get_http
from statmesh.core.licence import can_serve
from statmesh.core.models import FetchRequest
from statmesh.core.storage import Storage
from statmesh.ingest.ondemand import fetch_on_demand
from statmesh.query import QueryEngine
from statmesh.search.search import SEARCH_POOL, dataset_info, search, series_topics
from statmesh.search.topics import TAXONOMY, check_topics
from statmesh.settings import Settings


class OffsetBeyondPool(ValueError):
    """offset + limit goes past the first SEARCH_POOL search results (REST answers 422)."""


MAX_LIMIT = 10_000  # observations rows per call
MAX_SEARCH = 100
_SUBNAT = re.compile(
    r"(?:US|IN)-[A-Z0-9]{2,3}"
)  # ISO 3166-2 states: census, bea, eia, datacommons, mospi
_lock = threading.Lock()
_engine_: QueryEngine | None = None
_http_for = get_http  # (source_id, settings, catalog) -> HttpClient; tests and the bench swap it


def configure(settings: Settings | None = None, http_for=get_http) -> QueryEngine:
    """Set (or reset to env) the settings behind the service. Tests and `serve` call this.
    `http_for` builds the HTTP client of on-demand fetches (default: the shared live clients)."""
    global _engine_, _http_for
    with _lock:
        _http_for = http_for
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


def _truncated_datasets(cat, cites) -> list[str]:
    """Cited datasets whose rows were cut by a row cap (ingest or on-demand fetch)."""
    bad = set()
    for c in cites:
        err = (cat.get_dataset(c.source_id, c.dataset_id) or {}).get("last_error") or ""
        if err.startswith("truncated:"):
            bad.add(f"{c.source_id}/{c.dataset_id}")
    return sorted(bad)


def _cut_ids(eng, series_id: str, geo: str | None = None) -> bool:
    """Was this series cut by a row cap? The ids recorded at ingest / on-demand fetch time in
    manifest["cut"]; a 3-part key matches any of its geos."""
    src, ds = series_id.split(":")[:2]
    ids = Storage(eng.settings.data_dir).read_manifest().get("cut", {}).get(f"{src}/{ds}")
    if ids is None:  # no record (truncated before cuts were recorded): the dataset flag decides
        return True
    want = f"{series_id}:{geo}" if geo else None
    return any(
        i == series_id or (i.startswith(series_id + ":") if want is None else i == want)
        for i in ids
    )


def _trunc_warning(cat, cites) -> str | None:
    bad = _truncated_datasets(cat, cites)
    return (
        f"Partial result, a row cap cut the data and results may be incomplete: {', '.join(bad)}"
        if bad else None
    )  # fmt: skip


def _limit(limit: int | None, hi: int) -> int | None:
    if limit is not None and not 1 <= limit <= hi:
        raise ValueError(f"limit must be between 1 and {hi}")
    return limit


def _offset(offset: int) -> int:
    if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
        raise ValueError("offset must be an integer >= 0")
    return offset


def _resolve_geo(eng: QueryEngine, geo: str | None) -> str | None:
    """The catalogue code for `geo`: a code (IND, region:EMU, US-CA), an ISO alpha-2 (IN) or a
    country or region name or alias (India, United States, World). Unknown -> ValueError with
    close matches."""
    if geo is None:
        return None
    g = geo.strip()
    if _SUBNAT.fullmatch(g.upper()):
        return g.upper()
    if g.lower().startswith("region:"):
        g = "region:" + g[7:].upper()
    row = eng._run(
        "SELECT geo FROM geos WHERE geo=? OR geo=upper(?) OR iso2=upper(?) OR lower(name)=lower(?) "
        "ORDER BY (geo=?) DESC, geo LIMIT 1", [g, g, g, g, g], 1,
    )[1]  # fmt: skip
    if row:
        return row[0][0]
    found, rest = find_geos_in_text(g)  # aliases ("US", "Holland"); reuse, no second table
    if len(found) == 1 and not rest:
        return found[0]
    names = [r[0] for r in eng._run("SELECT name FROM geos", [], 10_000)[1]]
    near = [
        n for n in difflib.get_close_matches(g, names, n=4, cutoff=0.6) if n.lower() != g.lower()
    ]
    hint = f"; did you mean {', '.join(near[:3])}?" if near else "; use an ISO code or a name"
    raise ValueError(f"unknown geo {geo!r}{hint}")


def _norm_ids(eng: QueryEngine, series_id: str, geo: str | None) -> tuple[str, str | None]:
    """Resolve `geo` and the geo part of a 4-part series id to catalogue codes."""
    parts = series_id.split(":", 3)
    if len(parts) == 4:
        parts[3] = _resolve_geo(eng, parts[3]) or parts[3]
        series_id = ":".join(parts)
    return series_id, _resolve_geo(eng, geo)


def _cites(eng: QueryEngine, sql: str, cols: list[str], rows: list[list[Any]]):
    return eng.citations(sql, cols, rows)[0]


def _hit(eng: QueryEngine, series_id: str, key: str, row: dict, score: float) -> SeriesHit | None:
    # row may carry `topics` (see _annotate); start_date/end_date are observed coverage when known
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
        topics=row.get("topics", []),
    )  # fmt: skip


_REDIST = ("yes", "review", "no")


def _multi(v: str | list[str] | None) -> list[str]:
    """Repeatable or comma-separated query value -> list of non-empty parts."""
    return [
        p.strip()
        for x in ([v] if isinstance(v, str) else v or [])
        for p in x.split(",")
        if p.strip()
    ]


def _iso_day(v: str | None, name: str) -> str | None:
    if not v:
        return None
    try:
        if len(v) != 10:
            raise ValueError
        return date.fromisoformat(v).isoformat()
    except ValueError:
        raise ValueError(f"{name} must be an ISO date (YYYY-MM-DD)") from None


def _one_of(v: str | None, allowed: tuple[str, ...], name: str) -> str | None:
    if v in (None, ""):
        return None
    if v not in allowed:
        raise ValueError(f"{name} must be one of {', '.join(allowed)}")
    return v


def _topics_arg(v: str | list[str] | None) -> list[str]:
    names = _multi(v)
    ok = check_topics(names)
    if len(ok) != len({n.lower() for n in names}):
        raise ValueError("unknown topic; use Health, Economy, Labour, Prices, Trade, Population, "
                         "Environment, Energy or Companies")  # fmt: skip
    return ok


def _coverage(eng: QueryEngine, rows: list[dict]) -> None:
    """Replace start_date/end_date of series rows by observed min/max where observations exist
    (one batched query). Idempotent."""
    todo = [r for r in rows if r.get("dataset_id") and "_cov" not in r]
    for r in todo:
        r["_cov"] = True
    keys = sorted({r["series_key"] for r in todo})
    if not keys:
        return
    k = "source_id||':'||dataset_id||':'||indicator_id"
    srcs, dss = sorted({r["source_id"] for r in todo}), sorted({r["dataset_id"] for r in todo})
    mark = lambda xs: ",".join("?" * len(xs))
    _, got, _ = eng._run(
        f"SELECT {k}, min(period_start), max(period_end) FROM observations "
        f"WHERE source_id IN ({mark(srcs)}) AND dataset_id IN ({mark(dss)}) "
        f"AND {k} IN ({mark(keys)}) GROUP BY 1",
        [*srcs, *dss, *keys], len(keys),
    )  # fmt: skip
    cov = {key: (lo, hi) for key, lo, hi in got}
    for r in todo:
        if r["series_key"] in cov:
            r["start_date"], r["end_date"] = cov[r["series_key"]]


def _year(v: Any) -> int | None:
    return int(str(v)[:4]) if v else None


def _ingested(cat, key: str) -> bool:
    src, ds = key.split(":")[:2]
    return (cat.get_dataset(src, ds) or {}).get("status", "remote") != "remote"


def _servable_offline(eng, cat, key: str) -> bool:
    """`key` is 'src:ds:ind', or 'src:ds' for a dataset-level search row (a dataset with no
    listed series, see Catalog.upsert_discovery); the core-indicator check needs an indicator."""
    src, _, *ind = key.split(":")[:3]
    return _ingested(cat, key) and not (
        ind and _outside_core(eng.settings, {"source_id": src, "indicator_id": ind[0]})
    )


def search_series(
    q: str = "",
    *,
    geo: str | None = None,
    freq: str | None = None,
    source: str | list[str] | None = None,
    topic: str | list[str] | None = None,
    start_year: int | None = None,
    end_year: int | None = None,
    updated_since: str | None = None,
    redistribute: str | None = None,
    limit: int = 10,
    offset: int = 0,
) -> SearchResult:
    """Search series. All filters combine (AND); `source` and `topic` take several values
    (any-of). `q` may be empty when at least one filter is set: newest-updated series first.
    start_year/end_year keep series whose coverage overlaps the range (unknown coverage ranks after the known matches).
    `offset` pages through the same order; next_offset is None on the last page and at the end
    of the first SEARCH_POOL (2000) results, which is the most a query can page through."""
    eng = _engine()
    cat = eng.catalog
    _limit(limit, MAX_SEARCH)
    offset = _offset(offset)
    if offset + limit > SEARCH_POOL:
        raise OffsetBeyondPool(f"offset beyond the first {SEARCH_POOL} results; narrow the query")
    sources, topics = _multi(source), _topics_arg(topic)
    since = _iso_day(updated_since, "updated_since")
    redistribute = _one_of(redistribute, _REDIST, "redistribute")
    for name, y in (("start_year", start_year), ("end_year", end_year)):
        if y is not None and not 1 <= y <= 9999:
            raise ValueError(f"{name} must be a year between 1 and 9999")
    strict = bool(topics or since or redistribute or start_year or end_year)
    if not q.strip() and not (strict or sources or geo or freq):
        raise ValueError("q is empty: give a query or at least one filter")
    geos = list(dict.fromkeys(g for p in _multi(geo) if (g := _resolve_geo(eng, p))))
    geo = geos[0] if len(geos) == 1 else None  # several geos: no geo suffix on the ids
    sq = find_geos_in_text(q)[1] if len(geos) > 1 else q  # the filter wins over names in q
    info = dataset_info(cat)

    def annotate(rows: list[dict]) -> list[dict]:
        for r in rows:
            if "topics" not in r:
                k = r["series_key"].split(":")
                r["topics"] = series_topics(r["title"], info.get((k[0], k[1])))
        return rows

    def refine(rows: list[dict]) -> list[dict]:
        annotate(rows)
        if topics:
            rows = [r for r in rows if set(topics) & set(r["topics"])]
        if redistribute:
            rows = [
                r for r in rows if cat.licence_for(r["series_key"]).redistribute == redistribute
            ]
        if since:
            rows = [r for r in rows
                    if (info.get(tuple(r["series_key"].split(":")[:2])) or {}).get("updated", "")[:10] >= since]  # fmt: skip
        if start_year or end_year:
            _coverage(eng, rows)
            known = [r for r in rows if r.get("start_date") or r.get("end_date")]
            unknown = [r for r in rows if not (r.get("start_date") or r.get("end_date"))]
            known = [r for r in known
                     if (start_year is None or (_year(r.get("end_date")) or 9999) >= start_year)
                     and (end_year is None or (_year(r.get("start_date")) or 0) <= end_year)]  # fmt: skip
            rows = known + unknown  # unknown coverage ranks after confirmed matches
        return rows

    rows = search(  # one extra row tells whether a next page exists
        cat, sq, geo=geo, freq=freq, source=sources, limit=limit + 1, offset=offset,
        keep=lambda r: can_serve(cat.licence_for(r["series_key"]), eng.settings.mode)
        and (len(geos) < 2 or all(g in (r.get("geos") or g).split() for g in geos))
        and (eng.settings.ondemand or _servable_offline(eng, cat, r["series_key"])),
        refine=refine if strict else None,
        listing=True,  # pool defaults to SEARCH_POOL for every page
    )  # fmt: skip
    # ponytail: filters apply to the first SEARCH_POOL candidates; a stricter index if that bites
    more = len(rows) > limit and offset + limit < SEARCH_POOL
    rows = rows[:limit]
    _coverage(eng, annotate(rows))
    hits = [h for r in rows if (h := _hit(eng, r["series_id"], r["series_key"], r, r["score"]))]
    return SearchResult(query=q, hits=hits, next_offset=offset + limit if more else None)


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
    s["topics"] = series_topics(
        s["title"], dataset_info(eng.catalog).get((s["source_id"], s["dataset_id"]))
    )
    _coverage(eng, [s])
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


def _words(title: str) -> set[str]:
    return {w for w in re.findall(r"\w+", title.lower()) if len(w) > 2}


def related_series(series_id: str, geo: str | None = None, limit: int = 8) -> RelatedResult:
    """Deterministic neighbours of a series: same dataset +3, each shared topic +2, title-word
    Jaccard x2, explicitly covers the geo +2 (a soft preference: unknown geos stay); ties by series_id. One slot goes to another source if any."""
    eng = _engine()
    cat = eng.catalog
    _limit(limit, MAX_SEARCH)
    key, s = _series(eng, series_id)
    parts = series_id.split(":", 3)
    # an explicit geo is resolved; the geo inside a series id is used verbatim (it may be unmapped)
    geo = _resolve_geo(eng, geo) if geo else (parts[3] if len(parts) == 4 else None)
    info = dataset_info(cat)
    mine = series_topics(s["title"], info.get((s["source_id"], s["dataset_id"])))
    mywords = _words(s["title"])
    # candidates: siblings (first 200 by key), then search hits by title and by each topic
    cands = {
        r["series_key"]: r
        for r in cat._all(
            "SELECT * FROM series WHERE source_id=? AND dataset_id=? ORDER BY series_key LIMIT 200",
            (s["source_id"], s["dataset_id"]),
        )
    }
    for q in [s["title"], *mine]:
        for r in search(
            cat, q, limit=30,
            keep=lambda r: can_serve(cat.licence_for(r["series_key"]), eng.settings.mode),
        ):  # fmt: skip
            if r["series_key"].count(":") == 2:
                cands.setdefault(r["series_key"], cat.get_series(r["series_key"]) or r)
    scored = []
    for k, r in cands.items():
        if k == key or not can_serve(cat.licence_for(k), eng.settings.mode):
            continue
        r["topics"] = series_topics(r["title"], info.get((r["source_id"], r["dataset_id"])))
        shared = [t for t in mine if t in r["topics"]]
        w = _words(r["title"])
        jac = len(mywords & w) / len(mywords | w) if mywords | w else 0.0
        same_ds = (r["source_id"], r["dataset_id"]) == (s["source_id"], s["dataset_id"])
        why = ["Same dataset"] if same_ds else []
        if shared:
            why.append(
                "Also about "
                + ", ".join(shared[:-1])
                + (" and " if shared[1:] else "")
                + shared[-1]
            )
        if jac >= 0.3:
            why.append("Similar title")
        if r["source_id"] != s["source_id"]:
            why.append(
                f"Other source: {(cat.get_source(r['source_id']) or {}).get('name', r['source_id'])}"
            )
        score = (
            3 * same_ds
            + 2 * len(shared)
            + 2 * jac
            + (2 if geo and geo in (r.get("geos") or "").split() else 0)
        )
        scored.append((-score, k, r, why))
    scored.sort(key=lambda t: (t[0], t[1]))
    picks = scored[:limit]
    if picks and all(t[2]["source_id"] == s["source_id"] for t in picks):
        other = next((t for t in scored[limit:] if t[2]["source_id"] != s["source_id"]), None)
        if other:
            picks = sorted([*picks[:-1], other], key=lambda t: (t[0], t[1]))
    hits = []
    for neg, k, r, why in picks:
        h = _hit(eng, f"{k}:{geo}" if geo else k, k, r, -neg)
        if h:
            hits.append(
                RelatedHit(**h.model_dump(), reason=" · ".join(why) or "Related search result")
            )
    return RelatedResult(
        series_id=series_id, hits=hits, citation=_cites(eng, "", ["series_id"], [[series_id]])[0]
    )


_NOT_MIRRORED = (
    "Not mirrored on this instance; this dataset is fetched on demand only on self-hosted installs."
)


@cache
def _core_indicators(
    source_id: str, settings: Settings
) -> frozenset | None:  # load_connector is slow
    try:
        core = load_connector(source_id, settings).manifest.options.get("core_indicators")
    except KeyError:
        return None
    return frozenset(core) if core else None


def _outside_core(settings: Settings, s: dict) -> bool:
    """An ingested dataset whose manifest lists `core_indicators` holds only those; any other
    indicator of it (e.g. the ~3k non-core WHO GHO ones) is still fetched on demand."""
    core = _core_indicators(s["source_id"], settings)
    return core is not None and s["indicator_id"] not in core


_EMPTY_SOURCE = "The source returned no data for this series (it may be archived or unavailable)."


def _has_rows(eng: QueryEngine, series_id: str) -> bool:
    """Any ingested row (not an on-demand cache row) for `src:ds:ind` or `src:ds:ind:geo`.
    Cached rows do not count: such a series keeps going through fetch_on_demand (a cache hit)."""
    parts = series_id.split(":", 3)
    w = "source_id=? AND dataset_id=? AND indicator_id=?" + (
        " AND series_id=?" if len(parts) == 4 else ""
    )
    p = [*parts[:3], series_id] if len(parts) == 4 else parts[:3]
    return bool(eng._run(f"SELECT 1 FROM _obs_ingested WHERE {w} LIMIT 1", p, 1)[1])


def _prepare(eng, series_id, start, end, geo, filters):
    """Validation, licence gate and on-demand fetch shared by get_observations and
    stream_observations. -> (status, retry, start, end, remote, filters, empty); status "ok" = read.
    `empty`: an on-demand fetch ran and the source returned nothing (fetch_on_demand gave no path)."""
    cat = eng.catalog
    parts = series_id.split(":", 3)
    filters = _check_filters(filters)
    s = cat.get_series(":".join(parts[:3])) if len(parts) >= 3 else None
    if not s:
        return "not_found", None, start, end, False, filters, False
    if not can_serve(cat.licence_for(s["series_key"]), eng.settings.mode):
        return "forbidden", None, start, end, False, filters, False
    status = (cat.get_dataset(s["source_id"], s["dataset_id"]) or {}).get("status")
    # An ingested dataset can still lack this series: the ingest (or a fixture/demo build) fetched
    # a subset of its indicators or geos. Such a series is served like a remote one.
    remote = status == "remote" or _outside_core(eng.settings, s) or not _has_rows(eng, series_id)
    empty = False
    if remote and eng.settings.ondemand:
        g = geo or (parts[3] if len(parts) == 4 else None)
        req = FetchRequest(
            s["dataset_id"], (s["indicator_id"],), geos=(g,) if g else (), start=start, end=end, filters=filters,
        )  # fmt: skip  # limit is a reply cap, not a fetch cap
        path, retry = fetch_on_demand(
            req,
            s["source_id"],
            eng.settings,
            cat,
            http=_http_for(s["source_id"], eng.settings, cat),
        )
        if retry is not None:
            return "rate_limited", retry, start, end, remote, filters, False
        empty = path is None
    if "period" in filters:  # the fetch is already scoped to that frame; start/end would hide it
        start = end = None
    return "ok", None, start, end, remote, filters, empty


def _result(eng, series_id, status, cols=(), rows=(), trunc=False, retry=None, note=None,
            next_offset=None, geo=None):  # fmt: skip
    ra = None
    if "retrieved_at" in cols:
        i = list(cols).index("retrieved_at")
        ra = max((r[i] for r in rows if r[i] is not None), default=None)
    cites = (
        []
        if status == "not_found"
        else _cites(eng, "", ["series_id", "retrieved_at"], [[series_id, ra]])
    )
    # No rows: a row cap did not cut this answer, the note says why it is empty. Otherwise partial
    # only if the dataset is flagged AND this series was recorded as cut (see _cut_ids).
    partial = (
        status == "ok" and bool(rows) and bool(_truncated_datasets(eng.catalog, cites))
        and _cut_ids(eng, series_id, geo)
    )  # fmt: skip
    trunc_warn = _trunc_warning(eng.catalog, cites) if partial else None
    return ObservationsResult(
        series_id=series_id, status=status, columns=list(cols), rows=_j(list(rows)),
        truncated=trunc, partial=partial, next_offset=next_offset,
        retry_after=retry, citations=cites,
        warning=" ".join(w for w in (trunc_warn, note) if w) or None,
    )  # fmt: skip


def get_observations(
    series_id: str,
    *,
    start: date | None = None,
    end: date | None = None,
    geo: str | None = None,
    limit: int | None = None,
    filters: dict[str, str] | None = None,
    offset: int = 0,
) -> ObservationsResult:
    """`offset` skips rows in (geo, period) order; next_offset is None when no rows follow."""
    eng = _engine()
    _limit(limit, MAX_LIMIT)
    offset = _offset(offset)
    series_id, geo = _norm_ids(eng, series_id, geo)
    status, retry, start, end, remote, filters, empty = _prepare(
        eng, series_id, start, end, geo, filters
    )
    if status != "ok":
        return _result(eng, series_id, status, retry=retry)
    cols, rows, trunc = eng.observations(
        series_id, start, end, geo, limit, filters, strict=not remote, offset=offset
    )  # on-demand filters may be connector-only keys
    note = _NOT_MIRRORED if remote and not rows and not eng.settings.ondemand else None
    if empty and not rows:
        note = _EMPTY_SOURCE
    return _result(
        eng, series_id, "ok", cols, rows, trunc, note=note,
        next_offset=offset + len(rows) if trunc else None, geo=geo,
    )  # fmt: skip


def get_observations_recent(
    series_id: str,
    *,
    start: date | None = None,
    end: date | None = None,
    geo: str | None = None,
    filters: dict[str, str] | None = None,
    max_rows: int = 200,
) -> RecentObservations:
    """A short answer for a model: at most `max_rows` rows, the latest periods of every geo
    (max_rows // n_geos each; more geos than max_rows: the first max_rows geos, latest row each).
    Never pages: `truncated` and `next_offset` stay empty, `omitted_rows` and `warning` say what
    was left out. Use get_observations with `limit` for exact paging."""
    eng = _engine()
    series_id, geo = _norm_ids(eng, series_id, geo)
    status, retry, start, end, remote, filters, empty = _prepare(
        eng, series_id, start, end, geo, filters
    )
    if status != "ok":
        return RecentObservations(**_result(eng, series_id, status, retry=retry).model_dump())
    cols, rows, total, n = eng.recent_observations(
        series_id, start, end, geo, filters, strict=not remote, cap=max_rows
    )
    note = _NOT_MIRRORED if remote and not rows and not eng.settings.ondemand else None
    if empty and not rows:
        note = _EMPTY_SOURCE
    omitted = total - len(rows)
    if omitted:
        shown = len({r[cols.index("geo")] for r in rows})
        per = max(1, max_rows // max(n, 1))
        note = " ".join(x for x in (note, (
            f"Cut to {len(rows)} of {total} rows: the latest {per} per geo. "
            + (f"Only {shown} of {n} geos are shown, the rest are omitted entirely; "
               "pass geo, or a 4-part series_id." if shown < n else
               "Earlier periods are omitted; narrow with start/end, or pass limit to page."))
        ) if x)  # fmt: skip
    r = _result(eng, series_id, "ok", cols, rows, False, note=note, geo=geo)
    return RecentObservations(**r.model_dump(), omitted_rows=omitted)


@dataclass
class ObservationsStream:
    series_id: str
    columns: list[str]
    batches: Iterator[list[list[Any]]]  # raw DuckDB values, <= export_max_rows rows in total
    citation: Citation | None


def stream_observations(
    series_id: str,
    *,
    start: date | None = None,
    end: date | None = None,
    geo: str | None = None,
    filters: dict[str, str] | None = None,
) -> ObservationsResult | ObservationsStream:
    """All rows of a series (every geo of a 3-part key) for export. A non-ok status comes back as
    the ObservationsResult that get_observations would return; otherwise a stream."""
    eng = _engine()
    series_id, geo = _norm_ids(eng, series_id, geo)
    status, retry, start, end, remote, filters, _ = _prepare(
        eng, series_id, start, end, geo, filters
    )
    if status != "ok":
        return _result(eng, series_id, status, retry=retry)
    cols, batches = eng.iter_observations(series_id, start, end, geo, filters, strict=not remote)
    cites = _cites(eng, "", ["series_id", "retrieved_at"], [[series_id, None]])
    return ObservationsStream(series_id, cols, batches, cites[0] if cites else None)


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


def list_sources(
    *,
    q: str | None = None,
    kind: str | None = None,
    topic: str | list[str] | None = None,
    redistribute: str | None = None,
    auth: str | None = None,
    status: str | None = None,
) -> list[SourceStatus]:
    """Sources, optionally filtered (all AND). `q`: substring of name, id or a dataset title.
    `auth`: keyless | key. `status`: data (has ingested or stale datasets) | catalogue (none).
    `topic`: any-of; a source's topics come from its name and dataset titles."""
    eng = _engine()
    cat = eng.catalog
    hosted = eng.settings.mode == "hosted"
    topics = _topics_arg(topic)
    redistribute = _one_of(redistribute, _REDIST, "redistribute")
    auth = _one_of(auth, ("keyless", "key"), "auth")
    status = _one_of(status, ("data", "catalogue"), "status")
    needle = (q or "").strip().lower()
    info = dataset_info(cat)
    if hosted:  # the engine views hold exactly the servable datasets/series
        ds_rows = eng._run(
            "SELECT source_id, dataset_id, title, status FROM datasets", None, 10**7
        )[1]
        dq = (
            "SELECT count(*) n, max(last_ingested_at) last, coalesce(sum((status='stale')::int),0)"
            " stale FROM datasets WHERE source_id=?"
        )
        nq = "SELECT count(*) FROM series WHERE source_id=?"
    else:
        ds_rows = [
            list(r.values())
            for r in cat._all("SELECT source_id, dataset_id, title, status FROM datasets")
        ]
    by_src: dict[str, list[list]] = {}
    for r in ds_rows:
        by_src.setdefault(r[0], []).append(r)
    out = []
    for s in cat.list_sources():
        dss = by_src.get(s["id"], [])
        if hosted and not dss:
            continue
        found = {t for _, d, title, _ in dss for t in series_topics(title, info.get((s["id"], d)))}
        found |= set(series_topics(s["name"], None))
        stopics = [t for t in TAXONOMY if t in found]
        has_data = any(r[3] in ("ingested", "stale") for r in dss)
        if (
            (kind and s["kind"] != kind)
            or (redistribute and s["redistribute"] != redistribute)
            or (auth and (s["auth"] == "none") != (auth == "keyless"))
            or (status and has_data != (status == "data"))
            or (topics and not set(topics) & set(stopics))
            or (
                needle
                and not any(needle in x.lower() for x in (s["name"], s["id"], *(r[2] for r in dss)))
            )
        ):
            continue
        if hosted:
            _, [[n0, last, stale]], _ = eng._run(dq, [s["id"]], 1)
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
            topics=stopics,
        ))  # fmt: skip
    return out


@cache
def _schema() -> SchemaResult:
    text = resources.files("statmesh.data").joinpath("schema.yaml").read_text("utf-8")
    return SchemaResult.model_validate(yaml.safe_load(text))


def describe_schema() -> SchemaResult:
    """Every SQL view run_sql can read, with columns, types and join hints."""
    return _schema()
