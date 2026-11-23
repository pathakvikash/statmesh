"""verify_data.py against a tiny data dir built from recorded fixtures (offline)."""

import importlib.util
import json
import shutil
import sqlite3
import subprocess
from pathlib import Path

import pytest

from statmesh.testing.fixture_catalog import build

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("verify_data", ROOT / "scripts" / "verify_data.py")
vd = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vd)


def _run(*a, **k):
    return subprocess.run(*a, check=False, **k)


@pytest.fixture(scope="module")
def base(tmp_path_factory):
    d = tmp_path_factory.mktemp("base") / "data"
    build(d, ["fred"])
    return d


@pytest.fixture
def data(base, tmp_path):
    d = tmp_path / "data"
    shutil.copytree(base, d)
    return d


def _yes_only(d):
    c = sqlite3.connect(d / "catalog.sqlite")
    c.execute("UPDATE sources SET redistribute='yes'")
    c.execute("UPDATE datasets SET redistribute=NULL")
    for sid, mj in c.execute("SELECT id, manifest_json FROM sources").fetchall():
        m = json.loads(mj)
        m["licence"]["redistribute"] = "yes"
        for v in m.get("datasets", {}).values():
            v.pop("licence", None)
        c.execute("UPDATE sources SET manifest_json=? WHERE id=?", (json.dumps(m), sid))
    c.commit()
    c.close()


def test_pass(data):
    _yes_only(data)
    r = vd.verify(data, hosted=True)
    assert r["errors"] == [] and r["counts"]["datasets"] > 0
    assert vd.main([str(data), "--json"]) == 0


def test_missing_parquet(data):
    f = next(data.rglob("*.parquet"))
    f.unlink()
    r = vd.verify(data)
    assert any("parquet missing" in e and f.name in e for e in r["errors"])
    assert vd.main([str(data)]) == 1


def test_hosted_licence_violation(data):
    _yes_only(data)
    c = sqlite3.connect(data / "catalog.sqlite")
    c.execute("UPDATE sources SET redistribute='review'")
    c.commit()
    c.close()
    assert vd.verify(data)["errors"] == []  # fine when not hosted
    assert any(e.startswith("hosted:") for e in vd.verify(data, hosted=True)["errors"])


def test_backup_roundtrip(data, tmp_path):
    out = tmp_path / "bk"
    out.mkdir()
    sh = str(ROOT / "scripts" / "data-backup.sh")
    p = _run([sh, str(data), str(out)], capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    arc = Path(p.stdout.strip().splitlines()[-1])
    assert (arc.parent / (arc.name + ".sha256")).exists()
    assert _run([sh, "--verify", str(arc)]).returncode == 0
    arc.write_bytes(arc.read_bytes() + b"x")
    assert _run([sh, "--verify", str(arc)], capture_output=True).returncode == 1
