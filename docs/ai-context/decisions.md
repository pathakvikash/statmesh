# Decision log

Newest first. Each entry: what was decided, why, and where it shows in the code. The earlier,
numbered decisions that override `docs/PLAN.md` are in [../DECISIONS.md](../DECISIONS.md) (dated
2026-11-19); the short versions are repeated at the bottom. Entries cite the commit that carried the
change where one exists. A "why" marked (inferred) was worked out from commits and code, not
stated by the owner; confirm before relying on it.

## 2026-11-24

- **Share links store ids and params, never values.** A shared page re-reads the numbers from the API,
  so citations and licences stay current and no data is copied into the share store.
- **Comments and the gap board go through GitHub** (issues, the `data-gap` template), not a custom system.
- **Web search tool deferred.** Design if built: fetch only from allowlisted official hosts, last
  resort after the catalogue, self-host only, every miss written to a gap log.
- **Home graph is capped at 60 nodes and laid out server-side** (`service.GRAPH_CAP`), so the page
  needs no layout library and the payload stays small.
- **The name "statmesh" stays until the owner decides.**
- **Licence matrix test** (`tests/test_licence_matrix.py`): every surface is read in hosted and
  self-host mode over one synthetic catalog, and a test fails if a public REST route is neither
  covered nor exempt.

## 2026-11-20

### Per-series `cut` in the manifest, not a per-dataset partial flag

- **Decision:** `partial` on observations is true only for series recorded in `manifest.json` under
  `cut`, and only when the dataset is also flagged truncated.
- **Why (inferred):** a row cap cut one series' tail, but the old dataset flag marked every series of the
  dataset partial, which made the UI warn about complete series. Ingest cannot know which series a
  cap dropped, so it records the last row's series of a capped chunk (a documented guess); an
  on-demand fetch records every series it loaded.
- **Where:** `ingest/runner.py: cut_series`, `ingest/ondemand.py`, `service._cut_ids`,
  `service._result`. Limits: ids stay until the dataset's next full ingest; a connector that drops
  rows elsewhere under-flags. `truncated` was split out earlier to mean only "more rows at
  `next_offset`" (breaking for clients that read it as partial data).

### Shape-based normalisation in the web app

- **Decision:** a series page does not know the source's quirks. It reads the series' observed
  shape (rows, geos, periods, frequencies, dimensions, units, status) and picks a view
  (`empty | value | ranked | line | multi-line`), default frequency and default dimension values
  from that shape.
- **Why (inferred):** 33 sources have different dimensions and frequencies; per-source rendering code would
  not scale and would rot. A pure `shape.ts` is testable without a server.
- **Where:** `web/src/lib/shape.ts`, `range.ts`, `compare.ts`, `data.ts: seriesShape`; commit 13cfc73.

### Fixed search pool of 2000 for every page

- **Decision:** `search()` fetches one pool of `SEARCH_POOL = 2000` candidates, reranks, then every
  page is a slice. `offset + limit` beyond the pool is rejected (HTTP 422); `next_offset` is null at
  the end of the pool.
- **Why:** when the pool grew with the page, the order changed between pages and hits were skipped or
  repeated. Licence filtering (`keep`) is applied before slicing so a hosted filter never shrinks a
  page.
- **Where:** `search/search.py`; M3 review fixes, commit 0399a1f.

### On-demand cache for non-core WHO and World Bank series

- **Decision:** WHO GHO ingests a short core indicator list (`core_indicators` in its manifest);
  every other GHO indicator (and non-core World Bank indicators) is fetched on demand into
  `cache/obs/` with a TTL, and the `observations` view unions ingested and cached rows, keeping the
  ingested row on overlap (`row_number()` dedupe).
- **Why:** mirroring the full GHO or World Bank catalogue is large and slow, yet the question "alcohol
  deaths" needs series outside the core list. A bug hid cache rows of ingested datasets from SQL
  (fixed in ee9e367: cache parts of an ingested dataset stay visible); a series with no ingested row
  now loads on demand (4355705).
- **Where:** `query/engine.py` (view), `ingest/ondemand.py`, `service._prepare` (`_outside_core`,
  `_has_rows`). Hosted mode turns on-demand off, so it serves ingested `yes` data only.

### Benchmark honesty

- **Decision:** report the number as measured, with its caveats. Remove search tuning that only helps
  the benchmark; never edit expected keys or thresholds to raise a score.
- **Why:** the first M3 run reported 0.91 after tuning on the same 200 questions. Removing
  benchmark-only stopwords and synonyms in the review dropped it to 0.86 (and the "people" rewrite
  limited to counts cost the Population topic). Later search changes reached 0.895 on the main
  benchmark (Population 0.909). A first hold-out (`evals/holdout.yaml`, 30 questions) was seen
  during tuning, so it is not unbiased. `evals/holdout2.yaml` was written after those changes with
  expected keys read from fixture data before any search was run, and scored once: recall@5 0.667,
  answerable 0.500, cited 0.533, answer rate 0.500. That 0.50 is the honest blind score. Do not tune
  on it; the next blind set must be new questions.
- **Where:** `docs/benchmark.md`, `evals/`, `src/statmesh/bench.py`.

### robots.txt: `nasa_gistemp` and `noaa_gml` deleted, not built

