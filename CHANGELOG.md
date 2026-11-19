# Changelog

Scope of each version follows `docs/PLAN.md` section 3; decisions in `docs/DECISIONS.md` override it.
The package version is 0.2.0, with git tags v0.1.0 and v0.2.0; neither has been published to PyPI.
Nothing below was verified against live APIs
unless it says so (almost nothing was).

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
