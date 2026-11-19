# ruff: noqa: F811
import time
from datetime import UTC, datetime

import pyarrow as pa
import pytest

from statmesh import service
from statmesh.core.catalog import Catalog
from statmesh.core.models import DatasetMeta, Licence, Manifest, SeriesMeta
from statmesh.core.schema import OBS_SCHEMA
from statmesh.core.storage import Storage
from statmesh.query import QueryEngine, QueryError, SqlRejected, check
from statmesh.settings import Settings

from .test_query import NO, YES, data_dir, engine, obs_table  # noqa: F401

REVIEW = Licence(name="Rev", url="https://r", redistribute="review", attribution="Rev Org")


@pytest.mark.parametrize(
    "sql",
    [
        # CTE defined in a subquery must not whitelist its name outside it
        'SELECT count(*) FROM (WITH "/x/*.parquet" AS (SELECT 1) SELECT 1), "/x/*.parquet"',
        "SELECT count(*) FROM (WITH foo AS (SELECT 1) SELECT 1), foo",
        'SELECT * FROM "/etc/passwd"',
        "SELECT * FROM _denied_series",
        "SELECT * FROM duckdb_views()",
        "SELECT current_setting('allowed_directories')",
        "SELECT pg_get_viewdef(o) FROM (SELECT unnest(range(0,100000)) o) WHERE pg_get_viewdef(o) IS NOT NULL",
        "SELECT format_type(25, NULL)",
        "SELECT obj_description(1)",
        "SELECT col_description(1, 1)",
        "SELECT has_table_privilege('observations', 'select')",
        "SELECT pg_typeof(1)",
        "WITH _denied_series AS (SELECT * FROM _denied_series) SELECT * FROM _denied_series",
        "WITH duckdb_views AS (SELECT * FROM duckdb_views) SELECT * FROM duckdb_views",
        "WITH sqlite_master AS (SELECT * FROM sqlite_master) SELECT * FROM sqlite_master",
        "WITH sqlite_schema AS (SELECT * FROM sqlite_schema) SELECT * FROM sqlite_schema",
        "WITH duckdb_tables AS (SELECT * FROM duckdb_tables) SELECT * FROM duckdb_tables",
        "WITH duckdb_columns AS (SELECT * FROM duckdb_columns) SELECT * FROM duckdb_columns",
        "WITH duckdb_databases AS (SELECT * FROM duckdb_databases) SELECT * FROM duckdb_databases",
        "WITH pragma_database_list AS (SELECT * FROM pragma_database_list) SELECT * FROM pragma_database_list",
        "WITH a AS (SELECT * FROM sqlite_master), sqlite_master AS (SELECT 1) SELECT * FROM a",
        "WITH RECURSIVE duckdb_views AS (SELECT * FROM duckdb_views) SELECT * FROM duckdb_views",
        "WITH RECURSIVE _denied_series AS (SELECT 1 x UNION ALL SELECT * FROM _denied_series) SELECT * FROM _denied_series",
        "WITH sqlite_master AS (SELECT 1) SELECT * FROM (WITH b AS (SELECT * FROM sqlite_master) SELECT * FROM b)",
        "WITH x AS (SELECT 1) SELECT (WITH duckdb_views AS (SELECT * FROM duckdb_views) SELECT count(*) FROM duckdb_views)",
        "WITH _evil AS (SELECT 1) SELECT * FROM _evil",
        "SELECT " + "(" * 3000 + "1" + ")" * 3000,
    ],
)
def test_sqlsafe_rejects(sql):
    with pytest.raises(SqlRejected):
        check(sql)


def test_cte_still_visible_in_own_scope():
    check("WITH a AS (SELECT 1 x), b AS (SELECT * FROM a) SELECT * FROM (SELECT * FROM b)")
    check("SELECT * FROM (WITH a AS (SELECT 1 x) SELECT * FROM a)")
    check("WITH RECURSIVE t AS (SELECT 1 x UNION ALL SELECT x+1 FROM t WHERE x<3) SELECT * FROM t")


def test_hosted_exploit_cannot_read_closed_source(data_dir):
    e = engine(data_dir, mode="hosted")
    f = next((data_dir / "obs" / "closed" / "D").glob("*.parquet"))
    with pytest.raises(SqlRejected):
        e.execute(f'SELECT count(*) FROM (WITH "{f}" AS (SELECT 1) SELECT 1), "{f}"')
    with pytest.raises(QueryError):  # engine layer alone: exact allowed_paths
        e._run(f"SELECT count(*) FROM read_parquet('{f}')", None, 10)


def test_retrieved_at_is_utc_under_host_tz(data_dir, monkeypatch):
    monkeypatch.setenv("TZ", "Asia/Kolkata")
    time.tzset()
    try:
        _, rows, _ = engine(data_dir).execute("SELECT retrieved_at FROM observations LIMIT 1")
    finally:
        monkeypatch.undo()
        time.tzset()
    assert rows[0][0] == datetime(2026, 1, 1)


