# Connector SDK guide

A source is a folder under `src/statmesh/connectors/<id>/` (or under `STATMESH_CONNECTORS_DIR`).
Pick the lowest level that works.

| Level | Use when | Files | Example |
|---|---|---|---|
| 1. Config only | the source speaks SDMX, or serves a plain CSV/XLSX/ZIP URL | `manifest.yaml` | `eurostat`, `oecd`, `imf`, `ilostat`, `ecb`, `bis`, `unsdg` |
| 2. Config + mapping | file or portal data with its own column names | `manifest.yaml`, `mapping.yaml` | `faostat`, `cdc_data`, `open_canada` |
| 3. Code | anything else | `manifest.yaml`, `connector.py` | `worldbank`, `sec_edgar` |

The 27 bundled connectors: `bea`, `bis`, `bls`, `cdc_data`, `census`, `comtrade`, `datacommons`,
`datagovin`, `dbnomics`, `ecb`, `eia`, `esef`, `eurostat`, `faostat`, `fred`, `gleif`, `ilostat`,
`imf`, `mospi`, `oecd`, `open_canada`, `owid`, `sec_edgar`, `uk_companies_house`, `unsdg`, `who_gho`,
`worldbank`. Kind, key and licence of each are in the README sources table.

`manifest.id` must equal the folder name and match `^[a-z][a-z0-9_]*$`. A folder in
`STATMESH_CONNECTORS_DIR` overrides a bundled connector with the same id. Set
`STATMESH_DISABLE=id1,id2` to turn sources off.

## Scaffold

```sh
statmesh connector new mysource --kind sdmx     # sdmx | file | rest | custom
statmesh connector record mysource              # run discover + tests/fixtures/requests.yaml live, save the responses
statmesh connector test mysource                # pytest for that folder, offline
statmesh connector test mysource --live         # only @pytest.mark.live tests, real network
```

`new` writes into `STATMESH_CONNECTORS_DIR` if set, otherwise into the package's bundled
`connectors/` folder. Output: `manifest.yaml` with `TODO` markers, `tests/test_contract.py`,
`tests/test_smoke.py`, `tests/fixtures/requests.yaml`, plus `mapping.yaml` (kind `file`) or
`connector.py` (kinds `rest`, `custom`). Kind `file` ships a working example on a synthetic fixture.
The other kinds pass `test_manifest_valid` immediately and need `record` once the TODOs are filled
in. `rest` and `custom` are the same thing: a folder with a `connector.py`; there is no declarative
REST engine. `ckan` and `socrata` have scaffold options too: like `file`, they write a `mapping.yaml`.

## manifest.yaml reference

Validated by `core/models.py:Manifest`; unknown keys are an error.

| Key | Meaning |
|---|---|
| `id`, `name` | required |
| `kind` | `sdmx`, `file`, `ckan`, `socrata`, `rest`, `custom` |
| `endpoint` | API root or portal domain |
| `sdmx_version` | `"2.1"` or `"3.0"` (informational) |
| `auth` | `none` (default) or `free_key` |
| `key_env` | env var holding the key; required when `auth: free_key` |
| `key_required` | default `true`. `false` means it works without the key at a lower limit (BLS, Comtrade) |
| `licence` | **mandatory**: `name`, `url`, `redistribute` (`"yes"`, `"no"`, `"review"`; quote `"yes"`/`"no"`, YAML turns bare ones into booleans), `attribution` |
| `rate_limit` | `per_second`, `per_hour` (alias `max_downloads_per_hour`), `per_day` |
| `refresh` | `schedule`: 5-field cron in UTC; `incremental`: e.g. `updatedAfter` (meaning is connector specific). Leave `incremental` out where the source rejects it (OECD: `updatedAfter` returns 403, so it does a weekly full refresh) |
| `core_datasets` | dataset ids ingested on schedule; everything else is on demand |
| `datasets` | per-dataset options, validated by the connector |
| `options` | per-source options, validated by the connector |
| `cache_ttl_days` | on-demand cache lifetime, default 7 |
| `version` | bump when `normalize` changes; then `statmesh ingest ... --reprocess` |

The worker only schedules a dataset when the manifest has both `core_datasets` and
`refresh.schedule`. A source with a schedule but no core datasets (`dbnomics`, `gleif`,
`uk_companies_house`, `mospi`) is ingested by running `statmesh ingest --dataset ID` yourself.

