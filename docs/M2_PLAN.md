# M2 "It's public": implementation plan

Opus plan, 19 Nov 2026. The order is W0, then A, B, C, D and E in parallel, then Z. Each package
owns only the files listed for it.

## W0: shared config plumbing (S), runs first

**Owns:** `src/statmesh/settings.py`, `src/statmesh/cli.py` and `docs/configuration.md`. It also
gets first turn on `query/engine.py`, `service.py` and `api/app.py`. After W0, A inherits `app.py`,
and E inherits `engine.py` and `service.py`.

**New settings** (name, env var, default):

| Setting | Env var | Default |
|---|---|---|
| `duckdb_memory_limit` | `STATMESH_DUCKDB_MEMORY` | `2GB` |
| `ondemand` | `STATMESH_ONDEMAND` | true; false when hosted |
| `cors_origins` | `STATMESH_CORS_ORIGINS` | comma-separated, empty |
| `cache_max_age_s` | `STATMESH_CACHE_MAX_AGE` | 0; 300 when hosted |
| `shares_enabled` | `STATMESH_SHARES` | true |
| `share_max_bytes` | `STATMESH_SHARE_MAX_BYTES` | 512000; 262144 when hosted |
| `share_ttl_days` | `STATMESH_SHARE_TTL_DAYS` | 0 (forever); 90 when hosted |
| `export_max_rows` | `STATMESH_EXPORT_MAX_ROWS` | 5_000_000 |

**Code changes:**
- `engine.py`: read the memory limit from settings. It is currently hardcoded `'2GB'` at line
  ~249.
- `service.py`: when `ondemand` is off, skip `fetch_on_demand`, and drop search hits from datasets
  that are `remote` and were never ingested.
- `cli.py`: add `mirror` (`statmesh.ingest.mirror:mirror_cmd`, `--dry-run`), `bench`
  (`statmesh.bench:bench_cmd`) and `doctor` (`statmesh.doctor:doctor_cmd`; `--json`,
  `--source`, `--offline`).
- Create stubs `api/shares.py` and `api/export_csv.py`, each with `router = APIRouter()`, and
  include both in `app.py`.

**Done when:** pytest is green and `statmesh doctor` prints "not built yet".

## A: hosted mirror (L)

**Owns:**
- `Dockerfile`, `.dockerignore`, and `deploy/hosted/**` (`compose.yml`, `nginx.conf`,
  `env.hosted.example`)
- `api/app.py` (after W0), `ingest/mirror.py`, `ingest/scheduler.py`
- `web/src/lib/mode.ts`, `web/src/app/robots.ts`, `web/src/app/sitemap.ts`, `web/src/app/sql/**`
- `docs/hosted.md`, `docs/hosted-runbook.md`
- `tests/api/test_hosted_http.py`, `tests/ingest/test_mirror.py`

**Containers:**
- Pin the uv and Python image tags.
- Compose: `read_only`, tmpfs `/tmp`, `cap_drop: ALL`, `no-new-privileges`, `mem_limit`,
  `pids_limit`.
- The API is not published; only nginx can reach it.

**nginx limits** (return 429; the access log records no headers):

| Path | Rate | Other limits |
|---|---|---|
| `/query`, `/mcp` | 30 requests/min, burst 10 | 2 concurrent connections, 64 KB body |
| `POST /shares` | 1 request/min, burst 10 | 256 KB body |
| everything else | 120 requests/min | |

**API (`app.py`):**
- `CORSMiddleware` from `cors_origins`: GET and POST only, no credentials.
- A Cache-Control middleware:
  - GET with status 200: `public, max-age=N, stale-while-revalidate=3600`
  - POST and errors: `no-store`

**`statmesh mirror [--dry-run]`:** ingests the core datasets whose effective licence is `yes`
(the dataset licence wins over the source licence). In hosted mode the scheduler skips any dataset
that is not `yes`.

**Web, hosted mode:** `/sql/ask` returns 404 and the SQL ask button is hidden. `robots.ts`
disallows `/api/`, `/chat/api` and `/a/`. `sitemap.ts` lists the static pages plus up to 100
series per source.

**Runbook:** deploy, TLS, `STATMESH_ALLOWED_HOSTS`, backups (`data/`, including
`shares.sqlite`), restore, alerts, takedowns, the legal checklist, and nginx `set_real_ip_from`
when behind a CDN.

**Done when:**
- pytest shows that in hosted mode `/python` returns 404 and `/search` carries CORS and
  Cache-Control headers.
- `mirror --dry-run` on the fixture data excludes comtrade, imf and fred.
- `docker compose -f deploy/hosted/compose.yml config` is valid, if Docker is present.

## B: 200-question benchmark (L)

**Owns:** `evals/benchmark.yaml`, `src/statmesh/bench.py`, `evals/results/**`,
`docs/benchmark.md`, `.github/workflows/ci.yml`, `.gitignore`, `tests/test_bench.py`, and any
re-recorded connector fixtures.

**Questions:**
- Each entry has `id`, `q`, `source`, `topic`, `expected` (series keys), `geo`, `start` and `end`.
- There are 200 in total, with at least 4 per source, at least 10 per topic, and at least 15 from
  the health long tail.
