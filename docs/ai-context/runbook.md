# Runbook

Exact commands. Run from the repo root unless a line says `cd web`. Every `statmesh` subcommand and
flag below was checked against `uv run statmesh <cmd> --help`; package scripts were checked in
`web/package.json`. Commands marked (not run) are standard but were not executed while writing this.

## Setup

```sh
uv sync --extra sdk            # Python 3.12+, uv; --extra sdk adds pandas and polars for the SDK
cp .env.example .env           # optional; fill in only the keys you have. .env is gitignored
cd web && npm install          # Node 20+ (Node 22 in the Docker image and on Vercel)
```

The CLI and server do not read `.env` themselves: use `uv run --env-file .env statmesh ...`. Offline
or sandboxed machines: `export UV_CACHE_DIR=$TMPDIR/uvcache` and `uv run --offline ...`.

## Build the demo data (offline, no keys)

`demo-data/` is gitignored. It is built from every connector's recorded fixtures:

```sh
export STATMESH_DATA_DIR=$PWD/demo-data STATMESH_DISABLE=sec_edgar
uv run python -c "from statmesh.testing.fixture_catalog import build; build('demo-data')"
uv run statmesh sources --local
uv run statmesh search "unemployment rate India" --local
```

`build(data_dir, sources=None)` ingests the sources in `EVAL_SOURCES` (a pinned list in
`testing/fixture_catalog.py`; discover limit 20 per source) and fetches comtrade on demand. It
returns `(settings, errors)`; skipped datasets are in `errors`. To write the search-eval catalog
instead: `uv run python -m statmesh.testing.fixture_catalog evals` (writes
`evals/fixture_catalog.sqlite`).

## Load live data

```sh
export STATMESH_DATA_DIR=$PWD/data
uv run --env-file .env statmesh discover ilostat          # list datasets, load none
uv run --env-file .env statmesh ingest ilostat            # core datasets (about 30 s)
uv run --env-file .env statmesh ingest ilostat --dataset DF_UNE_DEAP_SEX_AGE_RT
uv run --env-file .env statmesh ingest <source> --dataset <id> --reprocess   # rebuild from saved raw files
uv run --env-file .env statmesh mirror --dry-run          # what a hosted mirror would ingest
```

`ingest` exits 1 if any dataset failed. Cron times are UTC; `statmesh worker` runs the schedule.

## Run the API

```sh
export STATMESH_DATA_DIR=$PWD/demo-data        # or $PWD/data; the API reads whatever this points at
STATMESH_DISABLE=sec_edgar uv run statmesh serve               # http://127.0.0.1:8000
curl 'http://127.0.0.1:8000/healthz'
curl 'http://127.0.0.1:8000/search?q=unemployment+India&limit=3'
```

API docs at `/docs`, MCP over HTTP at `/mcp`, MCP over stdio: `uv run statmesh mcp`. Client setups:
`uv run statmesh mcp --print-config claude-desktop | claude-code | chatgpt --url https://<host>/mcp`.
`serve`, `worker` and `mcp` refuse to start with `sec_edgar` enabled and no
`STATMESH_CONTACT_EMAIL`; either set it or set `STATMESH_DISABLE=sec_edgar`.

## Run the web

```sh
cd web
STATMESH_API_URL=http://127.0.0.1:8000 npm run dev      # http://localhost:3000
npm run build && node .next/standalone/server.js        # production (not run in the sandbox)
```

`next start` does not work with `output: "standalone"`. If `next build` panics under Turbopack in a
restricted sandbox, verify the build with webpack instead: `npx next build --webpack` (the flag is
documented in `web/node_modules/next/dist/docs/`; Turbopack is the default bundler).

## Tests and lint

```sh
uv run pytest -q                      # offline (pytest-socket); roughly a minute
uv run pytest -q -m live              # real APIs; needs network and keys; the nightly smoke workflow runs it
uv run pytest tests/search -rs        # with STATMESH_EVAL_CATALOG=$PWD/evals/fixture_catalog.sqlite (CI does this)
uv run ruff check . && uv run ruff format --check .        # line length 100; `ruff format` to fix
cd web && npm test                    # vitest run
cd web && npm run typecheck           # tsc --noEmit
cd web && npm run lint                # eslint .
uv run statmesh connector test <id>   # one connector's tests (add --live for the network)
```

## Benchmark

