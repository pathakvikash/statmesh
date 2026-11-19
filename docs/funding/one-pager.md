DRAFT, NOT SENT

# statmesh: one-page summary

**Status (as of v0.3.0, 20 Nov 2026):** built and tested offline. Not deployed. Nothing below has run
on a hosted server, with Docker, or against a live keyed source.

## The problem

Public statistics sit in dozens of portals with different codes, licences and formats. An AI answer
or a newsroom number often arrives without a source, a licence or a retrieval date. A user cannot
check it, and a team cannot reuse it.

## What statmesh does today

- Pulls public statistics from 27 sources into one catalog and one query layer. Sources include the
  World Bank, IMF, OECD, ILOSTAT, Eurostat, BIS, ECB, UN Comtrade, SEC EDGAR, MoSPI and FRED. Keyless
  sources need no account.
- Lets a user find a series by plain words (search), then read it through SQL, REST, MCP (for AI
  tools), a Python client or a command line.
- Returns every number with its source, licence and retrieval time. The design goal, for a missing
  number, is to say what was searched and point to the closest series. Chat behaviour on this has not
  been tested with a live model.
- Runs on one machine: Parquet files, DuckDB for queries, SQLite for the catalog. A new source is a
  folder with a YAML manifest, often with no code.
- Includes a 200-question benchmark. On the fixture catalog (recorded test responses, not live data)
  it scores 0.795 on recall, answerable, cited and answer rate. This tests the plumbing, not real
  coverage.
- Code is licensed under Apache-2.0. Data stays under each source's own licence, which is returned
  with each result.

## What is built but not yet tested

- The hosted read-only mirror (serves only data whose licence allows redistribution). Built; not
  deployed.
- Docker compose, nginx and the deploy kit. Not run.
- Live calls to keyed sources (FRED, BLS, Census, BEA, EIA, Data Commons and others). Their test
  responses were written by hand from the documented format.
- Chat with a real language model, and the benchmark's LLM grading (`bench --llm`).
- The opt-in Python sandbox, which has been tested only with a fake process, not a Docker daemon.
- Share links: covered by the offline test suite only.

## Who it is for

- Journalists who need a checkable number on deadline.
- NGO and policy analysts who join sources by country and year and export a CSV.
- Students who compare series without learning 27 portals.
- Developers and AI tools that need one interface in place of 27 APIs.

## Plan (not yet done)

- Three pilots (a newsroom, an NGO and a university course), each two weeks, measured by cited answers
  per week, time to a cited number, and the share of answers where data was missing.
- Five outside contributors who maintain connectors.
- A deployed hosted mirror, and published setups for AI desktop apps.

## What we are asking for

[PLACEHOLDER: amount requested and period. Insert from budget.md after the amounts are checked.]

## Team and contact

- Lead: [PLACEHOLDER: name and role]
- Contributors: [PLACEHOLDER]
- Fiscal host: [TO CONFIRM: none in place as of this draft]
- Contact: [PLACEHOLDER]

## Unverified claims

Check each of these against the funder's own site before sending. None is confirmed.

- Whether this funder accepts the project, and under which call or programme (name and current status).
- Eligibility: where the applicant or project must be based, and whether a fiscal host is required.
- Deadlines and submission windows.
- Funding amounts, ceilings and any match requirement.
- Whether Apache-2.0 for the code is accepted by this funder.
- The "27 sources" count and the 0.795 benchmark figure, which come from the repository's own files
  and were not checked against any third party.
- Every claim about the sources' licences (`yes`, `review`, `no`), which come from the connector
  manifests and have not been checked against each source's terms.
