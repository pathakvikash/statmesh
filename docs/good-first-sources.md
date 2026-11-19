# Good first sources

Ten issues ready to file. Each is built from a source that M3 rejected or deferred
([docs/M3_PLAN.md](M3_PLAN.md), [docs/PLAN.md](PLAN.md) "Deferred or blocked"). Each one turns
into a real contribution: a dated finding, a licence reading, a decision, or a connector.

Facts about these sources and their licences come from model knowledge in the plan and have not
been verified. Every issue asks the person who takes it to check the terms and say what they found.

To file: copy the title and labels into a new issue with the **New data source** form, or with
no template if the form does not fit. Keep the "Done when" list; it is what makes the issue
closeable.

---

## 1. Confirm the IEA data is paid-only and record the decision

**Labels:** `good first issue`, `research`, `licence`
**Status:** rejected in M3 (paid).

Read the IEA data terms and the price list for the statistics you would want. Say whether any
subset is free to reuse with attribution.

**Done when:** a comment on this issue links the terms and quotes the clause that decides it
(under 15 words); the answer is recorded as a DECISIONS entry in a PR, or as a "no" with the reason.

## 2. Scope a CDC WONDER connector from its public extracts

**Labels:** `good first issue`, `new-source`
**Status:** rejected in M3: POST and XML, small-cell suppression.

WONDER's query tool is POST and XML. Check whether its public extracts or downloadable tables can be
read as a file. Note the small-cell suppression rule and how it shows in the data.

**Done when:** a comment gives the download URL, the file format and the suppression rule; if the
extract works, a file-kind manifest and mapping sketch is attached, with `redistribute` set to
`review` until the terms are read.

## 3. Re-probe the AfDB statistics portal

**Labels:** `good first issue`, `research`
**Status:** rejected in M3: unstable portal.

Probe the African Development Bank statistics portal on three different days. Record the URLs, the
HTTP status codes and whether a bulk download exists.

**Done when:** a dated table of probes is in the issue. If a stable bulk file exists, the issue
proposes a file-kind connector; if not, it closes with the findings.

## 4. Check India NSO coverage against `mospi`

**Labels:** `good first issue`, `research`
**Status:** rejected in M3: `mospi` covers it.

List the statistical datasets NSO publishes and compare them with what `connectors/mospi/` already
serves. Find the ones that are missing.

**Done when:** a table lists each NSO dataset as covered by `mospi` or missing, with the
`mospi` dataset id for each covered one. Missing datasets are proposed as separate issues.

## 5. Read MoSPI's terms and propose a `redistribute` value

**Labels:** `good first issue`, `licence`
**Status:** deferred: `review`, terms unknown.

Find the terms that apply to the MoSPI datasets (the source's own page, and any email the
maintainer has to NSO). Propose `yes`, `no` or `review` with the reason.

**Done when:** a comment gives the terms URL, the date read and a proposed value with the clause
behind it. No change to the manifest is made in this issue; the value changes in a PR only after
the maintainer agrees.

## 6. Confirm whether MoSPI carries the RBI dataset

**Labels:** `good first issue`, `research`
**Status:** conditional, deferred: RBI DBIE is only reached through MoSPI's RBI dataset.

Find out whether MoSPI publishes the RBI dataset and under what id. If it does not, the RBI item
stays deferred.

**Done when:** the dataset id (or "not published") is in a comment with the URL. If it exists, the
proposal says it carries a dataset-level `redistribute: review`, as RBI content is not NSO's to
license (DECISIONS).

## 7. Spike the filings.xbrl.org terms for EU ESEF

**Labels:** `good first issue`, `licence`, `spike`
**Status:** conditional on a spike: if the terms forbid reuse, ship catalogue only with `review`.

Read the terms of the filings.xbrl.org API. Decide whether the data may be served, or only its
catalogue.

**Done when:** a comment quotes the terms URL and the clause that decides reuse, and proposes
"full", "catalogue only" or "blocked", with the reason.

## 8. Size a sample of UK company accounts (iXBRL)

**Labels:** `good first issue`, `research`
**Status:** deferred: the bulk accounts set is tens of GB.

Pick one filing month. Count the files and their total size, and report how many would survive a
filter by company type or by SIC code.

**Done when:** a comment gives the counts and sizes for the month, the filter used, and a
recommendation on whether a filtered sample is worth a connector.

## 9. Read the Comtrade caching terms before hosted mode

**Labels:** `good first issue`, `licence`
**Status:** deferred: legal review before hosted (PLAN.md). FRED third-party series are in the same
row; take them in a separate issue if you want.

Read the UN Comtrade terms on caching and redistribution. Say what a hosted mirror may keep and for
how long.

**Done when:** a comment quotes the clause and its URL and date, and says what the hosted mirror
could and could not keep. It does not change `docs/licensing.md`; that goes in a PR.

## 10. Test the Japan e-Stat API with a free application ID

**Labels:** `good first issue`, `new-source`, `needs key`
**Status:** deferred: e-Stat needs a key (`appId`).

Register for a free application ID if you are willing (the maintainer does not hold a key for you),
then list which tables a key-free request can read. Do not put the ID anywhere in the repo.

**Done when:** a comment lists the tables a key-free request reads, the ones that need the key, and
the response shape of one example. If a key is needed for every table, the issue is closed as
"deferred, needs a maintainer key" and a maintainer is tagged.
