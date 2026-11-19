import os

import pytest

from statmesh.core.connector import load_connector
from statmesh.core.http import HttpClient
from statmesh.settings import Settings


@pytest.mark.live
@pytest.mark.enable_socket
@pytest.mark.skipif(not os.environ.get("DATAGOVIN_API_KEY"), reason="DATAGOVIN_API_KEY not set")
def test_live_catalog_page():
    s = Settings.from_env()
    c = load_connector("datagovin", s)
    assert list(c.discover(HttpClient(c.manifest, s, None), limit=3))


@pytest.mark.live
@pytest.mark.enable_socket
def test_live_doctor():
    from statmesh.doctor import check

    r = check("datagovin")
    if r.status == "skip":
        pytest.skip(r.detail)
    assert r.status == "ok", r.detail
