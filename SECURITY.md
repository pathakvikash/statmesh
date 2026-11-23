# Security policy

## Supported versions

Security fixes go to the latest release and to `main`. Older releases do not get fixes; upgrade
to the latest release.

## Reporting a vulnerability

Do not open a public issue, discussion or pull request for a security problem.

Report it through GitHub's private vulnerability reporting: on the repository's **Security** tab,
choose **Report a vulnerability**. This sends the report only to the maintainer.

If you cannot use GitHub, contact the maintainer at <maintainer-contact>.

Include:

- the version (`statmesh --version`) and how you ran it (self-hosted, hosted mirror, MCP, API);
- the steps to reproduce, or a proof of concept;
- what an attacker could read, change or reach;
- whether you have shared the report elsewhere.

The maintainer aims to acknowledge a report within a week and to agree on a fix and a disclosure
date with you. That is an aim, not a guaranteed service level.

## Scope

In scope:

- SQL that escapes the read-only allow-list in `query/`;
- a licence check that can be bypassed, so restricted data is served (`core/licence.py`);
- a path or URL that reaches files or hosts it should not (for example `file://` in hosted mode, or
  a connector folder reading outside its own folder);
- API keys or secrets that appear in responses, logs, fixtures or the catalog;
- injection through a connector's response data into the API, MCP tools or the sandbox;
- the SQL sandbox (`query/sqlsafe.py`, DuckDB lock-down in `query/engine.py`);
- hosted mode: on-demand fetch, sandbox or server-key settings that can be turned on by a client;
- the host allowlist: a request that reaches a host outside it (SSRF, redirects);
- the AI proxy: key leakage, or use of a server key without `STATMESH_ALLOW_SERVER_KEY=1`.

Out of scope: issues that need a deliberately misconfigured host, and findings in upstream
providers' APIs (report those to the provider).

## Secrets

Never commit a real key, a `.env` file or a live response that contains a key. The contract suite
fails if a fixture contains a secret. If you find a committed key, report it as above; the key
should be rotated at its provider.

## Connectors

A writable `STATMESH_CONNECTORS_DIR` already means code execution: a connector is Python that the
service runs. `file://` URLs add no new attack surface beyond that.
