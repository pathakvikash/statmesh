"""MCP server: six tools over statmesh.service. stdio via `statmesh mcp`, HTTP at /mcp."""

from __future__ import annotations

import argparse
import json
import shlex
import sys
from datetime import date
from pathlib import Path
from typing import Annotated

from mcp.server.mcpserver import MCPServer
from pydantic import Field

from statmesh import service
from statmesh.core.api_models import (
    ObservationsResult,
    SchemaResult,
    SearchResult,
    SeriesDetail,
    SqlResult,
)
from statmesh.sandbox import PythonResult

# Missing-data rules: docs/PRODUCT.md ("When data is missing, chat should").
INSTRUCTIONS = (
    "Open statistics. Search series, read observations, run read-only SQL. "
    "Quote the citations returned with every result: source, licence and retrieval time. "
    "When no tool result holds the number, do not give it from memory. Say what you searched, "
    "show the 3 closest series and how each differs from what was asked, and name the source "
    "that would hold the data. Flag any number that is not in a tool result."
)


def build_server() -> MCPServer:
    mcp = MCPServer("statmesh", instructions=INSTRUCTIONS)

    @mcp.tool()
    def search_series(
        q: str = "",
        geo: str | None = None,
        freq: str | None = None,
        source: str | list[str] | None = None,
        topic: str | list[str] | None = None,
        start_year: int | None = None,
        end_year: int | None = None,
        updated_since: str | None = None,
        redistribute: str | None = None,
        limit: Annotated[int, Field(ge=1, le=service.MAX_SEARCH)] = 10,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> SearchResult:
        """Keyword search over the series catalog. All filters are optional and combine.
        source/topic: one value or a list (any-of; topics: Health, Economy, Labour, Prices, Trade,
        Population, Environment, Energy, Companies). start_year/end_year: coverage overlaps the
        range. updated_since: YYYY-MM-DD. redistribute: yes|review|no. q may be empty when a filter
        is set (newest updated first). offset: skip hits; pass next_offset until it is null."""
        return service.search_series(
            q, geo=geo, freq=freq, source=source, topic=topic, start_year=start_year,
            end_year=end_year, updated_since=updated_since, redistribute=redistribute, limit=limit,
            offset=offset,
        )  # fmt: skip

    @mcp.tool()
    def describe_series(series_id: str) -> SeriesDetail:
        """Metadata, dimensions, licence and citation of one series."""
        return service.describe_series(series_id)

    @mcp.tool()
    def get_observations(
        series_id: str,
        start: date | None = None,
        end: date | None = None,
        geo: str | None = None,
        limit: Annotated[int, Field(ge=1, le=service.MAX_LIMIT)] | None = None,
        filters: dict[str, str] | None = None,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> ObservationsResult:
        """Observations of a series; remote series are fetched on demand (may be rate limited).
        filters: connector filters, e.g. {"partner": "USA", "hs": "85"} (Comtrade) or
        {"period": "CY2024Q2I"} (SEC). offset: skip rows; pass next_offset until it is null.
        `truncated`: more rows follow at next_offset. `partial`: the dataset itself is partial."""
        return service.get_observations(
            series_id, start=start, end=end, geo=geo, limit=limit, filters=filters, offset=offset
        )

    @mcp.tool()
    def run_sql(sql: str) -> SqlResult:
        """Run one read-only SQL SELECT over the views listed by describe_schema."""
        return service.run_sql(sql)

    @mcp.tool()
    def list_sources(
        q: str | None = None,
        kind: str | None = None,
        topic: str | list[str] | None = None,
        redistribute: str | None = None,
        auth: str | None = None,
        status: str | None = None,
    ) -> list[service.SourceStatus]:
        """Sources with freshness, key status and topics. Optional filters: q (name, id or dataset
        title substring), kind, topic, redistribute (yes|review|no), auth (keyless|key), status
        (data|catalogue)."""
        return service.list_sources(
            q=q, kind=kind, topic=topic, redistribute=redistribute, auth=auth, status=status
        )

    @mcp.tool()
    def describe_schema() -> SchemaResult:
        """Every SQL view run_sql can read: columns, types, descriptions, examples and join hints."""
        return service.describe_schema()

    if service.python_enabled():

        @mcp.tool()
        def run_python(code: str) -> PythonResult:
            """Run Python in a no-network sandbox; Parquet observations at /data/obs (read-only)."""
            return service.run_python(code)

    return mcp


PRINT_TARGETS = ("claude-desktop", "claude-code", "chatgpt")
_PLACEHOLDER_ROOT = "/path/to/statmesh"


def _checkout() -> str:
    """The repo root when running from a checkout, so the printed paths work as they are."""
    root = Path(__file__).resolve().parents[2]
    return str(root) if (root / "pyproject.toml").is_file() else _PLACEHOLDER_ROOT


def _stdio_argv(root: str) -> list[str]:  # the stdio command from README.md
    return ["uv", "--directory", root, "run", "--env-file", ".env", "statmesh", "mcp"]


def print_config(target: str, url: str | None = None) -> None:
    """Print a setup for one client. Claude targets: the payload alone on stdout, notes on stderr."""
    root = _checkout()
    data_dir = f"{root}/data"
    if target == "claude-desktop":
        argv = _stdio_argv(root)
        cfg = {"mcpServers": {"statmesh": {
            "command": argv[0], "args": argv[1:], "env": {"STATMESH_DATA_DIR": data_dir}}}}  # fmt: skip
        print(json.dumps(cfg, indent=2))
        print("Merge the statmesh entry into claude_desktop_config.json (macOS: "
              "~/Library/Application Support/Claude/), then restart Claude Desktop.",
              file=sys.stderr)  # fmt: skip
    elif target == "claude-code":
        argv = ["claude", "mcp", "add", "--transport", "stdio", "statmesh",
                "--env", f"STATMESH_DATA_DIR={data_dir}", "--", *_stdio_argv(root)]  # fmt: skip
        print(shlex.join(argv))
        print("Run once from any directory; check with `claude mcp list`.", file=sys.stderr)
    elif target == "chatgpt":
        base = (url or "https://<host>").rstrip("/")
        base = base.removesuffix("/mcp")
        print(f"MCP (ChatGPT connectors, developer mode): {base}/mcp")
        # the hosted mirror serves the API under /v1; a directly served API is at /openapi.json
        print(f"GPT Action (Configure > Actions > Import from URL): {base}/v1/openapi.json")
        print(
            "If the API is served directly (no /v1 proxy), the Action spec is at "
            f"{base}/openapi.json instead."
        )
        print(
            "ChatGPT reaches the server from OpenAI's side, so it needs a public HTTPS host "
            "(not 127.0.0.1 or a laptop). Serve the mirror with STATMESH_MODE=hosted and "
            "STATMESH_ALLOWED_HOSTS=<host>; only redistribute: yes data is then served."
        )
        if url and not url.startswith("https://"):
            print("Warning: this URL is not https; ChatGPT will not connect to it.")
    else:
        raise ValueError(f"unknown target {target!r}; choose from {', '.join(PRINT_TARGETS)}")


def run_stdio(args: argparse.Namespace | None = None) -> int:
    target = getattr(args, "print_config", None)
    if target:  # checked before Settings.validate(): printing needs no contact email or data
        print_config(target, getattr(args, "url", None))
        return 0
    from statmesh.settings import Settings

    Settings.from_env().validate()
    build_server().run("stdio")
    return 0
