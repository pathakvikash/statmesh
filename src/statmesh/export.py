"""Export series to CSV/Parquet plus SOURCES.md (citations and licences)."""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

from statmesh.sdk import Client, SdkError, _client, _run


def _sources_md(cites: list[dict]) -> str:
    seen, out = set(), ["# Sources\n"]
    for c in cites:
        k = (c["source_id"], c["dataset_id"], c.get("series_id"))
        if k in seen:
            continue
        seen.add(k)
        out.append(f"## {c['source_name']} / {c['dataset_id']}\n")
        for label, key in (("Series", "series_id"), ("Source URL", "source_url"),
                           ("Licence", "licence_name"), ("Licence URL", "licence_url"),
                           ("Redistribute", "redistribute"), ("Attribution", "attribution"),
                           ("Retrieved at", "retrieved_at"), ("Vintage", "vintage")):  # fmt: skip
            if c.get(key) or key == "retrieved_at":
                out.append(f"- {label}: {c.get(key) or 'unknown'}")
        if c["redistribute"] in ("no", "review"):
            out.append(f"- WARNING: redistribution is `{c['redistribute']}`; "
                       "check the licence before sharing this data.")  # fmt: skip
        out.append("")
    return "\n".join(out)


def export(client: Client, series_ids: list[str], out: Path, fmt: str = "csv") -> list[Path]:
    out.mkdir(parents=True, exist_ok=True)

    def cell(v):  # dims etc. are dicts/lists: store as JSON text
        return json.dumps(v) if isinstance(v, (dict, list)) else v

    files, cites = [], []
    for sid in series_ids:
        r = client._obs(sid)
        p = out / (re.sub(r"[^\w.-]+", "_", sid) + f".{fmt}")
        if fmt == "csv":
            with p.open("w", newline="") as f:
                w = csv.writer(f)
                w.writerow(r["columns"])
                w.writerows([cell(v) for v in row] for row in r["rows"])
        else:
            import pyarrow as pa
            import pyarrow.parquet as pq

            pq.write_table(pa.table({c: [cell(row[i]) for row in r["rows"]] for i, c in enumerate(r["columns"])}), p)  # fmt: skip
        files.append(p)
        cites += r["citations"]
    (out / "SOURCES.md").write_text(_sources_md(cites))
    return files


def export_cmd(args: argparse.Namespace) -> int:
    def go():
        files = export(_client(args), args.series_ids, Path(args.out), args.format)
        print(f"wrote {len(files)} file(s) and SOURCES.md to {args.out}", file=sys.stderr)
        return 0

    return _run(go)


__all__ = ["SdkError", "export", "export_cmd"]
