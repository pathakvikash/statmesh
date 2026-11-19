import os

import pytest

from statmesh.core.connector import load_connector
from statmesh.core.http import HttpClient
from statmesh.core.models import FetchRequest
from statmesh.core.schema import validate_table
from statmesh.settings import Settings


@pytest.mark.live
@pytest.mark.enable_socket
def test_crude_live():
    if not os.environ.get("EIA_API_KEY"):
        pytest.skip("EIA_API_KEY not set")
    s = Settings.from_env()
    c = load_connector("eia", s)
    chunk = next(
        iter(c.fetch(FetchRequest("crude_oil_price", max_rows=5), HttpClient(c.manifest, s)))
    )
    t = c.normalize(chunk)
    validate_table(t)
    assert t.num_rows >= 1
