import os
from pathlib import Path

import pytest
import yaml

from statmesh.core.catalog import Catalog
from statmesh.core.models import DatasetMeta, Licence, Manifest, SeriesMeta
from statmesh.search.eval import evaluate, run
from statmesh.search.search import _concepts, _rerank, detect_geos, parse_period, search, synonyms

LIC = Licence(name="CC BY", url="https://cc", redistribute="yes", attribution="S")


@pytest.fixture
def cat(tmp_path):
    c = Catalog(tmp_path / "c.sqlite")
    c.upsert_source(Manifest(id="s", name="S", kind="custom", licence=LIC))
    S = SeriesMeta
    c.upsert_discovery("s", [DatasetMeta("s", "D", "Indicators", LIC, series=(
        S("UE", "Unemployment, total (% of labour force)", geos=("IND", "VNM"), freq="A"),
        S("CPI", "Consumer price index inflation", geos=("USA", "GBR", "DEU"), freq="M"),
        S("EXP", "Exports of goods and services", geos=("IND", "USA")),
        S("POL", "Central bank policy rate", synonyms=("interest rate",)),
    ))], core=[])  # fmt: skip
    yield c
    c.close()


def keys(rows):
    return [r["series_key"] for r in rows]


def test_synonym_and_geo(cat):
    rows = search(cat, "jobless in India")
    assert keys(rows) == ["s:D:UE"]
    assert rows[0]["series_id"] == "s:D:UE:IND"


def test_geo_filter_excludes_other_countries(cat):
    assert "s:D:CPI" not in keys(search(cat, "inflation in India"))
    assert keys(search(cat, "inflation United States"))[0] == "s:D:CPI"


def test_group_does_not_append_geo(cat):
    rows = search(cat, "inflation G20")
    assert keys(rows) == ["s:D:CPI"] and rows[0]["series_id"] == "s:D:CPI"


def test_relaxed_retry(cat):
    # 'zzz' matches nothing, so the AND fails and the OR retry still finds unemployment
    assert keys(search(cat, "unemployment zzz")) == ["s:D:UE"]


def test_phrase_synonym(cat):
    assert keys(search(cat, "policy interest rate"))[0] == "s:D:POL"


def test_freq_and_source(cat):
    assert keys(search(cat, "inflation", freq="A")) == []
    assert keys(search(cat, "inflation", source="s")) == ["s:D:CPI"]
    assert search(cat, "inflation", source="other") == []


def test_empty_query(cat):
    assert search(cat, "") == [] and search(cat, "the of in") == []


@pytest.mark.parametrize(
    "q",
    [
        '"',
        '"unemployment',
        "unemployment*",
        "NEAR(a b)",
        "a:b",
        "title:x",
        "unemployment OR",
        "(",
        "-",
        "AND",
        "NOT",
        "^x",
        "'; DROP TABLE x",
    ],
)
def test_fts_injection_is_safe(cat, q):
    search(cat, q)  # must not raise sqlite3.OperationalError


def test_synonyms_size():
    assert len(synonyms()) >= 60


def test_eval_harness(cat, tmp_path):
    p = tmp_path / "q.yaml"
    p.write_text(yaml.safe_dump([
        {"q": "jobless India", "expected": ["s:D:UE"]},
        {"q": "exports", "expected": ["s:D:EXP"]},
        {"q": "inflation", "expected": ["s:D:NOPE"]},
    ]))  # fmt: skip
    recall, misses = evaluate(cat, p)
    assert recall == pytest.approx(2 / 3) and misses[0]["q"] == "inflation"
    assert run(cat, p) == recall


def test_real_questions_file_shape():
    qs = yaml.safe_load(Path("evals/search_questions.yaml").read_text())
    assert len(qs) >= 15
    assert all(q["q"] and all(k.count(":") == 2 for k in q["expected"]) for q in qs)


@pytest.mark.skipif(
    "STATMESH_EVAL_CATALOG" not in os.environ,
    reason="needs a catalog built from connector fixtures",
)
def test_recall_threshold_on_fixture_catalog():
    c = Catalog(Path(os.environ["STATMESH_EVAL_CATALOG"]), readonly=True)
    assert run(c, "evals/search_questions.yaml") >= 0.80


def _rank_cat(tmp_path, rows):
    c = Catalog(tmp_path / "r.sqlite")
    c.upsert_source(Manifest(id="s", name="S", kind="custom", licence=LIC))
    c.upsert_discovery("s", [DatasetMeta("s", "D", "D", LIC, series=tuple(
        SeriesMeta(i, t, geos=("NGA", "DEU")) for i, t in rows))], core=[])  # fmt: skip
    return c


def test_government_debt_percent_matches_gross_debt(tmp_path):
    c = _rank_cat(tmp_path, [("A", "Real interest rate (%)"),
                             ("B", "General government gross debt (% of GDP)")])  # fmt: skip
    assert keys(search(c, "government debt as percent of GDP"))[0] == "s:D:B"


