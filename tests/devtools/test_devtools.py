import argparse
import subprocess
import sys

import pytest

from statmesh import cli
from statmesh.devtools.record import record_cmd
from statmesh.devtools.scaffold import new_cmd, scaffold
from statmesh.devtools.test import test_cmd as run_test_cmd

KINDS = ["sdmx", "file", "rest", "custom"]


def test_cli_dispatch_targets_exist():
    ap = cli.build_parser()
    for argv in (["connector", "new", "x", "--kind", "file"], ["connector", "record", "x"],
                 ["connector", "test", "x"]):  # fmt: skip
        mod, fn = ap.parse_args(argv).target.split(":")
        assert callable(getattr(__import__(mod, fromlist=[fn]), fn))


@pytest.mark.parametrize("kind", KINDS)
def test_scaffold_manifest_valid(tmp_path, kind, monkeypatch):
    monkeypatch.setenv("STATMESH_CONNECTORS_DIR", str(tmp_path))
    new_cmd(argparse.Namespace(id="demo", kind=kind))
    d = tmp_path / "demo"
    assert (d / "tests" / "test_contract.py").exists() and (d / "tests" / "test_smoke.py").exists()
    assert (d / "connector.py").exists() == (kind in ("rest", "custom"))
    env = {**__import__("os").environ, "STATMESH_CONNECTORS_DIR": str(tmp_path)}
    r = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "--import-mode=importlib", "-k", "manifest_valid",
         "-p", "no:cacheprovider", str(d / "tests")],
        check=False, env=env, capture_output=True, text=True,
    )  # fmt: skip
    assert r.returncode == 0, r.stdout + r.stderr


def test_file_scaffold_passes_connector_test(tmp_path, monkeypatch):
    monkeypatch.setenv("STATMESH_CONNECTORS_DIR", str(tmp_path))
    scaffold("demo", "file", tmp_path)
    assert run_test_cmd(argparse.Namespace(id="demo", live=False)) == 0


def test_bad_and_duplicate_id(tmp_path):
    with pytest.raises(ValueError):
        scaffold("Bad-Id", "file", tmp_path)
    scaffold("ok", "file", tmp_path)
    with pytest.raises(FileExistsError):
        scaffold("ok", "file", tmp_path)


def test_new_record_test_round_trip(tmp_path, monkeypatch):
    """new -> record (transport mocked to serve the synthetic data) -> test."""
    import httpx

    from statmesh.devtools import scaffold as sc
    from statmesh.testing import fixtures

    monkeypatch.setenv("STATMESH_CONNECTORS_DIR", str(tmp_path))
    scaffold("demo", "file", tmp_path)
    fx = tmp_path / "demo" / "tests" / "fixtures"
    for f in (fx / "http").iterdir():
        f.unlink()

    def fake(self, request):
        body = sc._ROBOTS if request.url.path == "/robots.txt" else sc._CSV
        return httpx.Response(200, content=body, headers={"content-type": "text/plain"})

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", fake)
    record_cmd(argparse.Namespace(id="demo"))
    assert len(list((fx / "http").glob("*.json"))) == 2
    assert not any(
        __import__("json").loads(f.read_text())["synthetic"] for f in (fx / "http").glob("*.json")
    )
    assert fixtures  # recorded fixtures replay through the contract suite
    assert run_test_cmd(argparse.Namespace(id="demo", live=False)) == 0
