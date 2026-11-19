import logging
from datetime import UTC, datetime

from statmesh.core.connector import load_connector
from statmesh.core.models import RawChunk
from statmesh.settings import Settings


def test_unmapped_resource_yields_zero_rows_and_warns(caplog):
    c = load_connector("datagovin", Settings.from_env())
    chunk = RawChunk("datagovin", "unknown-resource", b'{"records":[{"a":"1"}]}',
                     "application/json", "u", {}, datetime(2026, 1, 1, tzinfo=UTC))  # fmt: skip
    with caplog.at_level(logging.WARNING):
        assert c.normalize(chunk).num_rows == 0
    assert "no `datasets.unknown-resource` mapping" in caplog.text


def test_cap_hit_with_more_rows_sets_truncated():
    import httpx

    from statmesh.core.http import HttpClient
    from statmesh.core.models import FetchRequest, RateLimit

    def handler(req):
        p = req.url.params
        o, n = int(p["offset"]), int(p["limit"])
        return httpx.Response(
            200, json={"total": 10, "records": [{"a": i} for i in range(o, o + n)]}
        )

    s = Settings.from_env()
    c = load_connector("datagovin", s)
    m = c.manifest.model_copy(update={"rate_limit": RateLimit()})
    h = HttpClient(m, s, None, transport=httpx.MockTransport(handler))
    h.key = "k"
    chunks = list(c.fetch(FetchRequest("r", max_rows=4), h))
    assert chunks[-1].meta.get("truncated") is True
    assert not list(c.fetch(FetchRequest("r", max_rows=10), h))[-1].meta.get("truncated")
