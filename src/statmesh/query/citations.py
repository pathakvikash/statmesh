"""Citations for a SQL result: every series/dataset the rows or the SQL text point at."""

from __future__ import annotations

import re
from typing import Any

from statmesh.core.api_models import Citation
from statmesh.core.catalog import Catalog
from statmesh.core.licence import can_serve

NO_SOURCE_WARNING = (
    "No sources could be identified for this result. Select series_id (or source_id and "
    "dataset_id) so citations can be attached before quoting numbers."
)
_LIT = re.compile(r"'((?:[^']|'')*)'")
_STR = r"'(?:[^']|'')*'"
_NARROW = re.compile(
    rf"\b(?:dataset_id|series_id)\s*(?:=\s*({_STR})|IN\s*\(\s*({_STR}(?:\s*,\s*{_STR})*)\s*\))",
    re.IGNORECASE,
)
# Anything that could stop a dataset_id/series_id equality binding every row: stay wide.
_UNSAFE = re.compile(
    r"\b(?:OR|NOT|CASE|JOIN|UNION|EXCEPT|INTERSECT)\b|\bFROM\s+[\w.\"]+(?:\s+(?:AS\s+)?\w+)?\s*,",
    re.IGNORECASE,
)


def _narrowed(sql: str) -> set[str]:
    """Literals of `dataset_id|series_id = 'x'` / `IN ('x', ..)`, only when the SQL is a single
    plain SELECT of ANDed filters (so each one really restricts the rows); else empty."""
    bare = _LIT.sub("''", sql)
    if len(re.findall(r"\bSELECT\b", bare, re.IGNORECASE)) != 1 or _UNSAFE.search(bare):
        return set()
    return {m.replace("''", "'") for g in _NARROW.findall(sql) for m in _LIT.findall(g[0] or g[1])}


def _cite(cat: Catalog, source_id: str, dataset_id: str, key: str | None) -> Citation | None:
    src = cat.get_source(source_id)
    ds = cat.get_dataset(source_id, dataset_id)
    if not src or not ds:
        return None
    lic = cat.licence_for(key or f"{source_id}:{dataset_id}")
    lin = cat.latest_lineage(source_id, dataset_id)
    return Citation(
        source_id=source_id, source_name=src["name"], dataset_id=dataset_id, series_id=key,
        licence_name=lic.name, licence_url=lic.url, redistribute=lic.redistribute,
        attribution=lic.attribution, source_url=ds["source_url"] or src["endpoint"],
        retrieved_at=lin["retrieved_at"] if lin else None,
    )  # fmt: skip


def citations_for(
    cat: Catalog, mode: str, sql: str, columns: list[str], rows: list[list[Any]]
) -> tuple[list[Citation], str | None]:
    """Series ids in cells and SQL literals, source_id/dataset_id columns, source-id literals."""
    series: set[str] = set()  # series keys
    datasets: set[tuple[str, str]] = set()
    sources: set[str] = set()
    strings = {v for r in rows for v in r if isinstance(v, str)}
    strings |= {m.replace("''", "'") for m in _LIT.findall(sql)}
    known_src = {s["id"] for s in cat.list_sources()}
    for v in strings:
        p = v.split(":", 3)
        if len(p) >= 3 and cat.get_series(":".join(p[:3])):
            series.add(":".join(p[:3]))
        elif len(p) >= 2 and cat.get_dataset(p[0], p[1]):
            datasets.add((p[0], p[1]))
        elif v in known_src:
            sources.add(v)
    ix = {c: i for i, c in enumerate(columns)}
    if "source_id" in ix and "dataset_id" in ix:
        datasets |= {(r[ix["source_id"]], r[ix["dataset_id"]]) for r in rows}
    elif "source_id" in ix:
        sources |= {r[ix["source_id"]] for r in rows}
    # A source literal means "the whole source" unless the SQL pins dataset_id/series_id literals
    # that belong to it; then only those datasets. Nothing known to pin -> keep the wide set.
    pins = _narrowed(sql)
    pinned = set()
    for v in pins:
        p = v.split(":", 3)
        if len(p) >= 3 and cat.get_series(":".join(p[:3])):
            pinned.add((p[0], p[1]))
    for s in sources:
        keep = {(s, v) for v in pins if cat.get_dataset(s, v)} | {x for x in pinned if x[0] == s}
        if keep:
            datasets |= keep
            continue
        datasets |= {
            (d["source_id"], d["dataset_id"])
            for d in cat._all(
                "SELECT source_id, dataset_id FROM datasets d WHERE source_id=? AND (status!='remote' "
                "OR EXISTS (SELECT 1 FROM cache_entries c WHERE c.source_id=d.source_id "
                "AND c.dataset_id=d.dataset_id))",
                (s,),
            )
        }
    out: list[Citation] = []
    for k in sorted(series):
        out.append(_cite(cat, *k.split(":")[:2], k))
    done = {(c.source_id, c.dataset_id) for c in out if c}
    for sid, did in sorted(datasets - done):
        out.append(_cite(cat, sid, did, None))
    if "retrieved_at" in ix:  # the rows' own retrieval time beats the latest lineage row
        seen: dict[tuple[str, str], Any] = {}
        for r in rows:
            if r[ix["retrieved_at"]] is None:
                continue
            if "source_id" in ix and "dataset_id" in ix:
                k = (r[ix["source_id"]], r[ix["dataset_id"]])
            elif "series_id" in ix:
                k = tuple(str(r[ix["series_id"]]).split(":")[:2])
            else:
                continue
            seen[k] = max(seen.get(k, r[ix["retrieved_at"]]), r[ix["retrieved_at"]])
        for c in out:
            if c and (c.source_id, c.dataset_id) in seen:
                c.retrieved_at = seen[(c.source_id, c.dataset_id)]
    out = [c for c in out if c and can_serve(c, mode)]
    return out, (None if out else NO_SOURCE_WARNING)
