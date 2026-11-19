DRAFT, NOT SENT

# NLnet NGI Zero application: statmesh (draft)

**Target:** the NGI Zero call that fits open-source infrastructure. [TO CONFIRM: which call, and whether
it is open.] This draft follows a general application structure; use the funder's own form and field
names.

## Project name and links

- Name: statmesh
- Repository: [PLACEHOLDER: repository URL]
- Licence: Apache-2.0 for the code. Data stays under each source's own licence.

## Abstract

statmesh pulls public statistics from 27 sources, such as the World Bank, IMF, OECD, ILOSTAT, Eurostat,
BIS, ECB, UN Comtrade, SEC EDGAR, MoSPI and FRED, into one catalog with one query layer. A user finds
a series by search and reads it through SQL, a REST API, an MCP server for AI tools, a Python client
or a command line. Each number comes back with its source, licence and retrieval time. It runs on one
machine using Parquet, DuckDB and SQLite.

## The problem

Public statistics are spread across portals with different codes, licences and formats. AI answers
and published numbers often lose the source. Re-using a figure means checking each portal by hand.

## What exists today

- 27 source connectors. Ten are configuration only (SDMX, file, CKAN and Socrata kinds); 17 have
  custom code.
- Query surfaces: SQL, REST with OpenAPI, MCP over stdio and HTTP, a Python client and a CLI.
- An offline test suite (803 tests at v0.3.0) and a 200-question benchmark. On the fixture catalog the
  benchmark scores 0.795. The fixture catalog is built from recorded test responses, so this tests the
  plumbing, not real coverage.
- Licences are recorded per source and per dataset in each connector's manifest, and returned with
  each result. A hosted mirror mode serves only data whose licence allows redistribution (built, not
  deployed).

## What is not yet tested

- Docker compose, nginx and the deploy kit have not been run. The hosted mirror is not deployed.
- Live calls to keyed sources have not been run; several keyed sources have test responses written by
  hand from the documented format.
- Chat with a real language model, and LLM grading in the benchmark, have not been run.
- The Python sandbox has not been tested on a real Docker daemon.

## Plan for the funding

Work that this grant would pay for, all labelled as planned:

1. Deploy and test the hosted mirror, including the Docker and nginx checks.
2. Live smoke tests for keyed sources, with results published.
3. Connector maintenance: [PLACEHOLDER: number] new sources and upkeep for existing ones.
4. A security review of the hosted deploy and the sandbox.
5. Three two-week pilots with feedback forms.

Amounts and the period come from `budget.md` once they are checked: [PLACEHOLDER: amount, period].

## Team

- Lead: [PLACEHOLDER: name, role, relevant experience]
- Contributors: [PLACEHOLDER]

## Milestones

| Milestone | Date |
|---|---|
| Hosted mirror deployed and tested | [PLACEHOLDER] |
| Live smoke tests published | [PLACEHOLDER] |
| Security review done | [PLACEHOLDER] |
| Pilot reports published | [PLACEHOLDER] |

## Unverified claims

- Which NGI Zero call fits, whether it is open, and its deadline. Check the funder's call page.
- Eligibility: where applicants or projects must be based, and whether the project must serve a
  European public-interest goal. Check the call's eligibility text.
- Whether an unaffiliated individual or a non-profit can apply, or whether a fiscal host is required.
- The maximum amount and the grant period.
- Whether the funder's form asks for a specific licence, a security statement or a data policy.
- Every number in this draft (27 sources, 803 tests, 200 questions, 0.795) comes from the repository's
  files. It has not been checked by a third party.
- Licence readings for each source, which come from the connector manifests and have not been checked
  against each source's terms.
