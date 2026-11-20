# statmesh — build plan

Spec: the original spec. Repo: this repository. Date of plan: 2026-11-19.
All decisions below are final working defaults; nobody else needs to be asked.

---

## 1. Name

| Thing | Choice |
|---|---|
| Project / repo | `statmesh` (GitHub `pathakvikash/statmesh`) |
| CLI command | `statmesh` |
| Python package (PyPI + import) | `statmesh` |
| npm name (reserved for a later TS client) | `statmesh` |
| Env var prefix | `STATMESH_` |

Availability, checked live 2026-11-19 with curl:

| Registry | Check | Result |
|---|---|---|
| PyPI | `https://pypi.org/pypi/statmesh/json` | 404 → free (`stat-mesh` also 404) |
| npm | `https://registry.npmjs.org/statmesh` | 404 → free (`@statmesh/sdk` also 404) |
| GitHub user/org | `https://github.com/statmesh` | 404 → free |
| GitHub repos | `api.github.com/search/repositories?q=statmesh+in:name` | 0 repos |
| Domains | not checked (DNS blocked in sandbox) | unknown; not needed to build |

Runner-up names that were also free on all three: `statkosh`, `statlake`, `statgrid`. Rejected: `aankda`, `sankhya`, `datakosh`, `opentally` (GitHub name taken), `citable`, `sangam`, `kosh` (PyPI taken), `pubstat` (22 similar repos).

Nothing has been registered. Registering the PyPI/npm/GitHub names is an account action for Vikash.

---

## 2. Decisions

### 2.1 Spec open questions

