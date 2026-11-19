import asyncio
from datetime import UTC, date, datetime

import pyarrow as pa
import pytest
from fastapi.testclient import TestClient
from mcp import Client

from statmesh import service
from statmesh.api.app import create_app
from statmesh.core.catalog import Catalog
from statmesh.core.models import DatasetMeta, Licence, Manifest, SeriesMeta
from statmesh.core.schema import OBS_SCHEMA
from statmesh.core.storage import Storage
from statmesh.mcp_server import build_server
from statmesh.settings import Settings

YES = Licence(name="CC BY", url="https://cc", redistribute="yes", attribution="Open Org")
NO = Licence(name="Closed", url="https://c", redistribute="no", attribution="Closed Org")
TS = datetime(2026, 1, 1, tzinfo=UTC)


def obs(source, geo="IND"):
    rows = [{
        "series_id": f"{source}:D:UNEMP:{geo}", "source_id": source, "dataset_id": "D",
        "indicator_id": "UNEMP", "geo": geo, "period_start": date(y, 1, 1),
        "period_end": date(y, 12, 31), "freq": "A", "value": float(y - 2019), "unit": "pct",
        "unit_mult": 0, "dims": [], "obs_status": None, "retrieved_at": TS, "vintage": None,
    } for y in (2020, 2021)]  # fmt: skip
    return pa.Table.from_pylist(rows, schema=OBS_SCHEMA)


def build(tmp_path, **kw):
    cat = Catalog(tmp_path / "catalog.sqlite")
    for sid, lic, status in (("open", YES, "ingested"), ("closed", NO, "ingested"),
                             ("remyes", YES, "remote"), ("remno", NO, "remote")):  # fmt: skip
        cat.upsert_source(Manifest(id=sid, name=sid.title(), kind="custom", licence=lic))
        cat.upsert_discovery(
            sid,
            [DatasetMeta(sid, "D", f"{sid} data", lic, source_url=f"https://{sid}.example",
                         series=(SeriesMeta("UNEMP", "Unemployment rate", freq="A", unit="pct",
                                            geos=("IND",), dims={"sex": ("M", "F")}),))],
            core=[],
        )  # fmt: skip
        cat.set_dataset_status(sid, "D", status)
    cat.close()
    st = Storage(tmp_path)
    with st.update_manifest() as m:
        for sid in ("open", "closed"):
            m["obs"][f"{sid}/D"] = st.write_parts(obs(sid), f"obs/{sid}/D", "r1")
    kw.setdefault("allowed_hosts", ("testserver", "localhost:*"))
    service.configure(Settings(data_dir=tmp_path, **kw))
    return TestClient(create_app())


@pytest.fixture
def client(tmp_path):
    with build(tmp_path) as c:
        yield c


def test_search_series_sources(client):
    r = client.get("/search", params={"q": "unemployment", "source": "open"}).json()
    assert [h["series_id"] for h in r["hits"]] == ["open:D:UNEMP"]
    s = client.get("/series/open:D:UNEMP").json()
    assert s["dims"] == {"sex": ["M", "F"]} and s["citation"]["licence_name"] == "CC BY"
    assert client.get("/series/open:D:NOPE").status_code == 404
    srcs = {x["id"]: x for x in client.get("/sources").json()}
    assert srcs["open"]["series"] == 1 and srcs["open"]["datasets"] == 1
    assert client.get("/healthz").json() == {"ok": True}


def test_observations_with_citations(client):
    r = client.get("/series/open:D:UNEMP:IND/observations", params={"start": "2021-01-01"})
    j = r.json()
    assert r.status_code == 200 and j["status"] == "ok" and len(j["rows"]) == 1
    assert j["citations"][0]["source_id"] == "open"
    assert client.get("/series/open:D:NOPE:IND/observations").status_code == 404


def test_sql_ok_and_rejected(client):
    r = client.post(
        "/query",
        json={
            "sql": "SELECT series_id, period_start, value FROM "
            "observations WHERE source_id='open' ORDER BY 2"
        },
    )
    j = r.json()
    assert r.status_code == 200 and j["rows"][0][1] == "2020-01-01" and j["citations"]
    assert client.post("/query", json={"sql": "DROP TABLE observations"}).status_code == 400
    assert client.post("/query", json={"sql": "SELECT nope FROM observations"}).status_code == 400
    assert client.post("/query", json={"sql": "SELECT 1; SELECT 2"}).status_code == 400


def test_sql_timeout_is_400(tmp_path):
    with build(tmp_path, sql_timeout_s=0.01) as c:
        sql = "SELECT count(*) FROM range(1000000000) a, range(1000000000) b"
        assert c.post("/query", json={"sql": sql}).status_code == 400


def test_remote_on_demand_and_rate_limit(tmp_path, monkeypatch):
    calls = []

    def fake(req, source_id, settings, catalog, **kw):
        calls.append((source_id, req))
        return (None, 90.0) if len(calls) == 1 else (None, None)

    monkeypatch.setattr(service, "fetch_on_demand", fake)
    with build(tmp_path) as c:
        r = c.get("/series/remyes:D:UNEMP:IND/observations")
        assert r.status_code == 429 and r.headers["Retry-After"] == "91"
        assert r.json()["status"] == "rate_limited" and r.json()["citations"]
        r = c.get("/series/remyes:D:UNEMP:IND/observations", params={"start": "2020-01-01"})
        assert r.status_code == 200 and r.json()["rows"] == []
    req = calls[1][1]
    assert (
        req.indicator_ids == ("UNEMP",) and req.geos == ("IND",) and req.start == date(2020, 1, 1)
    )


