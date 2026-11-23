#!/usr/bin/env python3
"""Check a statmesh data dir: catalog opens, schema tables, licence fields, parquet files.

    uv run python scripts/verify_data.py DATA_DIR [--hosted] [--json]

--hosted also fails on any dataset with data whose effective redistribute is not 'yes'
(the same rule as `statmesh mirror --prune`; it calls mirror.prune in dry-run mode).
Read-only. Exit 0 = ok, 1 = problems, 2 = no catalog.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

import pyarrow.parquet as pq

from statmesh.core.catalog import Catalog
from statmesh.core.models import Manifest
from statmesh.core.storage import Storage, _paths
from statmesh.ingest.mirror import prune
from statmesh.settings import Settings

REQUIRED = ("sources", "datasets", "series", "lineage", "cache_entries")


def verify(data_dir: Path, hosted: bool = False) -> dict:
    data_dir = Path(data_dir).resolve()
    errors: list[str] = []
    counts: dict[str, int] = {}
    parquet = {"files": 0, "rows": 0}
    out = {"data_dir": str(data_dir), "errors": errors, "counts": counts, "parquet": parquet}
    cat_file = data_dir / "catalog.sqlite"
    if not cat_file.is_file():
        errors.append("catalog.sqlite missing")
        return out
    try:
        cat = Catalog(cat_file, readonly=True)
        have = {r["name"] for r in cat._all("SELECT name FROM sqlite_master WHERE type='table'")}
    except sqlite3.Error as e:
        errors.append(f"catalog.sqlite does not open: {e}")
        return out
    try:
        want = {k for k in REQUIRED}
        for t in sorted(want - have):
            errors.append(f"missing table: {t}")
        if "sources" not in have or "datasets" not in have:
            return out
        for t in sorted(want & have):
            counts[t] = cat._one(f"SELECT count(*) n FROM {t}")["n"]
        srcs = {r["id"]: r for r in cat._all("SELECT * FROM sources")}
        for s in srcs.values():
            for f in ("licence_name", "licence_url", "redistribute", "attribution"):
                if not str(s[f] or "").strip():
                    errors.append(f"source {s['id']}: empty {f}")
        for d in cat._all("SELECT * FROM datasets"):
            key = f"{d['source_id']}/{d['dataset_id']}"
            if d["source_id"] not in srcs:
                errors.append(f"dataset {key}: unknown source")
            elif not (d["redistribute"] or srcs[d["source_id"]]["redistribute"]):
                errors.append(f"dataset {key}: no effective licence")
        refs = {p for p in _paths(Storage(data_dir).read_manifest()) if p.endswith(".parquet")}
        if "cache_entries" in have:
            refs |= {r["part_path"] for r in cat._all("SELECT part_path FROM cache_entries")}
        for rel in sorted(refs):
            try:
                p = Storage(data_dir).abs(rel)
            except ValueError as e:
                errors.append(str(e))
                continue
            if not p.is_file() or p.stat().st_size == 0:
                errors.append(f"parquet missing or empty: {rel}")
                continue
            try:
                parquet["rows"] += pq.ParquetFile(p).metadata.num_rows
                parquet["files"] += 1
            except Exception as e:  # noqa: BLE001 - corrupt file is a finding
                errors.append(f"parquet unreadable: {rel}: {e}")
        if hosted:
            manifests = {}
            for sid, s in srcs.items():
                try:
                    manifests[sid] = Manifest.model_validate_json(s["manifest_json"])
                except ValueError:
                    pass  # licence columns still checked by prune
            for k in prune(Settings(data_dir=data_dir), cat, manifests, dry_run=True):
                errors.append(f"hosted: {k} has redistribute != yes")
    finally:
        cat.close()
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("data_dir", type=Path)
    ap.add_argument("--hosted", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    r = verify(a.data_dir, a.hosted)
    if a.json:
        print(json.dumps(r, indent=1))
    else:
        for k, v in r["counts"].items():
            print(f"{k}: {v} rows")
        print(f"parquet: {r['parquet']['files']} files, {r['parquet']['rows']} rows")
        for e in r["errors"]:
            print(f"FAIL {e}", file=sys.stderr)
        print("OK" if not r["errors"] else f"{len(r['errors'])} problem(s)")
    if r["errors"]:
        return 2 if r["errors"] == ["catalog.sqlite missing"] else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
