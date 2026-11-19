# Decisions

Date: 2026-11-19. Answers to questions raised by the coding agents. Where a decision differs from `docs/PLAN.md`, this file wins; PLAN.md is not edited.

Paths are relative to the repo root; `C/` means `src/statmesh/connectors/`.

## 1. MoSPI licence: move to `redistribute: yes`

- **Decision:** `yes` for the NSO statistical datasets in the manifest (PLFS, CPI, WPI, IIP, NAS, ASI). The RBI dataset, if 4F adds it, gets a dataset-level `redistribute: review`.
- **Why:** The Category A terms as translated (reuse and commercial redistribution without permission, with attribution) are exactly what `yes` means. RBI content is not NSO's to license.
- **Not verified by me:** this rests on the agent's translation of the Hindi page. I did not re-read mospi.gov.in/CopyrightPolicy, and nothing confirms that every API dataset is Category A.
- **Change:** `C/mospi/manifest.yaml`
  - `redistribute: yes`
  - `attribution: "Source: Ministry of Statistics and Programme Implementation (MoSPI), Government of India. Data reformatted by statmesh; not endorsed by MoSPI."` The "reformatted" clause covers the modified-data condition, since we normalise periods and units.
  - Add a one-line comment: no MoSPI logo in the web UI or docs.
- **Before hosted launch:** someone who reads Hindi confirms the Category A reading and its scope.

## 2. DBnomics stays `review`; direct BIS connector is `yes` and preferred for Q4

- **Decision:**
  - DBnomics source default and its `BIS_WS_CBPOL` override both stay `review`.
  - The `bis` SDMX connector ships `redistribute: yes` and becomes the Q4 policy-rate source.
- **Why:** ODbL covers DBnomics' database, not each provider's data, so a blanket `yes` there is wrong. For BIS, the first-party source with verified terms beats an aggregator copy.
- **Verified:** BIS "Terms of permitted use of BIS statistics" at https://data.bis.org/help/legal, read 2026-11-19. Use is unrestricted provided:
  - BIS is cited as the source;
  - use is not misleading and implies no endorsement;
  - in a commercial product, the statistics cause no additional charge to users.
- **Change:**
  - `C/bis/manifest.yaml` (4A, being built): `redistribute: yes`, `licence.url: https://data.bis.org/help/legal`, `attribution: "Source: Bank for International Settlements (BIS)"`, core dataflow `WS_CBPOL`, and a comment recording the no-additional-charge condition.
  - `tests/acceptance/` Q4: read policy rates from `bis` and expect `bis` in `citations[]`.
  - `C/dbnomics/manifest.yaml`: set `core_datasets: []` once `bis` passes its contract suite. Keep the BIS fixtures as the DBnomics contract test.
- **Until `bis` lands:** Q4 keeps using DBnomics. This is fine in self-host mode.

## 3. Connector folder names: accept all three

- **Decision:** keep `census`, `open_canada` and `cdc_data`. No renames.
- **Why:** `census` matches the unprefixed `bea` and `eia`. The 4D goal was "two sample portals pass the contract suite", not those two specific portals, and the planned ones are unreachable or broken.
- **Change:** no code change. In 5C, the README sources table and `CHANGELOG.md` use the real names and state that `datagov_us` and `nyc_opendata` were replaced, and why. PLAN 4B and 4D names are superseded by this entry.

## 4. FRED copyright mapping: accept as default, flagged unverified

- **Decision:** keep the mapping: pre-approval → `no`, citation required → `review`, public domain → `yes`, no tag → `review`.
- **Why:** it matches PLAN 2C, and every unknown lands on the conservative side, so a wrong guess can only under-serve in hosted mode.
- **Not verified:** the tag strings were written from memory, with no API key.
- **Change:**
  - `C/fred/connector.py`: no logic change. Confirm the match is a case-insensitive substring on the tag name, and add a comment that the strings are unverified against live `/fred/series/tags`.
  - `C/fred/` smoke test (`-m live`): assert that one known public-domain series (e.g. `UNRATE`) resolves to `yes` and one known copyrighted series resolves to `no` or `review`. The first run with a real key verifies the mapping.

## 5. Sandboxed Python: accept as built

- **Decision:** off by default, self-host only, refused outright in `hosted` mode.
- **Why:** this is PLAN 4G as written. The socket risk is acceptable only when the operator opts in on their own machine.
- **Change:** docs only, in `docs/` (5C sandbox page) plus a comment beside `STATMESH_PYTHON_SANDBOX` in `.env.example`. The docs must say:
  1. Enabling it requires giving the API process the Docker socket, which is root-equivalent on the host. Anyone who can make the API run arbitrary `docker` commands owns the machine.
  2. Turn it on only on a single-operator machine where every user who can reach `/python` or the MCP `run_python` tool is trusted. Never turn it on for an instance reachable from the internet or a shared network.
  3. The container limits (no network, read-only data mount, 30 s, 512 MB, 128 pids) restrict the submitted code. They are not a defence against a container escape or against misuse of the socket itself.
  4. It is disabled in `STATMESH_MODE=hosted` regardless of the flag.
  5. The default `docker-compose.yml` does not mount the socket. Enabling means adding the mount yourself, and the docs show the exact lines. Rootless Docker or Podman is the recommended way to reduce the blast radius.
