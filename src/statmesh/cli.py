"""Command line. Every subcommand is a thin dispatcher: `module:function` is imported and called
with the parsed argparse Namespace. A missing module or function prints "not built yet"."""

from __future__ import annotations

import argparse
import importlib
import sys
from collections.abc import Sequence

from statmesh import __version__


def _add(sub, name, target, help_, *args):
    p = sub.add_parser(name, help=help_)
    for flags, kw in args:
        p.add_argument(*flags, **kw)
    p.set_defaults(target=target)


LOCAL = (("--local",), {"action": "store_true", "help": "call statmesh.service in-process"})
FORMAT = {"choices": ["csv", "json"], "default": "csv"}


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="statmesh", description="Open statistics, one query surface.")
    ap.add_argument("--version", action="version", version=f"statmesh {__version__}")
    sub = ap.add_subparsers(dest="command", required=True, metavar="<command>")

    _add(sub, "serve", "statmesh.api.app:serve", "run the REST + MCP server",
         (("--host",), {"default": "127.0.0.1"}), (("--port",), {"type": int, "default": 8000}))  # fmt: skip
    _add(sub, "mcp", "statmesh.mcp_server:run_stdio", "run the MCP server on stdio")
    _add(sub, "worker", "statmesh.ingest.scheduler:run_forever", "run the ingest scheduler")
    _add(sub, "discover", "statmesh.ingest.runner:discover_cmd", "refresh the catalog of a source",
         (("source",), {"nargs": "?", "help": "source id (default: all enabled)"}))  # fmt: skip
    _add(sub, "ingest", "statmesh.ingest.runner:ingest_cmd", "ingest a source's datasets",
         (("source",), {}), (("--dataset",), {"metavar": "ID"}),
         (("--reprocess",), {"action": "store_true", "help": "rebuild from raw snapshots"}))  # fmt: skip
    _add(sub, "search", "statmesh.sdk:search_cmd", "search series",
         (("query",), {}), (("--geo",), {}), (("--freq",), {}), (("--source",), {}), (("--limit",), {"type": int}), LOCAL)  # fmt: skip
    _add(sub, "get", "statmesh.sdk:get_cmd", "get observations",
         (("series_id",), {}), (("--start",), {}), (("--end",), {}), (("--geo",), {}), (("--limit",), {"type": int}),
         (("--format",), FORMAT),
         (("--filter",), {"action": "append", "default": [], "metavar": "KEY=VALUE"}), LOCAL)  # fmt: skip
    _add(sub, "sql", "statmesh.sdk:sql_cmd", "run a read-only SQL query", (("query",), {}), LOCAL)
    _add(sub, "export", "statmesh.export:export_cmd", "export series with a SOURCES.md",
         (("series_ids",), {"nargs": "+"}), (("--out",), {"required": True, "metavar": "DIR"}),
         (("--format",), {"choices": ["csv", "parquet"], "default": "csv"}), LOCAL)  # fmt: skip
    _add(sub, "sources", "statmesh.sdk:sources_cmd", "list sources and their status", LOCAL)

    _add(sub, "mirror", "statmesh.ingest.mirror:mirror_cmd", "ingest everything for a hosted mirror",
         (("--dry-run",), {"action": "store_true", "help": "list what would run, change nothing"}))  # fmt: skip
    _add(sub, "bench", "statmesh.bench:bench_cmd", "run the question benchmark")
    _add(sub, "doctor", "statmesh.doctor:doctor_cmd", "check sources and configuration",
         (("--json",), {"action": "store_true"}), (("--source",), {}),
         (("--offline",), {"action": "store_true", "help": "skip live network checks"}))  # fmt: skip

    conn = sub.add_parser("connector", help="connector development tools")
    csub = conn.add_subparsers(dest="connector_cmd", required=True, metavar="<action>")
    kinds = ["sdmx", "file", "rest", "custom"]
    _add(csub, "new", "statmesh.devtools.scaffold:new_cmd", "scaffold a connector",
         (("id",), {}), (("--kind",), {"required": True, "choices": kinds}))  # fmt: skip
    _add(
        csub, "record", "statmesh.devtools.record:record_cmd", "record HTTP fixtures", (("id",), {})
    )
    _add(csub, "test", "statmesh.devtools.test:test_cmd", "run a connector's tests",
         (("id",), {}), (("--live",), {"action": "store_true"}))  # fmt: skip
    return ap


def _dispatch(target: str, args: argparse.Namespace) -> int:
    modname, func = target.split(":")
    try:
        mod = importlib.import_module(modname)
    except ModuleNotFoundError as e:
        if not (e.name and modname.startswith(e.name)):
            raise  # a real missing dependency inside an existing module
        print(f"not built yet: {target}", file=sys.stderr)
        return 1
    fn = getattr(mod, func, None)
    if fn is None:
        print(f"not built yet: {target}", file=sys.stderr)
        return 1
    return int(fn(args) or 0)


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return _dispatch(args.target, args)


if __name__ == "__main__":
    sys.exit(main())
