from datetime import UTC, datetime

import pyarrow as pa
import pytest

from statmesh.core.schema import ENTITIES_SCHEMA, validate_table
from statmesh.ingest.xref import match_cik_to_lei, normalize_name

T = datetime(2026, 11, 19, tzinfo=UTC)


def ent(eid, name, state=None, zip_=None, country="USA", address=None):
    attrs = {k: v for k, v in (("state", state), ("postcode", zip_)) if v}
    return {"entity_id": eid, "source_id": "x", "name": name, "country": country,
            "industry_code": None, "industry_scheme": None, "address": address,
            "attrs": attrs, "retrieved_at": T}  # fmt: skip


def run(*rows):
    t = pa.Table.from_pylist(list(rows), schema=ENTITIES_SCHEMA)
    out = match_cik_to_lei(t)
    validate_table(out, "entity_xref")
    return {(r["from_id"], r["to_id"]): round(r["confidence"], 2) for r in out.to_pylist()}, out


@pytest.mark.parametrize(
    "a,b",
    [
        ("Apple Inc.", "APPLE INC"),
        ("Apple Incorporated", "Apple Inc."),
        ("Microsoft Corp", "MICROSOFT CORPORATION"),
        ("The Coca-Cola Company", "Coca Cola Co"),
        ("AT&T Inc.", "AT and T Inc"),
        ("Johnson & Johnson", "JOHNSON AND JOHNSON"),
        ("Exxon Mobil Corp /NJ/", "EXXON MOBIL CORPORATION"),
        ("Nestlé S.A.", "Nestle SA"),
        ("Foo Holdings, Ltd.", "FOO HOLDINGS LIMITED"),
    ],
)
def test_normalize_equal(a, b):
    assert normalize_name(a) == normalize_name(b)


@pytest.mark.parametrize(
    "a,b", [("Apple Inc", "Apple Hospitality Inc"), ("Acme Holdings Inc", "Acme Inc")]
)
def test_normalize_differs(a, b):
    assert normalize_name(a) != normalize_name(b)


def test_exact_name_and_state():
    m, out = run(
        ent("cik:1", "Apple Inc.", "CA", "95014"), ent("lei:A", "APPLE INC", "CA", "95014-1")
    )
    assert m == {("cik:1", "lei:A"): 0.9}
    assert out["inferred"].to_pylist() == [True]


def test_suffix_variant_and_punctuation():
    m, _ = run(ent("cik:1", "Microsoft Corp", "WA"), ent("lei:M", "MICROSOFT CORPORATION", "WA"))
    assert m == {("cik:1", "lei:M"): 0.9}
    m, _ = run(ent("cik:2", "AT&T Inc."), ent("lei:T", "AT AND T, INCORPORATED"))
    assert m == {("cik:2", "lei:T"): 0.6}  # name only


def test_legal_address_state_counts():  # Delaware shell address vs SEC business address
    lei = ent("lei:A", "Foo Inc", "CA")
    lei["attrs"] = {"state": "CA", "legal_state": "DE"}
    m, _ = run(ent("cik:1", "Foo Inc", "DE"), lei)
    assert m == {("cik:1", "lei:A"): 0.9}


def test_state_parsed_from_address():
    m, _ = run(
        ent("cik:1", "Foo Inc", address="1 Main St, Austin, TX 78701"),
        ent("lei:A", "Foo Inc", "TX"),
    )
    assert m == {("cik:1", "lei:A"): 0.9}


def test_address_mismatch_lowers_confidence():
    m, _ = run(ent("cik:1", "Foo Inc", "CA", "90001"), ent("lei:A", "Foo Inc", "NY", "10001"))
    assert m == {("cik:1", "lei:A"): 0.4}


def test_same_name_different_state_picks_matching_one():
    m, _ = run(
        ent("cik:1", "Foo Inc", "CA"), ent("lei:A", "Foo Inc", "NY"), ent("lei:B", "Foo Inc.", "CA")
    )
    assert m == {("cik:1", "lei:B"): 0.9}


def test_ambiguous_candidates_no_link():
    m, _ = run(
        ent("cik:1", "Foo Inc", "CA"), ent("lei:A", "Foo Inc", "CA"), ent("lei:B", "FOO INC", "CA")
    )
    assert m == {}
    m, _ = run(ent("cik:1", "Foo Inc"), ent("lei:A", "Foo Inc"), ent("lei:B", "Foo Corp"))
    assert m == {}  # tied name-only candidates


def test_different_country_not_a_candidate():
    m, _ = run(ent("cik:1", "Foo Inc", "CA"), ent("lei:A", "Foo Inc", country="GBR"))
    assert m == {}


def test_different_names_and_empty():
    m, out = run(ent("cik:1", "Apple Inc"), ent("lei:A", "Apple Hospitality Inc"))
    assert m == {} and out.num_rows == 0
    assert run()[0] == {}


def test_deterministic_and_ignores_non_cik_non_lei():
    rows = [ent("cik:2", "Bar Corp", "TX"), ent("cik:1", "Foo Inc", "CA"),
            ent("lei:B", "Bar Corporation", "TX"), ent("lei:A", "Foo Inc.", "CA"),
            ent("isin:1", "Foo Inc", "CA")]  # fmt: skip
    m1, o1 = run(*rows)
    _, o2 = run(*reversed(rows))
    assert m1 == {("cik:1", "lei:A"): 0.9, ("cik:2", "lei:B"): 0.9}
    assert o1.equals(o2)


def test_uk_name_and_postcode_match_and_registered_as_wins():
    uk = ent("uk:445790", "Tesco PLC", country="GBR")
    uk["attrs"] = {"postcode": "ab1 2cd"}
    other = ent("lei:O", "Tesco", country="GBR")
    other["attrs"] = {"postcode": "AB1 2CD"}
    m, _ = run(uk, other)
    assert m == {("uk:445790", "lei:O"): 0.9}  # name + compacted postcode
    reg = ent("lei:R", "Tesco Stores Holdings", country="GBR")
    reg["attrs"] = {"registered_as": "445790"}
    m, _ = run(uk, other, reg)
    assert m == {("uk:445790", "lei:R"): 1.0}  # registered_as is exact, beats the name match
