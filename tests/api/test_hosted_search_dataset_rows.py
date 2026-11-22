"""Hosted search over dataset-level FTS rows ('src:ds' keys, for datasets with no listed series).
Synthetic catalog, offline. Regression: the hosted offline-servable filter unpacked 3 key parts
and 400'd ('not enough values to unpack') whenever such a row matched the query."""

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from statmesh import service
from statmesh.api.app import create_app
from statmesh.core.catalog import Catalog
from statmesh.core.models import DatasetMeta, Licence, Manifest, SeriesMeta
from statmesh.settings import Settings

YES = Licence(name="CC BY", url="https://cc", redistribute="yes", attribution="Open")
TS = datetime(2026, 1, 1, tzinfo=UTC)


def test_hosted_search_keeps_ingested_dataset_rows_and_drops_remote_ones(tmp_path):
    cat = Catalog(tmp_path / "catalog.sqlite")
    cat.upsert_source(Manifest(id="open", name="Open", kind="custom", licence=YES))
    cat.upsert_discovery(
        "open",
        [
            DatasetMeta("open", "S", "GDP series", YES, series=(SeriesMeta("G", "GDP level"),)),
            DatasetMeta("open", "R", "GDP by region", YES),  # ingested, no listed series
            DatasetMeta("open", "X", "GDP gaps", YES),  # remote, no listed series
        ],
        core=[],
    )
    for ds in ("S", "R"):
        cat.set_dataset_status("open", ds, "ingested", ingested_at=TS)
    cat.close()
    service.configure(
        Settings(data_dir=tmp_path, mode="hosted", ondemand=False, allowed_hosts=("testserver",))
    )
    with TestClient(create_app()) as c:
        r = c.get("/search", params={"q": "gdp"})
    assert r.status_code == 200, r.text
    assert {h["series_id"] for h in r.json()["hits"]} == {"open:S:G", "open:R"}


def test_hosted_search_drops_dataset_row_with_review_licence(tmp_path):
    """can_serve still applies to dataset-level rows: dataset licence 'review' beats source 'yes'."""
    review = Licence(name="Custom", url="https://c", redistribute="review", attribution="X")
    cat = Catalog(tmp_path / "catalog.sqlite")
    cat.upsert_source(Manifest(id="open", name="Open", kind="custom", licence=YES))
    cat.upsert_discovery(
        "open",
        [
            DatasetMeta("open", "R", "GDP by region", YES),
            DatasetMeta("open", "P", "GDP private", review),
        ],
        core=[],
    )
    for ds in ("R", "P"):
        cat.set_dataset_status("open", ds, "ingested", ingested_at=TS)
    cat.close()
    service.configure(
        Settings(data_dir=tmp_path, mode="hosted", ondemand=False, allowed_hosts=("testserver",))
    )
    with TestClient(create_app()) as c:
        r = c.get("/search", params={"q": "gdp"})
    assert r.status_code == 200, r.text
    assert {h["series_id"] for h in r.json()["hits"]} == {"open:R"}