| Question | Decision | Reason |
|---|---|---|
| Hosted instance | Self-host only. No hosted instance is built. Licence enforcement still ships in v1 behind `STATMESH_MODE=self_host\|hosted` (default `self_host`): in `hosted` mode the SQL views and REST/MCP only expose datasets with `redistribute: yes`, and on-demand fetch of `no`/`review` datasets returns 403. Per-user key pass-through is Phase 3 design only. | Keeps the rule testable now, costs ~50 lines, avoids running cost and legal risk. |
| Name | `statmesh` | Free on GitHub, PyPI, npm; says what it is. |
| Python core vs TS | Python for everything server-side (connectors, ingest, API, MCP, SDK, CLI). TypeScript only in `web/`. No TS port of the MCP server or core. The web UI's typed REST client lives at `web/src/lib/client.ts`; publishing it to npm as `statmesh` is deferred until someone asks. | DuckDB/pyarrow/SDMX tooling is Python; two MCP servers is double the work for no user. |
| MoSPI terms | Unknown. `redistribute: review`, `auth: none`, `key_required: false`, rate limit 1 req/s. Attribution "Source: MoSPI, Government of India". Endpoints taken from the public eSankhyiki MCP repo at build time, not from memory. | Conservative default; self-host is unaffected, hosted mode would not serve it. |
| data.gov.in limits | No published per-key limit found. Manifest default: 1 req/s, 1000/day (editable). Catalog-only discover; every resource is `remote`; nothing ingested on schedule. Honour 429 + Retry-After. | Thousands of datasets, none needed for acceptance tests. |
| FAOSTAT | Bulk ZIP files through the generic `file` connector (Phase 2). No use of the new developer-portal API. | Token rules unclear; bulk files need no token. |
| OECD budget | 60/h is enough. Core list is capped at 5 dataflows, refreshed weekly Mon 02:00 with `updatedAfter` (≈5–10 downloads/week). Everything else in OECD is on-demand with a 7-day cache. No reserve mechanism; when the hour budget is spent the API returns metadata + `retry_after`. | A reserve split is an abstraction nobody needs at 10 downloads/week. |
| Comtrade caching | Cache on self-host with a 30-day TTL (operator's own internal use). `redistribute: no`: never served in hosted mode; exports containing Comtrade rows put a redistribution warning in `SOURCES.md`. Legal review required before any hosted launch. | Fetch-per-query without cache burns the 500 calls/day key. |
| SDMX client | `sdmx1` (Apache-2.0, v2.28, maintained; `pandasdmx` is capped at Python <3.12) used **only to parse structure messages** (dataflows, DSDs, codelists) from bytes. Data is requested as SDMX-CSV and parsed with `pyarrow.csv`. All HTTP goes through our `HttpClient`, never through sdmx1's own session. Fallback, decided in the Phase 0 spike: if an endpoint has no SDMX-CSV, parse SDMX-ML data with `sdmx1.read_sdmx`. | Structure parsing is the hard part to hand-roll; CSV data is trivial and fast; rate limits stay in one place. |
| Embeddings | Keyword-only (SQLite FTS5 + synonyms + geo extraction) in v1. Add embeddings only if the 50-question eval's top-5 recall is below 0.80 after synonyms tuning; then `fastembed` + `bge-small-en-v1.5`, vectors as BLOBs in SQLite, brute-force cosine with numpy, behind the `statmesh[embeddings]` extra. | The eval decides, not a guess. |

### 2.2 Other decisions

| Area | Decision |
|---|---|
| Python | `>=3.12` (develop on 3.12). |
| Packaging | `uv`, one package, `src/` layout, `hatchling` build backend. All runtime and dev dependencies are declared by the scaffold package so later agents never edit `pyproject.toml`. |
| Runtime deps | `pydantic>=2`, `pyyaml`, `httpx`, `pyarrow`, `duckdb`, `fastapi`, `uvicorn`, `mcp>=2,<3`, `sdmx1`, `pycountry`, `croniter`, `openpyxl`. Extras: `sdk` = `pandas`, `polars`. |
| Dev deps | `pytest`, `pytest-socket`, `ruff`. No type checker in the gate. |
| Lint / format | `ruff check` + `ruff format` (line length 100). |
| Tests | `pytest`, offline by default: `addopts = -m "not live" --disable-socket --allow-unix-socket`. Live calls only in tests marked `@pytest.mark.live` (plus `@pytest.mark.enable_socket`), run with `uv run pytest -m live`. |
| CLI | stdlib `argparse`. The scaffold defines every subcommand as a thin dispatcher to a function in the owning module, so later packages never edit `cli.py`. |
| HTTP | `httpx` sync client. Retries, rate limit, cache, User-Agent in our `HttpClient` only. No `tenacity`. |
| Scheduler | In-process loop in the `worker` process using `croniter`. State in the catalog `jobs` table. No Airflow/APScheduler/Celery. |
| Rate limits across processes | Per-second bucket in memory; per-hour and per-day counters in the catalog table `rate_usage` so `api` and `worker` share a source's budget. |
| MCP | Official `mcp` Python SDK (pinned `>=2,<3`). Agents must read the installed SDK's docs for the current server class and transport API; do not code it from memory. stdio via `statmesh mcp`; streamable HTTP mounted in the FastAPI app at `/mcp`. Tools call the same `statmesh.service` functions as REST. |
| API | FastAPI, sync endpoints, pydantic response models (source of the OpenAPI schema). Tested in-process with `TestClient`; no port binding in tests. |
| SQL safety | In-memory DuckDB; views created by trusted setup code; then `allowed_directories` limited to `obs/`, `tables/`, `cache/obs/`, `enable_external_access=false`, `lock_configuration=true` (verify exact settings against the installed DuckDB 2.x). Before execution: exactly one statement, must be `SELECT`, AST from `json_serialize_sql` walked to reject any table function and any base table outside the allowlist. Timeout via `conn.interrupt()` on a timer, row cap via `fetchmany(cap+1)`. |
| Catalog grain | One catalog `series` row per `source:dataset:indicator` (the *series key*). A full `series_id` is `series_key:geo`. REST/MCP accept either form (3 parts = all geos). Keeps World Bank at ~16k rows instead of 3.5M. |
| Vintages | On each refresh the runner rewrites the dataset's live snapshot (existing rows anti-joined with new rows, unioned). For core datasets, rows whose value was superseded go to `vintage-*.parquet`. View `observations` = live; `observations_vintages` = live + superseded. Long tail keeps latest only. |
| Typed tables | `entities` and `entity_xref` only (needed for SEC/GLEIF). A `RawChunk` carries `table="observations"\|"entities"\|"entity_xref"`; `normalize` output is validated against that table's schema. |
| Country codes | `pycountry` for ISO 3166-1/-2 (numeric = M49 for countries). Regions, groups (G20, EU27) and per-source overrides are small CSVs in the repo. |
| Generic connector kinds | v1: `sdmx`, `file` (CSV/XLSX/ZIP URL + `mapping.yaml`). v1.1: `ckan`, `socrata`. `rest` and `custom` both mean "has a `connector.py`"; no declarative REST engine. |
| Deviation from the spec's contract | `discover(self, http, limit=None)` takes the `HttpClient` (the spec's signature had no way to do HTTP) and a `limit` used by contract tests and the fixture recorder. |
| Web UI | Next.js (App Router) + TypeScript + Tailwind, `npm`. No component library. Types generated from the OpenAPI schema with `openapi-typescript`. Pages: search, series detail (table, inline-SVG line chart, citations), SQL console, sources. |
| Chat | Runs in a Next.js route handler with the Vercel AI SDK: OpenAI-compatible provider (covers OpenAI and Ollama's `/v1`) + Anthropic provider, tools from the AI SDK's MCP client pointed at `/mcp`. The user's key lives in browser `localStorage` and is sent per request; never stored server-side. A client-side check highlights any number in the reply that does not appear in a tool result. |
| Deployment | One `Dockerfile` (Python) + `web/Dockerfile`; `docker-compose.yml` with `api`, `worker`, `web` (profile `web`) sharing `./data`. |
| Storage backends | Local disk only. S3-compatible storage and Postgres catalog are not built (spec says "can", hosted phase only). |
| Code licence | Apache-2.0, `LICENSE` + `NOTICE`. No AGPL code copied (DBnomics fetchers are off limits). |
| Required config | `STATMESH_CONTACT_EMAIL` is required to start `serve`/`worker` while `sec_edgar` is enabled; `STATMESH_DISABLE=sec_edgar,...` turns sources off. |

### 2.3 What Vikash must supply (free, but only he can register)

Offline tests do not need any of these. Without a key the agent hand-writes fixtures from the documented response shape, marks them `"synthetic": true`, and the live smoke test is skipped.

| Key | Env var | Needed by | Phase |
|---|---|---|---|
| FRED | `FRED_API_KEY` | `fred` (no keyless mode) | 1 |
| data.gov.in | `DATAGOVIN_API_KEY` | `datagovin` | 1 |
| UN Comtrade | `COMTRADE_API_KEY` | `comtrade` (preview mode works without) | 1 |
| BLS | `BLS_API_KEY` | `bls` (v1 keyless works without) | 1 |
| Contact email | `STATMESH_CONTACT_EMAIL` | `sec_edgar` User-Agent | 1 |
| Companies House | `COMPANIES_HOUSE_API_KEY` | `uk_companies_house` REST | 2 |
| US Census / BEA / EIA | `CENSUS_API_KEY`, `BEA_API_KEY`, `EIA_API_KEY` | wave 4 | 2 |
| Data Commons | `DATACOMMONS_API_KEY` | `datacommons` | 2 |

---

## 3. Phases and exit gates

### Phase 0 — SDMX spike (wave 0 + package 1A)

Scope: core scaffold, then the generic SDMX connector proven on IMF, OECD and ILOSTAT with config-only manifests.

Exit gate (all must hold):
1. `imf`, `oecd`, `ilostat` each consist of `manifest.yaml` + fixtures only; no per-source Python.
2. Each passes the contract suite offline, and the live smoke test once.
3. One dataflow per source normalises to the observation schema with ≥99% of geo codes mapped (rest flagged `unmapped:`).
4. Any per-source quirk is expressible as a manifest option. If it is not, change the `Connector`/`Manifest` contract **now**, update section 4 of this file, and only then start wave 2.

### Phase 1 — v1 (waves 1–3)

Scope: core engine, 14 connectors (`worldbank`, `imf`, `oecd`, `ilostat`, `eurostat`, `comtrade`, `dbnomics`, `mospi`, `datagovin`, `fred`, `bls`, `sec_edgar`, `gleif`, generic `sdmx`), REST, SQL, MCP, CLI, Python SDK, docker compose, docs, web UI browse pages.

Exit gate:
1. `uv run ruff check . && uv run ruff format --check . && uv run pytest -q` green, fully offline.
2. The four acceptance questions pass as offline end-to-end tests (`tests/acceptance/`) through the REST API and through MCP tools, each answer carrying `citations[]`.
3. Search eval: top-5 recall ≥ 0.80 on the 50-question set, tracked in CI.
4. Contract suite green for all 14 connectors; every dataset has licence metadata.
5. `docker compose up` serves `/search` and `/mcp` on a laptop; `statmesh ingest worldbank` works live.
6. Hosted-mode test: with `STATMESH_MODE=hosted`, Comtrade and copyrighted FRED rows are not returned by any surface.
7. `statmesh connector new demo --kind sdmx` produces a folder that passes `statmesh connector test demo` after recording.

Tag `v0.1.0`.

### Phase 2 — v1.1 (waves 4–5)

Scope: UK Companies House, EU ESEF, FAOSTAT, WHO GHO, RBI via MoSPI, ECB/BIS/UN SDG configs, US Census/BEA/EIA, Data Commons, CKAN/Socrata, India LGD state codes, sandboxed Python, chat UI.

Exit gate:
1. Phase 1 gate still green.
2. Each new connector passes the contract suite offline.
3. `ecb`, `bis`, `unsdg`, `faostat` are manifest-only.
4. Sandbox: off by default; when on, a test proves no network, the time limit kills a loop, and the data mount is read-only.
5. Chat answers acceptance Q1 using only MCP tools, and the UI flags an injected number that came from no tool result (Playwright or component test with a stubbed LLM).
6. State-level geo: an Indian state series normalises to `IN-XX` with its LGD code in the codelist.

Tag `v0.2.0`.

### Phase 3 — hosted instance (design only, wave 5)

Deliverable: `docs/hosted.md`. Covers: `hosted` mode serving rules, per-user key pass-through header and "never cache for other users" path, Postgres catalog and S3 storage swap points, auth/quota, abuse limits, cost estimate, and the legal-review checklist. Nothing is deployed.

Exit gate: Vikash decides to run a hosted instance **and** a data-licensing review of the policy is done. Until then Phase 3 stays a document.

### Deferred or blocked

| Item | Status | Reason |
|---|---|---|
| Hosted public instance | Deferred | Needs Vikash's go-ahead, running cost, legal review. |
| Per-user key pass-through | Deferred to Phase 3 | Only meaningful when hosted. |
| Live smoke tests and real fixtures for keyed sources | Blocked on keys in 2.3 | Account creation is Vikash's; synthetic fixtures until then. |
| MoSPI redistribution | `review` | Terms unknown; needs a read of MoSPI's terms or an email to NSO. |
| Comtrade caching terms, FRED third-party series | Legal review before hosted | Self-host unaffected. |
| WHO GHO | Conditional | Build against the OData API only if it is still live and documented at build time; otherwise record the finding in `connectors/who_gho/README.md` and skip. |
| RBI DBIE | Conditional | Only via MoSPI's RBI dataset. No Excel file connector unless that dataset is missing; then deferred. |
| EU ESEF | Conditional on spike | Source: `filings.xbrl.org` API. If its terms forbid reuse, ship catalog-only with `redistribute: review`. |
| UK company accounts (iXBRL bulk) | Deferred | Phase 2 covers the company register + identifiers only; accounts bulk is tens of GB. |
| FAOSTAT API | Deferred | Bulk files used instead. |
| Embeddings | Conditional | Only if eval recall < 0.80. |
| S3 storage, Postgres catalog | Deferred | Hosted phase only. |
| Declarative `rest` engine | Deferred | Add when two connectors would share it. |
| npm publish of TS client, PyPI publish | Deferred | Needs Vikash's accounts. |
| Indian company financials, market prices, HS-6 full history, microdata, real-time | Out of scope | Spec's known gaps. |

---

## 4. Core scaffold (wave 0, package W0) — lands first, alone

One Sonnet agent, then an Opus review. Everything in this section is the contract later agents code against. Later packages must not edit W0-owned files; if a change is needed they report it and the orchestrator makes it.

### 4.1 Repo layout

```
statmesh/
  pyproject.toml  uv.lock  README.md  LICENSE  NOTICE  .gitignore  .python-version
  src/statmesh/
    __init__.py                 # __version__
    cli.py                      # W0: argparse, all subcommands, thin dispatch
    settings.py                 # W0
    service.py                  # W0 writes signatures raising NotImplementedError; 2A implements
    core/
      models.py                 # W0: Manifest, Licence, DatasetMeta, SeriesMeta, FetchRequest, RawChunk
      api_models.py             # W0: pydantic response models (Citation, SeriesHit, ...)
      connector.py              # W0: Connector Protocol, load_connector, list_connectors
      http.py                   # W0: HttpClient, RateLimited, MissingKey
      schema.py                 # W0: OBS_SCHEMA, ENTITIES_SCHEMA, XREF_SCHEMA, validate_table
      catalog.py                # W0: DDL + Catalog class
      storage.py                # W0: paths, raw snapshots, parquet parts, manifest swap
      geo.py                    # W0: to_iso3, is_valid_geo, regions, groups
      periods.py                # W0: parse_period
      licence.py                # W0: can_serve
      generic/
        __init__.py             # W0
        sdmx.py                 # 1A
        file.py                 # 1E
        ckan.py  socrata.py     # 4D
    data/
      regions.csv  groups.csv   # W0 (region codes; G20, EU27 membership)
      synonyms.yaml             # 1D
      hs/                       # 2B
      geo/in_states.csv         # 4F
    testing/
      contract.py               # W0: ContractSuite
      fixtures.py               # W0: ReplayTransport, RecordingTransport, record()
    ingest/                     # 1B
    query/                      # 1C
    search/                     # 1D
    devtools/                   # 1E (connector new/test/record implementations, templates)
    api/                        # 2A
    mcp_server.py               # 2A
    sdk.py  export.py           # 2G
    sandbox/                    # 4G
    connectors/
      <id>/manifest.yaml [mapping.yaml] [connector.py] [geo_map.csv]
      <id>/tests/test_contract.py  test_smoke.py  fixtures/
  tests/
    core/                       # W0
    toy_connector/              # W0: tiny in-memory connector used to test the contract suite
    ingest/ query/ search/ api/ sdk/ acceptance/   # owned by the matching package
  evals/search_questions.yaml   # 1D creates (15), 3A completes (50)
  docker/  docker-compose.yml  .github/workflows/   # 3B
  docs/  CONTRIBUTING.md        # 3C
  web/                          # 3D, 4H
```

`pyproject.toml` essentials: `[project.scripts] statmesh = "statmesh.cli:main"`; pytest `testpaths = ["tests", "src/statmesh/connectors"]`, markers `live`; wheel excludes `**/tests/**`; `src/statmesh/connectors/**` and `src/statmesh/data/**` included as package data.

Extra connector folders outside the package: `STATMESH_CONNECTORS_DIR` (loaded by path with `importlib.util`).

### 4.2 Settings — `statmesh/settings.py`

```python
@dataclass(frozen=True)
class Settings:
    data_dir: Path  # STATMESH_DATA_DIR, default ./data
    mode: Literal["self_host", "hosted"]  # STATMESH_MODE, default self_host
    contact_email: str | None  # STATMESH_CONTACT_EMAIL
    disabled: frozenset[str]  # STATMESH_DISABLE, comma separated source ids
    connectors_dir: Path | None  # STATMESH_CONNECTORS_DIR
    sql_timeout_s: float = 20  # STATMESH_SQL_TIMEOUT_S
    sql_max_rows: int = 10_000  # STATMESH_SQL_MAX_ROWS
    fetch_timeout_s: float = 30  # STATMESH_FETCH_TIMEOUT_S
    fetch_max_rows: int = 200_000  # STATMESH_FETCH_MAX_ROWS
    fetch_max_wait_s: float = 5  # STATMESH_FETCH_MAX_WAIT_S (on-demand rate-limit wait)
    python_sandbox: bool = False  # STATMESH_PYTHON_SANDBOX

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> "Settings": ...
```

### 4.3 Models — `statmesh/core/models.py`

```python
Freq = Literal["A", "S", "Q", "M", "W", "D"]
Redistribute = Literal["yes", "no", "review"]
TableName = Literal["observations", "entities", "entity_xref"]


class Licence(BaseModel, frozen=True):
    name: str
    url: str
    redistribute: Redistribute
    attribution: str


class RateLimit(BaseModel, frozen=True):
    per_second: float | None = None
    per_hour: int | None = Field(
        None, validation_alias=AliasChoices("per_hour", "max_downloads_per_hour")
    )
    per_day: int | None = None


class Refresh(BaseModel, frozen=True):
    schedule: str | None = None  # 5-field cron, UTC
    incremental: str | None = None  # e.g. "updatedAfter"; meaning is connector-specific


class Manifest(BaseModel, frozen=True, extra="forbid"):
    id: str  # ^[a-z][a-z0-9_]*$ and equals the folder name
    name: str
    kind: Literal["sdmx", "file", "rest", "custom", "ckan", "socrata"]
    endpoint: str | None = None
    sdmx_version: Literal["2.1", "3.0"] | None = None
    auth: Literal["none", "free_key"] = "none"
    key_env: str | None = None  # required when auth == "free_key"
    key_required: bool = True  # False: works without the key at a lower limit
    licence: Licence  # mandatory
    rate_limit: RateLimit = RateLimit()
    refresh: Refresh = Refresh()
    core_datasets: list[str] = []  # dataset ids ingested on schedule
    datasets: dict[str, dict[str, Any]] = {}  # per-dataset options, validated by the connector
    options: dict[str, Any] = {}  # per-source options, validated by the connector
    cache_ttl_days: int = 7  # on-demand result TTL
    version: int = 1  # bump when normalize changes -> reprocess raw

    @classmethod
    def load(cls, path: Path) -> "Manifest": ...  # yaml.safe_load + validate


@dataclass(frozen=True)
class SeriesMeta:
    indicator_id: str
    title: str
    description: str = ""
    synonyms: tuple[str, ...] = ()
    unit: str | None = None
    freq: Freq | None = None
    geos: tuple[str, ...] = ()  # canonical geo codes covered, if known
    start: date | None = None
    end: date | None = None
    dims: Mapping[str, tuple[str, ...]] = field(default_factory=dict)  # dim -> allowed codes
    licence: Licence | None = None  # per-series override (FRED copyright)


@dataclass(frozen=True)
class DatasetMeta:
    source_id: str
    dataset_id: str
    title: str
    licence: Licence
    description: str = ""
    source_url: str | None = None
    freq: Freq | None = None
    last_updated: datetime | None = None
    series: tuple[SeriesMeta, ...] = ()  # empty is allowed: the dataset itself is indexed


@dataclass(frozen=True)
class FetchRequest:
    dataset_id: str
    indicator_ids: tuple[str, ...] = ()
    geos: tuple[str, ...] = ()  # canonical codes; the connector maps back to its own
    start: date | None = None
    end: date | None = None
    filters: Mapping[str, str] = field(default_factory=dict)  # extra dims, e.g. {"partner": "USA"}
    updated_after: datetime | None = None
    max_rows: int | None = None

    def cache_key(self) -> str: ...  # sha256 of canonical JSON, 16 hex chars


@dataclass(frozen=True)
class RawChunk:
    source_id: str
    dataset_id: str
    content: bytes
    media_type: str  # "application/json", "text/csv", ...
    url: str
    params: Mapping[str, str]  # key value already redacted
    retrieved_at: datetime  # tz-aware UTC
    table: TableName = "observations"
    meta: Mapping[str, Any] = field(default_factory=dict)

    @property
    def sha256(self) -> str: ...
```

ID rules: `series_key = f"{source_id}:{dataset_id}:{indicator_id}"`, `series_id = f"{series_key}:{geo}"`. `dataset_id` and `indicator_id` must not contain `:` (replace with `_`). Helpers in `models.py`: `make_series_id(source, dataset, indicator, geo) -> str`, `split_series_id(s) -> tuple[str, str, str, str | None]`.

### 4.4 Connector contract — `statmesh/core/connector.py`

```python
class Connector(Protocol):
    manifest: Manifest

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        """List datasets and series. Feeds the catalog. No observations."""

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        """Raw data for one dataset + filter. All HTTP through `http`."""

    def normalize(self, chunk: RawChunk) -> pa.Table:
        """Pure, no I/O. Returns a table matching TABLE_SCHEMAS[chunk.table]."""


def load_connector(source_id: str, settings: Settings) -> Connector: ...
def list_connectors(settings: Settings) -> list[str]: ...  # enabled ids, sorted
def connector_dir(source_id: str, settings: Settings) -> Path: ...
```

Loading rule: if `<dir>/connector.py` exists, import it and instantiate its class named `Connector` with `(manifest, dir)`. Otherwise by `kind`: `sdmx` → `statmesh.core.generic.sdmx.SdmxConnector`, `file` → `...file.FileConnector`, `ckan`/`socrata` likewise. `rest`/`custom` without `connector.py` is an error.

Rules enforced by review: no `requests`/`httpx`/`urllib`/`time.sleep` inside any connector; `normalize` does no I/O; code lives only inside the connector's folder.

### 4.5 HttpClient — `statmesh/core/http.py`

```python
class RateLimited(Exception):
    retry_after: float  # seconds


class MissingKey(Exception): ...


class HttpClient:
    def __init__(
        self,
        manifest: Manifest,
        settings: Settings,
        catalog: Catalog | None = None,
        *,
        transport: httpx.BaseTransport | None = None,
    ): ...

    key: str | None  # os.environ[manifest.key_env] or None; raises MissingKey on

    # first request if auth=free_key, key_required, and missing
    def get(
        self,
        url: str,
        *,
        params: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        cache_ttl_s: int | None = None,
    ) -> httpx.Response: ...
    def post(
        self,
        url: str,
        *,
        json: Any = None,
        data: Any = None,
        headers: Mapping[str, str] | None = None,
    ) -> httpx.Response: ...
    def download(
        self, url: str, dest: Path, *, params: Mapping[str, Any] | None = None
    ) -> Path: ...
    def with_budget(
        self, *, max_wait_s: float | None, deadline: float | None = None
    ) -> "HttpClient":
        """Shallow copy sharing the limiter; used for on-demand fetches."""


def get_http(
    source_id: str, settings: Settings, catalog: Catalog
) -> HttpClient: ...  # one per source per process
```

Behaviour: User-Agent `statmesh/<version> (+<contact_email>)`; timeout 30 s; 3 attempts on 429/5xx/transport errors with exponential backoff, honouring `Retry-After`; limiter = in-memory token bucket for `per_second`, catalog `rate_usage` counters for `per_hour`/`per_day` (in-memory when `catalog is None`). When the wait exceeds `max_wait_s` (or the deadline) raise `RateLimited`; with `max_wait_s=None` it sleeps. `cache_ttl_s` stores the response body under `data/cache/http/<source>/<sha>.gz`. Non-2xx after retries raises `httpx.HTTPStatusError`. Never rotates keys or IPs. The connector decides where the key goes (param or header) using `http.key`.

### 4.6 Table schemas — `statmesh/core/schema.py`

```python
OBS_SCHEMA = pa.schema(
    [
        pa.field("series_id", pa.string(), nullable=False),
        pa.field("source_id", pa.string(), nullable=False),
        pa.field("dataset_id", pa.string(), nullable=False),
        pa.field("indicator_id", pa.string(), nullable=False),
        pa.field(
            "geo", pa.string(), nullable=False
        ),  # ISO3 | region:<code> | IN-XX style ISO 3166-2 | unmapped:<src code>
        pa.field("period_start", pa.date32(), nullable=False),
        pa.field("period_end", pa.date32(), nullable=False),  # inclusive
        pa.field("freq", pa.string(), nullable=False),  # A S Q M W D
        pa.field("value", pa.float64()),  # null allowed when obs_status explains it
        pa.field("unit", pa.string()),  # as published
        pa.field("unit_mult", pa.int8()),  # power of ten, 6 = millions
        pa.field("dims", pa.map_(pa.string(), pa.string())),  # keys sorted ascending
        pa.field("obs_status", pa.string()),
        pa.field("retrieved_at", pa.timestamp("us", tz="UTC"), nullable=False),
        pa.field("vintage", pa.date32()),
    ]
)

ENTITIES_SCHEMA = pa.schema(
    [
        pa.field(
            "entity_id", pa.string(), nullable=False
        ),  # "lei:<LEI>" | "cik:<10 digits>" | "uk:<number>"
        pa.field("source_id", pa.string(), nullable=False),
        pa.field("name", pa.string(), nullable=False),
        pa.field("country", pa.string()),  # ISO3
        pa.field("industry_code", pa.string()),
        pa.field("industry_scheme", pa.string()),  # SIC | NACE | ISIC | NIC
        pa.field("address", pa.string()),
        pa.field("attrs", pa.map_(pa.string(), pa.string())),
        pa.field("retrieved_at", pa.timestamp("us", tz="UTC"), nullable=False),
    ]
)

XREF_SCHEMA = pa.schema(
    [
        pa.field(
            "from_id", pa.string(), nullable=False
        ),  # entity_id form, also "isin:<..>", "ticker:<..>", "bic:<..>"
        pa.field("to_id", pa.string(), nullable=False),
        pa.field("source_id", pa.string(), nullable=False),
        pa.field("confidence", pa.float32(), nullable=False),  # 1.0 for official mappings
        pa.field("inferred", pa.bool_(), nullable=False),
        pa.field("retrieved_at", pa.timestamp("us", tz="UTC"), nullable=False),
    ]
)

TABLE_SCHEMAS: dict[str, pa.Schema] = {
    "observations": OBS_SCHEMA,
    "entities": ENTITIES_SCHEMA,
    "entity_xref": XREF_SCHEMA,
}


def validate_table(
    table: pa.Table, name: str = "observations"
) -> None: ...  # exact schema, non-null fields, freq enum, sorted dims keys
def empty_table(name: str = "observations") -> pa.Table: ...
def obs_row_key_sql() -> (
    str
): ...  # "series_id, period_start, freq, CAST(dims AS VARCHAR)" — the dedupe key
```

Company facts (SEC) are observations with `dims.cik`; trade rows are observations with `dims.partner`, `dims.flow`, `dims.hs`.

### 4.7 Geo and periods

```python
# statmesh/core/geo.py
def to_geo(
    code: str,
    scheme: Literal["iso2", "iso3", "m49", "name"],
    overrides: Mapping[str, str] | None = None,
) -> str:
    """Returns ISO3, 'region:<code>', or 'unmapped:<code>'. `overrides` is the connector's geo_map.csv."""


def load_geo_map(connector_dir: Path) -> dict[str, str]: ...  # geo_map.csv: src_code,geo
def is_valid_geo(geo: str) -> bool: ...  # ISO3 | region:* in regions.csv | ISO 3166-2 | unmapped:*
def geo_name(geo: str) -> str: ...
def find_geos_in_text(
    text: str,
) -> tuple[list[str], str]: ...  # (geos found, text with country names removed)
def group_members(group: str) -> list[str]: ...  # "G20", "EU27"


# statmesh/core/periods.py
def parse_period(s: str, fiscal_start_month: int = 1) -> tuple[date, date, Freq]:
    """'2024' '2024-Q1' '2024-03' '2024-03-15' '2024-S1' '2024-W05' '2024-25' (fiscal) -> inclusive range + freq."""
```

`regions.csv`: `code,name` (e.g. `WLD,World`; `EU27,European Union (27)`; World Bank income groups). `groups.csv`: `group,geo`.

### 4.8 Catalog — `statmesh/core/catalog.py`

File `data/catalog.sqlite`, `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON`. DDL (kept in one `SCHEMA` string, `PRAGMA user_version = 1`):

```sql
CREATE TABLE sources (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, endpoint TEXT,
  auth TEXT NOT NULL, key_env TEXT, key_required INTEGER NOT NULL,
  licence_name TEXT NOT NULL, licence_url TEXT NOT NULL,
  redistribute TEXT NOT NULL CHECK (redistribute IN ('yes','no','review')),
  attribution TEXT NOT NULL, connector_version INTEGER NOT NULL,
  manifest_json TEXT NOT NULL, discovered_at TEXT
);
CREATE TABLE datasets (
  source_id TEXT NOT NULL REFERENCES sources(id), dataset_id TEXT NOT NULL,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', source_url TEXT, freq TEXT,
  licence_name TEXT, licence_url TEXT, redistribute TEXT, attribution TEXT,   -- NULL = inherit from source
  is_core INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'remote' CHECK (status IN ('ingested','remote','stale')),
  source_updated_at TEXT, last_ingested_at TEXT, last_error TEXT,
  PRIMARY KEY (source_id, dataset_id)
);
CREATE TABLE series (
  series_key TEXT PRIMARY KEY,                    -- source:dataset:indicator
  source_id TEXT NOT NULL, dataset_id TEXT NOT NULL, indicator_id TEXT NOT NULL,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', synonyms TEXT NOT NULL DEFAULT '',
  unit TEXT, freq TEXT, geos TEXT NOT NULL DEFAULT '',   -- space separated canonical codes, '' = unknown
  start_date TEXT, end_date TEXT, dims_json TEXT NOT NULL DEFAULT '{}',
  licence_name TEXT, licence_url TEXT, redistribute TEXT, attribution TEXT,   -- NULL = inherit from dataset
  FOREIGN KEY (source_id, dataset_id) REFERENCES datasets(source_id, dataset_id)
);
CREATE INDEX series_dataset ON series(source_id, dataset_id);
CREATE VIRTUAL TABLE series_fts USING fts5(
  series_key UNINDEXED, source_id UNINDEXED, title, description, synonyms,
  tokenize = 'porter unicode61'
);                                               -- standalone; rebuilt per source by upsert_discovery
CREATE TABLE codelists (
  source_id TEXT NOT NULL, codelist_id TEXT NOT NULL, code TEXT NOT NULL, label TEXT,
  mapped_code TEXT, mapped_scheme TEXT,           -- e.g. 'IND','iso3' | '85','hs2' | NULL = unmapped
  PRIMARY KEY (source_id, codelist_id, code)
);
CREATE TABLE lineage (
  id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('ingest','ondemand')),
  source_id TEXT NOT NULL, dataset_id TEXT NOT NULL, url TEXT NOT NULL, params_json TEXT NOT NULL,
  raw_path TEXT NOT NULL, raw_sha256 TEXT NOT NULL, retrieved_at TEXT NOT NULL,
  connector_version INTEGER NOT NULL, parts_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX lineage_dataset ON lineage(source_id, dataset_id, retrieved_at);
CREATE TABLE jobs (
  source_id TEXT NOT NULL, dataset_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'idle' CHECK (state IN ('idle','running','failed','stale')),
  attempts INTEGER NOT NULL DEFAULT 0, next_run_at TEXT, last_run_at TEXT,
  last_success_at TEXT, last_error TEXT,
  PRIMARY KEY (source_id, dataset_id)
);
CREATE TABLE cache_entries (
  key TEXT PRIMARY KEY,                           -- source:dataset:FetchRequest.cache_key()
  source_id TEXT NOT NULL, dataset_id TEXT NOT NULL, request_json TEXT NOT NULL,
  part_path TEXT NOT NULL, rows INTEGER NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE rate_usage (
  source_id TEXT NOT NULL, win TEXT NOT NULL CHECK (win IN ('hour','day')),
  window_start TEXT NOT NULL, count INTEGER NOT NULL,
  PRIMARY KEY (source_id, win, window_start)
);
```

All timestamps are ISO-8601 UTC strings.

```python
class Catalog:
    def __init__(self, path: Path, *, readonly: bool = False): ...
    def close(self) -> None: ...
    # writes (worker / CLI)
    def upsert_source(self, manifest: Manifest) -> None: ...
    def upsert_discovery(
        self, source_id: str, datasets: Iterable[DatasetMeta], core: Collection[str]
    ) -> int:
        ...
        # upserts datasets + series, rebuilds this source's series_fts rows, sets discovered_at; returns series count

    def upsert_codelist(
        self,
        source_id: str,
        codelist_id: str,
        rows: Iterable[tuple[str, str | None, str | None, str | None]],
    ) -> None: ...
    def set_dataset_status(
        self,
        source_id: str,
        dataset_id: str,
        status: str,
        *,
        error: str | None = None,
        ingested_at: datetime | None = None,
    ) -> None: ...
    def add_lineage(
        self,
        *,
        run_id: str,
        kind: str,
        chunk: RawChunk,
        raw_path: str,
        connector_version: int,
        parts: Sequence[str],
    ) -> int: ...
    def get_job(self, source_id: str, dataset_id: str) -> dict | None: ...
    def set_job(self, source_id: str, dataset_id: str, **fields: Any) -> None: ...
    def due_jobs(self, now: datetime) -> list[dict]: ...
    def put_cache(
        self,
        key: str,
        source_id: str,
        dataset_id: str,
        request_json: str,
        part_path: str,
        rows: int,
        expires_at: datetime,
    ) -> None: ...
    def get_cache(self, key: str, now: datetime) -> dict | None: ...  # None when missing or expired
    def expired_cache(self, now: datetime) -> list[dict]: ...
    def delete_cache(self, key: str) -> None: ...
    def rate_incr(
        self, source_id: str, win: str, window_start: str
    ) -> int: ...  # atomic increment, returns new count
    def rate_count(self, source_id: str, win: str, window_start: str) -> int: ...
    # reads (api)
    def get_source(self, source_id: str) -> dict | None: ...
    def list_sources(self) -> list[dict]: ...
    def get_dataset(self, source_id: str, dataset_id: str) -> dict | None: ...
    def get_series(self, series_key: str) -> dict | None: ...
    def licence_for(self, series_key: str) -> Licence: ...  # series -> dataset -> source fallback
    def latest_lineage(self, source_id: str, dataset_id: str) -> dict | None: ...
    def fts(
        self,
        match: str,
        *,
        source: str | None = None,
        freq: str | None = None,
        geo: str | None = None,
        limit: int = 10,
    ) -> list[dict]:
        ...
        # raw FTS5 MATCH with bm25(series_fts, 0, 0, 10, 2, 5) ordering; search package builds `match`

    def conn(self) -> sqlite3.Connection: ...
```

### 4.9 Storage — `statmesh/core/storage.py`

```
data/
  manifest.json                                  # the only thing readers trust
  catalog.sqlite
  raw/<source>/<dataset>/<YYYYMMDDTHHMMSSZ>-<sha12>.<ext>.gz
  obs/<source>/<dataset>/part-<run_id>-<n>.parquet       # live snapshot
  obs/<source>/<dataset>/vintage-<run_id>.parquet        # superseded rows (core datasets)
  tables/<table>/<source>/part-<run_id>-<n>.parquet      # entities, entity_xref
  cache/obs/<source>/<dataset>/<cache_key>.parquet       # on-demand results
  cache/http/<source>/<sha>.gz
```

`manifest.json`:

```json
{"version": 42,
 "obs":      {"worldbank/WDI": ["obs/worldbank/WDI/part-r1-0.parquet"]},
 "vintages": {"worldbank/WDI": ["obs/worldbank/WDI/vintage-r0.parquet"]},
 "tables":   {"entities": ["tables/entities/gleif/part-r3-0.parquet"]},
 "cache":    {"comtrade/HS-A": ["cache/obs/comtrade/HS-A/ab12cd34ef567890.parquet"]}}
```

```python
class Storage:
    def __init__(self, data_dir: Path): ...
    def save_raw(self, chunk: RawChunk) -> Path: ...  # gzip, returns path relative to data_dir
    def read_raw(self, rel_path: str) -> bytes: ...
    def write_parts(
        self,
        table: pa.Table,
        rel_dir: str,
        run_id: str,
        *,
        prefix: str = "part",
        max_rows: int = 1_000_000,
    ) -> list[str]:
        ...
        # writes to *.tmp then renames; zstd; returns relative paths

    def read_manifest(self) -> dict: ...  # {} shape with empty maps when missing
    def manifest_mtime_ns(self) -> int: ...
    @contextmanager
    def update_manifest(self) -> Iterator[dict]:
        ...
        # fcntl lock on data/manifest.lock; yields a mutable copy; on exit bumps version,
        # writes manifest.json.tmp, fsyncs, os.replace -> atomic swap

    def delete_unreferenced(self, rel_dir: str, keep: Collection[str]) -> None: ...  # after a swap
    def abs(self, rel_path: str) -> Path: ...
```

Readers (the query package) rebuild DuckDB views whenever `manifest_mtime_ns()` changes. Nothing outside `update_manifest` writes `manifest.json`.

### 4.10 Licence rule — `statmesh/core/licence.py`

```python
def can_serve(licence: Licence, mode: Literal["self_host", "hosted"]) -> bool:
    return mode == "self_host" or licence.redistribute == "yes"
```

### 4.11 API models and service signatures

`statmesh/core/api_models.py` (pydantic):

```python
class Citation(BaseModel):
    source_id: str
    source_name: str
    dataset_id: str
    series_id: str | None = None
    licence_name: str
    licence_url: str
    redistribute: Redistribute
    attribution: str
    source_url: str | None = None
    retrieved_at: datetime | None = None
    vintage: date | None = None


class SeriesHit(BaseModel):
    series_id: str
    title: str
    unit: str | None
    freq: str | None
    geo: str | None
    start: date | None
    end: date | None
    source_id: str
    dataset_id: str
    licence_name: str
    redistribute: Redistribute
    status: str
    score: float


class SearchResult(BaseModel):
    query: str
    hits: list[SeriesHit]


class SeriesDetail(SeriesHit):
    description: str
    dims: dict[str, list[str]]
    geos: list[str]
    source_url: str | None
    last_updated: datetime | None
    last_ingested_at: datetime | None
    citation: Citation


class ObservationsResult(BaseModel):
    series_id: str
    status: Literal["ok", "rate_limited", "not_found", "forbidden"]
    columns: list[str]
    rows: list[list[Any]]
    truncated: bool = False
    retry_after: float | None = None
    citations: list[Citation]


class SqlResult(BaseModel):
    sql: str
    columns: list[str]
    rows: list[list[Any]]
    truncated: bool
    citations: list[Citation]
    warning: str | None = None


class SourceStatus(BaseModel):
    id: str
    name: str
    kind: str
    auth: str
    key_configured: bool
    enabled: bool
    redistribute: Redistribute
    datasets: int
    series: int
    last_ingested_at: datetime | None
    stale_datasets: int
```

`statmesh/service.py` (W0 writes these raising `NotImplementedError`; package 2A implements; REST, MCP, CLI all call only these):

```python
def search_series(q: str, *, geo: str | None = None, freq: str | None = None, source: str | None = None, limit: int = 10) -> SearchResult
def describe_series(series_id: str) -> SeriesDetail            # KeyError when unknown
def get_observations(series_id: str, *, start: date | None = None, end: date | None = None, geo: str | None = None, limit: int | None = None) -> ObservationsResult
def run_sql(sql: str) -> SqlResult                             # ValueError for rejected SQL
def list_sources() -> list[SourceStatus]
```

REST (2A): `GET /search?q=&geo=&freq=&source=&limit=` → `SearchResult`; `GET /series/{id}` → `SeriesDetail`; `GET /series/{id}/observations?start=&end=&geo=&limit=` → `ObservationsResult` (HTTP 200 for `ok`, 404 `not_found`, 403 `forbidden`, 429 + `Retry-After` for `rate_limited`, body always the model); `POST /query {"sql": "..."}` → `SqlResult` (400 on rejected SQL); `GET /sources` → `list[SourceStatus]`; `GET /healthz`; `/mcp` streamable HTTP. `{id}` is a path parameter of type `path` (ids contain `:` and `/`).

SQL views (1C): `observations`, `observations_vintages`, `series`, `datasets`, `sources`, `entities`, `entity_xref`, `geos(geo, name, iso2, m49)`, `geo_groups(group_id, geo)`.

MCP tools (2A), names and inputs exactly as the spec: `search_series`, `describe_series`, `get_observations`, `run_sql`, `list_sources`.

### 4.12 CLI — `statmesh/cli.py`

W0 defines all of these; each is `importlib.import_module(target)` + call, printing "not built yet" if the module is missing.

| Command | Dispatches to | Built by |
|---|---|---|
| `statmesh serve [--host --port]` | `statmesh.api.app:serve` | 2A |
| `statmesh mcp` (stdio) | `statmesh.mcp_server:run_stdio` | 2A |
| `statmesh worker` | `statmesh.ingest.scheduler:run_forever` | 1B |
| `statmesh discover [<source>]` | `statmesh.ingest.runner:discover_cmd` | 1B |
| `statmesh ingest <source> [--dataset ID] [--reprocess]` | `statmesh.ingest.runner:ingest_cmd` | 1B |
| `statmesh search <query> [--geo --source]` | `statmesh.sdk:search_cmd` | 2G |
| `statmesh get <series_id> [--start --end --format csv\|json]` | `statmesh.sdk:get_cmd` | 2G |
| `statmesh sql <query>` | `statmesh.sdk:sql_cmd` | 2G |
| `statmesh export <series_id>... --out DIR [--format csv\|parquet]` | `statmesh.export:export_cmd` | 2G |
| `statmesh connector new <id> --kind sdmx\|file\|rest\|custom` | `statmesh.devtools.scaffold:new_cmd` | 1E |
| `statmesh connector record <id>` | `statmesh.devtools.record:record_cmd` | 1E |
| `statmesh connector test <id> [--live]` | `statmesh.devtools.test:test_cmd` | 1E |
| `statmesh sources` | `statmesh.sdk:sources_cmd` | 2G |

`search/get/sql/sources` talk to a running server at `STATMESH_URL` (default `http://localhost:8000`) through the SDK, or call `statmesh.service` in-process with `--local`.

### 4.13 Contract suite and fixtures — `statmesh/testing/`

Fixture layout inside a connector:

```
tests/
  test_contract.py
  test_smoke.py              # @pytest.mark.live
  fixtures/
    requests.yaml            # list of FetchRequest dicts to record and replay (>= 1)
    http/<sha16>.json        # {"method","url","params","status","headers","body":"<sha16>.body","synthetic":false}
    http/<sha16>.body        # raw bytes
```

```python
# statmesh/testing/fixtures.py
class ReplayTransport(
    httpx.BaseTransport
):  # looks up method + url + sorted params (key redacted); raises FixtureMissing, never hits the network
    def __init__(self, fixtures_dir: Path, secret: str | None = None): ...


class RecordingTransport(
    httpx.BaseTransport
):  # real request, then writes the fixture; redacts `secret` everywhere, drops Set-Cookie/Authorization
    def __init__(self, fixtures_dir: Path, secret: str | None = None): ...


def load_requests(fixtures_dir: Path) -> list[FetchRequest]: ...
def replay_http(
    source_id: str, settings: Settings
) -> HttpClient: ...  # HttpClient with ReplayTransport, no rate limit sleeps
def record(
    source_id: str, settings: Settings, discover_limit: int = 20
) -> None: ...  # runs discover(limit) + every request live


# statmesh/testing/contract.py
class ContractSuite:
    connector_id: str  # set by the subclass
    discover_limit: int = 20

    def test_manifest_valid(
        self,
    ): ...  # loads, id == folder, licence complete, key_env set when free_key
    def test_discover(self): ...  # >= 1 dataset; every dataset has a licence; ids contain no ':'
    def test_fetch_and_normalize(
        self,
    ): ...  # every request in requests.yaml: fetch -> >= 1 chunk; normalize -> validate_table; >= 1 row overall
    def test_normalize_is_pure(
        self,
    ): ...  # normalize under a socket guard with a fresh instance; same output twice
    def test_codes_mapped(
        self,
    ): ...  # every geo passes is_valid_geo; share of 'unmapped:' <= max_unmapped (default 0.05)
    def test_series_ids(
        self,
    ): ...  # series_id == source:dataset:indicator:geo; source_id == manifest.id
    def test_no_secrets_in_fixtures(
        self,
    ): ...  # the key env value and 'api_key=' with a real value never appear
```

Every connector's `tests/test_contract.py` is exactly:

```python
from statmesh.testing.contract import ContractSuite


class TestContract(ContractSuite):
    connector_id = "<id>"
```

`test_smoke.py` pattern: `@pytest.mark.live` + `@pytest.mark.enable_socket`; one small real fetch + normalize + `validate_table`; skip when a required key is missing.

### 4.14 W0 definition of done

- Files in 4.1 marked W0 exist with the signatures above; `tests/toy_connector/` (static in-memory connector with fixtures) passes `ContractSuite`.
- `tests/core/` covers: manifest validation (good + 5 bad cases), `parse_period` forms, `to_geo` schemes and overrides, `validate_table` failures, catalog upsert + FTS query, storage manifest swap (a reader thread never sees a missing part), HttpClient retry / Retry-After / `RateLimited` / per-day counter / key redaction (all with `httpx.MockTransport`), `can_serve`.
- `git init`, Apache-2.0 `LICENSE`, `uv sync`, then `uv run ruff check . && uv run ruff format --check . && uv run pytest -q` pass offline.
- `uv run statmesh --help` lists every command in 4.12.

---

## 5. Work packages

Rules for every package:
- Sonnet agent implements; an Opus agent reviews before the wave is merged. Agents within a wave run in the same checkout and touch only their owned paths.
- Do not edit W0 files, `pyproject.toml`, or another package's paths. If a core change is needed, stop and report it.
- Offline tests only in the default run. Recording fixtures is the one time a package calls the network; fixtures are committed; keys never are.
- Recheck each source's access details before building its connector (the spec's table is from Nov 2026 and endpoint paths below are hints to verify, not facts).
- Common done-check, run from the repo root: `uv run ruff check . && uv run ruff format --check . && uv run pytest -q <owned test paths>`; before merge the orchestrator runs the full `uv run pytest -q`.
- Final report of each agent: files created, tests run with pass counts, fixtures real or synthetic, anything it could not verify, any contract change it needs.

