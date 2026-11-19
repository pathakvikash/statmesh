import time
from datetime import UTC, date, datetime

import pyarrow as pa
import pytest

from statmesh.core.catalog import Catalog
from statmesh.core.models import DatasetMeta, Licence, Manifest, SeriesMeta
from statmesh.core.schema import OBS_SCHEMA, validate_table
from statmesh.core.storage import Storage
from statmesh.query import QueryEngine, SqlRejected, SqlTimeout, check
from statmesh.settings import Settings

YES = Licence(name="CC BY", url="https://cc", redistribute="yes", attribution="Open Org")
NO = Licence(name="Closed", url="https://c", redistribute="no", attribution="Closed Org")
TS = datetime(2026, 1, 1, tzinfo=UTC)


def obs_table(source, dataset, indicator, geos, years=(2020, 2021, 2022)):
    rows = []
    for g in geos:
        for i, y in enumerate(years):
            rows.append({
                "series_id": f"{source}:{dataset}:{indicator}:{g}", "source_id": source,
                "dataset_id": dataset, "indicator_id": indicator, "geo": g,
                "period_start": date(y, 1, 1), "period_end": date(y, 12, 31), "freq": "A",
                "value": float(i + 1), "unit": "pct", "unit_mult": 0, "dims": [],
                "obs_status": None, "retrieved_at": TS, "vintage": None,
            })  # fmt: skip
    t = pa.Table.from_pylist(rows, schema=OBS_SCHEMA)
    validate_table(t)
    return t


@pytest.fixture
def data_dir(tmp_path):
    cat = Catalog(tmp_path / "catalog.sqlite")
    for sid, lic in (("open", YES), ("closed", NO)):
        cat.upsert_source(Manifest(id=sid, name=sid.title(), kind="custom", licence=lic))
        cat.upsert_discovery(
            sid,
            [DatasetMeta(sid, "D", f"{sid} data", lic, source_url=f"https://{sid}.example",
                         series=(SeriesMeta("UNEMP", "Unemployment", freq="A"),
                                 SeriesMeta("GDP", "GDP", freq="A")))],
            core=[],
        )  # fmt: skip
        cat.set_dataset_status(sid, "D", "ingested")
    cat.close()
    st = Storage(tmp_path)
    with st.update_manifest() as m:
        for sid, geos in (("open", ["IND", "USA"]), ("closed", ["IND"])):
            t = pa.concat_tables(
                [obs_table(sid, "D", "UNEMP", geos), obs_table(sid, "D", "GDP", geos)]
            )
            m["obs"][f"{sid}/D"] = st.write_parts(t, f"obs/{sid}/D", "r1")
    return tmp_path


def engine(data_dir, **kw):
    return QueryEngine(Settings(data_dir=data_dir, **kw))


def test_views_and_cross_source_join(data_dir):
    e = engine(data_dir)
    cols, rows, trunc = e.execute(
        "SELECT a.geo, a.value AS o, b.value AS c FROM observations a JOIN observations b "
        "ON a.geo=b.geo AND a.period_start=b.period_start "
        "WHERE a.source_id='open' AND b.source_id='closed' AND a.indicator_id='UNEMP' "
        "AND b.indicator_id='UNEMP' ORDER BY 2"
    )
    assert cols == ["geo", "o", "c"] and len(rows) == 3 and not trunc
    assert e.execute("SELECT count(*) FROM observations_vintages")[1][0][0] == 18
    assert e.execute("SELECT count(*) FROM series")[1][0][0] == 4
    assert e.execute("SELECT count(*) FROM datasets")[1][0][0] == 2
    assert e.execute("SELECT count(*) FROM sources")[1][0][0] == 2
    assert e.execute("SELECT count(*) FROM entities")[1][0][0] == 0  # empty but typed
    assert e.execute("SELECT name, iso2, m49 FROM geos WHERE geo='IND'")[1] == [
        ["India", "IN", 356]
    ]
    assert e.execute("SELECT count(*) FROM geo_groups WHERE group_id='G20'")[1][0][0] > 5
    assert e.execute("SELECT 1 AS x, 'a' AS y")[0] == ["x", "y"]  # no FROM at all


def test_observations_helper(data_dir):
    e = engine(data_dir)
    cols, rows, _ = e.observations("open:D:UNEMP")
    assert len(rows) == 6 and "value" in cols
    _, rows, _ = e.observations("open:D:UNEMP:IND", start=date(2021, 1, 1))
    assert len(rows) == 2
    _, rows, _ = e.observations("open:D:UNEMP", geo="USA", end=date(2020, 12, 31))
    assert len(rows) == 1
    _, rows, trunc = e.observations("open:D:UNEMP", limit=2)
    assert len(rows) == 2 and trunc


def test_row_cap(data_dir):
    _, rows, trunc = engine(data_dir, sql_max_rows=5).execute("SELECT * FROM observations")
    assert len(rows) == 5 and trunc
    _, rows, trunc = engine(data_dir, sql_max_rows=18).execute("SELECT * FROM observations")
    assert len(rows) == 18 and not trunc


