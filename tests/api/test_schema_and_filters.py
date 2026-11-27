import asyncio
import json
from datetime import UTC, date, datetime

import pyarrow as pa
import pytest
from fastapi.testclient import TestClient
from mcp import Client

from statmesh import service
from statmesh.api.app import create_app
from statmesh.core.catalog import Catalog
from statmesh.core.models import DatasetMeta, Licence, Manifest, SeriesMeta
from statmesh.core.schema import OBS_SCHEMA, TABLE_SCHEMAS, empty_table
from statmesh.core.storage import Storage
from statmesh.mcp_server import build_server
from statmesh.search.topics import TAXONOMY, classify
from statmesh.settings import Settings

YES = Licence(name="CC BY", url="https://cc", redistribute="yes", attribution="Open")
NO = Licence(name="Closed", url="https://c", redistribute="no", attribution="Closed")
REV = Licence(name="Rev", url="https://r", redistribute="review", attribution="Rev")
TS = datetime(2026, 1, 1, tzinfo=UTC)


def obs(source, ds, ind, geo, years):
    rows = [{
        "series_id": f"{source}:{ds}:{ind}:{geo}", "source_id": source, "dataset_id": ds,
        "indicator_id": ind, "geo": geo, "period_start": date(y, 1, 1),
        "period_end": date(y, 12, 31), "freq": "A", "value": 1.0, "unit": "x", "unit_mult": 0,
        "dims": [], "obs_status": None, "retrieved_at": TS, "vintage": None,
    } for y in years]  # fmt: skip
    return pa.Table.from_pylist(rows, schema=OBS_SCHEMA)


def build(tmp_path, **kw):
    cat = Catalog(tmp_path / "catalog.sqlite")
    S = SeriesMeta
    # (id, licence, kind, auth, datasets, status)
    spec = [
        ("open", YES, "custom", "none", {
            "D": ("Unemployment and jobs", (S("UNEMP", "Unemployment rate", freq="A", geos=("IND",)),
                                            S("CPI", "Consumer price inflation", freq="M", geos=("USA",)))),
            "E": ("Population statistics", (S("POP", "Population, total", freq="A", geos=("IND",)),)),
        }, "ingested"),
        ("closed", NO, "custom", "none", {"D": ("Unemployment data", (S("UNEMP", "Unemployment rate", freq="A", geos=("IND",)),))}, "ingested"),
        ("rev", REV, "file", "none", {"D": ("Unemployment review", (S("UNEMP", "Unemployment rate", freq="A"),))}, "remote"),
        ("remyes", YES, "rest", "free_key", {"D": ("Remote data", (S("UNEMP", "Unemployment rate", freq="A"),))}, "remote"),
        ("misc", YES, "custom", "none", {"W": ("Widgets", (S("W1", "Widgets output"),))}, "remote"),
    ]  # fmt: skip
    for sid, lic, kind, auth, dss, status in spec:
        extra = {"key_env": "STATMESH_TEST_KEY"} if auth == "free_key" else {}
        ds_manifest = {"W": {"topics": ["health", "Bogus"]}} if sid == "misc" else {}
        cat.upsert_source(Manifest(id=sid, name=f"{sid.title()} Stats", kind=kind, licence=lic,
                                   auth=auth, datasets=ds_manifest, **extra))  # fmt: skip
        cat.upsert_discovery(
            sid, [DatasetMeta(sid, d, t, lic, series=ss) for d, (t, ss) in dss.items()], core=[]
        )
        for d in dss:
            cat.set_dataset_status(sid, d, status, ingested_at=TS if status == "ingested" else None)
    cat.set_dataset_status("open", "E", "ingested", ingested_at=datetime(2025, 6, 1, tzinfo=UTC))
    cat.close()
    st = Storage(tmp_path)
    with st.update_manifest() as m:
        m["obs"]["open/D"] = st.write_parts(
            obs("open", "D", "UNEMP", "IND", (2020, 2021)), "obs/open/D", "r1"
        )
        m["obs"]["open/E"] = st.write_parts(
            obs("open", "E", "POP", "IND", range(1990, 1996)), "obs/open/E", "r1"
        )
        m["obs"]["closed/D"] = st.write_parts(obs("closed", "D", "UNEMP", "IND", (2020,)), "obs/closed/D", "r1")  # fmt: skip
    kw.setdefault("allowed_hosts", ("testserver", "localhost:*"))
    service.configure(Settings(data_dir=tmp_path, **kw))
    return TestClient(create_app())


