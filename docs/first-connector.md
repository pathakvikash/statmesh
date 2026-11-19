# Your first connector in 30 minutes

You will add a source that reads one CSV file, test it offline, then point it at the real data.
This uses the `file` kind: no Python, just a manifest and a mapping. Use it for a CSV, XLSX or ZIP
that holds one table.

Before you start: Python 3.12+, [uv](https://docs.astral.sh/uv/), and a clone of this repo with
`uv sync` run once.

Keep your work outside the repo until it is ready. Point `STATMESH_CONNECTORS_DIR` at a folder of
your own. A connector there with the same id overrides a bundled one, so pick an id that is not in
the list in [connectors.md](connectors.md). Ids are lower case letters, digits and `_`.

```sh
export STATMESH_CONNECTORS_DIR=~/statmesh-connectors
mkdir -p "$STATMESH_CONNECTORS_DIR"
```

## 1. Scaffold (2 minutes)

```sh
uv run statmesh connector new mycsv --kind file
```

This writes `~/statmesh-connectors/mycsv/` with:

- `manifest.yaml`: the id, a `licence` block still marked `TODO`, and `datasets.example.url`.
- `mapping.yaml`: which columns hold the country, the period and the value.
- `tests/test_contract.py`, `tests/test_smoke.py` and `tests/fixtures/requests.yaml`.
- `tests/fixtures/http/`: a synthetic CSV and a `robots.txt`, so the tests run offline.

The command prints the next steps.

## 2. Fill in the licence (10 minutes)

Open the provider's terms of use and fill in the four fields:

```yaml
licence:
  name: Example Open Data Licence 1.0
  url: https://example.org/terms
  redistribute: "yes"
  attribution: "Source: Example Agency"
```

- `redistribute` is `"yes"` only when the terms allow reuse and redistribution, with attribution.
  `"no"` when they forbid it. `"review"` when you cannot tell; then say so in your PR.
- Quote `"yes"` and `"no"`. YAML reads bare `yes` and `no` as booleans.
- Do not guess. Unknown terms stay `review`, and the hosted mirror only takes `yes`.

Until `name`, `url` and `attribution` have no `TODO` left, the suite fails on
`test_licence_has_no_todo` and skips the other tests. That is deliberate.

## 3. Run the offline tests (2 minutes)

```sh
uv run statmesh connector test mycsv
```

Expected: every test passes except the live smoke test, which is deselected. The synthetic fixture
stands in for the real file, so no network is needed.

## 4. Point it at the real file (10 minutes)

Set the URL in `manifest.yaml`:

```yaml
datasets:
  example: {url: https://example.org/real/data.csv}
```

Then map the real column names in `mapping.yaml`. The scaffold maps a file with the columns
`country`, `year` and `value`. Change it to match yours:

```yaml
datasets:
  example:
    title: Example
    geo: country            # the column with the country code
    geo_scheme: iso3        # iso3 | iso2 | m49 | name
    period: year            # a column: a year, a date, or a period like 2024-Q1
    value: value            # the column with the number
    indicator_id: example   # a constant name for the series
    unit: percent           # a constant; or unit_col: <column name>
```

Columns you do not list are ignored. If your file has one column per year, or one row per indicator,
see the `melt` and long-layout options in [connectors.md](connectors.md#the-file-connector-kind-file-and-mappingyaml).

Then record the real responses. This needs network access:

```sh
uv run statmesh connector record mycsv
uv run statmesh connector test mycsv
```

Fixtures are keyed by URL. If you change the URL and do not record again, the synthetic fixtures
no longer match and the tests fail. Record again after every URL change.

## 5. When a test fails

| Message | What it means |
|---|---|
| `licence TODO remains` | Step 2 is not finished. |
| `invalid geo codes` or `unmapped share` | The country codes are not what `geo_scheme` says. Fix `geo_scheme`, or add a `geo_map.csv` with `src_code,geo` lines for the exceptions. |
| `no rows produced overall` | Every row was skipped. Check `period` and `value` against the file. A row with a bad period is skipped silently. |
| `secret in ...` or `unredacted key` | A key ended up in a fixture. Remove it, record again, and never commit a `.env`. |

Unparseable values become null with `obs_status: missing`; they do not fail the run.

## 6. Open a pull request

The connector folder is the whole change. To propose it for the repo, copy it to
`src/statmesh/connectors/mycsv/` in your clone, run the same `statmesh connector test` there, and
then:

- add a row to the README sources table and a line to [connectors.md](connectors.md);
- link to the terms and say when you read them;
- fill in [the PR template](../.github/PULL_REQUEST_TEMPLATE.md), which is the connector checklist.

Starter sources that need this exact work are listed in [good-first-sources.md](good-first-sources.md).
