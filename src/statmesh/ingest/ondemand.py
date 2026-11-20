"""On-demand fetch of a remote dataset slice into the cache, under a time/row/rate budget."""

from __future__ import annotations

import json
import threading
import time
import uuid
import weakref
from dataclasses import asdict, replace
from datetime import datetime, timedelta

import pyarrow as pa

from statmesh.core.catalog import Catalog
from statmesh.core.connector import Connector, load_connector
from statmesh.core.http import HttpClient, RateLimited, get_http
from statmesh.core.models import FetchRequest
from statmesh.core.schema import validate_table
from statmesh.core.storage import Storage
from statmesh.ingest.runner import _paths, _save_raw, now_utc
from statmesh.settings import Settings

_locks: weakref.WeakValueDictionary[str, threading.Lock] = weakref.WeakValueDictionary()
_locks_guard = threading.Lock()


def _key_lock(key: str) -> threading.Lock:
    with _locks_guard:  # weak values: a lock is dropped once no caller holds it
        lock = _locks.get(key)
        if lock is None:
            lock = _locks[key] = threading.Lock()
        return lock


class FetchTooLarge(ValueError):
    """The result exceeds fetch_max_rows (or req.max_rows). Narrow the request."""


def fetch_on_demand(
    req: FetchRequest,
    source_id: str,
    settings: Settings,
    catalog: Catalog,
    *,
    http: HttpClient | None = None,
    connector: Connector | None = None,
    now: datetime | None = None,
) -> tuple[str | None, float | None]:
    """Returns (part_path relative to data_dir, retry_after seconds).
    - cache hit or fresh fetch: (path, None); the path is also in manifest["cache"]
    - rate limited (waiting would exceed fetch_max_wait_s / the deadline): (None, retry_after)
    - empty result: (None, None) (not cached)
    Raises FetchTooLarge over the row cap, TimeoutError past fetch_timeout_s, and whatever the
    connector/http raise otherwise (MissingKey, HTTPStatusError)."""
    ck = replace(req, max_rows=None).cache_key()  # the row cap must not split the cache
    key = f"{source_id}:{req.dataset_id}:{ck}"
    with _key_lock(key):  # one fetch per key: a second caller waits, then hits the cache
        return _fetch(req, source_id, settings, catalog, http, connector, now, key, ck)


def _fetch(req, source_id, settings, catalog, http, connector, now, key, ck):
    now = now or now_utc()
    st = Storage(settings.data_dir)
    hit = catalog.get_cache(key, now)
    if hit and st.abs(hit["part_path"]).exists():
        return hit["part_path"], None
    sweep_cache(settings, catalog, now=now)  # an expired row for this key must not be orphaned
    conn = connector or load_connector(source_id, settings)
    cap = min(req.max_rows or settings.fetch_max_rows, settings.fetch_max_rows)
    deadline = time.monotonic() + settings.fetch_timeout_s
    http = (http or get_http(source_id, settings, catalog)).with_budget(
        max_wait_s=settings.fetch_max_wait_s, deadline=deadline
    )
    tables, items, rows = [], [], 0
    try:
        for chunk in conn.fetch(replace(req, max_rows=cap), http):
            if chunk.table != "observations":
                continue
            t = conn.normalize(chunk)
            validate_table(t)
            rows += t.num_rows
            if rows > cap:
                raise FetchTooLarge(f"more than {cap} rows; narrow the request")
            tables.append(t)
            items.append((chunk, _save_raw(st, chunk)))
            if time.monotonic() > deadline:
                raise TimeoutError(f"fetch exceeded {settings.fetch_timeout_s}s")
    except RateLimited as e:
        return None, e.retry_after
    if not rows:
        return None, None
    run_id = "c" + uuid.uuid4().hex[:8]
    ds_key = f"{source_id}/{req.dataset_id}"
    [part] = st.write_parts(  # max_rows=cap so a result is always one file
        pa.concat_tables(tables), f"cache/obs/{source_id}/{req.dataset_id}", run_id,
        prefix=ck, max_rows=max(cap, 1),
    )  # fmt: skip
    old = catalog._one("SELECT part_path FROM cache_entries WHERE key=?", (key,))
    capped = rows >= cap or any(c.meta.get("truncated") for c, _ in items)
    with st.update_manifest() as mf:
        if capped:
            # every series of the slice: the request is one indicator (and geo), so its rows are
            # the series asked for. ponytail: a multi-geo slice flags all its geos, and the ids stay
            # until the next full ingest of the dataset (a cache expiry does not clear them).
            ids = {i for t in tables for i in t["series_id"].to_pylist()}
            mf.setdefault("cut", {})[ds_key] = sorted(ids | set(mf.get("cut", {}).get(ds_key, [])))
        if old and old["part_path"] != part:  # replaced entry: its part must not be orphaned
            mf["cache"][ds_key] = [p for p in mf["cache"].get(ds_key, []) if p != old["part_path"]]
        mf["cache"].setdefault(ds_key, []).append(part)
    ttl = timedelta(days=conn.manifest.cache_ttl_days)
    catalog.put_cache(key, source_id, req.dataset_id, json.dumps(asdict(req), default=str),
                      part, rows, now + ttl)  # fmt: skip
    if capped:
        # ponytail: only ever sets the dataset flag. A clean slice must not clear it: a truncated
        # cached part is still served. Cleared again by the next full ingest; ceiling: stale flag.
        catalog.set_truncated(source_id, req.dataset_id, True)
    for chunk, raw in items:
        catalog.add_lineage(run_id=run_id, kind="ondemand", chunk=chunk, raw_path=raw,
                            connector_version=conn.manifest.version, parts=[part])  # fmt: skip
    return part, None


def sweep_cache(settings: Settings, catalog: Catalog, *, now: datetime | None = None,
                grace_s: float = 600) -> int:  # fmt: skip
    """Drop expired cache entries from the manifest and catalog; delete files that are in neither
    the old nor the new manifest (so files dropped now go on the next sweep) and older than
    `grace_s` (a part may be written but not yet registered). Returns entries expired."""
    now = now or now_utc()
    st = Storage(settings.data_dir)
    expired = catalog.expired_cache(now)
    dead = {e["part_path"] for e in expired}
    if dead:
        with st.update_manifest() as mf:
            for k, parts in list(mf["cache"].items()):
                mf["cache"][k] = [p for p in parts if p not in dead]
                if not mf["cache"][k]:
                    del mf["cache"][k]
        for e in expired:
            catalog.delete_cache(e["key"])
    keep = _paths(st.read_manifest()) | dead
    for f in st.abs("cache/obs").glob("*/*/*.parquet"):
        rel = str(f.resolve().relative_to(st.root.resolve()))
        if rel not in keep and time.time() - f.stat().st_mtime >= grace_s:
            f.unlink(missing_ok=True)
    return len(expired)
