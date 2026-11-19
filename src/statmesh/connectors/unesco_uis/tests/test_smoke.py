import pytest

from statmesh.core.schema import validate_table
from statmesh.settings import Settings


@pytest.mark.live
@pytest.mark.enable_socket
def test_live_fetch_and_normalize():
    from statmesh.core.connector import load_connector
    from statmesh.core.http import HttpClient
    from statmesh.testing.fixtures import fixtures_dir, load_requests

    s = Settings.from_env()
    c = load_connector("unesco_uis", s)
    http = HttpClient(c.manifest, s)
    if c.manifest.auth == "free_key" and not http.key:
        pytest.skip("API key not set")
    req = load_requests(fixtures_dir("unesco_uis", s))[0]
    chunk = next(iter(c.fetch(req, http)))
    validate_table(c.normalize(chunk), chunk.table)
