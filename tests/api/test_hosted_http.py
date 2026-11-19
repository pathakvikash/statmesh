import pytest
from fastapi.testclient import TestClient

from statmesh import service
from statmesh.api.app import create_app
from statmesh.settings import Settings

ORIGIN = "https://stats.example.org"


def client(tmp_path, **kw):
    kw.setdefault("allowed_hosts", ("testserver",))
    service.configure(Settings(data_dir=tmp_path, **kw))
    return TestClient(create_app())


@pytest.fixture
def hosted(tmp_path):
    with client(tmp_path, mode="hosted", cors_origins=(ORIGIN,), cache_max_age_s=300) as c:
        yield c


def test_get_200_is_public_cacheable(hosted):
    r = hosted.get("/sources")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "public, max-age=300, stale-while-revalidate=3600"


def test_post_and_errors_are_no_store(hosted):
    assert hosted.post("/query", json={"sql": "SELECT 1"}).headers["cache-control"] == "no-store"
    assert hosted.get("/series/nope:x:y").headers["cache-control"] == "no-store"  # 404
    r = hosted.get("/sources", headers={"host": "evil.test"})
    assert r.status_code == 421 and r.headers["cache-control"] == "no-store"
    assert hosted.get("/healthz").headers["cache-control"] == "no-store"


def test_zero_max_age_never_caches(tmp_path):
    with client(tmp_path) as c:
        assert c.get("/sources").headers["cache-control"] == "no-store"


def test_cors_allows_listed_origin_without_credentials(hosted):
    r = hosted.get("/sources", headers={"origin": ORIGIN})
    assert r.headers["access-control-allow-origin"] == ORIGIN
    assert "access-control-allow-credentials" not in r.headers
    assert (
        "access-control-allow-origin"
        not in hosted.get("/sources", headers={"origin": "https://evil.test"}).headers
    )


def test_cors_preflight_get_and_post_only(hosted):
    h = {"origin": ORIGIN, "access-control-request-method": "POST"}
    r = hosted.options("/query", headers=h)
    assert r.status_code == 200
    assert set(r.headers["access-control-allow-methods"].replace(" ", "").split(",")) == {
        "GET",
        "POST",
    }
    h["access-control-request-method"] = "DELETE"
    assert hosted.options("/query", headers=h).status_code == 400


def test_no_cors_headers_when_unconfigured(tmp_path):
    with client(tmp_path) as c:
        r = c.get("/sources", headers={"origin": ORIGIN})
        assert "access-control-allow-origin" not in r.headers


def test_vary_origin_on_cacheable_gets_when_cors_is_set(hosted):
    r = hosted.get("/sources")  # no Origin header sent: the cache must still key on it
    assert "origin" in r.headers["vary"].lower()


def test_no_vary_without_cors(tmp_path):
    with client(tmp_path, cache_max_age_s=300) as c:
        assert "vary" not in c.get("/sources").headers