def test_hosted_mode(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "fetch_on_demand", lambda *a, **k: pytest.fail("fetched"))
    with build(tmp_path, mode="hosted") as c:
        r = c.get("/series/remno:D:UNEMP:IND/observations")
        assert r.status_code == 403 and r.json()["status"] == "forbidden"
        assert r.json()["citations"] == []
        assert c.get("/series/closed:D:UNEMP").status_code == 404
        assert {
            h["source_id"] for h in c.get("/search", params={"q": "unemployment"}).json()["hits"]
        } == {"open", "remyes"}
        assert {s["id"] for s in c.get("/sources").json()} == {"open", "remyes"}


def test_mcp_tools(tmp_path):
    with build(tmp_path):

        async def go():
            async with Client(build_server()) as c:
                names = {t.name for t in (await c.list_tools()).tools}
                r = await c.call_tool("search_series", {"q": "unemployment"})
                s = await c.call_tool("run_sql", {"sql": "SELECT source_id FROM series"})
                bad = await c.call_tool("run_sql", {"sql": "DROP TABLE series"})
                o = await c.call_tool("get_observations", {"series_id": "open:D:UNEMP:IND"})
                return names, r, s, bad, o

        names, r, s, bad, o = asyncio.run(go())
    assert names == {"search_series", "describe_series", "get_observations", "run_sql",
                     "list_sources"}  # fmt: skip
    assert r.structured_content["hits"] and s.structured_content["citations"]
    assert bad.is_error
    assert o.structured_content["citations"] and len(o.structured_content["rows"]) == 2


def test_mcp_mounted_at_http(tmp_path):
    with build(tmp_path, allowed_hosts=("testserver",)) as c:
        r = c.post(
            "/mcp",
            headers={"accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": {"name": "t", "version": "0"},
                },
            },
        )
        assert r.status_code == 200 and "statmesh" in r.text


def test_limit_bounds_are_validated(client):
    assert client.get("/search", params={"q": "x", "limit": -1}).status_code == 422
    assert client.get("/series/open:D:UNEMP/observations", params={"limit": -1}).status_code == 422
    assert (
        client.get("/series/open:D:UNEMP/observations", params={"geo": "bad!"}).status_code == 400
    )


def test_sql_timeout_is_504(tmp_path):
    with build(tmp_path, sql_timeout_s=0.05) as c:
        r = c.post(
            "/query",
            json={
                "sql": "WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM t) SELECT count(*) FROM t"
            },
        )
        assert r.status_code == 504


def test_openapi_has_response_models(client):
    s = client.get("/openapi.json").json()
    assert {"SourceStatus", "ObservationsResult"} <= set(s["components"]["schemas"])
    ok = s["paths"]["/series/{series_id}/observations"]["get"]["responses"]
    assert {"200", "403", "404", "429"} <= set(ok)


def test_mcp_disallowed_host_is_421(tmp_path):
    with build(tmp_path, allowed_hosts=("localhost:*",)) as c:
        r = c.post(
            "/mcp",
            headers={"accept": "application/json, text/event-stream", "host": "evil.example"},
            json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        )
        assert r.status_code == 421
    with build(tmp_path, allowed_hosts=("*",)) as c:
        r = c.post(
            "/mcp",
            headers={"accept": "application/json, text/event-stream", "host": "evil.example"},
            json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        )
        assert r.status_code != 421


def test_filters_reach_on_demand_fetch(tmp_path, monkeypatch):
    seen = []
    monkeypatch.setattr(
        service, "fetch_on_demand", lambda req, *a, **k: seen.append(req) or (None, None)
    )
    with build(tmp_path) as c:
        c.get("/series/remyes:D:UNEMP/observations?filter=partner=USA&filter=hs=85&limit=5")
    assert seen[0].filters == {"partner": "USA", "hs": "85"} and seen[0].max_rows is None


def test_host_allowlist_guards_rest_routes(tmp_path):
    with build(tmp_path) as c:
        for path in ("/query", "/python"):
            r = c.post(path, headers={"host": "evil.example"}, json={"sql": "SELECT 1", "code": ""})
            assert r.status_code == 421
        assert c.get("/healthz", headers={"host": "evil.example"}).status_code == 421
        assert c.get("/healthz", headers={"host": "localhost:8000"}).status_code == 200
        assert c.post("/query", json={"sql": "SELECT 1"}).status_code == 200
    with build(tmp_path, allowed_hosts=("*",)) as c:
        assert c.get("/healthz", headers={"host": "evil.example"}).status_code == 200


def test_mcp_origin_derived_from_allowed_hosts(tmp_path):
    with build(tmp_path) as c:
        r = c.post(
            "/mcp",
            headers={
                "accept": "application/json, text/event-stream",
                "host": "localhost:8000",
                "origin": "http://localhost:8000",
            },
            json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        )
        assert r.status_code != 403
        r = c.post(
            "/mcp",
            headers={
                "accept": "application/json, text/event-stream",
                "host": "localhost:8000",
                "origin": "http://evil.example",
            },
            json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        )
        assert r.status_code == 403