def test_rebuilds_when_manifest_changes(data_dir):
    e = engine(data_dir)
    assert e.execute("SELECT count(*) FROM observations")[1][0][0] == 18
    st = Storage(data_dir)
    with st.update_manifest() as m:
        m["obs"]["open/D"] += st.write_parts(
            obs_table("open", "D", "NEW", ["IND"]), "obs/open/D", "r2"
        )
    assert e.execute("SELECT count(*) FROM observations")[1][0][0] == 21


def test_hosted_mode_filters_closed_licences(data_dir):
    e = engine(data_dir, mode="hosted")
    assert e.execute("SELECT DISTINCT source_id FROM observations")[1] == [["open"]]
    assert e.execute("SELECT DISTINCT source_id FROM observations_vintages")[1] == [["open"]]
    assert e.execute("SELECT id FROM sources")[1] == [["open"]]
    assert e.execute("SELECT DISTINCT source_id FROM datasets")[1] == [["open"]]
    assert e.execute("SELECT DISTINCT source_id FROM series")[1] == [["open"]]
    assert e.observations("closed:D:UNEMP")[1] == []


def test_hosted_series_level_denial(data_dir):
    cat = Catalog(data_dir / "catalog.sqlite")
    cat.upsert_discovery(
        "open",
        [DatasetMeta("open", "D", "d", YES, series=(
            SeriesMeta("UNEMP", "Unemployment"), SeriesMeta("GDP", "GDP", licence=NO)))],
        core=[],
    )  # fmt: skip
    cat.close()
    e = engine(data_dir, mode="hosted")
    assert e.execute("SELECT DISTINCT indicator_id FROM observations")[1] == [["UNEMP"]]
    assert engine(data_dir).execute("SELECT count(DISTINCT indicator_id) FROM observations")[1] == [
        [2]
    ]


def test_rebuilds_when_catalog_changes(data_dir):
    e = engine(data_dir)
    assert e.execute("SELECT count(*) FROM series")[1][0][0] == 4
    cat = Catalog(data_dir / "catalog.sqlite")
    cat.upsert_discovery("open", [DatasetMeta("open", "D", "d", YES, series=(
        SeriesMeta("UNEMP", "Unemployment"),))], core=[])  # fmt: skip
    cat.close()
    assert e.execute("SELECT count(*) FROM series")[1][0][0] == 3


# ---- safety -------------------------------------------------------------------------------

HOSTILE = [
    "SELECT * FROM read_parquet('/etc/passwd')",
    "SELECT * FROM read_csv('/etc/hosts')",
    "SELECT * FROM read_csv_auto('http://example.com/x.csv')",
    "SELECT * FROM read_json('/etc/hosts')",
    "SELECT * FROM read_text('/etc/hosts')",
    "SELECT * FROM glob('/*')",
    "SELECT * FROM parquet_scan('obs/*/*/*.parquet')",
    "SELECT * FROM '/etc/hosts'",
    "SELECT * FROM 'http://example.com/x.parquet'",
    "SELECT * FROM range(10)",
    "SELECT * FROM duckdb_settings()",
    "SELECT * FROM duckdb_tables()",
    "SELECT * FROM sqlite_master",
    "SELECT * FROM information_schema.tables",
    "SELECT * FROM system.main.duckdb_functions()",
    "SELECT * FROM observations, read_csv('/etc/hosts')",
    "SELECT (SELECT count(*) FROM read_csv('/etc/hosts'))",
    "SELECT * FROM (SELECT * FROM read_text('/etc/hosts'))",
    "SELECT * FROM observations WHERE series_id IN (SELECT * FROM glob('/*'))",
    "WITH x AS (SELECT * FROM read_csv('/etc/hosts')) SELECT * FROM x",
    "WITH x AS (SELECT * FROM secret_table) SELECT * FROM observations",
    "WITH x AS (SELECT 1) SELECT * FROM _t_sources",
    "SELECT * FROM _denied_series",
    "SELECT * FROM main._empty_observations",
    "SELECT * FROM memory.main.observations",
    "SELECT * FROM other.observations",
    "ATTACH '/tmp/x.db' AS x",
    "ATTACH 'http://example.com/x.db'",
    "COPY (SELECT 1) TO '/tmp/out.csv'",
    "COPY observations TO '/tmp/out.parquet'",
    "INSTALL httpfs",
    "LOAD httpfs",
    "PRAGMA database_list",
    "PRAGMA enable_external_access",
    "SET enable_external_access=true",
    "SET allowed_directories=['/']",
    "RESET enable_external_access",
    "CALL pragma_database_size()",
    "EXPORT DATABASE '/tmp/x'",
    "CREATE TABLE t AS SELECT 1",
    "CREATE VIEW v AS SELECT 1",
    "INSERT INTO sources VALUES (1)",
    "UPDATE observations SET value=0",
    "DELETE FROM observations",
    "DROP VIEW observations",
    "EXPLAIN SELECT 1",
    "DESCRIBE observations",
    "SHOW TABLES",
    "SELECT 1; SELECT 2",
    "SELECT 1; DROP VIEW observations",
    "SELECT 1; /* hidden */ ATTACH 'x.db'",
    "SELECT 1 -- x\n; INSTALL httpfs",
    "SELECT 1;; SELECT 2",
    "",
    "SELEC 1",
    "SELECT * FROM observations; COPY (SELECT 1) TO '/tmp/a'",
]


