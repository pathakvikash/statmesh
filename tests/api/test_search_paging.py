from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from statmesh import service
from statmesh.api.app import create_app
from statmesh.core.catalog import Catalog
from statmesh.core.models import DatasetMeta, Licence, Manifest, SeriesMeta
from statmesh.settings import Settings

YES = Licence(name="CC BY", url="https://cc", redistribute="yes", attribution="Open")
TS = datetime(2026, 1, 1, tzinfo=UTC)
N = 150  # more than one page at limit=10, and more than 100
pytestmark = pytest.mark.usefixtures("client")  # configures the service for every test


@pytest.fixture
def client(tmp_path):
    cat = Catalog(tmp_path / "catalog.sqlite")
    cat.upsert_source(Manifest(id="open", name="Open", kind="custom", licence=YES))
    series = tuple(
        SeriesMeta(f"P{i:03d}", f"Population of region {i}", freq="A", geos=("IND",))
        for i in range(N)
    )
    cat.upsert_discovery(
        "open", [DatasetMeta("open", "D", "Population", YES, series=series)], core=[]
    )
    cat.set_dataset_status("open", "D", "ingested", ingested_at=TS)
    cat.close()
    service.configure(Settings(data_dir=tmp_path, allowed_hosts=("testserver", "localhost:*")))
    with TestClient(create_app()) as c:
        yield c


def _ids(page):
    return [h.series_id for h in page.hits]


def test_pages_match_one_large_call_without_duplicates():
    one = service.search_series("population", limit=100)
    walked, offset = [], 0
    while True:
        page = service.search_series("population", limit=10, offset=offset)
        walked += _ids(page)
        if page.next_offset is None:
            break
        assert page.next_offset == offset + 10
        offset = page.next_offset
    assert len(walked) == N and len(set(walked)) == N
    assert walked[:100] == _ids(one)


def test_last_page_has_no_next_offset():
    last = service.search_series("population", limit=10, offset=N - 10)
    assert len(last.hits) == 10 and last.next_offset is None


def test_offset_beyond_pool_is_rejected(client):
    with pytest.raises(ValueError, match="beyond the first 2000 results"):
        service.search_series("population", limit=10, offset=1995)
    r = client.get("/search", params={"q": "population", "limit": 10, "offset": 1995})
    assert r.status_code == 422 and "beyond the first 2000 results" in r.text
    assert (
        client.get("/search", params={"q": "population", "limit": 5, "offset": 1995}).status_code
        == 200
    )
