import json
from argparse import Namespace

import pytest

from statmesh.core.connector import list_connectors
from statmesh.doctor import check, doctor_cmd
from statmesh.settings import Settings


def _run(capsys, **kw):
    rc = doctor_cmd(Namespace(json=True, source=None, offline=True, **kw))
    return rc, json.loads(capsys.readouterr().out)


def test_offline_one_row_per_connector(capsys, monkeypatch):
    monkeypatch.delenv("FRED_API_KEY", raising=False)
    rc, rows = _run(capsys)
    assert rc == 0
    assert [r["source"] for r in rows] == list_connectors(Settings.from_env())
    assert {r["key"] for r in rows} <= {"set", "missing", "optional"}
    fred = next(r for r in rows if r["source"] == "fred")
    assert (fred["key"], fred["status"]) == ("missing", "skip")


def test_key_set_never_printed(capsys, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "s3cret-value")
    _, rows = _run(capsys)
    assert next(r for r in rows if r["source"] == "fred")["key"] == "set"
    assert "s3cret-value" not in json.dumps(rows)


def test_live_failure_is_fail_not_crash(monkeypatch):
    # sockets are disabled in the offline suite, so the live request must fail cleanly
    r = check("worldbank")
    assert r.status == "fail" and r.detail
    with pytest.raises(KeyError):
        check("nope")


def test_key_straddling_the_160_cut_is_redacted(monkeypatch):
    key = "k3y-" + "A1b2C3d4" * 3  # 28 chars; "RuntimeError: " + 130 pad puts it across byte 160
    monkeypatch.setenv("FRED_API_KEY", key)

    def boom(_):
        raise RuntimeError("x" * 130 + key + " tail")

    monkeypatch.setattr("statmesh.doctor.load_requests", boom)
    r = check("fred")
    assert r.status == "fail" and key not in r.detail and key[:10] not in r.detail
    assert len(r.detail) <= 160
