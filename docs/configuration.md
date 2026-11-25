# Configuration

All configuration is environment variables. `statmesh.settings.Settings.from_env()` reads the
`STATMESH_*` ones; each connector's HTTP client reads its own key variable. The CLI and server do not
load `.env` themselves: docker compose does (`env_file`); locally use
`uv run --env-file .env statmesh ...` or `set -a; . ./.env; set +a`. Copy `.env.example` to `.env`
to start; it is gitignored.

## STATMESH_* settings

| Variable | Default | Meaning |
|---|---|---|
| `STATMESH_DATA_DIR` | `./data` (compose and image: `/data`) | where the catalog, Parquet, raw files and caches live |
| `STATMESH_MODE` | `self_host` | `self_host` or `hosted`; anything else is an error at startup. `hosted` serves only `redistribute: yes` data ([licensing.md](licensing.md)) |
| `STATMESH_CONTACT_EMAIL` | unset | appended to the User-Agent as `statmesh/<version> (+email)`. Required: `serve`, `worker` and `mcp` refuse to start while `sec_edgar` is enabled and it is empty (`Settings.validate`). Set it, or add `sec_edgar` to `STATMESH_DISABLE`. `ingest`, `discover` and the other CLI commands do not check it |
| `STATMESH_DISABLE` | empty | comma-separated source ids to turn off, for example `datagovin,fred`; `load_connector` refuses them and the scheduler skips them |
| `STATMESH_CONNECTORS_DIR` | unset | extra folder of connectors; a folder there overrides a bundled connector with the same id, and `connector new` writes there |
| `STATMESH_SQL_TIMEOUT_S` | `20` | SQL statement timeout, seconds |
| `STATMESH_SQL_MAX_ROWS` | `10000` | row cap for SQL and observations results; `truncated: true` when hit |
| `STATMESH_SQL_MAX_BYTES` | `50000000` | a SQL result larger than this many bytes is aborted with an error (`result larger than N bytes; select less`), checked per batch while reading |
| `STATMESH_FETCH_TIMEOUT_S` | `30` | wall-clock budget of one on-demand fetch |
| `STATMESH_FETCH_MAX_ROWS` | `200000` | row cap of one on-demand fetch; over it the request is rejected |
| `STATMESH_FETCH_MAX_WAIT_S` | `5` | longest an on-demand fetch will wait for a rate limit before returning `rate_limited` with `retry_after` |
| `STATMESH_DUCKDB_MEMORY` | `2GB` | DuckDB `memory_limit` of the query engine, for example `512MB` or `2GB`; anything else is an error at startup |
| `STATMESH_ONDEMAND` | on; off when `hosted` | `1/true/yes` or `0/false/no`. Off: nothing is fetched live; observations of a never-ingested (`remote`) dataset return `status: ok` with no rows, and search drops hits from such datasets |
| `STATMESH_CORS_ORIGINS` | empty | comma-separated allowed origins (`https://host[:port]`, no path) or `*` |
| `STATMESH_CACHE_MAX_AGE` | `0`; `300` when `hosted` | `Cache-Control` max-age in seconds for cacheable responses; `0` = none |
| `STATMESH_SHARES` | on | `1/true/yes` or `0/false/no`: shareable answer links |
| `STATMESH_GAP_LOG` | on (self-host), off (hosted) | `1` enables, `0/false/no` disables. Off by default when `STATMESH_MODE=hosted` (ephemeral disk and no shell, so the file cannot be read; no durable store yet). When on, it records the gap log: zero-hit search queries (normalised text, count and filters only) kept in `gaps.sqlite` in the data dir, read with `statmesh gaps` |
| `STATMESH_SHARE_MAX_BYTES` | `512000`; `262144` when `hosted` | largest stored share, bytes (at least 1) |
| `STATMESH_SHARE_TTL_DAYS` | `0` (forever); `90` when `hosted` | days a share lives |
| `STATMESH_EXPORT_MAX_ROWS` | `5000000` | row cap of the CSV export (at least 1) |
| `STATMESH_PYTHON_SANDBOX` | off | `1`, `true` or `yes` enables `POST /python` and the MCP tool `run_python`. Self-host only; needs Docker and, in practice, the Docker socket, which is root-equivalent on the host. Read [sandbox.md](sandbox.md) first |
| `STATMESH_ALLOWED_HOSTS` | `localhost:*,127.0.0.1:*,[::1]:*,api:*` | comma-separated `Host` values the MCP endpoint accepts (DNS-rebinding protection; `api` is the compose service name). Anything else gets 421. `*` alone turns the check off and logs a warning at startup. Set it to your public hostname if you serve behind a proxy |
| `STATMESH_PUBLIC_URL` | empty | hosted mirror only: the public origin (`http(s)://host[:port]`, no path). The OpenAPI document then declares `servers: [{"url": "<origin>/v1"}]` for ChatGPT Actions. Empty: the first non-wildcard `STATMESH_ALLOWED_HOSTS` name over https. Self-host leaves `servers` unset |

