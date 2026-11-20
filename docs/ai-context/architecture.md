# Architecture (Python package)

One package, `src/statmesh/`, runs on one machine. The connector contract is the only place a new
source touches; everything below it is shared. Companion human doc: [../architecture.md](../architecture.md)
and [../data-model.md](../data-model.md).

## Data flow

```
connector (manifest.yaml [+ mapping.yaml | connector.py])
   discover() -> datasets + series         fetch() -> RawChunk (bytes)        normalize() -> Arrow table
        |                                        |                                   |
        v                                        v                                   v
   catalog.sqlite  <-- ingest/runner.py ---- raw/<source>/<dataset>/*.gz     obs/<src>/<ds>/part-*.parquet
   (sources, datasets, series,                (lineage rows)                  vintage-*.parquet (core only)
    FTS5 index, lineage, jobs,                                                tables/<entities|entity_xref>/...
    cache_entries, rate_usage)                                                manifest.json (atomic swap)
        ^                                                                           ^
        |            on demand: ingest/ondemand.py fetch_on_demand() ----------> cache/obs/<src>/<ds>/*.parquet
        |                                                                      (TTL; listed in manifest["cache"])
        v                                                                           v
   query/engine.py  builds one in-memory DuckDB connection: catalog copies + views over Parquet
        v
   service.py  (search_series, describe_series, get_observations, stream_observations, run_sql,
                list_sources, run_python when enabled)
        v
   REST (api/app.py)  |  MCP (mcp_server.py, stdio or /mcp)  |  SDK (sdk.py)  |  CLI (cli.py)  |  web/ (via REST + /mcp)
```

All HTTP to a source goes through `core/http.py` `HttpClient`: per-second spacing in memory,
per-hour and per-day counters in the catalog table `rate_usage` (so `serve` and `worker` share a
budget), 3 attempts with 1 s and 2 s backoff, `Retry-After` honoured (raises `RateLimited`),
redirects followed by hand with the key dropped on a host change, key redacted from errors and from
`RawChunk.params`.

## Connector contract (`core/connector.py`)

A `Connector` has `manifest`, `discover(http, limit)`, `fetch(req, http)` and `normalize(chunk)`.
`normalize` is pure (no I/O) and must return a table matching `TABLE_SCHEMAS[chunk.table]`
(`core/schema.py`). Kinds: `sdmx`, `file`, `ckan`, `socrata` are config-only generic connectors
(`core/generic/`); `custom` and `rest` need a `connector.py` exposing `Connector(manifest, dir)`.
`STATMESH_CONNECTORS_DIR` overrides a bundled connector with the same id; `STATMESH_DISABLE` removes
ids. The contract suite (`testing/contract.py`) is the test every connector must pass; it fails on a
`TODO` licence, an `example.org` licence URL, more than 5% unmapped geos, or a secret in a fixture.
Fixtures live in `connectors/<id>/tests/fixtures/` (`requests.yaml` lists the requests; bodies are
keyed by a hash of method, URL without query and sorted params).

## Observations schema

One long-format table (`obs` columns): `series_id` (`source:dataset:indicator:geo`), `source_id`,
`dataset_id`, `indicator_id`, `geo` (ISO3, `region:<code>`, `IN-XX`, `unmapped:<code>`),
`period_start`, `period_end`, `freq`, `value`, `unit`, `unit_mult`, `dims` (map), `obs_status`,
`retrieved_at`, `vintage`. Series key = three parts; series id = key plus geo. Row identity
(`obs_row_key_sql()` in `core/schema.py`) is `series_id, period_start, freq, dims`. Full table in
[../data-model.md](../data-model.md).

## Storage layout and the manifest

```
data/ (STATMESH_DATA_DIR)
  catalog.sqlite  manifest.json  manifest.lock  shares.sqlite
  raw/ obs/ tables/ cache/obs/ cache/http/ locks/
```

`manifest.json` is the single source of truth for which Parquet parts are live:

```json
{ "version": 52,
  "obs":     { "<source>/<dataset>": ["obs/<source>/<dataset>/part-....parquet", ...] },
  "vintages":{ "<source>/<dataset>": [...] },
  "tables":  { "entities": [...], "entity_xref": [...] },
  "cache":   { "<source>/<dataset>": [...] },
  "cut":     { "<source>/<dataset>": ["<series_id>", ...] } }
```

A refresh writes new parts, then swaps the manifest in one atomic rename under `manifest.lock`, so
readers never see half-written data and never hit DuckDB's single-writer lock. A part is deleted
only when it is in neither the old nor the new manifest and is older than `GRACE_S` (600 s). One
process ingests a dataset at a time (`locks/<source>__<dataset>.lock`, non-blocking; a second caller
gets `DatasetBusy`). `engine._ensure()` rebuilds its DuckDB connection when the manifest `version` or
the catalog's `PRAGMA data_version` changes.

