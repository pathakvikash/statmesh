"""Regression tests for the W0 review fixes (one section per review item)."""

import gzip
import os
import threading
import time
from datetime import UTC, date, datetime
from urllib.parse import quote, quote_plus

import httpx
import pytest

from statmesh.cli import _dispatch
from statmesh.core.catalog import Catalog
from statmesh.core.connector import connector_dir, load_connector
from statmesh.core.geo import find_geos_in_text
from statmesh.core.http import HttpClient, RateLimited, get_http
from statmesh.core.models import DatasetMeta, Licence, Manifest, RawChunk
from statmesh.core.periods import parse_period
from statmesh.core.storage import Storage
from statmesh.settings import Settings
from statmesh.testing.fixtures import replay_http

LIC = {"name": "n", "url": "u", "redistribute": "yes", "attribution": "a"}
LIC_YAML = 'licence: {name: n, url: u, redistribute: "yes", attribution: a}\n'
KEY = "ab+c/d=="
FORMS = [KEY, quote(KEY, safe=""), quote_plus(KEY), quote(KEY)]


def manifest(**over) -> Manifest:
    return Manifest.model_validate(
        {"id": "src", "name": "S", "kind": "custom", "licence": LIC, **over}
    )


def client(handler, m=None, settings=None, catalog=None) -> HttpClient:
    return HttpClient(m or manifest(), settings or Settings(), catalog,
                      transport=httpx.MockTransport(handler))  # fmt: skip


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    slept: list[float] = []
    monkeypatch.setattr(time, "sleep", slept.append)
    return slept


@pytest.fixture
def keyed(monkeypatch):
    monkeypatch.setenv("SRC_KEY", KEY)
    return manifest(auth="free_key", key_env="SRC_KEY")


# 1 -----------------------------------------------------------------------------------------


def test_1_percent_encoded_key_is_redacted(keyed):
    c = client(lambda r: httpx.Response(404), keyed)
    for f in FORMS:
        assert KEY not in c.redact(f"x={f}") and quote(KEY, safe="") not in c.redact(f)
    with pytest.raises(httpx.HTTPStatusError) as e:
        c.get("https://x/p", params={"api_key": c.key, "q": "1"})
    s = str(e.value)
    assert not any(f in s for f in FORMS) and "q=1" in s and "https://x/p" in s


def test_1_transport_error_message_has_no_key(keyed):
    def h(req):
        raise httpx.ConnectError(f"failed {req.url}")

    c = client(h, keyed)
    with pytest.raises(httpx.ConnectError) as e:
        c.get("https://x/p", params={"api_key": c.key})
    assert not any(f in str(e.value) for f in FORMS)


# 2 -----------------------------------------------------------------------------------------


def _redirecting(location):
    seen = []

    def h(req):
        seen.append(req)
        if len(seen) == 1:
            return httpx.Response(302, headers={"Location": location})
        return httpx.Response(200, text="ok")

    return h, seen


@pytest.mark.parametrize(
    "start,location,kept",
    [
        ("https://a/x", "https://evil/y", False),
        ("https://a/x", "http://a/y", False),
        ("https://a/x", "/z", True),
        ("https://a/x", "https://a:8443/y", False),  # same host, other port
    ],
)
def test_2_redirect_drops_key_header(keyed, start, location, kept):
    h, seen = _redirecting(location)
    c = client(h, keyed)
    assert c.get(start, headers={"X-API-Key": c.key, "Accept": "a/b"}).text == "ok"
    assert len(seen) == 2
    assert ("x-api-key" in seen[1].headers) is kept
    assert seen[1].headers["accept"] == "a/b"
    assert "api_key" not in str(seen[1].url)


# 3 -----------------------------------------------------------------------------------------


@pytest.mark.parametrize("bad", ["/etc", "../x", "a/b", "..", "A"])
def test_3_connector_id_validated(tmp_path, bad):
    s = Settings(connectors_dir=tmp_path)
    for fn in (connector_dir, load_connector):
        with pytest.raises(KeyError):
            fn(bad, s)


