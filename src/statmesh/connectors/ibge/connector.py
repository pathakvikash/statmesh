"""IBGE SIDRA values API for Brazil (no key).

Endpoint: GET /values/t/<table>/n1/all/v/<variable>/p/<years>. The first array element is a header
row (keys NC, NN, MC, MN, V, D1C, D1N, D2C, D2N, D3C, D3N); data rows carry the value in V (a
string), the unit in MN, the territory code in D1C ("1" = Brasil) and the year in D3C. Missing
values come back as "-", "..", "..." or "X" and are skipped.
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

DATASET = "population"
FIRST_YEAR = 1980
MISSING = {"-", "..", "...", "X", ""}
TITLES = {"9324": "Estimated resident population"}


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory
        self.geo_map = load_geo_map(directory)  # "1" (Brasil) -> BRA

    def _tables(self) -> list[dict]:
        return list(self.manifest.options["tables"])

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        """Static catalogue: one dataset whose series are the table variables. `limit` caps them."""
        series = tuple(
            SeriesMeta(
                indicator_id=str(t["variable"]),
                title=TITLES.get(str(t["variable"]), f"SIDRA variable {t['variable']}"),
                description=f"IBGE SIDRA table {t['table']}, variable {t['variable']}",
                unit="persons",
                freq="A",
            )
            for t in self._tables()
        )[:limit]
        yield DatasetMeta(
            source_id=self.manifest.id,
            dataset_id=DATASET,
            title="IBGE SIDRA population estimates (Brazil)",
            licence=self.manifest.licence,
            source_url="https://sidra.ibge.gov.br/",
            freq="A",
            series=series,
        )

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        """One request per table. Only Brazil (n1/all) is supported; other geos are not fetched."""
        geos = [g.removeprefix("region:") for g in req.geos] or ["BRA"]
        if any(g != "BRA" for g in geos):
            raise ValueError(f"ibge: national table only, got geos {geos}")
        first = req.start.year if req.start else FIRST_YEAR
        last = req.end.year if req.end else date.today().year
        periods = ",".join(str(y) for y in range(first, last + 1))
        for t in self._tables():
            if req.indicator_ids and str(t["variable"]) not in req.indicator_ids:
                continue
            path = f"t/{t['table']}/n1/all/v/{t['variable']}/p/{periods}"
            url = f"{self.manifest.endpoint}/{path}"
            resp = http.get(url)
            yield RawChunk(
                source_id=self.manifest.id,
                dataset_id=req.dataset_id,
                content=resp.content,
                media_type="application/json",
                url=url,
                params={},
                retrieved_at=datetime.now(UTC),
                meta={"table": t["table"], "variable": str(t["variable"])},
            )

    def normalize(self, chunk: RawChunk) -> pa.Table:
        rows = json.loads(chunk.content)[1:]  # element 0 is the header row
        vintage = chunk.retrieved_at.date()
        cols: dict[str, list] = {f.name: [] for f in OBS_SCHEMA}
        for r in rows:
            if r["V"] in MISSING:
                continue
            ind = r["D2C"]
            geo = to_geo(r["D1C"], "iso3", self.geo_map)
            start, end, freq = parse_period(r["D3C"])
            cols["series_id"].append(make_series_id(chunk.source_id, chunk.dataset_id, ind, geo))
            cols["source_id"].append(chunk.source_id)
            cols["dataset_id"].append(chunk.dataset_id)
            cols["indicator_id"].append(ind)
            cols["geo"].append(geo)
            cols["period_start"].append(start)
            cols["period_end"].append(end)
            cols["freq"].append(freq)
            cols["value"].append(float(r["V"]))
            cols["unit"].append("persons" if r["MN"] == "Pessoas" else r["MN"])
            cols["unit_mult"].append(0)
            cols["dims"].append({})
            cols["obs_status"].append(None)
            cols["retrieved_at"].append(chunk.retrieved_at)
            cols["vintage"].append(vintage)
        return pa.table(cols, schema=OBS_SCHEMA)