## Per-series `cut` (partial) design

A row cap (`STATMESH_FETCH_MAX_ROWS` on demand, the ingest cap) can cut a dataset's rows. The
dataset-level flag (`datasets.last_error` starting with `truncated:`) says "something was cut"; the
manifest key `cut` says which series. `service._result` sets `partial: true` only when the dataset
is flagged AND the requested series id is in `cut` (a 3-part key matches any of its geos). Ingest
records the series at the cap boundary (`cut_series`: the last row's series of a capped chunk, a
documented guess); an on-demand fetch that returns exactly the cap rows records every series of the
slice. Ids stay until the dataset's next full ingest. `truncated` (separate field) only means "more
rows follow at `next_offset`".

## Catalog schema (`core/catalog.py`, SQLite, WAL)

`sources` (licence, `manifest_json`, `connector_version`), `datasets` (status
`ingested|remote|stale`, `is_core`, `last_error`, optional licence override), `series` (title,
description, `synonyms`, unit, freq, `geos` space-separated, `start_date`, `end_date`, `dims_json`,
optional licence override), `series_fts` (FTS5, `tokenize = 'porter unicode61'`, indexed columns
title, description, synonyms; rebuilt per source by `upsert_discovery`), `codelists`, `lineage`
(raw path, SHA-256, URL, params with key redacted, parts), `jobs` (scheduler state), `cache_entries`
(on-demand results and expiry), `rate_usage`. Licence resolution: series, then dataset, then source
(`Catalog.licence_for`).

## Query engine (`query/engine.py`)

`QueryEngine._build()` makes an in-memory DuckDB connection per manifest/catalog version:

1. Copies of the catalog tables `sources`, `datasets`, `series` (with the effective licence columns
   resolved), plus `geos` (pycountry plus `region:` codes) and `geo_groups` (`groups.csv`: G20, G7, EU27).
