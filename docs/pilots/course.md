# Pilot brief: university course

**Who it is for.** An instructor and their students (economics, statistics, data or public policy)
who need to find and compare public series without learning 27 statistical portals. Typical user:
an instructor running one assignment, with students who work on their own laptops.

## The eight questions

All eight run in `demo.sh` under the Course block. Question 1 is a search, so students see how the
catalog is organised.

| # | Question | How it runs in demo.sh | Shows |
|---|---|---|---|
| 1 | Which series cover consumer price inflation? | `search "consumer price inflation"` | Discovery: which sources publish inflation |
| 2 | How do US unemployment figures from BLS and FRED compare in 2023? | SQL on BLS and FRED | Two sources, same concept, same year |
| 3 | What was euro-area inflation each month of 2024? | SQL on ECB HICP, euro area | Monthly series |
| 4 | How did the policy rate move in Japan, the UK and India, 2022 to 2024? | SQL on BIS policy rates | Three countries, mixed frequency |
| 5 | How much electricity did the US generate in 2024? | SQL on EIA generation | Monthly values, one country |
| 6 | What was the US crude oil price in 2024? | SQL on EIA crude oil price | Price series |
| 7 | What was India's real GDP by quarter in 2023 and 2024? | SQL on MoSPI quarterly GDP, constant prices | Constant-price series |
| 8 | What were a Swedish listed company's total assets in 2020 and 2021? | SQL on ESEF filings | Company-level data from filings |

## Setup steps

1. Install: `uv sync --extra sdk`. Students can skip `.env` for this brief.
2. Run `bash docs/pilots/demo.sh`. It must exit 0 on the student's machine before the lesson.
3. Students use the offline demo for the assignment, so no internet or keys are needed for the eight
   questions. For a longer project, load one keyless source live (for example
   `statmesh ingest ilostat`).
4. Each student records, for one number, the series id, the licence and the retrieval time, and
   says in one sentence what the number means.

## Two-week plan

- **Week 1, days 1 to 3.** The instructor installs, runs the demo, and checks the eight questions.
  Students install the same day, or the lab machines are set up in advance.
- **Week 1, days 4 to 7.** Students run questions 1 to 4 in class and write one comparison each.
- **Week 2, days 8 to 11.** Students write the assignment: two questions of their own, answered with
  SQL, with citations. The instructor logs each question and the time to a cited number.
- **Week 2, days 12 to 14.** Instructor fills in the feedback form. Students answer the feedback
  questions in the last ten minutes of the lesson.

## Feedback we want

- Could students tell from the output where each number came from and whether they could reuse it?
- Which step took the longest (install, SQL, finding a series)? Where did students give up?
- Did the "missing" answers help students find another series, or did they stop there?
- Which connectors would the course use next?
