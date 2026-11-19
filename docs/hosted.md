# Hosted instance: Phase 3 design

Status: 2026-11-19. The mirror is built (package A of M2: `deploy/hosted/`, `statmesh mirror`, CORS and Cache-Control in the API); no hosted instance is running. The "What must be built" list below is the original design; items 1 to 4 now exist as noted there. Operating it: `docs/hosted-runbook.md`.

## Recommendation

Run a hosted instance only as a **public, anonymous, read-only mirror of `redistribute: yes` sources**. That needs about a week of work (items 1 to 4 under "What must be built") and one small VM.

Do not launch per-user key pass-through for `no`/`review` sources in the first version. It adds secrets handling and a legal question (are we redistributing when we proxy a user's own key?) for sources people can already query by self-hosting.

## What hosted mode already enforces

Set with `STATMESH_MODE=hosted` (default `self_host`). The rule is one function, `can_serve()` in `src/statmesh/core/licence.py`: in hosted mode only `redistribute == "yes"` is served.

| Surface | Behaviour in hosted mode | Where |
|---|---|---|
| SQL (`POST /query`, MCP SQL tool) | Catalog tables are loaded without non-`yes` sources, datasets and series. Parquet files of non-`yes` datasets are never attached. Non-`yes` series inside a served dataset are filtered out of `observations` and `observations_vintages`. `entities` and `entity_xref` are filtered by source. | `query/engine.py` `_build()` |
| Search | Hits whose licence is not `yes` are dropped. | `service.py` `_hit()` |
| Series detail | Non-`yes` series return 404. | `service.py` `_series()` |
| Observations | Non-`yes` series return 403 before any on-demand fetch, so the upstream is not called. | `service.py` `get_observations()` |
| `/sources` | Non-`yes` sources are not listed. | `service.py` `list_sources()` |
| Sandboxed Python | Disabled regardless of `STATMESH_PYTHON_SANDBOX`. The `/python` route and the `run_python` MCP tool are not registered. | `service.py` `python_enabled()` |

Also in place for every mode:

- SQL is one allowlisted `SELECT`, with a wall-clock timeout (`sql_timeout_s`) and a row cap (`sql_max_rows`).
- DuckDB runs with external access off, extension autoload off, a 2 GB memory limit and locked configuration.

Two earlier gaps, now fixed:

- **Host check covers every route.** `api/app.py` rejects any request (REST and `/mcp`) whose `Host` is not in `STATMESH_ALLOWED_HOSTS` with 421 (decision 9); `host:*` allows any port and `*` disables the check. The MCP Origin allow-list is derived from the same hosts.
- **Per-series `yes` inside a `review` dataset is consistent.** The SQL views and search apply the same series-level licence check, so FRED public-domain series are served and the rest of the dataset is dropped.

## What must be built

Built in `deploy/hosted/`: `compose.yml` (hardened containers, only nginx publishes a port), `nginx.conf` (limits below, 429), `env.hosted.example` (shared, no secrets) and `env.worker.example` (source API keys, worker only). `statmesh mirror` ingests only core datasets whose effective licence is `yes` (dataset licence wins), and the hosted worker skips anything else. Not built: the cap on concurrent `/query` runs beyond nginx's 2 connections per IP, and a separate limit for on-demand fetch (hosted mode turns `STATMESH_ONDEMAND` off instead).

1. **Shared store limited to `yes`.** Ingest only `yes` sources on the hosted box: set the others as disabled so their data is never on disk. The query-time filter then becomes a second line of defence, not the only one.
2. **Rate limiting and abuse controls.** There is none in the app today. Put it in the reverse proxy (nginx `limit_req` or a CDN), not in Python:
   - per-IP limits on `/query` and `/mcp` (suggested start: 30 requests/minute, burst 10), looser on `/search` and `/series`;
   - a request body size cap on `/query` (64 KB is plenty for SQL);
   - a cap on concurrent `/query` executions (suggested: 4), since each may use up to 2 GB under the current DuckDB limit. Lower the memory limit to fit the VM;
   - on-demand fetches of `remote` datasets spend the server's upstream quota on behalf of anonymous users. Either serve only ingested datasets in hosted mode, or give on-demand fetch its own much lower per-IP limit.
3. **Allowed hosts.** Set `STATMESH_ALLOWED_HOSTS` to the public hostname (applies to REST and MCP).
4. **TLS and proxy.** Terminate TLS at the proxy; the API listens on localhost only.
5. **Per-user keys (deferred).** If built later:
   - the user sends their own source key in a request header; it is used for that request only, never stored, never logged;
   - results fetched with a user key are not written to the shared cache and are never visible to another user. The simplest correct version is no caching at all for these requests;
   - `can_serve()` gains a "caller supplied their own key" case for `no`/`review` sources, and nothing else changes;
   - this still needs the legal review below, because the data transits our server.

## Using the hosted API

The whole REST API is under `/v1/`: SDK base URL `https://<host>/v1` (so `GET /v1/search`, `POST /v1/query`, ...). MCP clients can use `/mcp` or `/v1/mcp`. Outside `/v1/`, `/search` and friends belong to the web app.

## Known coverage limit: `review` datasets are skipped whole

`statmesh mirror` and the hosted worker decide per dataset: a source whose default licence is `review` is skipped entirely, including series that are individually `yes`. Example: OWID's per-chart `yes` series are not mirrored because the OWID source default is `review`. Upgrade path: mirror per series (ingest only the series whose own licence is `yes`, as the query filter already serves them).

## Auth

None for the first version. The data is public and `yes`-licensed, the API is read-only, and accounts would add a user database, password resets and privacy obligations. Abuse is handled by per-IP limits. Add API keys only if per-IP limits prove too blunt (for example, many users behind one NAT).

## Cost

Estimate, not a quote; check current provider pricing.

| Item | Size | Rough monthly cost |
|---|---|---|
| VM | 2 vCPU, 4 GB RAM, 40 to 80 GB SSD | USD 5 to 25 depending on provider |
| Backups to object storage | tens of GB | under USD 2 |
| Domain, TLS (Let's Encrypt), uptime check | | about USD 1 |

Expect USD 10 to 30 a month. 4 GB RAM assumes the DuckDB memory limit is lowered to about 1 GB and `/query` concurrency is capped at 2; keep the 2 GB limit only on an 8 GB machine. Disk depends on which bulk sources are ingested: the GLEIF golden copy and FAOSTAT bulk files are the large ones.

## Backups

- Almost everything can be re-ingested from upstream, so a lost box costs hours of re-ingest and upstream quota, not data.
- The exception is `observations_vintages`: past revisions cannot be re-fetched. Back up `data/` nightly (catalog SQLite, manifest, `vintages/`) to object storage, keep 14 days, and test one restore before launch.

## Monitoring

- External uptime check on `/healthz`.
- The existing nightly `smoke.yml` already opens an issue per failing source.
- Alert on: disk above 80%, stale dataset count from `/sources`, 5xx rate, and 429 rate from the proxy logs (a sustained high 429 rate means abuse or limits set too low).
- Log the client IP and route, never SQL result contents and never request headers that could carry keys.

## Legal review checklist

Before launch, a person (not an agent) confirms each `yes` manifest against the live licence page, and that every response carries the attribution string.

Sources that are not `yes` today and why:

| Source | Status | Why | What would move it |
|---|---|---|---|
| `comtrade` | `no` | UN Comtrade terms restrict redistribution; caching is for the operator's own use. | Written permission from UN Comtrade. Assume it stays `no`. |
| `imf` | `review` | IMF terms: copyright IMF, free for non-commercial use with attribution. | Decide whether a free public mirror counts as non-commercial; confirm current IMF data terms. |
| `oecd` | `review` | CC BY 4.0 unless a dataset says otherwise. | Check the core dataflows individually; set `yes` per dataset. |
| `fred` | `review` (per series) | Many series are third-party copyrighted; mapping from copyright tags is unverified (decision 4). | Verify tag strings with a real key; serve only public-domain series. |
| `dbnomics` | `review` | ODbL covers the DBnomics database, not each provider's data. | Per-provider review. Prefer first-party connectors (decision 2). |
| `who_gho` | `review` | No licence on the API page; WHO data policy limits reuse and per-indicator licences vary. | Written confirmation from WHO, or stay unhosted. |
| `datacommons` | `review` | Compilation is CC BY, but each observation keeps its source's terms. | Filter by provenance to sources already `yes`; otherwise stay unhosted. |
| `mospi` | `review` in the manifest | Decision 1 moves it to `yes` based on an agent's translation of the Hindi copyright policy. | A Hindi reader confirms the Category A reading and its scope; then apply decision 1. |

Also confirm before launch:

- BIS (`yes` once the `bis` connector lands): the terms forbid any additional charge to users for BIS statistics. A free instance complies; a paid tier would not without review.
- Exports and citations: every response includes `citations[]`; the web UI shows source and licence beside every number; no source logos are used.
- A takedown contact address is published, and one person owns responding to it.
- Privacy: with no accounts, the only personal data is IP addresses in logs. State the retention period (suggested: 14 days).

## Decision summary for the reader

- Cheap and low-risk: a `yes`-only anonymous mirror, after rate limiting, the MCP host allow-list and the licence confirmations are done.
- Not ready: anything involving `review` or `no` sources, per-user keys, or sandboxed Python. Self-hosting remains the answer for those.