- **Decision:** both connectors were removed from the plan and the tree.
- **Why:** the hosts' robots.txt forbids the data files, and statmesh honours robots.txt for file
  downloads (`docs/connectors.md`, `docs/licensing.md`). Our World in Data temperature and CO2
  charts are the intended alternative route (not yet in the `owid` connector list).
- **Where:** README "Not built in M3" table.

### Vercel hosts only the web app

- **Decision:** `web/` deploys to Vercel; the Python API deploys elsewhere (a small VM with Docker,
  see `deploy/hosted/`) and the web points at it with `STATMESH_API_URL`.
- **Why:** the API needs DuckDB plus Parquet on a writable local disk and a long-lived MCP endpoint;
  Vercel's filesystem is read-only and ephemeral. The browser never calls the API directly, so no CORS
  is needed.
- **Where:** `docs/vercel.md`, `web/.env.example`, `web/src/lib/mode.ts` (a Vercel deploy counts as hosted).

### Home and Search are separate pages; Compare and the AI sidebar

- **Decision:** `/` is a landing page (featured series, latest updates, browse by source), `/search`
  is the explorer; old `/?q=` links redirect. Compare (`?compare=`, up to 3 more series, up to 4 geos,
  default geos from the intersection of drawn series, 22796ff) and the AI sidebar (same `ChatPanel`,
  page context from `ai-context.ts`) were added.
- **Why (inferred):** one page that was both landing and results confused first-time users; compare and chat are
  the two most asked-for follow-ups from a series page.

### Search quality choices (M3)

- Question words are stopwords; period expressions are parsed out of the query; a literal title match
  outranks a synonym match; home sources get a boost (reorder only, never filter); "euro area" means
  the aggregate `region:EMU` unless the query names member states; "people" becomes "population" only
  after "how many" or "number of". No embeddings (keyword FTS5 plus a synonym file) so the whole thing
  stays offline, deterministic and explainable.

## 2026-11-21

- **Local chat runs on the user's own Claude plan through the `claude` CLI, never hosted.** `claude-cli`
  needs no API key (the key/token/base-URL env vars are stripped so the plan's login is used), runs with
  no built-in tools, no settings or hooks, a throwaway cwd, and only the statmesh data tools. `/chat/api`
  refuses it with 403 when `isHosted()`. Chosen: `ai-sdk-provider-claude-code` (pinned, MIT) over spawning
  the CLI ourselves, because it already maps the CLI's stream to AI SDK parts and the in-process MCP bridge.
  Licence note: "MIT" applies only to the provider package. It depends on Anthropic's proprietary
  `@anthropic-ai/claude-agent-sdk@0.3.283` ("SEE LICENSE IN README.md"), whose large per-platform binaries
  stay unused because `pathToClaudeCodeExecutable` points at the user's own `claude`.
- **Claude CLI guards.** The provider re-adds `ANTHROPIC_*`/`CLAUDE_*`/cloud vars from `process.env`, so the
  API-billing vars (and the Bedrock/Vertex/Foundry switches) are set to `undefined` in the options env, not
  deleted; a test runs a fake `claude` to prove the child never sees them. `strictMcpConfig` is on. `/chat/api`
  accepts claude-cli only from a same-origin browser request (`Sec-Fetch-Site: same-origin`, or Origin host
  equal to Host) to a loopback Host, so another website or a LAN machine cannot spend the user's plan.
  `/chat/models` reports `cli:true` only when not hosted/Vercel and the binary resolves.
- **Hosted users bring their own model:** OpenRouter, OpenCode, or Ollama. Ollama on a hosted site needs a
  public https URL (a tunnel); the SSRF guard is unchanged and still refuses private addresses.

## 2026-11-19 (from DECISIONS.md and the build)

- **Hosted = read-only mirror of `redistribute: yes` data only.** One function, `can_serve()`, is the
  rule. Per-user key pass-through is deferred (legal and secrets cost).
- **Licence default is `review`**; MoSPI NSO datasets `yes` (RBI tables `review`), but the Hindi
  copyright reading is unverified; DBnomics stays `review`; BIS (`yes`, terms verified) is the Q4
  policy-rate source; FRED copyright-tag mapping accepted but unverified.
- **Sandboxed Python is opt-in, self-host only, refused in hosted mode** (needs the Docker socket,
  which is root-equivalent). The default compose file does not mount the socket.
- **MCP DNS-rebinding protection is on** with an allow-list from `STATMESH_ALLOWED_HOSTS`; the same
  Host check covers every REST route (421).
- **The search-eval catalog is built in CI, not committed** (`python -m statmesh.testing.fixture_catalog`).
- **OECD: weekly full refresh, at most 5 core dataflows** (`updatedAfter` returns 403).
- **Census population estimates for vintages 2019 and 2021 only**; later years via ACS `B01003_001E`.
- **Folder names `census`, `open_canada`, `cdc_data`** replace the planned `datagov_us` and `nyc_opendata`.
- **Parquet plus manifest swap instead of a database for observations** (rationale from `docs/architecture.md`), so readers never hit a
  single-writer lock and a refresh is atomic.
- **Citations come from the catalog, rebuilt on read** (also for share links), so a licence change
  takes effect without rewriting stored data.
