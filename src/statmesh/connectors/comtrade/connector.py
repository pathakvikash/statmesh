"""UN Comtrade goods trade, annual, HS classification. Keyed endpoint when COMTRADE_API_KEY is set,
else the public preview (500 records per call, no key). Everything is on-demand.

Filters: geos = reporter ISO3s (required); filters["partner"] = ISO3 list or "World" (default),
filters["hs"] = "AG2" (default; also AG4, AG6, TOTAL) or explicit codes "85,27";
indicator_ids = flows X (exports) / M (imports), default both; start/end = years (default last
full year). One API call per year.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, date, datetime
from pathlib import Path

import pyarrow as pa
import pycountry

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

FLOWS = {"X": "Exports", "M": "Imports"}


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory
        self.geo_map = load_geo_map(directory)
        self._code = {g: c for c, g in self.geo_map.items()}  # ISO3 -> Comtrade numeric

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        series = tuple(
            SeriesMeta(f, f"{name} of goods by HS commodity", unit="USD", freq="A")
            for f, name in FLOWS.items()
        )
        yield DatasetMeta(
            source_id=self.manifest.id,
            dataset_id="HS-A",
            title="UN Comtrade annual goods trade (HS)",
            description="Exports and imports by reporter, partner and HS commodity, current USD.",
            licence=self.manifest.licence,
            source_url="https://comtradeplus.un.org",
            freq="A",
            series=series,
        )

    def _numeric(self, geo: str) -> str:
        if geo.upper() in ("WLD", "WORLD"):
            return "0"
        if geo in self._code:
            return self._code[geo]
        c = pycountry.countries.get(alpha_3=geo.upper())
        if c is None:
            raise ValueError(f"unknown country {geo!r}")
        return str(int(c.numeric))

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        if not req.geos:
            raise ValueError("comtrade needs a reporter in geos")
        f = req.filters
        end = req.end.year if req.end else (req.start.year if req.start else date.today().year - 1)
        start = req.start.year if req.start else end
        params = {
            "reporterCode": ",".join(self._numeric(g) for g in req.geos),
            "partnerCode": ",".join(self._numeric(g) for g in f.get("partner", "World").split(",")),
            "cmdCode": f.get("hs", "AG2"),
            "flowCode": ",".join(req.indicator_ids) or "X,M",
            # pin the dimensions we do not model so rows are not double counted: all transport
            # modes, all customs procedures, no second partner
            "motCode": "0",
            "customsCode": "C00",
            "partner2Code": "0",
        }
        keyed = bool(http.key)
        url = f"{self.manifest.endpoint}/{'data' if keyed else 'public'}/v1/"
        url += f"{'get' if keyed else 'preview'}/C/A/HS"
        for year in range(start, end + 1):
            resp = http.get(
                url,
                params={**params, "period": str(year)},
                headers={"Ocp-Apim-Subscription-Key": http.key} if keyed else None,
            )
            body = resp.json()
            if body.get("error"):
                raise ValueError(f"comtrade: {body['error']}")
            if body.get("count", 0) > len(body.get("data", [])):
                raise ValueError(
                    f"comtrade returned {len(body['data'])} of {body['count']} records "
                    "(preview cap 500); narrow reporters, partners or flows"
                )
            yield RawChunk(
                source_id=self.manifest.id,
                dataset_id=req.dataset_id,
                content=resp.content,
                media_type="application/json",
                url=url,
                params={**params, "period": str(year)},  # key travels in a header, never a param
                retrieved_at=datetime.now(UTC),
            )

    def normalize(self, chunk: RawChunk) -> pa.Table:
        import json

        cols: dict[str, list] = {f.name: [] for f in OBS_SCHEMA}
        for r in json.loads(chunk.content)["data"]:
            geo = to_geo(r["reporterCode"], "m49", self.geo_map)
            start, end, freq = parse_period(str(r["period"]))
            cmd = str(r["cmdCode"])
            partner = r["partnerCode"]
            cols["series_id"].append(
                make_series_id(chunk.source_id, chunk.dataset_id, r["flowCode"], geo)
            )
            cols["source_id"].append(chunk.source_id)
            cols["dataset_id"].append(chunk.dataset_id)
            cols["indicator_id"].append(r["flowCode"])
            cols["geo"].append(geo)
            cols["period_start"].append(start)
            cols["period_end"].append(end)
            cols["freq"].append(freq)
            cols["value"].append(r["primaryValue"])
            cols["unit"].append("USD")
            cols["unit_mult"].append(0)
            cols["dims"].append(
                {
                    "flow": r["flowCode"],
                    "hs": cmd,
                    "hs_level": "0" if cmd == "TOTAL" else str(len(cmd)),
                    "partner": to_geo(partner, "m49", self.geo_map),  # 0 -> region:WLD (geo_map)
                }
            )
            cols["obs_status"].append(None)
            cols["retrieved_at"].append(chunk.retrieved_at)
            cols["vintage"].append(None)
        return pa.table(cols, schema=OBS_SCHEMA)
