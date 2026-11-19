"""WHO Global Health Observatory OData API (ghoapi.azureedge.net/api) -> observations.

Quirks: `Indicator` lists ~3,100 indicators (code + name only; no unit); each indicator is its own
OData entity set (`/WHOSIS_000001`) with SpatialDim (ISO3 for COUNTRY), TimeDim (year) and up to
three breakdown dims (Dim1Type/Dim1 ... e.g. SEX=SEX_BTSX) that become `dims`; NumericValue is null
when the published Value is text. Only COUNTRY rows with TimeDimType YEAR are kept. The legacy
host has no key and no documented limit; WHO announced a replacement "Data Hub" OData API, not live.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from datetime import UTC, date, datetime
from pathlib import Path

import pyarrow as pa

from statmesh.core.geo import to_geo
from statmesh.core.http import HttpClient
from statmesh.core.models import (
    DatasetMeta,
    FetchRequest,
    Manifest,
    RawChunk,
    SeriesMeta,
    make_series_id,
)
from statmesh.core.schema import OBS_SCHEMA

DATASET = "gho"
_SELECT = "IndicatorCode,SpatialDim,TimeDimType,TimeDim,Dim1Type,Dim1,Dim2Type,Dim2,Dim3Type,Dim3,NumericValue"


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        ds = self.manifest.datasets[DATASET]
        params = {"$top": limit} if limit else None
        rows = json.loads(http.get(f"{self.manifest.endpoint}/Indicator", params=params).content)
        series = tuple(
            SeriesMeta(r["IndicatorCode"], r["IndicatorName"].strip(), freq="A")
            for r in rows["value"]
        )
        yield DatasetMeta(
            self.manifest.id,
            DATASET,
            ds["title"],
            self.manifest.licence,
            source_url="https://www.who.int/data/gho",
            freq="A",
            series=series,
        )

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        for ind in req.indicator_ids:
            flt = "SpatialDimType eq 'COUNTRY'"
            if req.geos:
                flt += " and (" + " or ".join(f"SpatialDim eq '{g}'" for g in req.geos) + ")"
            if req.start:
                flt += f" and TimeDim ge {req.start.year}"
            if req.end:
                flt += f" and TimeDim le {req.end.year}"
            params = {"$filter": flt, "$select": _SELECT}
            url: str | None = f"{self.manifest.endpoint}/{ind}"
            while url:  # follow @odata.nextLink (a full URL with its query) until exhausted
                r = http.get(url, params=params)
                yield RawChunk(
                    source_id=self.manifest.id,
                    dataset_id=DATASET,
                    content=r.content,
                    media_type="application/json",
                    url=str(r.request.url.copy_with(query=None)),
                    params=params,
                    retrieved_at=datetime.now(UTC),
                    meta={"indicator": ind},
                )
                url, params = r.json().get("@odata.nextLink"), None

    def normalize(self, chunk: RawChunk) -> pa.Table:
        cols = {f.name: [] for f in OBS_SCHEMA}
        for r in json.loads(chunk.content)["value"]:
            if r.get("TimeDim") is None or r.get("TimeDimType") != "YEAR":
                continue  # multi-year ranges ("2015-2019") are not annual observations
            ind = r["IndicatorCode"].replace(":", "_")
            geo = to_geo(r["SpatialDim"], "iso3")
            y = int(r["TimeDim"])
            dims = {
                r[f"Dim{i}Type"].lower(): r[f"Dim{i}"]
                for i in (1, 2, 3)
                if r.get(f"Dim{i}Type") and r.get(f"Dim{i}")
            }
            v = r["NumericValue"]
            vals = dict(  # noqa: C408
                series_id=make_series_id(chunk.source_id, DATASET, ind, geo),
                source_id=chunk.source_id,
                dataset_id=DATASET,
                indicator_id=ind,
                geo=geo,
                period_start=date(y, 1, 1),
                period_end=date(y, 12, 31),
                freq="A",
                value=v,
                unit=None,
                unit_mult=0,
                dims=dict(sorted(dims.items())),
                obs_status=None if v is not None else "no numeric value",
                retrieved_at=chunk.retrieved_at,
                vintage=None,
            )
            for k, col in cols.items():
                col.append(vals[k])
        return pa.table(cols, schema=OBS_SCHEMA)
