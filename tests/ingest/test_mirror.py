from dataclasses import replace
from datetime import UTC, datetime
from types import SimpleNamespace

from statmesh.ingest.mirror import effective_redistribute, mirror_cmd
from statmesh.ingest.scheduler import tick

THU = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)


def wire(env, monkeypatch):
    monkeypatch.setenv("STATMESH_DATA_DIR", str(env.settings.data_dir))
    monkeypatch.setenv("STATMESH_CONTACT_EMAIL", "t@example.org")
    monkeypatch.setattr("statmesh.ingest.mirror.list_connectors", lambda s: ["fake"])
    monkeypatch.setattr("statmesh.ingest.mirror.load_connector", lambda s, st: env.conn)
    monkeypatch.setattr("statmesh.ingest.runner.get_http", lambda s, st, c: env.http)
    env.rows = [["IND", "2023", 7.1]]


def test_dataset_licence_wins_over_source(env):
    m = env.conn.manifest
    assert effective_redistribute(m, "D") == "yes"
    env.build(datasets={"D": {"licence": {"redistribute": "review"}}})
    assert effective_redistribute(env.conn.manifest, "D") == "review"
    assert effective_redistribute(env.conn.manifest, "other") == "yes"


def test_dry_run_ingests_nothing(env, monkeypatch, capsys):
    wire(env, monkeypatch)
    assert mirror_cmd(SimpleNamespace(dry_run=True)) == 0
    assert "fake/D: would ingest" in capsys.readouterr().out
    assert env.calls == 0 and env.catalog.get_dataset("fake", "D") is None


def test_mirror_ingests_yes_and_skips_others(env, monkeypatch, capsys):
    wire(env, monkeypatch)
    assert mirror_cmd(SimpleNamespace(dry_run=False)) == 0
    assert "fake/D: 1 rows" in capsys.readouterr().out
    env.build(datasets={"D": {"licence": {"redistribute": "review"}}})
    wire(env, monkeypatch)
    calls = env.calls
    assert mirror_cmd(SimpleNamespace(dry_run=False)) == 0
    assert "fake/D: skip (redistribute: review)" in capsys.readouterr().out
    assert env.calls == calls


def test_mirror_failure_exit_code(env, monkeypatch, capsys):
    wire(env, monkeypatch)
    env.status = 429
    assert mirror_cmd(SimpleNamespace(dry_run=False)) == 1
    assert "RateLimited" in capsys.readouterr().err


def test_hosted_scheduler_skips_non_yes(env):
    hosted = replace(env.settings, mode="hosted")
    env.build(datasets={"D": {"licence": {"redistribute": "review"}}})
    env.rows = [["IND", "2023", 7.1]]

    def run(settings):
        return tick(settings, env.catalog, THU, sources=["fake"], load=lambda s, st: env.conn,
                    http_for=lambda s, st, c: env.http)  # fmt: skip

    assert run(hosted) == [] and env.calls == 0
    assert run(env.settings) == [("fake", "D", True)]  # self-host still runs it
