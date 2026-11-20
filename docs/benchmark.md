# Question benchmark

`statmesh bench` runs the 200 questions in `evals/benchmark.yaml` against a catalog built offline from every connector's recorded fixtures (not only the sources the questions use) (`evals/bench_data`, gitignored). It tests the plumbing, not real coverage: the catalog is the fixture catalog.

Each question has `id`, `q`, `source`, `topic`, `expected` (series keys), `geo`, `start`, `end`. The expected keys were read from the fixture data (each has a non-null value for `geo` in `[start, end]`), never copied from search output. Do not edit them to raise the score.

Per question, searching with `q` and `geo` and no source filter:

| metric | passes when |
|---|---|
| recall@5 | an expected key is in the top 5 hits |
| answerable | the first such hit returns a non-null value in `[start, end]` for that geo |
| cited | that result carries a citation with a licence, an `http(s)` source URL and `retrieved_at` (checked on its own, whether or not the question is answerable) |
| answer rate | all three |

Non-core WHO GHO and World Bank indicators are read through on-demand fetches. The benchmark makes those replay the recorded fixtures (`requests.yaml` of each connector lists the exact requests), so a question on a new non-core indicator needs a new recorded request: window 2015-2022, one country per entry.

Results go to `evals/results/results.json` and `REPORT.md`. The CI gate is `evals/results/thresholds.json`: the first measured value minus 0.05, rounded down to 0.05, floor 0.75. `statmesh bench` exits 1 when a metric falls below its threshold. `--write-thresholds` rewrites them from the current run: raise them only after a real improvement.

Every expected key is also checked against the built catalog: a missing key is listed in the report and `statmesh bench` exits 1.

## Bench data directory

`--data-dir` (default `evals/bench_data`) holds the built catalog. The bench writes a `.statmesh-bench` marker into it, containing a hash of the fixtures, `benchmark.yaml`, `bench.py` and `fixture_catalog.py`. The data is reused while the hash matches and rebuilt when it differs (or with `--rebuild`). The bench only deletes a directory that has the marker, is empty or does not exist; any other directory is refused with an error (exit 2), so `--data-dir .` cannot wipe anything.

## `--llm`

`statmesh bench --llm` also asks a model to answer each question with the tools running in-process (needs `ANTHROPIC_API_KEY`; skipped without it; not gated). Grading: the answer has a number, and every number in it equals a value from the `get_observations` results, compared as floats up to the precision it is shown with (half a unit of its last digit) or 0.5 percent. Numbers that appear in the question do not count, a bare year matches an observation year, and "12" does not match "2012-01-01".

- Model: `--model`, else `STATMESH_BENCH_MODEL`, else `claude-sonnet-5-5`.
- Errors are caught per question: a 429, 529, 5xx or transport error is retried with backoff (1, 2, 4 s; at most 4 tries); any other failure marks that question failed with its error and the run goes on. Results are always written, with the pass rate and the number of questions that failed with an error.

## Flags

`statmesh bench` (or `python -m statmesh.bench`): `--llm`, `--model`, `--rebuild`, `--write-thresholds`, `--limit N`, `--questions FILE` (for example `evals/holdout.yaml`), `--no-write`, `--data-dir`, `--out`.

## Hold-out

`evals/holdout.yaml` (30 questions) was seen during search tuning: two entries were written for hold-out wording and have been removed. Its score is reported, but it is not an unbiased estimate. Score it with `statmesh bench --questions evals/holdout.yaml --no-write`. Never edit its expected keys to raise the score.

`evals/holdout2.yaml` (30 questions, all topics) is the blind hold-out. It was written on 2026-11-20 after that day's search changes (explicit geo name dropped from the query, "all but one concept" retrieval, "live in" filler, population and HIV/AIDS synonyms), with new wording and expected keys read from the fixture observation data before any search was run on it. It was scored once: recall@5 0.667, answerable 0.500, cited 0.533, answer rate 0.500; recall@5 0.667 is the unbiased search number. Four recalled questions (x11, x13, x24, x25) fail answerable only because their windows are narrower than the recorded on-demand WHO/World Bank requests (FixtureMissing), a flaw in how they were written, not in search; they were left as scored. Misses by topic: Health 5 of 6, Companies 2 of 2, Population 3 of 7. Do not tune search on it: once a change is made because of one of its misses it is no longer blind, and the next blind set must be new questions. Score it with `statmesh bench --questions evals/holdout2.yaml --no-write`.

A hold-out run rebuilds `--data-dir` (the questions file is part of the hash), so pass a separate `--data-dir` to keep `evals/bench_data` for the main benchmark. Connector manifests are not in that hash: after changing a manifest (titles, for example), run with `--rebuild`.
