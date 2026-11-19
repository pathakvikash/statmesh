"""discover / ingest / reprocess, plus job bookkeeping and the CLI entry points.

Ingest order: fetch -> save_raw -> normalize -> validate -> merge with the live snapshot ->
write parts -> ONE manifest swap -> lineage -> dataset status. Nothing is visible to readers
before the swap; a crash before it leaves the old data live. After the swap only parts that are in
neither the old nor the new manifest are deleted (readers may still hold the old ones).
"""

from __future__ import annotations

import argparse
import fcntl
import json
import sys
import uuid
from collections.abc import Collection, Iterable
from contextlib import contextmanager
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
from croniter import croniter

from statmesh.core.catalog import Catalog, iso
from statmesh.core.connector import Connector, list_connectors, load_connector
from statmesh.core.http import HttpClient, get_http
from statmesh.core.models import FetchRequest, Manifest, RawChunk
from statmesh.core.schema import TABLE_SCHEMAS, obs_row_key_sql, validate_table
from statmesh.core.storage import Storage
from statmesh.ingest.xref import SOURCE as INFERRED_SOURCE
from statmesh.ingest.xref import match_cik_to_lei
from statmesh.settings import Settings

BACKOFF_S = (60, 300, 1800)  # retry delays; a failure after these is "stale"
_KEYS = {
    "observations": obs_row_key_sql(),
    "entities": "entity_id, source_id",
    "entity_xref": "from_id, to_id, source_id",
}
_MEDIA = {"json": "application/json", "csv": "text/csv", "xml": "application/xml",
          "zip": "application/zip", "txt": "text/plain"}  # fmt: skip


class DatasetBusy(RuntimeError):
    """Another process (worker or CLI) is ingesting the same dataset right now."""


@contextmanager
def _lock(st: Storage, name: str, *, wait: bool = False):
    """flock on data_dir/locks/<name>.lock. Non-blocking by default: raises DatasetBusy."""
    d = st.abs("locks")
    d.mkdir(parents=True, exist_ok=True)
    with open(d / f"{name}.lock", "a+") as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | (0 if wait else fcntl.LOCK_NB))
        except BlockingIOError:
            raise DatasetBusy(f"{name} is already being ingested by another process") from None
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def now_utc() -> datetime:
    return datetime.now(UTC)


def open_catalog(settings: Settings) -> Catalog:
    return Catalog(settings.data_dir / "catalog.sqlite")


def next_cron(manifest: Manifest, now: datetime) -> datetime | None:
    s = manifest.refresh.schedule
    return croniter(s, now).get_next(datetime) if s else None


def discover(
    source_id: str,
    settings: Settings,
    catalog: Catalog,
    *,
    http: HttpClient | None = None,
    connector: Connector | None = None,
    limit: int | None = None,
) -> int:
    """Fill the catalog from the connector; returns the series count."""
    conn = connector or load_connector(source_id, settings)
    http = http or get_http(source_id, settings, catalog)
    catalog.upsert_source(conn.manifest)
    found = list(conn.discover(http, limit))
    return catalog.upsert_discovery(source_id, found, conn.manifest.core_datasets)


def _read_parts(st: Storage, parts: Iterable[str], name: str) -> pa.Table | None:
    tables = [pq.read_table(st.abs(p)) for p in parts]
    return pa.concat_tables(tables).cast(TABLE_SCHEMAS[name]) if tables else None


def _drop_keys(old: pa.Table, new: pa.Table, name: str) -> pa.Table:
    """`old` minus the rows whose dedupe key `new` also has."""
    key = f"concat_ws(chr(31), {_KEYS[name]})"
    con = duckdb.connect()
    try:
        con.register("o", old)
        con.register("n", new)
        return (
            con.sql(f"SELECT * FROM o WHERE {key} NOT IN (SELECT {key} FROM n)")
            .to_arrow_table()
            .cast(TABLE_SCHEMAS[name])
        )
    finally:
        con.close()


