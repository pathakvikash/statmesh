import os

import pytest

from statmesh.core.connector import load_connector
from statmesh.core.http import HttpClient
from statmesh.core.models import FetchRequest
from statmesh.core.schema import validate_table
from statmesh.settings import Settings


@pytest.mark.live
@pytest.mark.enable_socket
def test_nipa_live():
    if not os.environ.get("BEA_API_KEY"):
        pytest.skip("BEA_API_KEY not set")
    s = Settings.from_env()
    c = load_connector("bea", s)
    chunk = next(
        iter(c.fetch(FetchRequest("nipa", filters={"year": "2023"}), HttpClient(c.manifest, s)))
    )
    t = c.normalize(chunk)
    validate_table(t)
    assert t.num_rows >= 1