def test_huge_values_abort_with_query_error(data_dir):
    e = engine(data_dir, sql_max_bytes=1_000_000)
    with pytest.raises(QueryError, match="larger than"):
        e.execute("SELECT repeat('x', 5000000) FROM (VALUES (1),(2),(3)) v(a)")


def _remote(tmp_path, status="remote", lic=YES):
    cat = Catalog(tmp_path / "catalog.sqlite")
    cat.upsert_source(Manifest(id="rem", name="Rem", kind="custom", licence=lic))
    cat.upsert_discovery(
        "rem",
        [
            DatasetMeta(
                "rem", "D", "d", lic, series=(SeriesMeta("UNEMP", "Unemployment", freq="A"),)
            )
        ],
        core=[],
    )
    cat.set_dataset_status("rem", "D", status)
    cat.close()


def _cache_part(tmp_path, run, value, ts, geos=("IND",)):
    t = obs_table("rem", "D", "UNEMP", geos, years=(2020,))
    t = t.set_column(t.schema.get_field_index("value"), "value", pa.array([value] * len(geos)))
    t = t.set_column(
        t.schema.get_field_index("retrieved_at"),
        OBS_SCHEMA.field("retrieved_at"),
        pa.array([ts] * len(geos), OBS_SCHEMA.field("retrieved_at").type),
    )
    st = Storage(tmp_path)
    with st.update_manifest() as m:
        m["cache"].setdefault("rem/D", []).extend(
            st.write_parts(t, "cache/obs/rem/D", run, prefix=run)
        )


def test_cache_parts_dedupe_latest_wins(tmp_path):
    _remote(tmp_path)
    _cache_part(tmp_path, "a", 7.1, datetime(2026, 1, 1, tzinfo=UTC))
    _cache_part(tmp_path, "b", 9.9, datetime(2026, 2, 1, tzinfo=UTC), geos=("IND", "USA"))
    _, rows, _ = QueryEngine(Settings(data_dir=tmp_path)).execute(
        "SELECT geo, value FROM observations ORDER BY geo"
    )
    assert rows == [["IND", 9.9], ["USA", 9.9]]


def test_cache_ignored_for_ingested_dataset(tmp_path):
    _remote(tmp_path, status="ingested")
    _cache_part(tmp_path, "a", 7.1, datetime(2026, 1, 1, tzinfo=UTC))
    assert (
        QueryEngine(Settings(data_dir=tmp_path)).execute("SELECT count(*) FROM observations")[1][0][
            0
        ]
        == 0
    )


def test_cache_loses_to_ingested_row(tmp_path):
    _remote(tmp_path, status="stale")
    st = Storage(tmp_path)
    t = obs_table("rem", "D", "UNEMP", ["IND"], years=(2020,))  # value 1.0, 2026-01-01
    with st.update_manifest() as m:
        m["obs"]["rem/D"] = st.write_parts(t, "obs/rem/D", "r1")
    _cache_part(tmp_path, "a", 7.1, datetime(2026, 5, 1, tzinfo=UTC))
    _, rows, _ = QueryEngine(Settings(data_dir=tmp_path)).execute("SELECT value FROM observations")
    assert rows == [[1.0]]


def test_hosted_licence_most_specific_wins(tmp_path):
    cat = Catalog(tmp_path / "catalog.sqlite")
    for sid, lic in (("rv", REVIEW), ("ok", YES)):
        cat.upsert_source(Manifest(id=sid, name=sid, kind="custom", licence=lic))
    cat.upsert_discovery(
        "rv",
        [
            DatasetMeta(
                "rv",
                "D",
                "rv data",
                REVIEW,
                series=(
                    SeriesMeta("PUB", "Public rate", freq="A", licence=YES),
                    SeriesMeta("PRIV", "Private rate", freq="A"),
                ),
            )
        ],
        core=[],
    )
    cat.upsert_discovery(
        "ok",
        [
            DatasetMeta(
                "ok",
                "D",
                "ok data",
                YES,
                series=(
                    SeriesMeta("PUB", "Public rate", freq="A"),
                    SeriesMeta("PRIV", "Private rate", freq="A", licence=NO),
                ),
            )
        ],
        core=[],
    )
    for sid in ("rv", "ok"):
        cat.set_dataset_status(sid, "D", "ingested")
    cat.close()
    st = Storage(tmp_path)
    with st.update_manifest() as m:
        for sid in ("rv", "ok"):
            t = pa.concat_tables([obs_table(sid, "D", i, ["IND"]) for i in ("PUB", "PRIV")])
            m["obs"][f"{sid}/D"] = st.write_parts(t, f"obs/{sid}/D", "r1")
    service.configure(Settings(data_dir=tmp_path, mode="hosted"))
    sql = service.run_sql("SELECT DISTINCT series_id FROM observations ORDER BY 1")
    assert [r[0] for r in sql.rows] == ["ok:D:PUB:IND", "rv:D:PUB:IND"]
    assert {h.series_id for h in service.search_series("Public rate").hits} == {
        "ok:D:PUB",
        "rv:D:PUB",
    }  # no geo known: series_key form
    service.describe_series("rv:D:PUB")
    for bad in ("rv:D:PRIV", "ok:D:PRIV"):
        with pytest.raises(KeyError):
            service.describe_series(bad)
    assert service.get_observations("rv:D:PUB:IND").status == "ok"
    assert service.get_observations("ok:D:PRIV:IND").status == "forbidden"
    assert {s.id for s in service.list_sources()} == {"rv", "ok"}
    assert {s.id: s.series for s in service.list_sources()} == {"rv": 1, "ok": 1}


