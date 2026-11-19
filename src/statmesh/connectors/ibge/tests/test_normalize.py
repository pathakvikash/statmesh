from statmesh.core.connector import load_connector
from statmesh.settings import Settings
from statmesh.testing.fixtures import fixtures_dir, load_requests, replay_http


def test_header_row_skipped_and_population_value():
    s = Settings()
    c = load_connector("ibge", s)
    req = load_requests(fixtures_dir("ibge", s))[0]
    rows = [r for ch in c.fetch(req, replay_http("ibge", s)) for r in c.normalize(ch).to_pylist()]
    assert len(rows) == 2  # the header element is not an observation
    assert {r["geo"] for r in rows} == {"BRA"}
    assert {r["period_start"].year: r["value"] for r in rows} == {
        2018: 208494900.0,
        2019: 210147125.0,
    }