### Wave 0 (1 package)

| ID | Package | Owns | Depends | Done |
|---|---|---|---|---|
| W0 | Core scaffold | everything marked W0 in 4.1 | — | 4.14 |

### Wave 1 (6 packages, parallel) — contains the Phase 0 spike

| ID | Package | Owns | Depends | Definition of done |
|---|---|---|---|---|
| 1A | Generic SDMX connector + spike: `imf`, `oecd`, `ilostat`, `eurostat` | `src/statmesh/core/generic/sdmx.py`, `src/statmesh/connectors/{imf,oecd,ilostat,eurostat}/`, `tests/generic/test_sdmx.py` | W0 | Four manifest-only connectors pass `ContractSuite` with recorded fixtures. Manifest `options`/`datasets` keys documented in the module docstring: `geo_dim`, `indicator_dims`, `freq_dim`, `unit_dim`, `time_dim`, `value_col`, `data_format` (`csv`\|`xml`), `agency`, `key` template, `geo_scheme`, `structure_path` quirks. Discover lists dataflows and expands indicator codes for `core_datasets`. `updatedAfter` honoured when `refresh.incremental` is set. ILOSTAT manifest includes the unemployment-rate dataflow as core (Q1); IMF includes CPI (Q4). Smoke tests exist. Report states plainly whether the Phase 0 gate (section 3) passes and lists every quirk. `uv run pytest -q tests/generic src/statmesh/connectors/{imf,oecd,ilostat,eurostat}` |
| 1B | Ingest runner, on-demand fetch, scheduler, worker | `src/statmesh/ingest/` (`runner.py`, `ondemand.py`, `scheduler.py`), `tests/ingest/` | W0 | `discover(source)` fills the catalog. `ingest(source, dataset)`: fetch → `save_raw` → normalize → `validate_table` → merge with live snapshot (dedupe key 4.6) → `write_parts` → vintage file for core datasets → one `update_manifest` swap → lineage rows → job state. `--reprocess` rebuilds from raw snapshots with no HTTP. `fetch_on_demand(req, source) -> (part_path \| None, retry_after \| None)` under `with_budget`, `fetch_max_rows`, timeout; writes `cache/obs`, registers in manifest `cache` and `cache_entries`; expired cache swept. Scheduler: croniter over manifests' `refresh.schedule`, idempotent, backoff 1m/5m/30m then `stale` with error. Typed tables routed by `chunk.table`. Tests use the toy connector: happy path, crash mid-ingest leaves old data live, revision creates a vintage row, reprocess makes no HTTP call, rate-limited on-demand returns `retry_after`. `uv run pytest -q tests/ingest` |
| 1C | Query engine | `src/statmesh/query/` (`engine.py`, `sqlsafe.py`, `citations.py`), `tests/query/` | W0 | `QueryEngine(settings)`: builds the views of 4.11 from `manifest.json` + the catalog (attached read-only or copied into DuckDB), rebuilds on manifest mtime change, applies `can_serve` filtering in `hosted` mode, then locks the connection down. `execute(sql) -> (columns, rows, truncated)` with timeout and row cap. `sqlsafe.check(sql)` rejects: multiple statements, non-SELECT, any table function, any table outside the allowlist, `COPY/ATTACH/INSTALL/LOAD/PRAGMA/SET`. `observations(series_id, start, end, geo, limit)` helper. `citations_for(sql, columns, rows) -> list[Citation]`: from `series_id` / `source_id`+`dataset_id` result columns, plus series-id and source-id literals in the SQL that exist in the catalog; empty → warning text. Tests include ≥15 hostile SQL strings (`read_parquet('/etc/passwd')`, `read_csv`, `COPY`, `ATTACH`, stacked statements, `glob`, http URLs, infinite recursive CTE hitting the timeout), a cross-source join, hosted-mode filtering. `uv run pytest -q tests/query` |
| 1D | Search + eval harness | `src/statmesh/search/` (`search.py`, `eval.py`), `src/statmesh/data/synonyms.yaml`, `evals/search_questions.yaml` (first 15), `tests/search/` | W0 | `search(catalog, q, geo, freq, source, limit) -> list[SeriesHit-like dict]`: pulls country names out of the query with `find_geos_in_text`, expands synonyms (jobless→unemployment, inflation→CPI/consumer price, exports→trade, etc.; ≥60 entries), builds a safe FTS5 MATCH (quoted tokens, OR across synonyms, AND across concepts with a relaxed retry when 0 hits), filters by geo coverage, returns full `series_id` with the geo appended when one was detected. `eval.run(catalog, path) -> recall@5` and a pytest that asserts the threshold on a fixture catalog. FTS injection test (`"`, `*`, `NEAR`, `:`). `uv run pytest -q tests/search` |
| 1E | Generic file connector + connector dev tooling | `src/statmesh/core/generic/file.py`, `src/statmesh/devtools/` (`scaffold.py`, `record.py`, `test.py`, `templates/`), `tests/generic/test_file.py`, `tests/devtools/` | W0 | `FileConnector`: manifest `datasets.<id>.url` (CSV, XLSX, or ZIP containing either) + `mapping.yaml` (column → observation field, constants, `geo_scheme`, `period` column(s) and format, wide-to-long `melt`, `unit_mult`). Respects `robots.txt` for downloads. `connector new` writes a folder from templates for each kind that passes `test_manifest_valid` immediately; `connector record` wraps `testing.fixtures.record`; `connector test` runs the folder's pytest (adds `-m live` with `--live`). Tests: CSV, XLSX and ZIP fixtures through `ContractSuite` using a temp connector dir; `new` → `record` (mocked transport) → `test` round trip. `uv run pytest -q tests/generic/test_file.py tests/devtools` |
| 1F | World Bank connector (reference custom connector) | `src/statmesh/connectors/worldbank/` | W0 | `connector.py` for Indicators API v2 (`/v2/indicator`, `/v2/country/{codes}/indicator/{id}?format=json&per_page=1000&date=a:b`), paging, aggregates mapped to `region:` via `geo_map.csv`, `core_datasets: [WDI]` limited by `options.core_indicators` (~40 headline indicators incl. unemployment `SL.UEM.TOTL.ZS`, GDP, CPI, exports). Licence CC BY 4.0, `redistribute: yes`. Code is the model other connector agents copy: under ~200 lines, heavily plain. Contract suite + smoke test. `uv run pytest -q src/statmesh/connectors/worldbank` |

