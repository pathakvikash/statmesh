"""service.graph / GET /graph over a synthetic catalog (hand-built here, not recorded), offline."""

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from statmesh import service
from statmesh.api.app import create_app
from statmesh.core.catalog import Catalog
from statmesh.core.models import DatasetMeta, Licence, Manifest, SeriesMeta
from statmesh.settings import Settings

YES = Licence(name="CC BY", url="https://cc", redistribute="yes", attribution="Open")
REVIEW = Licence(name="Custom", url="https://c", redistribute="review", attribution="X")
TS = datetime(2026, 1, 1, tzinfo=UTC)


def _build(tmp_path, n_src=0, **kw):
    cat = Catalog(tmp_path / "catalog.sqlite")
    srcs = [("open", YES), ("other", YES), ("closed", REVIEW)] + [
        (f"s{i}", YES) for i in range(n_src)
    ]
    for sid, lic in srcs:
        cat.upsert_source(Manifest(id=sid, name=sid.title(), kind="custom", licence=lic))
        ser = lambda i, t: SeriesMeta(i, t, geos=("IND", "FRA", "unmapped:Foo"))
        series = (ser("LIFE", "Life expectancy at birth"), ser("MORT", "Infant mortality rate"))
        title = "Health data" if sid != "other" else "Health"
        cat.upsert_discovery(sid, [DatasetMeta(sid, "D", title, lic, series=series)], core=[])
        cat.set_dataset_status(sid, "D", "ingested", ingested_at=TS)
    cat.close()
    service.configure(Settings(data_dir=tmp_path, allowed_hosts=("testserver",), **kw))


def _ids(g):
    return [n.id for n in g.nodes]


def test_base_caps_determinism_and_hrefs(tmp_path):
    _build(tmp_path, n_src=20)
    g = service.graph()
    assert g.cap == 60 and len(g.nodes) <= 30 and g.truncated
    assert _ids(g) == _ids(service.graph())
    assert sum(n.kind == "source" for n in g.nodes) == 12
    src = next(n for n in g.nodes if n.kind == "source")
    assert src.href == f"/sources/{src.id[7:]}" and src.count == 2
    top = next(n for n in g.nodes if n.kind == "topic")
    assert top.href.startswith("/search?topic=")
    assert {e.kind for e in g.edges} == {"topic"}
    assert all("series on" in e.reason for e in g.edges)
    assert {e.from_ for e in g.edges} <= set(_ids(g))


def test_hosted_filters_licence(tmp_path):
    _build(tmp_path, mode="hosted")
    assert "source:closed" not in _ids(service.graph())
    assert "source:open" in _ids(service.graph())
    for bad in ("source:closed", "indicator:closed:D:LIFE"):
        try:
            service.graph(bad)
            raise AssertionError(bad)
        except KeyError:
            pass


def test_expand_source_topic_indicator(tmp_path):
    _build(tmp_path)
    s = service.graph("source:open")
    assert [n.id for n in s.nodes] == ["indicator:open:D:LIFE"]
    assert s.nodes[0].href == "/series/open%3AD%3ALIFE"
    assert s.edges[0].kind == "published_by" and s.edges[0].to == "source:open"
    topic = next(n.id for n in service.graph().nodes if n.kind == "topic")
    t = service.graph(topic)
    assert t.nodes and {n.kind for n in t.nodes} == {"indicator"}
    assert len({n.id.split(":")[1] for n in t.nodes}) > 1  # spread over sources
    i = service.graph("indicator:open:D:LIFE")
    kinds = {e.kind for e in i.edges}
    assert kinds == {"related", "covers"}
    assert [n.label for n in i.nodes if n.kind == "country"] == ["India", "France"]
    assert next(e.reason for e in i.edges if e.kind == "covers") == "Covers India"
    assert i.nodes[0].href is not None and all(
        n.href is None for n in i.nodes if n.kind == "country"
    )


def test_rest_and_unknown_404(tmp_path):
    _build(tmp_path)
    c = TestClient(create_app(), base_url="http://testserver")
    r = c.get("/graph")
    assert r.status_code == 200 and "from" in r.json()["edges"][0]
    assert c.get("/graph", params={"expand": "source:open"}).status_code == 200
    for bad in ("source:nope", "topic:Nope", "indicator:open:D:NOPE", "weird"):
        assert c.get("/graph", params={"expand": bad}).status_code == 404
