# Documentation index

Start with the project [README](../README.md). AI agents: read
[ai-context/00-START-HERE.md](ai-context/00-START-HERE.md) first.

## For AI agents (`ai-context/`)

- [ai-context/00-START-HERE.md](ai-context/00-START-HERE.md): one-page orientation, how to run and test, the ten rules, where things live.
- [ai-context/architecture.md](ai-context/architecture.md): data flow from connector to surfaces, the manifest and per-series `cut`, catalog schema, query engine views, search and rerank, hosted vs self-hosted.
- [ai-context/web.md](ai-context/web.md): the Next.js app: routes, lib modules, how it finds the API, hosted-mode behaviour, tests.
- [ai-context/decisions.md](ai-context/decisions.md): dated decision log with the reasons.
- [ai-context/status-and-gaps.md](ai-context/status-and-gaps.md): what is done, known weak spots, what only the owner can do.
- [ai-context/runbook.md](ai-context/runbook.md): exact commands and a troubleshooting table.

## Using and running statmesh

- [architecture.md](architecture.md): layers, main flows, processes and concurrency.
- [data-model.md](data-model.md): ids, the observations table, entities, harmonisation rules, catalog, storage layout.
- [query-surfaces.md](query-surfaces.md): SQL, REST, MCP, Python SDK and CLI, with limits and errors.
- [configuration.md](configuration.md): every environment variable and API key.
- [self-hosting.md](self-hosting.md): docker compose, the worker, the web UI, backups.
- [ai-apps.md](ai-apps.md): set up Claude Desktop, Claude Code and ChatGPT.
- [sandbox.md](sandbox.md): the opt-in Python sandbox and its risks.
- [sharing.md](sharing.md): shareable answer links.
- [llms.txt](llms.txt): the agent guide the API serves at `/llms.txt`.
- [benchmark.md](benchmark.md): the 200-question benchmark, hold-out sets, scoring rules.

## Hosting

- [hosted.md](hosted.md): design of the public read-only mirror and the licence review checklist.
- [hosted-runbook.md](hosted-runbook.md): deploying and operating the mirror.
- [hosted-free.md](hosted-free.md): the USD 0 stack: Vercel web, Render API from a ghcr image, nightly GitHub Actions mirror.
- [vercel.md](vercel.md): deploying only the web app to Vercel, with the API elsewhere.
- [licensing.md](licensing.md): licence metadata, hosted mode, attribution, source etiquette.

## Contributing

- [connectors.md](connectors.md): connector SDK guide, manifest reference, `mapping.yaml`, fixtures.
- [first-connector.md](first-connector.md): scaffold and test a connector in 30 minutes.
- [good-first-sources.md](good-first-sources.md): ready-to-file starter issues.
- [recipes/gbd-import.md](recipes/gbd-import.md): import an IHME GBD download you obtained yourself.
- [../CONTRIBUTING.md](../CONTRIBUTING.md), [../CHANGELOG.md](../CHANGELOG.md), [../SECURITY.md](../SECURITY.md), [../GOVERNANCE.md](../GOVERNANCE.md), [../CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).

## Planning and history

- [PRODUCT.md](PRODUCT.md): product thesis, audience, roadmap, what needs the owner.
- [DECISIONS.md](DECISIONS.md): early numbered decisions that override the plan.
- [PLAN.md](PLAN.md): the original build plan (historical; DECISIONS.md wins where they differ).
- [SPEC.txt](SPEC.txt): the original spec.
- [M2_PLAN.md](M2_PLAN.md), [M3_PLAN.md](M3_PLAN.md): the M2 and M3 implementation plans.
- [W0_NOTES.md](W0_NOTES.md): notes on contracts the first build wave added or changed.
- [pilots/](pilots/README.md): pilot briefs, feedback form, demo script (drafts, not sent).
- [funding/](funding/one-pager.md): funding drafts, marked DRAFT, NOT SENT.
