"""EIA API v2: crude oil spot price and electricity generation -> observations.

Quirks: one route per dataset, configured in the manifest; `response.total` and every value are
strings; max 5000 rows per call so we page with offset (sorted by period so pages are stable);
null values appear for missing periods; facet params are `facets[<name>][]`, repeated; the
`period` format follows the frequency (YYYY-MM-DD daily, YYYY-MM monthly).
"""

from __future__ import annotations

import json
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

_US = {s.code for s in pycountry.subdivisions.get(country_code="US")}
_PAGE = 5000


def _geo(code: str) -> str:
    return "USA" if code == "US" else (f"US-{code}" if f"US-{code}" in _US else f"unmapped:{code}")


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
                source_url=f"https://www.eia.gov/opendata/browser/{ds['route']}",
                series=series,
            )

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        ds = self.manifest.datasets[req.dataset_id]
        facets = dict(ds["facets"])
        if req.indicator_ids:
            facets[ds["indicator"]] = [
                i.removeprefix(ds.get("indicator_prefix", "")) for i in req.indicator_ids
            ]
        if req.geos and "geo_field" in ds:  # single-geo datasets (crude oil) ignore geos
            facets[ds["geo_field"]] = [
                "US" if g == "USA" else g.removeprefix("US-") for g in req.geos
            ]
        n = min(_PAGE, req.max_rows or _PAGE)
        params = {
            "frequency": ds["frequency"],
            "data[0]": ds["value"],
            "sort[0][column]": "period",
            "sort[0][direction]": "asc",
            "length": str(n),
            **{f"facets[{k}][]": list(v) for k, v in facets.items()},
        }
        cut = 7 if ds["frequency"] == "monthly" else 10
        for k, d in (("start", req.start), ("end", req.end)):
            if d:
                params[k] = d.isoformat()[:cut]
        offset = 0
        while True:
            q = {**params, "offset": str(offset)}
            r = http.get(
                f"{self.manifest.endpoint}/{ds['route']}/data/", params={**q, "api_key": http.key}
            )
            yield RawChunk(
                source_id=self.manifest.id,
                dataset_id=req.dataset_id,
                content=r.content,
                media_type="application/json",
                url=f"{self.manifest.endpoint}/{ds['route']}/data/",
                params={
                    **{k: ",".join(v) if isinstance(v, list) else str(v) for k, v in q.items()},
                    "api_key": "REDACTED",
                },
                retrieved_at=datetime.now(UTC),
            )
            offset += n
            if offset >= int(r.json()["response"]["total"]) or (
                req.max_rows and offset >= req.max_rows
            ):
                break

    def normalize(self, chunk: RawChunk) -> pa.Table:
        ds = self.manifest.datasets[chunk.dataset_id]
        cols = {f.name: [] for f in OBS_SCHEMA}
        for d in json.loads(chunk.content)["response"]["data"]:
            ind = ds.get("indicator_prefix", "") + str(d[ds["indicator"]]).replace(":", "_")
            geo = _geo(d[ds["geo_field"]]) if "geo_field" in ds else ds["geo"]
            start, end, freq = parse_period(d["period"])
            value = None if d[ds["value"]] is None else float(d[ds["value"]])
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
                unit=d.get(ds["unit_field"]),
                unit_mult=0,
                dims={k: str(d[f]) for k, f in sorted(ds.get("dims", {}).items())},
                obs_status=None if value is not None else "missing",
                retrieved_at=chunk.retrieved_at,
                vintage=None,
            )
            for k, col in cols.items():
                col.append(vals[k])
        return pa.table(cols, schema=OBS_SCHEMA)
