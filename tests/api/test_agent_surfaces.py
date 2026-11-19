import argparse
import json
import shlex

import pytest
from fastapi.testclient import TestClient

from statmesh import service
from statmesh.api.app import create_app
from statmesh.mcp_server import INSTRUCTIONS, print_config, run_stdio
from statmesh.settings import Settings

METHODS = {"get", "post", "put", "patch", "delete"}


@pytest.fixture
def configured(tmp_path):
    service.configure(Settings(data_dir=tmp_path, allowed_hosts=("testserver",)))


def _operations(spec: dict):
    return [op for item in spec["paths"].values() for m, op in item.items() if m in METHODS]


def test_operation_ids_are_unique_and_every_operation_is_described(configured):
    ops = _operations(create_app().openapi())
    ids = [op["operationId"] for op in ops]
    assert len(ids) == len(set(ids))
    assert len(ops) < 30
    for op in ops:
        assert op.get("summary"), op["operationId"]
        assert op.get("description", "").strip(), op["operationId"]


def test_llms_txt_is_served(configured):
    with TestClient(create_app()) as c:
        r = c.get("/llms.txt")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    assert "statmesh" in r.text and "Citation rules" in r.text


def test_claude_desktop_config_is_json_and_stdio(capsys, monkeypatch):
    monkeypatch.setattr(Settings, "validate", lambda self: pytest.fail("must not validate"))
    assert run_stdio(argparse.Namespace(print_config="claude-desktop", url=None)) == 0
    cfg = json.loads(capsys.readouterr().out)["mcpServers"]["statmesh"]
    assert cfg["command"] == "uv"
    assert cfg["args"][-2:] == ["statmesh", "mcp"]
    assert "STATMESH_DATA_DIR" in cfg["env"]


def test_claude_code_prints_one_mcp_add_command(capsys):
    assert print_config("claude-code") is None
    argv = shlex.split(capsys.readouterr().out)
    assert argv[:5] == ["claude", "mcp", "add", "--transport", "stdio"]
    assert argv[argv.index("--") + 1 :][:1] == ["uv"]
    assert argv[-2:] == ["statmesh", "mcp"]


@pytest.mark.parametrize(
    ("url", "mcp", "openapi"),
    [
        (None, "https://<host>/mcp", "https://<host>/v1/openapi.json"),
        ("https://stats.example.org", "https://stats.example.org/mcp",
         "https://stats.example.org/v1/openapi.json"),
        ("https://stats.example.org/mcp/", "https://stats.example.org/mcp",
         "https://stats.example.org/v1/openapi.json"),
    ],
)  # fmt: skip
def test_chatgpt_prints_mcp_url_and_action_import(capsys, url, mcp, openapi):
    print_config("chatgpt", url)
    out = capsys.readouterr().out
    assert mcp in out and openapi in out
    assert "/mcp/mcp" not in out


def test_chatgpt_says_where_a_directly_served_api_keeps_its_spec(capsys):
    print_config("chatgpt", "https://stats.example.org")
    assert "https://stats.example.org/openapi.json" in capsys.readouterr().out


@pytest.mark.parametrize(
    "bad", ["https://stats.example.org/v1", "stats.example.org", "ftp://x.org"]
)
def test_public_url_must_be_an_origin(bad):
    with pytest.raises(ValueError, match="STATMESH_PUBLIC_URL"):
        Settings(public_url=bad).validate()


@pytest.mark.parametrize(
    ("kw", "servers"),
    [
        ({"mode": "hosted", "allowed_hosts": ("stats.example.org", "api:*")}, "https://stats.example.org/v1"),
        ({"mode": "hosted", "allowed_hosts": ("api:*", "*.internal")}, None),
        ({"mode": "hosted", "allowed_hosts": ("api:*",), "public_url": "https://pub.example.org:8443"},
         "https://pub.example.org:8443/v1"),
        ({"allowed_hosts": ("stats.example.org",)}, None),  # self-host: no servers entry
    ],
)  # fmt: skip
def test_openapi_servers_only_for_hosted_mirror(tmp_path, kw, servers):
    service.configure(Settings(data_dir=tmp_path, **kw))
    spec = create_app().openapi()
    assert spec.get("servers") == ([{"url": servers}] if servers else None)


def test_unknown_target_is_rejected():
    with pytest.raises(ValueError):
        print_config("cursor")


def test_instructions_carry_the_missing_data_rules():
    assert "do not give it from memory" in INSTRUCTIONS
    assert "3 closest series" in INSTRUCTIONS
