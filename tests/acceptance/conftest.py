"""The four spec questions run offline against a catalog built from connector fixtures (recorded, or synthetic where redistribution is barred, e.g. Comtrade)."""

import asyncio

import pytest
from fastapi.testclient import TestClient
from mcp import Client

from statmesh import service
from statmesh.api.app import create_app
from statmesh.mcp_server import build_server
from statmesh.testing.fixture_catalog import build

SOURCES = ["ilostat", "imf", "comtrade", "sec_edgar", "bis"]


@pytest.fixture(scope="session")
def settings(tmp_path_factory):
    settings, errors = build(tmp_path_factory.mktemp("acceptance"), SOURCES)
    assert not errors, errors
    return settings


class Rest:
    def __init__(self, c: TestClient):
        self.c = c

    def search(self, q, **kw):
        return self.c.get("/search", params={"q": q, **kw}).json()

    def describe(self, sid):
        return self.c.get(f"/series/{sid}").json()

    def observations(self, sid, **kw):
        return self.c.get(f"/series/{sid}/observations", params=kw).json()

    def sql(self, sql):
        r = self.c.post("/query", json={"sql": sql})
        assert r.status_code == 200, r.text
        return r.json()


class Mcp:
    """What an agent does: tool calls over an in-memory MCP client."""

    def _call(self, tool, args):
        async def go():
            async with Client(build_server()) as c:
                r = await c.call_tool(tool, args)
                assert not r.is_error, r
                return r.structured_content

        return asyncio.run(go())

    def search(self, q, **kw):
        return self._call("search_series", {"q": q, **kw})

    def describe(self, sid):
        return self._call("describe_series", {"series_id": sid})

    def observations(self, sid, **kw):
        return self._call("get_observations", {"series_id": sid, **kw})

    def sql(self, sql):
        return self._call("run_sql", {"sql": sql})


@pytest.fixture(params=["rest", "mcp"])
def api(request, settings):
    service.configure(settings)
    if request.param == "mcp":
        yield Mcp()
    else:
        with TestClient(create_app(), base_url="http://localhost:8000") as c:
            yield Rest(c)
