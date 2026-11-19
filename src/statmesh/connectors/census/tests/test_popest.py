import pytest

from statmesh.core.connector import load_connector
from statmesh.core.models import FetchRequest
from statmesh.settings import Settings
from statmesh.testing.fixtures import replay_http


def rows(year):
    s = Settings.from_env()
    c = load_connector("census", s)
    req = FetchRequest("popest", geos=("USA", "US-AL"), filters={"year": year})
    return [r for ch in c.fetch(req, replay_http("census", s)) for r in c.normalize(ch).to_pylist()]


def test_vintage_2021_pop_2021_is_stored_as_pop():  # synthetic fixture, not live-verified
    out = {r["geo"]: r for r in rows("2021")}
    assert out["USA"]["indicator_id"] == "POP" and out["USA"]["value"] == 331893745.0
    assert str(out["US-AL"]["period_start"]) == "2021-07-01"


def test_vintage_2019_still_uses_date_code():
    assert {str(r["period_start"]) for r in rows("2019")} >= {"2010-07-01", "2019-07-01"}


def test_unsupported_vintage_is_refused():
    s = Settings.from_env()
    c = load_connector("census", s)
    with pytest.raises(ValueError, match="vintage 2023"):
        list(c.fetch(FetchRequest("popest", filters={"year": "2023"}), replay_http("census", s)))


def test_acs5_is_explicit_five_year_window():  # freq enum has no multi-year option: A + dims.window
    s = Settings.from_env()
    c = load_connector("census", s)
    http = replay_http("census", s)
    for d in c.discover(http):
        if d.dataset_id == "acs5":
            assert all("5-year estimate" in x.title for x in d.series)
    req = FetchRequest("acs5", geos=("USA",))
    r = next(r for ch in c.fetch(req, http) for r in c.normalize(ch).to_pylist())
    assert (str(r["period_start"]), str(r["period_end"])) == ("2019-01-01", "2023-12-31")
    assert r["freq"] == "A" and dict(r["dims"]) == {"window": "5y"}