**Gate after wave 1 (Phase 0 exit):** orchestrator reads 1A's report. Contract changes, if any, are applied to W0 files and to section 4 here before wave 2 starts. Then one integration check: `statmesh discover worldbank && statmesh ingest worldbank` against fixtures, and a `QueryEngine` query over the result.

### Wave 2 (7 packages, parallel)

| ID | Package | Owns | Depends | Definition of done |
|---|---|---|---|---|
| 2A | Service layer + REST API + MCP server | `src/statmesh/service.py` (implementation), `src/statmesh/api/` (`app.py`, `routes.py`), `src/statmesh/mcp_server.py`, `tests/api/` | 1B, 1C, 1D | The five service functions of 4.11 implemented over catalog/search/query/on-demand; `get_observations` triggers on-demand fetch for `remote` datasets and maps `RateLimited` to `status="rate_limited"`; hosted mode returns `forbidden` for non-`yes` licences. FastAPI app factory `create_app(settings)`, startup check for `STATMESH_CONTACT_EMAIL`. MCP tools with descriptions that tell agents to select `series_id` in SQL and never to state numbers without a tool result; stdio + streamable HTTP at `/mcp`. Tests via `TestClient` and the MCP SDK's in-memory client on a fixture data dir built with the toy connector: each route, each tool, error codes, citations present on every data response, hosted-mode filtering. `uv run pytest -q tests/api` |
| 2B | UN Comtrade + HS data | `src/statmesh/connectors/comtrade/`, `src/statmesh/data/hs/` (`hs2.csv` chapters; concordance files) | 1F as pattern | Custom REST; keyed endpoint when `COMTRADE_API_KEY` is set, public preview otherwise (`key_required: false`, 1 req/s, 500 rows). Everything `remote`, `cache_ttl_days: 30`, `redistribute: no`. Rows: `geo` = reporter, `dims` = `{flow, hs, hs_level, partner}`, value in USD. `geo_map.csv` covers Comtrade's non-ISO numerics (India 699, USA 842, France 251, Switzerland 757, Norway 579, …). Fixtures cover Q2: India → USA, HS chapters (AG2), latest year and five years earlier. HS codes validated against `hs2.csv` in the connector's own test. Contract + smoke. `uv run pytest -q src/statmesh/connectors/comtrade` |
| 2C | DBnomics + FRED + BLS | `src/statmesh/connectors/{dbnomics,fred,bls}/` | 1F as pattern | **dbnomics**: API v22, provider/dataset/series mapped to `dataset_id = <provider>_<dataset>`; per-provider licence note; fixtures include BIS policy rates (`BIS/WS_CBPOL`) for G20 (Q4); only API calls, no fetcher code copied. **fred**: key required; series tags read to set per-series licence (`copyrighted: pre-approval required` → `redistribute: no`; `citation required` → `review`; public domain → `yes`); units and frequency from series metadata. **bls**: v2 with key, v1 without (`key_required: false`), 50 series / 20 years per call chunking, CPI + unemployment core series. Contract + smoke each. `uv run pytest -q src/statmesh/connectors/{dbnomics,fred,bls}` |
| 2D | MoSPI + data.gov.in | `src/statmesh/connectors/{mospi,datagovin}/` | 1F as pattern | **mospi**: endpoints and parameters taken from the public eSankhyiki MCP repo and live responses; datasets PLFS, CPI, WPI, IIP, NAS, ASI; fiscal years via `parse_period(..., fiscal_start_month=4)`; PLFS quarterly and annual rounds as distinct `freq`; all-India rows `geo=IND`, state rows `unmapped:` until 4F; `redistribute: review`. **datagovin**: catalog-heavy discover (paged, `limit` honoured), all `remote`; fetch a resource by id; normalize only resources that have a `datasets.<id>` mapping, others yield zero rows and a clear error; GODL-India, `redistribute: yes`. Contract + smoke each. Report must state what the MoSPI terms page actually says. `uv run pytest -q src/statmesh/connectors/{mospi,datagovin}` |
| 2E | SEC EDGAR | `src/statmesh/connectors/sec_edgar/` | 1F as pattern | Datasets: `frames` (one concept across filers per period → observations, `geo=USA`, `dims={cik, form?, fy?}`), `companyconcept` (one company, one concept), `entities` (CIK, name, SIC, ticker, state → `entities` + `entity_xref` cik↔ticker, `confidence 1.0`). User-Agent with contact email enforced; 10 req/s. Revenue concept fallback list (`Revenues`, `RevenueFromContractWithCustomerExcludingAssessedTax`, `SalesRevenueNet`). Fiscal periods as explicit `period_start`/`period_end` from the fact, never assumed calendar. Fixtures cover Q3 for one SIC code, two consecutive fiscal years. Bulk files optional; if used, stream and mark the size ceiling in a `ponytail:` comment. Contract + smoke. `uv run pytest -q src/statmesh/connectors/sec_edgar` |
| 2F | GLEIF + entity matching | `src/statmesh/connectors/gleif/`, `src/statmesh/ingest/xref.py`, `tests/ingest/test_xref.py` | 1F as pattern | **gleif**: REST lookups (by LEI, by name) on demand → `entities`; ISIN and BIC mapping files → `entity_xref` (`confidence 1.0`, `inferred false`); full golden-copy ingest is opt-in (`statmesh ingest gleif --dataset golden-copy`), streamed. CC0, `redistribute: yes`. **xref.py**: `match_cik_to_lei(entities: pa.Table) -> pa.Table` (XREF_SCHEMA) using normalised legal name + country/state/postcode; exact-normalised match → 0.9, name-only → 0.6, all `inferred true`; pure function, no I/O. Tests: 20 hand-made pairs incl. near-misses (Inc/Corp/Ltd suffixes, punctuation, same name different state). Contract + smoke. `uv run pytest -q src/statmesh/connectors/gleif tests/ingest/test_xref.py` |
| 2G | Python SDK, CLI client commands, export | `src/statmesh/sdk.py`, `src/statmesh/export.py`, `tests/sdk/` | REST shapes in 4.11 only | `Client(base_url="http://localhost:8000")` with `search(q, **filters) -> DataFrame`, `get(series_id, start=None, end=None, geo=None) -> DataFrame` (citations on `df.attrs["citations"]`), `sql(query) -> DataFrame`, `sources()`, `describe(series_id)`; `frame="pandas"\|"polars"`, imports lazily and errors clearly when the extra is missing. CLI functions `search_cmd`, `get_cmd`, `sql_cmd`, `sources_cmd` (+ `--local`). `export_cmd` writes CSV or Parquet plus `SOURCES.md` listing every citation (source, dataset, licence, URL, attribution, retrieved_at) and a redistribution warning for `no`/`review`. Tests with `httpx.MockTransport` returning the 4.11 models. `uv run pytest -q tests/sdk` |

