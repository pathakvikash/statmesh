"""Keyword search over the catalog: geo extraction + synonym expansion + safe FTS5 query."""

import json
import re
from collections.abc import Callable
from functools import cache
from importlib import resources
from weakref import WeakKeyDictionary

import yaml

from statmesh.core.catalog import Catalog
from statmesh.core.geo import find_geos_in_text, group_members
from statmesh.search.topics import TAXONOMY, check_topics, classify

STOP = frozenset({
    "a", "an", "and", "are", "as", "at", "between", "by", "compare", "data", "do", "does", "for",
    "from", "get", "give", "how", "in", "is", "it", "latest", "me", "of", "on", "or", "over",
    "rate", "show", "since", "than", "that", "the", "their", "to", "vs", "versus", "what",
    "which", "with", "year", "years", "last", "recent", "recently", "most", "fastest",
    "statistics", "stats", "series", "percent", "percentage", "pct", "per", "cent",
})  # fmt: skip
_GROUP_RE = re.compile(r"\b(G20|G7|EU27)\b|\bEU\b|\bEuropean Union\b", re.IGNORECASE)


@cache
def synonyms() -> dict[str, list[str]]:
    text = resources.files("statmesh.data").joinpath("synonyms.yaml").read_text("utf-8")
    return {k.lower(): list(v) for k, v in yaml.safe_load(text).items()}


def _q(term: str) -> str:
    return '"' + re.sub(r"[^\w ]", " ", term).strip() + '"'


def _concepts(text: str) -> list[list[str]]:
    """Each concept is a list of alternative terms (the literal first, then synonyms)."""
    toks = re.findall(r"\w+", text.lower())
    syn, out, i = synonyms(), [], 0
    while i < len(toks):
        for n in (3, 2, 1):  # longest phrase key first
            phrase = " ".join(toks[i : i + n])
            keys = [phrase, phrase[:-1]] if phrase.endswith("s") else [phrase]
            key = next((k for k in keys if k in syn), None)
            if key or (n == 1 and phrase not in STOP):
                if len(phrase) > 1 or phrase.isdigit():
                    out.append([phrase, *(syn.get(key, []) if key else [])])
                i += n
                break
        else:
            i += 1
    return out


def build_match(concepts: list[list[str]], relaxed: bool = False) -> str | None:
    groups = ["(" + " OR ".join(_q(t) for t in c if _q(t) != '""') + ")" for c in concepts]
    groups = [g for g in groups if g != "()"]
    return (" OR " if relaxed else " AND ").join(groups) or None


def _rerank(rows: list[dict], concepts: list[list[str]]) -> list[dict]:
    """Most query concepts present in the title first, then titles that lead with a concept
    (headline 'Population, total' before 'Rural population'), then bm25."""

    def key(r: dict):
        t = " ".join(re.findall(r"\w+", r["title"].lower()))
        hit = [next((x for x in map(_plain, c) if x and x in t), None) for c in concepts]
        lead = any(h and t.startswith(h) for h in hit)
        return (-sum(h is not None for h in hit), not lead, -r["score"])

    return sorted(rows, key=key)


def _plain(term: str) -> str:
    return " ".join(re.findall(r"\w+", term.lower()))


def detect_geos(q: str) -> tuple[list[str], str]:
    """(geo codes: countries and expanded groups, query text with those removed)."""
    geos, rest = find_geos_in_text(q)
    for m in _GROUP_RE.finditer(rest):
        name = "EU27" if m.group(0).upper() in ("EU", "EUROPEAN UNION") else m.group(1).upper()
        geos += [g for g in group_members(name) if g not in geos]
    return geos, _GROUP_RE.sub(" ", rest)


_UPD = (  # newest of dataset.last_ingested_at and its latest lineage retrieved_at ('' = never)
    "max(COALESCE(d.last_ingested_at,''), COALESCE((SELECT MAX(l.retrieved_at) FROM lineage l "
    "WHERE l.source_id=d.source_id AND l.dataset_id=d.dataset_id),''))"
)


_info_cache: "WeakKeyDictionary[Catalog, tuple[tuple, dict]]" = WeakKeyDictionary()


def dataset_info(catalog: Catalog) -> dict[tuple[str, str], dict]:
    """(source, dataset) -> {title, updated (ISO or ''), mtopics (manifest `topics:` or [])}.

    Cached per catalog; rebuilt when the datasets/sources/lineage fingerprint changes."""
    fp = tuple(
        catalog._all(
            "SELECT (SELECT count(*) FROM sources) a, (SELECT count(*) FROM datasets) b, "
            "(SELECT max(last_ingested_at) FROM datasets) c, "
            "(SELECT max(retrieved_at) FROM lineage) d"
        )[0].values()
    )
    hit = _info_cache.get(catalog)
    if hit and hit[0] == fp:
        return hit[1]
    info = _dataset_info(catalog)
    _info_cache[catalog] = (fp, info)
    return info


