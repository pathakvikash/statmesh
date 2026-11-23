## Summary

<!-- What changes, and why. For a source: the provider and the dataset(s). -->

## What changed

<!-- Bullet list of files or behaviours. -->

## Repo rules

- [ ] No keys, emails or local absolute paths in any file.
- [ ] Every number in docs or code cites a source.
- [ ] Tests are offline; fixtures are said to be recorded or synthetic.
- [ ] Licence default stays `redistribute: review`; nothing loosened to pass a test.
- [ ] No benchmark thresholds, expected keys or hold-out files edited.

## Connector checklist

Skip this section if the PR touches no connector.

- [ ] `uv run ruff check`, `uv run ruff format --check` and `uv run pytest -q` pass, offline.
- [ ] `uv run statmesh connector test <id>` passes.
- [ ] `licence` block filled in: name, URL, attribution and `redistribute`. Link to the terms and
      the date you read them: <!-- url, date -->
- [ ] `redistribute` is `review` unless you read the terms and they allow it. If unclear, say so here.
- [ ] Rate limit and auth match the provider's published rules. A key variable is named in
      `key_env` and added to `.env.example` and `docs/configuration.md`.
- [ ] Fixtures contain no secrets and no personal data. Synthetic fixtures are marked
      `"synthetic": true` and named in the README sources table.
- [ ] README sources table row (kind, key, licence, `redistribute`, real or synthetic fixtures) and
      a line in `docs/connectors.md`.
- [ ] `EVAL_SOURCES` decided: in or out of `src/statmesh/testing/fixture_catalog.py`, and why.
- [ ] On-demand fetch honours `req.max_rows` and `req.filters`. A row cap sets
      `RawChunk.meta["truncated"] = True`.
- [ ] `unit_mult` follows [docs/data-model.md](../docs/data-model.md): the scale beyond what `unit`
      says, never both.

## Core change

Skip this section if nothing outside a connector folder changed.

- [ ] A test that fails without this change.
- [ ] The licence and SQL-safety checks in `query/` and `core/licence.py` are unchanged, or the PR
      says why they changed.

## How verified

<!-- The commands you ran, and their result. Do not tick a box you did not run. -->
