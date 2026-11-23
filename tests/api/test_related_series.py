"""related_series over a synthetic catalog (hand-built here, not the recorded fixtures), offline."""

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


def _build(tmp_path, crowd=0, **kw):
    cat = Catalog(tmp_path / "catalog.sqlite")
    for sid, name in (("open", "Open Stats"), ("other", "Other Stats"), ("closed", "Closed")):
        cat.upsert_source(
            Manifest(id=sid, name=name, kind="custom", licence=REVIEW if sid == "closed" else YES)
        )
    ser = lambda i, t: SeriesMeta(i, t, geos=("IND", "unmapped:Foo"))
    cat.upsert_discovery(
        "open",
        [DatasetMeta("open", "D", "Health data", YES, series=(
            ser("LIFE", "Life expectancy at birth"), ser("MORT", "Infant mortality rate"),
            ser("LIFEM", "Life expectancy at birth male"),
            SeriesMeta("NOGEO", "Life expectancy at birth female", geos=()),
        ))],
        core=[],
    )  # fmt: skip
    cat.upsert_discovery(
        "other",
        [
            DatasetMeta(
                "other",
                "E",
                "Health",
                YES,
                series=(
                    ser("LE", "Life expectancy at birth" + (" estimate total" if crowd else "")),
                ),
            )
        ],
        core=[],
    )
    cat.upsert_discovery(
        "closed",
        [
            DatasetMeta(
                "closed",
                "C",
                "Health",
                REVIEW,
                series=(
                    ser("LE", "Life expectancy"),
                    *(ser(f"X{i}", "Life expectancy at birth") for i in range(crowd)),
                ),
            )
        ],
        core=[],
    )
    for s, d in (("open", "D"), ("other", "E"), ("closed", "C")):
        cat.set_dataset_status(s, d, "ingested", ingested_at=TS)
    cat.close()
    service.configure(Settings(data_dir=tmp_path, allowed_hosts=("testserver",), **kw))


def test_deterministic_excludes_self_and_other_source_slot(tmp_path):
    _build(tmp_path)
    a = service.related_series("open:D:LIFE", limit=2)
    b = service.related_series("open:D:LIFE:IND", limit=2)
    ids = [h.series_id for h in a.hits]
    assert ids == [h.series_id for h in service.related_series("open:D:LIFE", limit=2).hits]
    assert "open:D:LIFE" not in ids
    assert ids[0] == "open:D:LIFEM"
    assert any(h.source_id == "other" for h in a.hits)  # reserved slot despite limit=2
    assert all(h.series_id.endswith(":IND") for h in b.hits)  # 4-part id carries the geo
    assert a.citation.series_id == "open:D:LIFE"
    top = a.hits[0].reason
    assert (
        top.startswith("Same dataset")
        and "Similar title" in top
        and not any(c.isdigit() for c in top)
    )
    other = next(h for h in a.hits if h.source_id == "other")
    assert (
        other.reason.endswith(" · Other source: Other Stats")
        or other.reason == "Other source: Other Stats"
    )
    assert "Also about Health" in other.reason or "Also about" not in other.reason


def test_unknown_series_is_404(tmp_path):
    _build(tmp_path)
    with TestClient(create_app()) as c:
        assert c.get("/series/open:D:NOPE/related").status_code == 404
        r = c.get("/series/open:D:LIFE/related", params={"limit": 3})
    assert r.status_code == 200 and r.json()["hits"]


def test_hosted_refuses_non_redistributable(tmp_path):
    _build(tmp_path, mode="hosted", ondemand=False)
    ids = {h.series_id for h in service.related_series("open:D:LIFE").hits}
    assert "other:E:LE" in ids and not any(i.startswith("closed:") for i in ids)


def test_hosted_filter_applies_before_the_search_pool_is_cut(tmp_path):
    # 40 closed rows outrank the open one for the title query: without `keep` they fill the 30 slots
    _build(tmp_path, crowd=40, mode="hosted", ondemand=False)
    ids = {h.series_id for h in service.related_series("open:D:LIFE").hits}
    assert "other:E:LE" in ids and not any(i.startswith("closed:") for i in ids)


def test_four_part_id_with_unmapped_geo_is_not_an_error(tmp_path):
    _build(tmp_path)
    hits = service.related_series("open:D:LIFE:unmapped:Foo").hits
    assert hits and all(h.series_id.endswith(":unmapped:Foo") for h in hits)
    with TestClient(create_app()) as c:
        assert c.get("/series/open:D:LIFE:unmapped:Foo/related").status_code == 200


def test_geo_is_a_soft_preference(tmp_path):
    _build(tmp_path)
    ids = [h.series_id for h in service.related_series("open:D:LIFE", geo="IND", limit=20).hits]
    assert "open:D:NOGEO:IND" in ids  # empty geos is kept, not dropped
    assert ids.index("open:D:LIFEM:IND") < ids.index(
        "open:D:NOGEO:IND"
    )  # explicit coverage ranks first
