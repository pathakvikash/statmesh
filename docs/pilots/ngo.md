DRAFT: not yet used with any real pilot

# Pilot brief: NGO or policy team

**Who it is for.** An analyst at an NGO, think tank or policy unit who joins sources on country and
year, exports a CSV, and may need to redistribute it. Typical user: a research analyst with a
two-week window and a report in progress.

## The eight questions

All eight run in `demo.sh` under the NGO block.

| # | Question | How it runs in demo.sh | Shows |
|---|---|---|---|
| 1 | What share of people live in extreme poverty in Brazil and Nigeria? | SQL on UN SDG indicator SI_POV_DAY1 | Two countries, 2015 to 2020, with gaps |
| 2 | How did unemployment change in Germany, France, Spain and Greece, 2021 to 2023? | SQL on Eurostat unemployment | Four countries, three years |
| 3 | What was unemployment in India and its states, 2024? | SQL on MoSPI PLFS annual, India and two states | Sub-national geography; expect a truncation warning |
| 4 | How does unemployment compare across Bangladesh, India and Vietnam, 2018 to 2022? | SQL on ILOSTAT | Bangladesh has one year in the demo data: a real gap |
| 5 | Does inflation track the policy rate? IMF CPI joined to BIS policy rates, 2022 and 2023 | SQL join on country and year | The cross-source join the product is for |
| 6 | What is consumer price inflation across OECD countries in 2024? | SQL on OECD CPI | Many countries, one year |
| 7 | How many people live in India, by year? | SQL on Data Commons population | Licence is `review`; check before redistributing |
| 8 | What is the median age in India and the US? | SQL on Data Commons median age | Two countries |

Search is not used here on purpose. In the benchmark, population and poverty phrasings miss, so
these questions use series ids directly.

## Setup steps

1. Install: `uv sync --extra sdk`, then `cp .env.example .env`.
2. Run `bash docs/pilots/demo.sh`. It must exit 0 before anything else.
3. Load the keyless sources the report needs, for example `statmesh ingest unsdg`, `statmesh ingest
   eurostat`, `statmesh ingest ilostat`, `statmesh ingest imf`, `statmesh ingest bis`, `statmesh
   ingest oecd`, `statmesh ingest mospi`. The `who_gho` and `worldbank` connectors are not in the
   demo build; load them live (`worldbank` timed out once on 19 Nov 2026, so retry if it does).
4. Build the country-year table in SQL and export it. The CSV export and the `SOURCES.md` written
   beside it carry the licence for each source. Check the licence column before sharing outside the
   team. `yes` means the manifest allows redistribution, with the source's attribution. `review` needs
   a check against the source's terms. `no` (Comtrade) means do not redistribute.
5. Keep the SQL for every table in the report, so a reader can rerun it.

## Two-week plan

- **Days 1 to 2.** Install, run the demo, and check the eight questions.
- **Days 3 to 5.** Ingest the report's sources. Write down the country-year table the report needs.
- **Days 6 to 9.** Build the table with SQL. Log every gap: a country or year with no value, and what
  statmesh said about it.
- **Days 10 to 12.** Export the CSV, run the licence check on it, and compare two figures against the
  source's own website.
- **Days 13 to 14.** Fill in the feedback form and join a 30-minute call if the team agrees.

## Feedback we want

- Was the join across sources easy to write in SQL? Where did you need help?
- How often did a gap in a series block a result, and did the answer say which years were missing?
- Could you cite each figure from the export alone, including the licence?
- Which sources did you need that are not in the 27 connectors (see the README's source table)?
