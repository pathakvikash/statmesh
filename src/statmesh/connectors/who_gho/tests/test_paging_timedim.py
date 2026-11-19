import json
from datetime import UTC, datetime

import httpx

from statmesh.core.connector import load_connector
from statmesh.core.http import HttpClient
from statmesh.core.models import FetchRequest, RateLimit, RawChunk
from statmesh.settings import Settings


def _row(t, y):
    return {"IndicatorCode": "X", "SpatialDim": "IND", "TimeDimType": t, "TimeDim": y,
            "NumericValue": 1.0}  # fmt: skip


def test_multi_year_ranges_dropped():
    c = load_connector("who_gho", Settings.from_env())
    body = {"value": [_row("YEAR", 2019), _row("YEARSPAN", 2015), _row(None, 2016)]}
    chunk = RawChunk("who_gho", "gho", json.dumps(body).encode(), "application/json", "u", {},
                     datetime(2026, 1, 1, tzinfo=UTC), meta={"indicator": "X"})  # fmt: skip
    assert c.normalize(chunk)["period_start"].to_pylist()[0].year == 2019
    assert c.normalize(chunk).num_rows == 1


def test_select_has_timedimtype_and_nextlink_followed():
    seen = []

    def handler(req):
        seen.append(req)
        if "page2" in str(req.url):
            return httpx.Response(200, json={"value": [_row("YEAR", 2020)]})
        return httpx.Response(200, json={
            "value": [_row("YEAR", 2019)], "@odata.nextLink": "https://x.test/api/X?page2=1"})  # fmt: skip

    s = Settings.from_env()
    c = load_connector("who_gho", s)
    m = c.manifest.model_copy(update={"rate_limit": RateLimit()})
    h = HttpClient(m, s, None, transport=httpx.MockTransport(handler))
    chunks = list(c.fetch(FetchRequest("gho", indicator_ids=("X",)), h))
    assert len(chunks) == 2 and "TimeDimType" in seen[0].url.params["$select"]
    assert sum(c.normalize(ch).num_rows for ch in chunks) == 2
