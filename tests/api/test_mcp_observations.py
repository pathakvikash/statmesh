"""MCP get_observations: compact shape, default row cap that keeps the latest periods."""

import asyncio

from mcp import Client

from statmesh import mcp_server
from statmesh.mcp_server import build_server

from ..query.test_paging_and_partial import data  # noqa: F401


def call(**args):
    async def go():
        async with Client(build_server()) as c:
            return (
                await c.call_tool("get_observations", {"series_id": "open:D:U1", **args})
            ).structured_content

    return asyncio.run(go())


def test_compact_default(data):  # noqa: F811
    o = call()
    assert o["columns"] == ["geo", "period_start", "value"] and len(o["rows"]) == 6
    assert o["rows"][0][:2] == ["IND", "2020-01-01"]
    assert o["constants"]["source_id"] == "open" and o["constants"]["unit"] == "pct"
    assert o["constants"]["freq"] == "A" and "dims" not in o["constants"]
    assert o["citations"] and o["series_id"] == "open:D:U1" and o["omitted_rows"] == 0


def test_not_compact_is_the_full_shape(data):  # noqa: F811
    o = call(compact=False)
    assert len(o["columns"]) == 15 and len(o["rows"][0]) == 15 and "constants" not in o


def test_default_cap_keeps_latest_rows_per_geo_and_says_so(data, monkeypatch):  # noqa: F811
    monkeypatch.setattr(mcp_server, "DEFAULT_ROWS", 4)
    o = call()
    assert o["omitted_rows"] == 2 and "latest 2 per geo" in o["warning"]
    assert {r[1] for r in o["rows"]} == {"2021-01-01", "2022-01-01"}
    assert {r[0] for r in o["rows"]} == {"IND", "USA"} and not o["truncated"]
    assert o["next_offset"] is None
    assert len(call(limit=5)["rows"]) == 5  # explicit limit is honoured: the first rows
    o = call(limit=5)
    assert o["omitted_rows"] == 0 and o["truncated"] and o["next_offset"] == 5


def test_offset_needs_limit(data):  # noqa: F811
    async def go():
        async with Client(build_server()) as c:
            return await c.call_tool("get_observations", {"series_id": "open:D:U1", "offset": 2})

    assert asyncio.run(go()).is_error
