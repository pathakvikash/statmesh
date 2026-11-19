"""UNESCO Institute for Statistics data API (no key observed).

Endpoint: GET /api/public/data/indicators?indicator=<code>&geoUnit=<ISO3>&start=<year>&end=<year>.
Response: {"hints": [], "records": [...], "indicatorMetadata": []}. Each record has indicatorId,
geoUnit (ISO3), year (int), value (float), magnitude and qualifier (both null in the samples).
One request per (indicator, country); each response is one chunk.
"""

from __future__ import annotations

import json
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

DATASET = "education"
FIRST_YEAR = 1970
TITLES = {
    "LR.AG15T99": "Adult literacy rate, population 15+, both sexes",
    "CR.1": "Completion rate, primary education",
}


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory
        self.geo_map = load_geo_map(directory)

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        """Static catalogue: one dataset, one series per core indicator. `limit` caps them."""
        ids = list(self.manifest.options["core_indicators"])[:limit]
        series = tuple(
            SeriesMeta(
                indicator_id=i,
                title=TITLES.get(i, i),
                description=f"UIS indicator {i}",
                unit=None,  # from the response's indicatorMetadata when present (see normalize)
                freq="A",
            )
            for i in ids
        )
        yield DatasetMeta(
            source_id=self.manifest.id,
            dataset_id=DATASET,
            title="UIS education and literacy indicators",
            licence=self.manifest.licence,
            source_url="https://uis.unesco.org/",
            freq="A",
            series=series,
        )

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        """One request per indicator and country. req.geos is required (ISO3)."""
        if not req.geos:
            raise ValueError("unesco_uis needs a country: pass geo=<ISO3>")
        indicators = req.indicator_ids or tuple(self.manifest.options["core_indicators"])
        first = req.start.year if req.start else FIRST_YEAR
        last = req.end.year if req.end else date.today().year
        url = f"{self.manifest.endpoint}/data/indicators"
        for geo in req.geos:
            iso3 = geo.removeprefix("region:")
            for ind in indicators:
                params = {"indicator": ind, "geoUnit": iso3, "start": first, "end": last}
                resp = http.get(url, params=params)
                yield RawChunk(
                    source_id=self.manifest.id,
                    dataset_id=req.dataset_id,
                    content=resp.content,
                    media_type="application/json",
                    url=url,
                    params={k: str(v) for k, v in params.items()},
                    retrieved_at=datetime.now(UTC),
                    meta={"indicator": ind, "geo": iso3},
                )

    def normalize(self, chunk: RawChunk) -> pa.Table:
        body = json.loads(chunk.content)
        vintage = chunk.retrieved_at.date()
        cols: dict[str, list] = {f.name: [] for f in OBS_SCHEMA}
        units = {  # unit text per indicator, when the response names one; otherwise left empty
            m.get("indicatorId"): m.get("unit") or m.get("unitMeasure")
            for m in body.get("indicatorMetadata") or []
            if isinstance(m, dict)
        }
        for r in body.get("records") or []:
            if r.get("value") is None:
                continue
            ind = r["indicatorId"]
            geo = to_geo(r["geoUnit"], "iso3", self.geo_map)
            start, end, freq = parse_period(str(r["year"]))
            cols["series_id"].append(make_series_id(chunk.source_id, chunk.dataset_id, ind, geo))
            cols["source_id"].append(chunk.source_id)
            cols["dataset_id"].append(chunk.dataset_id)
            cols["indicator_id"].append(ind)
            cols["geo"].append(geo)
            cols["period_start"].append(start)
            cols["period_end"].append(end)
            cols["freq"].append(freq)
            cols["value"].append(float(f"{float(r['value']):.6g}"))  # drop float32 artefacts
            cols["unit"].append(units.get(ind) or None)
            cols["unit_mult"].append(0)
            cols["dims"].append({})
            cols["obs_status"].append(None)
            cols["retrieved_at"].append(chunk.retrieved_at)
            cols["vintage"].append(vintage)
        return pa.table(cols, schema=OBS_SCHEMA)
