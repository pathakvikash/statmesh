import os
from pathlib import Path

import pytest
import yaml

from statmesh.core.catalog import Catalog
from statmesh.core.models import DatasetMeta, Licence, Manifest, SeriesMeta
from statmesh.search.eval import evaluate, run
from statmesh.search.search import search, synonyms

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
