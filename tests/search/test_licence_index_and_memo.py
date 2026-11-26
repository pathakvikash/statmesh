"""Batched licence resolution equals Catalog.licence_for; list_sources/graph memo is fresh, private
and keyed by request args. Synthetic catalog plus a copy of the repo's demo-data (recorded)."""

import shutil
from pathlib import Path

import pytest

from statmesh import service
from statmesh.core.catalog import Catalog
from statmesh.core.models import DatasetMeta, Licence, Manifest, SeriesMeta
from statmesh.settings import Settings

YES = Licence(name="CC BY", url="https://y", redistribute="yes", attribution="A")
REV = Licence(name="Terms", url="https://r", redistribute="review", attribution="B")
NO = Licence(name="Closed", url="https://n", redistribute="no", attribution="C")
DEMO = Path(__file__).parents[2] / "demo-data"


def _build(path: Path) -> Catalog:
    cat = Catalog(path / "catalog.sqlite")
    cat.upsert_source(Manifest(id="open", name="Open", kind="custom", licence=YES))
    cat.upsert_source(Manifest(id="shut", name="Shut", kind="custom", licence=REV))
    cat.upsert_discovery(
        "open",
        [
            DatasetMeta("open", "d1", "Zebra census", YES, series=(
                SeriesMeta("pop", "Zebra population", freq="A", geos=("IND",)),
                SeriesMeta("bad", "Zebra population closed", freq="A", geos=("IND",), licence=NO),
            )),
            DatasetMeta("open", "d2", "Zebra review set", REV, series=(
                SeriesMeta("a", "Zebra population review", freq="A", geos=("IND",)),
                SeriesMeta("b", "Zebra population public", freq="A", geos=("IND",), licence=YES),
            )),
        ],
        core=[],
    )  # fmt: skip
    cat.upsert_discovery(
        "shut",
        [DatasetMeta("shut", "d", "Zebra shut", REV, series=(
            SeriesMeta("x", "Zebra population shut", freq="A", geos=("IND",)),
        ))],
        core=[],
    )  # fmt: skip
    for s, d in (("open", "d1"), ("open", "d2"), ("shut", "d")):
        cat.set_dataset_status(s, d, "ingested")
    return cat


def _all_keys(cat: Catalog) -> list[str]:
    keys = [r["series_key"] for r in cat._all("SELECT series_key FROM series")]
    return keys + [
        f"{r['source_id']}:{r['dataset_id']}" for r in cat._all("SELECT * FROM datasets")
    ]


def _same(cat: Catalog) -> int:
    ix = cat.licence_index()
    keys = _all_keys(cat)
    for k in keys:
        assert ix.licence(k) == cat.licence_for(k), k
    for r in cat._all("SELECT source_id, dataset_id, status FROM datasets"):
        assert ix.status(r["source_id"], r["dataset_id"]) == r["status"]
    return len(keys)


def test_index_equals_licence_for_and_refreshes(tmp_path):
    cat = _build(tmp_path)
    assert _same(cat) >= 8
    assert cat.licence_index() is cat.licence_index()  # cached while nothing changes
    cat.upsert_source(Manifest(id="shut", name="Shut", kind="custom", licence=YES))
    assert cat.licence_index().licence("shut:d:x").redistribute == "yes"  # source change seen
    cat.set_dataset_status("open", "d1", "stale")
    assert cat.licence_index().status("open", "d1") == "stale"
    with pytest.raises(KeyError):
        cat.licence_index().licence("nope:d:x")
    with pytest.raises(KeyError):
        cat.licence_for("nope:d:x")
    cat.close()


@pytest.mark.skipif(not DEMO.exists(), reason="no demo-data")
def test_index_equals_licence_for_on_demo_data(tmp_path):
    shutil.copytree(DEMO, tmp_path / "d")
    cat = Catalog(tmp_path / "d" / "catalog.sqlite", readonly=True)
    assert _same(cat) > 100
    cat.close()


@pytest.fixture
def env(tmp_path):
    _build(tmp_path).close()
    return tmp_path


def _cfg(path: Path, mode: str):
    service.configure(Settings(data_dir=path, mode=mode, ondemand=False, allowed_hosts=("x",)))


def test_hosted_search_excludes_non_yes(env):
    _cfg(env, "hosted")
    got = {h.series_id for h in service.search_series("zebra population", limit=50).hits}
    assert got == {"open:d1:pop", "open:d2:b"}  # series > dataset > source, only `yes`
    _cfg(env, "self_host")
    assert len(service.search_series("zebra population", limit=50).hits) == 5


def test_memo_fresh_private_and_keyed(env):
    _cfg(env, "self_host")
    a = service.list_sources()
    a[0].datasets = 999  # mutating a result must not leak into the next caller
    b = service.list_sources()
    assert b is not a and b[0].datasets != 999
    assert [s.id for s in service.list_sources(q="shut")] == ["shut"]  # args are in the key
    assert len(service.list_sources()) == 2
    g = service.graph()
    g.nodes.clear()
    assert service.graph().nodes
    src_count = lambda: {n.id: n.count for n in service.graph().nodes if n.kind == "source"}
    n_before = src_count()
    # a write through the engine's own catalog is visible on the next call
    eng = service._engine()
    before = {s.id: s.datasets for s in service.list_sources()}
    eng.catalog.upsert_discovery(
        "open", [DatasetMeta("open", "d3", "Zebra extra", YES, series=(
            SeriesMeta("n", "Zebra new", freq="A"),
        ))], core=[],
    )  # fmt: skip
    after = {s.id: s.datasets for s in service.list_sources()}
    assert after["open"] == before["open"] + 1
    assert src_count()["source:open"] == n_before["source:open"] + 1
    # hosted mode (new engine) keeps the filtered view, not self_host's cache
    _cfg(env, "hosted")
    assert {s.id for s in service.list_sources()} == {"open"}  # `shut` has nothing servable
    assert "source:shut" not in src_count()


def test_memo_survives_reconfigure_loop(env):
    # configure() frees the old engine; a reused id() must not serve the other settings' entries
    for _ in range(50):
        service.configure(Settings(data_dir=env, mode="self_host", ondemand=False,
                                   allowed_hosts=("x",), disabled=frozenset({"shut"})))  # fmt: skip
        off = {s.id: s.enabled for s in service.list_sources()}
        assert off == {"open": True, "shut": False}
        _cfg(env, "self_host")
        assert all(s.enabled for s in service.list_sources())


def test_empty_licence_name_rejected_and_index_matches(tmp_path):
    with pytest.raises(ValueError):
        Licence(name="", url="u", redistribute="yes", attribution="a")
    cat = _build(tmp_path)
    cat._c.execute(
        "UPDATE datasets SET licence_name='', redistribute='review' WHERE dataset_id='d2'"
    )
    cat._c.commit()
    key = "open:d2:a"

    def res(f):
        try:
            return f(key)
        except ValueError as e:
            return type(e).__name__

    assert res(lambda k: cat.licence_index().licence(k)) == res(cat.licence_for)  # no silent `yes`
    cat.close()
