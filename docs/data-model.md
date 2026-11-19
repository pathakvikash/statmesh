# Data model and harmonisation

All numeric data lands in one long-format `observations` table, so a cross-source join is a plain
SQL join. Things that are not time series (companies, identifier links) get their own typed tables.
Harmonising keys is the point of the project; storage is the easy part.

## Ids

- Series key: `source:dataset:indicator`, for example `ilostat:DF_UNE_DEAP_SEX_AGE_RT:UNE_DEAP_RT`.
  One catalog row per series key, so World Bank is about 16k rows, not 3.5M.
- Series id: `series_key:geo`, for example `ilostat:DF_UNE_DEAP_SEX_AGE_RT:UNE_DEAP_RT:IND`. This is
  the `series_id` column of `observations`.
- REST and MCP accept either form. A series key (three parts) means all geographies.
- `dataset_id` and `indicator_id` never contain `:` (connectors replace it with `_`). IMF CPI
  indicators look like `CPI._T.YOY_PCH_PA_PT` (dimension values joined with `.`).

## observations

| Column | Type | Note |
|---|---|---|
| `series_id` | string | `source:dataset:indicator:geo` |
| `source_id`, `dataset_id`, `indicator_id` | string | the source's own codes, kept as published |
| `geo` | string | ISO 3166-1 alpha-3; `region:<code>` for aggregates; `IN-XX` for an Indian state; `unmapped:<code>` when no mapping exists |
| `period_start`, `period_end` | date | explicit, inclusive range, so fiscal and calendar years never mix silently |
| `freq` | string | `A`, `S`, `Q`, `M`, `W`, `D` |
| `value` | double | null allowed when `obs_status` explains it |
| `unit` | string | as published; no silent conversion |
| `unit_mult` | int8 | power of ten **beyond what `unit` already says**; see below |
| `dims` | map(string, string) | extra dimensions, keys sorted. Read with `dims['sex']` |
| `obs_status` | string | the source's flag, kept (for example `p` provisional) |
| `retrieved_at` | timestamp (UTC) | when we fetched it |
| `vintage` | date | release date when the source gives one |

`unit_mult` rule: real value = `value * 10^unit_mult`, in the unit as worded. If the published unit
text already names the scale ("Billions of Dollars", "Millions of chained 2017 dollars"), the
connector keeps that text and sets `unit_mult` to 0. If the unit is bare ("Level", "Persons") and the
source gives a scale factor (IMF `SCALE`, ECB `UNIT_MULT`), `unit_mult` carries it (6 = millions).
Never both, or a consumer scales twice. Use `value * power(10, unit_mult)` in SQL when you need the
base unit.

`retrieved_at` appears in SQL as a naive UTC timestamp. Row identity (for merging refreshes) is
`series_id, period_start, freq, dims`.

## entities and entity_xref

Company records and identifier links.

`entities`: `entity_id` (`lei:<LEI>`, `cik:<10 digits>`, `uk:<number>`), `source_id`, `name`,
`country` (ISO3), `industry_code`, `industry_scheme` (`SIC`, `NACE`, `ISIC`, `NIC`), `address`,
`attrs` (map), `retrieved_at`.

`entity_xref`: `from_id`, `to_id` (ids as above, plus `isin:`, `ticker:`, `bic:`), `source_id`,
`confidence` (1.0 for official mappings), `inferred`, `retrieved_at`. GLEIF supplies LEI to ISIN and
BIC.

Inferred links. After any ingest of an `entities` table from `sec_edgar`, `gleif` or
`uk_companies_house`, statmesh recomputes `cik:` to `lei:` and `uk:` to `lei:` links
(`ingest/xref.py`) from every ingested entity. They have `inferred = true`, `source_id = gleif`
(so hosted mode serves them) and live in `tables/entity_xref/gleif/_inferred/`.
- A UK company number that equals a GBR LEI's `registered_as` gives confidence 1.0.
- Otherwise the legal names must match exactly after normalising (case, accents, `&`, punctuation,
  a leading "the", trailing suffixes such as Inc, Corp, Ltd, PLC) and the countries must not
  disagree. A matching state or postcode gives 0.9; no location on one side gives 0.6; locations on
  both sides that disagree give 0.4.
- Several LEIs tied at the best score means no link. There is no fuzzy matching. "Foo Inc" and "Foo
  Ltd" normalise to the same name, so check `confidence` before you rely on a link.

## SQL views

What `run_sql` and the `/query` endpoint can read:

