"""UNHCR refugee statistics, legacy population API (no key).

Endpoint: GET /population/v1/population/?yearFrom=&yearTo=&coa=<ISO3>&page=N, paged by `maxPages`.
Each item is an origin x asylum pair. Rows with coo_iso "-" are the country-of-asylum totals, so
those are the observations: one series per (measure, country of asylum). Bilateral pairs are
skipped, which avoids duplicate series ids. Measure values come back as numbers or strings.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from datetime import UTC, date, datetime
from pathlib import Path

import pyarrow as pa

from statmesh.core.geo import load_geo_map, to_geo
from statmesh.core.http import HttpClient
from statmesh.core.models import (
    DatasetMeta,
    FetchRequest,
    Manifest,
    RawChunk,
    SeriesMeta,
    make_series_id,
)
from statmesh.core.periods import parse_period
from statmesh.core.schema import OBS_SCHEMA

DATASET = "population"
FIRST_YEAR = 1951  # the UNHCR series start here
TITLES = {
    "refugees": "Refugees under UNHCR mandate",
    "asylum_seekers": "Asylum-seekers",
    "idps": "Internally displaced persons (IDPs)",
    "stateless": "Stateless persons",
    "returned_refugees": "Returned refugees",
    "returned_idps": "Returned IDPs",
    "ooc": "Other of concern",
    "oip": "Other people in need of international protection",
    "hst": "Host community",
}
ISO3 = re.compile(r"^[A-Z]{3}$")


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory
        self.geo_map = load_geo_map(directory)

    def _measures(self, limit: int | None = None) -> list[str]:
        ids = list(self.manifest.options["core_indicators"])
        return ids[:limit] if limit else ids

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        """Static catalogue: one dataset, one series per measure. `limit` caps the measures."""
        series = tuple(
            SeriesMeta(
                indicator_id=m,
                title=TITLES.get(m, m),
                description="UNHCR population statistics, country of asylum totals",
                unit="persons",
                freq="A",
            )
            for m in self._measures(limit)
        )
        yield DatasetMeta(
            source_id=self.manifest.id,
            dataset_id=DATASET,
            title="UNHCR population statistics",
            licence=self.manifest.licence,
            source_url="https://www.unhcr.org/refugee-statistics/",
            freq="A",
            series=series,
        )

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        """One chunk per country of asylum per page. req.geos is required (ISO3 asylum countries)."""
        if not req.geos:
            raise ValueError("unhcr needs a country of asylum: pass geo=<ISO3>")
        first = req.start.year if req.start else FIRST_YEAR
        last = req.end.year if req.end else date.today().year
        path = "population/"
        for geo in req.geos:
            iso3 = geo.removeprefix("region:")
            page, pages = 1, 1
            while page <= pages:
                params = {"yearFrom": first, "yearTo": last, "coa": iso3, "page": page}
                resp = http.get(f"{self.manifest.endpoint}/{path}", params=params)
                body = json.loads(resp.content)
                pages = int(body.get("maxPages") or 1)
                page += 1
                yield RawChunk(
                    source_id=self.manifest.id,
                    dataset_id=req.dataset_id,
                    content=resp.content,
                    media_type="application/json",
                    url=f"{self.manifest.endpoint}/{path}",
                    params={k: str(v) for k, v in params.items()},
                    retrieved_at=datetime.now(UTC),
                    meta={"coa": iso3},
                )

    def normalize(self, chunk: RawChunk) -> pa.Table:
        body = json.loads(chunk.content)
        vintage = chunk.retrieved_at.date()
        measures = self._measures()
        cols: dict[str, list] = {f.name: [] for f in OBS_SCHEMA}
        for item in body.get("items") or []:
            if item.get("coo_iso") != "-":  # bilateral pair; keep only the asylum totals
                continue
            asylum = item.get("coa_iso") or ""
            if not ISO3.match(asylum):
                continue
            geo = to_geo(asylum, "iso3", self.geo_map)
            start, end, freq = parse_period(str(item["year"]))
            for m in measures:
                value = _num(item.get(m))
                if value is None:
                    continue
                cols["series_id"].append(make_series_id(chunk.source_id, chunk.dataset_id, m, geo))
                cols["source_id"].append(chunk.source_id)
                cols["dataset_id"].append(chunk.dataset_id)
                cols["indicator_id"].append(m)
                cols["geo"].append(geo)
                cols["period_start"].append(start)
                cols["period_end"].append(end)
                cols["freq"].append(freq)
                cols["value"].append(value)
                cols["unit"].append("persons")
                cols["unit_mult"].append(0)
                cols["dims"].append({})
                cols["obs_status"].append(None)
                cols["retrieved_at"].append(chunk.retrieved_at)
                cols["vintage"].append(vintage)
        return pa.table(cols, schema=OBS_SCHEMA)


def _num(v: object) -> float | None:
    """UNHCR returns counts as numbers or as strings ("0", "-"); anything non-numeric is missing."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, int | float):
        return float(v)
    try:
        return float(str(v).replace(",", "").strip())
    except ValueError:
        return None
