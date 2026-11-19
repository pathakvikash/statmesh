import pytest

from statmesh.core.connector import load_connector
from statmesh.core.http import HttpClient
from statmesh.core.models import FetchRequest
from statmesh.core.schema import validate_table
from statmesh.settings import Settings


@pytest.mark.live
@pytest.mark.enable_socket
def test_live_fetch():
    c = load_connector("owid", Settings())
    req = FetchRequest("grapher", ("road-traffic-deaths-to-alcohol",))
    chunk = next(iter(c.fetch(req, HttpClient(c.manifest, Settings()))))
    table = c.normalize(chunk)
    validate_table(table)
    assert table.num_rows
