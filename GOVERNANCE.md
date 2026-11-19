# Governance

## Who decides

statmesh has a single maintainer for now. The maintainer merges changes, cuts releases and
decides what is in scope. Contributors propose changes by pull request or issue; the maintainer
reviews them. This will change if the project gains more maintainers, and this file will change
with it.

## Where decisions are recorded

Every decision that changes behaviour, a licence value, a connector name or the sandbox goes in
[docs/DECISIONS.md](docs/DECISIONS.md), with the reason and the date. A decision there overrides
the plan. Before you change a licence value, a connector name or the sandbox, read that file.

The planning documents in `docs/` (`PLAN.md`, `M2_PLAN.md`, `M3_PLAN.md`) record what was intended
at each milestone. They are not updated after the fact.

## Licence policy

A source's licence decides whether its data may be served, and to whom. The rules:

1. **Unknown terms default to `review`.** If you cannot tell from the provider's terms whether
   redistribution is allowed, the connector says `redistribute: review`. Review data is not
   served by the hosted mirror.
2. **`yes` only after verification.** A source gets `redistribute: yes` only after someone has read
   the terms at the URL in the manifest, and the PR states the date. Model knowledge or a secondary
   source is not verification.
3. **`no` when the terms forbid redistribution**, and for paid data.
4. **Attribution is required** and comes from the manifest. The licence name and URL are required.
5. A series or dataset with its own licence keeps that licence; the most specific level wins (see
   [docs/connectors.md](docs/connectors.md)).

If a verified `yes` later proves wrong, the maintainer changes it to `review` or `no` in a PR and
records the decision in `docs/DECISIONS.md`.

## Adding or removing a source

- Anyone can propose a source. Start from [docs/good-first-sources.md](docs/good-first-sources.md)
  or the new-source issue form, and follow [docs/first-connector.md](docs/first-connector.md).
- A source is removed when its terms stop allowing use, when it no longer works, or when the
  maintainer decides it does not fit. The removal is a DECISIONS entry.

## Security

Report security problems privately, as described in [SECURITY.md](SECURITY.md). Do not raise them
in a public issue or pull request.

## Conduct

Everyone taking part follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Reports go to the contact
listed there.
