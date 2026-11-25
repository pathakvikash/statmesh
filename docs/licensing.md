# Licensing, provenance and source etiquette

The code is Apache-2.0. Data is not: every dataset keeps its source's licence, and statmesh records
it, returns it with every result, and (in `hosted` mode) enforces it.

## Licence metadata

Every manifest has a mandatory `licence` block: `name`, `url`, `attribution` and `redistribute`
(`yes`, `no`, `review`). A connector without it fails the contract tests.

**Resolution rule: series, then dataset, then source.** A series may carry its own licence, a
dataset may override the source's, and the most specific level that sets one wins. The catalog
stores NULL for "inherit" and the views (`series`, `datasets`) return the effective value. The same
rule drives hosted-mode filtering. Examples:

- `fred` sets a per-series licence from FRED's copyright tag (pre-approval required: `no`; citation
  required: `review`; public domain: `yes`; no tag: `review`). The tag strings were written from
  memory and not checked against live `/fred/series/tags`.
- `dbnomics` takes the licence of the original provider from `options.providers.<CODE>.licence`; the
  BIS entry is marked "not verified" and stays `review`.
- `mospi`: `yes` for the NSO datasets; the three RBI datasets (`rbi_trade_inr`, `rbi_bop`,
  `rbi_fx_annual`), `nas_state_annual` (state-compiled GSDP/NSDP), `cpialrl` (Labour Bureau), `envstats` (IMD/FSI),
  `gender_stats` (other bodies' data) and `sppi` (historically compiled by DPIIT's Office of the Economic Adviser; MoSPI
  metadata names no owner) override to `review`.
- CKAN and Socrata datasets carry the portal's licence name. If it differs from the manifest's, that
  dataset is downgraded to `review`, whatever the manifest says (`open_canada`, `cdc_data`).

| Value | Meaning here |
|---|---|
| `yes` | open licence that allows redistribution with attribution |
| `no` | terms restrict redistribution (UN Comtrade) |
| `review` | terms are unknown, ambiguous or conditional; treated like `no` for hosting |

Current values, from the manifests (the maintainers' reading of public terms, not legal advice;
some are marked unverified in the manifest itself):

| Source | Licence | Redistribute |
|---|---|---|
| `worldbank`, `ilostat` | CC BY 4.0 | yes |
| `eurostat` | CC BY 4.0 (Commission Decision 2011/833/EU); some trade data is excluded upstream | yes |
| `faostat` | CC BY 4.0, attribution required | yes |
| `bis` | BIS terms of permitted use: unrestricted if BIS is cited, no implied endorsement, no extra charge in a commercial product | yes |
| `ecb` | ESCB reuse policy: free reuse, source quoted, statistics not modified | yes |
| `unsdg` | UNdata terms of use: free to copy and redistribute when UN data is cited | yes |
| `sec_edgar`, `bls`, `census`, `bea`, `eia`, `cdc_data` | US government work (BLS asks for citation) | yes |
| `gleif` | CC0 1.0 | yes |
| `uk_companies_house` | Open Government Licence v3.0 | yes |
| `datagovin` | GODL-India | yes |
| `open_canada` | Open Government Licence - Canada | yes |
| `esef` | filings.xbrl.org terms: no restrictions stated (checked 2026-11-19); issuers' own reports may carry their own rights | yes |
| `mospi` | MoSPI Copyright Policy, Category A: attribution, no endorsement, no MoSPI logo. Based on a translation of the Hindi page, not independently re-read | yes (RBI datasets, `nas_state_annual`, `cpialrl`, `envstats`, `gender_stats`, `sppi`: review) |
| `dhs` | DHS Program API terms not found; TODO: read the terms before setting `yes` | review |
| `imf` | IMF Terms of Use: copyright IMF, free non-commercial use with attribution | review |
| `oecd` | OECD Terms and Conditions (CC BY 4.0 unless a dataset says otherwise) | review |
| `dbnomics` | per provider | review |
| `datacommons` | CC BY 4.0 compilation; underlying sources keep their own licences | review |
| `who_gho` | WHO data policy; per-indicator licences vary, non-commercial public-health reuse | review |
| `fred` | per series by copyright tag; default | review |
| `comtrade` | UN Comtrade terms of use | no |

## Modes

`STATMESH_MODE=self_host` (default): you use data under your own keys and terms; everything is
served. `STATMESH_MODE=hosted`: only `redistribute: yes` data is served, on every surface.
Implemented in `core/licence.py:can_serve`, applied with the series > dataset > source rule:

- SQL views: a series whose effective licence is not `yes` is removed from `observations`,
  `observations_vintages` and `series`. A dataset row stays if the dataset is `yes` or any of its
  series is, so a public-domain FRED series is served from a `review` dataset while its copyrighted
  siblings are not. `entities` and `entity_xref` are filtered by source. Parquet files of datasets
  that are not served at all are never attached.
- Search and `describe_series` drop or 404 non-`yes` series; `get_observations` returns `forbidden`
  (HTTP 403) before any on-demand fetch; `list_sources` omits sources with nothing servable.
- `run_python` is never enabled in hosted mode.

Not implemented: the spec's idea that `no` and `review` data could be fetched in hosted mode with the
user's own key and never cached for other users. In hosted mode those sources are simply hidden.
Nothing in this repository runs a hosted instance (the design notes are in [hosted.md](hosted.md)),
and a hosted-instance policy has not been reviewed by anyone who knows data licensing; get that
review before any public launch. Comtrade caching terms and FRED third-party series are open
questions for the same review.

## Attribution and provenance

- Every API response and MCP result has `citations[]`. A citation holds `source_id`, `source_name`,
  `dataset_id`, `series_id`, `licence_name`, `licence_url`, `redistribute`, `attribution`,
  `source_url`, `retrieved_at` and `vintage`. Show the `attribution` string when you show the data.
- `statmesh export` writes CSV or Parquet plus `SOURCES.md` with the same fields for every series
  exported, and a warning line for each `no` or `review` source.
- Lineage: every ingest and on-demand fetch writes a `lineage` row (source URL, request params with
  the key redacted, `retrieved_at`, connector version, SHA-256 of the raw snapshot, the Parquet parts
  produced). Raw responses are kept under `data/raw/`.

## Source etiquette

- One rate limiter per source per process, shared by scheduled and on-demand fetches; per-hour and
  per-day budgets are shared across processes through the catalog. Limits come from the manifest
  (OECD 60 downloads per hour, Comtrade 500 per day, BLS keyless 25 per day, SEC 8 per second under
  its 10 per second cap; the Comtrade keyless-preview limit is undocumented, 500 is assumed).
- `Retry-After` is honoured. When the budget is spent, on-demand reads return `rate_limited` with
  `retry_after` rather than waiting.
- The User-Agent is `statmesh/<version> (+<STATMESH_CONTACT_EMAIL>)`. SEC requires a contact in it,
  so `serve`, `worker` and `mcp` refuse to start without it while `sec_edgar` is enabled; see
  [configuration.md](configuration.md).
- File downloads read `robots.txt`. No scraping where terms forbid it.
- Never rotate keys or IPs to get around a limit. API keys live in the environment, are redacted from
  logs, errors, lineage and fixtures, and are dropped on a redirect to another host.
- No AGPL code. DBnomics' fetchers are AGPLv3; statmesh only calls its public API. Contributed
  connectors must be Apache-compatible.
