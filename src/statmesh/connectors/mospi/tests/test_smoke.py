import pytest

from statmesh.core.connector import load_connector
from statmesh.core.http import HttpClient
from statmesh.core.models import FetchRequest
from statmesh.core.schema import validate_table
from statmesh.settings import Settings


@pytest.mark.live
@pytest.mark.enable_socket
def test_live_cpi_one_page():
    s = Settings.from_env()
    c = load_connector("mospi", s)
    http = HttpClient(c.manifest, s, None)
    req = FetchRequest(
        "cpi", filters={"year": "2024", "month_code": "12", "sector_code": "3"}, max_rows=20
    )
    chunk = next(iter(c.fetch(req, http)))
    t = c.normalize(chunk)
    validate_table(t)
    assert t.num_rows


@pytest.mark.live
@pytest.mark.enable_socket
def test_live_doctor():
    from statmesh.doctor import check

    r = check("mospi")
    if r.status == "skip":
        pytest.skip(r.detail)
    assert r.status == "ok", r.detail
