import gzip
import time

import httpx
import pytest

from statmesh.core.catalog import Catalog
from statmesh.core.http import HttpClient, MissingKey, RateLimited, get_http
from statmesh.core.models import Manifest
from statmesh.settings import Settings

LIC = {"name": "n", "url": "u", "redistribute": "yes", "attribution": "a"}


def manifest(**over) -> Manifest:
    return Manifest.model_validate(
        {"id": "src", "name": "S", "kind": "custom", "licence": LIC, **over}
    )


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    slept: list[float] = []
    monkeypatch.setattr(time, "sleep", slept.append)
    return slept


def client(handler, m=None, settings=None, catalog=None) -> HttpClient:
    return HttpClient(m or manifest(), settings or Settings(), catalog,
                      transport=httpx.MockTransport(handler))  # fmt: skip


def test_user_agent_and_params():
    seen = {}

    def h(req):
        seen["ua"], seen["url"] = req.headers["user-agent"], str(req.url)
        return httpx.Response(200, json={"ok": 1})

    c = client(h, settings=Settings(contact_email="me@x.org"))
    assert c.get("https://a/b", params={"q": "1"}).json() == {"ok": 1}
    assert seen["ua"].startswith("statmesh/") and seen["ua"].endswith("(+me@x.org)")
    assert seen["url"] == "https://a/b?q=1"


def test_retries_5xx_with_exponential_backoff(no_sleep):
    calls = []

    def h(req):
        calls.append(1)
        return httpx.Response(503) if len(calls) < 3 else httpx.Response(200, text="fine")

    assert client(h).get("https://a").text == "fine"
    assert len(calls) == 3 and no_sleep == [1.0, 2.0]


def test_gives_up_after_three_attempts_with_status_error():
    calls = []

    def h(req):
        calls.append(1)
        return httpx.Response(500)

    with pytest.raises(httpx.HTTPStatusError):
        client(h).get("https://a")
    assert len(calls) == 3


def test_no_retry_on_4xx():
    calls = []

    def h(req):
        calls.append(1)
        return httpx.Response(404)

    with pytest.raises(httpx.HTTPStatusError):
        client(h).get("https://a")
    assert len(calls) == 1


def test_transport_errors_retried_then_raised():
    calls = []

    def h(req):
        calls.append(1)
        raise httpx.ConnectError("down")

    with pytest.raises(httpx.ConnectError):
        client(h).get("https://a")
    assert len(calls) == 3


def test_retry_after_honoured(no_sleep):
    n = []

    def h(req):
        n.append(1)
        return (
            httpx.Response(429, headers={"Retry-After": "7"})
            if len(n) == 1
            else httpx.Response(200)
        )

    client(h).get("https://a")
    assert no_sleep == [7.0]


def test_retry_after_beyond_budget_raises_rate_limited():
    c = client(lambda req: httpx.Response(429, headers={"Retry-After": "60"}))
    with pytest.raises(RateLimited) as e:
        c.with_budget(max_wait_s=5).get("https://a")
    assert e.value.retry_after == 60


def test_persistent_429_raises_rate_limited(no_sleep):
    c = client(lambda req: httpx.Response(429, headers={"Retry-After": "2"}))
    with pytest.raises(RateLimited) as e:
        c.get("https://a")
    assert e.value.retry_after == 2 and no_sleep == [2.0, 2.0]


def test_per_day_counter_in_catalog_shared_between_clients(tmp_path):
    cat = Catalog(tmp_path / "c.sqlite")
    m = manifest(rate_limit={"per_day": 2})
    ok = lambda req: httpx.Response(200)
    a, b = client(ok, m, catalog=cat), client(ok, m, catalog=cat)  # two "processes"
    a.get("https://x")
    b.get("https://x")
    with pytest.raises(RateLimited) as e:
        a.with_budget(max_wait_s=0).get("https://x")
    assert 0 < e.value.retry_after <= 86400
    cat.close()


def test_per_hour_counter_in_memory_without_catalog():
    c = client(lambda req: httpx.Response(200), manifest(rate_limit={"max_downloads_per_hour": 1}))
    c.get("https://x")
    with pytest.raises(RateLimited):
        c.with_budget(max_wait_s=0).get("https://x")


def test_without_budget_limiter_sleeps(monkeypatch):
    waits = []

    def stop(s):
        waits.append(s)
        raise KeyboardInterrupt  # the window would never open under a stubbed clock

    c = client(lambda req: httpx.Response(200), manifest(rate_limit={"per_hour": 1}))
    c.get("https://x")
    monkeypatch.setattr(time, "sleep", stop)
    with pytest.raises(KeyboardInterrupt):
        c.get("https://x")
    assert 0 < waits[0] <= 3600


def test_per_second_spacing_and_budget(no_sleep):
    c = client(lambda req: httpx.Response(200), manifest(rate_limit={"per_second": 1}))
    c.get("https://x")
    with pytest.raises(RateLimited) as e:
        c.with_budget(max_wait_s=0).get("https://x")
    assert 0 < e.value.retry_after <= 1


