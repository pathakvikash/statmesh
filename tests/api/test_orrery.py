"""Orrery app support: service JWT on /mcp, manifest, structuredContent, readOnlyHint.

Synthetic tokens and fixture data; offline.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import time

import pytest
from fastapi.testclient import TestClient
from mcp import Client

from statmesh import mcp_server, orrery, service
from statmesh.api.app import create_app
from statmesh.mcp_server import build_server
from statmesh.settings import Settings

from ..query.test_paging_and_partial import data  # noqa: F401

SECRET = "test-secret-not-real"


def b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def token(secret=SECRET, alg="HS256", **over):
    now = int(time.time())
    claims = {
        "iss": "orrery",
        "aud": "statmesh",
        "sub": "a@example.com",
        "iat": now,
        "exp": now + 60,
    }
    claims |= over
    head = b64(json.dumps({"alg": alg, "typ": "JWT"}).encode())
    body = b64(json.dumps(claims).encode())
    sig = (
        b""
        if alg == "none"
        else hmac.new(secret.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest()
    )
    return f"{head}.{body}.{b64(sig)}"


@pytest.fixture
def secret(monkeypatch):
    monkeypatch.setenv("ORRERY_APP_SECRET", SECRET)


@pytest.mark.parametrize(
    "tok",
    [
        token(secret="other"),
        token(aud="someone-else"),
        token(iss="evil"),
        token(exp=int(time.time()) - 120),
        token(alg="none"),
        token(alg="HS512"),
        token(sub=""),
        "garbage",
    ],
)
def test_bad_tokens_rejected(secret, tok):
    with pytest.raises(orrery.AuthError):
        orrery.verify_jwt(tok)


def test_good_token_and_skew(secret):
    assert orrery.verify_jwt(token())["sub"] == "a@example.com"
    assert orrery.verify_jwt(token(exp=int(time.time()) - 10))  # inside the 30 s skew


def test_custom_app_id_and_issuer(secret, monkeypatch):
    monkeypatch.setenv("ORRERY_APP_ID", "stats2")
    monkeypatch.setenv("ORRERY_ISSUER", "o2")
    with pytest.raises(orrery.AuthError):
        orrery.verify_jwt(token())
    assert orrery.verify_jwt(token(aud="stats2", iss="o2"))


def app_client(tmp_path):
    service.configure(Settings(data_dir=tmp_path, allowed_hosts=("testserver",)))
    return TestClient(create_app())


def post_mcp(c, tok=None):
    h = {"accept": "application/json, text/event-stream"}
    if tok:
        h["authorization"] = f"Bearer {tok}"
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
    return c.post("/mcp", json=body, headers=h)


def test_mcp_requires_token_when_secret_set(secret, tmp_path, caplog):
    with app_client(tmp_path) as c:
        assert post_mcp(c).status_code == 401
        assert post_mcp(c, token(secret="x")).status_code == 401
        with caplog.at_level(logging.INFO, logger="statmesh.orrery"):
            assert post_mcp(c, token()).status_code != 401
        assert "a@example.com" in caplog.text
        assert c.get("/sources").status_code == 200  # REST untouched


def test_public_mode_unchanged_without_secret(tmp_path, monkeypatch):
    monkeypatch.delenv("ORRERY_APP_SECRET", raising=False)
    with app_client(tmp_path) as c:
        assert post_mcp(c).status_code != 401
        assert c.get("/.well-known/orrery-app.json").json()["auth"] == "none"


def test_manifest_shape(secret, tmp_path, monkeypatch):
    monkeypatch.delenv("ORRERY_BASE_URL", raising=False)
    with app_client(tmp_path) as c:
        m = c.get("/.well-known/orrery-app.json", headers={"host": "testserver"}).json()
    assert m["manifestVersion"] == 1 and m["id"] == "statmesh" and m["auth"] == "orrery-jwt"
    assert m["permission"] == "read" and m["capabilities"] == ["table", "timeseries", "link"]
    assert m["mcp"]["url"] == m["baseUrl"] + "/mcp" and "sso" not in m


def test_manifest_pinned_origin(secret, tmp_path, monkeypatch):
    monkeypatch.setenv("ORRERY_BASE_URL", "https://web.example.com/")
    with app_client(tmp_path) as c:
        m = c.get("/.well-known/orrery-app.json").json()
    assert (
        m["baseUrl"] == "https://web.example.com"
        and m["mcp"]["url"] == "https://web.example.com/mcp"
    )
    assert m["icon"].startswith("https://web.example.com/") and m["sso"] == {"path": "/sso"}
    assert m["deepLinks"]["sql"].startswith("/sql?") and m["deepLinks"]["search"].startswith(
        "/search?"
    )


def call(name, **args):
    async def go():
        async with Client(build_server()) as c:
            return await c.call_tool(name, args)

    return asyncio.run(go())


def test_tools_are_read_only():
    async def go():
        async with Client(build_server()) as c:
            return (await c.list_tools()).tools

    tools = asyncio.run(go())
    assert tools and all(t.annotations and t.annotations.read_only_hint for t in tools)


def test_run_sql_structured(data):  # noqa: F811
    r = call("run_sql", sql="SELECT 1 AS x")
    s = r.structured_content
    assert (
        s["orrery"] == 1 and s["type"] == "table" and s["columns"] == ["x"] and s["rows"] == [[1]]
    )
    assert json.loads(r.content[0].text)["rows"] == [[1]]  # text output unchanged


def test_run_sql_row_cap(data, monkeypatch):  # noqa: F811
    monkeypatch.setattr(orrery, "ROW_CAP", 3)
    r = call("run_sql", sql="SELECT value FROM observations")
    s = r.structured_content
    assert len(s["rows"]) == 3 and s["truncated"] and "first 3 of" in s["warning"]
    assert "first 3 of" in r.content[0].text


def test_get_observations_timeseries(data):  # noqa: F811
    s = call("get_observations", series_id="open:D:U1").structured_content
    assert (
        s["orrery"] == 1 and s["type"] == "timeseries" and s["columns"][0] == "geo"
    )  # old shape kept
    assert {x["name"] for x in s["series"]} == {"open:D:U1 (IND)", "open:D:U1 (USA)"}
    t, v = s["series"][0]["points"][0]
    assert isinstance(t, int) and t == 1577836800000 and isinstance(v, (int, float))


def test_search_and_describe_structured(data):  # noqa: F811
    s = call("search_series", geo="IND").structured_content
    assert (
        s["type"] == "table" and s["columns"][0] == "series_id" and len(s["rows"]) == len(s["hits"])
    )
    d = call("describe_series", series_id="open:D:U1").structured_content
    assert (
        d["type"] == "table"
        and d["columns"] == ["field", "value"]
        and d["series_id"] == "open:D:U1"
    )


def test_mcp_server_still_exports_default_rows():
    assert mcp_server.DEFAULT_ROWS == 200