def test_3_disabled_connector_not_loadable(tmp_path):
    (tmp_path / "abc").mkdir()
    (tmp_path / "abc" / "manifest.yaml").write_text("id: abc\nname: X\nkind: custom\n" + LIC_YAML)
    with pytest.raises(KeyError):
        load_connector("abc", Settings(connectors_dir=tmp_path, disabled=frozenset({"abc"})))


# 4 -----------------------------------------------------------------------------------------


def test_4_storage_refuses_escapes(tmp_path):
    st = Storage(tmp_path / "data")
    for p in ("../x", "/etc/passwd", "a/../../x"):
        with pytest.raises(ValueError):
            st.abs(p)
    now = datetime(2026, 1, 1, tzinfo=UTC)
    for sid, did in (("../s", "d"), ("s", "a/b"), ("s", ".."), ("s\\x", "d")):
        with pytest.raises(ValueError):
            st.save_raw(RawChunk(sid, did, b"x", "text/plain", "u", {}, now))
    with pytest.raises(ValueError):
        st.delete_unreferenced("../..", [])
    assert not (tmp_path / "raw").exists()


# 5, 6 -------------------------------------------------------------------------------------


def test_5_reads_never_see_uncommitted_writes(tmp_path):
    cat = Catalog(tmp_path / "c.sqlite")
    inside, seen = threading.Event(), []

    def writer():
        try:
            with cat._tx() as c:
                c.execute("INSERT INTO rate_usage VALUES ('s','day','w',5)")
                inside.set()
                time.sleep(0.3)  # patched out; real wait below
                threading.Event().wait(0.3)
                raise RuntimeError("rollback")
        except RuntimeError:
            pass

    t = threading.Thread(target=writer)
    t.start()
    inside.wait()
    seen.append(cat.rate_count("s", "day", "w"))
    seen.append(cat._one("SELECT * FROM rate_usage"))
    seen.append(cat._all("SELECT * FROM rate_usage"))
    t.join()
    assert seen == [0, None, []]
    cat.close()


def test_6_discovery_input_is_materialised_before_the_transaction(tmp_path):
    cat = Catalog(tmp_path / "c.sqlite")
    lic = Licence(name="n", url="u", redistribute="yes", attribution="a")
    cat.upsert_source(Manifest(id="src", name="S", kind="custom", licence=lic))
    states = []

    def gen():
        states.append(cat.conn().in_transaction)
        yield DatasetMeta("src", "D", "T", lic)

    cat.upsert_discovery("src", gen(), [])
    assert states == [False]
    cat.close()


# 7 -----------------------------------------------------------------------------------------


def test_7_delete_unreferenced_protects_manifest_and_fresh_files(tmp_path):
    st = Storage(tmp_path)
    d = tmp_path / "obs"
    d.mkdir()
    for n in ("manifested", "old", "fresh"):
        (d / f"{n}.parquet").write_bytes(b"x")
    for n in ("manifested", "old"):
        os.utime(d / f"{n}.parquet", (1, 1))
    with st.update_manifest() as m:
        m["obs"]["k"] = ["obs/manifested.parquet"]

    def left():
        return sorted(p.stem for p in d.glob("*.parquet"))

    st.delete_unreferenced("obs", [])  # default grace keeps `fresh`, manifest keeps `manifested`
    assert left() == ["fresh", "manifested"]
    st.delete_unreferenced("obs", [], grace_s=0)
    assert left() == ["manifested"]


# 8 -----------------------------------------------------------------------------------------


def test_8_request_timeout_capped_by_deadline():
    seen = []

    def h(req):
        seen.append(req.extensions["timeout"]["read"])
        return httpx.Response(200)

    c = client(h)
    c.with_budget(max_wait_s=None, deadline=time.monotonic() + 5).get("https://x")
    c.get("https://x")
    assert seen[0] <= 5 and seen[1] == 30.0
    with pytest.raises(TimeoutError):
        c.with_budget(max_wait_s=None, deadline=time.monotonic() - 1).get("https://x")


