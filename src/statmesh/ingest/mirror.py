"""`statmesh mirror`: ingest the core datasets a hosted instance may serve (licence `yes`)."""

from __future__ import annotations

import argparse
import os
import shutil
import sys

from statmesh.core.catalog import Catalog
from statmesh.core.connector import list_connectors, load_connector
from statmesh.core.models import Manifest
from statmesh.core.storage import Storage
from statmesh.ingest.runner import _settings_or_none, ingest, open_catalog
from statmesh.settings import Settings


def effective_redistribute(m: Manifest, dataset_id: str) -> str:
    """Dataset licence override wins over the source licence."""
    o = m.datasets.get(dataset_id, {}).get("licence")
    return (o.get("redistribute") if isinstance(o, dict) else None) or m.licence.redistribute


def key_missing(m: Manifest) -> bool:
    """True when the source needs a key (as HttpClient demands) and its env var is unset."""
    return m.auth == "free_key" and m.key_required and not os.environ.get(m.key_env or "")


def prune(
    settings: Settings, catalog: Catalog, manifests: dict[str, Manifest], *, dry_run: bool
) -> list[str]:
    """Licence takedown: remove every dataset with data on disk whose effective redistribute is
    no longer 'yes' (the connector manifest or the catalog row says so): catalog rows, obs/tables/
    raw dirs, cache parts, manifest entries. Returns 'source/dataset' keys. Only paths under
    data_dir are touched (Storage.abs refuses escapes). Legacy flat tables/<name>/<source>/part-*
    files hold several datasets and are left alone."""
    st = Storage(settings.data_dir)
    mf = st.read_manifest()
    src = {r["id"]: r["redistribute"] for r in catalog._all("SELECT id, redistribute FROM sources")}
    todo = []
    for r in catalog._all("SELECT source_id, dataset_id, redistribute, status FROM datasets"):
        s, d = r["source_id"], r["dataset_id"]
        key = f"{s}/{d}"
        eff = {r["redistribute"] or src.get(s)}
        if s in manifests:
            eff.add(effective_redistribute(manifests[s], d))
        has_data = (
            r["status"] != "remote"
            or key in mf["obs"]
            or key in mf["cache"]
            or any(
                q.startswith(f"tables/{n}/{s}/{d}/") for n, ps in mf["tables"].items() for q in ps
            )
        )
        if eff != {"yes"} and has_data:
            todo.append((s, d))
    if dry_run or not todo:
        return [f"{s}/{d}" for s, d in todo]
    for s, d in todo:
        key = f"{s}/{d}"
        parts = [r["part_path"] for r in catalog._all(
            "SELECT part_path FROM cache_entries WHERE source_id=? AND dataset_id=?", (s, d))]  # fmt: skip
        with st.update_manifest() as m:
            parts += m["cache"].pop(key, [])
            for sec in ("obs", "vintages", "cut"):
                m.get(sec, {}).pop(key, None)
            for name, ps in m["tables"].items():
                m["tables"][name] = [p for p in ps if not p.startswith(f"tables/{name}/{s}/{d}/")]
        dirs = [f"obs/{s}/{d}", f"raw/{s}/{d}"] + [f"tables/{n}/{s}/{d}" for n in mf["tables"]]
        for rel in dirs:
            shutil.rmtree(st.abs(rel), ignore_errors=True)
        for p in parts:
            st.abs(p).unlink(missing_ok=True)
        catalog.delete_dataset(s, d)
    return [f"{s}/{d}" for s, d in todo]


def mirror_cmd(args: argparse.Namespace) -> int:
    if (settings := _settings_or_none()) is None:
        return 1
    catalog = None if args.dry_run else open_catalog(settings)
    rc = 0
    manifests: dict[str, Manifest] = {}
    for s in list_connectors(settings):
        try:
            conn = load_connector(s, settings)
        except Exception as e:  # noqa: BLE001 - one broken connector must not stop the mirror
            print(f"{s}: cannot load: {e}", file=sys.stderr)
            rc = 1
            continue
        manifests[s] = conn.manifest
        if catalog is not None:
            catalog.upsert_source(conn.manifest)  # a licence change must reach the catalog row
        for d in conn.manifest.core_datasets:
            lic = effective_redistribute(conn.manifest, d)
            if lic != "yes":
                print(f"{s}/{d}: skip (redistribute: {lic})")
            elif key_missing(conn.manifest):
                print(f"{s}/{d}: skip ({conn.manifest.key_env} not set)")
            elif catalog is None:
                print(f"{s}/{d}: would ingest")
            else:
                try:
                    n = ingest(s, d, settings, catalog, connector=conn)
                    print(f"{s}/{d}: {n} rows")
                except Exception as e:  # noqa: BLE001
                    print(f"{s}/{d}: {type(e).__name__}: {e}", file=sys.stderr)
                    rc = 1
    cat_file = settings.data_dir / "catalog.sqlite"
    if getattr(args, "prune", False) and (catalog or cat_file.exists()):
        cat = catalog or Catalog(cat_file, readonly=True)
        try:
            for k in prune(settings, cat, manifests, dry_run=args.dry_run):
                print(
                    f"{k}: {'would remove' if args.dry_run else 'removed'} (redistribute is not yes)"
                )
        finally:
            if catalog is None:
                cat.close()
    return rc
