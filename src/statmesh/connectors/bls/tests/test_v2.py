from datetime import date

from statmesh.core.connector import load_connector
from statmesh.core.http import HttpClient
from statmesh.core.models import FetchRequest
from statmesh.settings import Settings
from statmesh.testing.fixtures import ReplayTransport, fixtures_dir


def _client(key):
    s = Settings.from_env()
    c = load_connector("bls", s)
    t = ReplayTransport(fixtures_dir("bls", s), "replay-key")
    h = HttpClient(c.manifest, s, None, transport=t)
    h.key = key
    return c, h


def test_v2_uses_key_and_redacts_it():  # fixture is synthetic: v1 body replayed for the v2 URL
    c, h = _client("replay-key")
    req = FetchRequest("LN", start=date(2023, 1, 1), end=date(2024, 12, 31))
    (chunk,) = c.fetch(req, h)
    assert "/v2/" in chunk.url and chunk.params["registrationkey"] == "REDACTED"
    assert c.normalize(chunk).num_rows > 0


def test_keyless_is_v1():
    c, h = _client(None)
    (chunk,) = c.fetch(FetchRequest("LN", start=date(2023, 1, 1), end=date(2024, 12, 31)), h)
    assert "/v1/" in chunk.url and "registrationkey" not in chunk.params