| View | Content |
|---|---|
| `observations` | live rows: ingested data plus on-demand cache |
| `observations_vintages` | live rows plus superseded values (core datasets only) |
| `series` | one row per series key: `series_key`, `source_id`, `dataset_id`, `indicator_id`, `title`, `description`, `unit`, `freq`, `geos` (space separated), `start_date`, `end_date`, `dims_json`, and the effective licence columns (series, then dataset, then source) |
| `datasets` | `source_id`, `dataset_id`, `title`, `description`, `source_url`, `freq`, licence columns, `is_core`, `status` (`ingested`, `remote`, `stale`), `source_updated_at`, `last_ingested_at` |
| `sources` | `id`, `name`, `kind`, `endpoint`, `auth`, `key_required`, licence columns, `discovered_at` |
| `entities`, `entity_xref` | as above |
| `geos` | `geo`, `name`, `iso2`, `m49` for every country, plus `region:` codes |
| `geo_groups` | `group_id`, `geo`; groups are `G20`, `G7`, `EU27` (from `src/statmesh/data/groups.csv`) |

`series` has `series_key`, not `series_id`; join it to observations with
`s.series_key = o.source_id || ':' || o.dataset_id || ':' || o.indicator_id`.

## Harmonisation rules

- **Countries.** ISO 3166-1 alpha-3 is canonical (`pycountry`). Each connector maps its own scheme
  (`iso2`, `iso3`, `m49`, `name`) through `to_geo`, with per-source exceptions in `geo_map.csv`
  (`src_code,geo`; World Bank maps `EUU` to `region:EU27`). Aggregates (World, EU27, income groups)
  get `region:` codes and never mix with countries. A code that cannot be mapped is kept as
  `unmapped:<code>`, and the contract suite fails a connector if more than 5% of codes are unmapped.
  `src/statmesh/data/regions.csv` lists the region codes.
- **India.** The fiscal year runs April to March, and PLFS publishes monthly, quarterly and annual
  rounds. Explicit `period_start`/`period_end` carry both. `parse_period` reads `2024-25` as April
  2024 to March 2025, and with `fiscal_start_month: 4` reads `2024`, `2024Q1` and `2024S1` as fiscal
  periods. State-level geography uses `IN-XX` (ISO 3166-2) with LGD codes mapped through
  `src/statmesh/data/geo/in_states.csv`; the `lgd_state` scheme is available to custom connectors.
  Mapping is only as complete as that CSV.
- **Products.** Comtrade rows keep the HS code in `dims['hs']` and the level in `dims['hs_level']`
  (`2`, `4`, `6`, or `0` for TOTAL). `src/statmesh/data/hs/hs2.csv` lists HS chapters. No ISIC or NIC
  concordance is shipped yet.
- **Companies.** LEI is canonical where one exists; `entity_xref` links LEI, CIK, ticker and ISIN.
- **Units and currency.** Kept as published. There is no currency conversion in the engine; do it in
  SQL with an exchange-rate series you pick.
- **Revisions.** For core datasets, when a refresh changes a value the old value moves to
  `observations_vintages`, stamped with the old `retrieved_at` date as `vintage`. The long tail keeps
  the latest only. Calling `statmesh ingest --reprocess` rebuilds the live rows from raw snapshots
  and does not create vintages.
- **Latest release date.** Every series shows `last_updated` and `last_ingested_at` in `describe`;
  nothing is presented as real time.

## Catalog

SQLite (`data/catalog.sqlite`, WAL, one writer and many readers). Tables: `sources`, `datasets`,
`series` (with an FTS5 index over title, description and synonyms), `codelists`, `lineage` (raw
snapshot path and SHA-256, URL, params with the key redacted, retrieval time, connector version,
the Parquet parts written), `jobs` (scheduler state and last error), `cache_entries` (on-demand
results and their expiry), `rate_usage` (per-hour and per-day request counts).

Search is keyword only: FTS5, `src/statmesh/data/synonyms.yaml` ("jobless" to unemployment), and
country-name extraction from the query (`G20`, `G7`, `EU27` expand to members). There are no
embeddings.

## Storage layout

```
data/
  catalog.sqlite
  manifest.json            # lists the live Parquet parts; replaced atomically
  raw/<source>/<dataset>/<timestamp>-<sha>.<ext>.gz     # responses as fetched
  obs/<source>/<dataset>/part-*.parquet                 # live observations
  obs/<source>/<dataset>/vintage-*.parquet              # superseded values (core datasets)
  tables/<entities|entity_xref>/<source>/<dataset>/*.parquet
  tables/entity_xref/gleif/_inferred/*.parquet          # inferred CIK/UK -> LEI links
  locks/<source>__<dataset>.lock                        # one ingest per dataset at a time
  cache/obs/<source>/<dataset>/*.parquet                # on-demand results, with a TTL
  cache/http/                                           # HTTP response cache
```

Each dataset has its own part directory (and its own table prefix under `tables/`), so refreshing
or reprocessing one dataset never touches another's files, and a part is only deleted once it is in
neither the old nor the new manifest and is older than 10 minutes. DuckDB may read only `obs/`,
`tables/` and `cache/obs/`. Parts are zstd Parquet.