def test_deadline_in_the_past_raises():
    c = client(lambda req: httpx.Response(200), manifest(rate_limit={"per_second": 0.1}))
    c.get("https://x")
    with pytest.raises(RateLimited):
        c.with_budget(max_wait_s=None, deadline=time.monotonic() + 1).get("https://x")


def test_missing_key(monkeypatch):
    monkeypatch.delenv("SRC_KEY", raising=False)
    c = client(lambda req: httpx.Response(200), manifest(auth="free_key", key_env="SRC_KEY"))
    assert c.key is None
    with pytest.raises(MissingKey):
        c.get("https://x")
    ok = client(lambda req: httpx.Response(200),
                manifest(auth="free_key", key_env="SRC_KEY", key_required=False))  # fmt: skip
    assert ok.get("https://x").status_code == 200


def test_key_never_leaks_in_errors(monkeypatch):
    monkeypatch.setenv("SRC_KEY", "s3cr3t-value")
    m = manifest(auth="free_key", key_env="SRC_KEY")
    c = client(lambda req: httpx.Response(404), m)
    assert c.key == "s3cr3t-value"
    with pytest.raises(httpx.HTTPStatusError) as e:
        c.get("https://x", params={"api_key": c.key})
    assert "s3cr3t-value" not in str(e.value) and "***" in str(e.value)
    assert c.redact("k=s3cr3t-value") == "k=***"


def test_response_cache(tmp_path):
    n = []

    def h(req):
        n.append(1)
        return httpx.Response(200, content=b"body")

    s = Settings(data_dir=tmp_path)
    c = client(h, settings=s)
    assert c.get("https://x", params={"a": "1"}, cache_ttl_s=60).content == b"body"
    assert c.get("https://x", params={"a": "1"}, cache_ttl_s=60).content == b"body"
    assert len(n) == 1
    files = list((tmp_path / "cache" / "http" / "src").glob("*.gz"))
    assert len(files) == 1 and gzip.decompress(files[0].read_bytes()) == b"\nbody"
    c.get("https://x", params={"a": "2"}, cache_ttl_s=60)
    assert len(n) == 2


def test_cache_key_ignores_the_api_key(tmp_path, monkeypatch):
    monkeypatch.setenv("SRC_KEY", "k1")
    m = manifest(auth="free_key", key_env="SRC_KEY")
    c1 = client(lambda r: httpx.Response(200, content=b"x"), m, Settings(data_dir=tmp_path))
    c1.get("https://x", params={"api_key": c1.key}, cache_ttl_s=60)
    assert "k1" not in "".join(p.name for p in (tmp_path / "cache" / "http" / "src").iterdir())


def test_post_and_download(tmp_path):
    c = client(lambda req: httpx.Response(200, content=req.content or b"filedata"))
    assert c.post("https://x", json={"a": 1}).json() == {"a": 1}
    dest = c.download("https://x/f", tmp_path / "sub" / "f.bin")
    assert dest.read_bytes() == b"filedata" and not list(tmp_path.rglob("*.tmp"))
    bad = client(lambda req: httpx.Response(404))
    with pytest.raises(httpx.HTTPStatusError):
        bad.download("https://x/f", tmp_path / "nope.bin")
    assert not (tmp_path / "nope.bin").exists()


def test_with_budget_shares_the_limiter():
    c = client(lambda req: httpx.Response(200), manifest(rate_limit={"per_hour": 1}))
    b = c.with_budget(max_wait_s=0)
    assert b._limiter is c._limiter and b is not c
    b.get("https://x")
    with pytest.raises(RateLimited):
        c.with_budget(max_wait_s=0).get("https://x")


def test_get_http_is_one_per_source(tmp_path):
    d = tmp_path / "connectors" / "abc"
    d.mkdir(parents=True)
    (d / "manifest.yaml").write_text(
        "id: abc\nname: A\nkind: custom\nlicence: {name: n, url: u, redistribute: 'yes', attribution: a}\n"
    )
    s = Settings(connectors_dir=tmp_path / "connectors", data_dir=tmp_path / "data")
    cat = Catalog(tmp_path / "c.sqlite")
    assert get_http("abc", s, cat) is get_http("abc", s, cat)
    cat.close()


def test_redact_basic_auth_base64(monkeypatch):
    import base64

    monkeypatch.setenv("SRC_KEY", "s3cr3t-value")
    c = client(lambda req: httpx.Response(200), manifest(auth="free_key", key_env="SRC_KEY"))
    for raw in (b"s3cr3t-value:", b"s3cr3t-value"):
        b = base64.b64encode(raw).decode()
        assert c.redact(f"Authorization: Basic {b}") == "Authorization: Basic ***"
        assert c.redact(b.rstrip("=")) == "***"


def test_download_byte_cap(tmp_path):
    c = client(lambda req: httpx.Response(200, content=b"x" * (3 << 20)))
    assert c.download("https://x/f", tmp_path / "ok").stat().st_size == 3 << 20
    with pytest.raises(ValueError, match="refusing"):
        c.download("https://x/f", tmp_path / "big", max_bytes=1 << 20)
    assert not (tmp_path / "big").exists()