### Wave 3 (4 packages, parallel) — v1 gate

| ID | Package | Owns | Depends | Definition of done |
|---|---|---|---|---|
| 3A | Acceptance tests + search eval to 50 | `tests/acceptance/` (incl. a fixture data dir builder), `evals/search_questions.yaml`, `src/statmesh/data/synonyms.yaml` (tuning) | all of wave 2 | A session fixture ingests the recorded fixtures of ilostat, worldbank, comtrade, sec_edgar, gleif, imf, dbnomics into a temp data dir (through the real runner with `ReplayTransport`). Four tests, each run through REST and through MCP tools: Q1 unemployment IND/BGD/VNM 2015→latest; Q2 India→US exports by HS chapter, latest vs 5 years earlier; Q3 fastest revenue growth in one SIC industry, last fiscal year; Q4 CPI inflation vs policy rate for G20 (`geo_groups`), 10 years. Each asserts row shape, non-empty `citations[]` naming the expected sources, and units. Eval set at 50 questions with expected series keys; recall@5 ≥ 0.80 asserted. Missing fixtures are requested from the owning connector folder by report, not edited. `uv run pytest -q tests/acceptance tests/search` |
| 3B | Docker, compose, CI | `docker/Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.env.example`, `.github/workflows/{ci.yml,smoke.yml}` | 2A | Python image runs `statmesh serve` and `statmesh worker`; compose services `api` (8000), `worker`, `web` (profile `web`, 3000) sharing `./data`. `ci.yml`: uv sync, ruff, pytest offline, search eval. `smoke.yml`: nightly `pytest -m live`, opens or updates one GitHub issue per failing source, never blocks PRs. `.env.example` lists every env var from 2.3 and 4.2. Done: `docker compose config` valid; `docker build` succeeds if Docker is available (else reported as not run); workflows pass `actionlint` if available. |
| 3C | Docs | `README.md`, `CONTRIBUTING.md`, `NOTICE`, `docs/` (`quickstart.md`, `connectors.md`, `data-model.md`, `licensing.md`, `mcp.md`, `sources.md`) | 2A, 1E | README: what it is, 5-minute quickstart, the four questions as copy-paste commands. `connectors.md`: the three levels (config, config + mapping, code), manifest reference, contract rules, recording fixtures. `licensing.md`: per-source table generated from the manifests by a small script in `docs/` and checked by a test (`tests/docs/test_sources_table.py`, also owned here). No claim in docs that is not true of the code; every command shown is run once. |
| 3D | Web UI: browse | `web/` (all except `web/src/app/chat/` and `web/src/lib/chat/`) | 2A | Next.js + TS + Tailwind. Pages: `/` search with geo/source/freq filters; `/series/[...id]` metadata, observations table, inline-SVG line chart, citation block rendered from `citations[]`; `/sql` console showing SQL, rows, citations, warning; `/sources` freshness and key status. `web/src/lib/client.ts` typed from OpenAPI (`openapi-typescript`, schema committed at `web/openapi.json`). `web/Dockerfile`. Every number shown has unit, period and source beside it. Done: `npm run lint && npm run build && npm test` (Vitest component tests with mocked fetch for the four pages). |