@pytest.fixture
def client(tmp_path):
    with build(tmp_path) as c:
        yield c


def ids(c, **p):
    r = c.get("/search", params=p)
    assert r.status_code == 200, r.text
    return [h["series_id"] for h in r.json()["hits"]]


# ---- /schema -----------------------------------------------------------------------------------


def test_schema_shape(client):
    j = client.get("/schema").json()
    assert set(j) == {"views"}
    names = [v["name"] for v in j["views"]]
    assert {"observations", "observations_vintages", "series", "datasets", "sources", "entities",
            "entity_xref", "geos", "geo_groups"} == set(names)  # fmt: skip
    for v in j["views"]:
        assert set(v) == {"name", "description", "joins", "columns"}
        assert v["description"] and isinstance(v["joins"], list)
        for c in v["columns"]:
            assert set(c) == {"name", "type", "description", "example"}
            assert c["type"] and c["description"]
            assert c["example"] is None or isinstance(c["example"], str)


def test_schema_matches_engine_columns(tmp_path):
    """Drift: every column the engine exposes is documented, and nothing extra is."""
    with build(tmp_path) as c:
        eng = service._engine()
        con = eng._ensure()
        actual: dict[str, set[str]] = {}
        for t, col in con.execute(
            "SELECT table_name, column_name FROM information_schema.columns "
            "WHERE table_schema='main' AND table_name NOT LIKE '\\_%' ESCAPE '\\'"
        ).fetchall():
            actual.setdefault(t, set()).add(col)
        doc = {
            v["name"]: {x["name"] for x in v["columns"]} for v in c.get("/schema").json()["views"]
        }
    assert doc == actual


def test_schema_covers_storage_tables():
    doc = {v.name: {c.name for c in v.columns} for v in service.describe_schema().views}
    for name, schema in TABLE_SCHEMAS.items():
        assert doc[name] == set(schema.names) == set(empty_table(name).column_names)


def test_describe_schema_mcp(tmp_path):
    with build(tmp_path):

        async def go():
            async with Client(build_server()) as c:
                return await c.call_tool("describe_schema", {})

        r = asyncio.run(go())
    assert [v["name"] for v in json.loads(r.content[0].text)["views"]][:2] == [
        "observations",
        "observations_vintages",
    ]


def test_schema_served_in_hosted_mode(tmp_path):
    with build(tmp_path, mode="hosted") as c:
        assert len(c.get("/schema").json()["views"]) == 9


# ---- topics ------------------------------------------------------------------------------------


def test_classify():
    assert classify("Unemployment rate, total") == ["Labour"]
    assert classify("Consumer price index inflation") == ["Prices"]
    assert classify("Exports of goods") == ["Trade"]
    assert set(classify("Population, total and GDP growth")) >= {"Population", "Economy"}
    assert classify("Quarterly widgets") == []
    assert classify("Gasoline") == ["Energy"] and classify("Dis-ease") == []  # whole words only
    assert set(TAXONOMY) >= set(classify("health energy prices trade"))


def test_topics_on_hits_and_series(client):
    hits = client.get("/search", params={"q": "unemployment", "source": "open"}).json()["hits"]
    assert hits[0]["topics"] == ["Labour"]
    s = client.get("/series/open:E:POP").json()
    assert s["topics"] == ["Population"]


def test_manifest_dataset_topics_honoured(client):
    h = client.get("/search", params={"q": "widgets"}).json()["hits"][0]
    assert h["topics"] == ["Health"]  # "health" normalised, "Bogus" dropped
    assert ids(client, topic="Health") == ["misc:W:W1"]


# ---- /search filters ---------------------------------------------------------------------------


def test_source_repeatable_and_comma(client):
    base = {"q": "unemployment"}
    assert set(ids(client, **base, source="open")) == {"open:D:UNEMP"}
    both = {"open:D:UNEMP", "closed:D:UNEMP"}
    assert set(ids(client, **base, source="open,closed")) == both
    r = client.get(
        "/search", params=[("q", "unemployment"), ("source", "open"), ("source", "closed")]
    )
    assert {h["series_id"] for h in r.json()["hits"]} == both


def test_topic_filter(client):
    assert set(ids(client, topic="Prices")) == {"open:D:CPI"}
    assert "open:E:POP" in ids(client, topic="Population,Prices", limit=100)
    assert client.get("/search", params={"topic": "Nope"}).status_code == 400


