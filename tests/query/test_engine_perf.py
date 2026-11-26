"""Engine performance guards: window pushdown, manifest reuse, metadata cache, warm start.
Fixtures are synthetic (written by the test)."""

import re
from datetime import UTC, date, datetime

import pyarrow as pa
from fastapi.testclient import TestClient

from statmesh import service
from statmesh.api.app import create_app
from statmesh.core.schema import OBS_SCHEMA
from statmesh.core.storage import Storage
from statmesh.query.engine import _q
from statmesh.settings import Settings

TS = datetime(2026, 1, 1, tzinfo=UTC)


def _rows(ds, ind, n, ts=TS, geo="AFG"):
    return [{
        "series_id": f"s:{ds}:{ind}:{geo}", "source_id": "s", "dataset_id": ds,
        "indicator_id": ind, "geo": geo, "period_start": date(1900 + i, 1, 1),
        "period_end": date(1900 + i, 12, 31), "freq": "A", "value": float(i), "unit": "u",
        "unit_mult": 0, "dims": [], "obs_status": None, "retrieved_at": ts, "vintage": None,
    } for i in range(n)]  # fmt: skip


def _put(st, key, rows, tag):
    with st.update_manifest() as m:
        m["obs"][key] = st.write_parts(
            pa.Table.from_pylist(rows, schema=OBS_SCHEMA), f"obs/{key}", tag
        )


def _cache(st, rows, tag):
    with st.update_manifest() as m:
        m["cache"]["s/A"] = st.write_parts(
            pa.Table.from_pylist(rows, schema=OBS_SCHEMA), "cache/obs/s/A", tag
        )


def _setup(tmp_path):
    st = Storage(tmp_path)
    _put(st, "s/A", _rows("A", "I", 5), "r1")
    _put(st, "s/B", _rows("B", "J", 3000), "r1")
    _cache(st, _rows("A", "I", 5, datetime(2026, 2, 1, tzinfo=UTC)), "c1")  # overlaps ingested
    service.configure(Settings(data_dir=tmp_path))
    return st, service._engine()


def test_filter_pushed_below_dedup_window_and_results_identical(tmp_path):
    st, eng = _setup(tmp_path)
    con = eng._ensure().cursor()
    plan = con.sql(
        "EXPLAIN ANALYZE SELECT * FROM observations "
        "WHERE source_id='s' AND dataset_id='A' AND indicator_id='I'"
    ).fetchall()[0][1]
    scanned = max(int(x.replace(",", "")) for x in re.findall(r"([\d,]+) rows", plan))
    assert scanned < 3000  # B's 3000 rows are not read (was: every part)
    # old key (series_id only) gives the same set as the new one
    m = st.read_manifest()
    fs = lambda sec: "[" + ",".join(_q(str(st.abs(p))) for v in m[sec].values() for p in v) + "]"
    old = (
        "SELECT * EXCLUDE (_src,_rn) FROM (SELECT *, row_number() OVER (PARTITION BY "
        "series_id, period_start, freq, CAST(dims AS VARCHAR) ORDER BY _src, retrieved_at DESC) "
        f"_rn FROM (SELECT *, 0 _src FROM read_parquet({fs('obs')}) UNION ALL BY NAME "
        f"SELECT *, 1 _src FROM read_parquet({fs('cache')}))) WHERE _rn=1"
    )
    q = "SELECT * EXCLUDE (retrieved_at) FROM observations"
    new = con.sql(q).fetchall()
    import duckdb

    c2 = duckdb.connect()
    ref = c2.sql(f"SELECT * EXCLUDE (retrieved_at) FROM ({old})").fetchall()
    assert sorted(map(str, new)) == sorted(map(str, ref)) and len(new) == 3005


def test_manifest_reused_until_changed(tmp_path):
    st, eng = _setup(tmp_path)
    eng._ensure()
    calls = []
    real = st.read_manifest
    eng.storage.read_manifest = lambda: calls.append(1) or real()
    for _ in range(5):
        eng._ensure()
        eng.observations("s:A:I")
    assert calls == []  # unchanged file: no re-parse
    _put(st, "s/C", _rows("C", "K", 4), "r1")
    assert len(eng.observations("s:C:K")[1]) == 4  # ingest seen
    assert calls


def test_new_and_rewritten_parts_seen_with_metadata_cache(tmp_path):
    st, eng = _setup(tmp_path)
    assert len(eng.observations("s:B:J")[1]) == 3000
    assert eng._ensure().sql("SELECT current_setting('parquet_metadata_cache')").fetchall()[0][0]
    _put(st, "s/B", _rows("B", "J", 10), "r2")  # replace parts
    assert len(eng.observations("s:B:J")[1]) == 10


def test_lifespan_warms_views_and_survives_empty_dir(tmp_path):
    service.configure(Settings(data_dir=tmp_path))
    with TestClient(create_app()) as c:
        assert service._engine()._con is not None
        assert c.get("/healthz").status_code == 200
