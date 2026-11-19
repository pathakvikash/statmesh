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
        if "latest" in req.url.path:
            return httpx.Response(
                200, json={"data": {"full_file": {"csv": {"url": "https://g.test/f.zip"}}}}
            )
        raise AssertionError(f"downloaded despite robots: {req.url}")

    s = Settings.from_env()
    c = load_connector("gleif", s)
    http = HttpClient(c.manifest.model_copy(update={"rate_limit": RateLimit()}), s, None,
                      transport=httpx.MockTransport(handler))  # fmt: skip
    with pytest.raises(PermissionError, match="robots.txt"):
        list(c.fetch(FetchRequest("golden-copy"), http))
