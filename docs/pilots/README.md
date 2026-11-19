# Pilots

A pilot is a two-week trial of statmesh on one persona's real questions. The maintainer helps with
setup and collects feedback. The pilot user does not pay, host anything or sign anything as part of
the trial.

Three pilots are planned (M3): a newsroom ([newsroom.md](newsroom.md)), an NGO or policy team
([ngo.md](ngo.md)) and a university course ([course.md](course.md)). None has started. Each brief
has eight questions that the offline demo data can answer; `bash docs/pilots/demo.sh` runs them.

## What a pilot gets

- A local install from the repo (the "Run it locally" steps in the README). The hosted read-only
  mirror is built but not deployed, so a pilot does not depend on it.
- The offline demo and the persona brief with its eight questions.
- Live ingest for the keyless sources the persona needs. Keyed sources (FRED, BLS, Census, BEA, EIA,
  Data Commons) run only if the pilot user brings their own key, and they have not been run live.
- A contact for bugs: [PLACEHOLDER: maintainer contact address].
- The feedback form, [feedback-form.md](feedback-form.md), filled in at the end.

## What we measure

Measured per pilot, per week. The pilot user keeps the log by hand (one row per question, columns in
[feedback-form.md](feedback-form.md)). These counts come from the log, not from server telemetry;
statmesh's own logging has not been checked for this purpose.

1. **Cited answers per week.** Answers, on web, MCP or REST, that carry at least one citation (a
   source, licence and retrieval time). This is the north-star metric in [../PRODUCT.md](../PRODUCT.md).
2. **Time to a cited number.** Minutes from the question to the first number that comes with its
   source, licence and retrieval date.
3. **Share of answers where data was missing.** Questions where statmesh had no series, returned no
   rows, or returned only part of the period asked for, divided by all questions asked. A good
   "missing" answer says what was searched and names the closest series. A bad one gives a number
   from memory.

## Limits to tell pilot users up front

- The 200-question benchmark scores 0.795 on all four metrics. It runs on the fixture catalog, so it
  tests the plumbing, not real coverage (see [../benchmark.md](../benchmark.md)).
- Search misses some phrasings. The benchmark misses include population, poverty, electricity and
  euro-area inflation questions (`evals/results/REPORT.md` lists them). When search misses, use SQL
  with the series id.
- Chat with a real language model has not been run. Pilots use search, SQL, REST, MCP or the CLI.
- Docker compose, nginx and the hosted mirror have not been run.
- Licences differ by source. Some are `review`, and UN Comtrade is `redistribute: no`. Check the
  licence before publishing a number (see [../licensing.md](../licensing.md)).
- The demo data is a slice of each source. Some series have gaps (for example, ILOSTAT Bangladesh has
  one year in the demo data), and a few queries print a truncation warning.

## Running the demo

```sh
export UV_CACHE_DIR=$TMPDIR/uvcache
uv sync --extra sdk
bash docs/pilots/demo.sh      # offline; exits 0 when all 24 questions return rows
```

Pilot questions are printed as `[persona] question`, followed by the first rows. The SQL for each
question is in `demo.sh`.

## Files

- [newsroom.md](newsroom.md), [ngo.md](ngo.md), [course.md](course.md): one brief per persona.
- [feedback-form.md](feedback-form.md): the log columns and end-of-pilot questions.
- [demo.sh](demo.sh): builds the fixture demo data in a temp dir and runs every persona's questions.
