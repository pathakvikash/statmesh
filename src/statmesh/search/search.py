"""Keyword search over the catalog: geo extraction + synonym expansion + safe FTS5 query."""

import json
import re
from calendar import monthrange
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
    # question filler (M3 P2)
    "many", "much", "did", "every", "each", "lives", "number",
    "currently", "now", "today", "late", "fast", "rising", "across",
    "were", "was", "been", "be", "have", "has", "had", "there", "all", "total", "annual", "also",
    "about", "country", "countries", "below", "above", "help",
    "third", "fourth",
})  # fmt: skip
_GROUP_RE = re.compile(
    r"\b(G20|G7|EU27)\b|\bEU\b|\bEuropean Union\b|\beuro ?zone\b|\beuro area\b", re.IGNORECASE
)
# "Population, total" / "Inflation, annual": a trailing headline qualifier is dropped before matching.
# Leading words are kept, so "Annual rate of change" still matches "annual inflation".
_TRAILING_QUAL = re.compile(r"(?:,\s*|\s+)(?:total|annual)\s*$")
_EA_RE = re.compile(r"\beuro ?zone\b|\beuro area\b", re.IGNORECASE)
# "euro area countries", "member states", "eurozone members": the 21-country EA group;
# a bare "euro area" or "eurozone" means the aggregate region EMU (regions.csv).
_EA_MEMBERS_RE = re.compile(
    r"\beuro ?area countries\b|\beurozone members\b|\bmember states\b", re.IGNORECASE
)
_MONTHS = {
    m: i + 1
    for i, m in enumerate(
        ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
    )
} | {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7, "aug": 8, "sep": 9,
     "sept": 9, "oct": 10, "nov": 11, "dec": 12}  # fmt: skip
