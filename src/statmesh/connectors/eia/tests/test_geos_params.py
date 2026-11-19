import httpx

from statmesh.core.connector import load_connector
from statmesh.core.http import HttpClient
from statmesh.core.models import FetchRequest, RateLimit
from statmesh.settings import Settings


def test_geos_ignored_for_crude_and_facets_recorded_as_strings():
    s = Settings.from_env()
    c = load_connector("eia", s)
    m = c.manifest.model_copy(update={"rate_limit": RateLimit()})
    t = httpx.MockTransport(
        lambda r: httpx.Response(200, json={"response": {"total": "0", "data": []}})
    )
    h = HttpClient(m, s, None, transport=t)
    h.key = "k"
    (chunk,) = c.fetch(FetchRequest("crude_oil_price", geos=("USA",), indicator_ids=("RWTC",)), h)
    assert chunk.params["facets[series][]"] == "RWTC"
    assert "facets[location][]" not in chunk.params