def test_geo_and_freq_kept(client):
    assert ids(client, q="inflation", geo="USA") == ["open:D:CPI:USA"]
    assert ids(client, q="unemployment", freq="M") == []
    assert ids(client, q="inflation", freq="M") == ["open:D:CPI"]


def test_year_filters_use_observed_coverage(client):
    # POP observed 1990-1995; catalogue has no dates, so only observations decide
    assert "open:E:POP" in ids(client, q="population", start_year=1993, end_year=2000)
    assert "open:E:POP" in ids(client, q="population", end_year=1990)
    assert ids(client, q="population", start_year=1996) == []
    assert ids(client, q="population", end_year=1989) == []
    assert "open:D:UNEMP" in ids(client, q="unemployment", start_year=2021)
    assert "open:D:UNEMP" not in ids(client, q="unemployment", end_year=2019)
    assert client.get("/search", params={"q": "x", "start_year": 0}).status_code == 400


def test_year_filter_ranks_unknown_coverage_last(client):
    got = ids(client, q="unemployment", start_year=2021, limit=100)
    assert got[0] == "open:D:UNEMP"  # observed 2020-2021, confirmed match
    assert "remyes:D:UNEMP" in got[1:] and "closed:D:UNEMP" not in got  # unknown after known


def test_hit_start_end_from_observations(client):
    h = {
        h["series_id"]: h for h in client.get("/search", params={"q": "population"}).json()["hits"]
    }
    assert h["open:E:POP"]["start"] == "1990-01-01" and h["open:E:POP"]["end"] == "1995-12-31"
    d = client.get("/series/open:D:UNEMP").json()
    assert d["start"] == "2020-01-01" and d["end"] == "2021-12-31"
    r = client.get("/search", params={"q": "widgets"}).json()["hits"][0]
    assert r["start"] is None and r["end"] is None  # remote, nothing observed


def test_updated_since(client):
    got = ids(client, updated_since="2025-12-31", limit=100)
    assert "open:D:UNEMP" in got and "open:E:POP" not in got and "misc:W:W1" not in got
    assert "open:E:POP" in ids(client, updated_since="2025-01-01", limit=100)
    assert client.get("/search", params={"updated_since": "last week"}).status_code == 400
    for bad in ("2025-01-01junk", "2025-01-01T00:00:00", "20250101", "2025-02-30"):
        assert client.get("/search", params={"updated_since": bad}).status_code == 400


def test_redistribute_filter(client):
    assert set(ids(client, q="unemployment", redistribute="review")) == {"rev:D:UNEMP"}
    assert set(ids(client, q="unemployment", redistribute="no")) == {"closed:D:UNEMP"}
    assert set(ids(client, q="unemployment", redistribute="yes")) == {
        "open:D:UNEMP",
        "remyes:D:UNEMP",
    }
    assert client.get("/search", params={"redistribute": "maybe"}).status_code == 400


def test_filters_combine(client):
    assert ids(client, q="unemployment", source="open,closed", redistribute="yes",
               topic="Labour", start_year=2020) == ["open:D:UNEMP"]  # fmt: skip


def test_empty_q_with_filters_orders_by_recency(client):
    got = ids(client, source="open", limit=100)
    assert got == ["open:D:CPI", "open:D:UNEMP", "open:E:POP"]  # D (2026) before E (2025)
    assert ids(client, topic="Labour", source="open") == [
        "open:D:CPI",
        "open:D:UNEMP",
    ]  # dataset title adds Labour
    assert len(ids(client, source="open", limit=1)) == 1


def test_empty_q_without_filters_is_400(client):
    assert client.get("/search").status_code == 400
    assert client.get("/search", params={"q": "  "}).status_code == 400


def test_mcp_search_filters(tmp_path):
    with build(tmp_path):

        async def go():
            async with Client(build_server()) as c:
                a = await c.call_tool("search_series", {"topic": ["Prices"], "source": ["open"]})
                b = await c.call_tool("search_series", {"q": "unemployment", "redistribute": "no"})
                s = await c.call_tool("list_sources", {"topic": "Labour", "status": "data"})
                return a, b, s

        a, b, s = asyncio.run(go())
    assert [h["series_id"] for h in a.structured_content["hits"]] == ["open:D:CPI"]
    assert [h["series_id"] for h in b.structured_content["hits"]] == ["closed:D:UNEMP"]
    assert "open" in s.content[0].text