### Level 1: the Eurostat manifest

```yaml
id: eurostat
name: Eurostat
kind: sdmx
endpoint: https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1
sdmx_version: "2.1"
licence:
  name: CC BY 4.0 (Commission Decision 2011/833/EU)
  url: https://ec.europa.eu/eurostat/about-us/policies/copyright
  redistribute: "yes"
  attribution: "Source: Eurostat"
rate_limit: {per_second: 2}
refresh: {schedule: "0 3 * * 2", incremental: updatedAfter}
core_datasets: [une_rt_a]
options:                       # all datasets
  agency: ESTAT
  list_path: dataflow/ESTAT/all/latest
  list_params: {detail: allstubs}
  geo_dim: geo
  freq_dim: freq
  geo_scheme: iso2
  unit_col: unit
  status_col: OBS_FLAG
datasets:                      # one dataset
  une_rt_a:
    indicator_dims: [unit]
    filters: {age: Y15-74, sex: T, unit: PC_ACT}
```

An optional `geo_map.csv` next to it (`src_code,geo`) holds exceptions to the code scheme.

## The SDMX connector (`kind: sdmx`)

Requests SDMX-CSV and parses it with pyarrow; reads structure messages (dataflows, DSDs,
codelists) with `sdmx1`. SDMX-ML data is not supported. All HTTP goes through `HttpClient`. Options
go in `options:` (all datasets) and can be overridden in `datasets.<id>:`; names are the source's own
and case-sensitive.

