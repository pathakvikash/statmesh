"""Tiny reference connector used to test the contract suite: two requests, JSON in, rows out."""

from __future__ import annotations

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


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        body = http.get(f"{self.manifest.endpoint}/datasets", params={"api_key": http.key}).json()
        for d in body["datasets"][:limit]:
            yield DatasetMeta(
                source_id=self.manifest.id,
                dataset_id=d["id"],
                title=d["title"],
                licence=self.manifest.licence,
                series=tuple(
                    SeriesMeta(i["id"], i["title"], unit=i["unit"], freq=i["freq"])
                    for i in d["indicators"]
                ),
            )

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        params = {"dataset": req.dataset_id, "indicator": ",".join(req.indicator_ids)}
        resp = http.get(f"{self.manifest.endpoint}/data", params={**params, "api_key": http.key})
        yield RawChunk(
            source_id=self.manifest.id,
            dataset_id=req.dataset_id,
            content=resp.content,
            media_type="application/json",
            url=f"{self.manifest.endpoint}/data",
            params={**params, "api_key": "REDACTED"},
            retrieved_at=datetime(2026, 11, 19, 12, 0, tzinfo=UTC),
            meta={"indicator": req.indicator_ids[0]},
        )

    def normalize(self, chunk: RawChunk) -> pa.Table:
        import json

        rows = json.loads(chunk.content)["rows"]
        ind = chunk.meta["indicator"]
        cols: dict[str, list] = {f.name: [] for f in OBS_SCHEMA}
        for r in rows:
            geo = to_geo(r["geo"], "iso3")
            start, end, freq = parse_period(r["period"])
            cols["series_id"].append(make_series_id(chunk.source_id, chunk.dataset_id, ind, geo))
            cols["source_id"].append(chunk.source_id)
            cols["dataset_id"].append(chunk.dataset_id)
            cols["indicator_id"].append(ind)
            cols["geo"].append(geo)
            cols["period_start"].append(start)
            cols["period_end"].append(end)
            cols["freq"].append(freq)
            cols["value"].append(r["value"])
            cols["unit"].append("percent")
            cols["unit_mult"].append(0)
            cols["dims"].append({})
            cols["obs_status"].append(None)
            cols["retrieved_at"].append(chunk.retrieved_at)
            cols["vintage"].append(None)
        return pa.table(cols, schema=OBS_SCHEMA)
