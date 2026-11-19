"""`statmesh mirror`: ingest the core datasets a hosted instance may serve (licence `yes`)."""

from __future__ import annotations

import argparse
import sys

from statmesh.core.connector import list_connectors, load_connector
from statmesh.core.models import Manifest
from statmesh.ingest.runner import _settings_or_none, ingest, open_catalog


def effective_redistribute(m: Manifest, dataset_id: str) -> str:
    """Dataset licence override wins over the source licence."""
    o = m.datasets.get(dataset_id, {}).get("licence")
    return (o.get("redistribute") if isinstance(o, dict) else None) or m.licence.redistribute


def mirror_cmd(args: argparse.Namespace) -> int:
    if (settings := _settings_or_none()) is None:
        return 1
    catalog = None if args.dry_run else open_catalog(settings)
    rc = 0
    for s in list_connectors(settings):
        try:
            conn = load_connector(s, settings)
        except Exception as e:  # noqa: BLE001 - one broken connector must not stop the mirror
            print(f"{s}: cannot load: {e}", file=sys.stderr)
            rc = 1
            continue
        for d in conn.manifest.core_datasets:
            lic = effective_redistribute(conn.manifest, d)
            if lic != "yes":
                print(f"{s}/{d}: skip (redistribute: {lic})")
            elif catalog is None:
                print(f"{s}/{d}: would ingest")
            else:
                try:
                    n = ingest(s, d, settings, catalog, connector=conn)
                    print(f"{s}/{d}: {n} rows")
                except Exception as e:  # noqa: BLE001
                    print(f"{s}/{d}: {type(e).__name__}: {e}", file=sys.stderr)
                    rc = 1
    return rc
