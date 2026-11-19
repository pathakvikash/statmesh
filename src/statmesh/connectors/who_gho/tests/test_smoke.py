import httpx
import pytest

from statmesh.core.connector import load_connector
from statmesh.core.http import HttpClient
from statmesh.core.models import FetchRequest
from statmesh.core.schema import validate_table
from statmesh.settings import Settings


@pytest.mark.live
@pytest.mark.enable_socket
def test_life_expectancy_live():
    s = Settings.from_env()
    c = load_connector("who_gho", s)
    req = FetchRequest("gho", ("WHOSIS_000001",), geos=("IND",))
    t = c.normalize(next(iter(c.fetch(req, HttpClient(c.manifest, s)))))
    validate_table(t)
    assert t.num_rows >= 1


@pytest.mark.live
@pytest.mark.enable_socket
def test_legacy_host_answers_or_fails_loudly():
    # No skip: if the legacy OData host stops answering (WHO has announced a Data Hub
    # replacement), this must go red so the connector port is not missed.
    endpoint = load_connector("who_gho", Settings.from_env()).manifest.endpoint
    r = httpx.get(f"{endpoint}/Indicator", params={"$top": "1"}, timeout=30, follow_redirects=True)
    assert r.status_code == 200, f"WHO GHO legacy host {endpoint} returned {r.status_code}"
    assert r.json().get("value"), f"WHO GHO legacy host {endpoint} returned no indicators"


@pytest.mark.live
@pytest.mark.enable_socket
def test_live_doctor():
    from statmesh.doctor import check

    r = check("who_gho")
    if r.status == "skip":
        pytest.skip(r.detail)
    assert r.status == "ok", r.detail
