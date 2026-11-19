"""BEA API: NIPA tables and Regional (state) tables -> observations.

Quirks: errors come back as HTTP 200 with BEAAPI.Results.Error (or BEAAPI.Error); DataValue is a
string with thousands commas and "(NA)"/"(D)" for missing; UNIT_MULT is a power of ten; the key
param is `UserID`; NIPA indicator ids are <table>_<SeriesCode>, Regional ids are the row `Code`.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path

import pyarrow as pa
import pycountry

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

_SCALE_WORD = re.compile(r"\b(thousands|millions|billions|trillions)\b", re.IGNORECASE)
_STATE = {s.name: s.code for s in pycountry.subdivisions.get(country_code="US")}


def _rows(doc: dict) -> list[dict]:
    b = doc["BEAAPI"]
    if err := b.get("Error") or b.get("Results", {}).get("Error"):
        raise ValueError(f"BEA error {err.get('APIErrorCode')}: {err.get('APIErrorDescription')}")
    return b["Results"]["Data"]


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        for did, ds in self.manifest.datasets.items():
            series = tuple(
                SeriesMeta(i, v["title"], unit=v["unit"], freq=v["freq"], geos=("USA",))
                for i, v in ds["series"].items()
            )
            yield DatasetMeta(
                self.manifest.id,
                did,
                ds["title"],
                self.manifest.licence,
                source_url="https://apps.bea.gov/API/signup/",
                series=series,
            )

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        ds, f = self.manifest.datasets[req.dataset_id], req.filters
        # ponytail: regional always asks for all states (GeoFips=STATE); req.geos is not applied
        years = (
            ",".join(str(y) for y in range(req.start.year, (req.end or req.start).year + 1))
            if req.start
            else f.get("year", "ALL")
        )
        params = {
            "method": "GetData",
            "datasetname": req.dataset_id.upper() if req.dataset_id == "nipa" else "Regional",
            "TableName": f.get("table", ds["table"]),
            "Year": years,
            "ResultFormat": "JSON",
        }
        if req.dataset_id == "nipa":
            params["Frequency"] = f.get("frequency", ds["frequency"])
        else:
            params |= {"GeoFips": "STATE", "LineCode": f.get("line_code", ds["line_code"])}
        r = http.get(self.manifest.endpoint, params={**params, "UserID": http.key})
        _rows(r.json())  # surface API errors at fetch
        yield RawChunk(
            source_id=self.manifest.id,
            dataset_id=req.dataset_id,
            content=r.content,
            media_type="application/json",
            url=self.manifest.endpoint,
            params={**params, "UserID": "REDACTED"},
            retrieved_at=datetime.now(UTC),
        )

    def normalize(self, chunk: RawChunk) -> pa.Table:
        cols = {f.name: [] for f in OBS_SCHEMA}
        for d in _rows(json.loads(chunk.content)):
            if chunk.dataset_id == "nipa":
                ind, geo = f"{d['TableName']}_{d['SeriesCode']}", "USA"
            else:
                ind = d["Code"]
                geo = (
                    "USA"
                    if d["GeoFips"] == "00000"
                    else (_STATE.get(d["GeoName"]) or f"unmapped:{d['GeoFips']}")
                )
            start, end, freq = parse_period(d["TimePeriod"])
            raw = d["DataValue"].replace(",", "")
            value = float(raw) if re.fullmatch(r"-?\d+(\.\d+)?", raw) else None
            vals = dict(  # noqa: C408
                series_id=make_series_id(chunk.source_id, chunk.dataset_id, ind, geo),
                source_id=chunk.source_id,
                dataset_id=chunk.dataset_id,
                indicator_id=ind,
                geo=geo,
                period_start=start,
                period_end=end,
                freq=freq,
                value=value,
                unit=d.get("CL_UNIT"),
                # a CL_UNIT that names the scale ("Millions of ... dollars") already carries
                # UNIT_MULT; NIPA's bare "Level" does not, so its UNIT_MULT stays (core/schema.py)
                unit_mult=0
                if _SCALE_WORD.search(d.get("CL_UNIT") or "")
                else int(d.get("UNIT_MULT") or 0),
                dims={},
                obs_status=None if value is not None else "missing",
                retrieved_at=chunk.retrieved_at,
                vintage=None,
            )
            for k, col in cols.items():
                col.append(vals[k])
        return pa.table(cols, schema=OBS_SCHEMA)
