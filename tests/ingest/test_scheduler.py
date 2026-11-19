from datetime import UTC, datetime
from types import SimpleNamespace

import pyarrow.parquet as pq

from statmesh.core.storage import Storage
from statmesh.ingest.runner import ingest_cmd
from statmesh.ingest.scheduler import tick

THU = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)
MON = datetime(2026, 11, 23, 2, 0, tzinfo=UTC)


def run(env, now):
    return tick(env.settings, env.catalog, now, sources=["fake"],
                load=lambda s, st: env.conn, http_for=lambda s, st, c: env.http)  # fmt: skip


def test_tick_picks_only_due_jobs(env):
    env.rows = [["IND", "2023", 7.1]]
    assert run(env, THU) == [("fake", "D", True)]  # never ingested: due at once
    assert env.catalog.get_job("fake", "D")["next_run_at"] == "2026-11-23T02:00:00Z"
    assert run(env, THU.replace(hour=13)) == []  # not due yet
    calls = env.calls
    assert run(env, MON) == [("fake", "D", True)]  # Monday 02:00
    assert env.calls == calls + 1
    assert run(env, MON) == []  # idempotent


def test_no_schedule_no_job(env):
    env.build(refresh={})
    assert run(env, THU) == []
    assert env.catalog.get_job("fake", "D") is None


def test_cli_ingest_signature_and_failure_exit_code(env, monkeypatch, capsys):
    monkeypatch.setenv("STATMESH_DATA_DIR", str(env.settings.data_dir))
    monkeypatch.setenv("STATMESH_CONTACT_EMAIL", "t@example.org")  # validate() needs it
    monkeypatch.setattr("statmesh.ingest.runner.load_connector", lambda s, st: env.conn)
    env.status = 429
    monkeypatch.setattr("statmesh.ingest.runner.get_http", lambda s, st, c: env.http)
    ns = SimpleNamespace(source="fake", dataset=None, reprocess=False)
    assert ingest_cmd(ns) == 1 and "RateLimited" in capsys.readouterr().err
    env.status, env.rows = 200, [["IND", "2023", 7.1]]
    assert ingest_cmd(ns) == 0 and "fake/D: 1 rows" in capsys.readouterr().out
    st = Storage(env.settings.data_dir)
    assert pq.read_table(st.abs(st.read_manifest()["obs"]["fake/D"][0])).num_rows == 1


def test_warns_for_core_datasets_without_schedule(env, capsys):
    from statmesh.ingest.scheduler import seed_jobs

    env.build(refresh={})
    seed_jobs(env.catalog, {"fake": env.conn}, THU)
    assert "no refresh.schedule" in capsys.readouterr().err
