from types import SimpleNamespace

from tests.ingest.test_mirror import THU, wire

from statmesh.ingest.mirror import mirror_cmd
from statmesh.ingest.scheduler import seed_jobs

KEYED = {"auth": "free_key", "key_required": True, "key_env": "FAKE_KEY"}


def test_mirror_skips_keyed_dataset_without_key(env, monkeypatch, capsys):
    env.build(**KEYED)
    wire(env, monkeypatch)
    monkeypatch.delenv("FAKE_KEY", raising=False)
    assert mirror_cmd(SimpleNamespace(dry_run=False)) == 0
    assert "fake/D: skip (FAKE_KEY not set)" in capsys.readouterr().out
    assert env.calls == 0
    monkeypatch.setenv("FAKE_KEY", "k")
    assert mirror_cmd(SimpleNamespace(dry_run=True)) == 0
    assert "fake/D: would ingest" in capsys.readouterr().out


def test_seed_jobs_skips_keyed_dataset_without_key(env, monkeypatch):
    env.build(**KEYED)
    monkeypatch.delenv("FAKE_KEY", raising=False)
    seed_jobs(env.catalog, {"fake": env.conn}, THU)
    assert env.catalog.get_job("fake", "D") is None
    monkeypatch.setenv("FAKE_KEY", "k")
    seed_jobs(env.catalog, {"fake": env.conn}, THU)
    assert env.catalog.get_job("fake", "D") is not None
