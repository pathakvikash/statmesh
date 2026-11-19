"""In-process scheduler for the worker: croniter over manifests' refresh.schedule, state in the
catalog `jobs` table (so it is idempotent across restarts and safe to tick repeatedly)."""

from __future__ import annotations

import argparse
import sys
import time
from collections.abc import Callable, Collection
from datetime import datetime

from statmesh.core.catalog import Catalog, iso
from statmesh.core.connector import Connector, list_connectors, load_connector
from statmesh.core.http import HttpClient, get_http
from statmesh.ingest.mirror import effective_redistribute
from statmesh.ingest.ondemand import sweep_cache
from statmesh.ingest.runner import next_cron, now_utc, open_catalog, run_job
from statmesh.settings import Settings


def seed_jobs(catalog: Catalog, connectors: dict[str, Connector], now: datetime) -> None:
    """One job per core dataset of every connector with a schedule. A dataset never ingested is
    due immediately; otherwise its first run is the next cron slot. Existing jobs are untouched."""
    for sid, c in connectors.items():
        m = c.manifest
        if m.core_datasets and not m.refresh.schedule:
            print(
                f"scheduler: {sid} has core_datasets but no refresh.schedule; never refreshed",
                file=sys.stderr,
            )
        for d in m.core_datasets if m.refresh.schedule else ():
            if catalog.get_job(sid, d) is None:
                ds = catalog.get_dataset(sid, d)
                first = next_cron(m, now) if ds and ds["status"] == "ingested" else now
                catalog.set_job(sid, d, state="idle", next_run_at=iso(first))


def tick(
    settings: Settings,
    catalog: Catalog,
    now: datetime | None = None,
    *,
    sources: Collection[str] | None = None,
    load: Callable[[str, Settings], Connector] = load_connector,
    http_for: Callable[[str, Settings, Catalog], HttpClient] = get_http,
) -> list[tuple[str, str, bool]]:
    """Seed jobs, sweep the on-demand cache, run every due job. Returns (source, dataset, ok)."""
    now = now or now_utc()
    connectors: dict[str, Connector] = {}
    for s in sources if sources is not None else list_connectors(settings):
        try:
            connectors[s] = load(s, settings)
        except Exception as e:  # noqa: BLE001 - one broken connector must not stop the worker
            print(f"scheduler: cannot load {s}: {e}", file=sys.stderr)
    seed_jobs(catalog, connectors, now)
    sweep_cache(settings, catalog, now=now)
    done = []
    for job in catalog.due_jobs(now):
        s, d = job["source_id"], job["dataset_id"]
        if s not in connectors:
            continue
        if settings.mode == "hosted" and effective_redistribute(connectors[s].manifest, d) != "yes":
            continue  # a hosted box never holds data it may not serve
        ok = run_job(s, d, settings, catalog, now=now, connector=connectors[s],
                     http=http_for(s, settings, catalog))  # fmt: skip
        done.append((s, d, ok))
    return done


def run_forever(
    args: argparse.Namespace | None = None,
    *,
    interval: float = 30.0,
    stop: Callable[[], bool] = lambda: False,
) -> int:
    settings = Settings.from_env()
    settings.validate()
    catalog = open_catalog(settings)
    now = iso(now_utc())  # a job left 'running' by a crashed worker is retried now
    for r in catalog.conn().execute("SELECT source_id, dataset_id FROM jobs WHERE state='running'").fetchall():  # fmt: skip
        catalog.set_job(r[0], r[1], state="failed", next_run_at=now)
    try:
        while not stop():
            for s, d, ok in tick(settings, catalog):
                print(f"{s}/{d}: {'ok' if ok else 'failed'}", flush=True)
            time.sleep(interval)
    except KeyboardInterrupt:
        pass
    return 0
