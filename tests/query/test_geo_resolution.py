"""Geo arguments: ISO3, ISO alpha-2 and country names resolve to the catalogue code; a comma list in
search never leaks into a series id."""

import pytest

from statmesh import service

from .test_paging_and_partial import data  # noqa: F401


@pytest.mark.parametrize("g", ["IND", "IN", "in", "India", "india"])
def test_observations_accept_code_alpha2_and_name(data, g):  # noqa: F811
    r = service.get_observations("open:D:U1", geo=g)
    assert r.status == "ok" and len(r.rows) == 3


def test_geo_in_series_id_is_resolved(data):  # noqa: F811
    assert len(service.get_observations("open:D:U1:India").rows) == 3
    assert service.get_observations("open:D:U1:IN").series_id == "open:D:U1:IND"


def test_united_states_alias(data):  # noqa: F811
    assert len(service.get_observations("open:D:U1", geo="United States").rows) == 3
    assert len(service.get_observations("open:D:U1", geo="US").rows) == 3


def test_unknown_geo_lists_close_matches(data):  # noqa: F811
    with pytest.raises(ValueError, match=r"unknown geo 'Indai'.*India"):
        service.get_observations("open:D:U1", geo="Indai")
    with pytest.raises(ValueError, match="unknown geo"):
        service.get_observations("open:D:U1", geo="bad!")


def test_search_geo_name_and_alpha2(data):  # noqa: F811
    ids = {h.series_id for h in service.search_series("unemployment", geo="India").hits}
    assert ids and all(i.endswith(":IND") for i in ids)
    assert {h.series_id for h in service.search_series("unemployment", geo="IN").hits} == ids


def test_search_geo_list_has_no_suffix(data):  # noqa: F811
    for g in ("IND,USA", "India, US"):
        ids = [h.series_id for h in service.search_series("unemployment", geo=g).hits]
        assert len(ids) == 5 and all(i.count(":") == 2 for i in ids)
    with pytest.raises(ValueError, match="unknown geo"):
        service.search_series("unemployment", geo="IND,ZZZZ")


def test_region_names_and_lowercase_subnational(data):  # noqa: F811
    eng = service._engine()
    assert service._resolve_geo(eng, "us-ca") == "US-CA"
    assert service._resolve_geo(eng, "region:emu") == "region:EMU"
    assert service._resolve_geo(eng, "euro area") == "region:EMU"
    assert service._resolve_geo(eng, "World") == "region:WLD"
    with pytest.raises(ValueError) as e:
        service._resolve_geo(eng, "Wrld")
    assert "did you mean World" in str(e.value) and "Wrld?" not in str(e.value)


def test_search_geo_list_dedupes_and_filter_wins_over_q(data):  # noqa: F811
    ids = {h.series_id for h in service.search_series("unemployment", geo="IND,India").hits}
    assert ids and all(i.endswith(":IND") for i in ids)  # one geo: suffix kept
    got = service.search_series("unemployment in India", geo="IND,USA").hits
    assert len(got) == 5 and all(h.series_id.count(":") == 2 for h in got)
