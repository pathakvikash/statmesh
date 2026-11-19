import argparse
import os
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from statmesh import cli
from statmesh.cli import main
from statmesh.core.models import Manifest
from statmesh.devtools.record import record_cmd
from statmesh.devtools.scaffold import new_cmd, scaffold
from statmesh.devtools.test import test_cmd as run_test_cmd

KINDS = ["sdmx", "file", "ckan", "socrata", "rest", "custom"]
_LICENCE_PLACEHOLDERS = {
    "  name: TODO licence": "  name: Test licence (synthetic)",
    '  attribution: "Source: TODO"': '  attribution: "Source: example.org (test)"',
}


def fill_licence(d: Path) -> None:
    """Stand in for an author who has read the terms: replace the scaffold's licence TODOs."""
    p = d / "manifest.yaml"
    text = p.read_text()
    for old, new in _LICENCE_PLACEHOLDERS.items():
        assert old in text, f"scaffold template changed: {old!r} not found"
        text = text.replace(old, new)
    p.write_text(text)


def _run_suite(d: Path, root: Path) -> dict[str, tuple[str, str]]:
    """Run the scaffolded folder's offline suite as `connector test` does, return name -> (status,
    message) read from a JUnit report."""
    report = root / f"{d.name}-junit.xml"
    env = {**os.environ, "STATMESH_CONNECTORS_DIR": str(root)}
    subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "--import-mode=importlib", "-m", "not live",
         "--disable-socket", "--allow-unix-socket", "-p", "no:cacheprovider",
         f"--junitxml={report}", str(d / "tests")],
        check=False, env=env, capture_output=True, text=True,
    )  # fmt: skip
    out = {}
    for case in ET.parse(report).iter("testcase"):
        bad = case.find("failure") if case.find("failure") is not None else case.find("error")
        if bad is not None:
            out[case.get("name")] = ("failed", bad.get("message", ""))
        elif case.find("skipped") is not None:
            out[case.get("name")] = ("skipped", "")
        else:
            out[case.get("name")] = ("passed", "")
    return out


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
    fill_licence(scaffold("demo", "file", tmp_path))
    assert run_test_cmd(argparse.Namespace(id="demo", live=False)) == 0


def test_todo_licence_blocks_the_suite(tmp_path, monkeypatch):
    monkeypatch.setenv("STATMESH_CONNECTORS_DIR", str(tmp_path))
    d = scaffold("demo", "file", tmp_path)
    assert run_test_cmd(argparse.Namespace(id="demo", live=False)) != 0
    fill_licence(d)
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
    fill_licence(tmp_path / "demo")
    record_cmd(argparse.Namespace(id="demo"))
    assert len(list((fx / "http").glob("*.json"))) == 2
    assert not any(
        __import__("json").loads(f.read_text())["synthetic"] for f in (fx / "http").glob("*.json")
    )
    assert fixtures  # recorded fixtures replay through the contract suite
    assert run_test_cmd(argparse.Namespace(id="demo", live=False)) == 0


@pytest.mark.parametrize("kind", KINDS)
def test_every_kind_scaffolds_through_the_cli(tmp_path, kind, monkeypatch, capsys):
    monkeypatch.setenv("STATMESH_CONNECTORS_DIR", str(tmp_path))
    assert main(["connector", "new", "demo", "--kind", kind]) == 0
    d = tmp_path / "demo"
    assert (d / "manifest.yaml").is_file() and (d / "tests" / "test_contract.py").is_file()
    assert Manifest.load(d / "manifest.yaml").kind == kind
    assert (d / "mapping.yaml").is_file() == (kind in ("file", "ckan", "socrata"))
    out = capsys.readouterr().out
    assert "next steps" in out and "statmesh connector record demo" in out


@pytest.mark.parametrize("kind", [k for k in KINDS if k != "file"])
def test_todo_licence_fails_only_the_todo_check(tmp_path, kind, monkeypatch):
    monkeypatch.setenv("STATMESH_CONNECTORS_DIR", str(tmp_path))
    d = scaffold("demo", kind, tmp_path)
    results = _run_suite(d, tmp_path)
    failed = {name for name, (status, _) in results.items() if status == "failed"}
    assert failed == {"test_licence_has_no_todo"}, results
    assert "licence TODO" in results["test_licence_has_no_todo"][1]
    assert results["test_manifest_valid"][0] == "passed"


def test_file_kind_passes_full_suite_once_licence_is_filled(tmp_path, monkeypatch):
    monkeypatch.setenv("STATMESH_CONNECTORS_DIR", str(tmp_path))
    d = scaffold("demo", "file", tmp_path)
    fill_licence(d)
    results = _run_suite(d, tmp_path)
    assert results and {status for status, _ in results.values()} == {"passed"}, results
    assert "test_licence_has_no_todo" in results and "test_codes_mapped" in results


@pytest.mark.parametrize("kind", ["ckan", "socrata"])
def test_portal_kinds_write_a_valid_mapping_and_manifest(tmp_path, kind):
    d = scaffold("demo", kind, tmp_path)
    m = Manifest.load(d / "manifest.yaml")
    assert m.kind == kind and m.options and "example" in m.datasets
    assert (d / "mapping.yaml").read_text().startswith("datasets:")
