DRAFT, NOT SENT

# statmesh: 12-month budget skeleton

**Every amount in this file is a PLACEHOLDER.** None is a quote, an estimate or a rate. Replace each
one with a quote, a published rate or the funder's own budget template before anything is sent. Units
and line items are a starting point only.

Currency: [PLACEHOLDER: currency]. Period: [PLACEHOLDER: start month] to [PLACEHOLDER: end month].

## Lines

| # | Line | Basis | Amount |
|---|---|---|---|
| 1 | Maintainer time | [PLACEHOLDER: FTE fraction] x [PLACEHOLDER: monthly rate] x 12 | [PLACEHOLDER] |
| 2 | Part-time contributor (connector maintenance) | [PLACEHOLDER: hours per month] x [PLACEHOLDER: hourly rate] x 12 | [PLACEHOLDER] |
| 3 | Hosting for the hosted mirror (servers, storage, bandwidth, backups) | [PLACEHOLDER: provider quote] x 12 | [PLACEHOLDER] |
| 4 | Domain, TLS certificate, email for the project | [PLACEHOLDER: annual cost] | [PLACEHOLDER] |
| 5 | Security review of the hosted deploy and the sandbox | [PLACEHOLDER: external quote, not yet requested] | [PLACEHOLDER] |
| 6 | Keyed-source access (any fees for API keys) | [PLACEHOLDER: check each source's terms; most sources are keyless] | [PLACEHOLDER] |
| 7 | Pilot support (video calls, printed guides, a small thank-you) | [PLACEHOLDER] | [PLACEHOLDER] |
| 8 | Fiscal sponsorship fee | [PLACEHOLDER: percentage from the sponsor's terms] | [PLACEHOLDER] |
| 9 | Contingency | [PLACEHOLDER: percentage of lines 1 to 8] | [PLACEHOLDER] |
| | Total | Sum of lines 1 to 9 | [PLACEHOLDER] |

## Work by quarter (plan, not done)

The items come from `docs/M3_PLAN.md` and the hosted-mirror notes in `CHANGELOG.md`. None is built
except where the repository says so.

| Quarter | Work | Funded lines |
|---|---|---|
| Q1 | Deploy the hosted mirror (built, not deployed); run the Docker and nginx checks that have not been run | 1, 3, 4 |
| Q1 to Q2 | Three two-week pilots and feedback | 1, 7 |
| Q2 | Recruit and onboard the part-time contributor; add connectors from the M3 plan | 1, 2 |
| Q3 | Security review of the hosted deploy and the sandbox | 5 |
| Q4 | Live smoke tests for keyed sources, with the results published; year-end report | 1, 2, 6 |

## Notes

- Hosting cost depends on the provider and on the number of users. It is not yet measured.
- The sponsor's fee, if any, is taken from income or from the grant, depending on the sponsor's terms.
- No line pays for anything already in place. Nothing has been bought or booked.

## Unverified claims

- Every amount above, including the placeholders, has no source yet.
- Whether the funder allows each line (for example, salary, hosting, audits, or a fiscal sponsor fee),
  and the funder's maximum per line.
- Whether the funder requires a budget in its own template, and its period length.
- Whether the funder allows a contingency line, and its size limit.
- The M3 plan's connector counts and pilot counts, which describe intent, not delivered work.
