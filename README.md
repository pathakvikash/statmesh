# statmesh

statmesh pulls public statistics from many sources (World Bank, IMF, OECD, ILOSTAT, Eurostat, UN
Comtrade, SEC EDGAR, MoSPI and more) into one catalog and one query layer. You find a series by
searching in plain words, read it through the same SQL, REST, MCP, Python or CLI interface whatever
the source, join it across sources on shared keys (country, year, HS product, company), and every
number comes back with its source, licence and retrieval time. A new source is a folder under
`src/statmesh/connectors/`, often just a YAML file. It runs on one machine: Parquet files, DuckDB
for queries, SQLite for the catalog.

Status: v0.2.0. 26 connectors; REST, SQL, MCP, a
Python SDK and a CLI; an optional web UI and an opt-in Python sandbox. The offline test suite passes
(697 tests), including all four acceptance questions. Live runs so far are in
[what has been run](#what-has-been-run); most keyed sources have only synthetic fixtures. See
[known gaps](#known-gaps).

## Run it locally

Needs Python 3.12+ and [uv](https://docs.astral.sh/uv/). The web UI also needs Node 20+.
Commands run from the repo root unless a step says `cd web`.

```sh
git clone <this repo> statmesh && cd statmesh
uv sync --extra sdk           # --extra sdk adds pandas/polars for the Python client
cp .env.example .env          # optional: fill in the keys you have (docs/configuration.md)
```

`uv run --env-file .env` loads `.env` for one command; the CLI does not read it on its own. Two
variables matter for a first run:

- `STATMESH_DATA_DIR`: where the catalog and Parquet files go (default `./data`).
- `STATMESH_CONTACT_EMAIL`: SEC EDGAR needs it, so `serve`, `worker` and `mcp` refuse to start
  without it. To skip SEC EDGAR instead, set `STATMESH_DISABLE=sec_edgar`.

### 1. Try it offline in a minute (no network, no keys)

This builds a data directory from the connectors' recorded test fixtures: about 27k observations
across 19 sources. The numbers are real API responses, but only a small slice of each source.

```sh
export STATMESH_DATA_DIR=$PWD/demo-data STATMESH_DISABLE=sec_edgar
uv run python -c "from statmesh.testing.fixture_catalog import build; build('demo-data')"

uv run statmesh sources --local
uv run statmesh search "unemployment rate India" --local
uv run statmesh sql --local "SELECT geo, period_start, value FROM observations
  WHERE series_id = 'ilostat:DF_UNE_DEAP_SEX_AGE_RT:UNE_DEAP_RT:IND' ORDER BY period_start"
```

`--local` reads the data directory in-process. Without it, the CLI calls a running server at
`STATMESH_URL` (default `http://localhost:8000`).

### 2. Load live data

```sh
export STATMESH_DATA_DIR=$PWD/data
uv run --env-file .env statmesh ingest ilostat     # about 30 s, 38k rows
uv run --env-file .env statmesh sql --local "SELECT geo, period_start, value FROM observations
  WHERE series_id LIKE 'ilostat:DF_UNE_DEAP_SEX_AGE_RT:UNE_DEAP_RT:%'
    AND geo IN ('IND','BGD','VNM') AND freq = 'A' AND period_start >= DATE '2015-01-01'
  ORDER BY geo, period_start"
```

Other keyless sources to start with are `imf`, `oecd`, `eurostat`, `ecb`, `bis` and `worldbank`.
`statmesh discover <source>` lists a source's datasets without loading them. To load a dataset that
is not in the core list, run `statmesh ingest <source> --dataset ID`. `ingest` exits 1 if any
dataset failed.

### 3. Serve REST and MCP

```sh
uv run --env-file .env statmesh serve              # http://127.0.0.1:8000
curl 'http://127.0.0.1:8000/healthz'
curl 'http://127.0.0.1:8000/search?q=unemployment+India&limit=3'
curl -X POST http://127.0.0.1:8000/query -H 'content-type: application/json' \
  -d '{"sql": "SELECT source_id, count(*) AS n FROM observations GROUP BY 1"}'
```

- Interactive API docs: `http://127.0.0.1:8000/docs`.
- MCP over HTTP: `http://127.0.0.1:8000/mcp`.
- MCP over stdio, for Claude Desktop, Claude Code or any other MCP client:

```json
{
  "mcpServers": {
    "statmesh": {
      "command": "uv",
      "args": ["--directory", "/path/to/statmesh", "run", "--env-file", ".env", "statmesh", "mcp"],
      "env": { "STATMESH_DATA_DIR": "/path/to/statmesh/data" }
    }
  }
}
```

Python, with the server running:

```python
from statmesh.sdk import Client

c = Client("http://127.0.0.1:8000")
c.search("CPI inflation India")
c.get("ilostat:DF_UNE_DEAP_SEX_AGE_RT:UNE_DEAP_RT:IND")  # pandas DataFrame
```

### 4. Web UI

With the API from step 3 running:

```sh
cd web
npm install
STATMESH_API_URL=http://127.0.0.1:8000 npm run dev    # http://localhost:3000
```

The pages are search, series detail with a chart, sources, SQL and chat. Chat asks for your own LLM
key (Anthropic or any OpenAI-compatible endpoint) and talks to the API's `/mcp`. For a production
build, run `npm run build`, then `node .next/standalone/server.js`. `next start` does not work with
this config.

### 5. Run the tests

```sh
uv run pytest -q                   # offline; about 40 s
uv run pytest -q -m live           # calls the real APIs; needs network and keys
uv run ruff check . && uv run ruff format --check .
cd web && npm test && npm run typecheck
```

### With docker compose

```sh
cp .env.example .env
mkdir -p data && sudo chown 1000 data    # the image runs as uid 1000; or: chmod a+rwx data
docker compose up -d                     # api on :8000, worker (scheduler)
docker compose exec api statmesh ingest ilostat
curl 'http://localhost:8000/search?q=unemployment+India'
docker compose --profile web up -d       # optional web UI on :3000
```

Details, including what the worker does and does not schedule: [docs/self-hosting.md](docs/self-hosting.md).

### What has been run

Checked on macOS, 19 Nov 2026:

| Check | Result |
|---|---|
| `pytest -q` (offline), ruff | 697 passed, 2 skipped; lint clean |
| Offline demo (step 1): `sources`, `search`, `sql` | works |
| Live `ingest ilostat` and the Q1 query | 38,144 rows in 31 s; annual 2015–2025 for IND, BGD, VNM |
| Live `ingest worldbank` | discover worked (1,498 series); the data call timed out on the World Bank side (its `/v2/country/.../indicator` endpoint did not answer within 40 s, while `/v2/indicator` answered in 0.2 s) |
| `serve`: `/healthz`, `/search`, `/query`, `/series/...`, `/docs`, `/mcp` initialize | works |
| `statmesh mcp` (stdio): initialize, `tools/list` | works |
| CLI against the server (no `--local`) | works |
| Web UI build plus search, series (chart), sources, SQL and chat pages | pages render with demo data |
| Docker image, docker compose, the Python sandbox | not run (no Docker daemon) |
| Web chat with a real LLM | not run |
| Live calls for keyed sources (FRED, BLS, Census, BEA, EIA, Comtrade, …) | not run |

## The four acceptance questions

The v1 spec set these as end-to-end tests (`tests/acceptance/`, offline, through REST and MCP).
Below, each one is a set of commands that work with today's CLI. "Run on fixtures" means I ran the
command against a data directory built from the connectors' recorded test fixtures
(`python -m statmesh.testing.fixture_catalog`) with `--local`; it does not mean the live API was
called. "Not run live" applies to every block: no live ingest or fetch was done for this page.

Run the lines as `uv run --env-file .env statmesh ...`, or `docker compose exec api statmesh ...`.
Add `--local` to read `./data` in-process without a server.

### Q1. Unemployment rate, India, Bangladesh, Vietnam, 2015 to latest

Source: ILOSTAT (annual, total sex, 15+).

```sh
statmesh ingest ilostat          # core dataset DF_UNE_DEAP_SEX_AGE_RT
statmesh sql "
  SELECT series_id, geo, period_start, value, unit
  FROM observations
  WHERE series_id LIKE 'ilostat:DF_UNE_DEAP_SEX_AGE_RT:UNE_DEAP_RT:%'
    AND geo IN ('IND','BGD','VNM') AND freq = 'A' AND period_start >= DATE '2015-01-01'
  ORDER BY geo, period_start"
```

Run live: yes (19 Nov 2026; annual 2015-2025, some years missing per country). The dataset also has
quarterly rows, hence `freq = 'A'`. Selecting `series_id` is what
attaches series-level citations. For a World Bank cross-check use
`worldbank:WDI:SL.UEM.TOTL.ZS:IND`.

### Q2. India exports to the USA by HS chapter, latest year vs five years earlier

Source: UN Comtrade. Set `COMTRADE_API_KEY`, or you get the keyless preview (500 records per
call). Comtrade is fetched on demand and cached 30 days; it is never ingested on a schedule.

```sh
statmesh get comtrade:HS-A:X:IND --start 2024-01-01 --end 2024-12-31 --filter partner=USA --filter hs=AG2
statmesh get comtrade:HS-A:X:IND --start 2019-01-01 --end 2019-12-31 --filter partner=USA --filter hs=AG2
statmesh sql "
  WITH y AS (
    SELECT dims['hs'] AS hs, year(period_start) AS yr, sum(value) AS usd
    FROM observations
    WHERE series_id = 'comtrade:HS-A:X:IND' AND dims['partner'] = 'USA' AND dims['hs_level'] = '2'
    GROUP BY 1, 2)
  SELECT a.hs, a.usd AS usd_latest, b.usd AS usd_5y_earlier, a.usd - b.usd AS change
  FROM y a JOIN y b ON b.hs = a.hs AND a.yr = 2024 AND b.yr = 2019
  ORDER BY a.usd DESC"
```

Without `--filter partner=...` the partner defaults to `World`. Use the latest year Comtrade has and
five years before it in place of 2024 and 2019. Run on fixtures: yes (HS 85 first). The Comtrade
licence is `redistribute: no`; an export carries a warning in `SOURCES.md`.

### Q3. SEC EDGAR: fastest revenue growth in one SIC industry

Sources: SEC EDGAR XBRL frames (revenue by filer for a calendar year) and the filer list (name, SIC
code). Needs `STATMESH_CONTACT_EMAIL`; SEC wants it in the User-Agent.

```sh
statmesh ingest sec_edgar --dataset entities       # filer list with SIC; ~10k requests at 8/s
for p in CY2023 CY2024; do
  for c in RevenueFromContractWithCustomerExcludingAssessedTax Revenues SalesRevenueNet; do
    statmesh get sec_edgar:frames:$c --filter period=$p --format json > /dev/null
  done
done
statmesh sql "
  WITH f AS (
    SELECT dims['cik'] AS cik, dims['frame'] AS fr, max(value) AS rev
    FROM observations
    WHERE source_id = 'sec_edgar' AND dataset_id = 'frames'
      AND indicator_id IN ('RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet')
    GROUP BY 1, 2)
  SELECT e.name, e.industry_code, cur.rev AS rev_cy2024, prev.rev AS rev_cy2023,
         cur.rev / prev.rev - 1 AS growth
  FROM f cur JOIN f prev ON prev.cik = cur.cik AND cur.fr = 'CY2024' AND prev.fr = 'CY2023'
  JOIN entities e ON e.entity_id = 'cik:' || cur.cik
  WHERE e.industry_scheme = 'SIC' AND e.industry_code = '7372'
  ORDER BY growth DESC LIMIT 20"
```

Each `get` fetches one revenue tag for one calendar year, so the loop makes six calls; filers differ
in which tag they use. Run on fixtures: the SQL and the `get` with `--filter period=CY2024` (three
filers: Microsoft, Adobe, Oracle). Caveats: frames match facts to the calendar year, so an
off-calendar fiscal year is approximated; a filer that switched tags can appear twice or not at all
(`max(value)` collapses duplicates); `industry_code` is a string. The inferred CIK to LEI links in
`entity_xref` are not used here.

### Q4. CPI inflation vs policy rate, G20, last 10 years

Sources: IMF CPI (SDMX, `redistribute: review`) and BIS policy rates from the direct `bis`
connector (`redistribute: yes`; this replaced DBnomics as the policy-rate source, see
[decisions](#decisions-that-shape-the-source-list)).

```sh
statmesh ingest imf              # core dataset CPI (year-on-year % change and index)
statmesh ingest bis --dataset WS_CBPOL
statmesh sql "
  SELECT c.geo, year(c.period_start) AS yr, c.value AS cpi_yoy_pct, p.rate AS policy_rate_avg
  FROM observations c
  JOIN (SELECT geo, year(period_start) AS y, avg(value) AS rate FROM observations
        WHERE series_id LIKE 'bis:WS_CBPOL:VALUE:%' GROUP BY 1, 2) p
    ON p.geo = c.geo AND p.y = year(c.period_start)
  JOIN geo_groups g ON g.geo = c.geo AND g.group_id = 'G20'
  WHERE c.series_id LIKE 'imf:CPI:CPI._T.YOY_PCH_PA_PT:%' AND c.freq = 'A'
    AND c.period_start >= DATE '2016-01-01'
  ORDER BY c.geo, yr"
```

Run on fixtures: yes. The BIS fixtures were re-recorded to cover 2022-2023, so they overlap the IMF
CPI fixtures, and `tests/acceptance` Q4 passes. BIS reports the euro area as one aggregate (`region:EMU`), so DEU, FRA and ITA have no
policy-rate row.

## Query surfaces at a glance

| Surface | How |
|---|---|
| SQL | views `observations`, `observations_vintages`, `series`, `datasets`, `sources`, `entities`, `entity_xref`, `geos`, `geo_groups`; one SELECT, row, byte and time caps |
| REST | `GET /search`, `GET /series/{id}`, `GET /series/{id}/observations`, `POST /query`, `GET /sources`, `GET /healthz`; `POST /python` only when the sandbox is on; OpenAPI at `/docs` |
| MCP | `search_series`, `describe_series`, `get_observations`, `run_sql`, `list_sources` (+ `run_python` when on) over stdio (`statmesh mcp`) or HTTP (`/mcp`) |
| Python | `statmesh.sdk.Client` (pandas or polars frames) |
| CLI | `statmesh search / get / sql / sources / export` |

Connector filters (Comtrade `partner`, `hs`; SEC frames `period`) reach the connector on every
surface: REST repeats `filter=key=value`, MCP takes a `filters` object, the SDK takes `get(...,
filters={...})`, the CLI takes `--filter key=value`. Limits: search `limit` at most 100,
observations `limit` at most 10000, SQL results capped by rows, bytes and time. See
[docs/query-surfaces.md](docs/query-surfaces.md).

## Sources

All 26 folders under `src/statmesh/connectors/`. "Key" is the environment variable the connector
reads. "Redistribute" is the manifest's `licence.redistribute` (`yes`, `no`, `review`); in `hosted`
mode only `yes` is served, and a dataset or series can override the source (series, then dataset,
then source). Kinds: `sdmx`, `file`, `ckan`, `socrata` are config-only (YAML); `custom` has a
`connector.py`. "Fixtures" says whether the recorded test responses came from the real API (real) or
were written by hand from the documented shape (synthetic), because no key was available.

| Source (id) | What | Key | Licence | Redistribute | Kind | Fixtures |
|---|---|---|---|---|---|---|
| World Bank (`worldbank`) | ~16k development indicators, annual | none | CC BY 4.0 | yes | custom | real |
| Our World in Data (`owid`) | 22 curated health charts (WHO/UN based: deaths from alcohol, snakebite, road traffic, suicide, malaria, ...), annual | none | CC BY 4.0 (IHME-based charts: no) | yes | custom | real |
| IMF (`imf`) | CPI dataflow ingested, more catalogued | none | IMF Terms of Use, attribution | review | sdmx | real |
| OECD (`oecd`) | prices (CPI); 60 downloads/hour | none | OECD terms (CC BY 4.0 unless a dataset says otherwise) | review | sdmx | real |
| ILOSTAT (`ilostat`) | labour: unemployment, employment, wages | none | CC BY 4.0 | yes | sdmx | real |
| Eurostat (`eurostat`) | EU statistics; annual unemployment ingested | none | CC BY 4.0 | yes | sdmx | real |
| ECB (`ecb`) | HICP inflation (`ICP`), key interest rates (`FM`) | none | ESCB reuse policy | yes | sdmx | real |
| BIS (`bis`) | policy rates (`WS_CBPOL`), credit to the non-financial sector (`WS_TC`) | none | BIS terms of permitted use | yes | sdmx | real |
| UN SDG (`unsdg`) | SDG Global Database (`DF_SDG_GLH`) | none | UNdata terms of use | yes | sdmx | real |
| FAOSTAT (`faostat`) | crops and livestock (`QCL`), trade indicators (`TCLI`), food balances (`FBS`) bulk files | none | CC BY 4.0 | yes | file | real |
| UN Comtrade (`comtrade`) | goods trade by reporter, partner, HS; on demand only | `COMTRADE_API_KEY` (optional: keyless preview) | Comtrade terms | no | custom | real (keyless preview) |
| DBnomics (`dbnomics`) | long-tail macro series; nothing ingested by default | none | per provider | review | custom | real |
| MoSPI eSankhyiki (`mospi`) | India: PLFS, CPI, WPI, IIP, national accounts; three RBI tables (trade, balance of payments, FX) | none | MoSPI Copyright Policy (Category A) | yes (RBI datasets: review) | custom | real |
| data.gov.in (`datagovin`) | catalog of Indian open datasets; observations only for mapped resources | `DATAGOVIN_API_KEY` (required) | GODL-India | yes | custom | synthetic |
| FRED (`fred`) | US and international macro series | `FRED_API_KEY` (required) | per series (copyright tag), default review | review | custom | synthetic |
| BLS (`bls`) | US CPI (`CU`), labour force (`LN`) | `BLS_API_KEY` (optional: v1, 25 queries/day) | US government, cite BLS | yes | custom | v1 real, keyed v2 synthetic |
| SEC EDGAR (`sec_edgar`) | XBRL frames, company concepts, filers (`entities`) | none; `STATMESH_CONTACT_EMAIL` required | US government work | yes | custom | real |
| GLEIF (`gleif`) | LEI records, ISIN and BIC mappings | none | CC0 1.0 | yes | custom | REST real, bulk files partly synthetic |
| UK Companies House (`uk_companies_house`) | register: bulk `snapshot`, REST `company` | `COMPANIES_HOUSE_API_KEY` (optional; REST only) | OGL v3.0 | yes | custom | snapshot real, REST synthetic |
| EU ESEF (`esef`) | filings index (one entity per LEI) and IFRS facts from filings.xbrl.org | none | filings.xbrl.org terms (no restrictions stated) | yes | custom | real |
| US Census (`census`) | ACS 5-year, population estimates (vintages 2019, 2021) | `CENSUS_API_KEY` (required) | US government work | yes | custom | synthetic |
| BEA (`bea`) | NIPA, regional GDP | `BEA_API_KEY` (required) | US government work | yes | custom | synthetic |
| EIA (`eia`) | energy, API v2 | `EIA_API_KEY` (required) | US government work | yes | custom | synthetic |
| Data Commons (`datacommons`) | statistical variables, country and US state | `DATACOMMONS_API_KEY` (required) | CC BY 4.0 compilation; sources keep their own | review | custom | synthetic |
| WHO GHO (`who_gho`) | health indicators, country, yearly (legacy OData API) | none | WHO data policy | review | custom | real |
| CDC Data (`cdc_data`) | data.cdc.gov via Socrata; one dataset mapped | none | US government work | yes | socrata | real |
| Open Canada (`open_canada`) | CKAN portal catalog; one mapped dataset | none | OGL Canada | yes | ckan | real |

Socrata and CKAN datasets take the portal's own licence name; if it differs from the manifest's,
that dataset is downgraded to `review`. Any other SDMX endpoint is one more `manifest.yaml`; see
[docs/connectors.md](docs/connectors.md). Per-source licence handling:
[docs/licensing.md](docs/licensing.md).

### Decisions that shape the source list

From [docs/DECISIONS.md](docs/DECISIONS.md) (where it differs from the plan, it wins):

- Folder names `census`, `open_canada` and `cdc_data` replace the planned `datagov_us` and
  `nyc_opendata`. `census` matches `bea` and `eia`; the two planned portals were unreachable or
  broken, and the goal was two sample portals passing the contract suite, not those two.
- BIS is the Q4 policy-rate source. Its first-party terms are verified (cite BIS, no implied
  endorsement, no extra charge in a commercial product), so `bis` is `yes`. DBnomics stays `review`
  because its ODbL covers the database, not each provider's data.
- Census population estimates cover vintages 2019 and 2021 (`pep/population`). Vintage 2023 onward
  moved to `pep/charv` (age, sex and race cells), which is deferred; use ACS `B01003_001E` for
  recent years.
- OECD has no incremental refresh (`updatedAfter` returns 403 on their side): a weekly full
  refresh, with at most 5 core dataflows.
- MoSPI is `yes` for the NSO datasets and `review` for RBI tables. The reading of the Hindi
  copyright page was not independently checked.

## Known gaps

From the spec:

- Indian company financials: MCA data is not freely available in bulk; BSE/NSE disclosures need a
  terms check first.
- Market prices (stocks, intraday FX, commodities): no open source; out of scope.
- Full trade history at HS 6-digit: the free Comtrade tier is too small to mirror, so it is fetched
  per query.
- Survey microdata (for example PLFS unit-level records) and real-time data: out of scope.
- Not built: UK company accounts (iXBRL bulk), a hosted instance (design only in
  [docs/hosted.md](docs/hosted.md)), embeddings for search, S3 storage, a Postgres catalog.

In what is built:

- FAOSTAT: the full trade matrix (`TCL`) is skipped because of its size; the trade indicators file
  (`TCLI`) is used instead.
- ECB: the exchange-rate dataflow (`EXR`) is not included; only `ICP` and `FM`.
- WHO GHO: built on the legacy OData host. WHO announced a replacement "Data Hub" OData API that was
  not live when the connector was written; the connector will need a port when it is.
- Synthetic fixtures only until keys exist: Data Commons, BEA, EIA, FRED, data.gov.in, Census, the
  Companies House REST dataset and BLS's keyed (v2) path. No live smoke test has run for these.
- Keys that need an activation step before they work (BLS, Census): not tested. A bad Census key
  answers with an HTML page, not an error code.
- Census vintage 2021 population variable (`POP_2021`) is from the docs, not a live call.
- FRED licence mapping from copyright tags was written from memory and is unverified against live
  `/fred/series/tags`.
- Sandboxed Python is tested with a fake process, not against a real Docker daemon.
- The web chat page is tested with a stubbed LLM only; it has not been run against a live model.
- Search recall is measured on a fixture catalog, not on a fully ingested one.
- Inferred CIK/UK-number to LEI links use exact normalised names plus location; they are guesses
  with a `confidence` and `inferred = true`, not an official mapping.

## Documentation

- [docs/architecture.md](docs/architecture.md): layers and main flows
- [docs/connectors.md](docs/connectors.md): the connector SDK, manifest reference, mapping.yaml
- [docs/data-model.md](docs/data-model.md): tables, ids, harmonisation rules, storage layout
- [docs/query-surfaces.md](docs/query-surfaces.md): SQL, REST, MCP, Python, CLI
- [docs/licensing.md](docs/licensing.md): licences, hosted mode, citations, rate-limit etiquette
- [docs/self-hosting.md](docs/self-hosting.md): docker compose, the worker, the web UI
- [docs/sandbox.md](docs/sandbox.md): the opt-in Python sandbox and its risks
- [docs/hosted.md](docs/hosted.md): hosted-instance design (not built)
- [docs/DECISIONS.md](docs/DECISIONS.md): decisions that override the plan
- [CHANGELOG.md](CHANGELOG.md): what shipped in each version
- [docs/configuration.md](docs/configuration.md): every environment variable
- [CONTRIBUTING.md](CONTRIBUTING.md): dev setup, adding a connector, the checks a PR must pass

## Licence

Code: Apache-2.0 (`LICENSE`, `NOTICE`). The data stays under each source's own licence, recorded in
the connector manifest and returned with every result.