**v1 gate:** section 3, Phase 1. Orchestrator runs the full suite, the hosted-mode check, and one live `statmesh ingest worldbank`. Tag `v0.1.0`.

### Wave 4 (8 packages, parallel) — v1.1

| ID | Package | Owns | Depends | Definition of done |
|---|---|---|---|---|
| 4A | SDMX configs + FAOSTAT | `src/statmesh/connectors/{ecb,bis,unsdg,faostat}/` | 1A, 1E | `ecb`, `bis`, `unsdg`: manifest + fixtures only, on the generic SDMX connector. `faostat`: `kind: file` on bulk ZIPs with `mapping.yaml`, FAO M49 area codes mapped, 3 core domains (production, trade, food balances). Contract + smoke each. If a manifest option is missing in `sdmx.py`/`file.py`, report it; do not patch those files. `uv run pytest -q src/statmesh/connectors/{ecb,bis,unsdg,faostat}` |
| 4B | US Census + BEA + EIA | `src/statmesh/connectors/{us_census,bea,eia}/` | 1F as pattern | Custom REST, free keys (`key_required: true`), US federal data `redistribute: yes`. Census: ACS 5-year + population estimates, state-level geo as ISO 3166-2 `US-XX`. BEA: NIPA + regional GDP. EIA: v2 API, energy series by state/country. Contract + smoke each; synthetic fixtures allowed if keys are absent, and say so. `uv run pytest -q src/statmesh/connectors/{us_census,bea,eia}` |
| 4C | UK Companies House + EU ESEF | `src/statmesh/connectors/{uk_companies_house,esef}/` | 2E, 2F | **uk_companies_house**: free bulk company snapshot (no key) → `entities` (`uk:<number>`, SIC 2007 as `industry_code`); REST with key for on-demand company lookup; 600 req / 5 min expressed as `per_second: 2`. Accounts data out of scope. **esef**: spike first, source `filings.xbrl.org`; filings index → `entities` (LEI) and reported facts (IFRS `Revenue`, `ProfitLoss`, `Assets`) → observations with `dims.lei`; record the terms found and set `redistribute` accordingly; if reuse is not allowed, catalog-only. Contract + smoke each. `uv run pytest -q src/statmesh/connectors/{uk_companies_house,esef}` |
| 4D | CKAN + Socrata generic connectors | `src/statmesh/core/generic/{ckan,socrata}.py`, `src/statmesh/connectors/{datagov_us,nyc_opendata}/` (sample manifests), `tests/generic/{test_ckan,test_socrata}.py` | 1E | Config-only kinds. Discover pages through the portal catalog (`package_search` / Socrata discovery API). Datasets are catalogued as `remote`; observations only for datasets with a `datasets.<id>` mapping (same mapping keys as `file.py`, imported from it, not copied). Two sample portals pass the contract suite with one mapped dataset each. `uv run pytest -q tests/generic/test_ckan.py tests/generic/test_socrata.py src/statmesh/connectors/{datagov_us,nyc_opendata}` |
| 4E | Data Commons + WHO GHO | `src/statmesh/connectors/{datacommons,who_gho}/` | 1F as pattern | **datacommons**: REST v2 with key, statistical variables as indicators, place DCIDs mapped to ISO3 (`country/IND`) and ISO 3166-2; all `remote`; per-variable provenance carried into `dims.provenance` and the citation `source_url`. **who_gho**: first check whether the GHO OData API (or its documented replacement) is live; if yes, connector with indicators as series; if no, write `README.md` in the folder with what was found and stop. Contract + smoke for whatever ships. `uv run pytest -q src/statmesh/connectors/{datacommons,who_gho}` |
| 4F | India deep-dive: LGD state codes + RBI via MoSPI | `src/statmesh/data/geo/in_states.csv`, `src/statmesh/connectors/mospi/` (now owned here), `tests/core/test_geo_india.py`. Needs one orchestrator-applied change in `core/geo.py`: `to_geo(..., scheme="lgd_state")` | 2D | `in_states.csv`: LGD state code, state name, aliases, ISO 3166-2 code for all states and UTs, taken from the LGD directory download (source and date in a header comment). MoSPI state-level rows normalise to `IN-XX`; LGD codes stored in `codelists`. RBI: add MoSPI's RBI dataset to the `mospi` manifest if the API exposes it; if not, report "deferred, no API" and add nothing. Contract suite still green. `uv run pytest -q tests/core/test_geo_india.py src/statmesh/connectors/mospi` |
| 4G | Sandboxed Python | `src/statmesh/sandbox/` (`runner.py`), `docker/sandbox.Dockerfile`, `tests/sandbox/`; sole wave-4 editor of `service.py`, `api/routes.py`, `mcp_server.py` (adds `run_python`) | 2A | Off unless `STATMESH_PYTHON_SANDBOX=1`. `run_python(code) -> {stdout, stderr, images[], timed_out}` runs `docker run --rm --network none --cpus 1 --memory 512m --pids-limit 128 --read-only --tmpfs /tmp -v <data>/obs:/data/obs:ro` on an image with pandas, pyarrow, duckdb, matplotlib; 30 s wall clock kill; output capped at 1 MB; in `hosted` mode disabled outright. REST `POST /python`, MCP tool `run_python` registered only when enabled. Docs note the Docker socket trade-off. Tests: command line built correctly (unit, no Docker); when Docker is available (`@pytest.mark.docker`, opt-in) no network, timeout kills `while True`, write to `/data` fails. `uv run pytest -q tests/sandbox tests/api` |
| 4H | Web chat | `web/src/app/chat/`, `web/src/app/api/chat/`, `web/src/lib/chat/` | 3D, 2A | Settings panel: provider (OpenAI-compatible with base URL, Anthropic, Ollama preset), model, key in `localStorage`. Route handler runs the tool loop with the AI SDK and its MCP client against `/mcp`; system prompt forbids numbers from memory and requires saying "no matching data" when search is empty. UI shows each tool call, the series ids and SQL used, and citations rendered from tool results, not model text. `flagUnsourcedNumbers(replyText, toolResults)` highlights numbers absent from tool results (tolerant to rounding and thousands separators; ignores years that appear in tool results and list numbering). Tests: unit tests for the flagging function (≥12 cases); a component test with a stubbed model stream and stubbed MCP proving Q1 renders with citations and an injected fake number is flagged. `npm run lint && npm run build && npm test` |

