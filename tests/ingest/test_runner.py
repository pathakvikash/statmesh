from datetime import UTC, datetime, timedelta

import pyarrow.parquet as pq

from statmesh.core.models import FetchRequest
from statmesh.core.storage import Storage
from statmesh.ingest.runner import discover, ingest, run_job

T0 = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)
ROWS = [["IND", "2022", 7.3], ["IND", "2023", 7.1], ["BGD", "2023", 5.1]]


def live(env):
    st = Storage(env.settings.data_dir)
    m = st.read_manifest()
    parts = m["obs"].get("fake/D", [])
    return [r for p in parts for r in pq.read_table(st.abs(p)).to_pylist()], m


def do_ingest(env, **kw):
    return ingest("fake", "D", env.settings, env.catalog, http=env.http, connector=env.conn, **kw)


def test_discover_fills_catalog(env):
    n = discover("fake", env.settings, env.catalog, http=env.http, connector=env.conn)
    assert n == 1
    assert env.catalog.get_dataset("fake", "D")["is_core"] == 1
    assert env.catalog.get_series("fake:D:X")["title"] == "X title"


def test_ingest_is_idempotent(env):
    env.rows = ROWS
    assert do_ingest(env) == 3 and do_ingest(env) == 3
    rows, m = live(env)
    assert len(rows) == 3 and m["vintages"].get("fake/D", []) == []
    assert m["version"] == 2
    ds = env.catalog.get_dataset("fake", "D")
    assert ds["status"] == "ingested" and ds["last_error"] is None
    assert env.catalog.latest_lineage("fake", "D")["raw_sha256"]


def test_swap_keeps_old_parts_until_next_run_and_failed_run_changes_nothing(env, monkeypatch):
    monkeypatch.setattr("statmesh.core.storage.GRACE_S", 0)  # production keeps fresh files 10 min
    env.rows = ROWS
    do_ingest(env)
    st = Storage(env.settings.data_dir)
    gen1 = set(st.read_manifest()["obs"]["fake/D"])
    env.rows = ROWS + [["IND", "2024", 7.0]]
    do_ingest(env)
    gen2 = set(st.read_manifest()["obs"]["fake/D"])
    assert gen1 != gen2 and all(st.abs(p).exists() for p in gen1 | gen2)  # old readers still work
    # a crash before the swap leaves the manifest (and the data) as it was
    before = st.read_manifest()
    env.conn.broken_normalize = True
    try:
        do_ingest(env)
    except ValueError:
        pass
    else:
        raise AssertionError("expected failure")
    assert st.read_manifest() == before and len(live(env)[0]) == 4
    env.conn.broken_normalize = False
    do_ingest(env)  # third swap: generation 1 is in neither manifest any more
    assert not any(st.abs(p).exists() for p in gen1 - set(st.read_manifest()["obs"]["fake/D"]))


def test_revision_creates_vintage(env):
    env.rows = ROWS
    do_ingest(env)
    env.rows = [["IND", "2023", 7.9]]
    do_ingest(env)
    rows, m = live(env)
    assert {(r["geo"], r["period_start"].year): r["value"] for r in rows}[("IND", 2023)] == 7.9
    assert len(rows) == 3
    st = Storage(env.settings.data_dir)
    [vp] = m["vintages"]["fake/D"]
    [old] = pq.read_table(st.abs(vp)).to_pylist()
    assert old["value"] == 7.1 and old["vintage"] == T0.date()


def test_reprocess_makes_no_http_call(env):
    env.rows = ROWS
    do_ingest(env)
    calls = env.calls
    env.rows = []
    assert do_ingest(env, reprocess=True) == 3
    assert env.calls == calls and len(live(env)[0]) == 3


def test_incremental_refresh_passes_watermark_and_unions(env):
    env.build(refresh={"schedule": "0 2 * * 1", "incremental": "updatedAfter"})
    env.rows = ROWS
    do_ingest(env, now=T0)
    env.rows = [["IND", "2024", 7.0]]
    do_ingest(env, now=T0 + timedelta(days=1))
    assert env.conn.requests[0].updated_after is None
    assert env.conn.requests[1].updated_after == T0
    assert len(live(env)[0]) == 4


def test_explicit_requests(env):
    env.rows = ROWS
    do_ingest(env, requests=[FetchRequest("D", ("X",), geos=("IND",))])
    assert env.conn.requests[0].geos == ("IND",)


def test_failed_job_backs_off_then_goes_stale(env):
    env.status = 429  # every call is rate limited, Retry-After 120
    out = []
    now = T0
    for _ in range(4):
        assert not run_job("fake", "D", env.settings, env.catalog, now=now, http=env.http,
                           connector=env.conn)  # fmt: skip
        j = env.catalog.get_job("fake", "D")
        out.append((j["state"], j["attempts"], j["next_run_at"]))
        now = now + timedelta(hours=1)
    assert [o[:2] for o in out] == [("failed", 1), ("failed", 2), ("failed", 3), ("stale", 0)]
    # delay = max(backoff, Retry-After 120s)
    assert out[0][2] == "2026-11-19T12:02:00Z" and out[1][2] == "2026-11-19T13:05:00Z"
    assert out[2][2] == "2026-11-19T14:30:00Z"
    assert out[3][2] == "2026-11-23T02:00:00Z"  # next Monday 02:00 UTC
    ds = env.catalog.get_dataset("fake", "D")
    assert ds["status"] == "stale" and "RateLimited" in ds["last_error"]
    env.status = 200
    env.rows = ROWS
    assert run_job(
        "fake", "D", env.settings, env.catalog, now=now, http=env.http, connector=env.conn
    )
    ds = env.catalog.get_dataset("fake", "D")
    assert ds["status"] == "ingested" and ds["last_error"] is None
    assert env.catalog.get_job("fake", "D")["state"] == "idle"


def test_truncated_chunk_is_persisted_and_cleared(env):
    import dataclasses

    env.rows = ROWS
    real = env.conn.fetch
    env.conn.fetch = lambda req, http: (
        dataclasses.replace(c, meta={"truncated": True}) for c in real(req, http)
    )
    do_ingest(env)
    assert env.catalog.get_dataset("fake", "D")["last_error"].startswith("truncated:")
    # only the series at the cut boundary (the last row's) is recorded
    cut = Storage(env.settings.data_dir).read_manifest()["cut"]
    assert cut == {"fake/D": [f"fake:D:X:{ROWS[-1][0]}"]}
    env.conn.fetch = real
    do_ingest(env)
    assert env.catalog.get_dataset("fake", "D")["last_error"] is None
    assert Storage(env.settings.data_dir).read_manifest()["cut"] == {"fake/D": []}


def test_cli_commands_validate_settings(monkeypatch, tmp_path, capsys):
    from argparse import Namespace

    from statmesh.ingest.runner import discover_cmd, ingest_cmd

    monkeypatch.setenv("STATMESH_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("STATMESH_CONTACT_EMAIL", raising=False)
    monkeypatch.delenv("STATMESH_DISABLE", raising=False)
    assert discover_cmd(Namespace(source="fred")) == 1
    assert ingest_cmd(Namespace(source="fred", dataset=None, reprocess=False)) == 1
    assert capsys.readouterr().err.count("STATMESH_CONTACT_EMAIL") == 2