# ---- /sources filters --------------------------------------------------------------------------


def srcs(c, **p):
    r = c.get("/sources", params=p)
    assert r.status_code == 200, r.text
    return {s["id"] for s in r.json()}


def test_sources_filters(client):
    assert srcs(client) == {"open", "closed", "rev", "remyes", "misc"}
    assert srcs(client, q="REMOTE") == {"remyes"}  # dataset title
    assert srcs(client, q="open") == {"open"}  # id / name
    assert srcs(client, kind="file") == {"rev"}
    assert srcs(client, redistribute="no") == {"closed"}
    assert srcs(client, auth="key") == {"remyes"}
    assert srcs(client, auth="keyless") == {"open", "closed", "rev", "misc"}
    assert srcs(client, status="data") == {"open", "closed"}
    assert srcs(client, status="catalogue") == {"rev", "remyes", "misc"}
    assert srcs(client, topic="Labour") == {"open", "closed", "rev"}
    assert srcs(client, topic=["Health", "Population"]) == {"open", "misc"}
    assert srcs(client, topic="Labour", status="data", redistribute="yes") == {"open"}
    for bad in ({"auth": "x"}, {"status": "x"}, {"redistribute": "x"}, {"topic": "x"}):
        assert client.get("/sources", params=bad).status_code == 400


def test_sources_return_topics(client):
    by = {s["id"]: s for s in client.get("/sources").json()}
    assert by["open"]["topics"] == ["Labour", "Population"]
    assert by["misc"]["topics"] == ["Health"]
    assert by["remyes"]["topics"] == []


# ---- hosted mode -------------------------------------------------------------------------------


def test_hosted_filters_never_leak(tmp_path):
    with build(tmp_path, mode="hosted") as c:
        assert srcs(c) == {"open", "remyes", "misc"}
        assert srcs(c, redistribute="no") == set() and srcs(c, q="closed") == set()
        assert srcs(c, redistribute="review") == set()
        assert ids(c, redistribute="no") == [] and ids(c, redistribute="review") == []
        assert all("closed" not in i and "rev:" not in i for i in ids(c, topic="Labour", limit=100))
        assert set(ids(c, q="unemployment", source="open,closed,rev")) == {"open:D:UNEMP"}
        assert ids(c, source="closed") == []
        assert c.get("/series/closed:D:UNEMP").status_code == 404
        assert set(ids(c, updated_since="2020-01-01", limit=100)) <= {
            "open:D:CPI", "open:D:UNEMP", "open:E:POP", "remyes:D:UNEMP", "misc:W:W1"}  # fmt: skip


# ---- ondemand off ------------------------------------------------------------------------------


def test_ondemand_off_remote_observations_ok_empty_no_fetch(tmp_path, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("fetch_on_demand must not run")

    monkeypatch.setattr(service, "fetch_on_demand", boom)
    with build(tmp_path, ondemand=False) as c:
        j = c.get("/series/remyes:D:UNEMP/observations").json()
        assert j["status"] == "ok" and j["rows"] == []
        assert "Not mirrored on this instance" in j["warning"]
        assert c.get("/series/open:D:UNEMP:IND/observations").json()[
            "rows"
        ]  # ingested still served


def test_ondemand_off_search_drops_remote_only(tmp_path):
    with build(tmp_path, ondemand=False) as c:
        got = ids(c, q="unemployment", limit=100)
        assert "open:D:UNEMP" in got and "remyes:D:UNEMP" not in got and "misc:W:W1" not in ids(c, q="widgets")  # fmt: skip
    with build(tmp_path / "on") as c:
        assert "remyes:D:UNEMP" in ids(c, q="unemployment", limit=100)


def test_ondemand_off_search_drops_non_core_indicators(tmp_path, monkeypatch):
    opts = {"core_indicators": ["OTHER"]}
    conn = type("C", (), {"manifest": type("M", (), {"options": opts})()})()
    monkeypatch.setattr(service, "load_connector", lambda sid, settings: conn)
    with build(tmp_path, ondemand=False) as c:
        assert "open:D:UNEMP" not in ids(c, q="unemployment", limit=100)
    opts["core_indicators"] = ["UNEMP"]
    with build(tmp_path / "core", ondemand=False) as c:
        assert "open:D:UNEMP" in ids(c, q="unemployment", limit=100)
