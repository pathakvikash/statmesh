# Query surfaces

Five ways in, one set of functions behind them (`statmesh/service.py`). Every response that carries
data carries `citations[]`. Series ids and views are explained in [data-model.md](data-model.md).

Start the server with `statmesh serve [--host 127.0.0.1] [--port 8000]`. There is no
authentication; the default bind is loopback. Put a reverse proxy with auth in front before you
expose it (the compose file publishes port 8000 on all interfaces).

## REST

Interactive docs at `/docs`, schema at `/openapi.json`.

| Route | Purpose |
|---|---|
| `GET /healthz` | `{"ok": true}` |
| `GET /search?q=&geo=&freq=&source=&topic=&start_year=&end_year=&updated_since=&redistribute=&limit=10` | keyword search (`limit` 1 to 100); returns `hits[]` of `series_id`, `title`, `unit`, `freq`, `geo`, `start`, `end`, `source_id`, `dataset_id`, `licence_name`, `redistribute`, `status`, `score`, `topics`; see [Search filters](#search-filters) |
| `GET /series/{id}` | metadata: `topics`, description, dimensions, geographies, source URL, `last_updated`, `last_ingested_at`, `citation` |
| `GET /series/{id}/observations?start=&end=&geo=&limit=&filter=k=v` | `status`, `columns`, `rows`, `truncated`, `retry_after`, `citations[]` |
| `POST /query` body `{"sql": "..."}` | read-only SQL; `columns`, `rows`, `truncated`, `citations[]`, `warning` |
| `GET /sources?q=&kind=&topic=&redistribute=&auth=&status=` | per source: kind, auth, `key_configured`, `enabled`, `redistribute`, dataset and series counts, `last_ingested_at`, `stale_datasets`, `topics`; filters below |
| `GET /schema` | the SQL views `/query` can read: `{"views": [{name, description, joins[], columns: [{name, type, description, example}]}]}`; served in hosted mode too |
| `POST /python` body `{"code": "..."}` | only exists when `STATMESH_PYTHON_SANDBOX` is on and the mode is `self_host`; see [sandbox.md](sandbox.md) |
| `/mcp` | MCP over streamable HTTP |

`{id}` may contain `:` and `/` and is not URL-encoded. Dates are `YYYY-MM-DD`. `start` and `end`
filter on `period_start >= start` and `period_end <= end`. `rows` follow `columns`; for observations
that is the observation schema.

Limits: search `limit` is 1 to 100 (default 10); observations `limit` is 1 to 10000 and is also
capped by `STATMESH_SQL_MAX_ROWS`, with `truncated: true` when rows were cut. A `limit` outside the
range is a 422 on REST and a validation error over MCP. `geo` must be a known ISO3 code, a
`region:` code or an Indian state (`IN-XX`), else 400. Search takes the filters below; the CLI `search` takes `--geo`, `--freq` and `--source` (no `--limit`).

### Search filters

All optional and combinable (AND). `source` and `topic` repeat (`source=a&source=b`) or take a comma
list, and match any of the values. `geo` and `freq` keep series with unknown geography or
frequency.

| Param | Meaning |
|---|---|
| `q` | keywords; may be empty when at least one other filter is set, then results are the filtered series ordered by most recently updated (dataset `last_ingested_at` or latest fetch). No query and no filter is a 400 |
| `topic` | Health, Economy, Labour, Prices, Trade, Population, Environment, Energy, Companies (case-insensitive; unknown is 400) |
| `start_year`, `end_year` | keep series whose coverage overlaps the range. Coverage is the observed min `period_start` / max `period_end` where observations exist, else the catalogue dates; series with no known coverage pass |
| `updated_since` | `YYYY-MM-DD`; the dataset was ingested or fetched on or after that day |
| `redistribute` | `yes`, `review` or `no` (effective licence of the series). In hosted mode only `yes` ever matches |

Hits carry `start` and `end` (observed coverage when known) and `topics`. Filters apply to the first
2000 candidates of the keyword match. Hosted mode still hides every non-redistributable series.

**Topics.** Keyword rules in `src/statmesh/data/topics.yaml` match whole words (case-insensitive,
a trailing "s" ignored) in the series title and its dataset title; a series can have several topics.
A manifest can set `datasets: {ID: {topics: [Health]}}`; those topics are added and the dataset
title is then not keyword-matched. A source's topics are the union over its name and dataset titles.

`GET /sources` filters (all optional, AND): `q` (substring of name, id or a dataset title), `kind`,
`topic` (any-of), `redistribute` (`yes|review|no`), `auth` (`keyless` or `key`), `status` (`data`:
has ingested or stale datasets; `catalogue`: none).

### Observation filters

`get_observations` takes connector filters, for example `partner=USA` and `hs=85` for Comtrade or
`period=CY2024` for SEC EDGAR frames. The same thing on every surface:

| Surface | Form |
|---|---|
| REST | repeat `filter=key=value`: `.../observations?filter=partner=USA&filter=hs=85` |
| MCP | `filters` object: `{"partner": "USA", "hs": "85"}` |
| SDK | `Client.get(series_id, filters={"partner": "USA"})` |
| CLI | `statmesh get <id> --filter partner=USA --filter hs=AG2` |

At most 16 filters; a key is 1 to 64 characters of `A-Za-z0-9_.-`, a value at most 256, otherwise
400. A filter with no `=` is a 400.

What a filter does: for a `remote` dataset it goes to the connector's `FetchRequest.filters`
(Comtrade: `partner` ISO3 list or `World`, `hs` `AG2`, `AG4`, `AG6`, `TOTAL` or codes; SEC frames:
`period` such as `CY2024`, `CY2024Q2`, `CY2024Q2I`). Reading rows back, only `partner`, `hs` and
`period` (matched against `dims['frame']`) narrow the result; any other key reaches the connector
but does not filter rows already stored. When `period` is set, `start` and `end` are ignored,
because the fetch is already scoped to that frame. On an `ingested` dataset no fetch happens, so
the filters only narrow the stored rows.

### Errors

| HTTP | When |
|---|---|
| 200 | ok |
| 400 | `ValueError`: bad SQL, a rejected statement or a SQL timeout, bad series id, fetch larger than `STATMESH_FETCH_MAX_ROWS`, unknown country |
| 403 | observations only: the series is not servable (hosted mode and `redistribute` is not `yes`); body is still an observations result with `status: forbidden` |
| 404 | unknown series, source or route; for observations, body has `status: not_found` |
| 422 | request body or query parameters failed validation (FastAPI default) |
| 429 | observations only: `status: rate_limited`, a `Retry-After` header and `retry_after` seconds in the body |
| 503 | a required API key is not set (`MissingKey`); the detail names the env var |
| 504 | an on-demand fetch exceeded `STATMESH_FETCH_TIMEOUT_S` |

Error bodies are `{"detail": "..."}`.

Fetches in `GET /series/.../observations` for a `remote` dataset call the source, so they can be
slow, rate limited or need a key. They pass `geo`, `start`, `end` and the `filter` pairs to the
connector; `limit` caps the reply, not the fetch.

## SQL

One statement, `SELECT` only, over these views and nothing else: `observations`,
`observations_vintages`, `series`, `datasets`, `sources`, `entities`, `entity_xref`, `geos`,
`geo_groups` (columns and join hints: `GET /schema`). CTEs, subqueries, joins and `VALUES` work. Table functions (`read_parquet`,
`read_csv`, ...), `ATTACH`, `COPY`, `SET`, `PRAGMA` and any other statement are rejected.

Two layers enforce this. The DuckDB connection is built by trusted code with external file and
network access off, `allowed_directories` limited to the data folders, extension auto-loading off, a
2 GB memory limit and the configuration locked. Before execution, the statement is parsed with
DuckDB's own parser and the syntax tree is walked to allow only those views. Limits: a timeout
(`STATMESH_SQL_TIMEOUT_S`, default 20 s), a row cap (`STATMESH_SQL_MAX_ROWS`, default 10000;
`truncated: true` when hit) and a byte cap (`STATMESH_SQL_MAX_BYTES`, default 50 MB; a larger
result is an error, not a truncation).

Citations are attached by scanning the result: a `series_id` or series key in any cell or in a SQL
string literal, `source_id`/`dataset_id` columns, or a source id literal. If none are found the
response carries a `warning` asking you to select `series_id`. Select it.

## MCP

Tools (same behaviour as the REST routes):

| Tool | Input | Returns |
|---|---|---|
| `search_series` | optional `q`, `geo`, `freq`, `source`, `topic` (one value or a list), `start_year`, `end_year`, `updated_since`, `redistribute`, `limit` (max 100) | top matches with licence, coverage and topics; same rules as `/search` |
| `describe_series` | `series_id` | full metadata and citation |
| `get_observations` | `series_id`, optional `start`, `end`, `geo`, `limit` (max 10000), `filters` | rows, `status`, citations |
| `run_sql` | `sql` | rows (capped), the SQL echoed back, citations |
| `list_sources` | optional `q`, `kind`, `topic`, `redistribute`, `auth`, `status` | sources, freshness, whether a key is configured, topics |
| `describe_schema` | none | the SQL views with column types, descriptions, examples and join hints (same data as `GET /schema`, from `src/statmesh/data/schema.yaml`) |
| `run_python` | `code` | only when `STATMESH_PYTHON_SANDBOX` is on (self-host); see [sandbox.md](sandbox.md) |

The server instructs the agent to quote the citations that come with every result.

- stdio: `statmesh mcp`. Example client entry (not tested against a specific client):

  ```json
  {"mcpServers": {"statmesh": {
    "command": "uv",
    "args": ["run", "--directory", "/path/to/statmesh", "statmesh", "mcp"],
    "env": {"STATMESH_DATA_DIR": "/path/to/statmesh/data"}
  }}}
  ```

- HTTP: point a streamable-HTTP MCP client at `http://localhost:8000/mcp` (running `statmesh serve`
  or docker compose). The `Host` header is checked against `STATMESH_ALLOWED_HOSTS` (DNS-rebinding
  protection; default `localhost`, `127.0.0.1`, `[::1]` and `api`, any port). Another host gets 421.
  If you reach the server by another name, add it to the variable; `*` switches the check off and
  logs a warning. The stdio server is not affected.

## Python SDK

```sh
uv sync --extra sdk            # pandas and polars
```

```python
from statmesh.sdk import Client

c = Client("http://localhost:8000")  # default: STATMESH_URL or http://localhost:8000
hits = c.search("unemployment India", geo="IND", limit=5)  # DataFrame
df = c.get("worldbank:WDI:SL.UEM.TOTL.ZS:IND", start="2015-01-01")
df = c.get(
    "comtrade:HS-A:X:IND",
    start="2024-01-01",
    end="2024-12-31",
    filters={"partner": "USA", "hs": "AG2"},
)  # connector filters
df.attrs["citations"]  # pandas; for polars use c.citations
c.sql("SELECT count(*) FROM observations")  # DataFrame
c.sources()
c.describe("worldbank:WDI:SL.UEM.TOTL.ZS:IND")
```

`Client(frame="polars")` returns polars frames. `LocalClient()` has the same methods but calls the
service in-process against `STATMESH_DATA_DIR`, with no server. Errors raise `SdkError`
(`retry_after` is set for a rate-limited fetch). The client is a thin wrapper over REST; there is no
published npm client (the web UI's typed client is `web/src/lib/client.ts`).

## CLI

```
statmesh serve [--host H] [--port P]       run REST + MCP
statmesh mcp                               MCP on stdio
statmesh worker                            ingest scheduler
statmesh discover [source]                 refresh the catalog (default: all enabled sources)
statmesh ingest <source> [--dataset ID] [--reprocess]
statmesh search <query> [--geo ISO3] [--freq F] [--source ID] [--local]
statmesh get <series_id> [--start D] [--end D] [--filter KEY=VALUE]... [--format csv|json] [--local]
statmesh sql "<query>" [--local]
statmesh export <series_id>... --out DIR [--format csv|parquet] [--local]
statmesh sources [--local]
statmesh connector new <id> --kind sdmx|file|rest|custom
statmesh connector record <id>
statmesh connector test <id> [--live]
```

- `search`, `get`, `sql`, `export` and `sources` talk to a server at `STATMESH_URL` unless you pass
  `--local`, which runs the service in-process on `STATMESH_DATA_DIR`. Output is CSV on stdout
  (`get --format json` gives the full result with citations); errors go to stderr with exit code 1.
- `ingest` with no `--dataset` ingests the source's `core_datasets`; with none, it asks for
  `--dataset`. `discover` and `ingest` write to `STATMESH_DATA_DIR`; the server picks up new data after the
  manifest swap, so they can run while it is up.
- `export` writes one file per series plus a `SOURCES.md` listing every source, dataset, licence,
  attribution and retrieval time. Series whose licence is `no` or `review` get a redistribution
  warning there. Complex cells (`dims`) are written as JSON text.
- The CLI does not read `.env`. Use `uv run --env-file .env statmesh ...`, `set -a; . ./.env`, or
  docker compose.
