from datetime import date

import pytest

from statmesh.connectors.mospi.connector import _period
from statmesh.core.connector import load_connector
from statmesh.core.models import FetchRequest
from statmesh.settings import Settings
from statmesh.testing.fixtures import replay_http

_LIM = {"limit": "20"}
# (dataset, indicator, filters as recorded, expected unit, expected geo of the first row, period_start)
CASES = [
    ("isp_annual", (), {"year": "2025-26", **_LIM}, "index", "IND", date(2025, 4, 1)),
    ("isp_monthly", (), {"year": "2025-26", "month_code": "1", **_LIM}, "index", "IND", date(2025, 4, 1)),
    ("sppi", ("banking",), _LIM, "index", "IND", date(2026, 4, 1)),
    ("cpialrl", ("general",), {"year": "2025", "state_code": "1", **_LIM}, "index", "IN-AP", date(2025, 12, 1)),
    ("envstats", ("forest_area",), _LIM, "Sq. Km.", "IN-AN", date(2005, 1, 1)),
    ("gender_stats", ("life_expectancy_state",), _LIM, "years", "IND", date(2016, 1, 1)),
    ("tus", ("pct_major",), {"year": "2024", **_LIM}, "percent", "IND", date(2024, 1, 1)),
    ("asuse_annual", ("gva_per_worker",), {"year": "2023-24", "state_ut_code": "1", **_LIM}, "INR", "IN-AP", date(2023, 4, 1)),
    ("asuse_quarterly", ("establishments",), _LIM, "hundreds", "IND", date(2026, 1, 1)),
    ("nss72t_tourism", ("overnight_trips",), _LIM, "In ‘00", "IND", date(2014, 7, 1)),
]  # fmt: skip


@pytest.mark.parametrize("ds,inds,filters,unit,geo,start", CASES, ids=[c[0] for c in CASES])
def test_family_replays_with_period_geo_and_unit(ds, inds, filters, unit, geo, start):
    s = Settings.from_env()
    c = load_connector("mospi", s)
    http = replay_http("mospi", s)
    assert ds in {d.dataset_id for d in c.discover(http)}
    req = FetchRequest(ds, indicator_ids=inds, filters=filters, max_rows=20)
    rows = [r for ch in c.fetch(req, http) for r in c.normalize(ch).to_pylist()]
    first = rows[0]
    assert (first["geo"], first["period_start"], first["unit"]) == (geo, start, unit)
    # pre-2020 Daman & Diu / Dadra & Nagar Haveli stay unmapped (see test_contract)
    unmapped = {r["geo"] for r in rows if r["geo"].startswith("unmapped")}
    assert unmapped <= {"unmapped:Dadra and Nagar Haveli", "unmapped:Daman and Diu"}


def test_period_kinds_cover_the_odd_year_labels():
    assert _period("fym", {"year": "2025-26", "month": "January"}, "year")[:2] == (
        date(2026, 1, 1),
        date(2026, 1, 31),
    )
    # ASUSE annual: a bare year is a calendar year (no overlap with quarterly JAN-MAR 2025)
    assert _period("span", {"y": "2025"}, "y")[:2] == (date(2025, 1, 1), date(2025, 12, 31))
    assert _period("span", {"y": "2023-24"}, "y")[:2] == (date(2023, 4, 1), date(2024, 3, 31))
    assert _period("span", {"y": "1951"}, "y")[:2] == (date(1951, 1, 1), date(1951, 12, 31))
    assert _period("span", {"y": "2016-20"}, "y")[:2] == (date(2016, 1, 1), date(2020, 12, 31))
    assert _period("span", {"y": "2022-23"}, "y")[:2] == (date(2022, 4, 1), date(2023, 3, 31))
    assert _period("span", {"y": "July 2014 - June 2015"}, "y")[:2] == (
        date(2014, 7, 1),
        date(2015, 6, 30),
    )
    assert _period("cyq", {"year": "2026", "quarter": "JAN-MAR"}, "year")[0] == date(2026, 1, 1)
