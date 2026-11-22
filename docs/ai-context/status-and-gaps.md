# Status and gaps

State as of 2026-11-20. Version 0.4.0 in `pyproject.toml`; git tags exist for v0.1.0 and v0.2.0 only;
nothing is published to PyPI; nothing is deployed. Work after v0.4.0 (series shapes, compare, AI
sidebar, per-series `partial`, search changes) is in the tree and is listed under "Unreleased" in
`CHANGELOG.md`.

## What exists

- 33 connector folders; 14 core datasets would be ingested by `statmesh mirror` (8 more skipped as
  `review`). REST, SQL, MCP, Python SDK, CLI; opt-in sandboxed Python.
- Web UI: home, search, series detail with Compare, sources, SQL workbench, chat, AI sidebar, share links.
- Hosted-mirror deploy kit (`deploy/hosted/`), written and unit-tested, never run on a Docker daemon.
- Benchmark: 200 questions on the fixture catalog. Main score 0.895 on all four metrics (threshold
  0.80; Population topic 0.909). Blind hold-out `evals/holdout2.yaml`: recall@5 0.667, answerable 0.500,
  cited 0.533, answer rate 0.500. The honest blind score is the 0.50. The older `evals/holdout.yaml`
  (0.867) was seen during tuning. `evals/results/results.json` and `REPORT.md` may be older than the
  last code change: re-run `uv run statmesh bench` and read the number it prints.
- Checks that passed on 2026-11-20 are listed in the README's "What has been run" table; anything
  not in that table has not been run.

## Known weak spots

| Area | What is wrong | Where to look |
|---|---|---|
| EIA state-level series | Questions that need a US state's energy series are answered poorly (Energy is the weakest benchmark topic, 0.60 at the last recorded run), and the `eia` fixtures are synthetic. The generation series titles were just reworded (uncommitted) to name fuel and unit. | `connectors/eia/manifest.yaml`, `connectors/eia/tests/test_titles.py` |
| Central-bank and rate vocabulary | Rate questions ("policy rate", "central bank rate", "interest rate") miss series whose titles use other words; the synonym file does not link them all. | `data/synonyms.yaml`, Q4 in the README |
| Meaning-phrased questions | Questions that describe a concept instead of naming it ("how many babies die before five") only match when a synonym exists. No embeddings by design. | `search/search.py`, holdout2 misses (Health 5 of 6) |
| HIV fixtures missing | HIV fixtures are missing from the fixture catalog (the synonyms exist), so HIV questions cannot be answered in the benchmark. Four holdout2 questions that were recalled fail only because their windows are narrower than the recorded on-demand requests. | `evals/holdout2.yaml`, `connectors/who_gho/tests/fixtures/` |
| Demo data is small | `demo-data/` is built from recorded fixtures: a slice per source (20 discovered series per source, core datasets from the fixture requests). Search and charts look thin on it. | `testing/fixture_catalog.py` |
| Population topic | 0.909 on the main set, but the "people" rewrite is limited to counts and 3 of 7 population questions missed in holdout2. | `search/search.py` (`_counts_people`) |
| Turbopack in the sandbox | `next build` with Turbopack panics inside the build sandbox, so webpack was used to verify the build. | [web.md](web.md), [runbook.md](runbook.md) |
| Synthetic fixtures | bea, census, datacommons, eia, fred, datagovin, unicef, abs, insee, the Companies House REST dataset and BLS's keyed path use hand-written fixtures. Values are invented. | README sources table |
| Unverified licences | unicef, insee, unhcr, unesco_uis, ibge are `review` with unverified terms; MoSPI `yes` rests on an unchecked translation; the FRED copyright-tag mapping is unverified. | `docs/licensing.md`, `docs/hosted.md` legal checklist |
| WHO GHO host | Built on the legacy OData host; WHO's replacement API will need a port. | `connectors/who_gho/` |
| Sandbox | Python sandbox is tested with a fake process, not a real Docker daemon. | `docs/sandbox.md` |
| Chat | Tested with a stubbed LLM; never run against a live model in CI. | `web/src/lib/chat/` |

Not built: UN WPP, WB PIP, ONS, WHO Mortality DB, StatCan, ISTAT, IMF WEO, Eurostat causes of death
and energy, OECD Health (each needs a verified URL and licence first); NASA GISTEMP and NOAA GML
(robots.txt forbids the files); UK company accounts, a running hosted instance, embeddings, S3
storage, a Postgres catalog. Out of scope: market prices, survey microdata, real-time data.

## Needs the owner (an agent cannot do these)

1. **Host the API.** Pick a VM, run `deploy/hosted/`, point a DNS name at it, terminate TLS. Then set
   `STATMESH_API_URL` on the Vercel project. Nothing public works until this exists.
2. **API keys.** Create free keys for FRED, BLS, Comtrade, data.gov.in, Census, BEA, EIA, Companies
   House, Data Commons, and set a contact email for SEC EDGAR; put them in `.env` (self-host) or
   `.env.worker` (hosted). Never in files that are committed.
3. **Licence verification by a person** before the hosted launch: read each `yes` source's live terms
   page; confirm MoSPI's Hindi copyright page; check UNICEF, INSEE, UNHCR, UNESCO UIS, IBGE terms;
   verify FRED tag strings with a real key; decide on IMF, OECD, WHO.
4. **Re-record fixtures live** for the synthetic sources (`statmesh connector record <id>` with a key
   or network) and for HIV and the narrower WHO windows; then regenerate `demo-data` and re-measure
   the benchmark (do not edit expected keys by hand).
   Also the World Bank fixtures: `SP.DYN.CBRT.IN` (crude birth rate) and `SP.DYN.TFRT.IN` (total
   fertility rate) were added to `core_indicators` but no fixture holds them yet. Re-record the
   worldbank fixtures (needs network), rebuild `demo-data` and the hosted mirror; until then the
   hosted instance cannot answer birth-rate questions from World Bank data.
5. **Run the untested setups:** Claude Desktop, Claude Code, ChatGPT (`statmesh mcp --print-config`),
   Docker compose, nginx, the Python sandbox, chat with a real model, `statmesh doctor` live.
6. **Release actions:** tag v0.3.0 and v0.4.0, decide on PyPI, commit the uncommitted work.
7. **Project admin:** GitHub settings (private vulnerability reporting, labels, Discussions), a real
   contact address in `CODE_OF_CONDUCT.md`, `GOVERNANCE.md`, `SECURITY.md` (they hold a placeholder),
   fiscal sponsor, grant applications, pilots, contributor recruiting (see `docs/PRODUCT.md`).
8. **Takedown owner** for the hosted mirror, and a published takedown contact.
