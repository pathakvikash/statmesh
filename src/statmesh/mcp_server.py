"""MCP server: seven tools over statmesh.service. stdio via `statmesh mcp`, HTTP at /mcp."""

from __future__ import annotations

import argparse
import json
import shlex
import sys
from datetime import date
from pathlib import Path
from typing import Annotated, Any

from mcp.server.mcpserver import MCPServer
from mcp_types import CallToolResult, TextContent, ToolAnnotations
from pydantic import Field

from statmesh import orrery, service
from statmesh.sandbox import PythonResult

# Missing-data rules: docs/PRODUCT.md ("When data is missing, chat should").
INSTRUCTIONS = (
    "Open statistics. Search series, read observations, run read-only SQL. "
    "Quote the citations returned with every result: source, licence and retrieval time. "
    "When no tool result holds the number, do not give it from memory. Say what you searched, "
    "show the 3 closest series and how each differs from what was asked, and name the source "
    "that would hold the data. Flag any number that is not in a tool result."
)

DEFAULT_ROWS = 200  # get_observations rows when `limit` is omitted: a model needs few, not 10000
# Dropped from compact rows: derivable (series_id, period_end from freq) or carried by citations.
_DROP = {"series_id", "period_end", "retrieved_at"}
_KEEP = ("geo", "period_start", "value")


def _compact(out: dict[str, Any], cols: list[str], rows: list[list[Any]]) -> dict[str, Any]:
    """Constant columns once under `constants`; rows as [geo, period_start, value, *varying]."""
    idx = {c: i for i, c in enumerate(cols)}
    const, vary = {}, []
    for c in cols:
        if c in _DROP or c in _KEEP:
            continue
        vals = {json.dumps(r[idx[c]]) for r in rows}
        if len(vals) > 1:
            vary.append(c)
        elif vals and (v := rows[0][idx[c]]) not in (None, [], {}):
            const[c] = v
    if not rows:
        return {**out, "columns": list(_KEEP), "constants": {}, "rows": []}
    use = [*_KEEP, *vary]
    out |= {"columns": use, "constants": const, "rows": [[r[idx[c]] for c in use] for r in rows]}
    return out


RO = ToolAnnotations(read_only_hint=True)


def _result(payload: dict[str, Any], structured: dict[str, Any]) -> CallToolResult:
    """Text content stays the tool's JSON; structuredContent adds the Orrery contract fields.
    `rows` are cut so the structuredContent stays under orrery.BYTE_BUDGET (and ROW_CAP rows)."""
    rows = {**payload, **structured}.get("rows")
    if isinstance(rows, list):
        rest = len(
            json.dumps(
                {k: v for k, v in {**payload, **structured}.items() if k != "rows"}, default=str
            )
        )
        keep = orrery.fit_rows(rows, orrery.BYTE_BUDGET - rest - 300)  # 300: room for the warning
        if keep < len(rows):
            note = orrery.cap_note(len(rows), keep)
            payload = {**payload, "rows": rows[:keep], "truncated": True,
                       "warning": f"{payload['warning']} {note}" if payload.get("warning") else note}  # fmt: skip
            structured = {**structured, "rows": rows[:keep]}
    text = json.dumps(payload, indent=2, default=str)
    return CallToolResult(
        content=[TextContent(type="text", text=text)], structured_content={**payload, **structured}
    )


def _text(payload: Any) -> CallToolResult:
    """Text content only: no structuredContent (these shapes are not in Orrery's contract)."""
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(payload, indent=2, default=str))]
    )


