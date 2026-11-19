import pytest

from statmesh.core.connector import load_connector
from statmesh.core.http import HttpClient
from statmesh.core.models import FetchRequest
from statmesh.settings import Settings


@pytest.mark.live
@pytest.mark.enable_socket
def test_frames_live():
    s = Settings.from_env()
    c = load_connector("sec_edgar", s)
    http = HttpClient(c.manifest, s)
    req = FetchRequest("frames", indicator_ids=("Revenues",), filters={"period": "CY2023"})
    chunk = next(iter(c.fetch(req, http)))
    assert c.normalize(chunk).num_rows > 100


@pytest.mark.live
@pytest.mark.enable_socket
def test_live_doctor():
    from statmesh.doctor import check

    r = check("sec_edgar")
    if r.status == "skip":
        pytest.skip(r.detail)
    assert r.status == "ok", r.detail
