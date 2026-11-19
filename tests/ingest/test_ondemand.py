from datetime import UTC, datetime, timedelta

import pytest

from statmesh.core.models import FetchRequest
from statmesh.core.storage import Storage
from statmesh.ingest.ondemand import FetchTooLarge, fetch_on_demand, sweep_cache

T0 = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)
REQ = FetchRequest("D", ("X",), geos=("IND",))


def fod(env, req=REQ, now=T0):
    return fetch_on_demand(req, "fake", env.settings, env.catalog, http=env.http,
                           connector=env.conn, now=now)  # fmt: skip


def test_fetch_caches_with_ttl(env):
    env.rows = [["IND", "2023", 7.1]]
    part, retry = fod(env)
    st = Storage(env.settings.data_dir)
    assert retry is None and st.abs(part).exists()
    assert st.read_manifest()["cache"]["fake/D"] == [part]
    entry = env.catalog.get_cache(f"fake:D:{REQ.cache_key()}", T0)
    assert entry["rows"] == 1 and entry["expires_at"] == "2026-11-26T12:00:00Z"
    assert env.catalog.latest_lineage("fake", "D")["retrieved_at"]
    calls = env.calls
    assert fod(env, now=T0 + timedelta(days=6)) == (part, None)  # served from cache
    assert env.calls == calls
    part2, _ = fod(env, now=T0 + timedelta(days=8))  # expired: refetched, old entry swept
    assert env.calls == calls + 1 and part2 != part
    assert st.read_manifest()["cache"]["fake/D"] == [part2]


def test_sweep_deletes_files_one_sweep_after_dropping_them(env):
    env.rows = [["IND", "2023", 7.1]]
    part, _ = fod(env)
    st = Storage(env.settings.data_dir)
    later = T0 + timedelta(days=8)
    assert sweep_cache(env.settings, env.catalog, now=later, grace_s=0) == 1
    assert st.read_manifest()["cache"] == {} and st.abs(part).exists()  # readers may hold it
    sweep_cache(env.settings, env.catalog, now=later, grace_s=0)
    assert not st.abs(part).exists()


def test_max_rows_enforced(env):
    env.rows = [["IND", "2022", 1.0], ["IND", "2023", 2.0]]
    env.settings = type(env.settings)(data_dir=env.settings.data_dir, fetch_max_rows=1)
    with pytest.raises(FetchTooLarge):
        fod(env)
    assert Storage(env.settings.data_dir).read_manifest()["cache"] == {}


def test_timeout_enforced(env):
    env.rows = [["IND", "2022", 1.0]]
    env.conn.chunks = 2
    env.settings = type(env.settings)(data_dir=env.settings.data_dir, fetch_timeout_s=-1)
    with pytest.raises(TimeoutError):
        fod(env)
    assert Storage(env.settings.data_dir).read_manifest()["cache"] == {}


def test_rate_limited_returns_retry_after_instead_of_waiting(env):
    env.status = 429
    assert fod(env) == (None, 120.0)
    assert env.catalog.get_cache(f"fake:D:{REQ.cache_key()}", T0) is None


def test_empty_result_is_not_cached(env):
    env.rows = []
    assert fod(env) == (None, None)


def test_cache_key_ignores_max_rows_and_refetch_replaces_part(env):
    from dataclasses import replace

    env.rows = [["IND", "2023", 7.1]]
    part, _ = fod(env)
    calls = env.calls
    assert fod(env, replace(REQ, max_rows=5)) == (part, None) and env.calls == calls
    st = Storage(env.settings.data_dir)
    st.abs(part).unlink()  # lost file: refetch must not leave the old path in the manifest
    part2, _ = fod(env)
    assert st.read_manifest()["cache"]["fake/D"] == [part2]


def test_concurrent_fetches_of_one_key_hit_upstream_once(env):
    import threading

    env.rows = [["IND", "2023", 7.1]]
    out = []
    ts = [threading.Thread(target=lambda: out.append(fod(env))) for _ in range(4)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert env.calls == 1 and len({o[0] for o in out}) == 1


def test_sweep_through_symlinked_data_dir(env, tmp_path):
    link = tmp_path / "link"
    link.symlink_to(env.settings.data_dir)
    env.rows = [["IND", "2023", 7.1]]
    fod(env)
    s = type(env.settings)(data_dir=link)
    sweep_cache(s, env.catalog, now=T0 + timedelta(days=8), grace_s=0)


def test_key_locks_are_released():
    import gc

    from statmesh.ingest import ondemand

    with ondemand._key_lock("k1"):
        assert ondemand._key_lock("k1") is ondemand._key_lock("k1")
    gc.collect()
    assert "k1" not in ondemand._locks


def test_truncated_slice_keeps_dataset_flag_after_clean_fetch(env):
    import dataclasses

    from statmesh.ingest.runner import discover

    discover("fake", env.settings, env.catalog, http=env.http, connector=env.conn)
    env.rows = [["IND", "2023", 7.1]]
    real = env.conn.fetch
    env.conn.fetch = lambda req, http: (
        dataclasses.replace(c, meta={"truncated": True}) for c in real(req, http)
    )
    fod(env)
    assert env.catalog.get_dataset("fake", "D")["last_error"].startswith("truncated:")
    env.conn.fetch = real
    fod(env, FetchRequest("D", ("Y",), geos=("IND",)))  # clean slice, a cache miss
    assert env.calls == 2
    assert env.catalog.get_dataset("fake", "D")["last_error"].startswith("truncated:")
