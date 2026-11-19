"""US Census Bureau Data API: ACS 5-year and population estimates -> observations.

Quirks: responses are a JSON array of arrays (header row first, geography id columns last);
every value is a string; ACS uses large negative sentinels (-666666666 ...) for "no estimate";
a bad or unactivated key returns an HTML "Invalid Key" page (HTTP 200 after a 302), not JSON;
`pep/population` is wired for vintages 2019 (variable POP + DATE_CODE) and 2021 (variable POP_2021,
synthetic fixture, not live-verified); 2023+ is `pep/charv`, deferred (use ACS B01003_001E).
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from datetime import UTC, date, datetime
from pathlib import Path

import pyarrow as pa

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

# state FIPS -> USPS code (ISO 3166-2 is US-<USPS>)
FIPS = dict(
    re.findall(
        r"(\d\d)([A-Z]{2})",
        "01AL02AK04AZ05AR06CA08CO09CT10DE11DC12FL13GA15HI16ID17IL18IN19IA20KS21KY22LA23ME24MD25MA"
        "26MI27MN28MS29MO30MT31NE32NV33NH34NJ35NM36NY37NC38ND39OH40OK41OR42PA44RI45SC46SD47TN48TX"
        "49UT50VT51VA53WA54WV55WI56WY72PR",
    )
)
_FIPS_OF = {f"US-{p}": f for f, p in FIPS.items()}


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        geos = ("USA", *_FIPS_OF)
        for did, ds in self.manifest.datasets.items():
            series = tuple(
                SeriesMeta(i, v["title"], unit=v["unit"], freq=ds["freq"], geos=geos)
                for i, v in ds["indicators"].items()
            )
            yield DatasetMeta(
                self.manifest.id,
                did,
                ds["title"],
                self.manifest.licence,
                source_url="https://www.census.gov/data/developers/data-sets.html",
                freq=ds["freq"],
                series=series,
            )

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        ds = self.manifest.datasets[req.dataset_id]
        year = req.filters.get("year") or str(ds["default_year"])  # ACS end year / PEP vintage
        if req.dataset_id == "popest" and int(year) not in ds["vintages"]:
            raise ValueError(f"census popest: vintage {year} not supported ({ds['vintages']})")
        var = ds.get("vintage_var", {}).get(str(year))  # e.g. POP_2021: no DATE_CODE
        if var:
            get = ["NAME", var]
        else:
            get = ["NAME", *(req.indicator_ids or ds["indicators"]), *ds.get("extra", [])]
        fors = []
        if not req.geos or "USA" in req.geos:
            fors.append("us:1")
        if states := [_FIPS_OF[g] for g in req.geos if g in _FIPS_OF] or (
            [] if req.geos else ["*"]
        ):
            fors.append("state:" + ",".join(states))
        for f in fors:
            params = {"get": ",".join(get), "for": f}
            r = http.get(
                f"{self.manifest.endpoint}/{ds['path'].format(year=year)}",
                params={**params, "key": http.key},
            )
            json.loads(r.content)  # fail at fetch, not normalize, on an HTML error page
            yield RawChunk(
                source_id=self.manifest.id,
                dataset_id=req.dataset_id,
                content=r.content,
                media_type="application/json",
                url=str(r.request.url.copy_with(query=None)),
                params={**params, "key": "REDACTED"},
                retrieved_at=datetime.now(UTC),
                meta={"year": year},
            )

    def normalize(self, chunk: RawChunk) -> pa.Table:
        ds = self.manifest.datasets[chunk.dataset_id]
        year = int(chunk.meta["year"])
        head, *body = json.loads(chunk.content)
        cols = {f.name: [] for f in OBS_SCHEMA}
        for row in body:
            d = dict(zip(head, row, strict=True))
            geo = (
                "USA"
                if "us" in d
                else (f"US-{FIPS[d['state']]}" if d["state"] in FIPS else f"unmapped:{d['state']}")
            )
            var = ds.get("vintage_var", {}).get(str(year))
            if chunk.dataset_id == "acs5":
                start, end, dims = date(year - 4, 1, 1), date(year, 12, 31), {"window": "5y"}
            elif var:  # POP_<year> = 1 July <year>
                start = end = date(int(var.rsplit("_", 1)[1]), 7, 1)
                dims = {}
            else:  # DATE_CODE 3..12 = 1 July 2010..2019; 1-2 are the April 2010 base
                y = 2007 + int(d["DATE_CODE"])
                if int(d["DATE_CODE"]) < 3:
                    continue
                start = end = date(y, 7, 1)
                dims = {}
            for ind, meta in ds["indicators"].items():
                src = var if var and ind == "POP" else ind
                if src not in d:
                    continue
                raw = None if d[src] is None else float(d[src])
                missing = raw is None or raw <= -222222222  # Census sentinels
                vals = dict(  # noqa: C408
                    series_id=make_series_id(chunk.source_id, chunk.dataset_id, ind, geo),
                    source_id=chunk.source_id,
                    dataset_id=chunk.dataset_id,
                    indicator_id=ind,
                    geo=geo,
                    period_start=start,
                    period_end=end,
                    freq="A",
                    value=None if missing else raw,
                    unit=meta["unit"],
                    unit_mult=0,
                    dims=dims,
                    obs_status="missing" if missing else None,
                    retrieved_at=chunk.retrieved_at,
                    vintage=None,
                )
                for k, col in cols.items():
                    col.append(vals[k])
        return pa.table(cols, schema=OBS_SCHEMA)
