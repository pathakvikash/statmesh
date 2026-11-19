DRAFT: not yet used with any real pilot

# Pilot feedback form

Used at the end of each pilot. Copy this file, or fill the questions in a document. The pilot log is
kept by hand during the two weeks, one row per question asked.

## Pilot log (one row per question)

| Column | What to write |
|---|---|
| date | Day of the pilot |
| question | The question, in your words |
| interface | search, SQL, REST, MCP or CLI |
| cited | yes or no: did the answer carry a source, licence and retrieval time |
| minutes to cited number | From asking to the first cited number; blank if none |
| missing | yes or no: was the data missing, partly missing or not in the catalog |
| what it said for missing | Quote the answer's wording; note whether it named the closest series |
| used in work | yes or no |

Weekly counts, computed from this log:

- Cited answers per week: rows with `cited = yes`.
- Time to a cited number: median of `minutes to cited number`.
- Share of answers where data was missing: rows with `missing = yes`, divided by all rows.

## End-of-pilot questions

1. Role and organisation (optional; say "prefer not to say" if you prefer).
2. How many questions did you ask in two weeks, and how many did you use in your work?
3. Which question would you most like statmesh to answer next, and which source would hold it?
4. Where did the install or the demo fail? Paste the command and the first error line.
5. Which answer did you not trust, and why? Include the question.
6. Did you check any licence before using a number? Was the licence shown clearly enough?
7. What would make you use statmesh again next month (CSV export, a share link, a chart, an API)?
8. On a scale from 1 (no) to 5 (yes): would you recommend it to a colleague?
9. Anything else the maintainer should know?

## What to send back

Send the log and the answers to [PLACEHOLDER: maintainer contact address]. Do not include keys, the
`.env` file or personal data about people other than yourself.
