"""MCP server: five tools over statmesh.service. stdio via `statmesh mcp`, HTTP at /mcp."""

from __future__ import annotations

import argparse
from datetime import date
from typing import Annotated

from mcp.server.mcpserver import MCPServer
from pydantic import Field

from statmesh import service
from statmesh.core.api_models import ObservationsResult, SearchResult, SeriesDetail, SqlResult
from statmesh.sandbox import PythonResult


def build_server() -> MCPServer:
    mcp = MCPServer(
        "statmesh",
        instructions="Open statistics. Search series, read observations, run read-only SQL. "
        "Quote the citations returned with every result.",
    )

    @mcp.tool()
    def search_series(
        q: str,
        geo: str | None = None,
        freq: str | None = None,
        source: str | None = None,
        limit: Annotated[int, Field(ge=1, le=service.MAX_SEARCH)] = 10,
    ) -> SearchResult:
        """Keyword search over the series catalog."""
        return service.search_series(q, geo=geo, freq=freq, source=source, limit=limit)

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
    ) -> ObservationsResult:
        """Observations of a series; remote series are fetched on demand (may be rate limited).
        filters: connector filters, e.g. {"partner": "USA", "hs": "85"} (Comtrade) or
        {"period": "CY2024Q2I"} (SEC)."""
        return service.get_observations(
            series_id, start=start, end=end, geo=geo, limit=limit, filters=filters
        )

    @mcp.tool()
    def run_sql(sql: str) -> SqlResult:
        """Run one read-only SQL SELECT over observations, series, datasets, sources, geos."""
        return service.run_sql(sql)

    @mcp.tool()
    def list_sources() -> list[service.SourceStatus]:
        """Sources with freshness and key status."""
        return service.list_sources()

    if service.python_enabled():

        @mcp.tool()
        def run_python(code: str) -> PythonResult:
            """Run Python in a no-network sandbox; Parquet observations at /data/obs (read-only)."""
            return service.run_python(code)

    return mcp


def run_stdio(args: argparse.Namespace | None = None) -> None:
    from statmesh.settings import Settings

    Settings.from_env().validate()
    build_server().run("stdio")