def test_limit_and_geo_validation(data_dir):
    service.configure(Settings(data_dir=data_dir))
    for bad in (-1, 0, 10**9):
        with pytest.raises(ValueError):
            service.get_observations("open:D:UNEMP", limit=bad)
        with pytest.raises(ValueError):
            service.search_series("x", limit=bad)
    with pytest.raises(ValueError, match="unknown geo"):
        service.get_observations("open:D:UNEMP", geo="../x")
    assert service.get_observations("open:D:UNEMP", geo="IND", limit=2).truncated


def test_observation_citation_has_retrieved_at(data_dir):
    service.configure(Settings(data_dir=data_dir))
    r = service.get_observations("open:D:UNEMP:IND")
    assert r.citations[0].retrieved_at == datetime(2026, 1, 1)


def test_filters_validated_and_scope_rows(data_dir):
    service.configure(Settings(data_dir=data_dir))
    with pytest.raises(ValueError):
        service.get_observations("open:D:UNEMP", filters={"a b": "x"})
    with pytest.raises(ValueError):
        service.parse_filters(["nokey"])
    assert service.parse_filters(["partner=USA", "hs=85"]) == {"partner": "USA", "hs": "85"}
    with pytest.raises(ValueError, match="filter not supported"):  # no row here has a partner dim
        service.get_observations("open:D:UNEMP", filters={"partner": "USA"})


def test_startup_requires_contact_email_for_sec(tmp_path):
    with pytest.raises(ValueError, match="STATMESH_CONTACT_EMAIL"):
        Settings(data_dir=tmp_path).validate()
    Settings(data_dir=tmp_path, contact_email="a@b.c").validate()
    Settings(data_dir=tmp_path, disabled=frozenset({"sec_edgar"})).validate()


@pytest.mark.parametrize("v", ["a/b", "a\\b", "a?b", "a#b", "a%2Fb", "..", "a..b", "x" * 257])
def test_filter_values_are_path_safe(v):
    with pytest.raises(ValueError):
        service._check_filters({"k": v})
    assert service._check_filters({"k": "USA+CAN, 85.1:x-y_z"})


@pytest.mark.parametrize("v", [".", " . ", "A,.", "A+.", "A, .,B"])
def test_filter_lone_dot_segment_rejected(v):
    with pytest.raises(ValueError):
        service._check_filters({"k": v})


def test_read_filter_narrows_on_any_dims_key_and_rejects_unknown(tmp_path):
    cat = Catalog(tmp_path / "catalog.sqlite")
    cat.upsert_source(Manifest(id="open", name="o", kind="custom", licence=YES))
    cat.upsert_discovery(
        "open",
        [DatasetMeta("open", "D", "d", YES, series=(SeriesMeta("UNEMP", "U", freq="A"),))],
        core=[],
    )
    cat.set_dataset_status("open", "D", "ingested")
    cat.close()
    rows = obs_table("open", "D", "UNEMP", ["IND"]).to_pylist()
    for i, r in enumerate(rows):
        r["dims"] = {"sex": "M" if i else "F"}
    st = Storage(tmp_path)
    with st.update_manifest() as m:
        m["obs"]["open/D"] = st.write_parts(
            pa.Table.from_pylist(rows, schema=OBS_SCHEMA), "obs/open/D", "r1"
        )
    e = engine(tmp_path)
    assert len(e.observations("open:D:UNEMP", filters={"sex": "M"})[1]) == 2
    with pytest.raises(ValueError, match="filter not supported"):
        e.observations("open:D:UNEMP", filters={"nope": "x"})
    assert e.observations("open:D:UNEMP", filters={"nope": "x"}, strict=False)


def test_truncated_dataset_warns_on_reads(data_dir):
    cat = Catalog(data_dir / "catalog.sqlite")
    cat.set_truncated("open", "D", True)
    cat.close()
    service.configure(Settings(data_dir=data_dir))
    r = service.get_observations("open:D:UNEMP:IND")
    assert "open/D" in r.warning
    q = service.run_sql("SELECT * FROM observations WHERE source_id='open' LIMIT 3")
    assert "open/D" in q.warning
    assert "open/D" not in (service.get_observations("closed:D:UNEMP:IND").warning or "")