@pytest.mark.parametrize("sql", HOSTILE)
def test_hostile_sql_rejected(data_dir, sql):
    e = engine(data_dir)
    with pytest.raises(SqlRejected):
        e.execute(sql)
    with pytest.raises(SqlRejected):
        check(sql)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT 1 /* ; ATTACH 'x' */",
        "SELECT 1; -- trailing comment ; ATTACH 'x'",
        "SELECT ';'",
        "WITH x AS (SELECT * FROM observations) SELECT count(*) FROM x",
        "SELECT * FROM OBSERVATIONS LIMIT 1",
        "SELECT * FROM main.series s JOIN datasets d USING (source_id, dataset_id)",
        "SELECT * FROM (VALUES (1), (2)) v(a)",
        "SELECT a.geo FROM observations a WHERE a.series_id IN (SELECT series_key FROM series)",
    ],
)
def test_benign_sql_accepted(data_dir, sql):
    assert engine(data_dir).execute(sql)


def test_lockdown_holds_even_if_ast_check_is_bypassed(data_dir):
    """Layer 1 alone: the locked connection refuses files, ATTACH, COPY, INSTALL, SET."""
    import duckdb

    con = engine(data_dir)._ensure()
    for q in (
        "SELECT * FROM read_csv('/etc/hosts')",
        "SELECT * FROM read_parquet('/etc/hosts')",
        "ATTACH '/tmp/zz.db'",
        "COPY (SELECT 1) TO '/tmp/zz.csv'",
        "INSTALL httpfs",
        "SET enable_external_access=true",
        "SET allowed_directories=['/']",
    ):
        with pytest.raises(duckdb.Error):
            con.cursor().execute(q).fetchall()
    assert not (data_dir.parent / "zz.csv").exists()


def test_timeout_interrupts_runaway_query(data_dir):
    e = engine(data_dir, sql_timeout_s=0.5)
    t0 = time.monotonic()
    with pytest.raises(SqlTimeout):
        e.execute(
            "WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM t) SELECT count(*) FROM t"
        )
    assert time.monotonic() - t0 < 10
    assert e.execute("SELECT 1")[1] == [[1]]  # engine still usable


def test_runtime_error_is_valueerror(data_dir):
    with pytest.raises(ValueError):
        engine(data_dir).execute("SELECT nope FROM observations")


# ---- citations ----------------------------------------------------------------------------


def cite(e, sql):
    cols, rows, _ = e.execute(sql)
    return e.citations(sql, cols, rows)


def test_citations_from_series_id_column_cover_every_series(data_dir):
    e = engine(data_dir)
    cs, warn = cite(e, "SELECT series_id, value FROM observations")
    assert warn is None
    assert {c.series_id for c in cs} == {
        "open:D:UNEMP",
        "open:D:GDP",
        "closed:D:UNEMP",
        "closed:D:GDP",
    }
    c = next(c for c in cs if c.series_id == "open:D:UNEMP")
    assert c.attribution == "Open Org" and c.redistribute == "yes" and c.source_name == "Open"
    assert c.source_url == "https://open.example"


def test_citations_cross_source_join_and_aliases(data_dir):
    e = engine(data_dir)
    cs, _ = cite(
        e,
        "SELECT a.series_id AS x, b.series_id AS y FROM observations a JOIN observations b "
        "ON a.geo=b.geo AND a.period_start=b.period_start "
        "WHERE a.source_id='open' AND b.source_id='closed' AND a.indicator_id='UNEMP' "
        "AND b.indicator_id='UNEMP'",
    )
    assert {c.series_id for c in cs} == {"open:D:UNEMP", "closed:D:UNEMP"}


def test_citations_from_sql_literals_and_dataset_columns(data_dir):
    e = engine(data_dir)
    cs, _ = cite(e, "SELECT avg(value) FROM observations WHERE series_id='open:D:GDP:IND'")
    assert [c.series_id for c in cs] == ["open:D:GDP"]
    cs, _ = cite(e, "SELECT avg(value) AS v FROM observations WHERE source_id='closed'")
    assert [(c.source_id, c.dataset_id) for c in cs] == [("closed", "D")]
    cs, _ = cite(e, "SELECT DISTINCT source_id, dataset_id FROM observations")
    assert {(c.source_id, c.dataset_id) for c in cs} == {("open", "D"), ("closed", "D")}


def test_no_citations_gives_warning(data_dir):
    cs, warn = cite(engine(data_dir), "SELECT 1 AS one")
    assert cs == [] and "citations" in warn


def test_hosted_citations_skip_unservable_sources(data_dir):
    cs, _ = cite(engine(data_dir, mode="hosted"), "SELECT series_id FROM observations")
    assert {c.source_id for c in cs} == {"open"}
