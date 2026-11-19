import httpx
import pytest

from statmesh.core.connector import load_connector
from statmesh.core.http import HttpClient, RateLimited
from statmesh.core.models import FetchRequest
from statmesh.settings import Settings


def test_429_surfaces_retry_after_and_connector_does_not_loop(monkeypatch):
    monkeypatch.setattr("time.sleep", lambda s: None)
    calls = []

    def handler(req):
        calls.append(1)
        return httpx.Response(429, headers={"Retry-After": "3600"})

    c = load_connector("comtrade", Settings.from_env())
    http = HttpClient(c.manifest, Settings.from_env(), None, transport=httpx.MockTransport(handler))
    with pytest.raises(RateLimited) as e:
        list(c.fetch(FetchRequest("HS-A", geos=("IND",)), http))
    assert e.value.retry_after == 3600
    assert len(calls) <= 3  # HttpClient's own bounded attempts; the connector adds no loop
