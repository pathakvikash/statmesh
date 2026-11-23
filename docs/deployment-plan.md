# Deployment plan (long-term, solo owner)

How statmesh gets from a commit to a public site, how it is watched, how it is rolled back, and what
to harden over the next 90 days. This is the plan, not a how-to: step-by-step setup lives in
[hosted-free.md](hosted-free.md) (free stack), [vercel.md](vercel.md) (web) and
[hosted-runbook.md](hosted-runbook.md) (VM kit, the paid-tier fallback). Environment variables:
[configuration.md](configuration.md). Design and licence reasoning: [hosted.md](hosted.md).

Rules for this page: no secret values, no invented numbers. Anything not checked against a vendor's
current terms is marked **(unverified)**. Anything the repo does not do yet is marked **(not yet)**.

Principles, in order:

1. One person operates this. Every moving part must be explainable in a sentence and fixable from a phone.
2. The owner creates accounts, databases and secrets. Automation only uses what the owner put there.
3. A deploy is an immutable thing (image digest, Vercel deployment) you can point back at.
4. Data is rebuilt from public sources, so data loss is annoying, not fatal. Code and secrets are the real assets.
5. Free tier first; move to paid only for a measured reason (section 7).

## 1. Environments

| Environment | What it is for | URL | Who changes it |
|---|---|---|---|
| Local | Development, offline tests, trying a connector. `statmesh serve` on 8000, `npm run dev` in `web/` on 3000, demo data in `demo-data/`. | `http://127.0.0.1:8000`, `http://localhost:3000` | Owner, by hand |
| CI | Gate for every push to `main` and every PR (`.github/workflows/ci.yml`: ruff, pytest, fixture search eval, `statmesh bench`, then web tests/typecheck/lint/build). Offline, no secrets. | GitHub Actions tab | Owner, by editing the workflow file |
| Nightly smoke | Live-network connector tests (`smoke.yml`, 03:17 UTC). Uses source API keys as repo secrets. Opens one GitHub issue per failing source. Not a deploy gate. | GitHub Actions tab, Issues | Owner |
| Hosted web | Public anonymous UI. Vercel Hobby, Root Directory `web`, Node 22. Visitors bring their own model key for `/chat`. | the Vercel production URL (the owner's; set as `STATMESH_SITE_URL`) | Owner, by Vercel CLI today (section 2) |
| Hosted API | Public read-only mirror API (REST + MCP). Render free web service running the prebuilt image, `STATMESH_MODE=hosted`. | `https://<svc>.onrender.com`, no `/v1`, no trailing slash | Owner via `render.yaml`; image content by the `deploy-api` workflow |
| Image registry | Holds `ghcr.io/pathakvikash/statmesh-api` (tags: 12-char commit SHA and `latest`). Source of truth for what Render can run. | ghcr.io package page | `deploy-api` workflow only |
| Data store | The `data-latest` GitHub release asset `hosted-data.tar.gz`. Rebuilt weekly by `deploy-api`, baked into the image at `/srv/data`. | GitHub Releases | `deploy-api` workflow only |
| Hosted data refresh | The weekly schedule in `deploy-api.yml` (Sunday 03:17 UTC), plus manual dispatch (with a `fresh` option). | GitHub Actions tab | Owner |

There is no staging environment. Vercel Preview deployments are the staging for the web app; for the
API, a local run against the same image is the staging (`docker run` the `Dockerfile.hosted` build).
That is enough at this size. Add a second Render service only if a release ever breaks production
twice for reasons a preview would have caught.

## 2. Release flow, end to end

Status is as verified from the workflow files and docs on 2026-11-24.

1. **Commit to `main`** (or open a PR). Manual: the owner. Repo rule: nothing is committed, pushed or
   deployed unless the owner asks.
2. **CI gate** (`ci.yml`, jobs `test` and `web`). Automated on push to `main` and on PRs. A red CI blocks the next step
   for the API because `deploy-api` only reacts to a successful `ci` run.
3. **`deploy-api` starts.** Automated, three triggers: `workflow_run` after a successful `ci` on `main`;
   the weekly cron (Sunday 03:17 UTC); manual dispatch. **The weekly cron has not fired yet**
   (workflow on the default branch, first Sunday not reached). Treat the schedule as untested until
   the first run is seen green.
4. **Data refresh.** Automated inside `deploy-api`: restore `data-latest` (skipped when `fresh` is
   ticked or the asset is missing), `statmesh mirror --prune` (drops datasets whose licence is not
   `yes`; failed datasets only warn), fail if `hosted-data/catalog.sqlite` is missing, re-upload the
   tarball to `data-latest`.
5. **Image build and push.** Automated: builds the base image, then `Dockerfile.hosted`, tags
   `<sha12>` and `latest`, pushes both to ghcr, records the immutable digest. No layer cache.
6. **Render deploy hook.** Coded and automated *if* the secret exists. **Today the repo secret
   `RENDER_DEPLOY_HOOK_URL` is not set**, so this step logs a notice and exits 0: the image is pushed
   but Render is not told. Until the owner sets the secret, Render runs whatever image it last
   pulled (manual redeploy from the Render dashboard picks up `latest`).
   With the secret set, the hook is called with the digest, which restarts the service (a cold start).
7. **Render health check.** Automated by Render against `/healthz` (`render.yaml`). A failing check
   keeps the previous instance serving **(unverified: confirm Render's behaviour for free image
   services at first real deploy)**.
8. **Vercel deploy of `web/`.** Automated by `deploy-web.yml` (after a green `ci` on `main`, or manual
   dispatch) **only if** the repo secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` exist;
   otherwise it logs a notice and skips. Otherwise the owner runs the Vercel CLI (preview first, then
   production, per `vercel.md`). It then checks that `/` returns 200. The web app and API are decoupled: a
   web-only change does not need an API deploy, and an API-only change needs no Vercel deploy.
9. **Post-deploy check.** Automated in `deploy-api` when the repo variable `API_BASE_URL` and the Render
   hook secret are both set: it polls `/readyz` (8 minutes, backoff) until its `build` equals the
   deployed commit SHA, so the old instance cannot pass, then checks `/search?q=gdp`. Otherwise it is
   skipped; do the manual checklist in `vercel.md`. On any `deploy-api` failure a `deploy-failed` issue
   is opened or commented on.
10. **Dated data snapshots.** Automated: `deploy-api` adds a `data-snapshot-YYYYMMDD` prerelease (one per
   UTC day, add-only, never deleted by the pipeline).

Summary of what is automated: steps 2 to 5 and 7, plus 6 and 9 once their secret and variable are set, and 8 once the
Vercel secrets exist. Manual: step 1. Gap list in section 8.

Cadence guidance: web fixes ship when ready. API code ships when CI is green. Data ships weekly. Fork PRs cannot deploy: both deploy workflows require a `push`-triggered `ci` run from this repository. Do
not change cron to nightly until the Actions-minute use of a few weekly runs is known (section 5).

## 3. Secrets and config inventory

Names only. Values never go in the repo, in docs, in chat or in logs. "Rotates" means who replaces it.
Cadence: rotate on suspicion of leak, on any device loss, and at least yearly **(owner policy, not a vendor rule)**.

### GitHub repository secrets

| Name | Used by | Lives in | Rotates |
|---|---|---|---|
| `RENDER_DEPLOY_HOOK_URL` | `deploy-api` (calls Render). **Not set yet.** | GitHub secret; origin is the Render service's Deploy Hook (a URL that is itself a credential) | Owner: regenerate the hook in Render, update the secret |
| `STATMESH_CONTACT_EMAIL` | `smoke` (User-Agent for polite fetching) | GitHub secret | Owner |
| `FRED_API_KEY`, `DATAGOVIN_API_KEY`, `COMTRADE_API_KEY`, `BLS_API_KEY`, `CENSUS_API_KEY`, `BEA_API_KEY`, `EIA_API_KEY`, `DATACOMMONS_API_KEY`, `COMPANIES_HOUSE_API_KEY` | `smoke` live tests | GitHub secrets; issued by each source | Owner, at each source's portal |
| `GITHUB_TOKEN` (automatic) | release upload, ghcr push, issue creation | Issued per run by GitHub, scoped by each workflow's `permissions` | Nobody; it expires after each run |

### Planned additions (not yet created; the owner creates them)

| Name | Kind | For | Lives in | Rotates |
|---|---|---|---|---|
| `VERCEL_TOKEN` | secret | A future `deploy-web` workflow or any non-interactive Vercel CLI use | GitHub secret; created in Vercel account settings | Owner |
| `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | not secret but keep out of docs | Pair with the token so the CLI targets the right project | GitHub secrets (or variables) | Change only if the project is recreated |
| `API_BASE_URL` | repository **variable** (not secret) | Public API origin for post-deploy and uptime smoke checks, so the URL lives in one place | GitHub Actions variable | Owner, when the hostname changes |

Until the Vercel secrets are created, the CLI runs from the owner's logged-in machine.
`deploy-web.yml` uses them once created (it skips with a notice until then). `API_BASE_URL` is read by the `deploy-api` post-deploy check.

### Render service environment

Set by `render.yaml` unless noted. Defaults and meanings: [configuration.md](configuration.md).

| Name | Set by | Notes |
|---|---|---|
| `STATMESH_MODE=hosted`, `STATMESH_DATA_DIR=/srv/data`, `STATMESH_DUCKDB_MEMORY`, `STATMESH_SHARES`, `STATMESH_DISABLE`, `STATMESH_SQL_MAX_BYTES`, `STATMESH_EXPORT_MAX_ROWS` | `render.yaml` | Change in git, not in the dashboard, so the file stays the record |
| `STATMESH_ALLOWED_HOSTS` | Owner, once, at first Blueprint apply | Must include the `onrender.com` host and any custom domain, else the API answers 421 |
| `STATMESH_PUBLIC_URL` | Owner, optional | Public origin of the API |
| Registry credential (private ghcr only) | Owner, Render account settings | A GitHub PAT with `read:packages`. Not needed while the package is public |

Other `STATMESH_*` variables (`STATMESH_SQL_TIMEOUT_S`, `STATMESH_SQL_MAX_ROWS`, `STATMESH_CACHE_MAX_AGE`,
`STATMESH_SHARE_TTL_DAYS`, and so on) keep their documented defaults in hosted mode; change one only
with a reason written next to the change.

### Vercel project environment

| Name | Notes |
|---|---|
| `STATMESH_MODE` | Set to `hosted` explicitly |
| `STATMESH_API_URL` | The Render origin; the one value to update if the API moves |
| `STATMESH_SITE_URL` | The Vercel production origin (sitemap, robots, share links) |
| `STATMESH_ALLOW_SERVER_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | **Leave unset.** Setting them lets any visitor spend the owner's key |

Env var changes on Vercel need a redeploy and are not undone by a rollback (section 4).

### Hygiene rules

- Anything the owner pastes into a chat, ticket or log is considered leaked: rotate it.
- The deploy hook URL and the PAT are credentials even though they look like plain strings.
- Keep a private list (password manager) of which accounts exist: GitHub, Render, Vercel, ghcr, each data-source key. The repo should never be the only place that says an account exists.
- Two-factor on GitHub, Render and Vercel. Recovery codes stored offline.

## 4. Rollback, RTO and RPO

Each component rolls back on its own. Decide first which component is bad.

| Component | Symptom | Rollback | Time to do it |
|---|---|---|---|
| API image (Render) | API errors after a deploy, wrong or empty data | Redeploy a previous image **by digest**. Find a good digest in the `deploy-api` run log ("Render deploy triggered for ghcr.io/...@sha256:...") or from the ghcr package tags (12-char commit SHA). Then call the deploy hook with `imgURL=<previous digest>` or set the image in the Render dashboard and Manual Deploy. Do not use `latest` to roll back: it moves. | Minutes, plus a cold start |
| Web (Vercel) | Broken page, bad build | Dashboard > Deployments > last good one > Promote to Production, or `vercel rollback` from a logged-in CLI. | Minutes |
| Web env vars | Wrong API URL after a change | Revert the variable by hand and redeploy. A rollback does not restore env values. | Minutes |
| Data | Bad mirror shipped (corrupt, missing datasets) | Restore a previous `data-latest` snapshot. Caveat: the workflow re-uploads with `--clobber`, so there is only one live asset at a time and an older one is not kept there. Dated copies exist as add-only `data-snapshot-YYYYMMDD` prereleases (one per UTC day), so restore from the newest good snapshot; the previous image digest (it carries the old data) or a `fresh` rebuild also work. Previously the only recovery was the image digest (it carries the old data inside) or a `fresh` rebuild. | An old image: minutes. A `fresh` rebuild: up to the workflow timeout (120 min) |
| Licence takedown | A source must disappear now | Not a rollback: disable the source, run `deploy-api` with `fresh` ticked, delete old ghcr images. See the checklist in `hosted-free.md`. | Hours |
| Workflow or CI change | A bad edit to a workflow | `git revert` the commit. Nothing else holds state. | Minutes |

The VM kit (`hosted-runbook.md`) has its own backup and restore section; it applies only if the API
moves to a VM.

### RTO and RPO in plain words

- **RTO (how long until it is back).** For a bad web deploy, minutes (promote the old deployment). For a bad API
  deploy, minutes plus a cold start of about a minute **(unverified)**. For a lost or corrupted data
  set, up to a couple of hours, the length of a full mirror build. For "Render is gone": about a day,
  since it means a new service from `render.yaml` (owner action), or the VM kit.
- **RPO (how much you can lose).** Code: nothing, it is in git (keep the remote healthy). Data: up to one
  week of refresh, because that is the cadence, and anything the pipeline did not keep an old copy of.
  User state: none exists. Share links are off (`STATMESH_SHARES=0`), there are no accounts, and
  visitors' model keys go to their own provider. This is why the free stack is acceptable now. It
  changes the day boards or shares need a shared database (section 7).
- These are targets for one person with a phone and a laptop, not promises to users. The public site
  has no uptime commitment.

## 5. Known limits of the free stack

Numbers are as documented in this repo; vendor figures drift, so re-check each when you sign up or
upgrade and update this table with the date checked.

| Limit | What happens | Status |
|---|---|---|
| Render free sleeps after idle (docs say 15 min) | First request after sleep waits for a wake (docs say about a minute); the web app may show "Cannot reach the statmesh API" until it answers | Numbers **unverified** |
| Render free memory (about 512 MB) | The service is configured with `STATMESH_DUCKDB_MEMORY=256MB` to stay inside it; a large SQL query fails with an error rather than taking the service down | 512 MB **unverified** |
| SQL statement timeout | 20 s per query (`STATMESH_SQL_TIMEOUT_S` default) | Verified in `configuration.md`. A long CSV export may need more; the nginx kit allows 600 s for it, Render's own request limits are **unverified** |
| Render ephemeral disk | Nothing written at runtime matters; a large DuckDB spill can fail a query | Disk size **unverified** |
| Render free monthly hours and spin-up rules | May cap always-on use; no keep-warm pinger is used on purpose | **Unverified** |
| Vercel Hobby | Short function max duration (may cut long `/chat` answers; raise `maxDuration` on `web/src/app/chat/api/route.ts` if needed), personal and non-commercial use, usage caps, firewall rate-limit availability | All figures and terms **unverified**; read the current Hobby terms before relying on it |
| No per-IP rate limiting at Render | All visitors reach the API from Vercel's egress IPs, so one visitor can use up the shared budget; add Vercel Firewall limits on the web routes (see `vercel.md`) | Verified by design; the firewall limits are **not yet** configured |
| GitHub Actions minutes | **Every green `ci` on `main` triggers the full mirror (up to 120 min), not just the weekly cron.** To limit this, switch `deploy-api` to schedule and manual only by removing its `workflow_run` trigger (see the commented note in the workflow). Private repo on the Free plan has a monthly allowance (docs say about 2000 min; check current terms). A full mirror plus two docker builds can be a large share; weekly cron is chosen for this. Public repos have free standard-runner minutes | Allowance **unverified**; real per-run minutes **not yet measured** |
| ghcr storage | Old images pile up under every deploy | Quota **unverified**; prune old tags on a schedule (section 8) |
| Data size | The mirror is baked into every image and must fit the image, the Render pull and `data-latest` asset limits | Limits **unverified**; record the tarball size after each run |
| Known bug: OpenAPI `servers` | On Render the API serves at `/` but `hosted_api_base()` returns `<origin>/v1`, so the advertised server URL is wrong by `/v1` (affects the ChatGPT Action URL) | Verified in `hosted-free.md`; needs a `src/` change |

Rule: measure before believing a vendor number. After the first month, replace each **unverified**
above with what you observed.

## 6. Monitoring and alerts

Keep it small. Four signals, one alert path.

| Signal | How | Alert |
|---|---|---|
| Uptime | An external free uptime monitor hitting the API `/healthz` and the web home page every few minutes. Do **not** use it as a keep-warm trick: either accept sleep and set the monitor's alert delay long enough to cover a cold start, or pay for an always-on plan (section 7). | Email or push from the monitor. Note it will flap on a sleeping free service **(this is the main reason to expect noise, not a bug)** |
| Liveness vs readiness | `/healthz` says the process is up. `/readyz` (in `src/statmesh/api/ops.py`, wired in `app.py`) says the catalog opens and has sources, and reports the deployed `build` commit. Use `/healthz` for Render's health check and `/readyz` for post-deploy and nightly checks | Failure of `/readyz` after a deploy means roll back (section 4) |
| Request logs | Structured JSON request logs from the API (`ops.py`): method, path without query, status, duration. No headers, no query strings, no personal data beyond IP if logged at all; state retention in the privacy note | Read in the Render log viewer when investigating; no log shipping needed at this scale |
| Nightly smoke | `smoke.yml` runs live source tests nightly and opens or updates one issue per failing source, and closes it when green. The post-deploy check in `deploy-api` already calls `API_BASE_URL` `/readyz` and `/search?q=gdp` after each deploy; the nightly smoke could reuse it | GitHub issue, which emails the owner via normal GitHub notifications |
| Pipeline | Failure of `ci` or `deploy-api` | GitHub's own failure email to the owner. `deploy-api` opens or updates a `deploy-failed` issue on failure, so a silent weekly failure leaves a visible record |

Alert path, in order: GitHub issue (smoke, and `deploy-api` via the `deploy-failed` label) and GitHub failure emails; uptime
monitor email. One person, one inbox. Nothing pages at night. The owner checks the Issues tab and
the Actions tab once a week, on the Sunday-night refresh.

What to look at weekly (5 minutes): last `deploy-api` run green and its minutes, size of `data-latest`,
open smoke issues, `stale_datasets` in `/sources`, Render and Vercel dashboards for usage banners.

## 7. Cost and upgrade path

Today's cost target: USD 0. Free vendor terms change, so treat "free" as **unverified** until you
have the current plan pages in front of you.

Move to paid for a reason you can name, one at a time, in this order:

| Trigger | Evidence to collect first | Likely move |
|---|---|---|
| Cold starts annoy real users | Uptime monitor shows long first responses; users say so | Render paid instance that does not sleep (price **unverified**, check the pricing page) |
| Out-of-memory or query failures | Render shows the instance restarting, or users hit memory errors on normal queries | Larger Render instance, then raise `STATMESH_DUCKDB_MEMORY` in `render.yaml` |
| Data too big for the image or the pull is slow | Tarball size and deploy time are growing | Keep data outside the image (object storage or a persistent disk) and mount or fetch it at start. Larger change; plan it before it is urgent |
| Actions minutes run out | Monthly usage in GitHub billing | Make the repo public (if licence and secrets review allows), or keep weekly cadence, or a paid plan |
| Vercel Hobby limits bite (function duration, personal-use terms, traffic) | A deploy or usage warning | Vercel Pro. Hobby is non-commercial **(verify terms)**; any monetisation means upgrading |
| Boards or share links need to persist across deploys and sleeps | The decision to turn on `STATMESH_SHARES` and user boards | A shared database (below). The ephemeral Render filesystem cannot hold it |

### The database question

The mirror data is read-only and rebuilt weekly, so it does not need a database. Boards and shares
do, because they are written by users and must survive restarts. The earlier product review favoured
**Turso (hosted SQLite)** for this since the code already uses SQLite for shares and the catalog. Its
free-plan limits, pricing and regional behaviour are **unverified**: check the current pricing page
before committing. Alternatives to compare at that time: a small managed Postgres, or a persistent
disk on a paid Render instance holding the existing `shares.sqlite`.

Rule: the owner creates the database account and database and puts the connection secret into
Render and GitHub by hand. Automation never creates a database, an account or a billing relationship.
Write the new secret names into section 3 on the day they are created.

Before turning on shares or boards publicly: shares hold user-supplied numbers (see the takedown notes in
`hosted-runbook.md`), so a retention rule, a purge procedure and a rate limit must exist first.

## 8. 30-60-90 day hardening checklist

Order is by risk removed per hour of work. Dates run from the day this plan is adopted.

### First 30 days: close the manual gaps

- [ ] Run `deploy-api` by hand once; confirm the image appears in ghcr and the package visibility is as intended
- [ ] Create the Render service from `render.yaml`; set `STATMESH_ALLOWED_HOSTS`
- [ ] Create the Render deploy hook and set the repo secret `RENDER_DEPLOY_HOOK_URL`; run `deploy-api` again and watch the hook step actually fire
- [ ] Confirm the weekly cron fires on its first Sunday and note its real duration and Actions minutes
- [ ] Verify (and update section 5) the Render sleep time, cold start, memory and disk numbers; and the Vercel Hobby limits, by reading the plan pages
- [x] `/readyz` and structured request logs exist (`ops.py`); point Render at `/healthz`, post-deploy checks at `/readyz`
- [ ] Set up an external uptime monitor and decide its alert delay for sleep
- [ ] Add Vercel Firewall rate limits on `/api/query`, `/chat/api`, `/api/share`, `/api/series-csv`
- [ ] Write the private account list (GitHub, Render, Vercel, ghcr, each source key) and enable two-factor on all of them
- [ ] Do one rehearsed rollback of each component (Render digest, Vercel promote) and record the time it really took

### Days 31 to 60: automate and keep history

- [x] Failure-issue step in `deploy-api` (`deploy-failed` label)
- [x] Dated copies exist (`data-snapshot-YYYYMMDD`, add-only; prune by hand). Still open: a prune policy. Purpose: so a bad mirror has a real restore point; update the data row in section 4
- [ ] Add a scheduled prune of old ghcr tags, keeping the last N digests plus any pinned as known good
- [ ] Decide whether Vercel deploys stay manual or move to a `deploy-web` workflow; if automating, create `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (owner creates them) and set `API_BASE_URL`
- [x] Post-deploy smoke exists in `deploy-api`; it needs the repo variable `API_BASE_URL` and the Render hook secret to run
- [ ] Fix the OpenAPI `servers` URL on Render (the `/v1` bug) so the ChatGPT Action URL is right
- [ ] Review Actions minutes for the month; decide cron cadence (weekly or nightly) from evidence
- [ ] Re-run the licence checklist in `hosted-free.md` and record the date and the person

### Days 61 to 90: decide on growth

- [ ] Review the evidence for each trigger in section 7; pick at most one upgrade or write down why not
- [ ] If boards or shares are wanted: compare Turso with the alternatives on current pricing and limits, then the owner creates the database; add the secret names to section 3
- [ ] Decide whether the free stack stays: record cost per month, number of incidents, number of cold-start complaints
- [ ] Rotate every secret that is more than a year old or was ever pasted anywhere (section 3)
- [ ] Do a full disaster drill: pretend Render is gone and rebuild the API from `render.yaml` and the last image; note the real time and update the RTO in section 4
- [ ] Revisit this document: delete what is no longer true, replace each **unverified** with a measured value and a date

## Open facts to confirm (owner)

1. Does the Vercel project use git auto-deploy or CLI only? This plan says CLI only; if the dashboard shows a connected repo, section 2 step 8 is partly automated.
2. Is the ghcr package public or private? Decides whether a Render registry credential is needed.
3. Is the repository public or private? Decides the Actions minutes budget and whether `data-latest` is world-readable.