```sh
uv run statmesh bench                                                   # 200 questions, gated by evals/results/thresholds.json
uv run statmesh bench --questions evals/holdout.yaml --no-write         # 30 questions, seen during tuning
uv run statmesh bench --questions evals/holdout2.yaml --no-write --data-dir "$TMPDIR/bench2"   # blind set; do not tune on it
uv run statmesh bench --rebuild                                         # after editing a connector manifest
```

Use a separate `--data-dir` for hold-outs so `evals/bench_data` stays valid for the main run (the
questions file is part of the data hash). `--no-write` leaves `results.json` and `REPORT.md` alone.
`--write-thresholds` rewrites the gate: only after a real improvement, never to hide a drop.
`--llm` needs `ANTHROPIC_API_KEY` and is not gated. See [../benchmark.md](../benchmark.md).

## Add a connector

```sh
uv run statmesh connector new <id> --kind sdmx     # sdmx | file | ckan | socrata | rest | custom
uv run statmesh connector record <id>              # record HTTP fixtures (honours HTTP(S)_PROXY)
uv run statmesh connector test <id>
```

Fill in the licence first (the contract suite fails on a `TODO`). Walk-through:
[../first-connector.md](../first-connector.md); reference: [../connectors.md](../connectors.md).

## Docker

```sh
cp .env.example .env && mkdir -p data && sudo chown 1000 data     # the image runs as uid 1000
docker compose up -d                       # api :8000 and worker (not run here: no Docker daemon)
docker compose --profile web up -d         # also the web UI on :3000
```

Hosted mirror: `deploy/hosted/` and [../hosted-runbook.md](../hosted-runbook.md). Web on Vercel:
[../vercel.md](../vercel.md).

## Release steps (owner approves each; an agent does not tag, push or publish unasked)

1. Update `CHANGELOG.md` (move "Unreleased" under the new version).
2. Bump the version in **both** `pyproject.toml` and `src/statmesh/__init__.py` (`statmesh --version`
   reads the latter).
3. Run every check above (pytest, ruff, `statmesh bench`, web test, typecheck, lint) and update the
   README's "What has been run" table with what you actually ran.
4. Commit, then tag (`git tag vX.Y.Z`). Pushing and publishing (`uv build`, PyPI; not run) are the
   owner's call.
5. Hosted: rebuild images, redeploy `deploy/hosted/`, run `statmesh mirror`, check `/healthz`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `not_found` for a series, empty `/sources`, empty search | The API or CLI is reading a different data directory. Check `STATMESH_DATA_DIR` (default `./data`; compose uses `/data`). `--local` reads the directory in-process; without it the CLI calls `STATMESH_URL` (default `http://localhost:8000`) |
| API shows old data or old behaviour after a code or data change | `statmesh serve` has no auto-reload. Restart it. (The query engine itself rebuilds its views when the manifest or catalog changes.) Web `/` and `/sources` cache for 300 s |
| `serve` or `mcp` exits at startup naming `STATMESH_CONTACT_EMAIL` | `sec_edgar` is enabled without a contact email. Set it or `STATMESH_DISABLE=sec_edgar` |
| `Operation not permitted` binding a port (EPERM) in an agent sandbox | Local port binding is off in the sandbox. Allow local binding in the sandbox settings or run the server outside it |
| `uv` cannot write its cache, or tries the network | `export UV_CACHE_DIR=$TMPDIR/uvcache` and use `uv run --offline` |
| Web page says "Cannot reach the statmesh API" | API not running, or `STATMESH_API_URL` wrong. The browser never calls the API directly |
| MCP or REST returns 421 | `Host` header not in `STATMESH_ALLOWED_HOSTS` (default `localhost:*,127.0.0.1:*,[::1]:*,api:*`). Add the hostname; `*` turns the check off (not for public hosts) |
| Observations `status: rate_limited` with `retry_after` | The source's rate limit is spent; wait. Comtrade without a key uses the keyless preview (500 records per call) |
| A source returns 503 naming a variable | `MissingKey`: set that API key in `.env` |
| A series is empty in hosted mode but not locally | Hosted serves only `redistribute: yes`, and on-demand fetch is off |
| `statmesh bench` exits 2 about `--data-dir` | The directory is not empty and has no `.statmesh-bench` marker; the bench refuses to wipe it |
| `statmesh bench` exits 1 | A metric fell below `thresholds.json`, or an expected key is missing from the catalog. Read `evals/results/REPORT.md`; do not edit the keys |
| `next start` does not work | Use `node .next/standalone/server.js` (standalone output) |
| `next build` panics under Turbopack in a sandbox | See "Run the web" above |
