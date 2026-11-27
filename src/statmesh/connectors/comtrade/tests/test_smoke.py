import pytest

from statmesh.core.connector import load_connector
from statmesh.core.http import HttpClient
from statmesh.core.models import FetchRequest
from statmesh.settings import Settings


@pytest.mark.live
def test_preview_live():
    s = Settings.from_env()
    c = load_connector("comtrade", s)
    http = HttpClient(c.manifest, s)
    req = FetchRequest("HS-A", ("X",), ("IND",), filters={"partner": "USA", "hs": "AG2"})
    chunk = next(iter(c.fetch(req, http)))
    assert c.normalize(chunk).num_rows > 50  # live API, not the synthetic fixtures


@pytest.mark.live
@pytest.mark.enable_socket
def test_live_doctor():
    from statmesh.doctor import check

    r = check("comtrade")
    if r.status == "skip":
        pytest.skip(r.detail)
    assert r.status == "ok", r.detail
