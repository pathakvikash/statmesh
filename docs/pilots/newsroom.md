DRAFT: not yet used with any real pilot

# Pilot brief: newsroom

**Who it is for.** A data or politics desk that needs a checkable number on deadline, with its
source and licence, and a chart it can publish. Typical user: a reporter or data editor with a
two-week window and a list of open stories.

## The eight questions

All eight run in `demo.sh` under the Newsroom block. The label in the output is the question text.

| # | Question | How it runs in demo.sh | Shows |
|---|---|---|---|
| 1 | How high is unemployment in India? | `search "unemployment rate India"` | Which series exist (ILOSTAT, Eurostat, MoSPI) |
| 2 | What was India's unemployment rate from 2018 to 2022? | SQL on the ILOSTAT India series | Annual values with series id and licence |
| 3 | What was the US unemployment rate each month of 2023 and 2024? | SQL on BLS `LNS14000000` | Monthly values |
| 4 | How fast are consumer prices rising in Germany, France and Italy in 2024? | SQL on ECB HICP annual rate | Three countries, one year |
| 5 | What is the central bank policy rate in the US and India? | SQL on BIS policy rates, monthly | Policy rate series |
| 6 | How has the US population changed since 2010? | SQL on Census population estimates | Long series |
| 7 | What was US GDP by quarter in 2023? | SQL on FRED GDP | Quarterly values |
| 8 | What was India's inflation in 2022 and 2023, according to the IMF? | SQL on IMF CPI, India | Annual year-on-year rate |

Every row carries its series id, so each number can be traced back to its source and licence.

## Setup steps

1. Install: `uv sync --extra sdk`, then `cp .env.example .env` (keys are optional for this brief).
2. Run `bash docs/pilots/demo.sh`. It must exit 0 before anything else.
3. Load live data for the desk's sources. Keyless and recommended first: `statmesh ingest ilostat`,
   `statmesh ingest imf`, `statmesh ingest bis`, `statmesh ingest ecb`, `statmesh ingest eurostat`.
   ILOSTAT took about 30 seconds on 19 Nov 2026 (README); the others were not timed. Run each with
   `uv run --env-file .env`.
4. Pick the stories' numbers. For each number, check the citation columns (`licence_name`,
   `retrieved_at`) before quoting it. Do not publish a `redistribute: no` source (UN Comtrade) without
   checking its terms.
5. Rerun the question with `statmesh sql --local` on the live data. Without `--local`, the CLI calls
   a running server (`statmesh serve`) at `STATMESH_URL`.

## Two-week plan

- **Days 1 to 2.** Install, run the demo, and check the eight questions produce the same rows on
  your machine. Send the maintainer any step that fails.
- **Days 3 to 5.** Ingest the desk's sources. Take ten real questions from open stories. Log each one
  (see [feedback-form.md](feedback-form.md)).
- **Days 6 to 9.** Use statmesh for every number in two live stories. Record time to a cited number
  and every missing-data case, with what search returned.
- **Days 10 to 12.** Build one chart from a cited answer, in the web UI's series page or your own
  tool. Note any step where the citation was not enough to publish.
- **Days 13 to 14.** Fill in the feedback form and join a 30-minute call if the editor agrees.

## Feedback we want

- For each story number: was it found, cited and fast enough? If not, where did it stop?
- Did a "missing" answer name the source that would hold the data? Did it give a number from memory?
- Which licence questions came up, and could you answer them from the citation alone?
- What would make you use it on deadline (a CSV export, a link to a series, a share link)?
