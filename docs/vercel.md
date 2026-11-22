# Deploying the web app to Vercel

Only `web/` (Next.js 16) goes to Vercel. The Python API (DuckDB + Parquet on local disk, MCP endpoint) cannot run on Vercel's read-only, ephemeral filesystem. Deploy it separately and point the web app at it: free stack on Render ([hosted-free.md](hosted-free.md)) or a VM ([hosted.md](hosted.md), [hosted-runbook.md](hosted-runbook.md)).

## Project settings

| Setting | Value |
|---|---|
| Root Directory | `web` |
| Framework Preset | Next.js (auto-detected) |
| Install Command | `npm ci` |
| Build Command | `npm run build` (default) |
| Output Directory | default (leave empty) |
| Node.js version | 22.x (matches `web/Dockerfile`) |

`next.config.ts` sets `output: "standalone"` for the Docker image; Vercel ignores it, no change needed.

## Environment variables

Names and placeholders are in `web/.env.example`. Set them under Project Settings > Environment Variables (Production, and Preview if wanted). Read at request time, so no rebuild is needed after changing one (redeploy to apply).

| Name | Required | Meaning |
|---|---|---|
| `STATMESH_API_URL` | yes | Public https base URL of the Python API, no trailing slash (Render: `https://<svc>.onrender.com`, no `/v1`; nginx kit: `https://host/v1`). Used server-side only (pages, route handlers, and the chat route's `/mcp` connection). Default `http://localhost:8000`, which will not work on Vercel. |
| `STATMESH_MODE` | no | On Vercel an unset or empty value means hosted; any other value (including typos like `hostd`) turns hosted off. Set `hosted` explicitly anyway on any public deployment. Turns off `/api/ondemand`, live fetch triggers on series pages, `/sql/ask`, private-network LLM base URLs (SSRF guard), and the server-key fallback in chat. |
| `STATMESH_SITE_URL` | yes | Public origin of the web app (sitemap, robots, share links). Default `http://localhost:3000`. |
| `STATMESH_ALLOW_SERVER_KEY` | no | `1` lets `/chat` use the server's `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` even in hosted mode. Leave unset on a public site: anyone could spend your key. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | no | Server-side provider keys for `/chat`. Used only when not hosted, or hosted with `STATMESH_ALLOW_SERVER_KEY=1`, and only for the provider's own default URL. Never sent to the browser. |

The Python API must also allow the web app: its `STATMESH_ALLOWED_HOSTS` must include the API's public hostname (applies to REST and MCP). The browser never calls the API directly, so CORS is not needed.

## How the web app finds the API

Every server component and route handler calls `STATMESH_API_URL` (`web/src/lib/client.ts`); the chat route connects to `<STATMESH_API_URL>/mcp`. Vercel functions need to reach it over the public internet (https). If it is down, pages show a "Cannot reach the statmesh API" message instead of crashing. The home page and sources list cache their data for 300 s, so they may still show stale content for a few minutes.

## Deploy checklist

1. Python API deployed and healthy at its public URL (`curl https://api.example.com/healthz`), `STATMESH_MODE=hosted`, data loaded.
2. Import the repo in Vercel, Root Directory `web`, Node 22.x.
3. Set `STATMESH_API_URL`, `STATMESH_MODE=hosted`, `STATMESH_SITE_URL`. Do not set `STATMESH_ALLOW_SERVER_KEY` unless intended.
4. Deploy a Preview first. Check `/`, `/search?q=gdp`, `/sources`, `/sql`, a `/series/<id>` page, `/chat` (it should ask for the user's own key), and a bogus URL (404).
5. Check `/chat/models` returns `{"serverKey":{"anthropic":false,"openai":false},"cli":false}`, and that `/api/ondemand` (POST) returns 403.
6. Promote to Production, then open `/sitemap.xml` and `/robots.txt` and confirm they show the production origin.

The Claude CLI chat provider never runs on Vercel: `/chat/api` returns 403 for it and the picker hides it.
Visitors bring their own model there: OpenRouter or OpenCode with their key, or Ollama through a public
https URL (a tunnel; the server cannot reach their localhost, and the SSRF guard still refuses private
addresses).

## Rate limits and shared egress IP

The nginx kit (`deploy/hosted/nginx.conf`) limits per client IP: `/query` and `/mcp` (also under `/v1/`) at 30 requests/min with 2 concurrent connections, plus the web routes `/api/query`, `/chat/api` and `/api/series-csv` on the same heavy limits, and `/api/share` (like `POST /shares`) at 1/min, on top of a general 120/min.

On Vercel the web routes have none of this: nginx is not in front of them. Every visitor's request then reaches the API from Vercel's egress IPs, so the API's per-IP limits are shared by all visitors and one visitor can exhaust the budget for everyone. Recommendations:

- Rate limit the web routes (`/api/query`, `/chat/api`, `/api/share`, `/api/series-csv`) with Vercel Firewall rate limiting or WAF rules, per visitor IP.
- Size the API's nginx limits for shared IPs (they must allow the sum of Vercel's traffic, not one user's), or exempt the Vercel egress range from the heavy zones once the Vercel-side limits are in place.

`STATMESH_API_URL` form: `web/src/lib/client.ts` appends paths such as `/series/...` and `/search` directly to the base URL, and the chat route appends `/mcp`. Behind the nginx kit, `/` is the web app and the API lives under `/v1/` (prefix stripped), so use `https://host/v1`. Use `https://host` only when the API has its own hostname, with no web app behind it.

## Rollback

Vercel keeps every deployment. Dashboard > Deployments > pick the last good one > Promote to Production (or `vercel rollback` from a logged-in CLI). Env var changes are not rolled back with a deployment: revert them by hand and redeploy. If only the API is bad, roll back the API; the web app needs no change.

## Limits to know

- Chat streams long responses; check the plan's function max duration (Hobby is short). Raise `maxDuration` on `web/src/app/chat/api/route.ts` if answers are cut off.
- Series pages and `/chat/api` are `force-dynamic` by design; each request hits the API.
- Share links (`/a/<id>`) are stored by the API, not Vercel.
