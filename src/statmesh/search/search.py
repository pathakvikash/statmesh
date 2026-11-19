"""Keyword search over the catalog: geo extraction + synonym expansion + safe FTS5 query."""

import re
from collections.abc import Callable
from functools import cache
from importlib import resources

import yaml

from statmesh.core.catalog import Catalog
from statmesh.core.geo import find_geos_in_text, group_members

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


def search(
    catalog: Catalog,
    q: str,
    geo: str | None = None,
    freq: str | None = None,
    source: str | None = None,
    limit: int = 10,
    keep: Callable[[dict], bool] | None = None,
) -> list[dict]:
    """Catalog.fts rows (series_key, source_id, title, score, ...) plus `series_id`.

    `series_id` is the series_key with the geo appended when exactly one geo is known
    (explicit `geo`, or a single country named in the query); otherwise it equals series_key.
    `keep` (e.g. a licence filter) is applied before `limit`, so filtered rows never shrink the page.
    """
    geos, rest = detect_geos(q)
    geo = geo or (geos[0] if len(geos) == 1 else None)
    concepts = _concepts(rest)
    rows: list[dict] = []
    # ponytail: two tries (AND, then OR); a middle "drop one concept" step if recall needs it
    for relaxed in (False, True):
        match = build_match(concepts, relaxed)
        if match is None:
            break
        rows = catalog.fts(match, source=source, freq=freq, geo=geo, limit=max(limit * 5, 50))
        if rows:
            break
    rows = _rerank(rows, concepts)
    if keep:
        rows = [r for r in rows if keep(r)]
    rows = rows[:limit]
    for r in rows:
        r["series_id"] = (
            f"{r['series_key']}:{geo}"
            if geo and r["series_key"].count(":") == 2
            else r["series_key"]
        )
    return rows
