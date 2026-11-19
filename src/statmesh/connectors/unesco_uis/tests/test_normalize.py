import pytest

from statmesh.core.connector import load_connector
from statmesh.settings import Settings
from statmesh.testing.fixtures import fixtures_dir, load_requests, replay_http


def test_literacy_values_by_year():
    s = Settings()
    c = load_connector("unesco_uis", s)
    rows = [
        r
        for req in load_requests(fixtures_dir("unesco_uis", s))
        for ch in c.fetch(req, replay_http("unesco_uis", s))
        for r in c.normalize(ch).to_pylist()
    ]
    lit = {r["period_start"].year: r["value"] for r in rows if r["indicator_id"] == "LR.AG15T99"}
    assert lit == pytest.approx({2018: 93.2300033569336, 2019: 93.89262390136719})
    assert {r["geo"] for r in rows} == {"BRA"}
