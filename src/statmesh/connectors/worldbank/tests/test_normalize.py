from statmesh.core.connector import load_connector
from statmesh.settings import Settings
from statmesh.testing.contract import ContractSuite  # noqa: F401  (suite lives in test_contract)
from statmesh.testing.fixtures import fixtures_dir, load_requests, replay_http


def test_aggregate_is_region_and_missing_skipped():
    s = Settings()
    c = load_connector("worldbank", s)
    req = load_requests(fixtures_dir("worldbank", s))[0]
    rows = [
        r for ch in c.fetch(req, replay_http("worldbank", s)) for r in c.normalize(ch).to_pylist()
    ]
    assert {r["geo"] for r in rows} == {"IND", "BGD", "VNM", "USA", "region:WLD"}
    assert all(r["value"] is not None for r in rows)
