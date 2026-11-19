# Contributing

The easiest contribution is a new source. A source is a folder under `src/statmesh/connectors/`;
often it is one YAML file. New here? [docs/first-connector.md](docs/first-connector.md) takes you
from nothing to a tested connector in 30 minutes, and [docs/good-first-sources.md](docs/good-first-sources.md)
lists ready-to-file starter issues. The core is meant to stay unchanged when you add one. By contributing you
agree your work is licensed under Apache-2.0. Do not copy code from AGPL projects (DBnomics'
fetchers, for example) and do not add dependencies that are not Apache-compatible.

## Setup

Needs Python 3.12+ and [uv](https://docs.astral.sh/uv/).

```sh
uv sync                      # runtime and dev dependencies (pytest, pytest-socket, ruff)
uv run statmesh --help
```

The web UI (optional) is in `web/`: `cd web && npm ci && npm run dev` (also `lint`, `typecheck`,
`test`).

## The checks a change must pass

```sh
uv run ruff check
uv run ruff format --check        # ruff format to fix; line length 100
uv run pytest -q
```

CI (`.github/workflows/ci.yml`) runs these, then builds the search-eval catalog from the connector
fixtures (`python -m statmesh.testing.fixture_catalog evals`; the sqlite is git-ignored) and runs
`pytest tests/search` against it. A missing catalog fails the job. If you add a connector with
fixtures, say whether it belongs in `EVAL_SOURCES` in `statmesh/testing/fixture_catalog.py` (that
list is pinned so expected eval keys do not drift). Tests are offline: `pytest-socket` blocks the
network, and `-m "not live"` is the default. Tests that call real APIs are marked
`@pytest.mark.live` (and `@pytest.mark.enable_socket`) and run with `uv run pytest -m live`; the
nightly workflow (`smoke.yml`) runs them, and a failure opens an issue instead of blocking a PR.
Never put a real API key, or your `.env`, in a fixture, a test or a commit. The contract suite
fails if a secret appears in a fixture.

Layout: `src/statmesh/core/` (models, HTTP client, catalog, storage, geo and period helpers,
generic connectors), `ingest/`, `query/`, `search/`, `api/`, `mcp_server.py`, `sdk.py`, `devtools/`,
`testing/` (contract suite, fixture replay and recording, the fixture catalog builder),
`sandbox/` (opt-in Python), `connectors/<id>/` (27 bundled). How the pieces fit:
[docs/architecture.md](docs/architecture.md).

## Adding a source

Pick the lowest level that works ([docs/connectors.md](docs/connectors.md) has the full reference).

1. Does it speak SDMX, CKAN, Socrata, or serve a CSV/XLSX/ZIP file? Config only.
2. Files or a portal with unusual column names? Config plus `mapping.yaml`.
3. Anything else: a `connector.py`.

First, read the source's terms and API docs and decide its `licence` block. It is mandatory.
If you cannot tell whether redistribution is allowed, say `review` and say so in your PR.

### Example: a config-only source (Eurostat)

```sh
statmesh connector new mysource --kind sdmx
```

Fill in `connectors/mysource/manifest.yaml` the way `connectors/eurostat/manifest.yaml` does:
`endpoint`, the `licence` block, `rate_limit`, and under `options` the SDMX quirks of that API
(`agency`, `list_path`, `geo_dim`, `freq_dim`, `geo_scheme`, `unit_col`, `status_col`). Eurostat is
lower case (`geo`, `freq`) and uses ISO2 codes; IMF uses `COUNTRY` and `FREQUENCY`; ILOSTAT keeps
the defaults. Pick one dataflow as `core_datasets` and describe how to slice it under
`datasets.<id>`: `indicator_dims` (the dimensions that identify a series) and `filters` (the rest of
the key). Put code-scheme exceptions in `geo_map.csv`. Then list the requests to record in
`tests/fixtures/requests.yaml`, record them and run the tests:

```sh
statmesh connector record mysource
statmesh connector test mysource
```

If a quirk cannot be expressed as an option of the generic connector, that is a change to
`core/generic/sdmx.py`, not a reason to copy it into your folder. Open an issue first.

### Example: a custom connector (World Bank)

```sh
statmesh connector new mysource --kind custom
```

`connectors/worldbank/` is the reference. Its three methods, in order:

- `discover(http, limit)` calls the indicator list through `http.get`, builds one `SeriesMeta` per
  indicator, and yields a `DatasetMeta` carrying the licence.
- `fetch(req, http)` builds the URL from `req.indicator_ids`, `req.geos` and `req.start`/`req.end`,
  pages through the API with `http.get`, and yields one `RawChunk` per page. It raises on the API's
  errors-as-HTTP-200 bodies instead of passing them on.
- `normalize(chunk)` parses the saved bytes into one row per observation: `to_geo` for the country,
  `parse_period` for the date, `make_series_id`, units as published, status flags kept, and it
  returns `pa.table(cols, schema=OBS_SCHEMA)`. No I/O. Null values are skipped.

`connectors/sec_edgar/` shows the other shape: one connector filling `observations`, `entities`
and `entity_xref` by setting `RawChunk.table`.

Rules reviewers will check:

- All HTTP goes through the `http` argument. No `requests`, `httpx`, `urllib`, `time.sleep`, retry,
  cache or rate-limit code in a connector.
- Send keys as `params={"api_key": http.key}` (or a header) and store `"REDACTED"` in
  `RawChunk.params`.
- `normalize` is pure and matches the schema exactly. Geo codes map to ISO3, `region:` or
  `unmapped:`. Keep the source's units; no silent conversion.
- Everything lives inside your connector folder. Nothing in `core/` changes for a new source.
- Keep large or unbounded sources on demand (`core_datasets: []`) and honour `req.max_rows`.

### Tests and fixtures

Every connector has `tests/test_contract.py` (two lines, `ContractSuite`), `tests/test_smoke.py`
(live, optional locally) and `tests/fixtures/` with recorded responses. Record fixtures with
`statmesh connector record <id>`. For a keyed source, record with the key set; fixtures store it as
`REDACTED`. If you have no key, write fixtures from the documented response shape, set
`"synthetic": true` in their metadata, and say so in the PR; the live smoke test is then skipped.
Say "synthetic" in the README sources table too. When you get a key, re-record and drop the flag.
Keep fixtures small: a few series and countries, enough to cover the quirks.

### Pull request checklist

The checklist is in [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md) and fills
in when you open a pull request. Tick only what you ran. For a change in `core/`, it also asks for
a test that fails without the change.

## Other changes

Bug reports with a series id, the command and the output are the most useful
([bug form](.github/ISSUE_TEMPLATE/bug.yml)). Report security problems privately, never in a public
issue: see [SECURITY.md](SECURITY.md). Governance, licence policy and decisions are in
[GOVERNANCE.md](GOVERNANCE.md). Everyone taking part follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

For a change to the
core (ingest, query engine, SQL safety, licence enforcement), add a test that fails without it and
keep the SQL allow-list and licence checks in `query/` and `core/licence.py` as they are unless the
change is about them. Decisions in [docs/DECISIONS.md](docs/DECISIONS.md) override the plan; read
them before changing a licence value, a connector name or the sandbox. Docs live in `docs/`; if you change behaviour, change the page that describes
it.
