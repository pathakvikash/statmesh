import os

import pytest

from statmesh.core.connector import load_connector
from statmesh.core.http import HttpClient
from statmesh.core.models import FetchRequest
from statmesh.core.schema import validate_table
from statmesh.settings import Settings


@pytest.mark.live
@pytest.mark.enable_socket
def test_company_live():
    if not os.environ.get("COMPANIES_HOUSE_API_KEY"):
        pytest.skip("COMPANIES_HOUSE_API_KEY not set")
    s = Settings.from_env()
    c = load_connector("uk_companies_house", s)
    req = FetchRequest("company", filters={"number": "00000006"})
    t = c.normalize(next(iter(c.fetch(req, HttpClient(c.manifest, s)))))
    validate_table(t, "entities")
    assert t.num_rows == 1


@pytest.mark.live
@pytest.mark.enable_socket
def test_live_doctor():
    from statmesh.doctor import check

    r = check("uk_companies_house")
    if r.status == "skip":
        pytest.skip(r.detail)
    assert r.status == "ok", r.detail
