"""Google Data Commons REST v2 (api.datacommons.org/v2/observation) -> observations.

Quirks: the key goes in the X-API-Key header; the response is byVariable -> variable -> byEntity ->
entity -> orderedFacets[] (best source first) with a top-level `facets` map (importName,
provenanceUrl, unit ...); only the first facet per variable+place is kept; its provenance is not
stored in dims (identity only, it changes as the best facet changes) but stays in the raw payload. Places are DCIDs: country/XXX (ISO3), geoId/NN (US state FIPS -> US-XX),
Earth (WLD); anything else is `unmapped:<dcid>`. Dates are "2023", "2023-05" or "2023-05-01".
Variable DCIDs are used as indicator ids ("/" is allowed, ":" becomes "_").
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from datetime import UTC, datetime
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
from statmesh.core.periods import parse_period
from statmesh.core.schema import OBS_SCHEMA

_FIPS = dict(
    re.findall(
        r"(\d\d)([A-Z]{2})",
        "01AL02AK04AZ05AR06CA08CO09CT10DE11DC12FL13GA15HI16ID17IL18IN19IA20KS21KY22LA23ME24MD25MA"
        "26MI27MN28MS29MO30MT31NE32NV33NH34NJ35NM36NY37NC38ND39OH40OK41OR42PA44RI45SC46SD47TN48TX"
        "49UT50VT51VA53WA54WV55WI56WY72PR",
    )
)
_FIPS_OF = {f"US-{p}": f for f, p in _FIPS.items()}


def dcid_to_geo(dcid: str) -> str:
    if dcid == "Earth":
        return "region:WLD"
    if dcid.startswith("country/"):
        g = to_geo(dcid[8:], "iso3")
        return g if not g.startswith("unmapped:") else f"unmapped:{dcid}"
    if m := re.fullmatch(r"geoId/(\d\d)", dcid):
        return f"US-{_FIPS[m[1]]}" if m[1] in _FIPS else f"unmapped:{dcid}"
    return f"unmapped:{dcid}"


def geo_to_dcid(geo: str) -> str:
    if geo == "WLD":
        return "Earth"
    if geo in _FIPS_OF:
        return f"geoId/{_FIPS_OF[geo]}"
    return f"country/{geo}"


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        for did, ds in self.manifest.datasets.items():
            series = tuple(
                SeriesMeta(i.replace(":", "_"), v["title"], unit=v["unit"], freq=ds["freq"])
                for i, v in ds["indicators"].items()
            )
            yield DatasetMeta(
                self.manifest.id,
                did,
                ds["title"],
                self.manifest.licence,
                source_url="https://datacommons.org/tools/statvar",
                freq=ds["freq"],
                series=series,
            )

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        ds = self.manifest.datasets[req.dataset_id]
        variables = list(req.indicator_ids or ds["indicators"])
        params = {
            "variable.dcids": variables,
            "entity.dcids": [geo_to_dcid(g) for g in req.geos] or ["Earth"],
            "date": req.filters.get("date", ""),  # "" = all dates, "LATEST", or "2020"
            "select": ["date", "value", "facet"],
        }
        r = http.get(
            f"{self.manifest.endpoint}/observation",
            params=params,
            headers={"X-API-Key": http.key or ""},
        )
        json.loads(r.content)
        yield RawChunk(
            source_id=self.manifest.id,
            dataset_id=req.dataset_id,
            content=r.content,
            media_type="application/json",
            url=str(r.request.url.copy_with(query=None)),
            params={k: ",".join(v) if isinstance(v, list) else v for k, v in params.items()},
            retrieved_at=datetime.now(UTC),
        )

    def normalize(self, chunk: RawChunk) -> pa.Table:
        body = json.loads(chunk.content)
        facets = body.get("facets", {})
        cols = {f.name: [] for f in OBS_SCHEMA}
        for var, by in body.get("byVariable", {}).items():
            ind = var.replace(":", "_")
            for dcid, ent in by.get("byEntity", {}).items():
                if not ent.get("orderedFacets"):
                    continue
                facet = ent["orderedFacets"][0]  # best source only; others would collide on key
                meta = facets.get(facet.get("facetId"), {})
                geo = dcid_to_geo(dcid)
                for o in facet["observations"]:
                    start, end, freq = parse_period(o["date"])
                    vals = dict(  # noqa: C408
                        series_id=make_series_id(chunk.source_id, chunk.dataset_id, ind, geo),
                        source_id=chunk.source_id,
                        dataset_id=chunk.dataset_id,
                        indicator_id=ind,
                        geo=geo,
                        period_start=start,
                        period_end=end,
                        freq=freq,
                        value=o.get("value"),
                        unit=meta.get("unit"),
                        unit_mult=0,
                        # dims are identity only: the best facet (provenance) changes between
                        # refreshes and would duplicate rows; it stays in the raw payload.
                        dims={},
                        obs_status=None if o.get("value") is not None else "missing",
                        retrieved_at=chunk.retrieved_at,
                        vintage=None,
                    )
                    for k, col in cols.items():
                        col.append(vals[k])
        return pa.table(cols, schema=OBS_SCHEMA)
