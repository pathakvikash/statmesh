"""Build a catalog + parquet store from the connectors' recorded fixtures, fully offline.

    uv run python -m statmesh.testing.fixture_catalog [out_dir]   # default evals/ -> fixture_catalog.sqlite

Per source: discover(limit=20), then every dataset named in fixtures/requests.yaml is ingested
(or fetched on demand for ON_DEMAND sources). A source/dataset that fails is skipped and reported.
"""

from __future__ import annotations

import contextlib
import io
import shutil
import sys
from collections import defaultdict
from pathlib import Path

from statmesh.core.catalog import Catalog
from statmesh.core.connector import load_connector
from statmesh.ingest.ondemand import fetch_on_demand
from statmesh.ingest.runner import discover, ingest
from statmesh.settings import Settings
from statmesh.testing.fixtures import fixtures_dir, load_requests, replay_http

ON_DEMAND = {"comtrade"}  # remote-only sources: rows land in the cache, not obs/
# The sources behind evals/fixture_catalog.sqlite: pinned so the eval's expected keys do not drift
# when a connector is added or re-recorded. (worldbank: discover fixtures stale, 2026-11-19; who_gho: archived
# indicators only.)
EVAL_SOURCES = [
    "bea", "bis", "bls", "census", "comtrade", "datacommons", "dbnomics", "ecb", "eia", "esef",
    "eurostat", "faostat", "fred", "ilostat", "imf", "mospi", "oecd", "sec_edgar", "unsdg",
]  # fmt: skip
LIMIT = {"cdc_data": 5, "open_canada": 5}  # the fixtures were recorded with these discover limits
KEYLESS = {"comtrade"}  # fixtures are the keyless preview even if the dev has a key in env


def build(data_dir: Path, sources: list[str] | None = None) -> tuple[Settings, dict[str, str]]:
    """Fill data_dir; returns (settings, {source or source/dataset: error}) for what was skipped."""
    settings = Settings(data_dir=Path(data_dir).resolve())
    cat = Catalog(settings.data_dir / "catalog.sqlite")
    errors: dict[str, str] = {}
    with (
        contextlib.redirect_stdout(io.StringIO()),
        contextlib.redirect_stderr(io.StringIO()),
    ):  # sdmx1 prints parse warnings
        _build(settings, cat, sources, errors)
    cat.close()
    return settings, errors


def _build(settings: Settings, cat: Catalog, sources: list[str] | None, errors: dict) -> None:
    for sid in sources or EVAL_SOURCES:
        try:
            reqs = load_requests(fixtures_dir(sid, settings))
        except OSError:
            continue  # no fixtures
        http, conn = replay_http(sid, settings), load_connector(sid, settings)
        if sid in KEYLESS:
            http.key = None
        try:
            discover(sid, settings, cat, http=http, connector=conn, limit=LIMIT.get(sid, 20))
        except Exception as e:  # noqa: BLE001 - report and carry on with the next source
            errors[sid] = f"discover: {type(e).__name__}: {e}"
            continue
        by_ds = defaultdict(list)
        for r in reqs:
            by_ds[r.dataset_id].append(r)
        for did, rs in by_ds.items():
            try:
                if sid in ON_DEMAND:
                    for r in rs:
                        fetch_on_demand(r, sid, settings, cat, http=http, connector=conn)
                else:
                    ingest(sid, did, settings, cat, http=http, connector=conn, requests=rs)
            except Exception as e:  # noqa: BLE001
                errors[f"{sid}/{did}"] = f"{type(e).__name__}: {e}"


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "evals")
    tmp = out / ".fixture_build"
    shutil.rmtree(tmp, ignore_errors=True)
    _, errs = build(tmp)
    for k, v in errs.items():
        print("SKIPPED", k, v, file=sys.stderr)
    shutil.copy(tmp / "catalog.sqlite", out / "fixture_catalog.sqlite")
    shutil.rmtree(tmp)
    print("wrote", out / "fixture_catalog.sqlite")
