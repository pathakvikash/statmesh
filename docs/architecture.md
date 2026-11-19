# Architecture

statmesh is one Python package (`src/statmesh/`) plus an optional Next.js web UI (`web/`). It runs
on one machine. The connector contract is the only place a new source touches; everything below it
is shared.

```
 clients      web UI (web/)   MCP agents    scripts/notebooks    shell
                  |               |                |                |
 surfaces       REST (/search, /series, /query) | MCP (/mcp, stdio) | Python SDK | CLI
                                  \                 |                /
 service        statmesh/service.py   (the only functions the surfaces call)
                       |                           |
 query + search   query/engine.py (DuckDB)     search/ (SQLite FTS5)
                       |                           |
 storage        data/obs, tables, cache  (Parquet)      data/catalog.sqlite
                       ^                           ^
 ingest         ingest/runner.py, scheduler.py, ondemand.py
                       |
 shared HTTP    core/http.py  (rate limit, retries, cache, User-Agent, key redaction)
                       |
 connectors     connectors/<id>/ : manifest.yaml [+ mapping.yaml | connector.py]
                generic: sdmx, file, ckan, socrata
```

## Layers

- **Connector** (`core/connector.py`, `connectors/<id>/`): `discover` lists datasets and series,
  `fetch` returns raw bytes, `normalize` turns raw bytes into an Arrow table. It never does its own
  retry, caching or rate limiting. See [connectors.md](connectors.md).
- **HttpClient** (`core/http.py`): one per source per process. Per-second spacing in memory;
  per-hour and per-day counters in the catalog table `rate_usage`, so `serve` and `worker` share a
  source's budget. Up to 3 attempts with 1 s and 2 s backoff, honours `Retry-After` on 429
  (raising `RateLimited`), follows redirects by hand and drops the API key on a host change, and
  redacts the key from errors and from `RawChunk.params`.
- **Ingest** (`ingest/`): runs connectors, validates output against the schema, writes Parquet,
  records lineage. `scheduler.py` is the in-process loop used by `statmesh worker`.
- **Storage** (`core/storage.py`): immutable Parquet parts plus one `manifest.json` that lists the
  live parts. A refresh writes new parts, then swaps the manifest with one atomic rename, so a
  reader never sees half-written data. Layout: [data-model.md](data-model.md#storage-layout).
- **Catalog** (`core/catalog.py`): SQLite in WAL mode. Tables: `sources`, `datasets`, `series`,
  `codelists`, `lineage`, `jobs`, `cache_entries`, `rate_usage`, plus an FTS5 index for search.
- **Query engine** (`query/engine.py`): builds an in-memory DuckDB connection with views over the
  Parquet files and copies of the catalog tables, rebuilt when the manifest or catalog changes.
  Because ingest only writes new files and swaps the manifest, readers never hit DuckDB's
  single-writer lock.
- **Service** (`service.py`): `search_series`, `describe_series`, `get_observations`, `run_sql`,
  `list_sources`, and `run_python` when enabled. REST (`api/app.py`), MCP (`mcp_server.py`), the
  SDK's `LocalClient` and the CLI all call these and nothing else, so behaviour is the same on every
  surface.

## Hybrid data access

The catalog lists everything a connector can discover. Only a curated core is ingested on a
schedule; the rest is fetched when asked.

| Dataset state | Where rows come from | Cost |
|---|---|---|
| `ingested` | Parquet under `obs/` | local, fast |
| `remote` | fetched through the connector on first request, written to `cache/obs/` with a TTL (`cache_ttl_days` in the manifest, default 7) | one source call, under the rate limit |
| `stale` | last good data stays live; the dataset records the error | none |

## Main flows

**Scheduled ingest.** `statmesh worker` loads every enabled connector, creates one job per core
dataset of each connector that has `refresh.schedule`, and runs due jobs (cron times are UTC).
A job calls `fetch`, saves each raw response gzipped under `raw/`, calls `normalize`, validates the
table, merges with the live snapshot (new rows win on the dedupe key; rows whose value changed are
kept as vintages for core datasets), writes Parquet, swaps the manifest once, then writes lineage
and sets the dataset to `ingested`. A failure retries after 1 min, 5 min and 30 min, then marks the
dataset `stale` with the error and waits for the next cron slot. Old data stays live throughout.

**Query, ingested series.** A client calls REST, MCP, SDK or CLI. The service resolves the series in
the catalog, DuckDB reads Parquet, rows come back with `citations[]`.

**Query, remote series.** `get_observations` sees `status = remote`, so it asks the connector to
fetch under a budget (`STATMESH_FETCH_TIMEOUT_S`, `STATMESH_FETCH_MAX_ROWS`,
`STATMESH_FETCH_MAX_WAIT_S`), caches the result and answers. If the source is rate limited and
waiting would exceed the budget, the answer has `status: rate_limited` and `retry_after` seconds
instead of hanging. Cached rows are visible to SQL afterwards.

**Reprocess.** Raw snapshots are kept. If you change a connector's `normalize`, bump `version` in
its manifest and run `statmesh ingest <source> --dataset <id> --reprocess` to rebuild from the saved
raw files without touching the source.

**New source.** Add a folder under `connectors/`, pass the contract tests, run `statmesh discover
<id>`. No core change. See [connectors.md](connectors.md).

## Processes

`statmesh serve` (FastAPI + MCP over streamable HTTP, uvicorn), `statmesh worker` (scheduler),
`statmesh mcp` (MCP on stdio). They share `STATMESH_DATA_DIR`. docker compose runs `api` and
`worker` on one `./data` volume, plus `web` as an option. See [self-hosting.md](self-hosting.md).

## Opt-in sandboxed Python

`STATMESH_PYTHON_SANDBOX=1` (self-host mode only) adds `POST /python` and the MCP tool `run_python`.
Each call is one `docker run` with no network, a read-only root, 512 MB, 1 CPU, a 30 s wall clock
and the Parquet observations mounted read-only at `/data/obs`. The calling process needs the Docker
socket, which is root-equivalent on the host: only enable it on a single-operator machine, never on
a network-reachable instance. Full text of the risks and how to enable it: [sandbox.md](sandbox.md).

## Concurrency

- One process ingests a given dataset at a time: `ingest()` takes a non-blocking file lock
  (`data/locks/<source>__<dataset>.lock`). A second caller (the worker and a CLI `ingest`, say)
  gets `DatasetBusy` instead of racing.
- Every dataset writes into its own part directory (`obs/<source>/<dataset>/`,
  `tables/<table>/<source>/<dataset>/`), so a refresh or `--reprocess` of one dataset never deletes
  another's files. The manifest swap is serialised by a lock on `manifest.lock`.
- On-demand fetches take an in-process lock per request key: a second caller waits, then hits the
  cache.
- The inferred company links are rebuilt under their own lock (`inferred_links`) in their own
  directory, after any ingest of an `entities` table from `sec_edgar`, `gleif` or
  `uk_companies_house` ([data-model.md](data-model.md#entities-and-entity_xref)).