- The catalog is built with `fixture_catalog.build(evals/bench_data)` from every source, and
  `evals/bench_data` is gitignored. The pinned search eval stays as it is.

**Offline metrics:**
- **recall@5:** search with `q` plus `geo`, and no source filter.
- **Answerable:** the first expected key found in the top 5 returns at least one non-null value in
  `[start, end]` for that geo.
- **Cited:** the citation has a licence, a source URL and `retrieved_at`.
- **Answer rate:** the share of questions that pass all three.

**`--llm` mode:** runs only when `ANTHROPIC_API_KEY` is set. It calls the API over httpx with the
tools running in-process, and grades "has a number, and every number appears in a tool result".

**Output and CI:**
- Writes `results.json` and a markdown report.
- The CI gate sits at the first measured value minus 0.05, rounded down to 0.05, with a floor of
  0.75.
- Never edit expected answers to raise the score.

## C: shareable answer links (L)

**Owns:**
- `src/statmesh/shares.py`, `api/shares.py`, `tests/api/test_shares.py`
- `web/src/app/a/**`, `web/src/app/api/share/route.ts`
- `web/src/app/chat/chat.tsx`, `web/src/app/chat/answer-view.tsx`
- `web/src/lib/chat/share.ts` and its test
- `docs/sharing.md`

**Storage and API:**
- Shares live in SQLite at `data/shares.sqlite`.
- `POST /shares` returns `{id}`, where `id` is `token_urlsafe(9)`. `GET /shares/{id}` returns the
  share.

**Payload:**
- Holds the question, answer text, events (calls and results), chart data and the creation time.
- The server rebuilds citations and data vintages from the catalog, using the series ids found in
  the events.
- It rejects payloads over `share_max_bytes`, and strings that look like keys.
- Expired rows are deleted on each insert.

**Privacy:** a share is created only when the user clicks Share. It is built from the events,
never from the chat config.

**Page `/a/[id]`:**
- A read-only server page with `noindex`.
- Banner: "shared by a user, recorded on <date>". Numbers come from the user's session; citations
  are rebuilt by the server.
- Header: `Cache-Control: public, max-age=86400, immutable`.

**Done when:**
- create then fetch returns the same payload;
- an oversize payload gets 413, a key-like string gets 400, an expired share gets 404, and
  disabled shares get 404;
- the web tests, typecheck and build pass.

## D: live smoke tests and doctor (M)

**Owns:** `src/statmesh/doctor.py`, `src/statmesh/connectors/*/tests/test_smoke.py`,
`tests/test_doctor.py`, `.github/workflows/smoke.yml`.

**`doctor.check(source)`:**
- Reports the key status from the manifest's `auth`/`key_env`: set, missing or optional.
- Replays the first entry of the connector's `fixtures/requests.yaml` live, with a 20 s timeout.
- Returns `ok`, `skip` or `fail`, with latency.

**CLI:** prints a table, supports `--json`, `--source` and `--offline`, and exits 1 on any
failure.

**Smoke tests:** each connector gets a `@pytest.mark.live` test that calls `check` and skips when
the key is missing. Existing richer tests stay.

**`smoke.yml`:**
- Add the BEA, EIA, Data Commons and Companies House secrets.
- Keep one issue per source, titled "Live smoke failing: <id>".
- Close the issue when the source goes green.

**Done when:** `pytest -m live` with no keys shows keyed sources SKIPPED, and
`statmesh doctor --offline` prints 27 rows.

## E: streamed CSV export (M)

**Owns:** `query/engine.py` and `service.py` (after W0), `api/export_csv.py`, `export.py`,
`sdk.py`, `web/src/app/api/series-csv/route.ts`, `tests/api/test_export_csv.py`.

**Changes:**
- `engine.iter_observations()` uses the same SQL and licence filtering, reads `fetchmany(5000)`
  through a cursor, and stops at `export_max_rows`.
- `GET /series/{id}/observations.csv` streams the result with an `X-Statmesh-Attribution` header.
- The web route and `statmesh export --format csv` stream it through.

**Done when:** a 25k-row multi-geo series exports as 25,001 lines.

## Z: integration (S), runs last

**Owns:** `pyproject.toml`, `uv.lock`, `__init__.py`, `README.md`, `CHANGELOG.md`,
`docs/query-surfaces.md`, `docs/self-hosting.md`, `web/openapi.json`,
`web/src/lib/api-types.ts`.

**Steps:**
- Bump the version to 0.3.0 and run `uv lock`.
- Regenerate the API types.
- Write the CHANGELOG entry for v0.3.0.
- Refresh README "What has been run" from commands that were actually executed.

## Risks

- The offline benchmark tests the plumbing, not real coverage. Label it "fixture catalog".
- Shared answers can contain forged numbers. The banner says so.
- Remote `yes` sources (sec_edgar frames, census, esef) are empty on the mirror unless `mirror`
  ingests them.
- A person must sign off on licences before launch.
- A long export holds a DuckDB cursor open. Set memory to 1GB on a 4GB VM.
- Per-IP limits behind a CDN need `set_real_ip_from`.
