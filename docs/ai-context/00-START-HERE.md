# Start here (for AI agents)

Read this page first. It is one page on purpose. The other files in this folder go deeper:

| File | Read it when |
|---|---|
| [architecture.md](architecture.md) | you touch the Python package: ingest, storage, catalog, query engine, search, service |
| [web.md](web.md) | you touch `web/` (the Next.js app) |
| [decisions.md](decisions.md) | you wonder why something is the way it is, or are about to change it |
| [status-and-gaps.md](status-and-gaps.md) | you need to know what is done, what is weak, and what only the owner can do |
| [runbook.md](runbook.md) | you need an exact command, or something broke |

## What statmesh is

An open-source catalog and query layer over public statistics (World Bank, IMF, OECD, ILOSTAT,
Eurostat, UN Comtrade, SEC EDGAR, MoSPI and more; 33 connectors). You search for a series in plain
words, read it through one interface (SQL, REST, MCP, Python, CLI) whatever the source, join across
sources on country, year, HS product or company, and every number carries its source, licence and
retrieval time. It is agent-first: the MCP server is a primary surface. Author: Vikash Pathak.
Licence: Apache-2.0 for the code; each source's data keeps its own licence.

Stack: Python 3.12, uv, FastAPI, DuckDB (queries), Parquet (observations), SQLite with FTS5 (catalog
and search). Optional web UI in `web/`: Next.js 16, React 19, Tailwind 4, Recharts, Vercel AI SDK.

## Run and test in six lines

```sh
uv sync --extra sdk
export STATMESH_DATA_DIR=$PWD/demo-data STATMESH_DISABLE=sec_edgar
uv run python -c "from statmesh.testing.fixture_catalog import build; build('demo-data')"   # offline demo data
uv run statmesh serve                      # API + MCP on http://127.0.0.1:8000
(cd web && npm install && STATMESH_API_URL=http://127.0.0.1:8000 npm run dev)   # http://localhost:3000
uv run pytest -q && uv run ruff check . && uv run ruff format --check . && (cd web && npm test && npm run typecheck && npm run lint)
```

More commands, bench, release and troubleshooting: [runbook.md](runbook.md).

## The rules an agent must follow

1. **Never edit benchmark expected keys, thresholds or hold-out files to raise a score.** The
   expected keys in `evals/benchmark.yaml` were read from fixture data, not from search output.
   `evals/results/thresholds.json` only goes up after a real improvement (`--write-thresholds`).
   `evals/holdout2.yaml` is the blind set: do not tune search on it (one tuning change and it is no
   longer blind). Report scores as measured, with the caveats in `docs/benchmark.md`.
2. **No real keys, tokens, emails or private paths in any file.** `.env` is gitignored; fixtures are
   redacted (`REDACTED`, placeholder `replay-key`); the contract suite fails if a secret appears in
   a fixture. Docs must not contain local absolute paths, personal emails or any employer or
   company name other than the author.
3. **Connectors go through `HttpClient` only** (rate limit, retries, cache, User-Agent, key
   redaction). A connector never does its own retry, caching or raw `httpx`. File downloads read
   and honour `robots.txt`: a source whose robots.txt forbids the files is not built (this is why
   `nasa_gistemp` and `noaa_gml` do not exist).
4. **SQL goes through two layers, always.** `query/sqlsafe.py` (parse with DuckDB, walk the AST,
   one SELECT over the allowlisted views, no table functions) and the lock-down in
   `query/engine.py` (external access off, allowed directories, locked config). Never add a view,
   function or table to the allowlist without a test in `tests/query/test_hardening.py`.
5. **Licence default is `redistribute: review`.** Set `yes` only after reading the source's terms
   and recording the URL and attribution. Resolution order is series, then dataset, then source.
   Hosted mode serves only `yes` (`core/licence.py: can_serve`). Do not change a licence value to
   make a test or a benchmark question pass.
6. **Hosted mode is read-only and conservative.** In `STATMESH_MODE=hosted`: only `yes` data, on-demand
   fetch off, `/python` and `run_python` not registered, `file://` refused, web `/api/ondemand`
   and `/sql/ask` off, the server's own LLM key not used unless `STATMESH_ALLOW_SERVER_KEY=1`, and
   private-network LLM base URLs refused. Never weaken one of these to make a demo work.
7. **Every number needs a citation, and nothing comes from memory.** Surfaces return `citations[]`
   (source, licence, URL, retrieved_at). The MCP instructions and `docs/llms.txt` tell models to say
   what they searched and show the closest series when data is missing. Do not break that.
8. **One service layer.** REST (`api/app.py`), MCP (`mcp_server.py`), SDK, CLI and the web all go
   through `statmesh/service.py`. Add behaviour there, not in a surface. Never reimplement a
   licence or SQL check in a surface.
9. **Tests are offline.** `pytest-socket` blocks the network; live tests are `@pytest.mark.live` and
   run only with `-m live`. Say honestly whether a fixture is recorded (real) or hand-written
   (synthetic); never present synthetic values as real data.
10. **Do not commit, push, tag, publish or deploy unless the owner asks.** Do not edit another
    owner's files in a shared tree. For `web/`, read the Next.js docs in
    `web/node_modules/next/dist/docs/` before writing code (see `web/AGENTS.md`): this Next.js
    differs from older versions.

Also: if you change a connector's `normalize`, bump `version` in its manifest and `--reprocess`;
keep claims in docs checked (a command you did not run is "not run"); do not invent CLI commands or
flags (`uv run statmesh <cmd> --help` is the truth).

## Where things live

```
src/statmesh/
  cli.py service.py sdk.py mcp_server.py settings.py bench.py doctor.py export.py shares.py
  api/          FastAPI app (app.py), CSV export, share links
  core/         models, schema, catalog (SQLite+FTS5), storage (Parquet+manifest), http, geo, periods,
                licence, generic connectors (sdmx, file, ckan, socrata)
  connectors/   one folder per source: manifest.yaml [+ mapping.yaml | connector.py] [+ tests/fixtures]
  ingest/       runner (ingest, discover), scheduler (worker), ondemand (cache), mirror, xref
  query/        engine (DuckDB views, limits), sqlsafe (AST allowlist), citations
  search/       search.py (FTS5 + synonyms + rerank), topics.py, eval.py
  data/         schema.yaml, synonyms.yaml, topics.yaml, search_boosts.yaml, groups.csv, regions.csv, geo/, hs/
  testing/      contract suite, fixture replay and recording, fixture_catalog builder
  devtools/     connector scaffold, record, test
  sandbox/      opt-in Docker Python runner
web/            Next.js app (see web.md); web/src/app routes, components, lib
tests/          api, core, ingest, query, search, sdk, sandbox, acceptance (the four questions)
evals/          benchmark.yaml, holdout.yaml, holdout2.yaml, results/ (thresholds.json, REPORT.md)
deploy/hosted/  hardened compose, nginx.conf, env examples for the public mirror
docs/           human docs (index: docs/README.md); docs/ai-context/ is this folder
```
