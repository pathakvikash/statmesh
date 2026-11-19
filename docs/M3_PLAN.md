# M3 "It's a platform": plan (v0.3.0 to v0.4.0)

Opus plan, 20 Nov 2026. Facts about sources and funders come from model knowledge and are not
verified. Every agent must check licence URLs while building and say what it could not check.

## Findings that shape the plan

- **Search misses have three causes** (`search/search.py`):
  - Too few stopwords and no period parsing: "many", "much", "did", "january" and "2024" become
    required AND terms. This breaks b102-b107, b132 and b153.
  - The reranker rewards a synonym at the start of a title: the synonym `people` for population
    matches "People who identify..." (`EQ_CONDOMUSE`) ahead of "Total population". This breaks the 6
    population misses.
  - Missing vocabulary: newborn/neonatal, teenage/adolescent, pregnancy/fertility/birth, extreme
    poverty/international poverty line, eurozone/euro area, real/constant prices.
  - FTS5 already uses `porter`; no stemmer is needed.
- `statmesh connector new` exists (`devtools/scaffold.py`) but has no `ckan` or `socrata` kind, and
  nothing fails while a `TODO` licence remains.
- The file connector reads csv, xlsx and zip only (`core/generic/file.py:262-279`): no `.gz`, no
  `file://`.
- The bench catalog is pinned to `EVAL_SOURCES`, so new connectors do not change the score; only
  search changes do.

## Rules for every package

- Python: `export UV_CACHE_DIR=$TMPDIR/uvcache; uv run --offline ...`. Offline tests.
- Never commit, push or publish. Never print `.env`. Do not change `pyproject.toml` (wave 3 owns it).
- Do not touch another package's files. Hand back README table rows and CHANGELOG lines in the
  report; do not edit README.md or CHANGELOG.md.
- Live fixtures: record with the repo tool if the network works (pass allowed_domains in auto
  mode). Otherwise write fixtures by hand, mark `"synthetic": true` in requests.yaml, and report
  which ones.
- Licence unknown: default `redistribute: review`.

## Wave 1 (parallel)

### C1: SDMX connectors (M)

**Owns:** new `connectors/{unicef,abs,statcan,insee,istat}/`; manifest edits to `connectors/imf/`
(add WEO), `connectors/eurostat/` (causes of death `hlth_cd_aro`, renewables `nrg_ind_ren`) and
`connectors/oecd/` (Health, on demand; core stays at 5 or fewer).

Config-only, no keys, `topics:` on every dataset.

### C2: file connectors and file-kind core (M)

**Owns:** `core/generic/file.py` and its test; new `connectors/{un_wpp,wb_pip,ons,nasa_gistemp,noaa_gml,who_mortality}/`;
`connectors/owid/manifest.yaml` (add population and CO2 slugs); `docs/recipes/gbd-import.md`.

- Add a `gz` format and `file://` URLs. `file://` is refused when `STATMESH_MODE=hosted`.
- The GBD import is a recipe only: a user folder in `STATMESH_CONNECTORS_DIR` with
  `redistribute: "no"`.
- `who_mortality` uses `where` to keep only the ICD codes for alcohol and X20 (snakebite).
- Large files need `where` filters and `max_uncompressed_mb`.

### C3: custom connectors (M)

**Owns:** `connectors/{unhcr,unesco_uis,ibge}/`, each copied from the `worldbank` pattern.

### New sources (14; 27 + 14 = 41)

| id | Covers | Kind | Licence (unverified) | Redistribute |
|---|---|---|---|---|
| un_wpp | population, fertility | file (gz) | CC BY 3.0 IGO | yes |
| unicef | neonatal and child mortality, adolescent births | sdmx | UNICEF terms | review |
| wb_pip | extreme poverty | file (CSV API) | CC BY 4.0 | yes |
| nasa_gistemp | global temperature | file | US government work | yes |
| noaa_gml | CO2 at Mauna Loa | file | US government work | yes |
| unhcr | refugees | custom | CC BY 4.0 | yes |
| who_mortality | registered deaths by ICD-10 | file (zip) | WHO terms | review |
| ons | UK headline series | file | OGL v3 | yes |
| statcan | Canada | sdmx | StatCan Open Licence | yes |
| abs | Australia | sdmx | CC BY 4.0 | yes |
| insee | France | sdmx | Licence Ouverte 2.0 | yes |
| istat | Italy | sdmx | CC BY 4.0 | yes |
| unesco_uis | education, literacy | custom | CC BY-SA 3.0 IGO | review |
| ibge | Brazil (SIDRA) | custom | IBGE terms | review |

