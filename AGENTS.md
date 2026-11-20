# statmesh: instructions for AI agents

Open-source catalog and query layer over public statistics (Python 3.12, uv, FastAPI, DuckDB,
Parquet, SQLite FTS5; Next.js 16 web UI in `web/`; MCP is a primary interface).

**Read [docs/ai-context/00-START-HERE.md](docs/ai-context/00-START-HERE.md) first**, then only the
file you need: [architecture](docs/ai-context/architecture.md), [web](docs/ai-context/web.md),
[decisions](docs/ai-context/decisions.md), [status and gaps](docs/ai-context/status-and-gaps.md),
[runbook](docs/ai-context/runbook.md). Doc index: [docs/README.md](docs/README.md).

## Rules (full list in 00-START-HERE.md)

1. Never edit benchmark expected keys, thresholds or hold-out files to raise a score; do not tune on `evals/holdout2.yaml`.
2. No real keys, emails or local absolute paths in any file. `.env` is gitignored.
3. Connectors use `HttpClient` only; honour robots.txt for file downloads.
4. SQL goes through `query/sqlsafe.py` (AST allowlist) and the DuckDB lock-down in `query/engine.py`.
5. Licence default is `redistribute: review`; hosted mode serves only `yes`. Never loosen it to pass a test.
6. Hosted mode: on-demand fetch off, no sandbox, no server LLM key unless `STATMESH_ALLOW_SERVER_KEY=1`.
7. Every number carries a citation; nothing from memory.
8. REST, MCP, SDK, CLI and web all go through `src/statmesh/service.py`.
9. Tests are offline; say whether fixtures are recorded or synthetic.
10. Do not commit, push, tag, publish or deploy unless asked. For `web/`, read `web/AGENTS.md` and the Next.js docs in `web/node_modules/next/dist/docs/` first.

## Key commands (from the repo root)

```sh
uv sync --extra sdk
uv run pytest -q                                        # offline
uv run ruff check . && uv run ruff format --check .
uv run statmesh --help                                  # the CLI is the source of truth for flags
uv run statmesh bench                                   # 200-question benchmark (gated)
export STATMESH_DATA_DIR=$PWD/demo-data STATMESH_DISABLE=sec_edgar
uv run python -c "from statmesh.testing.fixture_catalog import build; build('demo-data')"
uv run statmesh serve                                   # http://127.0.0.1:8000
cd web && npm install && npm run dev                    # STATMESH_API_URL=http://127.0.0.1:8000
cd web && npm test && npm run typecheck && npm run lint
```

Where things live: `src/statmesh/{core,connectors,ingest,query,search,api,testing}`, `service.py`,
`mcp_server.py`; `web/src/{app,components,lib}`; `evals/`; `deploy/hosted/`; `docs/`.
