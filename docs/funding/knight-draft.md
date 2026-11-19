DRAFT, NOT SENT

# Knight Foundation application: statmesh (draft)

**Target:** a Knight Foundation journalism programme. [TO CONFIRM: which programme, and whether it
takes unsolicited proposals or requires a letter of inquiry first.] This draft follows a general
structure; use the funder's own form and field names.

## Project name and links

- Name: statmesh
- Repository: [PLACEHOLDER: repository URL]
- Licence: Apache-2.0 for the code. Data stays under each source's own licence.

## Summary

Newsrooms need numbers they can check on deadline. statmesh is open-source software that pulls public
statistics from 27 sources into one catalog. A reporter searches in plain words, then gets a number
with its source, licence and retrieval time. It can also export a CSV. It runs on
one machine, and a hosted read-only mirror is built but not yet deployed.

## The problem for journalists

- Public statistics are published in many portals, with different codes and licences.
- A number without its source is hard to check, hard to correct and risky to publish.
- AI tools often give fluent answers without sources. statmesh's chat page is designed to flag numbers
  that no tool result backs. That chat has not been run with a live model.

## What exists today

- 27 source connectors, including the World Bank, IMF, OECD, ILOSTAT, Eurostat, BIS, ECB, SEC EDGAR,
  MoSPI and FRED. Keyless sources need no account.
- Search in plain words; SQL, REST, MCP, a Python client and a CLI.
- Offline tests (803 at v0.3.0) and a 200-question benchmark. On the fixture catalog it scores 0.795,
  which tests the plumbing, not real coverage.
- A demo that runs offline on recorded test responses, with eight questions in a newsroom brief.

## What is not yet tested

- The hosted mirror and the Docker and nginx deploy kit have not been run.
- Live keyed sources, and chat with a real language model, have not been run.
- Share links, which let a reader see an answer, are covered by the offline tests only.

## What the grant would fund

Planned work, not yet done:

1. A newsroom pilot of two weeks with [PLACEHOLDER: newsroom partner, if one agrees], measuring cited
   answers per week, time to a cited number, and the share of answers where data was missing.
2. Documentation and a short guide for reporters.
3. Deploying and testing the hosted mirror.
4. Live checks for the keyed sources that newsrooms use most.

Amount and period: [PLACEHOLDER, from budget.md once checked].

## Team and contact

- Lead: [PLACEHOLDER: name, role, newsroom experience if any]
- Fiscal host: [TO CONFIRM: none in place as of this draft]
- Contact: [PLACEHOLDER]

## Unverified claims

- Which Knight Foundation programme fits, whether it is open, and its deadline. Check the programme page.
- Whether Knight funds projects outside its named geographies, and whether it funds open-source
  software or only organisations.
- Whether an unaffiliated individual or a non-profit can apply, or whether a fiscal host is required.
- The grant range and the period.
- Whether a letter of inquiry is needed before a full proposal.
- Every number in this draft (27 sources, 803 tests, 200 questions, 0.795) comes from the repository's
  files and has not been checked by a third party.
- Licence readings for each source, from the connector manifests, not checked against each source's
  terms.
- Any claim that a newsroom will take part. No pilot has been agreed.
