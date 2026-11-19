from datetime import UTC, date, datetime, timedelta

import pytest

from statmesh.core.catalog import Catalog
from statmesh.core.models import DatasetMeta, Licence, Manifest, RawChunk, SeriesMeta

SRC_LIC = Licence(name="CC BY", url="https://cc", redistribute="yes", attribution="Src")
FRED_LIC = Licence(name="Copyright", url="https://c", redistribute="no", attribution="Pub")
NOW = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)


@pytest.fixture
def cat(tmp_path):
    c = Catalog(tmp_path / "catalog.sqlite")
    c.upsert_source(Manifest(id="src", name="Src", kind="custom", licence=SRC_LIC))
    yield c
    c.close()


def _datasets():
    return [
        DatasetMeta(
            "src", "D1", "Labour force", SRC_LIC, freq="A",
            series=(
                SeriesMeta("UNEMP", "Unemployment rate", "share of labour force jobless",
                           synonyms=("jobless",), unit="percent", freq="A",
                           geos=("IND", "BGD"), start=date(2000, 1, 1)),
                SeriesMeta("GDP", "Gross domestic product", freq="A", licence=FRED_LIC),
            ),
        ),
        DatasetMeta("src", "D2", "Housing prices catalogue", SRC_LIC),
    ]  # fmt: skip


def test_pragmas_and_version(cat):
    c = cat.conn()
    assert c.execute("PRAGMA user_version").fetchone()[0] == 1
    assert c.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert c.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_discovery_and_fts(cat):
    assert cat.upsert_discovery("src", _datasets(), core=["D1"]) == 2
    assert cat.get_dataset("src", "D1")["is_core"] == 1
    assert cat.get_dataset("src", "D2")["status"] == "remote"
    assert cat.get_source("src")["discovered_at"]
    hits = cat.fts('"unemployment"')
    assert [h["series_key"] for h in hits] == ["src:D1:UNEMP"]
    assert hits[0]["score"] > 0 and hits[0]["geos"] == "IND BGD"
    assert cat.fts('"jobless"')[0]["series_key"] == "src:D1:UNEMP"  # synonym column
    assert cat.fts('"housing"')[0]["series_key"] == "src:D2"  # dataset-level row
    assert cat.fts('"unemployment"', geo="IND") and not cat.fts('"unemployment"', geo="USA")
    assert cat.fts('"unemployment"', freq="A") and not cat.fts('"unemployment"', freq="M")
    assert not cat.fts('"unemployment"', source="other")
    assert cat.fts('"gross"', geo="USA")  # unknown geo coverage is not excluded


def test_rediscovery_prunes_and_keeps_state(cat):
    cat.upsert_discovery("src", _datasets(), core=[])
    cat.set_dataset_status("src", "D1", "ingested", ingested_at=NOW)
    ds = _datasets()
    ds[0] = DatasetMeta("src", "D1", "Labour force v2", SRC_LIC, series=ds[0].series[:1])
    assert cat.upsert_discovery("src", ds, core=["D1"]) == 1
    assert cat.get_series("src:D1:GDP") is None
    d = cat.get_dataset("src", "D1")
    assert d["title"] == "Labour force v2" and d["status"] == "ingested"
    assert d["last_ingested_at"] == "2026-11-19T12:00:00Z"
    assert not cat.fts('"gross"')  # FTS rebuilt


def test_licence_inheritance(cat):
    cat.upsert_discovery("src", _datasets(), core=[])
    assert cat.get_series("src:D1:UNEMP")["licence_name"] is None
    assert cat.licence_for("src:D1:UNEMP") == SRC_LIC
    assert cat.licence_for("src:D1:GDP") == FRED_LIC
    assert cat.licence_for("src:D2") == SRC_LIC
    with pytest.raises(KeyError):
        cat.licence_for("nope:D:I")


def test_unknown_source_rejected(cat):
    with pytest.raises(KeyError):
        cat.upsert_discovery("zzz", [], core=[])


def test_codelists_and_lineage(cat):
    cat.upsert_codelist(
        "src", "CL_AREA", [("IN", "India", "IND", "iso3"), ("XX", None, None, None)]
    )
    cat.upsert_codelist("src", "CL_AREA", [("IN", "India!", "IND", "iso3")])
    rows = cat.conn().execute("SELECT label FROM codelists WHERE code='IN'").fetchall()
    assert rows[0][0] == "India!"
    cat.upsert_discovery("src", _datasets(), core=[])
    chunk = RawChunk("src", "D1", b"x", "text/csv", "https://u", {"a": "1"}, NOW)
    cat.add_lineage(
        run_id="r1", kind="ingest", chunk=chunk, raw_path="raw/a", connector_version=1, parts=["p"]
    )
    i2 = cat.add_lineage(
        run_id="r2", kind="ondemand", chunk=chunk, raw_path="raw/b", connector_version=1, parts=[]
    )
    assert cat.latest_lineage("src", "D1")["id"] == i2
    assert cat.latest_lineage("src", "nope") is None


def test_jobs(cat):
    assert cat.get_job("src", "D1") is None
    cat.set_job("src", "D1", next_run_at="2026-11-19T11:00:00Z", attempts=1)
    cat.set_job("src", "D2", next_run_at="2026-11-19T13:00:00Z")
    cat.set_job("src", "D3", next_run_at="2026-11-19T10:00:00Z", state="running")
    assert [j["dataset_id"] for j in cat.due_jobs(NOW)] == ["D1"]
    cat.set_job("src", "D1", state="failed", last_error="boom")
    assert cat.get_job("src", "D1")["attempts"] == 1
    with pytest.raises(ValueError):
        cat.set_job("src", "D1", bogus=1)


def test_cache_entries(cat):
    cat.put_cache("k", "src", "D1", "{}", "cache/obs/k.parquet", 3, NOW + timedelta(days=1))
    assert cat.get_cache("k", NOW)["rows"] == 3
    assert cat.get_cache("k", NOW + timedelta(days=2)) is None
    assert [e["key"] for e in cat.expired_cache(NOW + timedelta(days=2))] == ["k"]
    assert cat.expired_cache(NOW) == []
    cat.delete_cache("k")
    assert cat.get_cache("k", NOW) is None


def test_rate_counters(cat):
    assert cat.rate_count("src", "day", "w") == 0
    assert [cat.rate_incr("src", "day", "w") for _ in range(3)] == [1, 2, 3]
    assert cat.rate_count("src", "day", "w") == 3 and cat.rate_count("src", "hour", "w") == 0


def test_readonly_reader(cat, tmp_path):
    cat.upsert_discovery("src", _datasets(), core=[])
    ro = Catalog(tmp_path / "catalog.sqlite", readonly=True)
    assert ro.list_sources()[0]["id"] == "src"
    with pytest.raises(Exception, match="readonly"):
        ro.set_job("src", "D1")
    ro.close()
