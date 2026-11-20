# Web app (`web/`)

Next.js 16 (App Router, `output: "standalone"`), React 19, Tailwind 4, Recharts, CodeMirror (SQL
editor), cmdk (command palette), Vercel AI SDK (`ai`, `@ai-sdk/mcp`, `@ai-sdk/anthropic`,
`@ai-sdk/openai-compatible`), zod. Package name `statmesh-web`. **Read `web/AGENTS.md` first**: this
Next.js has breaking changes; read the guides in `web/node_modules/next/dist/docs/` before writing
code.

## How the web finds the API

The browser never calls the Python API. Server components and route handlers call it through
`web/src/lib/client.ts`, which reads `STATMESH_API_URL` at request time (default
`http://localhost:8000`, no trailing slash). The chat route connects an MCP client to
`<STATMESH_API_URL>/mcp`. Browser code reaches the API only through same-origin routes
(`/api/query`, `/api/series-csv`, `/api/share`, `/api/palette`, `/api/ondemand`, `/chat/api`). If
the API is down, pages show "Cannot reach the statmesh API" (`ApiError` 502). The API must list the
web's view of its own hostname in `STATMESH_ALLOWED_HOSTS` (compose uses `api:*`).

Types: `src/lib/api-types.ts` is generated from `web/openapi.json` (`npm run gen:types`). A few
shapes the OpenAPI schema lacks (observations result, `/sources`) are written by hand in
`client.ts`. The API's `/schema` route backs the SQL schema browser; `sql-schema-fallback.ts` is a
bundled copy used if the API does not serve it (keep it in step with `docs/data-model.md`).

## Routes (`web/src/app`)

