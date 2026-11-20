"""Offset paging on search and observations, and the partial-data flag on every surface."""

import asyncio
from datetime import UTC, date, datetime

import pyarrow as pa
import pytest
from fastapi.testclient import TestClient
from mcp import Client

from statmesh import sdk, service
from statmesh.api.app import create_app
from statmesh.core.catalog import Catalog
from statmesh.core.models import DatasetMeta, Licence, Manifest, SeriesMeta
from statmesh.core.schema import OBS_SCHEMA
from statmesh.core.storage import Storage
from statmesh.mcp_server import build_server
from statmesh.settings import Settings

YES = Licence(name="CC BY", url="https://cc", redistribute="yes", attribution="Open Org")
TS = datetime(2026, 1, 1, tzinfo=UTC)
INDS = ("U1", "U2", "U3", "U4", "U5")


def obs(ind, geos=("IND", "USA"), years=(2020, 2021, 2022)):
    rows = [{
        "series_id": f"open:D:{ind}:{g}", "source_id": "open", "dataset_id": "D",
        "indicator_id": ind, "geo": g, "period_start": date(y, 1, 1), "period_end": date(y, 12, 31),
        "freq": "A", "value": float(y - 2019), "unit": "pct", "unit_mult": 0, "dims": [],
        "obs_status": None, "retrieved_at": TS, "vintage": None,
    } for g in geos for y in years]  # fmt: skip
    return pa.Table.from_pylist(rows, schema=OBS_SCHEMA)


@pytest.fixture
def data(tmp_path):
    cat = Catalog(tmp_path / "catalog.sqlite")
    cat.upsert_source(Manifest(id="open", name="Open", kind="custom", licence=YES))
    series = tuple(
        SeriesMeta(i, f"Unemployment rate {n}", freq="A", geos=("IND", "USA"))
        for n, i in enumerate(INDS, 1)
    )
    cat.upsert_discovery(
        "open",
        [
            DatasetMeta(
                "open", "D", "open data", YES, source_url="https://open.example", series=series
            )
        ],
        core=[],
    )
    cat.set_dataset_status("open", "D", "ingested")
    cat.close()
    st = Storage(tmp_path)
    with st.update_manifest() as m:
        m["obs"]["open/D"] = st.write_parts(
            pa.concat_tables([obs(i) for i in INDS]), "obs/open/D", "r1"
        )
    service.configure(Settings(data_dir=tmp_path, allowed_hosts=("testserver",)))
    return tmp_path


def set_partial(data, on=True, cut=("open:D:U1:IND",)):
    """Flag dataset open/D as capped; `cut` = series ids the cap cut (manifest "cut")."""
    cat = Catalog(data / "catalog.sqlite")
    cat.set_truncated("open", "D", on)
    cat.close()
    with Storage(data).update_manifest() as m:
        m["cut"] = {"open/D": list(cut)} if on else {}


def test_observations_pages_round_trip(data):
    whole = service.get_observations("open:D:U1", limit=10_000)
    assert whole.next_offset is None and not whole.truncated and len(whole.rows) == 6
    first = service.get_observations("open:D:U1", limit=4)
    assert first.next_offset == 4 and first.truncated
    second = service.get_observations("open:D:U1", limit=4, offset=first.next_offset)
    assert second.next_offset is None and not second.truncated
    assert first.rows + second.rows == whole.rows


def test_observations_offset_past_end_is_empty(data):
    r = service.get_observations("open:D:U1", offset=6)
    assert r.status == "ok" and r.rows == [] and r.next_offset is None and not r.truncated
    r = service.get_observations("open:D:U1", offset=10**6, limit=2)
    assert r.rows == [] and r.next_offset is None


def test_search_pages_round_trip(data):
    whole = [h.series_id for h in service.search_series("unemployment", limit=100).hits]
    assert len(whole) == 5
    got, off, pages = [], 0, 0
    while off is not None:
        page = service.search_series("unemployment", limit=2, offset=off)
        got += [h.series_id for h in page.hits]
        off, pages = page.next_offset, pages + 1
    assert got == whole and pages == 3
    past = service.search_series("unemployment", limit=2, offset=50)
    assert past.hits == [] and past.next_offset is None


@pytest.mark.parametrize("fn,kw", [
    (service.get_observations, {"series_id": "open:D:U1"}),
    (service.search_series, {"q": "unemployment"}),
])  # fmt: skip
def test_negative_offset_rejected(data, fn, kw):
    with pytest.raises(ValueError, match="offset"):
        fn(**kw, offset=-1)