def _dataset_info(catalog: Catalog) -> dict[tuple[str, str], dict]:
    mt: dict[str, dict] = {}
    for s in catalog._all("SELECT id, manifest_json FROM sources"):
        try:
            mt[s["id"]] = json.loads(s["manifest_json"]).get("datasets") or {}
        except ValueError:
            mt[s["id"]] = {}
    return {
        (r["source_id"], r["dataset_id"]): {
            "title": r["title"], "updated": r["upd"],
            "mtopics": check_topics((mt.get(r["source_id"], {}).get(r["dataset_id"]) or {}).get("topics")),
        }
        for r in catalog._all(
            f"SELECT d.source_id, d.dataset_id, d.title, {_UPD} AS upd FROM datasets d"
        )
    }  # fmt: skip


def series_topics(title: str, info: dict | None) -> list[str]:
    """Manifest topics for the dataset (when set) plus keyword topics from the titles."""
    info = info or {}
    mt = info.get("mtopics") or []
    found = classify(title, None if mt else info.get("title"))
    return [t for t in TAXONOMY if t in mt or t in found]


def _recent(catalog: Catalog, sources, freq, geo, limit) -> list[dict]:
    """Series rows (fts row shape) newest dataset first; used when q is empty."""
    sql = (
        "SELECT s.series_key, s.source_id, s.title, 0.0 AS score, s.dataset_id, s.indicator_id, "
        "s.unit, s.freq, s.geos, s.start_date, s.end_date FROM series s "
        "JOIN datasets d ON d.source_id=s.source_id AND d.dataset_id=s.dataset_id WHERE 1=1"
    )
    args: list = []
    if sources:
        sql += f" AND s.source_id IN ({','.join('?' * len(sources))})"
        args += sources
    if freq:
        sql += " AND (s.freq IS NULL OR s.freq = ?)"
        args.append(freq)
    if geo:
        sql += " AND (s.geos = '' OR (' ' || s.geos || ' ') LIKE ?)"
        args.append(f"% {geo} %")
    sql += f" ORDER BY {_UPD} DESC, s.series_key LIMIT ?"
    return catalog._all(sql, [*args, limit])


def search(
    catalog: Catalog,
    q: str,
    geo: str | None = None,
    freq: str | None = None,
    source: str | list[str] | None = None,
    limit: int = 10,
    keep: Callable[[dict], bool] | None = None,
    refine: Callable[[list[dict]], list[dict]] | None = None,
    pool: int | None = None,
    listing: bool = False,
) -> list[dict]:
    """Catalog.fts rows (series_key, source_id, title, score, ...) plus `series_id`.

    `series_id` is the series_key with the geo appended when exactly one geo is known
    (explicit `geo`, or a single country named in the query); otherwise it equals series_key.
    `source` may be a list. `keep` (e.g. a licence filter) is applied before `limit`, so filtered
    rows never shrink the page; `refine` then filters/reorders the whole candidate list (also before
    `limit`). With `listing`, an empty `q` lists series newest first instead of returning nothing. `pool` = candidates
    fetched before keep/refine (default max(limit*5, 50); pass more when filters are strict).
    """
    sources = [source] if isinstance(source, str) else list(source or [])
    pool = pool or max(limit * 5, 50)
    if not q.strip():
        rows = _recent(catalog, sources, freq, geo, pool) if listing else []
    else:
        geos, rest = detect_geos(q)
        geo = geo or (geos[0] if len(geos) == 1 else None)
        concepts = _concepts(rest)
        rows = []
        # ponytail: two tries (AND, then OR); a middle "drop one concept" step if recall needs it
        for relaxed in (False, True):
            match = build_match(concepts, relaxed)
            if match is None:
                break
            rows = catalog.fts(match, sources=sources, freq=freq, geo=geo, limit=pool)
            if rows:
                break
        rows = _rerank(rows, concepts)
    if keep:
        rows = [r for r in rows if keep(r)]
    if refine:
        rows = refine(rows)
    rows = rows[:limit]
    for r in rows:
        r["series_id"] = (
            f"{r['series_key']}:{geo}"
            if geo and r["series_key"].count(":") == 2
            else r["series_key"]
        )
    return rows
