# W0 implementation notes (read before coding a later wave)

What W0 built differs from or adds to PLAN.md §4 in these ways. The code is the truth; these notes point at it.

## Environment
- Run everything as: `export UV_CACHE_DIR=$TMPDIR/uvcache; uv run --offline <cmd>` (set it in every Bash call; shell env doesn't persist). `~/.cache/uv` is not writable in the sandbox.
- Versions: duckdb 2.0.0, mcp 2.3.0, pyarrow 26.0.1, sdmx1 2.28.0, pydantic 2.14.3, httpx 0.28.1, pycountry 26.2.16, croniter 7.0.0, ruff 0.17.5. Read the installed API before relying on PLAN.md guesses (mcp server API, duckdb lock-down settings).
- `pyproject.toml` is owned by the orchestrator. Do not edit it; if you need a dependency or config change, say so in your report.
- Tests are offline (pytest-socket). `--import-mode=importlib` is on, so every connector can have `tests/test_contract.py`.
- Do not touch `.git` and do not commit. `.env` holds real keys: never print it, never put keys in fixtures.

## Contracts
- CLI targets are `fn(args: argparse.Namespace) -> int | None` (including serve and run_stdio). Missing ones print "not built yet".
- Generic connector classes are `SdmxConnector`, `FileConnector`, `CkanConnector`, `SocrataConnector`, constructed `(manifest, dir)`; `load_connector` resolves them.
- HttpClient: 429 after retries raises `RateLimited` (carries Retry-After); other non-2xx raise `httpx.HTTPStatusError`. Per-second limit = min spacing, no burst. Cache key hashes the redacted URL+params. `with_budget(deadline=...)` takes a `time.monotonic()` value.
- Connectors send keys as `params={"api_key": http.key}` (or a header) and set `RawChunk.params` with the key replaced by `"REDACTED"`.
- Fixtures: `<connector>/tests/fixtures/requests.yaml` is a YAML list of FetchRequest fields. Lookup key = sha256[:16] of method, URL without query, sorted params (secret → REDACTED), plus a body hash for POST. `replay_http` uses placeholder key `replay-key` and zeroes rate limits. `RecordingTransport` writes redacted copies to disk.
- `ContractSuite` has an overridable `settings()`.
- periods: `2024-25` = Apr–Mar fiscal; `2011-12` = Dec 2011 unless a fiscal start month is given; `2024Q2`, `2024S1` accepted.
- geo: `to_geo(code, "iso3")` returns `region:<code>` for codes in regions.csv; `find_geos_in_text` matches country names only (use `group_members` for G20/EU27).
- Catalog: `upsert_source` before `upsert_discovery` (else KeyError). `fts` returns dicts with `series_key, source_id, title, score` (higher = better) plus series columns (NULL for dataset rows); it doesn't join dataset status. `licence_for` accepts `source:dataset`. Timestamps `YYYY-MM-DDTHH:MM:SSZ`. One connection, RLock, `BEGIN IMMEDIATE`.
- Storage: ingest may delete only parts that are in neither the old nor the new manifest. `update_manifest` writes nothing if the body raises.
- `STATMESH_CONNECTORS_DIR` overrides bundled connectors with the same id; `STATMESH_DISABLE` removes ids.

## Review fixes
- `Storage.abs` raises ValueError for paths outside data_dir; `save_raw` rejects `/`, `\\`, `..` in source/dataset ids. `connector_dir`/`load_connector` raise KeyError for ids not matching `models._ID_RE`; `load_connector` raises KeyError for ids in `settings.disabled`.
- `Storage.delete_unreferenced(rel_dir, keep, *, grace_s=None)` now also keeps every path in the current manifest and any file younger than `storage.GRACE_S` (600 s). Tests that expect immediate deletion pass `grace_s=0` or monkeypatch `statmesh.core.storage.GRACE_S`.
- HttpClient never follows redirects via httpx: they are followed by hand (max 10) and headers carrying the key (and Authorization/Cookie) are dropped on a host change or https->http. `redact` covers raw, quote and quote_plus forms; HTTPStatusError messages are built from the URL without query plus redacted params.
- An exhausted `with_budget` deadline makes the next request raise `TimeoutError` (not RateLimited); per-request timeout = min(30, deadline - now); retry backoff sleeps go through the budget (RateLimited if they would not fit).
- HTTP cache key includes non-secret request headers (Accept...); cached files are gzip(content-type + "\n" + body). Old cache files are never hit again.
- `get_http` clients are keyed on `catalog.path`.
- `replay_http` uses the placeholder key `replay-key` whenever `auth == "free_key"`, even with `key_required: false`. Connectors that branch on `http.key` (BLS: v2 when a key is set) now take the keyed path in replay, so their fixtures must be recorded with the key (REDACTED in the body).
- `find_geos_in_text`: US/UK/UAE/DRC/U.S./U.K. match only in capitals; bare "America" does not match inside Latin/North/South/Central America.
- `parse_period`: "1999-00" is fiscal 1999-2000; "2024M03" and "2024-M03" are months.
- `RecordingTransport` honours proxy env (HTTP(S)_PROXY, NO_PROXY) per request.
- cli `_dispatch`: only a missing module/attribute lookup prints "not built yet"; errors raised while importing the target module surface.
