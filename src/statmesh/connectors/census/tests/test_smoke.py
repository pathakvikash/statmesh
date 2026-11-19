import os

import pytest

from statmesh.core.connector import load_connector
from statmesh.core.http import HttpClient
from statmesh.core.models import FetchRequest
from statmesh.core.schema import validate_table
from statmesh.settings import Settings


@pytest.mark.live
@pytest.mark.enable_socket
def test_acs5_live():
    if not os.environ.get("CENSUS_API_KEY"):
        pytest.skip("CENSUS_API_KEY not set")
    s = Settings.from_env()
    c = load_connector("census", s)
    chunk = next(iter(c.fetch(FetchRequest("acs5", geos=("US-AL",)), HttpClient(c.manifest, s))))
    t = c.normalize(chunk)
    validate_table(t)
    assert t.num_rows >= 1


@pytest.mark.live
@pytest.mark.enable_socket
def test_live_doctor():
    from statmesh.doctor import check

    r = check("census")
    if r.status == "skip":
        pytest.skip(r.detail)
    assert r.status == "ok", r.detail
