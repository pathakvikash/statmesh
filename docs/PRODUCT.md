# statmesh product thesis

Drafted 19 Nov 2026. Claims about external sources and funders are from model knowledge and have
not been checked.

## Promise

Ask any public-statistics question and get a number with its source, licence, retrieval date and
the query that produced it. When statmesh does not have the number, it says so and points to the
closest series it does have.

## Who it is for

| User | Job |
|---|---|
| Journalists | A number they can check on deadline, with a citation and a chart |
| Students | Find and compare series without learning 27 portals |
| NGO and policy analysts | Join sources on country and year; export a CSV they may redistribute |
| Developers and AI agents | One MCP, REST and SQL interface in place of 27 APIs |

## Why it wins

| Alternative | What it does well | What it lacks that statmesh has |
|---|---|---|
| Our World in Data | Curated charts | SQL, joins across sources, self-hosting as a query layer |
| Data Commons | Broad coverage | A queryable model you can host yourself; a licence gate (Google runs it) |
| FRED | Excellent data | Coverage beyond US macro |
| A chatbot on its own | Fluent answers | Sources. statmesh refuses numbers from memory and flags any number not found in a tool result |

**North-star metric:** cited answers per week, meaning responses on web, MCP or REST that carry at
least one citation.

**Guardrail:** the answer rate on a fixed 200-question benchmark, with zero uncited numbers.

## Funding

**Pitch:** citation infrastructure for AI answers about public statistics.

**Grants:**
- Sloan Foundation
- Chan Zuckerberg Initiative (open-source science)
- Wellcome (health data)
- Gates Foundation
- Patrick J. McGovern Foundation
- Schmidt Sciences
- NLnet / NGI Zero
- Sovereign Tech Agency
- Mozilla
- Knight Foundation (journalism)
- data.org

**Home:** fiscal sponsorship through NumFOCUS or Open Collective, and a listing on the Digital
Public Goods registry.

**Revenue:**
- A hosted tier (see `docs/hosted.md`). The free mirror serves only data whose licence allows
  redistribution.
- Paid plans for higher limits, and private instances for newsrooms and NGOs.
- Sponsors who fund connector maintenance.

## Answering anything: alcohol deaths and snakebite deaths

| Source | Alcohol deaths | Snakebite deaths | Licence |
|---|---|---|---|
| WHO GHO (connector exists) | Alcohol-attributable deaths (`SA_*` indicators) | No country series | review |
| IHME GBD | Yes | Yes ("venomous animal contact") | Non-commercial; no API |
| Our World in Data | Yes | Yes | CC BY, but GBD-derived charts keep IHME's terms; set the licence per chart |
| WHO Mortality Database | Yes (ICD-10) | Yes (X20), registered deaths only | Thin where snakebite kills most |

**Next connectors, by value for the effort:**
1. Our World in Data (`owid`)
2. A larger WHO GHO core list
3. WHO Mortality Database (`who_mortality`)
4. Eurostat causes of death, plus UN population for per-100k rates
5. An IHME GBD file the user imports locally (self-host only)

**When data is missing, chat should:**
- say what it searched
- show the 3 closest series and how each differs from what was asked
- name the source that would hold the data
- never give a number from memory

## Roadmap to v1.0

1. **M1, "It answers": done (commit 8f0653d).**
   - SQL workbench with a schema browser
   - filters on search, sources and chat
   - voice input
   - the `owid` connector and the WHO GHO core list
   - first chat runs against a live model

   Demo: ask both example questions by voice and get a cited chart.
2. **M2, "It's public": built, deploy pending (the user does it; commits 90dbd00, 4c26fe1, f0e7e87, integration in v0.3.0).**
   - the hosted read-only mirror
   - a published 200-question benchmark
   - shareable answer links
   - live smoke tests for sources that need a key
3. **M3, "It's a platform":**
   - 40+ sources and five outside contributors
   - published setups for the Claude and ChatGPT apps
   - three pilot users: a newsroom, an NGO and a university course
   - a fiscal sponsor and two grant applications
