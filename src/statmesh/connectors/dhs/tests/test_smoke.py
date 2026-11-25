import pytest

from statmesh.core.connector import load_connector
from statmesh.core.http import HttpClient
from statmesh.core.models import FetchRequest
from statmesh.core.schema import validate_table
from statmesh.settings import Settings


@pytest.mark.live
@pytest.mark.enable_socket
def test_stunting_india_live():
    s = Settings.from_env()
    c = load_connector("dhs", s)
    req = FetchRequest("indicators", ("CN_NUTS_C_HA2",), geos=("IND",))
    t = c.normalize(next(iter(c.fetch(req, HttpClient(c.manifest, s)))))
    validate_table(t)
    assert t.num_rows >= 1
