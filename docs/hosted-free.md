# Free-tier hosted stack

(`docs/hosted-runbook.md` already documents the VM + nginx kit, so this is a separate page.)
Public, anonymous, read-only mirror of `redistribute: yes` sources at USD 0. Design: `docs/hosted.md`.

## Architecture

- **Web**: `web/` on Vercel Hobby (Root Directory `web`, Node 22). Details: `docs/vercel.md`.
- **API**: Render free web service from the prebuilt image `ghcr.io/<owner>/statmesh-api` (`Dockerfile.hosted`, blueprint `render.yaml`). The mirror data is baked in at `/srv/data`; the filesystem is ephemeral and nothing is written that matters.
- **Pipeline**: `.github/workflows/deploy-api.yml` runs weekly (Sunday 03:17 UTC; nightly is a one-line cron change), on manual dispatch, and after a successful `ci` run on `main` (`workflow_run`, so untested commits are not deployed). It restores the `data-latest` release asset, runs `statmesh mirror` (which prunes datasets whose licence is not `yes`), fails if `hosted-data/catalog.sqlite` is missing, re-uploads it, builds and pushes the image, then calls the Render deploy hook with the image digest.
- The API has its own hostname and no nginx: `STATMESH_API_URL` is the bare origin. `web/src/lib/client.ts` appends paths like `/search` itself, the chat route appends `/mcp`, and the API serves at `/`. So `https://<svc>.onrender.com`, no `/v1`, no trailing slash (a trailing slash is stripped anyway).

## Environment variables

Vercel (Production, plus Preview if wanted):

| Name | Value |
|---|---|
| `STATMESH_MODE` | `hosted` |
| `STATMESH_API_URL` | `https://<svc>.onrender.com` |
| `STATMESH_SITE_URL` | public origin of the Vercel site |

Leave `STATMESH_ALLOW_SERVER_KEY`, `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` unset: visitors bring their own key to `/chat`.

Render: all set by `render.yaml` or the image (`STATMESH_MODE=hosted`, `STATMESH_DATA_DIR=/srv/data`, `STATMESH_DUCKDB_MEMORY=256MB`, `STATMESH_SHARES=0`, `STATMESH_DISABLE=sec_edgar`, `STATMESH_SQL_MAX_BYTES=10000000`, `STATMESH_EXPORT_MAX_ROWS=100000`). You supply `STATMESH_ALLOWED_HOSTS=<svc>.onrender.com` (the API answers 421 to any other Host; add a custom domain here too). Optional: `STATMESH_PUBLIC_URL`.

GitHub repo secret: `RENDER_DEPLOY_HOOK_URL` (without it the workflow pushes the image and skips Render).

## Owner-only steps

1. Sign up for Render and Vercel (free with no card: unverified, check at sign-up).
2. Make the ghcr package public after the first workflow run (Packages > statmesh-api > settings), or keep it private and create a Render registry credential from a PAT with `read:packages`, then reference it in `render.yaml` (`image.creds.fromRegistryCreds.name`). The image owner in `render.yaml` is already `pathakvikash` (lowercase; Blueprint fields cannot be filled in the Render UI).
3. Run `deploy-api` once by hand (Actions > deploy-api > Run workflow) so the image exists.
4. Render: New > Blueprint, pick this repo, fill `STATMESH_ALLOWED_HOSTS` only. Copy the service's Deploy Hook URL into the GitHub secret `RENDER_DEPLOY_HOOK_URL`.
5. Vercel: Import the repo, Root Directory `web`, Node 22.x, set the three variables above, deploy a Preview, follow the checklist in `docs/vercel.md`.

## Actions minutes

On a PRIVATE repo, GitHub Free gives about 2000 Actions minutes per month (check current terms). A full mirror plus two docker builds can take a large share of that if run nightly, which is why the default cron is weekly. Public repos have free standard-runner minutes. No docker layer cache is configured: plain `docker build` keeps the digest extraction simple, and `type=gha` caching would need `docker/build-push-action`.

## Cold starts

Render's free service sleeps after 15 idle minutes (unverified, check at sign-up). The next request waits about a minute while it wakes (also unverified), and the web app may show "Cannot reach the statmesh API" until it answers; a reload works. Do not add a keep-warm pinger (it burns the free hours and Actions minutes). Deploys by digest from a workflow run restart the service, which is also a cold start.

## What degrades gracefully

- API asleep or down: pages show a message; home and sources lists are cached for 300 s.
- Data is as old as the last workflow run; a failed mirror run ships the previous data.
- Share links are off (`STATMESH_SHARES=0`), on-demand fetch and the Python sandbox are off in hosted mode, `sec_edgar` is disabled.
- The 256 MB DuckDB limit makes very large SQL queries fail with an error, not take the service down. Spill-to-disk temp files go under the working directory `/srv/data`, which the non-root user owns; the free tier's disk is ephemeral and small, so a very large spill can still fail the query.
- Render free has no per-IP rate limiting: add Vercel Firewall limits on the web routes (see `docs/vercel.md`).

## Known gap: OpenAPI `servers`

`hosted_api_base()` in `src/statmesh/api/app.py` returns `<origin>/v1`, which is right only behind the nginx kit. On Render the API serves at `/`, so `servers[0].url` (and the ChatGPT Action URL) is wrong by `/v1`. Fix needs a settings-driven change in `src/`: not done here.

## Licence checklist (a person confirms, before launch)

- Every `yes` manifest matches the live licence page (`docs/hosted.md`, "Legal review checklist"); decide on IMF, OECD, WHO; confirm MoSPI's Hindi page.
- Every response carries `citations[]`; the UI shows source and licence; no source logos.
- BIS terms forbid charging users: the mirror must stay free.
- Takedown contact published and owned. A takedown means disabling the source, then running the workflow by hand with `fresh` ticked (Run workflow > fresh). Use `fresh` whenever a licence drops from `yes`: the workflow runs `statmesh mirror --prune`, which removes non-`yes` datasets, but restoring the old `data-latest` first would start from data that included them, so `fresh` rebuilds from nothing and replaces the asset. Old images must still be deleted from ghcr.
- The image holds only `yes` data; never build it from `demo-data/`. The `data-latest` release is public if the repo is public.
