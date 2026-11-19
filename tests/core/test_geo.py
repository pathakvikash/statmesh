import pytest

from statmesh.core.geo import (
    find_geos_in_text,
    geo_name,
    group_members,
    is_valid_geo,
    load_geo_map,
    to_geo,
)


def test_to_geo_schemes():
    assert to_geo("IN", "iso2") == "IND"
    assert to_geo("ind", "iso3") == "IND"
    assert to_geo("356", "m49") == "IND"
    assert to_geo("4", "m49") == "AFG"
    assert to_geo("India", "name") == "IND"
    assert to_geo("Viet Nam", "name") == "VNM"
    assert to_geo("Vietnam", "name") == "VNM"
    assert to_geo("WLD", "iso3") == "region:WLD"
    assert to_geo("ZZ", "iso2") == "unmapped:ZZ"
    assert to_geo("Atlantis", "name") == "unmapped:Atlantis"
    assert to_geo("999", "m49") == "unmapped:999"


def test_to_geo_overrides_win():
    assert to_geo("699", "m49", {"699": "IND"}) == "IND"
    assert to_geo("AFE", "iso3", {"AFE": "region:SSF"}) == "region:SSF"


def test_to_geo_bad_scheme():
    with pytest.raises(ValueError):
        to_geo("x", "nope")  # type: ignore[arg-type]


def test_load_geo_map(tmp_path):
    assert load_geo_map(tmp_path) == {}
    (tmp_path / "geo_map.csv").write_text("src_code,geo\n699,IND\nAFE,region:SSF\n")
    assert load_geo_map(tmp_path) == {"699": "IND", "AFE": "region:SSF"}


@pytest.mark.parametrize(
    ("geo", "ok"),
    [
        ("IND", True), ("XXX", False), ("region:WLD", True), ("region:NOPE", False),
        ("IN-MH", True), ("IN-ZZ", False), ("unmapped:abc", True), ("unmapped:", False),
        ("india", False), ("", False),
    ],
)  # fmt: skip
def test_is_valid_geo(geo, ok):
    assert is_valid_geo(geo) is ok


def test_names_groups_and_text():
    assert geo_name("IND") == "India"
    assert geo_name("region:WLD") == "World"
    assert geo_name("IN-MH").startswith("Mah")
    assert len(group_members("G20")) == 19 and "IND" in group_members("G20")
    assert len(group_members("EU27")) == 27 and group_members("NOPE") == []
    geos, rest = find_geos_in_text("unemployment in India, Bangladesh and Vietnam since 2015")
    assert geos == ["IND", "BGD", "VNM"]
    assert rest == "unemployment in , and since 2015"
    assert find_geos_in_text("Papua New Guinea exports")[0] == ["PNG"]
    assert find_geos_in_text("Niger vs Nigeria")[0] == ["NER", "NGA"]
    assert find_geos_in_text("Indiana jobs")[0] == []
    assert find_geos_in_text("US exports")[0] == ["USA"]


def test_lgd_state():
    from statmesh.core.geo import _rows

    rows = _rows("geo/in_states.csv")
    assert len(rows) == 36 and all(is_valid_geo(r["iso"]) for r in rows)
    assert len({r["iso"] for r in rows}) == 36
    assert to_geo("27", "lgd_state") == "IN-MH" and to_geo("IN-KA", "lgd_state") == "IN-KA"
    # spellings seen in MoSPI PLFS/CPI responses, plus old names
    for name, iso in [
        ("Jammu & Kashmir", "IN-JK"), ("Andaman & Nicobar Islands", "IN-AN"),
        ("Dadra & Nagar Haveli & Daman & Diu", "IN-DH"), ("Dadra and Nagar Haveli and Daman and Diu", "IN-DH"),
        ("Orissa", "IN-OD"), ("pondicherry", "IN-PY"),
        ("Delhi", "IN-DL"), ("Ladakh", "IN-LA"),
    ]:  # fmt: skip
        assert to_geo(name, "lgd_state") == iso
    assert to_geo("Atlantis", "lgd_state") == "unmapped:Atlantis"


def test_pre_2020_daman_dadra_not_merged():
    for n in ("Daman & Diu", "Daman and Diu", "Dadra & Nagar Haveli", "Dadra and Nagar Haveli"):
        assert to_geo(n, "lgd_state") == f"unmapped:{n}"
