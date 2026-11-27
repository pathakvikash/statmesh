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
        token(purpose="sso"),  # handoff tokens are not service tokens
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


def test_manifest_home_link_and_forwarded_origin(secret, tmp_path, monkeypatch):
    monkeypatch.setenv("ORRERY_BASE_URL", "https://web.example.com")
    with app_client(tmp_path) as c:
        assert c.get("/.well-known/orrery-app.json").json()["deepLinks"]["home"] == "/"
        monkeypatch.delenv("ORRERY_BASE_URL")
        h = {"x-forwarded-host": "statmesh.example.com", "x-forwarded-proto": "http"}
        m = c.get("/.well-known/orrery-app.json", headers=h).json()
    assert (
        m["baseUrl"] == "https://statmesh.example.com" and "sso" not in m
    )  # never http off localhost
    assert orrery.request_origin("http", "localhost:8000") == "http://localhost:8000"


def test_oversize_body_is_413(secret, tmp_path):
    with app_client(tmp_path) as c:
        h = {"accept": "application/json, text/event-stream", "authorization": f"Bearer {token()}"}
        r = c.post("/mcp", content=b"x" * (orrery.MAX_BODY + 1), headers=h)
    assert r.status_code == 413 and r.json()["error"]["code"] == -32600


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


def test_run_sql_byte_budget(data, monkeypatch):  # noqa: F811
    monkeypatch.setattr(orrery, "BYTE_BUDGET", 2200)
    r = call("run_sql", sql="SELECT series_id, value FROM observations")
    s = r.structured_content
    assert (
        0 < len(s["rows"]) < 30 and len(json.dumps(s)) <= 2000 + 40
    )  # + `rows` re-added warning slack
    assert s["truncated"] and "size cap" in r.content[0].text


def test_non_contract_tools_have_no_structured_content(data):  # noqa: F811
    assert call("list_sources").structured_content is None
    assert call("describe_schema").structured_content is None
    r = call("related_series", series_id="open:D:U1").structured_content
    assert r["type"] == "table" and r["columns"][0] == "series_id"


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


# --- user-caused tool errors reach the model as isError with the reason ---------------------------


def call_raw(name, **args):
    async def go():
        async with Client(build_server()) as c:
            return await c.call_tool(name, args)

    return asyncio.run(go())


def err_text(r):
    assert r.is_error
    return r.content[0].text


def test_bad_sql_error_is_readable(data):  # noqa: F811
    t = err_text(call_raw("run_sql", sql="SELEC 1"))
    assert "syntax error" in t.lower() and "Traceback" not in t


def test_rejected_sql_error_is_readable_and_read_only_holds(data):  # noqa: F811
    assert "only a single SELECT" in err_text(call_raw("run_sql", sql="DROP TABLE observations"))
    assert "not allowed" in err_text(
        call_raw("run_sql", sql="SELECT * FROM read_csv('/etc/passwd')")
    )
    assert "not allowed" in err_text(call_raw("run_sql", sql="SELECT getenv('ORRERY_APP_SECRET')"))


def test_unknown_series_and_bad_parameter_are_readable(data):  # noqa: F811
    assert "unknown series" in err_text(call_raw("get_observations", series_id="nope"))
    assert "unknown series" in err_text(call_raw("get_observations", series_id="open:D:NOPE"))
    assert err_text(
        call_raw("describe_series", series_id="open:D:NOPE")
    )  # KeyError carries its text
    assert "unknown geo" in err_text(
        call_raw("get_observations", series_id="open:D:U1", geo="ZZZZ")
    )
    assert "offset needs limit" in err_text(
        call_raw("get_observations", series_id="open:D:U1", offset=1)
    )


def test_user_error_masks_paths_and_keeps_one_line():
    e = ValueError("IO Error: No files found at '/srv/app/data/obs/x/part.parquet'\nLINE 1: SELECT")
    t = mcp_server.user_error(e)
    assert "/srv" not in t and "<path>" in t and "\n" not in t
    assert mcp_server.user_error(KeyError("unknown series x")) == "unknown series x"
    assert len(mcp_server.user_error(ValueError("x" * 5000))) <= mcp_server._MAX_ERR


def test_unexpected_errors_stay_generic(data, monkeypatch):  # noqa: F811
    def boom(sql):
        raise RuntimeError("secret-internal /srv/db postgres://u:pw@h/db")

    monkeypatch.setattr(service, "run_sql", boom)
    t = err_text(call_raw("run_sql", sql="SELECT 1"))
    assert t == "Error executing tool run_sql"


# --- per-user quota on tools/call only ---------------------------------------------------------


def rpc_post(c, tok, method, id=1, **params):
    h = {"accept": "application/json, text/event-stream", "authorization": f"Bearer {tok}"}
    body = {"jsonrpc": "2.0", "id": id, "method": method, "params": params}
    return c.post("/mcp", json=body, headers=h)


@pytest.fixture(autouse=True)
def _fresh_quota():
    orrery._calls.clear()


def test_quota_counts_tool_calls_only_and_is_per_user(secret, tmp_path, monkeypatch):
    monkeypatch.setenv("ORRERY_RATE_LIMIT_PER_MIN", "2")
    a, b = token(), token(sub="b@example.com")
    with app_client(tmp_path) as c:
        for _ in range(
            5
        ):  # handshake and list never count (400: no MCP session here, not our concern)
            assert rpc_post(c, a, "tools/list").status_code != 429
        assert rpc_post(c, a, "tools/call", name="list_sources", arguments={}).status_code != 429
        assert rpc_post(c, a, "tools/call", name="list_sources", arguments={}).status_code != 429
        r = rpc_post(c, a, "tools/call", id=7, name="list_sources", arguments={})
        assert r.status_code == 429 and int(r.headers["retry-after"]) >= 1
        assert r.json()["id"] == 7 and "retry in" in r.json()["error"]["message"]
        assert rpc_post(c, a, "tools/list").status_code != 429  # list is still allowed
        assert rpc_post(c, b, "tools/call", name="list_sources", arguments={}).status_code != 429


def test_quota_window_slides_and_default_is_60(monkeypatch):
    monkeypatch.delenv("ORRERY_RATE_LIMIT_PER_MIN", raising=False)
    assert orrery.rate_limit_per_min() == 60
    monkeypatch.setenv("ORRERY_RATE_LIMIT_PER_MIN", "2")
    assert orrery.rate_check("u", now=100) == 0 and orrery.rate_check("u", now=110) == 0
    assert 49 <= orrery.rate_check("u", now=111) <= 50
    assert orrery.rate_check("u", now=161) == 0  # the first call left the window
    monkeypatch.setenv("ORRERY_RATE_LIMIT_PER_MIN", "0")
    assert orrery.rate_check("u", 1000, now=162) == 0  # off


def test_quota_counts_batches(secret, tmp_path, monkeypatch):
    monkeypatch.setenv("ORRERY_RATE_LIMIT_PER_MIN", "2")
    call_msg = {"jsonrpc": "2.0", "method": "tools/call", "params": {"name": "list_sources"}}
    h = {"accept": "application/json, text/event-stream", "authorization": f"Bearer {token()}"}
    with app_client(tmp_path) as c:
        r = c.post("/mcp", json=[{**call_msg, "id": i} for i in range(3)], headers=h)
    assert r.status_code == 429