### Wave 5 (3 packages, parallel) — close-out

| ID | Package | Owns | Depends | Definition of done |
|---|---|---|---|---|
| 5A | Hosted design doc (Phase 3) | `docs/hosted.md` | all | Content listed under Phase 3 in section 3. Opus writes this one. No code. |
| 5B | Embeddings (only if recall@5 < 0.80 after 3A) | `src/statmesh/search/embed.py`, `tests/search/test_embed.py` | 1D, 3A | `statmesh[embeddings]` extra (orchestrator adds it to `pyproject.toml`); vectors in a `series_vec(series_key, vec BLOB)` table created by this module; hybrid score = FTS rank fused with cosine; eval shows recall improvement, else the package is dropped. Skipped entirely if the gate was met. |
| 5C | v1.1 docs + release notes | `docs/` updates, `CHANGELOG.md`, `README.md` sources table | wave 4 | Sources table regenerated; sandbox and chat documented; known gaps and deferred items from section 3 listed; every command re-run. |

**v1.1 gate:** section 3, Phase 2. Tag `v0.2.0`.

---

## 6. Risks the orchestrator should watch

1. **Phase 0 gate is real.** If IMF's new portal or ILOSTAT needs per-source code, change the contract before wave 2, not after.
2. **Endpoint hints may be stale.** Every connector agent verifies live once while recording; agents must not invent endpoints when the network or a key is unavailable; they mark fixtures synthetic and say so.
3. **DuckDB lock-down.** `allowed_directories` + `enable_external_access=false` must be proven by the hostile-SQL tests against the installed DuckDB 2.x; the AST allowlist is the second layer, not the only one.
4. **`mcp` SDK v2 API.** Class and transport names changed across major versions; 2A reads the installed package.
5. **Shared-file pressure.** `service.py`, `api/routes.py`, `mcp_server.py`, `core/geo.py`, `pyproject.toml` are the only files more than one wave wants; each has exactly one owner per wave (stated above) or is changed by the orchestrator.
6. **Citations for arbitrary SQL** are best-effort (result columns + literals). The MCP tool description and the UI warning carry the rest. Full lineage tracking through aggregates is not built.
7. **Catalog grain** (series key without geo) is a deliberate departure from a per-geo catalog; `geos` coverage may be empty for sources that do not publish it, in which case a geo filter does not exclude the series.
