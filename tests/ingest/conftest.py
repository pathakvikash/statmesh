import json
import time
from datetime import UTC, datetime
from types import SimpleNamespace

import httpx
import pyarrow as pa
import pytest

from statmesh.core.catalog import Catalog
from statmesh.core.geo import to_geo
from statmesh.core.http import HttpClient
from statmesh.core.models import (
    DatasetMeta,
    FetchRequest,
    Manifest,
    RawChunk,
    SeriesMeta,
    make_series_id,
)  # fmt: skip
from statmesh.core.periods import parse_period
from statmesh.core.schema import OBS_SCHEMA
from statmesh.settings import Settings

LIC = {"name": "CC BY", "url": "u", "redistribute": "yes", "attribution": "Fake"}
T0 = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)  # a Thursday


class FakeConnector:
    """One HTTP GET per fetch (so rate limits and budgets are exercised); rows come from the
    mock server: [[geo, period, value], ...]."""

    def __init__(self, **manifest):
        self.manifest = Manifest.model_validate(
            {"id": "fake", "name": "Fake", "kind": "custom", "licence": LIC,
             "core_datasets": ["D"], "refresh": {"schedule": "0 2 * * 1"}, **manifest}
        )  # fmt: skip
        self.requests: list[FetchRequest] = []
        self.chunks = 1
        self.broken_normalize = False

    def discover(self, http, limit=None):
        yield DatasetMeta("fake", "D", "Dataset D", self.manifest.licence,
                          series=(SeriesMeta("X", "X title"),))  # fmt: skip

    def fetch(self, req, http):
        self.requests.append(req)
        for _ in range(self.chunks):
            resp = http.get("https://fake.test/data")
            yield RawChunk("fake", req.dataset_id, resp.content, "application/json",
                           "https://fake.test/data", {}, T0)  # fmt: skip

    def normalize(self, chunk):
        if self.broken_normalize:
            raise ValueError("bad payload")
        cols = {f.name: [] for f in OBS_SCHEMA}
        for geo, period, value in json.loads(chunk.content)["rows"]:
            geo = to_geo(geo, "iso3")
            start, end, freq = parse_period(period)
            row = {
                "series_id": make_series_id("fake", chunk.dataset_id, "X", geo),
                "source_id": "fake", "dataset_id": chunk.dataset_id, "indicator_id": "X",
                "geo": geo, "period_start": start, "period_end": end, "freq": freq,
                "value": value, "unit": "u", "unit_mult": 0, "dims": {}, "obs_status": None,
                "retrieved_at": chunk.retrieved_at, "vintage": None,
            }  # fmt: skip
            for k, v in row.items():
                cols[k].append(v)
        return pa.table(cols, schema=OBS_SCHEMA)


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(time, "sleep", lambda s: None)


@pytest.fixture
def env(tmp_path):
    """settings, catalog, fake connector and an http client wired to a scriptable mock server."""
    settings = Settings(data_dir=tmp_path / "data")
    catalog = Catalog(tmp_path / "data" / "catalog.sqlite")
    e = SimpleNamespace(settings=settings, catalog=catalog, calls=0, rows=[], status=200)

    def handler(req):
        e.calls += 1
        if e.status == 429:
            return httpx.Response(429, headers={"Retry-After": "120"})
        return httpx.Response(200, json={"rows": e.rows})

    def build(**manifest):
        e.conn = FakeConnector(**manifest)
        e.http = HttpClient(
            e.conn.manifest, settings, catalog, transport=httpx.MockTransport(handler)
        )
        return e

    e.build = build
    build()
    yield e
    catalog.close()
