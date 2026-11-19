"""Q3 shape: SIC per company + revenue across two consecutive years, offline."""

from datetime import date

from statmesh.core.connector import load_connector
from statmesh.core.models import FetchRequest
from statmesh.settings import Settings
from statmesh.testing.fixtures import replay_http

S = Settings.from_env()
CIKS = "789019,796343,1341439"


def _rows(dataset, **filters):
    c, http = load_connector("sec_edgar", S), replay_http("sec_edgar", S)
    req = FetchRequest(dataset, filters=filters)
    rows = [r for ch in c.fetch(req, http) for r in c.normalize(ch).to_pylist()]
    return [{**r, "dims": dict(r.get("dims") or [])} for r in rows]


def test_frames_two_years_and_sic():
    rev = {}
    for per in ("CY2023", "CY2024"):
        for r in _rows("frames", period=per):
            rev.setdefault((r["dims"]["cik"], r["dims"]["frame"]), set()).add(r["value"])
    assert rev[("0000789019", "CY2024")] == {245122000000.0}
    assert rev[("0000789019", "CY2023")] == {211915000000.0}
    assert len(rev[("0001341439", "CY2024")]) == 1  # Revenues and RFCWCEAA agree for Oracle
    ent = _rows("entities", ciks=CIKS)
    assert {e["industry_code"] for e in ent if "name" in e} == {"7372"}


def test_frames_period_explicit():
    r = _rows("frames", period="CY2024")[0]
    assert r["period_start"] < r["period_end"] and r["obs_status"] is None  # source gave `start`


def test_frames_use_source_start_and_loc():
    adobe = [r for r in _rows("frames", period="CY2024") if r["dims"]["cik"] == "0000796343"]
    assert {(r["period_start"], r["geo"]) for r in adobe} == {(date(2023, 12, 2), "USA")}
    from statmesh.connectors.sec_edgar.connector import _loc_geo

    assert [_loc_geo(x) for x in ("US-WA", "GB", "CA-ON", "ZZ", None)] == [
        "USA", "GBR", "CAN", "unmapped:ZZ", "unmapped:unknown",
    ]  # fmt: skip


def test_companyconcept_dims_are_identity_only():
    rows = _rows("companyconcept", ciks=CIKS)
    assert rows and all(set(r["dims"]) == {"cik"} for r in rows)


def test_sec_fixtures_flag_trimmed_not_synthetic():
    import json

    from statmesh.testing.fixtures import fixtures_dir

    metas = [
        json.loads(p.read_text()) for p in (fixtures_dir("sec_edgar", S) / "http").glob("*.json")
    ]
    ok = [m for m in metas if m["status"] == 200]
    assert ok and all(m["trimmed"] and not m["synthetic"] for m in ok)


def test_companyconcept_keeps_latest_filing_per_period():
    rows = [r for r in _rows("companyconcept", ciks=CIKS) if r["freq"] == "A"]
    keys = [(r["indicator_id"], r["dims"]["cik"], r["period_start"], r["period_end"]) for r in rows]
    assert rows and len(keys) == len(set(keys))
    assert any(r["period_end"] == date(2024, 6, 30) and r["value"] == 245122000000.0 for r in rows)


def test_frame_periods_explicit_range_or_latest_complete_year():
    from statmesh.connectors.sec_edgar.connector import frame_periods

    assert frame_periods("CY2024Q2I", date(2020, 1, 1), None) == ["CY2024Q2I"]  # filter wins
    assert frame_periods(None, date(2022, 6, 1), date(2024, 3, 1)) == ["CY2022", "CY2023", "CY2024"]
    assert frame_periods(None, None, date(2021, 1, 1)) == ["CY2021"]
    assert frame_periods(None, None, None) == [f"CY{date.today().year - 1}"]
    assert frame_periods(None, date(2024, 1, 1), None)[0] == "CY2024"