def merge(old: pa.Table | None, new: pa.Table, name: str) -> tuple[pa.Table, pa.Table | None]:
    """New rows win on the table's dedupe key. Returns (live, superseded old rows or None).
    Superseded = old rows whose value differs from the new row (obs only), stamped with vintage."""
    if old is None or old.num_rows == 0:
        return new, None
    key = f"concat_ws(chr(31), {_KEYS[name]})"
    schema = TABLE_SCHEMAS[name]
    con = duckdb.connect()
    try:
        con.register("o", old)
        con.register("n", new)
        con.execute(f"CREATE VIEW ok AS SELECT *, {key} AS _k FROM o")
        con.execute(f"CREATE VIEW nk AS SELECT *, {key} AS _k FROM n")
        live = con.sql(
            "SELECT * EXCLUDE _k FROM ok WHERE _k NOT IN (SELECT _k FROM nk) "
            "UNION ALL BY NAME SELECT * EXCLUDE _k FROM nk"
        ).to_arrow_table()
        sup = None
        if name == "observations":
            sup = con.sql(
                "SELECT o.* EXCLUDE _k REPLACE (coalesce(o.vintage, CAST(o.retrieved_at AS DATE))"
                " AS vintage) FROM ok o JOIN nk n USING (_k) WHERE o.value IS DISTINCT FROM n.value"
            ).to_arrow_table()
    finally:
        con.close()
    return live.cast(schema), (sup.cast(schema) if sup is not None and sup.num_rows else None)


def _sidecar(st: Storage, raw_rel: str) -> Path:
    return st.abs(raw_rel + ".meta.json")


def _save_raw(st: Storage, chunk: RawChunk) -> str:
    rel = str(st.save_raw(chunk))
    meta = {"media_type": chunk.media_type, "table": chunk.table, "meta": dict(chunk.meta)}
    _sidecar(st, rel).write_text(json.dumps(meta, default=str))  # lineage has no RawChunk.meta
    return rel


def _stored_chunks(catalog: Catalog, st: Storage, source_id: str, dataset_id: str):
    """Raw snapshots of past ingests, oldest first (for --reprocess; no HTTP)."""
    rows = catalog.conn().execute(
        "SELECT * FROM lineage WHERE source_id=? AND dataset_id=? AND kind='ingest' "
        "ORDER BY retrieved_at, id", (source_id, dataset_id),
    ).fetchall()  # fmt: skip
    seen: set[str] = set()
    for r in rows:
        if r["raw_path"] in seen:
            continue
        seen.add(r["raw_path"])
        side = json.loads(_sidecar(st, r["raw_path"]).read_text())
        yield RawChunk(
            source_id, dataset_id, st.read_raw(r["raw_path"]), side["media_type"], r["url"],
            json.loads(r["params_json"]), datetime.fromisoformat(r["retrieved_at"]),
            side["table"], side["meta"],
        ), r["raw_path"]  # fmt: skip


def _paths(m: dict) -> set[str]:
    return {p for sec in ("obs", "vintages", "tables", "cache") for v in m[sec].values() for p in v}


def ingest(
    source_id: str,
    dataset_id: str,
    settings: Settings,
    catalog: Catalog,
    *,
    http: HttpClient | None = None,
    connector: Connector | None = None,
    requests: Collection[FetchRequest] | None = None,
    reprocess: bool = False,
    now: datetime | None = None,
) -> int:
    """Ingest one dataset; returns the live row count written. Raises on any failure (old data
    stays live). `requests` default is one FetchRequest(dataset_id) (connector decides what that
    means); with refresh.incremental set it carries updated_after = last successful run start.
    One process per dataset at a time: a second caller gets DatasetBusy."""
    with _lock(Storage(settings.data_dir), f"{source_id}__{dataset_id}"):
        return _ingest(source_id, dataset_id, settings, catalog, http=http, connector=connector,
                       requests=requests, reprocess=reprocess, now=now)  # fmt: skip


