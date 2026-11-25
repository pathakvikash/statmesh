import json
from datetime import UTC, date, datetime

from statmesh.core.connector import load_connector
from statmesh.core.models import FetchRequest, RawChunk
from statmesh.settings import Settings
from statmesh.testing.fixtures import replay_http


def _rows(overrides):
    base = {"Value": 10.5, "DHS_CountryCode": "IA", "SurveyYear": 2020, "SurveyYearLabel": "2019-21",
            "SurveyType": "DHS", "IndicatorId": "CN_NUTS_C_HA2", "CharacteristicCategory": "Total",
            "CharacteristicLabel": "Total", "ByVariableLabel": ""}  # fmt: skip
    return [{**base, **o} for o in overrides]


def _norm(overrides):
    c = load_connector("dhs", Settings.from_env())
    body = json.dumps({"Data": _rows(overrides)}).encode()
    chunk = RawChunk(
        "dhs", "indicators", body, "application/json", "u", {}, datetime(2026, 1, 1, tzinfo=UTC)
    )
    return c.normalize(chunk).to_pylist()


def test_geo_period_dims_and_drops():
    rows = _norm([
        {},
        {"CharacteristicCategory": "Residence", "CharacteristicLabel": "Rural"},
        {"CharacteristicCategory": "Region", "CharacteristicLabel": "..Bihar"},
        {"CharacteristicCategory": "Region", "CharacteristicLabel": "New Delhi"},
        {"CharacteristicCategory": "Region", "CharacteristicLabel": "Bihar, inc Jharkhand"},  # composite
        {"CharacteristicCategory": "Birth interval", "CharacteristicLabel": "First birth"},  # not kept
        {"Value": ""},  # unpublished
        {"ByVariableLabel": "Five years preceding the survey"},
    ])  # fmt: skip
    assert [(r["geo"], dict(r["dims"])) for r in rows] == [
        ("IND", {}), ("IND", {"residence": "Rural"}), ("IN-BR", {}), ("IN-DL", {}),
        ("IND", {"by": "Five years preceding the survey"}),
    ]  # fmt: skip
    assert (rows[0]["period_start"], rows[0]["period_end"]) == (
        date(2019, 1, 1),
        date(2021, 12, 31),
    )
    assert rows[0]["unit"] == "percent"


def test_span_labels():
    c = load_connector("dhs", Settings.from_env())
    span = lambda lab, y: c._span({"SurveyYearLabel": lab, "SurveyYear": y})
    assert span("1998-99", 1999) == (date(1998, 1, 1), date(1999, 12, 31))
    assert span("2015", 2015) == (date(2015, 1, 1), date(2015, 12, 31))
    assert span("1999-00", 2000) == (date(1999, 1, 1), date(2000, 12, 31))


def test_subnational_geo_fetches_country_and_filters_to_states():
    s = Settings.from_env()
    c = load_connector("dhs", s)
    req = FetchRequest("indicators", ("CN_NUTS_C_HA2", "CM_ECMR_C_U5M"), geos=("IN-BR",),
                       start=date(2015, 1, 1))  # fmt: skip
    rows = [r for ch in c.fetch(req, replay_http("dhs", s)) for r in c.normalize(ch).to_pylist()]
    assert rows and {r["geo"] for r in rows} == {"IN-BR"}


def test_jk_composite_is_whole_state_before_2019_and_skips_are_logged(caplog):
    jk = {"CharacteristicCategory": "Region", "CharacteristicLabel": "Jammu, Kashmir & Ladakh"}
    old = _norm([{**jk, "SurveyYear": 2016, "SurveyYearLabel": "2015-16"}])
    assert [r["geo"] for r in old] == ["IN-JK"]
    new = _norm([{**jk, "SurveyYear": 2020, "SurveyYearLabel": "2019-21"},
                 {"CharacteristicCategory": "Region", "CharacteristicLabel": "..Jammu & Kashmir"}])  # fmt: skip
    assert [r["geo"] for r in new] == ["IN-JK"]  # only the post-split J&K row
    assert "Jammu, Kashmir & Ladakh" in caplog.text
