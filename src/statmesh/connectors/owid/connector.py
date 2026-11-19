"""Our World in Data Grapher charts (https://ourworldindata.org/grapher/<slug>).

Two public endpoints per chart, no key: `<slug>.csv` (entity, code, year, value columns; with
`useColumnShortNames=true` the headers equal the metadata `shortName`s) and `<slug>.metadata.json`
(chart title, subtitle, citation; per column unit and type). OWID has no catalogue endpoint
(`/api/search?q=` is keyword search only), so the catalogue is `options.core_slugs`.
Charts built on non-redistributable data (IHME GBD) answer the CSV with HTTP 403; fetch skips them.
One series per value column: `slug` for the primary (first numeric) column, `slug.shortname` for the others. Rows without an entity code (OWID's own aggregates) are dropped; OWID_WRL is the World.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import re
from collections.abc import Iterable
from datetime import UTC, date, datetime
from pathlib import Path

import httpx
import pyarrow as pa

from statmesh.core.geo import load_geo_map, to_geo
from statmesh.core.http import HttpClient
from statmesh.core.models import (
    DatasetMeta,
    FetchRequest,
    Licence,
    Manifest,
    RawChunk,
    SeriesMeta,
    make_series_id,
)
from statmesh.core.schema import OBS_SCHEMA

log = logging.getLogger(__name__)
DATASET = "grapher"
_CSV_PARAMS = {"useColumnShortNames": "true", "csvType": "full"}
_IHME = Licence(
    name="IHME Free-of-Charge Non-commercial User Agreement",
    url="https://www.healthdata.org/data-tools-practices/data-practices/ihme-free-charge-non-commercial-user-agreement",
    redistribute="no",
    attribution="Source: IHME, Global Burden of Disease, via Our World in Data",
)


def value_columns(meta: dict) -> dict[str, dict]:
    """{shortName: column metadata} for the numeric value columns of a chart."""
    return {
        c["shortName"]: c
        for c in meta["columns"].values()
        if c.get("type") == "Numeric" and c.get("shortName")
    }


_NO = re.compile(
    r"\bGBD\b|Global Burden of Disease|IHME|Institute for Health Metrics", re.IGNORECASE
)


def producers(meta: dict) -> list[str]:
    """Upstream producers of a chart: metadata `origins[].producer` when present, else parsed
    from the citations ("World Bank (2025) – processed by Our World in Data" -> "World Bank")."""
    cols = meta["columns"].values()
    found = [o["producer"] for c in cols for o in c.get("origins") or [] if o.get("producer")]
    if not found:
        cites = [meta["chart"].get("citation") or ""] + [c.get("citationShort") or "" for c in cols]
        for cite in cites:
            for part in cite.split(";"):
                name = re.sub(r"\s*\([^)]*\)", "", part.split(" – ")[0]).strip()
                if name:
                    found.append(name)
    return list(dict.fromkeys(found))


def series_licence(meta: dict, default: Licence, open_producers: Iterable[dict] = ()) -> Licence:
    """Per-chart licence from the metadata citation: IHME/GBD -> no; all producers on the
    manifest allowlist (`options.open_producers`) -> yes; anything else -> review."""
    cols = list(meta["columns"].values())
    text = " ".join(
        [meta["chart"].get("citation") or ""]
        + [c.get(k) or "" for c in cols for k in ("citationShort", "citationLong")]
        + producers(meta)
    )
    if _NO.search(text):
        return _IHME
    prods = producers(meta)
    allow = {m.lower(): p for p in open_producers for m in p["match"]}
    hits = [allow.get(p.lower()) for p in prods]
    if prods and all(hits):
        uniq = {h["name"]: h for h in hits}.values()
        return Licence(
            name=" / ".join(h["licence"] for h in uniq),
            url=next(iter(uniq))["url"],
            redistribute="yes",
            attribution=f"Source: {', '.join(h['name'] for h in uniq)}, via Our World in Data",
        )
    who = ", ".join(prods) or "unknown producer"
    return Licence(
        name=f"upstream provider terms ({who})",
        url=default.url,
        redistribute="review",
        attribution=f"Source: {who}, via Our World in Data",
    )


def indicator_id(slug: str, col: str, cols) -> str:
    """`slug` for the chart's primary (first numeric) column, `slug.<col>` for the others."""
    return slug if col == next(iter(cols)) else f"{slug}.{col}"