| Route | What it does |
|---|---|
| `/` | Home: featured series, latest updates, browse by source (5 min cache via `unstable_cache`). Old `/?q=` links redirect to `/search` |
| `/search` | Search with filters (source, geo, freq, topic); result cards with sparkline and latest value; with nothing typed it lists topics and sources to browse |
| `/series/[...id]` | Series detail: chart chosen by series shape, range presets (1Y/5Y/10Y/Max), dimension selects, geo explorer (ranked bars, multi-line), **Compare** (`?compare=a,b,c`, `?geo=IND,USA`), table (first 200 rows), citations, CSV download, related series, copy SQL |
| `/sources` | Sources with key status, licence, dataset and series counts, staleness |
| `/sql` | SQL workbench: CodeMirror editor, schema browser, templates, results table and chart, CSV export, "Ask" (self-host only, writes one SELECT from a question with the user's own key) |
| `/chat` | Chat with the user's own LLM key (Anthropic, OpenAI-compatible, Ollama) over the API's MCP tools; charts, tool-call rows, voice input, share button, scope bar (sources, geos, years) |
| AI sidebar | Slide-over `AssistantPanel` mounted in the root layout: the same `ChatPanel` in compact mode, with the current page as context |
| `/a/[id]` | Public read-only shared answer (`noindex`, immutable cache header, "numbers come from the sharer's session" banner) |
| `sitemap.xml`, `robots.txt` | Use `STATMESH_SITE_URL` |
| `/api/query` | Proxy to API `POST /query` |
| `/api/series-csv?id=` | Streams API `observations.csv` unbuffered, keeps attribution and row-cap headers |
| `/api/share` | Proxy to API `POST /shares` |
| `/api/palette?q=` | Top 8 series for the command palette (Cmd/Ctrl+K) |
| `/api/ondemand` | POST `{id}`: one live fetch of a 3-part series key (max 4 in flight, 429 beyond). 403 when hosted |
| `/chat/api` | Streaming chat: builds the model from the request's provider config, connects MCP, adds a `show_chart` tool, streams events. `maxDuration = 60` |
| `/chat/models` | POST lists a provider's models; GET reports only whether a server key exists |
| `/sql/ask` | Self-host only (404 when hosted) |

## `web/src/lib` modules

- `client.ts`: API client and types; `apiFetch`, `describe`, `observations`, `search`, `triggerLive`.
- `mode.ts`: `isHosted()` (`STATMESH_MODE=hosted`, or a Vercel deployment when unset) and `siteUrl()`.
- `data.ts`: server-side data helpers over the SQL endpoint (home featured/updates, geo latest, hit
  stats, `seriesShape`, source list, geo names).
- `shape.ts` (pure): the series **shape model**. `Shape` = rows, geos, periods (n, first, last),
  freqs, dims, units, status. `chooseView` picks `empty | value | ranked | line | multi-line`;
  `chooseFreq`/`chooseDims`/`dominantCombo` choose a default frequency and dimension values;
  `emptyReason` explains an empty series. The page renders from the shape, not from the source.
- `range.ts` (pure): preset windows. A window is exclusive at its start; a preset is available only
  when the data reaches back past `from` and the window holds at least 2 points.
- `compare.ts` (pure): `compare=` and `geo=` URL parsing (3-part ids only, max 3 extra series, max 4
  geos), default shared geos (World first, then highest values), axis rules, indexing, annual
  alignment, overlap, CSV. `multigeo.ts`: 3-part-key helpers (`isMultiGeoKey`, `isRegion`,
  `keyMatchSql`, medians, headline). `multigeo`/`compare` have no server imports.
- `params.ts`: search/filter URL parameters. `format.ts`: period, unit, frequency, citation labels.
  `obs.ts`: chart building. `dimension-labels.ts`: readable names for dimension keys.
  `ui.ts`: shared class strings. `sql*.ts`: SQL literal quoting, CSV, templates, schema loading,
  error text, chart-from-SQL, local store of recent queries.
- `ai-context.ts`: `PageContext` (series, search, sql, sources, home): a few plain strings (max 2000
  chars) describing what the user is looking at. Never settings, keys or cookies. Parsed with zod
  on the server.
- `chat/`: `providers.ts` (presets, `serverKeyFor`, `withServerKey`, `validateConfig`, `buildModel`),
  `host-check.ts` (SSRF guard), `prompt.ts` (system prompt and page-context paragraph),
  `scope.ts` (zod scope: sources, geos, start, end), `chart.ts` (`show_chart` tool),
  `events.ts` (NDJSON chat events), `evidence.ts`, `tool-summary.ts`, `errors.ts`, `model-list.ts`,
  `flag.ts`, `share.ts`, `speech.ts`/`useSpeech.ts`, `merge.ts`, `text-runs.ts`.

## Hosted-mode behaviour (`STATMESH_MODE=hosted`)

`isHosted()` is true on any public deployment (also automatically on Vercel when `STATMESH_MODE` is
unset). When hosted:

- `/api/ondemand` returns 403; series pages never trigger a live fetch; `/sql/ask` is 404.
- `/chat/api` uses only the visitor's own key. The server's `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`
  are used only when `STATMESH_ALLOW_SERVER_KEY=1`, and only for the provider's own default URL
  (a custom base URL would otherwise receive the server key). Keys are never returned to the
  browser, logged, or left in error text.
- `host-check.ts` refuses LLM base URLs that resolve to loopback, private, link-local or cloud
  metadata addresses (it classifies every address after DNS resolution; a rebinding window remains
  between check and fetch). Self-hosted may use `localhost` (Ollama).
- The Python API must run `STATMESH_MODE=hosted` too; the web setting only controls the web's own
  features.

## Env vars (web)

`STATMESH_API_URL`, `STATMESH_SITE_URL`, `STATMESH_MODE`, `STATMESH_ALLOW_SERVER_KEY`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (names and placeholders in `web/.env.example`; details in
[../vercel.md](../vercel.md)). `VERCEL` and `NODE_ENV` are read from the platform.

## Build and run

```sh
cd web && npm install
STATMESH_API_URL=http://127.0.0.1:8000 npm run dev     # http://localhost:3000
npm run build && node .next/standalone/server.js        # production; `next start` does not work with output: standalone
```

Docker: `web/Dockerfile` (Node 22 alpine, standalone output); compose profile `web`. Vercel: Root
Directory `web`, Node 22.x (see [../vercel.md](../vercel.md)). In some sandboxes Turbopack panics
during `next build`; see [status-and-gaps.md](status-and-gaps.md) for the webpack workaround.

## Tests

Vitest, config `web/vitest.config.ts` (`include: src/**/*.test.ts`, node environment, so no
component tests). Tests sit next to the code: `src/lib/*.test.ts` (shape, range, compare, multigeo,
params, format, obs, data, dimension-labels, sql, ai-context), `src/lib/chat/*.test.ts` (chart,
events, providers, host-check, scope, prompt, model-list, flag, share, speech, tool-summary, errors,
evidence, text-runs), `src/app/api/series-csv/route.test.ts`. Commands from `web/`: `npm test`,
`npm run typecheck` (`tsc --noEmit`), `npm run lint` (eslint). The chat page is tested with a stubbed
LLM only. `web/.vitest/` is generated output and should be git-ignored.
