import pytest

from statmesh.core.connector import load_connector
from statmesh.core.http import HttpClient
from statmesh.core.models import FetchRequest
from statmesh.core.schema import validate_table
from statmesh.settings import Settings


@pytest.mark.live
@pytest.mark.enable_socket
def test_facts_live():
    s = Settings.from_env()
    c = load_connector("esef", s)
    req = FetchRequest("facts", filters={"lei": "549300CSLHPO6Y1AZN37"}, max_rows=1)
    t = c.normalize(next(iter(c.fetch(req, HttpClient(c.manifest, s)))))
    validate_table(t)
    assert t.num_rows >= 1


@pytest.mark.live
@pytest.mark.enable_socket
def test_live_doctor():
    from statmesh.doctor import check

    r = check("esef")
    if r.status == "skip":
        pytest.skip(r.detail)
    assert r.status == "ok", r.detail