def _ingest(
    source_id: str,
    dataset_id: str,
    settings: Settings,
    catalog: Catalog,
    *,
    http: HttpClient | None,
    connector: Connector | None,
    requests: Collection[FetchRequest] | None,
    reprocess: bool,
    now: datetime | None,
) -> int:
    conn = connector or load_connector(source_id, settings)
    m = conn.manifest
    now = now or now_utc()
    st = Storage(settings.data_dir)
    catalog.upsert_source(m)
    if not reprocess:
        http = http or get_http(source_id, settings, catalog)
        if catalog.get_dataset(source_id, dataset_id) is None:
            discover(source_id, settings, catalog, http=http, connector=conn)
    ds = catalog.get_dataset(source_id, dataset_id)
    since = None
    if m.refresh.incremental and ds and ds["last_ingested_at"]:
        since = datetime.fromisoformat(ds["last_ingested_at"])

    items: list[tuple[RawChunk, str]] = []
    if reprocess:
        items = list(_stored_chunks(catalog, st, source_id, dataset_id))
    else:
        for r in requests or [FetchRequest(dataset_id)]:
            r = replace(r, updated_after=r.updated_after or since)
            items += [(c, _save_raw(st, c)) for c in conn.fetch(r, http)]
    new: dict[str, list[pa.Table]] = {}
    for chunk, _ in items:
        t = conn.normalize(chunk)
        validate_table(t, chunk.table)
        new.setdefault(chunk.table, []).append(t)

    run_id = "r" + uuid.uuid4().hex[:8]
    key = f"{source_id}/{dataset_id}"
    core = dataset_id in m.core_datasets
    before = st.read_manifest()
    live_parts: dict[str, list[str]] = {}  # table -> new part paths
    vint_parts: list[str] = []
    flat_new: dict[str, tuple[list[str], list[str]]] = {}  # table -> (old legacy, rewritten)
    dirs: list[str] = []
    rows = 0
    for name, tables in new.items():
        rel = (
            f"obs/{source_id}/{dataset_id}"
            if name == "observations"
            else f"tables/{name}/{source_id}/{dataset_id}"
        )
        dirs.append(rel)
        old_paths = before["obs"].get(key, []) if name == "observations" else [
            p for p in before["tables"].get(name, []) if p.startswith(rel + "/")]  # fmt: skip
        if name != "observations":
            # Pre-per-dataset layout: tables/<name>/<source>/part-*.parquet has no dataset id, so it
            # stays its own live legacy set; each dataset ingest drops the rows it just wrote from it.
            flat = f"tables/{name}/{source_id}/"
            flat_parts = [p for p in before["tables"].get(name, [])
                          if p.startswith(flat) and "/" not in p[len(flat):]]  # fmt: skip
            dirs.append(flat.rstrip("/"))
        acc = None if reprocess else _read_parts(st, old_paths, name)
        sups = []
        for t in tables:
            acc, sup = merge(acc, t, name)
            if sup is not None:
                sups.append(sup)
        rows += acc.num_rows
        live_parts[name] = st.write_parts(acc, rel, run_id)
        if name != "observations" and flat_parts:
            legacy = _read_parts(st, flat_parts, name)
            kept = _drop_keys(legacy, pa.concat_tables(tables), name)
            if kept.num_rows != legacy.num_rows:  # rows moved to their owner
                flat_new[name] = (flat_parts, st.write_parts(kept, flat.rstrip("/"), run_id))
        if sups and core and name == "observations":
            vint_parts = st.write_parts(pa.concat_tables(sups), rel, run_id, prefix="vintage")

    with st.update_manifest() as mf:  # the swap; raises -> nothing written
        for name, parts in live_parts.items():
            if name == "observations":
                mf["obs"][key] = parts
                mf["vintages"][key] = (
                    vint_parts if reprocess else mf["vintages"].get(key, []) + vint_parts
                )
            else:
                pre = f"tables/{name}/{source_id}/{dataset_id}/"
                old_flat, new_flat = flat_new.get(name, ([], []))
                mf["tables"][name] = (
                    [
                        p
                        for p in mf["tables"].get(name, [])
                        if not p.startswith(pre) and p not in old_flat
                    ]
                    + new_flat
                    + parts
                )
        after = json.loads(json.dumps(mf))
    keep = _paths(before) | _paths(after)
    for rel in dirs:
        st.delete_unreferenced(rel, keep)

    if not reprocess:
        for chunk, raw in items:
            catalog.add_lineage(run_id=run_id, kind="ingest", chunk=chunk, raw_path=raw,
                                connector_version=m.version, parts=live_parts.get(chunk.table, []))  # fmt: skip
    catalog.set_dataset_status(source_id, dataset_id, "ingested",
                               ingested_at=None if reprocess else now)  # fmt: skip
    if not reprocess:
        catalog.set_truncated(source_id, dataset_id, any(c.meta.get("truncated") for c, _ in items))
    if "entities" in new and source_id in INFERRED_LINK_SOURCES:
        try:
            refresh_inferred_links(st, run_id)
        except Exception as e:  # noqa: BLE001 - the ingest itself is done; links are derived data
            print(f"{source_id}/{dataset_id}: inferred links not refreshed: {e}", file=sys.stderr)
    return rows