- **Check:** `docker-compose.yml` must not mount `/var/run/docker.sock` by default. If it does, move the mount to a commented block.

## 6. Search eval catalog: build in CI, do not commit the sqlite

- **Decision:** generate `evals/fixture_catalog.sqlite` from connector fixtures on every CI run. The file is git-ignored.
- **Why:** a committed binary goes stale silently when fixtures or schema change, and is unreviewable in diffs. Building takes seconds through the existing 3A fixture data-dir builder.
- **Change:**
  - `.github/workflows/ci.yml`: add a build step before the eval that calls the `tests/acceptance` fixture builder and writes `evals/fixture_catalog.sqlite`. Delete the `if [ -f … ] else skip` branch, so a missing catalog fails CI instead of skipping the recall gate.
  - `.gitignore`: add `evals/fixture_catalog.sqlite`.
  - Expose the builder as one callable or CLI entry (e.g. `python -m statmesh.search.eval --build <path>`) by reusing the 3A session-fixture code, not a second builder.

## 7. Comtrade `per_day: 500`: accept

- **Decision:** keep 500 per day for both keyed and keyless preview.
- **Why:** 500 is the free-key allowance from the plan. Applying it to preview is a guess, but a 30-day cache keeps real usage far below it, and a wrong guess costs only a 429.
- **Change:** `C/comtrade/manifest.yaml`: extend the existing comment to say the preview limit is undocumented and the value is assumed. In `C/comtrade/connector.py`, confirm a 429 is surfaced as `retry_after` and not retried in a loop. No other change.

## 8. OECD: confirm weekly full refresh, core capped at 5

- **Decision:** keep the weekly Monday 02:00 schedule and the ≤5 core dataflow cap. Use full refresh, since `updatedAfter` returns 403.
- **Why:** five full downloads a week against a 60 per hour budget is nowhere near the limit. Reducing core further buys nothing. Core currently holds one dataflow.
- **Change:** `C/oecd/manifest.yaml`: set `refresh.incremental: false` (or remove the key) with a comment `updatedAfter returns 403 (2026-11)`. Keep `schedule: "0 2 * * 1"`. No change to `core/generic/sdmx.py`.
- **Ceiling:** each core dataflow must be a filtered key, not a whole multi-GB flow. If a full pull of one flow exceeds about 200 MB, narrow its `key` template instead of dropping it.

## 9. MCP DNS-rebinding protection: re-enable with an allow-list

- **Decision:** turn protection back on, driven by `STATMESH_ALLOWED_HOSTS`.
  - Default: `localhost:*,127.0.0.1:*,[::1]:*,api:*` (`api` is the compose service name).
  - `STATMESH_ALLOWED_HOSTS=*` is the only way to turn the check off, and it logs a warning at startup.
- **Why:** a default-off check lets any web page the operator visits drive a localhost MCP server. That matters more once `run_python` exists. An allow-list fixes Docker and hosted use without removing the check for laptop users.
- **Change:**
  - `src/statmesh/api/app.py`: replace `enable_dns_rebinding_protection=False` with `TransportSecuritySettings(enable_dns_rebinding_protection=True, allowed_hosts=…, allowed_origins=…)` built from the setting. Origins are derived as `http://<host>` and `https://<host>`. Remove the `ponytail:` comment.
  - Settings module (beside `python_sandbox`): add `allowed_hosts: list[str]`.
  - `.env.example`: add the variable with its default.
  - `docker-compose.yml`: no change needed unless the service is renamed.
  - `tests/api/`: one test that a request with `Host: evil.example` gets 421 and one with `Host: localhost:8000` passes.

## 10. Census population estimates: `pep/population` for vintages 2019 and 2021; no `pep/charv` in v1.1

- **Decision:** ship `pep/population` for vintage 2019, and add vintage 2021 if a live state-level call works. `pep/charv` is deferred. Population after 2021 is served by ACS 5-year total population (`B01003_001E`), which the connector already covers.
- **Why:** `charv` is a different shape (age, sex, race and Hispanic-origin cells, with no documented total-population filter). It is a new normaliser for one series that ACS already provides.
- **Verified:** Census developer pages, read 2026-11-19.
  - Vintage 2019 has `pep/population`.
  - Vintage 2021 has `pep/population` with `POP_2021`. A state-level example was not confirmed.
  - Vintage 2023 has only `pep/charv`.
  - Every Census API query now requires a key.
- **Change:**
  - `C/census/manifest.yaml`: list the PEP vintages explicitly (`[2019, 2021]`), with a comment that 2023 and later moved to `pep/charv` and is deferred.
  - `C/census/connector.py`: handle the `POP_2021` variable name next to 2019's `POP`. If the live `for=state:*` call on 2021 fails, drop 2021 and report it.
  - 5C docs: list the gap under known gaps, pointing to ACS `B01003_001E` for recent years.
  - Confirm `key_required: true` in the manifest.
