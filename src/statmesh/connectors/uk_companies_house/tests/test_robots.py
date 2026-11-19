import httpx
import pytest

from statmesh.core.connector import load_connector
from statmesh.core.http import HttpClient
from statmesh.core.models import FetchRequest, RateLimit
from statmesh.settings import Settings


def test_bulk_refuses_when_robots_disallows():
    def handler(req):
        if req.url.path.endswith("robots.txt"):
            return httpx.Response(200, text="User-agent: *\nDisallow: /\n")
        if req.url.path.endswith(".html"):
            return httpx.Response(200, text='<a href="BasicCompanyData-2026-11-01-part1_7.zip">')
        raise AssertionError(f"downloaded despite robots: {req.url}")

    s = Settings.from_env()
    c = load_connector("uk_companies_house", s)
    http = HttpClient(c.manifest.model_copy(update={"rate_limit": RateLimit()}), s, None,
                      transport=httpx.MockTransport(handler))  # fmt: skip
    with pytest.raises(PermissionError, match="robots.txt"):
        list(c.fetch(FetchRequest("snapshot", filters={"part": "1"}), http))