INFERRED_LINK_SOURCES = {"sec_edgar", "gleif", "uk_companies_house"}
# Own directory, so a reprocess of any gleif dataset (tables/entity_xref/gleif/<dataset>/) never
# touches it, and the rows carry source_id "gleif" (a registered source, so hosted mode serves them).
_INFERRED_DIR = f"tables/entity_xref/{INFERRED_SOURCE}/_inferred"


def refresh_inferred_links(st: Storage, run_id: str) -> int:
    """Recompute inferred cik:/uk: -> lei: links from every ingested entity and swap them in."""
    with _lock(st, "inferred_links", wait=True):
        before = st.read_manifest()
        ents = _read_parts(st, before["tables"].get("entities", []), "entities")
        out = match_cik_to_lei(ents) if ents is not None else None
        pre = _INFERRED_DIR + "/"
        had = any(p.startswith(pre) for p in before["tables"].get("entity_xref", []))
        if (out is None or not out.num_rows) and not had:
            return 0
        parts = (
            st.write_parts(out, _INFERRED_DIR, run_id) if out is not None and out.num_rows else []
        )
        with st.update_manifest() as mf:
            mf["tables"]["entity_xref"] = [
                p for p in mf["tables"].get("entity_xref", []) if not p.startswith(pre)
            ] + parts
            after = json.loads(json.dumps(mf))
        st.delete_unreferenced(_INFERRED_DIR, _paths(before) | _paths(after))
        return out.num_rows if out is not None else 0


def run_job(
    source_id: str,
    dataset_id: str,
    settings: Settings,
    catalog: Catalog,
    *,
    now: datetime,
    http: HttpClient | None = None,
    connector: Connector | None = None,
) -> bool:
    """Ingest with job state: failures retry after 1m/5m/30m, then the dataset goes stale with the
    error and the job waits for its next cron slot. Never raises."""
    conn = connector or load_connector(source_id, settings)
    job = catalog.get_job(source_id, dataset_id) or {}
    catalog.set_job(source_id, dataset_id, state="running", last_run_at=iso(now))
    try:
        ingest(source_id, dataset_id, settings, catalog, http=http, connector=conn, now=now)
    except Exception as e:  # noqa: BLE001 - job boundary: record and retry
        err = f"{type(e).__name__}: {e}"
        n = (job.get("attempts") or 0) + 1
        if n <= len(BACKOFF_S):
            delay = max(BACKOFF_S[n - 1], getattr(e, "retry_after", 0))
            fields = {"state": "failed", "attempts": n, "next_run_at": iso(now + timedelta(seconds=delay))}  # fmt: skip
        else:
            catalog.set_dataset_status(source_id, dataset_id, "stale", error=err)
            fields = {"state": "stale", "attempts": 0, "next_run_at": iso(next_cron(conn.manifest, now))}  # fmt: skip
        catalog.set_job(source_id, dataset_id, last_error=err, **fields)
        return False
    catalog.set_job(source_id, dataset_id, state="idle", attempts=0, last_success_at=iso(now),
                    last_error=None, next_run_at=iso(next_cron(conn.manifest, now)))  # fmt: skip
    return True


# ---- CLI -----------------------------------------------------------------------------------


def _settings_or_none() -> Settings | None:
    settings = Settings.from_env()
    try:
        settings.validate()
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return None
    return settings


def discover_cmd(args: argparse.Namespace) -> int:
    if (settings := _settings_or_none()) is None:
        return 1
    catalog = open_catalog(settings)
    rc = 0
    for s in [args.source] if args.source else list_connectors(settings):
        try:
            print(f"{s}: {discover(s, settings, catalog)} series")
        except Exception as e:  # noqa: BLE001
            print(f"{s}: {type(e).__name__}: {e}", file=sys.stderr)
            rc = 1
    return rc


def ingest_cmd(args: argparse.Namespace) -> int:
    if (settings := _settings_or_none()) is None:
        return 1
    catalog = open_catalog(settings)
    conn = load_connector(args.source, settings)
    datasets = [args.dataset] if args.dataset else list(conn.manifest.core_datasets)
    if not datasets:
        print(f"{args.source}: no core_datasets; pass --dataset ID", file=sys.stderr)
        return 1
    rc = 0
    for d in datasets:
        try:
            n = ingest(args.source, d, settings, catalog, connector=conn, reprocess=args.reprocess)
            print(f"{args.source}/{d}: {n} rows")
        except Exception as e:  # noqa: BLE001
            print(f"{args.source}/{d}: {type(e).__name__}: {e}", file=sys.stderr)
            rc = 1
    return rc