Rejected: IEA (paid), Japan e-Stat (needs a key; defer), CDC WONDER (POST/XML, small-cell
suppression), AfDB (unstable portal), India NSO (`mospi` covers it).

**Acceptance (C1-C3):**
- `uv run statmesh connector test <id>` passes for every new id.
- `ls src/statmesh/connectors | wc -l` prints 41.
- No connector edits `EVAL_SOURCES`.

### P2: search quality (M)

**Owns:** `search/search.py`, `data/synonyms.yaml`, new `data/search_boosts.yaml`,
`data/groups.csv` (add EA, the euro area), `tests/search/test_search.py`, new `evals/holdout.yaml`,
and `evals/results/*`.

1. **Hold-out first.** Write 30 questions with expected keys read from fixture data, and record
   the baseline, before changing any search code. Never edit `benchmark.yaml`.
2. **Period parsing.** Pull years, months, quarters, fiscal years ("2023-24") and words like
   "early" or "latest" out of the concepts. Use them only to boost series whose coverage includes
   the period.
3. **More stopwords** for question filler: many, much, did, typical, every, live, and similar.
4. **Reranker.** A literal hit scores 1 and a synonym hit 0.5. The leading-term bonus counts only
   for literal hits. Titles are normalised (punctuation, "total" and "annual" removed).
5. **Boosts.** `search_boosts.yaml` sends a geo to its home sources (USA to census, bls, bea, eia,
   fred; IND to mospi; EA to ecb) and lifts headline datasets. Boosts only reorder; they never
   filter.
6. **Synonyms** for the vocabulary gaps above.
7. No ML dependencies.

**Acceptance:**
- `uv run statmesh bench --no-write` gives answer_rate >= 0.88 (stretch 0.90); then
  `--write-thresholds` lifts the gate to about 0.85.
- No topic drops below its v0.3.0 score, and the hold-out score does not drop.
- `pytest tests/search` passes.
- REPORT.md lists every question that newly fails.

### P3: contributor kit (M)

**Owns:** `devtools/scaffold.py`, `cli.py` (P3 is its owner), `testing/contract.py`,
`tests/devtools/`, `docs/first-connector.md`, `CONTRIBUTING.md`,
`.github/ISSUE_TEMPLATE/{new_source.yml,bug.yml,config.yml}`, `.github/PULL_REQUEST_TEMPLATE.md`,
`CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `GOVERNANCE.md`, `SECURITY.md`,
`docs/good-first-sources.md`.

- Add the `ckan` and `socrata` scaffold kinds; `new` prints the next steps.
- The contract suite fails while a licence `TODO` remains.
- `cli.py` gains `mcp --print-config {claude-desktop,claude-code,chatgpt} [--url]` as a parser
  entry only; P4 implements it in `mcp_server.py` (target `statmesh.mcp_server:print_config_cmd`
  or a flag handled in `run_stdio`; agree it in `cli.py` first).
- The PR checklist moves into the PR template; CONTRIBUTING links to it.
- GOVERNANCE: single maintainer for now; decisions recorded in `DECISIONS.md`; licence policy:
  unknown terms default to `review`, then `yes` once verified; security reports go through GitHub
  private reporting.
- `good-first-sources.md`: 10 ready-to-file issue drafts from the rejected and deferred list.

**Acceptance:** a new test scaffolds every kind into a temp `STATMESH_CONNECTORS_DIR`; the `file`
kind passes the full suite and the other kinds fail only on the TODO check.

### P4: MCP and app setups (M)

**Owns:** `mcp_server.py`, `api/app.py`, `web/openapi.json` (regenerated), new `docs/llms.txt`
(served at `/llms.txt`), `docs/ai-apps.md`, `tests/api/test_agent_surfaces.py`.

- `--print-config` emits the Claude Desktop JSON (stdio command from the README), the
  `claude mcp add` command for Claude Code, and for ChatGPT the remote `/mcp` URL plus a GPT
  Action import of `https://<host>/v1/openapi.json`.
- OpenAPI gets unique `operationId`s, a summary on every operation, examples, and under 30
  operations.