_MONTH_RE = re.compile(  # standalone month names (not "may", an ordinary verb)
    r"\b(" + "|".join(sorted((m for m in _MONTHS if m != "may"), key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)
_FISCAL_RE = re.compile(r"\b((?:19|20)\d{2})\s*[-/]\s*(\d{4}|\d{2})\b")
_YEAR_RE = re.compile(r"\b((?:19|20)\d{2})\b")
_MONTH_YEAR_RE = re.compile(
    r"\b("
    + "|".join(sorted(_MONTHS, key=len, reverse=True))
    + r")\.?\s+(?:of\s+)?((?:19|20)\d{2})\b",
    re.IGNORECASE,
)
_QUARTER_RE = re.compile(
    r"\b(?:Q([1-4])|(first|second|third|fourth|1st|2nd|3rd|4th) quarter)(?: of)?\s*((?:19|20)\d{2})\b",
    re.IGNORECASE,
)
_ORDINAL = {
    "first": 1,
    "1st": 1,
    "second": 2,
    "2nd": 2,
    "third": 3,
    "3rd": 3,
    "fourth": 4,
    "4th": 4,
}
_BOOST_FILE = "search_boosts.yaml"
SEARCH_POOL = 2000  # candidates every page is cut from; offset + limit must stay within it


@cache
def synonyms() -> dict[str, list[str]]:
    text = resources.files("statmesh.data").joinpath("synonyms.yaml").read_text("utf-8")
    return {k.lower(): list(v) for k, v in yaml.safe_load(text).items()}


def _q(term: str) -> str:
    return '"' + re.sub(r"[^\w ]", " ", term).strip() + '"'


def _counts_people(toks: list[str], i: int) -> bool:
    """True when toks[i] ('people') is the object of a count: 'how many people', 'number of people'.
    Elsewhere ('people living with HIV') the word stays literal."""
    return i >= 2 and toks[i - 2 : i] in (["how", "many"], ["number", "of"])


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
                    target = syn.get(key, [None])[0] if key else None
                    if target and target.startswith("=") and _counts_people(toks, i):
                        t = target[1:]  # "how many people" -> "population"
                        out.append([t, *syn.get(t, [])])
                    else:
                        extra = [
                            s for s in (syn.get(key, []) if key else []) if not s.startswith("=")
                        ]
                        out.append([phrase, *extra])
                i += n
                break
        else:
            i += 1
    return out


def build_match(concepts: list[list[str]], relaxed: bool = False) -> str | None:
    groups = ["(" + " OR ".join(_q(t) for t in c if _q(t) != '""') + ")" for c in concepts]
    groups = [g for g in groups if g != "()"]
    return (" OR " if relaxed else " AND ").join(groups) or None


@cache
def boosts() -> dict[str, list[str]]:
    """Geo (or group) code -> home sources, read from data/search_boosts.yaml."""
    text = resources.files("statmesh.data").joinpath(_BOOST_FILE).read_text("utf-8")
    return {k.upper(): [s.lower() for s in v] for k, v in (yaml.safe_load(text) or {}).items()}


def parse_period(text: str) -> tuple[tuple[str, str] | None, str]:
    """(ISO (start, end) the text names, or None; text without the period words)."""
    spans: list[tuple[str, str]] = []
    covered: set[int] = set()
    for m in _FISCAL_RE.finditer(text):  # Indian-style fiscal year 2023-24: April to March
        y1, y2 = int(m.group(1)), m.group(2)
        y2 = int(y2) if len(y2) == 4 else y1 // 100 * 100 + int(y2)
        spans.append((f"{y1}-04-01", f"{y2}-03-31"))
        covered |= {y1, y2}
    for m in _MONTH_YEAR_RE.finditer(text):
        mo, y = _MONTHS[m.group(1).lower()], int(m.group(2))
        spans.append((f"{y}-{mo:02d}-01", f"{y}-{mo:02d}-{monthrange(y, mo)[1]:02d}"))
        covered.add(y)
    for m in _QUARTER_RE.finditer(text):
        q, y = int(m.group(1) or _ORDINAL[m.group(2).lower()]), int(m.group(3))
        spans.append((f"{y}-{3 * q - 2:02d}-01", f"{y}-{3 * q:02d}-{monthrange(y, 3 * q)[1]:02d}"))
        covered.add(y)
    for m in _YEAR_RE.finditer(text):
        y = int(m.group(1))
        if y not in covered:
            spans.append((f"{y}-01-01", f"{y}-12-31"))
            covered.add(y)
    rest = text
    for rx in (_FISCAL_RE, _MONTH_YEAR_RE, _QUARTER_RE, _YEAR_RE, _MONTH_RE):
        rest = rx.sub(" ", rest)
    if not spans:
        return None, rest
    return (min(s for s, _ in spans), max(e for _, e in spans)), rest


def _covers(r: dict, period: tuple[str, str] | None) -> bool:
    """Series coverage (start_date..end_date) overlaps the period. Unknown coverage: False."""
    s, e = r.get("start_date"), r.get("end_date")
    return bool(period and s and e and s <= period[1] and e >= period[0])


def _rerank(
    rows: list[dict],
    concepts: list[list[str]],
    period: tuple[str, str] | None = None,
    labels: frozenset[str] = frozenset(),
) -> list[dict]:
    """Reorder only (never filter). A concept scores 1 when its literal term is in the title, 0.5
    when only a synonym is. Then: series covering the named period, series from the home sources
    of the query's geo, titles that lead with a literal concept (headline 'Population, total'
    before 'Rural population'), then bm25."""
    home = {s for lab in labels for s in boosts().get(lab, [])}

    def key(r: dict):
        t = _plain(_TRAILING_QUAL.sub("", r["title"].lower()))
        score, lead = 0.0, False
        for c in concepts:
            lit = _plain(c[0])
            if lit and lit in t:
                score += 1
                lead = lead or t.startswith(lit)
            elif any(p and p in t for p in map(_plain, c[1:])):
                score += 0.5
        return (
            -score,
            -int(_covers(r, period)),
            -int(r["source_id"] in home),
            not lead,
            -r["score"],
        )

    return sorted(rows, key=key)


def _plain(term: str) -> str:
    return " ".join(re.findall(r"\w+", term.lower()))


def detect_geos(q: str) -> tuple[list[str], str]:
    """(geo codes: countries and expanded groups, query text with those removed)."""
    geos, rest = find_geos_in_text(q)
    for m in _GROUP_RE.finditer(rest):
        word = m.group(0).upper()
        if "EURO" in word and not _EA_MEMBERS_RE.search(q):
            if "region:EMU" not in geos:  # the euro area aggregate
                geos.append("region:EMU")
            continue
        name = "EU27" if word in ("EU", "EUROPEAN UNION") else "EA" if "EURO" in word else word
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
    offset: int = 0,
) -> list[dict]:
    """Catalog.fts rows (series_key, source_id, title, score, ...) plus `series_id`.

    `series_id` is the series_key with the geo appended when exactly one geo is known
    (explicit `geo`, or a single country named in the query); otherwise it equals series_key.
    `source` may be a list. `keep` (e.g. a licence filter) is applied before `limit`, so filtered
    rows never shrink the page; `refine` then filters/reorders the whole candidate list (also before
    `limit`). With `listing`, an empty `q` lists series newest first instead of returning nothing.
    `pool` = candidates fetched before keep/refine (default SEARCH_POOL, the same for every page).
    `offset` skips that many hits of the filtered order and only slices the pool.
    """
    sources = [source] if isinstance(source, str) else list(source or [])
    pool = pool or SEARCH_POOL
    if not q.strip():
        rows = _recent(catalog, sources, freq, geo, pool) if listing else []
    else:
        geos, rest = detect_geos(q)
        geo = geo or (geos[0] if len(geos) == 1 else None)
        period, rest = parse_period(rest)
        concepts = _concepts(rest)
        labels = frozenset({*geos, *([geo] if geo else []), *(["EA"] if _EA_RE.search(q) else [])})
        rows = []
        # ponytail: two tries (AND, then OR); a middle "drop one concept" step if recall needs it
        for relaxed in (False, True):
            match = build_match(concepts, relaxed)
            if match is None:
                break
            rows = catalog.fts(match, sources=sources, freq=freq, geo=geo, limit=pool)
            if rows:
                break
        rows = _rerank(rows, concepts, period, labels)
    if keep:
        rows = [r for r in rows if keep(r)]
    if refine:
        rows = refine(rows)
    rows = rows[offset : offset + limit]
    for r in rows:
        r["series_id"] = (
            f"{r['series_key']}:{geo}"
            if geo and r["series_key"].count(":") == 2
            else r["series_key"]
        )
    return rows
