import threading
from datetime import UTC, datetime

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from statmesh.core.models import RawChunk
from statmesh.core.schema import XREF_SCHEMA, empty_table
from statmesh.core.storage import Storage


def _xref(n: int) -> pa.Table:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    return pa.table(
        {"from_id": [f"a{i}" for i in range(n)], "to_id": ["b"] * n, "source_id": ["s"] * n,
         "confidence": [1.0] * n, "inferred": [False] * n, "retrieved_at": [now] * n},
        schema=XREF_SCHEMA,
    )  # fmt: skip


def test_raw_roundtrip(tmp_path):
    st = Storage(tmp_path)
    chunk = RawChunk("s", "d", b'{"a":1}', "application/json; charset=utf-8", "u", {},
                     datetime(2026, 11, 19, 1, 2, 3, tzinfo=UTC))  # fmt: skip
    rel = st.save_raw(chunk)
    assert str(rel).startswith("raw/s/d/20261119T010203Z-") and str(rel).endswith(".json.gz")
    assert st.read_raw(str(rel)) == b'{"a":1}'


def test_write_parts_splits_and_leaves_no_tmp(tmp_path):
    st = Storage(tmp_path)
    assert st.write_parts(empty_table("entity_xref"), "tables/entity_xref/s", "r1") == []
    parts = st.write_parts(_xref(5), "tables/entity_xref/s", "r1", max_rows=2)
    assert parts == [f"tables/entity_xref/s/part-r1-{n}.parquet" for n in range(3)]
    assert sum(pq.read_table(st.abs(p)).num_rows for p in parts) == 5
    assert not list(tmp_path.rglob("*.tmp"))
    vint = st.write_parts(_xref(1), "obs/s/d", "r2", prefix="vintage")
    assert vint == ["obs/s/d/vintage-r2-0.parquet"]


def test_manifest_defaults_and_versioning(tmp_path):
    st = Storage(tmp_path)
    assert st.read_manifest() == {
        "version": 0,
        "obs": {},
        "vintages": {},
        "tables": {},
        "cache": {},
    }
    assert st.manifest_mtime_ns() == 0
    with st.update_manifest() as m:
        m["obs"]["s/d"] = ["obs/s/d/part-r1-0.parquet"]
    assert st.read_manifest()["version"] == 1 and st.manifest_mtime_ns() > 0
    with st.update_manifest() as m:
        assert m["obs"]["s/d"]  # sees the previous state
    assert st.read_manifest()["version"] == 2


def test_failed_update_leaves_manifest_untouched(tmp_path):
    st = Storage(tmp_path)
    with st.update_manifest() as m:
        m["obs"]["s/d"] = ["x"]
    with pytest.raises(RuntimeError), st.update_manifest() as m:
        m["obs"]["s/d"] = ["changed"]
        raise RuntimeError("boom")
    assert st.read_manifest()["obs"]["s/d"] == ["x"]
    with st.update_manifest():  # lock was released
        pass


def test_delete_unreferenced(tmp_path):
    st = Storage(tmp_path)
    parts = st.write_parts(_xref(4), "obs/s/d", "r1", max_rows=2)
    st.delete_unreferenced("obs/s/d", parts[:1], grace_s=0)
    assert st.abs(parts[0]).exists() and not st.abs(parts[1]).exists()
    st.delete_unreferenced("obs/missing", [])  # no error


def test_reader_never_sees_a_missing_part(tmp_path):
    """Writer: write new part, swap manifest, delete parts older than the previous generation (a
    reader holding the previous manifest still finds its files). Reader: whatever manifest it
    reads, every part it lists must exist."""
    st = Storage(tmp_path)
    run = "r0"
    with st.update_manifest() as m:
        m["obs"]["s/d"] = st.write_parts(_xref(1), "obs/s/d", run)
    stop = threading.Event()
    errors: list[str] = []

    def reader():
        while not stop.is_set():
            for p in st.read_manifest()["obs"]["s/d"]:
                if not st.abs(p).exists():
                    errors.append(p)

    t = threading.Thread(target=reader)
    t.start()
    prev: list[str] = list(st.read_manifest()["obs"]["s/d"])
    for i in range(1, 60):
        new = st.write_parts(_xref(1), "obs/s/d", f"r{i}")
        with st.update_manifest() as m:
            m["obs"]["s/d"] = new
        st.delete_unreferenced("obs/s/d", new + prev)
        prev = new
    stop.set()
    t.join()
    assert errors == []