- The MCP `instructions` carry the missing-data rules from `docs/PRODUCT.md`.
- Hosted vs local: ChatGPT needs a public HTTPS host, meaning the M2 mirror
  (`STATMESH_ALLOWED_HOSTS`, `redistribute: yes` data only). Claude can run locally over stdio.

**Acceptance:**
- `statmesh mcp --print-config claude-desktop | python -m json.tool` exits 0.
- A test asserts unique operationIds and a description on every operation.
- `GET /llms.txt` returns 200.
- The docs mark each app setup "not run in the real app".

### P5: pilot and funding kit (S/M)

**Owns:** `docs/pilots/{README,newsroom,ngo,course,feedback-form}.md`, `docs/pilots/demo.sh`,
`docs/funding/{one-pager,budget,nlnet-draft,knight-draft}.md`.

- `demo.sh` runs each persona's questions offline on the fixture demo data (build it with
  `fixture_catalog.build`); no new dataset.
- Drafts: NLnet NGI Zero (open-source infrastructure) and Knight Foundation (journalism).
  Wellcome is the alternative.
- Every funding file starts "DRAFT, NOT SENT" and ends with an "Unverified claims" section
  covering eligibility, deadlines and amounts.
- Each pilot brief measures cited answers per week, time to a cited number, and the share of
  answers where data was missing.

**Acceptance:** `grep -L "DRAFT, NOT SENT" docs/funding/*.md` prints nothing, and
`bash docs/pilots/demo.sh` exits 0 offline.

## Wave 2

### P6: gaps before v1.0 (M, after P4)

**Owns:** `service.py`, `sdk.py`, `ingest/` (the on-demand path); edits `api/app.py` and
`mcp_server.py` only after P4 is merged.

1. **Partial results are silent.** A row cap on an on-demand fetch sets
   `RawChunk.meta["truncated"]`, but nothing in the API exposes it (`docs/connectors.md:238`). Pass
   it to `ObservationsResult.truncated` and `warning` on REST, MCP and the SDK.
2. **No pagination.** Search stops at 100 results with no offset; observations stop at 10,000 rows
   with no offset (`service.py:39-40`). Add `offset` to both, on every surface.
3. **WHO GHO runs on the legacy OData host** and backs 35 of the 200 benchmark questions. Probe
   the Data Hub API; port if it is live, otherwise add a live smoke test that fails loudly.

**Acceptance:** new tests for the truncation warning and offset round-trips; `pytest -q` passes.

## Wave 3

### P7: integration (S)

**Owns:** `README.md` (41-row sources table, Known gaps, "What has been run", benchmark numbers),
`docs/connectors.md` (connector list), `CHANGELOG.md`, `docs/PRODUCT.md` (M3 status), the 0.4.0
bump in `pyproject.toml` and `src/statmesh/__init__.py`, `uv.lock`, and regenerated
`web/openapi.json` and `web/src/lib/api-types.ts`.

**Acceptance:** `ruff check`, `ruff format --check`, `pytest -q` and `statmesh bench` pass, and
the README numbers match `results.json`.

## Risks

- No network in the agent sandbox: new connectors may ship with synthetic fixtures.
- Tuning to the benchmark: the hold-out set and the "no topic drops" rule guard against it.
- Licence readings are unverified; five sources are `review`. A wrong `yes` leaks data on the
  hosted mirror.
- WPP and WHO Mortality files are large; each needs `where` filters and `max_uncompressed_mb`.
- `engine.py:_ensure` reloads the catalog tables on every catalog write; the cost grows with 41
  sources while the worker ingests. Measure it later.
- ChatGPT setup depends on the M2 hosted deploy, which has not happened yet.

## Needs the user

- Record live fixtures and verify the 14 licence pages.
- Test the setups in Claude Desktop, Claude Code and ChatGPT (ChatGPT needs a plan with developer
  mode or the GPT builder, and a public HTTPS host).
- Publish the GPT and list statmesh in MCP registries.
- GitHub settings: private vulnerability reporting, labels, Discussions; a contact email for the
  Code of Conduct and security reports.
- File the good-first-source issues and recruit 5 outside contributors.
- Find the 3 pilots, send the briefs, collect the feedback forms.
- Fiscal sponsor (NumFOCUS or Open Collective) and the Digital Public Goods registry application.
- Check grant eligibility and deadlines, finish the two drafts and submit them.
