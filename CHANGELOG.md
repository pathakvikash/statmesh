# Changelog

Scope of each version follows `docs/PLAN.md` section 3; decisions in `docs/DECISIONS.md` override it.
The package version is 0.3.0, with git tags v0.1.0 and v0.2.0 (v0.3.0 is not tagged yet); none has been published to PyPI.
Nothing below was verified against live APIs
unless it says so (almost nothing was).

## v0.3.0 (M2, "It's public")

Built, tested offline, not deployed: nothing here has run on a real host, with Docker, nginx, a live
keyed source or a real model.

### Added

- Hosted mirror and deploy kit (`deploy/hosted/`): a hardened compose file (read-only containers,
  dropped capabilities, internal API network), nginx with per-route rate limits and body caps, and
  split env files so source keys reach only the worker. `statmesh mirror` ingests only redistributable
  core datasets (`--dry-run` lists them); the hosted scheduler skips the rest. Docs:
  `docs/hosted.md`, `docs/hosted-runbook.md`.
- `/v1/` API prefix on the hosted host (`/v1/search`, `/v1/query`, `/v1/mcp`, ...); the web app owns
  the unprefixed paths.
- Share links: `POST /shares` and `GET /shares/{id}`, a Share button under chat answers and a
  read-only `/a/<id>` page. Stored in SQLite with a size cap, optional TTL, a reject-list for
  API-key patterns, and citations rebuilt from the catalog (licence-gated in hosted mode). The page
  warns that numbers come from the sharer's session. See `docs/sharing.md`.
- `statmesh doctor` (`--offline`, `--source`, `--json`): per-source key status plus a live replay
  check, and one live smoke test per connector with per-source issues in CI.
- `GET /series/{id}/observations.csv`: a streamed CSV of every geography of a series, capped by
  `STATMESH_EXPORT_MAX_ROWS`.
- `statmesh bench`: a 200-question benchmark (`evals/benchmark.yaml`) reporting recall@5,
  answerable, cited and answer rate, with a CI gate (`evals/results/thresholds.json`) and optional
  `--llm` grading. It runs against a catalog built from recorded fixtures, so it tests the plumbing,
  not real coverage. Current: 0.795 on all four metrics. See `docs/benchmark.md`.
- Settings: `STATMESH_ONDEMAND`, `STATMESH_CORS_ORIGINS`, `STATMESH_CACHE_MAX_AGE`,
  `STATMESH_SHARES`, `STATMESH_SHARE_MAX_BYTES`, `STATMESH_SHARE_TTL_DAYS`,
  `STATMESH_EXPORT_MAX_ROWS`, `STATMESH_DUCKDB_MEMORY`, with hosted-mode defaults. See
  `docs/configuration.md`.
- Subnational geographies (`US-xx`, `IN-XX`) accepted by `get_observations`.

### Changed

- Hosted mode turns on-demand fetching off, so observations of never-ingested datasets are empty and
  search drops hits from them.
- CORS and `Cache-Control` (with `Vary`) are set by middleware; empty env vars mean the default;
  CORS origins and `validate()` are stricter.
- The benchmark's bench-data directory is marker-guarded and rebuilt from a content hash.

### Security

- Hosted deploy hardening as listed above; source keys go in the worker's env file only.
- Share payloads are rejected when they look like API keys; the share page is `noindex`.

### Known gaps

- Docker, docker compose, nginx and the deploy kit have not been run. A person must sign off on
  licences before launch.
- Remote `yes` sources (sec_edgar frames, census, esef) are empty on the mirror unless `mirror`
  ingests them.
- Shared answers can contain forged numbers; the banner says so.
- Live smoke tests, `bench --llm` and chat with a real model have not been run.

## v0.2.x, unreleased before 0.3.0 (M1, "It answers")

Shipped in commit 8f0653d, after the v0.2.0 tag.

### Added

- SQL workbench in the web UI: schema browser, CodeMirror editor, templates, auto-chart. `GET
  /schema` and the MCP tool `describe_schema` list the views and columns.
- Filters everywhere: search and sources take topic, source, years, `updated_since` and licence;
  hits carry coverage; topic tagging; multi-country series views and a redesigned home with facets.
- Chat: a `show_chart` tool, scope chips and voice input.
- Connectors: `owid` (Our World in Data, with per-series licences) and a WHO GHO core indicator list;
  non-core WHO GHO indicators are fetched on demand. 27 connectors in all.

### Security

- Base URL host check for LLM calls, CSV formula escaping, strict date parameters.

## v0.2.0 (Phase 2)

### Added

- Connectors (13 new, 26 in all): `uk_companies_house`, `esef`, `faostat`, `who_gho`, `ecb`, `bis`,
  `unsdg`, `census`, `bea`, `eia`, `datacommons`, plus the portal samples `cdc_data` (Socrata) and
  `open_canada` (CKAN). MoSPI gained three RBI datasets (trade, balance of payments, FX) marked
  `review`.
- Generic `socrata` and `ckan` connectors and a streaming `file` connector. File mapping options:
  composite `indicator`, `indicator_title`, `where`, per-indicator `units`, streamed CSV with size
  caps.