| Option | Default | Meaning |
|---|---|---|
| `agency` | none | agency in the flow ref `AGENCY,ID`; omit to send only `ID` (IMF, OECD) |
| `list_path`, `list_params` | `dataflow/all` | dataflow list request |
| `structure_path` | `dataflow/{agency}/{id}/latest` | per-dataflow structure (`references=descendants`) |
| `geo_dim` | `REF_AREA` | geography dimension |
| `geo_scheme` | `iso3` | `iso3`, `iso2`, `m49`, `name`; exceptions in `geo_map.csv` |
| `time_dim`, `freq_dim`, `value_col`, `status_col` | `TIME_PERIOD`, `FREQ`, `OBS_VALUE`, `OBS_STATUS` | column names |
| `accept` | SDMX-CSV 1.0 | `Accept` header for data requests; the ECB only serves `text/csv` |
| `structure_references` | `descendants` | `references` for the structure request `fetch` makes (it only needs the DSD's dimension order). Use `children` when the codelists are huge (ECB `FM`: 23 MB vs 36 KB). `discover` always uses `descendants` |
| `unit_col` | none | CSV column holding the unit (e.g. `UNIT_MEASURE`) |
| `unit` | none | constant unit used when the unit column is absent or empty |
| `units` | `{}` | `{indicator_id: unit}` for indicators whose unit column is empty; wins over `unit` (IMF CPI year-on-year) |
| `unit_mult_col` | none | CSV column holding the power of ten (`UNIT_MULT`, IMF `SCALE`); copied as is, so follow the `unit_mult` rule in [data-model.md](data-model.md) |
| `indicator_dims` | `[]` | dimensions joined with `.` into `indicator_id`; default gives `VALUE`. Every other dimension lands in `dims` |
| `filters` | `{}` | `{DIM: code or [codes]}` on every request; also limits `discover` |
| `codelists` | `CL_<DIM>` | `{DIM: codelist id}` where the DSD does not link one (IMF) |
| `fiscal_start_month` | 1 | passed to `parse_period` |

`refresh.incremental: updatedAfter` adds `updatedAfter` to data requests. `discover` expands at most
500 indicators per dataset; use `filters` to narrow a wider codelist. Period strings like
`2024-M01` are rewritten before parsing. IMF's CPI manifest (`connectors/imf/manifest.yaml`) is the
worked example of `indicator_dims`, `filters` and `codelists`.

## The file connector (`kind: file`) and `mapping.yaml`

CSV, XLSX, or a ZIP holding either, at `datasets.<id>.url` in the manifest. `mapping.yaml` says how
columns become observations. `faostat` is the worked example (composite indicator, `where`,
`units`).

```yaml
datasets:
  pop:
    title: Population            # catalog title (default: the id)
    format: csv                  # csv | xlsx | zip | gz; default from the URL suffix (gz = gzip-compressed CSV)
    member: data.csv             # zip: file inside (default: first .csv/.xlsx)
    sheet: Sheet1                # xlsx (default: first sheet)
    skip_rows: 0                 # rows above the header
    encoding: utf-8-sig          # csv
    geo: Country                 # a column, or `geo_const: IND`
    geo_scheme: iso3             # iso2 | iso3 | m49 | name; geo_map.csv wins
    period: Year                 # column (required); parse_period forms, or:
    period_format: "%d/%m/%Y"    #   a strptime format; then `freq` (A, M or D) is required
    fiscal_start_month: 1
    freq: A                      # constant; overrides what parse_period infers
    value: Value                 # long layout: value column
    indicator: Series            # long layout: the indicator column, or a LIST of columns joined
                                 #   with "." (composite, e.g. [Item Code, Element Code])
    indicator_title: [Item, Element]  # name column(s), joined with " - " into dims["indicator_title"]
                                 #   (observations have no title column and `discover` cannot list
                                 #   data-driven series)
    indicator_id: pop            #   a constant (default: the dataset id)
    where: {Element Code: [5510, 5312], Flag: A}  # keep only rows whose column equals one of the
                                 #   values (compared as stripped text), applied while reading
    melt: [Male, Female]         # wide layout: these columns become indicators (list or {column: id})
    unit: persons                # a constant, or `unit_col: Unit`
    units: {m: persons, f: persons}  # per-indicator unit (by indicator id); beats unit / unit_col
    unit_mult: 0                 # power of ten beyond what the unit says
    dims: [Sex, Age]             # columns copied into `dims`
    status: Flag                 # column copied into obs_status
    max_uncompressed_mb: 4096    # manifest or mapping; see caps below
```

Behaviour:

- A row too short to hold the geo, period and value columns (a "Source: ..." footer) or with an
  unparseable period is skipped. If every row is skipped that is an error. Rows removed by `where`
  are not counted as malformed. Unparseable values become null with `obs_status: missing`.
- Streaming: CSV, plain or inside a ZIP, is read row by row, so memory stays flat in the file size
  and only the kept observations are held. The raw snapshot is the downloaded file (the zip itself
  for zips). XLSX is read in memory.
- Caps (zip-bomb guard): a CSV stream stops with an error once more than `max_uncompressed_mb` bytes
  were read (default 4096 MB) and the sizes declared in the zip header are checked too. XLSX and
  zip-wrapped XLSX default to 500 MB.
- `robots.txt` is read once per fetch and a disallowed URL is refused.
- Gzip: a `.gz` file (or `format: gz`) is a gzip-compressed CSV. It streams through the same row
  reader and the same `max_uncompressed_mb` cap as CSV.
- `file://` URLs read a local path, for example `file:///data/x.csv`. They are refused when
  `STATMESH_MODE=hosted`, because the server must not read its own disk on behalf of a request.
- Not supported: request filters (geos, dates and indicators are not applied to the download),
  several sheets per file. A `where` clause is how you keep a huge file small.

## CKAN and Socrata (`kind: ckan`, `kind: socrata`)

Both catalogue a portal's datasets (catalog only, resources stay remote) and produce observations
only for datasets that have an entry in `mapping.yaml` (same keys as above), fetched on demand.

- **CKAN** (`connectors/open_canada`): `endpoint` is the CKAN action API root. `options`:
  `site_url`, `q`, `fq`, `page_size`, `max_rows`. `datasets.<package>.resource` picks a resource
  (default: first CSV/XLSX). Resources with `datastore_active` are read with `datastore_search`;
  others are downloaded (no ZIP).
- **Socrata** (`connectors/cdc_data`): `endpoint` is the portal domain. `options`: `page_size`,
  `max_rows`. `datasets.<4x4 id>.where` is an optional `$where`. No app tokens.

In both, a dataset's licence name comes from the portal's own metadata where present; the
attribution and `redistribute` come from the manifest, with one exception: if the portal's licence
name differs from the manifest's, that dataset is downgraded to `review`. The CKAN mapping also
takes `units: {indicator_id: unit}` for melted columns. When `max_rows` is hit and the portal has
more rows, the chunk carries `meta["truncated"] = True` and a warning is logged; narrow the
request (`where`, `fq`, `q`) if you need all rows.

## Level 3: custom code

`connector.py` must define a class named `Connector` constructed as `Connector(manifest, directory)`.
Copy `connectors/worldbank/` for a keyless REST source or `connectors/sec_edgar/` for one that
also fills the `entities` and `entity_xref` tables.

```python
class Connector:
    def __init__(self, manifest: Manifest, directory: Path): ...
    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]: ...
    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]: ...
    def normalize(self, chunk: RawChunk) -> pa.Table: ...
```

- `discover` lists datasets and their series for the catalog. No observations. `limit` is used by
  the fixture recorder and by tests; honour it.
- `fetch` does all the HTTP, through `http` only, and yields `RawChunk`s. `FetchRequest` carries
  `dataset_id`, `indicator_ids`, `geos` (canonical codes; map back to the source's own), `start`,
  `end`, `filters` (extra dimensions, e.g. `{"partner": "USA"}`), `updated_after`, `max_rows`.
  Send an API key as `params={"api_key": http.key}` (or a header) and put `"REDACTED"` in
  `RawChunk.params`. `http.key` is read from the env var named by `key_env`; a missing required key
  raises `MissingKey`.
- `normalize` is pure: no I/O. It returns a table that
  matches `TABLE_SCHEMAS[chunk.table]` exactly. `chunk.table` is `observations` (default),
  `entities` or `entity_xref`.
- Do not import `requests`, `httpx` or `urllib` in a connector and do not call `time.sleep`. Do not
  write retry, cache or rate-limit code. Keep every file inside the connector's folder.
- Series ids are `source:dataset:indicator:geo`; the three first parts must not contain `:`. Use
  `make_series_id(source, dataset, indicator, geo)`.
- Geography: `to_geo(code, scheme, overrides)` returns an ISO3 code, `region:<code>` for an
  aggregate, or `unmapped:<code>`. Periods: `parse_period("2024-25", fiscal_start_month=4)` gives
  `(start, end, freq)`. See [data-model.md](data-model.md).
- For on-demand sources set `core_datasets: []` and let `fetch` honour `req.max_rows`. `discover`
  should still return the catalog.
- Every dataset needs a licence. A series can carry its own (`SeriesMeta.licence`), which is how
  `fred` marks copyrighted series. `dbnomics` takes a licence per provider from `options.providers`.
  The most specific level that sets one wins: series, then dataset, then source.
- `RawChunk.meta["truncated"] = True` marks a chunk cut by a row cap (`datagovin`, `mospi`, CKAN,
  Socrata, SDMX set it). It stays on the chunk and is logged, and the service exposes it: an
  observations result for the series at the cut (the last row's series) carries `partial: true` and a
  partial-data warning on REST, MCP and the SDK; emit rows in series order so the cut lands on the
  right series. Observations and search also take `offset` and return `next_offset` (`truncated` means more
  rows follow). Narrow the request to get every row.
- `unit_mult` is the scale beyond what `unit` says. If the unit text already names the scale
  ("Billions of Dollars"), keep the text and set 0; if the unit is bare, set the power of ten.
  Never both. See [data-model.md](data-model.md).

## Our World in Data (`owid`)

Custom connector, no key. Per chart it reads two public endpoints on `https://ourworldindata.org`:
`/grapher/<slug>.csv?useColumnShortNames=true&csvType=full` (columns `entity,code,year,<values>`) and
`/grapher/<slug>.metadata.json` (title, subtitle, citation, per-column unit and type). OWID has no
catalogue endpoint (`/api/search?q=` is keyword search), so the catalogue is `options.core_slugs` in
the manifest: add a slug there and it is discovered and ingested (dataset `grapher`).

- Series ids are stable: the chart's primary column (the first numeric column in the metadata)
  is `owid:grapher:<slug>:<geo>`; any further numeric column is
  `owid:grapher:<slug>.<shortName>:<geo>`. A chart that later gains a column therefore keeps its
  existing ids. (A chart that already had several columns before this rule changed id for its
  first column: `<slug>.<col>` became `<slug>`.) Year becomes an annual period. `code` is ISO3;
  `OWID_WRL`, `OWID_EU27` and the income groups `OWID_HIC/UMC/LMC/LIC` map to `region:` codes
  (`geo_map.csv`); `OWID_KOS` stays unmapped (no XKX in the geo tables); rows with no code are dropped.
- `vintage` is the release date: the latest column `lastUpdated`, else `dateDownloaded`.
- The CSV endpoint ignores `country`/`time` filters, so `geos`, `start` and `end` are not applied.
- `fetch` skips a chart (with a warning) when its CSV or metadata answers 403, 404, 410 or a
  3xx (renamed slug); other errors abort. Update `core_slugs` when a slug is renamed.
- Licence: the source/dataset default is `review`; every series gets its own licence from the
  metadata citation (`origins[].producer` when present, else the parsed `citationShort`/`citation`):
  IHME / GBD / Global Burden of Disease -> `no` (OWID answers their CSV with 403, so they are
  catalogued only if listed); all producers on `options.open_producers` in the manifest (OWID,
  World Bank CC BY 4.0, UN WPP CC BY 3.0 IGO) -> `yes`; anything else (WHO, UNODC, UN IGME,
  WUENIC...) -> `review`, named "upstream provider terms (<producer>)". One non-allowlisted
  producer makes the chart `review`. Fixtures were recorded from the live API (4 slugs).

## Connectors added in M3

Six folders were added in M3 (33 in all; the full list is the sources table in the README). Their
licence terms are unverified, so each has `redistribute: review`, except ABS.

| Id | Kind | Fixtures | Notes |
|---|---|---|---|
| `unicef` | sdmx | synthetic | under-5 mortality (`CME`); values invented until re-recorded live |
| `abs` | sdmx | synthetic | quarterly resident population (`ERP_Q`); CC BY 4.0, `redistribute: yes` |
| `insee` | sdmx | synthetic | French deaths (`DECES-MORTALITE`); licence terms not verified |
| `unhcr` | custom | real | on demand only: `fetch` needs `req.geos` (country of asylum), so no core datasets |
| `unesco_uis` | custom | real | on demand only: `fetch` needs `req.geos` (ISO3), so no core datasets |
| `ibge` | custom | real | Brazil resident population (SIDRA table 6579), national level |
| `dhs` | custom | real (one trimmed, marked synthetic) | `api.dhsprogram.com/rest/dhs`, keyless; 15 headline indicators (India NFHS, national and state), `redistribute: review`. Add countries via `options.countries` / `options.region_schemes`. No confidence-interval columns (the schema has none) |

`datagovin` maps each resource under `datasets.<resource id>`: `indicators` (`{id: field}`, one
observation per field), `period_format` (strptime format of `period_field`), `geo_scheme` (for
example `lgd_state`) and `max_rows` (fetch cap). It is keyed, so `statmesh mirror` and the worker skip
its core dataset (daily mandi prices) while `DATAGOVIN_API_KEY` is unset.

## Tests and fixtures

`tests/test_contract.py` is two lines:

```python
from statmesh.testing.contract import ContractSuite


class TestContract(ContractSuite):
    connector_id = "worldbank"
```

The suite checks: the manifest validates; `discover` returns at least one dataset with a licence;
`fetch` + `normalize` on the recorded fixtures match the observation schema; `normalize` does no
network I/O; geo codes are mapped (at most 5% `unmapped:`); series ids are well formed; no secret
appears in any fixture.

`tests/fixtures/requests.yaml` lists the `FetchRequest`s to record and replay, as YAML:

```yaml
- dataset_id: DF_UNE_DEAP_SEX_AGE_RT
  indicator_ids: [UNE_DEAP_RT]
  geos: [IND, BGD, VNM]
  start: 2018-01-01
  end: 2022-12-31
  filters: {FREQ: A}
```

`statmesh connector record <id>` calls `discover(limit=20)` and every request live and writes
redacted responses under `tests/fixtures/http/`. Offline tests replay them and never touch the
network (pytest-socket blocks sockets). Replay looks responses up by method, URL without query,
sorted params and, for POST, a body hash. If a source has a key it replays with the placeholder
`replay-key` whenever `auth: free_key`, even with `key_required: false`; record such fixtures with a
key set (it is stored as `REDACTED`) so the keyed request shapes match. Without a key, write
fixtures by hand from the documented response shape and mark them `"synthetic": true`. Today
`bea`, `census`, `datacommons`, `datagovin`, `eia` and `fred` have only synthetic fixtures; `bls`
(keyed v2), `gleif` (bulk files) and `uk_companies_house` (REST) have some.

`tests/test_smoke.py` holds `@pytest.mark.live` tests, run nightly (`.github/workflows/smoke.yml`);
a failure opens an issue and does not block pull requests.

For the full list of checks a pull request must pass see [CONTRIBUTING.md](../CONTRIBUTING.md).