def test_partial_flag_on_observations_and_warning(data):
    assert not service.get_observations("open:D:U1").partial
    set_partial(data)
    r = service.get_observations("open:D:U1")
    assert r.status == "ok" and r.partial and not r.truncated and r.next_offset is None
    assert "partial" in r.warning.lower() and "open/D" in r.warning
    assert "open/D" in (service.get_observations("open:D:U1", offset=2).warning or "")
    set_partial(data, False)
    assert not service.get_observations("open:D:U1").partial


def test_uncut_series_of_truncated_dataset_is_not_partial_but_cut_one_is(data):
    set_partial(data, cut=("open:D:U2:USA",))
    u1 = service.get_observations("open:D:U1")
    assert u1.rows and not u1.partial and u1.warning is None
    assert service.get_observations("open:D:U2").partial  # 3-part key: one of its geos was cut
    assert not service.get_observations("open:D:U2", geo="IND").partial  # only USA was cut
    assert service.get_observations("open:D:U2", geo="USA").partial
    assert service.get_observations("open:D:U2:USA").partial
    assert not service.get_observations("open:D:U2:IND").partial


def test_flagged_dataset_without_cut_record_stays_partial(data):
    set_partial(data)
    with Storage(data).update_manifest() as m:
        m["cut"].pop("open/D")  # truncated before cuts were recorded
    assert service.get_observations("open:D:U1").partial
    with Storage(data).update_manifest() as m:
        m["cut"]["open/D"] = []  # clean ingest wrote an empty list
    assert not service.get_observations("open:D:U1").partial


def test_partial_flag_on_rest(data):
    set_partial(data)
    with TestClient(create_app()) as c:
        body = c.get("/series/open:D:U1/observations").json()
        assert body["partial"] is True and "open/D" in body["warning"]
        page = c.get("/series/open:D:U1/observations", params={"limit": 4, "offset": 4}).json()
        assert page["rows"] and page["next_offset"] is None
        assert c.get("/series/open:D:U1/observations", params={"offset": -1}).status_code == 422
        s = c.get("/search", params={"q": "unemployment", "limit": 2}).json()
        assert s["next_offset"] == 2 and len(s["hits"]) == 2
        last = c.get("/search", params={"q": "unemployment", "limit": 2, "offset": 4}).json()
        assert last["next_offset"] is None and len(last["hits"]) == 1


def test_partial_flag_and_offset_on_mcp(data):
    set_partial(data)

    async def go():
        async with Client(build_server()) as c:
            obs_r = await c.call_tool(
                "get_observations", {"series_id": "open:D:U1", "limit": 4, "offset": 4}
            )
            srch = await c.call_tool("search_series", {"q": "unemployment", "limit": 2})
            return obs_r, srch

    obs_r, srch = asyncio.run(go())
    assert obs_r.structured_content["rows"] and obs_r.structured_content["next_offset"] is None
    assert obs_r.structured_content["partial"] is True
    assert "open/D" in obs_r.structured_content["warning"]
    assert srch.structured_content["next_offset"] == 2


def test_partial_flag_and_offset_on_sdk(data):
    pytest.importorskip("pandas")
    set_partial(data)
    c = sdk.LocalClient()
    df = c.get("open:D:U1", limit=4)
    assert len(df) == 4 and c.partial is True and c.truncated is True and c.next_offset == 4
    assert "open/D" in c.warning
    tail = c.get("open:D:U1", limit=4, offset=4)
    assert len(tail) == 2 and c.next_offset is None
    hits = c.search("unemployment", limit=2)
    assert len(hits) == 2 and c.next_offset == 2


def test_offset_pages_do_not_skip_or_repeat_rows_with_duplicate_keys(data):
    # a second vintage of U1: the same geo, period and series, but other values and retrieved_at
    again = obs("U1").to_pylist()
    for r in again:
        r["value"] += 0.5
        r["retrieved_at"] = datetime(2026, 2, 1, tzinfo=UTC)
    st = Storage(data)
    with st.update_manifest() as m:
        extra = st.write_parts(pa.Table.from_pylist(again, schema=OBS_SCHEMA), "obs/open/D", "r2")
        m["obs"]["open/D"] = [*m["obs"]["open/D"], *extra]
    service.configure(Settings(data_dir=data, allowed_hosts=("testserver",)))
    whole = service.get_observations("open:D:U1", limit=10_000)
    assert len(whole.rows) == 12
    rows, offset = [], 0
    while offset is not None:
        page = service.get_observations("open:D:U1", limit=5, offset=offset)
        rows += page.rows
        offset = page.next_offset
    assert rows == whole.rows and len({tuple(map(str, r)) for r in rows}) == 12