def test_real_gdp_growth_not_real_interest_rate(tmp_path):
    c = _rank_cat(tmp_path, [("A", "Real interest rate (%)"), ("B", "GDP growth (annual %)")])  # fmt: skip
    assert keys(search(c, "real GDP growth"))[0] == "s:D:B"


def test_population_headline_first(tmp_path):
    c = _rank_cat(tmp_path, [("A", "Rural population"), ("B", "Population, total")])
    assert keys(search(c, "population of Nigeria"))[0] == "s:D:B"


def test_keep_filters_before_limit(tmp_path):
    c = _rank_cat(tmp_path, [(f"X{i}", f"Exports {i}") for i in range(30)])
    rows = search(c, "exports", limit=5, keep=lambda r: int(r["series_key"][5:]) >= 20)
    assert len(rows) == 5


def test_multi_source_filter_is_pushed_into_the_query(tmp_path):
    c = Catalog(tmp_path / "m.sqlite")
    S = SeriesMeta
    for sid, n in (("big", 5), ("small", 1), ("other", 1)):
        c.upsert_source(Manifest(id=sid, name=sid, kind="custom", licence=LIC))
        c.upsert_discovery(sid, [DatasetMeta(sid, "D", "D", LIC, series=tuple(
            S(f"X{i}", "Inflation inflation inflation" if sid == "big" else "Inflation rate")
            for i in range(n)
        ))], core=[])  # fmt: skip
    rows = search(c, "inflation", source=["small", "other"], pool=2)
    assert {r["source_id"] for r in rows} == {"small", "other"}
    rows = search(c, "", source=["small", "other"], pool=2, listing=True)
    assert {r["source_id"] for r in rows} == {"small", "other"}
    c.close()


def test_question_filler_is_not_a_concept():
    assert _concepts("how many did much every number of") == []


def test_parse_period_years_months_fiscal_quarters():
    period, rest = parse_period("population in January 2024")
    assert period == ("2024-01-01", "2024-01-31") and rest.split() == ["population", "in"]
    assert parse_period("gdp 2023-24")[0] == ("2023-04-01", "2024-03-31")
    assert parse_period("first quarter of 2023 gdp")[0] == ("2023-01-01", "2023-03-31")
    assert parse_period("Q4 2024")[0] == ("2024-10-01", "2024-12-31")
    assert parse_period("latest inflation")[0] is None
    assert "may" in parse_period("prices may rise")[1]  # 'may' is a verb unless a year follows


def test_people_rewrites_to_population_only_as_a_count():
    assert _concepts("how many people")[0][0] == "population"
    assert _concepts("number of people")[0][0] == "population"
    assert all("population" not in c for c in _concepts("people living with HIV"))


def test_euro_area_is_the_aggregate_region_unless_members_are_named():
    geos, rest = detect_geos("euro area inflation in the eurozone")
    assert geos == ["region:EMU"] and "euro" not in rest.lower()
    geos, _ = detect_geos("euro area countries inflation")
    assert {"DEU", "FRA", "ITA"} <= set(geos) and "region:EMU" not in geos
    assert {"DEU"} <= set(detect_geos("eurozone member states gdp")[0])


def test_words_removed_from_stopwords_stay_concepts():
    assert [c[0] for c in _concepts("sea level rise")] == ["sea", "level", "rise"]
    assert [c[0] for c in _concepts("live births")] == ["live", "births"]
    assert [c[0] for c in _concepts("early childhood education")] == [
        "early",
        "childhood",
        "education",
    ]


def test_trailing_headline_qualifier_is_dropped_leading_word_is_kept():
    out = _rerank([_row("Rate of change"), _row("Annual rate of change")], [["annual"]])
    assert out[0]["title"] == "Annual rate of change"
    out = _rerank([_row("Inflation, annual"), _row("Inflation rate")], [["inflation"]])
    assert [r["title"] for r in out] == ["Inflation, annual", "Inflation rate"]


def _row(title, **kw):
    return {
        "title": title,
        "score": 1.0,
        "source_id": "s",
        "start_date": None,
        "end_date": None,
        **kw,
    }


def test_literal_hit_beats_synonym_hit_even_when_synonym_leads():
    rows = [_row("People who identify condoms"), _row("Total population")]
    concepts = [["population", "people"]]
    assert _rerank(rows, concepts)[0]["title"] == "Total population"


def test_period_coverage_reorders_only():
    rows = [
        _row("Inflation A", start_date="2010-01-01", end_date="2012-12-31"),
        _row("Inflation B", start_date="2023-01-01", end_date="2024-12-31"),
    ]
    out = _rerank(rows, [["inflation"]], ("2024-01-01", "2024-01-31"))
    assert [r["title"] for r in out] == ["Inflation B", "Inflation A"] and len(out) == 2


def test_home_source_boost_reorders_without_filtering():
    rows = [
        _row("Gross domestic product", source_id="worldbank"),
        _row("Gross domestic product", source_id="bea"),
    ]
    out = _rerank(rows, [["gross domestic product"]], None, frozenset({"USA"}))
    assert [r["source_id"] for r in out] == ["bea", "worldbank"]
