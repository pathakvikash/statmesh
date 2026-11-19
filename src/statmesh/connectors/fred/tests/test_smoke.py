import os

import pytest

from statmesh.core.connector import load_connector
from statmesh.core.http import HttpClient
from statmesh.settings import Settings


@pytest.mark.live
@pytest.mark.enable_socket
def test_live_copyright_mapping():
    """First keyed run verifies the (unverified) tag mapping: public domain -> yes, copyrighted
    (S&P 500 is 'Copyrighted: Citation Required') -> no or review."""
    if not os.environ.get("FRED_API_KEY"):
        pytest.skip("FRED_API_KEY not set")
    s = Settings.from_env()
    c = load_connector("fred", s)
    c.manifest = c.manifest.model_copy(update={"options": {"series": ["UNRATE", "SP500"]}})
    (ds,) = c.discover(HttpClient(c.manifest, s, None))
    got = {x.indicator_id: x.licence.redistribute for x in ds.series}
    assert got["UNRATE"] == "yes"
    assert got["SP500"] in ("no", "review")