def release_date(meta: dict) -> str | None:
    """Latest column `lastUpdated`, else the download date."""
    dates = [c["lastUpdated"] for c in meta["columns"].values() if c.get("lastUpdated")]
    return max(dates) if dates else meta.get("dateDownloaded")


def _skippable(e: httpx.HTTPStatusError) -> bool:
    """403 (non-redistributable), 404/410 (gone) and 3xx (renamed slug) skip the chart."""
    c = e.response.status_code
    return c in (403, 404, 410) or 300 <= c < 400


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory
        self.geo_map = load_geo_map(directory)

    def _meta(self, http: HttpClient, slug: str) -> dict:
        url = f"{self.manifest.endpoint}/grapher/{slug}.metadata.json"
        return json.loads(http.get(url).content)

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        ds = self.manifest.datasets[DATASET]
        series: list[SeriesMeta] = []
        for slug in self.manifest.options["core_slugs"][:limit]:
            try:
                meta = self._meta(http, slug)
            except httpx.HTTPStatusError as e:
                if not _skippable(e):
                    raise
                log.warning("owid: %s metadata HTTP %s; skipped", slug, e.response.status_code)
                continue
            chart, cols = meta["chart"], value_columns(meta)
            lic = series_licence(
                meta, self.manifest.licence, self.manifest.options["open_producers"]
            )
            for col, c in cols.items():
                title = (
                    chart["title"]
                    if len(cols) == 1
                    else f"{chart['title']}: {c.get('titleShort') or c.get('titleLong') or col}"
                )
                series.append(
                    SeriesMeta(
                        indicator_id(slug, col, cols),
                        title,
                        description=chart.get("subtitle", ""),
                        unit=c.get("unit") or None,
                        freq="A",
                        licence=lic,
                    )
                )
        yield DatasetMeta(
            self.manifest.id,
            DATASET,
            ds["title"],
            self.manifest.licence,
            source_url="https://ourworldindata.org/charts",
            freq="A",
            series=tuple(series),
        )

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        # ponytail: geos/start/end are not applied; the CSV endpoint ignores country/time filters
        slugs = [i.split(".")[0] for i in req.indicator_ids] or self.manifest.options["core_slugs"]
        for slug in dict.fromkeys(slugs):
            base = f"{self.manifest.endpoint}/grapher/{slug}"
            try:
                r = http.get(f"{base}.csv", params=_CSV_PARAMS)
                meta = self._meta(http, slug)
            except httpx.HTTPStatusError as e:
                if not _skippable(e):
                    raise
                log.warning("owid: %s skipped (HTTP %s)", slug, e.response.status_code)
                continue
            cols = value_columns(meta)
            yield RawChunk(
                source_id=self.manifest.id,
                dataset_id=DATASET,
                content=r.content,
                media_type="text/csv",
                url=f"{base}.csv",
                params=_CSV_PARAMS,
                retrieved_at=datetime.now(UTC),
                meta={
                    "slug": slug,
                    "columns": {k: c.get("unit") or None for k, c in cols.items()},
                    "vintage": release_date(meta),
                },
            )

    def normalize(self, chunk: RawChunk) -> pa.Table:
        slug, cols = chunk.meta["slug"], chunk.meta["columns"]
        vint = chunk.meta.get("vintage")
        vintage = date.fromisoformat(vint) if vint else None
        out: dict[str, list] = {f.name: [] for f in OBS_SCHEMA}
        for r in csv.DictReader(io.StringIO(chunk.content.decode("utf-8-sig"))):
            if not r.get("code") or not (r.get("year") or "").lstrip("-").isdigit():
                continue  # OWID aggregates have no code; daily charts have `day`, not `year`
            y = int(r["year"])
            if not 1 <= y <= 9999:
                continue
            geo = to_geo(r["code"], "iso3", self.geo_map)
            for col, unit in cols.items():
                if not r.get(col):
                    continue
                ind = indicator_id(slug, col, cols)
                vals = dict(  # noqa: C408
                    series_id=make_series_id(chunk.source_id, DATASET, ind, geo),
                    source_id=chunk.source_id,
                    dataset_id=DATASET,
                    indicator_id=ind,
                    geo=geo,
                    period_start=date(y, 1, 1),
                    period_end=date(y, 12, 31),
                    freq="A",
                    value=float(r[col]),
                    unit=unit,
                    unit_mult=0,
                    dims={},
                    obs_status=None,
                    retrieved_at=chunk.retrieved_at,
                    vintage=vintage,
                )
                for k, v in vals.items():
                    out[k].append(v)
        return pa.table(out, schema=OBS_SCHEMA)