2. Views over Parquet: `observations`, `observations_vintages`, `entities`, `entity_xref`, plus an
   internal `_obs_ingested` (ingested rows only; the service uses it for "does this series have
   rows", not in the SQL allowlist).
3. **`observations` is a union of ingested parts and on-demand cache parts.** When cache parts
   exist the view is `row_number() OVER (PARTITION BY <obs row key> ORDER BY _src, retrieved_at DESC)`
   keeping `_rn = 1`: ingested rows win on overlap (`_src` 0 before 1), otherwise the latest
   retrieved row. `observations_vintages` does the same over `obs` + `vintages` + cache with
   `vintage` added to the key. Cache parts of an ingested dataset stay visible on purpose (WHO GHO
   ingests a few indicators and fetches the rest on demand into the cache).
4. Hosted mode: sources, datasets and series that are not servable are dropped from the catalog
   copies; their Parquet parts are never attached; non-`yes` series inside a served dataset are
   filtered with a `_denied_series` anti-join; `allowed_paths` is set to the exact served files.
5. Lock-down: `enable_external_access=false`, `allowed_directories` limited to `obs/`, `tables/`,
   `cache/obs/` (self-host), memory limit (`STATMESH_DUCKDB_MEMORY`), `lock_configuration=true`,
   extension autoload off. Execution has a timeout (`STATMESH_SQL_TIMEOUT_S`, via `cur.interrupt()`),
   a row cap and a byte cap checked per Arrow batch.

`observations()` builds a parameterised query with a total order (`geo, period_start, series_id,
period_end, dims, retrieved_at, value`) so OFFSET paging neither skips nor repeats rows;
`iter_observations()` streams for CSV export up to `STATMESH_EXPORT_MAX_ROWS`.

## SQL safety (two layers)

Layer 1 is the DuckDB lock-down above. Layer 2 is `query/sqlsafe.py`: `json_serialize_sql` parses the
statement, then the AST is walked. Exactly one SELECT; FROM may use only `ALLOWED_VIEWS`
(`observations`, `observations_vintages`, `series`, `datasets`, `sources`, `entities`, `entity_xref`,
`geos`, `geo_groups`) or CTE names; subqueries, joins and VALUES are fine; table functions, PIVOT,
SHOW, schema-qualified names, catalog-reading functions (`duckdb_*`, `pg_*`, `has_*`,
`current_setting`, `getenv`, ...) and CTE names starting with `_`, `duckdb_`, `sqlite_`, `pragma_`,
`information_schema`, `pg_` are rejected. Errors surface as `SqlRejected`, `SqlTimeout`,
`QueryError` (all `ValueError`).

## On-demand fetch (`ingest/ondemand.py`)

The catalog lists everything a connector can discover; only curated `core_datasets` are ingested on a
schedule. A series is served on demand when its dataset is `remote`, or it is outside the dataset's
core indicator list (`_outside_core`), or an ingested dataset has no rows for it (`_has_rows` reads
`_obs_ingested`). `fetch_on_demand` takes a per-key lock (a second caller waits, then hits the
cache), checks `cache_entries`, otherwise fetches under a budget (`fetch_timeout_s`,
`fetch_max_rows`, `fetch_max_wait_s`), writes one part to `cache/obs/<src>/<ds>/`, registers it in
`manifest["cache"]` and `cache_entries` with a TTL (`cache_ttl_days` in the manifest, default 7;
WHO GHO 30). Rate limited past the wait budget: `status: rate_limited` plus `retry_after`. Over the
row cap: `FetchTooLarge`. Empty result: not cached. `sweep_cache` expires entries and deletes
orphan files. Off when `STATMESH_ONDEMAND=0` (default off in hosted mode): never-ingested datasets
then return `ok` with no rows (a note says it is not mirrored) and search drops hits from them.

## Search (`search/search.py`, `core/catalog.py: fts`)

No embeddings. Steps: detect geos in the query (`find_geos_in_text`, groups `G20`/`G7`/`EU27`/
euro area expand; a bare "euro area" is the aggregate `region:EMU`) and strip them; parse periods
(fiscal `2023-24` is April to March, months, quarters, years) and strip them; split the rest into
concepts (a literal term plus synonyms from `data/synonyms.yaml`, longest phrase first; stopwords
dropped; "how many people" becomes "population"; "live in" filler dropped); build an FTS5 MATCH
(`AND` of concepts, each concept an `OR` of its terms). If AND finds something, every "all but one
concept" AND is added too (flagged `partial`); if nothing, the relaxed `OR`. FTS order is bm25 with
column weights `(0, 0, 10, 2, 5)` (title, description, synonyms). **Rerank only reorders, never
filters**: concept score (literal title match 1, synonym match 0.5, a partial row loses 1), then
series covering the named period, then home sources of the geo (`data/search_boosts.yaml`: USA to
census/bls/bea/eia/fred, IND to mospi, EA to ecb), then titles that lead with the literal concept
(headline "Population, total" before "Rural population"), then bm25. `SEARCH_POOL = 2000` candidates
are fetched once and every page is a slice (`offset + limit` must stay within it; beyond it HTTP
422). `keep` applies the hosted licence filter before `limit`. `series_id` gets the geo appended
when exactly one geo is known. Topics (`search/topics.py`, `data/topics.yaml`) come from manifest
`topics:` plus keyword classification.

## Service and surfaces

`service.py` is the only layer the surfaces call. REST routes (`api/app.py`): `GET /healthz`,
`/llms.txt`, `/search`, `/sources`, `/schema`, `/series/{id}`, `/series/{id}/observations`,
`/series/{id}/observations.csv`; `POST /query`, `/shares`, `GET /shares/{id}`; `POST /python` only
when the sandbox is on. Middleware: Host check (421 unless in `STATMESH_ALLOWED_HOSTS`, `*` turns it
off with a warning; the MCP origin allow-list derives from the same hosts), CORS from
`STATMESH_CORS_ORIGINS`, `Cache-Control` from `STATMESH_CACHE_MAX_AGE`. MCP tools (`mcp_server.py`):
`search_series`, `describe_series`, `get_observations`, `run_sql`, `list_sources`, plus `run_python`
when enabled; the server instructions carry the citation rules. Connector filters (`partner`, `hs`,
`period`, ...) reach the connector on every surface (REST repeats `filter=key=value`, MCP takes a
`filters` object, SDK `filters={...}`, CLI `--filter key=value`).

## Self-hosted vs hosted

| | `self_host` (default) | `hosted` (`STATMESH_MODE=hosted`) |
|---|---|---|
| Data served | everything ingested or fetched | only `redistribute: yes` (series, then dataset, then source) |
| On-demand fetch | on | off (override with `STATMESH_ONDEMAND`) |
| Python sandbox | opt-in (`STATMESH_PYTHON_SANDBOX=1`) | never; routes not registered |
| `file://` in the file connector | allowed | refused |
| Cache-Control default | none | 300 s |
| Shares | cap 512000 bytes, no TTL | cap 262144 (validated), TTL 90 days |
| Scheduler | all scheduled datasets | skips datasets whose licence is not `yes` (`statmesh mirror` seeds the store) |
| Deploy kit | `docker-compose.yml` | `deploy/hosted/` (nginx limits, read-only containers, split env files) |
| API prefix | none | nginx also serves the API under `/v1/` |

## Processes

`statmesh serve` (uvicorn: REST + MCP), `statmesh worker` (in-process scheduler, cron in UTC; failure
retries after 1, 5 and 30 minutes, then the dataset is `stale` with old data still live),
`statmesh mcp` (stdio). They share `STATMESH_DATA_DIR`. `serve`, `worker` and `mcp` refuse to start
while `sec_edgar` is enabled and `STATMESH_CONTACT_EMAIL` is empty (`Settings.validate`).