Numeric values that do not parse raise at startup. In `hosted` mode the defaults above marked "when hosted" apply; an explicitly set variable always wins. The new values are range-checked by `Settings.validate`.

## Client and UI variables

| Variable | Default | Read by |
|---|---|---|
| `STATMESH_URL` | `http://localhost:8000` | Python SDK `Client` and the CLI without `--local` |
| `STATMESH_API_URL` | `http://localhost:8000` | the Next.js web UI (compose sets `http://api:8000`) |
| `STATMESH_EVAL_CATALOG` | unset | CI only: path to a fixture catalog for the search-recall test |

## API keys

All are free. A source that lists "optional" works without the key at a lower limit.

| Variable | Source | Needed |
|---|---|---|
| `FRED_API_KEY` | `fred` | required; no keyless mode |
| `COMTRADE_API_KEY` | `comtrade` | optional: without it the public preview is used (500 records per call); with it, 500 calls per day and 100k records per call |
| `BLS_API_KEY` | `bls` | optional: keyless v1 allows 25 queries per day. The manifest rate limit is fixed at the keyless value, so a key does not raise it yet |
| `DATAGOVIN_API_KEY` | `datagovin` | required |
| `CENSUS_API_KEY` | `census` | required |
| `BEA_API_KEY` | `bea` | required |
| `EIA_API_KEY` | `eia` | required |
| `COMPANIES_HOUSE_API_KEY` | `uk_companies_house` | optional (`key_required: false` in the manifest) |
| `DATACOMMONS_API_KEY` | `datacommons` | required (sent in the `X-API-Key` header) |

BLS and Census keys need an activation step before they work; not tested here. A bad or inactive
Census key returns an HTML page (HTTP 200), which the connector reports as an invalid key.

Sources with no key: `worldbank`, `imf`, `oecd`, `ilostat`, `eurostat`, `ecb`, `bis`, `unsdg`,
`faostat`, `dbnomics`, `mospi`, `sec_edgar` (contact email only), `gleif`, `esef`, `who_gho`,
`cdc_data`, `open_canada`.

Behaviour when a required key is missing: the connector raises `MissingKey` naming the variable. REST
returns 503 with that message; a scheduled job fails and the dataset goes stale; `GET /sources` and
the MCP `list_sources` report `key_configured: false`. Keys are redacted from logs, errors,
lineage and recorded fixtures.

## Per-source settings that are not environment variables

These live in the connector's `manifest.yaml` (see [connectors.md](connectors.md)): `rate_limit`,
`refresh.schedule`, `core_datasets`, `cache_ttl_days`, and the `options` and `datasets` blocks.
Edit the manifest and restart the worker. For example, to widen what Eurostat ingests, add to
`core_datasets` and `datasets` in `connectors/eurostat/manifest.yaml`.

## Proxies

Recording fixtures (`statmesh connector record`) honours `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY`
per request.