def build_server() -> MCPServer:
    mcp = MCPServer("statmesh", instructions=INSTRUCTIONS)

    @mcp.tool(annotations=RO)
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
    ) -> CallToolResult:
        """Keyword search over the series catalog. All filters are optional and combine.
        geo: a code (IND), ISO alpha-2 (IN), country or region name (India, World), or a comma
        list of them (ids then carry no geo suffix; series must cover all). Unknown geo: error.
        source/topic: one value or a list (any-of; topics: Health, Economy, Labour, Prices, Trade,
        Population, Environment, Energy, Companies). start_year/end_year: coverage overlaps the
        range. updated_since: YYYY-MM-DD. redistribute: yes|review|no. q may be empty when a filter
        is set (newest updated first). offset: skip hits; pass next_offset until it is null."""
        r = service.search_series(
            q, geo=geo, freq=freq, source=source, topic=topic, start_year=start_year,
            end_year=end_year, updated_since=updated_since, redistribute=redistribute, limit=limit,
            offset=offset,
        )  # fmt: skip
        cols = [
            "series_id",
            "title",
            "unit",
            "freq",
            "geo",
            "start",
            "end",
            "source_id",
            "licence_name",
        ]
        d = r.model_dump(mode="json")
        rows = [[h[c] for c in cols] for h in d["hits"]]
        return _result(d, orrery.table(f"Search: {q}" if q else "Search", cols, rows))

    @mcp.tool(annotations=RO)
    def describe_series(series_id: str) -> CallToolResult:
        """Metadata, dimensions, licence and citation of one series."""
        d = service.describe_series(series_id).model_dump(mode="json")
        keys = ["series_id", "title", "unit", "freq", "geo", "start", "end", "source_id",
                "dataset_id", "licence_name", "redistribute", "description", "source_url"]  # fmt: skip
        rows = [[k, d[k]] for k in keys] + [["attribution", d["citation"]["attribution"]]]
        return _result(d, orrery.table(d["title"], ["field", "value"], rows))

    @mcp.tool(annotations=RO)
    def related_series(
        series_id: str,
        geo: str | None = None,
        limit: Annotated[int, Field(ge=1, le=service.MAX_SEARCH)] = 8,
    ) -> CallToolResult:
        """Series related to one series (same dataset, shared topics, similar title, other
        source), each with a `reason`. geo: restrict to series covering it. Deterministic."""
        d = service.related_series(series_id, geo=geo, limit=limit).model_dump(mode="json")
        cols = ["series_id", "title", "unit", "freq", "geo", "reason"]
        rows = [[h[c] for c in cols] for h in d["hits"]]
        return _result(d, orrery.table(f"Related to {series_id}", cols, rows))

    @mcp.tool(annotations=RO)
    def get_observations(
        series_id: str,
        start: date | None = None,
        end: date | None = None,
        geo: str | None = None,
        limit: Annotated[int, Field(ge=1, le=service.MAX_LIMIT)] | None = None,
        filters: dict[str, str] | None = None,
        offset: Annotated[int, Field(ge=0)] = 0,
        compact: bool = True,
    ) -> CallToolResult:
        """Observations of a series; remote series are fetched on demand (may be rate limited).
        geo: a code (IND), ISO alpha-2 (IN) or country name (India). filters: connector filters,
        e.g. {"partner": "USA", "hs": "85"} (Comtrade) or {"period": "CY2024Q2I"} (SEC).
        limit omitted: at most 200 rows, the latest periods of every geo (200 // n_geos each; over
        200 geos only the first 200 show, latest row each); `omitted_rows` and `warning` say what
        was cut. Narrow with geo/start/end. With limit (max 10000): the first rows in (geo,
        period) order, then pass next_offset until it is null (`truncated`); offset needs limit.
        `partial`: the dataset itself is partial.
        compact (default): `columns` + `rows` as arrays, columns that are the same on every row
        under `constants`; compact=false: every column on every row. Quote `citations`."""
        if limit is None and offset:
            raise ValueError("offset needs limit: without limit the answer is one short cut")
        if limit is None:
            r = service.get_observations_recent(
                series_id, start=start, end=end, geo=geo, filters=filters, max_rows=DEFAULT_ROWS
            )
        else:
            r = service.get_observations(
                series_id, start=start, end=end, geo=geo, limit=limit, filters=filters,
                offset=offset,
            )  # fmt: skip
        out = r.model_dump(mode="json", exclude={"columns", "rows"})
        out.setdefault("omitted_rows", 0)
        ts, dropped = orrery.timeseries(series_id, series_id, r.columns, r.rows)
        if dropped:
            note = f"Chart data capped at {orrery.ROW_CAP} points or {orrery.BYTE_BUDGET // 1000} KB; {dropped} not shown."
            out["warning"] = f"{out['warning']} {note}" if out.get("warning") else note
        if not compact:
            return _result({**out, "columns": r.columns, "rows": r.rows}, ts)
        return _result(_compact(out, r.columns, r.rows), ts)

    @mcp.tool(annotations=RO)
    def run_sql(sql: str) -> CallToolResult:
        """Run one read-only SQL SELECT over the views listed by describe_schema.
        At most 5000 rows (and about 800 KB) are returned; the warning says when rows were cut."""
        d = service.run_sql(sql).model_dump(mode="json")
        return _result(d, orrery.table("SQL result", d["columns"], d["rows"]))

    @mcp.tool(annotations=RO)
    def list_sources(
        q: str | None = None,
        kind: str | None = None,
        topic: str | list[str] | None = None,
        redistribute: str | None = None,
        auth: str | None = None,
        status: str | None = None,
    ) -> CallToolResult:
        """Sources with freshness, key status and topics. Optional filters: q (name, id or dataset
        title substring), kind, topic, redistribute (yes|review|no), auth (keyless|key), status
        (data|catalogue)."""
        r = service.list_sources(
            q=q, kind=kind, topic=topic, redistribute=redistribute, auth=auth, status=status
        )
        return _text([s.model_dump(mode="json") for s in r])

    @mcp.tool(annotations=RO)
    def describe_schema() -> CallToolResult:
        """Every SQL view run_sql can read: columns, types, descriptions, examples and join hints."""
        return _text(service.describe_schema().model_dump(mode="json"))

    if service.python_enabled():

        @mcp.tool(annotations=RO)
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
