# Hosted mirror runbook

Operating the public, anonymous, read-only mirror. Design and licence reasoning: `docs/hosted.md`.
Everything is in `deploy/hosted/`.

## Deploy

1. One VM (2 vCPU, 4 GB), Docker with the compose plugin, a DNS name pointing at it.
2. `cd deploy/hosted && cp env.hosted.example .env.hosted && cp env.worker.example .env.worker` and
   edit. Never commit either. `.env.hosted` (shared by api and worker, no secrets): set
   `STATMESH_SITE_URL`, `STATMESH_ALLOWED_HOSTS` and `STATMESH_CONTACT_EMAIL`. `.env.worker`: the
   source API keys; only the worker container reads it.
3. `mkdir -p data && sudo chown 1000:1000 data` (uid 1000 is the image's user).
4. `docker compose --env-file .env.hosted -f compose.yml up -d --build`
5. Fill the store: `docker compose --env-file .env.hosted -f compose.yml run --rm worker statmesh mirror`
   (add `--dry-run` first to see the list). The running worker then keeps it fresh on each manifest's
   schedule and skips any dataset whose licence is not `yes`.
6. Check: `curl -s localhost:8080/healthz`, then through the public name.

What the compose file enforces: read-only root filesystems, tmpfs `/tmp`, all capabilities dropped,
`no-new-privileges`, memory and pid limits. `api` is on an internal network with no outbound route.
`web` is on that network (to reach `api`) and on an `egress` network, because hosted chat calls the
visitor's chosen model provider from the web container; the worker is on `egress` only. The web app
refuses loopback, private-range, link-local and cloud-metadata targets in hosted mode
(`web/src/lib/chat/host-check.ts`, checked after DNS resolution over every address; the later fetch
resolves again, so a DNS-rebinding window remains). If you want no web egress, drop `egress` from
`web` in `compose.yml` and hosted chat will not work. Only nginx publishes a port (default
`127.0.0.1:8080`). `web` has a tmpfs at `/app/.next/cache` for the Next ISR and fetch caches.

## TLS

nginx speaks plain HTTP on 8080. Terminate TLS in front of it: Caddy or certbot+nginx on the host
proxying to `127.0.0.1:8080`, or a CDN. Set `STATMESH_HTTP_BIND=0.0.0.0:8080` only if the proxy is on
another machine. Pass `X-Forwarded-Proto`.

## Allowed hosts

`STATMESH_ALLOWED_HOSTS` must list the public hostname and `api:*` (the name the web container uses).
A request with any other `Host` gets 421, REST and MCP alike. Do not use `*` on a public box.

## Limits and real client IPs

nginx limits per client IP, returning 429: `/query` and `/mcp` 30/min (burst 10), 2 connections, 64 KB;
`POST /shares` 1/min (burst 10), 256 KB; everything else 120/min. `/api/query`, `/chat/api` and
`/api/series-csv` (the web app's routes into the same engine; the CSV one has a 600 s read timeout)
share the `/query` limits, and the UI's `POST /api/share` shares the `/shares` limits.

The whole REST API is also served under `/v1/` (the prefix is stripped; `Host` passes through, so
`STATMESH_ALLOWED_HOSTS` is unchanged). `/v1/query`, `/v1/mcp` and `/v1/series/<id>/observations.csv`
use the heavy limits, `POST /v1/shares` the shares limits, the rest the general limit. `/mcp` stays
for MCP clients.

Behind a CDN or TLS proxy every request arrives from the proxy's address, so all users share one
bucket. In `nginx.conf` uncomment and set `set_real_ip_from <proxy range>;`, `real_ip_header
X-Forwarded-For;` and `real_ip_recursive on;`. Trust only addresses you control. Reload with
`docker compose ... exec nginx nginx -s reload`.

The access log (`docker compose logs nginx`) holds IP, time, method, path without query, status, bytes
and duration. No headers, no query strings. Keep it 14 days: set the Docker log driver to
`local` with `max-size`/`max-file`, or ship and expire it.

## Backups and restore

Back up `data/` nightly, including `shares.sqlite`, `catalog.sqlite`, the manifest and `vintages/`
(past revisions cannot be re-fetched). Stop writes for a clean copy, or use `sqlite3 .backup` for the
SQLite files. Keep 14 days; test one restore before launch.

Restore: `docker compose ... down`, put the backup in `data/`, fix ownership (`chown -R 1000:1000`),
`up -d`. Lost everything else: re-run `statmesh mirror`.

## Alerts

External uptime check on `/healthz`. Alert on disk above 80%, a rising `stale_datasets` in `/sources`,
5xx rate, and a sustained 429 rate in the nginx log (abuse, or limits too low).

## Takedowns

Publish a contact address; one named person answers it. To remove a source or dataset at once: add it
to `STATMESH_DISABLE` (source) or set its licence to `review` in the manifest (dataset), restart, then
delete its files under `data/obs/<source>/` and its entries in the manifest, and purge any shares
(`shares.sqlite`) that cite it. Record the date and the request.

Shares hold numbers the sharer supplied: a share's tool results are user-supplied and can be
fabricated, so a page can show a figure the mirror never served. After a licence change, blanking on
read only catches results keyed by `series_id`; results that came from SQL are not recognised, so
purge those shares by hand (search `shares.sqlite` for the source name) when a takedown needs it.

## Legal checklist (a person confirms, before launch)

- Every `yes` manifest matches the live licence page (`docs/hosted.md`, "Legal review checklist").
- Every response carries `citations[]`; the UI shows source and licence beside numbers; no logos.
- BIS terms forbid charging users: the mirror must stay free.
- Privacy: only IP addresses in logs; state the 14-day retention.
- Takedown contact published and owned.