def test_8_backoff_respects_budget(no_sleep):
    c = client(lambda r: httpx.Response(503)).with_budget(max_wait_s=0.5)
    with pytest.raises(RateLimited):
        c.get("https://x")
    c = client(lambda r: httpx.Response(503)).with_budget(
        max_wait_s=None, deadline=time.monotonic() + 0.5
    )
    with pytest.raises(RateLimited):
        c.get("https://x")
    assert no_sleep == []


# 9 -----------------------------------------------------------------------------------------


def test_9_replay_uses_placeholder_key_for_optional_free_key(tmp_path, monkeypatch):
    monkeypatch.delenv("OPT_KEY", raising=False)
    d = tmp_path / "abc"
    d.mkdir()
    (d / "manifest.yaml").write_text(
        "id: abc\nname: X\nkind: custom\nauth: free_key\nkey_env: OPT_KEY\n"
        "key_required: false\n" + LIC_YAML
    )
    assert replay_http("abc", Settings(connectors_dir=tmp_path)).key == "replay-key"


# 10 ----------------------------------------------------------------------------------------


def test_10_cache_keyed_on_accept_and_keeps_content_type(tmp_path):
    n = []

    def h(req):
        n.append(1)
        return httpx.Response(200, content=b"b", headers={"Content-Type": req.headers["accept"]})

    c = client(h, settings=Settings(data_dir=tmp_path))
    a = c.get("https://x", headers={"Accept": "text/csv"}, cache_ttl_s=60)
    b = c.get("https://x", headers={"Accept": "application/json"}, cache_ttl_s=60)
    assert len(n) == 2 and a.headers["content-type"] == "text/csv"
    again = c.get("https://x", headers={"Accept": "text/csv"}, cache_ttl_s=60)
    assert len(n) == 2 and again.headers["content-type"] == "text/csv" and again.content == b"b"
    assert b.headers["content-type"] == "application/json"
    f = next((tmp_path / "cache" / "http" / "src").glob("*.gz"))
    assert gzip.decompress(f.read_bytes()).endswith(b"b")


# 11 ----------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text,geos",
    [
        ("show us GDP", []),
        ("US GDP", ["USA"]),
        ("trade in Latin America", []),
        ("North America and South America", []),
        ("America and UK", ["USA", "GBR"]),
        ("uk inflation", []),
        ("UAE and DRC", ["ARE", "COD"]),
    ],
)
def test_11_geo_aliases(text, geos):
    assert find_geos_in_text(text)[0] == geos


# 12 ----------------------------------------------------------------------------------------


def test_12_periods():
    assert parse_period("1999-00") == (date(1999, 4, 1), date(2000, 3, 31), "A")
    assert parse_period("2024M03") == parse_period("2024-M03") == (
        date(2024, 3, 1), date(2024, 3, 31), "M")  # fmt: skip
    with pytest.raises(ValueError):
        parse_period("2024M13")
    assert parse_period("2011-12")[2] == "M"


# 14 ----------------------------------------------------------------------------------------


def test_14_import_time_attribute_error_surfaces(tmp_path, monkeypatch):
    (tmp_path / "boom_mod.py").write_text("raise AttributeError('inside import')\n")
    monkeypatch.syspath_prepend(str(tmp_path))
    with pytest.raises(AttributeError, match="inside import"):
        _dispatch("boom_mod:f", None)


# 15 ----------------------------------------------------------------------------------------


def test_15_get_http_keyed_on_catalog_path(tmp_path):
    d = tmp_path / "connectors" / "abc"
    d.mkdir(parents=True)
    (d / "manifest.yaml").write_text("id: abc\nname: A\nkind: custom\n" + LIC_YAML)
    s = Settings(connectors_dir=tmp_path / "connectors", data_dir=tmp_path / "data")
    c1, c2 = Catalog(tmp_path / "c.sqlite"), Catalog(tmp_path / "c.sqlite")
    assert get_http("abc", s, c1) is get_http("abc", s, c2)
    c1.close()
    c2.close()
