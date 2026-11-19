from statmesh.core.connector import load_connector
from statmesh.settings import Settings
from statmesh.testing.fixtures import fixtures_dir, load_requests, replay_http


def test_asylum_totals_one_row_per_series_and_year():
    s = Settings()
    c = load_connector("unhcr", s)
    req = load_requests(fixtures_dir("unhcr", s))[0]
    rows = [r for ch in c.fetch(req, replay_http("unhcr", s)) for r in c.normalize(ch).to_pylist()]
    assert {r["geo"] for r in rows} == {"BRA", "KEN"}
    keys = [(r["series_id"], r["period_start"]) for r in rows]
    assert len(keys) == len(set(keys))
    bra_2022 = [r for r in rows if r["geo"] == "BRA" and r["period_start"].year == 2022]
    assert {r["indicator_id"]: r["value"] for r in bra_2022}["refugees"] == 67522.0
