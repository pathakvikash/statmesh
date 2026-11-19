import dataclasses
import json

import pytest

from statmesh.core.connector import load_connector
from statmesh.core.models import FetchRequest
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
    # float32 artefacts are rounded to 6 significant digits (93.2300033569336 -> 93.23)
    assert lit == {2018: 93.23, 2019: 93.8926}
    assert {r["geo"] for r in rows} == {"BRA"}
    assert {r["unit"] for r in rows} == {None}  # the sample has no indicatorMetadata unit


def test_unit_comes_from_indicator_metadata_when_present():
    s = Settings()
    c = load_connector("unesco_uis", s)
    req = load_requests(fixtures_dir("unesco_uis", s))[0]
    ch = next(iter(c.fetch(req, replay_http("unesco_uis", s))))
    body = json.loads(ch.content)
    body["indicatorMetadata"] = [
        {"indicatorId": body["records"][0]["indicatorId"], "unit": "Ratio"}
    ]
    units = c.normalize(dataclasses.replace(ch, content=json.dumps(body).encode())).column("unit")
    assert set(units.to_pylist()) == {"Ratio"}


def test_missing_geo_asks_for_a_country():
    s = Settings()
    c = load_connector("unesco_uis", s)
    with pytest.raises(ValueError, match="pass geo=<ISO3>"):
        list(c.fetch(FetchRequest("education"), replay_http("unesco_uis", s)))
