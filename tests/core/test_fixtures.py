import httpx
import pytest

from statmesh.testing.fixtures import (
    FixtureMissing,
    RecordingTransport,
    ReplayTransport,
    load_requests,
)


def test_record_then_replay_roundtrip_redacts_secret(tmp_path):
    rec = RecordingTransport(tmp_path, secret="topsecret")
    rec._inner = httpx.MockTransport(
        lambda req: httpx.Response(
            200,
            headers={"Set-Cookie": "a=b", "Content-Type": "application/json"},
            json={"echo": str(req.url)},
        )
    )
    with httpx.Client(transport=rec) as c:
        live = c.get("https://api.test/v1/data", params={"b": "2", "api_key": "topsecret"})
    assert "topsecret" in live.text  # the live call is unchanged; only the files are redacted
    on_disk = "".join(p.read_text() for p in (tmp_path / "http").iterdir())
    assert "topsecret" not in on_disk and "REDACTED" in on_disk and "a=b" not in on_disk

    with httpx.Client(transport=ReplayTransport(tmp_path)) as c, pytest.raises(FixtureMissing):
        c.get("https://api.test/v1/data", params={"b": "2", "api_key": "unredacted"})
    # same request, different (placeholder) key, params in another order -> same fixture
    rep = ReplayTransport(tmp_path, secret="replay-key")
    with httpx.Client(transport=rep) as c:
        r = c.get("https://api.test/v1/data", params={"api_key": "replay-key", "b": "2"})
    assert r.status_code == 200 and r.headers["content-type"] == "application/json"
    assert "REDACTED" in r.json()["echo"]


def test_replay_never_hits_the_network(tmp_path):
    with httpx.Client(transport=ReplayTransport(tmp_path)) as c, pytest.raises(FixtureMissing):
        c.get("https://example.org/nothing")


def test_load_requests(tmp_path):
    (tmp_path / "requests.yaml").write_text(
        "- dataset_id: D\n  indicator_ids: [a, b]\n  geos: [IND]\n  start: 2020-01-01\n"
        "  filters: {partner: USA}\n"
    )
    (r,) = load_requests(tmp_path)
    assert (
        r.indicator_ids == ("a", "b") and r.start.year == 2020 and r.filters == {"partner": "USA"}
    )


def test_recording_transport_honours_proxy_env(tmp_path, monkeypatch):
    for k in ("NO_PROXY", "no_proxy", "ALL_PROXY", "all_proxy"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.test:3128")
    monkeypatch.setenv("https_proxy", "http://proxy.test:3128")
    rec = RecordingTransport(tmp_path)
    t = rec._transport(httpx.URL("https://api.test/x"))
    assert t._pool._proxy_url.host == b"proxy.test"
    monkeypatch.setenv("NO_PROXY", "api.test")
    monkeypatch.setenv("no_proxy", "api.test")
    assert rec._transport(httpx.URL("https://api.test/x")) is not t


def test_recording_refuses_5xx_but_keeps_4xx(tmp_path):
    from statmesh.testing.fixtures import UnrecordableResponse

    rec = RecordingTransport(tmp_path)
    rec._inner = httpx.MockTransport(
        lambda req: httpx.Response(int(req.url.params["s"]), text="<html>bad gateway</html>")
    )
    with httpx.Client(transport=rec) as c:
        with pytest.raises(UnrecordableResponse):
            c.get("https://api.test/x", params={"s": "502"})
        assert not (tmp_path / "http").exists()  # nothing written
        assert c.get("https://api.test/x", params={"s": "404"}).status_code == 404
    assert len(list((tmp_path / "http").glob("*.json"))) == 1