- SDMX options: `accept`, `structure_references`, `unit`, `units`.
- India state geography: `IN-XX` codes with LGD codes (`data/geo/in_states.csv`).
- Inferred links from SEC CIK and UK company numbers to LEIs (`entity_xref`, `inferred = true`,
  with a confidence), rebuilt after entity ingests.
- Opt-in sandboxed Python: `POST /python`, MCP `run_python`, `STATMESH_PYTHON_SANDBOX`, image in
  `docker/sandbox.Dockerfile`. Off by default, never in hosted mode. See `docs/sandbox.md` for the
  Docker-socket risk.
- Web chat page (bring your own LLM key) that flags numbers not backed by a tool result.
- `docs/hosted.md`: hosted-instance design (Phase 3, not built).

### Changed

- `get_observations` takes connector `filters` on every surface: REST repeated
  `filter=key=value`, MCP `filters`, SDK `get(filters=)`, CLI `--filter`. Comtrade `partner` and
  `hs` and SEC frames `period` are now reachable without Python.
- Limits: search `limit` at most 100; observations `limit` at most 10000; SQL results also capped by
  `STATMESH_SQL_MAX_BYTES` (default 50 MB). Observation filters accept at most 16 keys.
- MCP DNS-rebinding protection is back on, driven by `STATMESH_ALLOWED_HOSTS` (default
  `localhost:*,127.0.0.1:*,[::1]:*,api:*`; `*` disables it with a warning).
- `STATMESH_CONTACT_EMAIL` is required by `serve`, `worker` and `mcp` while `sec_edgar` is enabled.
- Licence resolution is series, then dataset, then source, in the views and in hosted mode (a
  public-domain FRED series is served from a `review` dataset). CKAN and Socrata datasets whose
  portal licence name differs from the manifest's are downgraded to `review`.
- `unit_mult` now means the scale beyond what `unit` already says (never both).
- Each dataset has its own part directory and table prefix; one ingest per dataset at a time (file
  lock, `DatasetBusy`).
- MoSPI NSO datasets moved from `review` to `yes` (decision 1; the RBI datasets stay `review`).
- Q4 policy rates come from the direct `bis` connector (`yes`), not DBnomics (decision 2). DBnomics
  ingests nothing by default.
- OECD: no incremental refresh (`updatedAfter` returns 403); weekly full refresh, core capped at 5
  dataflows (decision 8).
- Census population estimates: vintages 2019 and 2021 only; 2023 onward (`pep/charv`) deferred
  (decision 10).
- Folder names `census`, `open_canada` and `cdc_data` kept in place of the planned `datagov_us` and
  `nyc_opendata` (decision 3).
- CI builds the search-eval catalog from fixtures on every run instead of skipping when it is absent
  (decision 6).

### Known gaps

- FAOSTAT `TCL` (full trade matrix) skipped; the `TCLI` indicators file is used.
- ECB `EXR` not included.
- WHO GHO uses the legacy OData host; WHO's announced replacement was not live.
- Synthetic fixtures only until keys exist: Data Commons, BEA, EIA, FRED, data.gov.in, Census, the
  Companies House REST dataset, BLS keyed v2.
- BLS and Census keys need activation; not tested.
- Sandbox not verified against a real Docker daemon; web chat not run against a live LLM.
- `tests/acceptance` Q4 fails on the current BIS fixtures (no year overlap with the IMF fixtures).

## v0.1.0 (Phase 1)

### Added

- Core engine: connector contract (`discover`, `fetch`, `normalize`), shared `HttpClient` (rate
  limits, retries, cache, key redaction, manual redirects), SQLite catalog with FTS5 search, Parquet
  storage with atomic manifest swap, lineage, vintages for core datasets, on-demand fetch cache with
  a time, row and rate budget, scheduler and `statmesh worker`.
- Licence model: mandatory `licence` block per source, `STATMESH_MODE=hosted` serving only
  `redistribute: yes`, citations on every result, `export` with a `SOURCES.md`.
- Query surfaces: read-only SQL over nine views (DuckDB, locked down, allow-listed `SELECT`), REST
  with OpenAPI, MCP (stdio and HTTP) with `search_series`, `describe_series`, `get_observations`,
  `run_sql`, `list_sources`, Python SDK (`Client`, `LocalClient`; pandas or polars), CLI.
- Connectors (13 folders plus the generic SDMX engine, the plan's 14): `imf`, `oecd`, `ilostat`,
  `eurostat` as config-only SDMX; custom `worldbank`, `comtrade`, `dbnomics`, `mospi`, `datagovin`,
  `fred`, `bls`, `sec_edgar`, `gleif`.
- `statmesh connector new / record / test`, contract suite and fixture replay.
- Search eval (50 questions, top-5 recall gate), the four acceptance questions as offline tests,
  docker compose (`api`, `worker`, optional `web`), the browse pages of the web UI, docs.

### Known gaps

- `datagovin` and `fred` had synthetic fixtures only.
- Comtrade is on demand only and `redistribute: no`.
