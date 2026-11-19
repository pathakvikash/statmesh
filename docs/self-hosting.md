# Self-hosting with docker compose

One image (`Dockerfile`, Python 3.12 slim, non-root uid 1000) runs both services. They share one
`./data` folder.

```sh
cp .env.example .env          # keys; STATMESH_CONTACT_EMAIL is required (SEC EDGAR)
mkdir -p data && sudo chown 1000 data       # or: chmod a+rwx data
docker compose up -d                        # api + worker
docker compose --profile web up -d          # also the web UI
docker compose logs -f worker
```

(`docker compose` was not run while writing this page; the compose file and Dockerfile were read,
not executed.)

## Services

| Service | Command | Port | Notes |
|---|---|---|---|
| `api` | `statmesh serve --host 0.0.0.0 --port 8000` | 8000 | REST, MCP at `/mcp`, health check `GET /healthz` |
| `worker` | `statmesh worker` | none | the scheduler; health check disabled |
| `web` (profile `web`) | `web/Dockerfile`, Next.js | 3000 | env `STATMESH_API_URL=http://api:8000`; starts when `api` is healthy |

Both Python services read `.env` (`env_file`), set `STATMESH_DATA_DIR=/data`, mount `./data:/data`
and restart unless stopped. `api` and `worker` exit at startup if `STATMESH_CONTACT_EMAIL` is empty
while `sec_edgar` is enabled; fill it in or add `sec_edgar` to `STATMESH_DISABLE`. The web UI pages are search, series detail with a chart and citations, a
SQL console, sources, and a chat page where you paste your own LLM key (OpenAI-compatible, which
covers Ollama's `/v1`, or Anthropic). The key is kept in the browser's `localStorage` and sent with
each request; it is not stored on the server. The chat page flags numbers in an answer that came
from no tool result. It has been tested with a stubbed LLM only, not against a live model.

## First data

The worker only runs jobs; it does not fetch anything until a job is due, and it does not fill the
catalog for you. Seed it once:

```sh
docker compose exec api statmesh ingest worldbank
docker compose exec api statmesh ingest ilostat
docker compose exec api statmesh discover imf       # catalog only; datasets stay remote
```

`ingest` runs discovery for that source first if the dataset is not in the catalog. Then:

```sh
curl 'http://localhost:8000/search?q=unemployment+India'
curl 'http://localhost:8000/sources'
```

## What the worker schedules

A job exists for each `core_datasets` entry of a source whose manifest also has
`refresh.schedule` (cron, UTC). Today that is `worldbank`, `imf`, `ilostat`, `eurostat`, `oecd`,
`unsdg`, `bis`, `ecb`, `faostat`, `bls` and `fred`. Sources with a schedule but no core datasets
(`gleif`, `uk_companies_house`, `dbnomics`) and all on-demand or keyed-and-unscheduled sources
(`comtrade`, `sec_edgar`, `mospi`, `datagovin`, `census`, `bea`, `eia`, `datacommons`, `who_gho`,
`esef`, `cdc_data`, `open_canada`) are not refreshed by the worker; run `statmesh ingest` yourself
or let on-demand reads fetch. A scheduled source whose required key is missing (`fred`) fails its
job and goes stale. A dataset never ingested is due immediately when the worker first sees it, so
the first start after `docker compose up` begins pulling every scheduled core dataset (FAOSTAT's
bulk files are large). Expect OECD to use part of its 60 downloads per hour budget. Only one process
ingests a given dataset at a time; if the worker and a CLI `ingest` collide, the second gets a
"already being ingested" error.

A failed job retries after 1, 5 and 30 minutes, then the dataset is marked stale with the error
(`GET /sources` shows `stale_datasets`) and waits for its next cron slot. Old data stays served.

## Keys and sources

Put keys in `.env`; see [configuration.md](configuration.md) for every variable. A source that needs
a key and has none returns HTTP 503 naming the variable on on-demand reads, and its scheduled job
fails and goes stale. Turn sources you do not want off with `STATMESH_DISABLE=datagovin,fred`.

## Data, backups, upgrades

Everything is in `./data`: `catalog.sqlite`, `manifest.json`, `raw/`, `obs/`, `tables/`, `cache/`.
Back it up by copying the folder while the services are stopped; the layout is in
[data-model.md](data-model.md#storage-layout). To upgrade: `git pull && docker compose build &&
docker compose up -d`. If a release notes a connector `version` bump, run
`statmesh ingest <source> --dataset <id> --reprocess` to rebuild from the saved raw files.

## Hardening notes

- There is no authentication on the API, SQL endpoint or MCP. Compose publishes `8000:8000` on all
  interfaces. Bind it to loopback (`"127.0.0.1:8000:8000"`) or put an authenticating proxy in front.
- The SQL endpoint is read-only and locked down (see [query-surfaces.md](query-surfaces.md#sql)),
  but it can still run expensive queries; `STATMESH_SQL_TIMEOUT_S`, `STATMESH_SQL_MAX_ROWS` and `STATMESH_SQL_MAX_BYTES` bound
  them.
- The MCP endpoint checks the `Host` header against `STATMESH_ALLOWED_HOSTS` (default `localhost`,
  `127.0.0.1`, `[::1]` and `api`, any port). If you reach it by another name, add that name; do not
  use `*` on a network-reachable machine.
- `STATMESH_PYTHON_SANDBOX=1` needs the Docker socket, which is root-equivalent on the host. Only
  enable it on a single-operator machine, never on a shared or internet-reachable instance. The
  compose file does not mount the socket, and the image has no `docker` CLI; run `statmesh serve`
  directly on the host. Details: [sandbox.md](sandbox.md).
- Set `STATMESH_MODE=hosted` only if you intend to expose data publicly and have reviewed
  [licensing.md](licensing.md).
