"""MCP server: six tools over statmesh.service. stdio via `statmesh mcp`, HTTP at /mcp."""

from __future__ import annotations

import argparse
from datetime import date
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


def build_server() -> MCPServer:
    mcp = MCPServer(
        "statmesh",
        instructions="Open statistics. Search series, read observations, run read-only SQL. "
        "Quote the citations returned with every result.",
    )

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
    ) -> SearchResult:
        """Keyword search over the series catalog. All filters are optional and combine.
        source/topic: one value or a list (any-of; topics: Health, Economy, Labour, Prices, Trade,
        Population, Environment, Energy, Companies). start_year/end_year: coverage overlaps the
        range. updated_since: YYYY-MM-DD. redistribute: yes|review|no. q may be empty when a filter
        is set (newest updated first)."""
        return service.search_series(
            q, geo=geo, freq=freq, source=source, topic=topic, start_year=start_year,
            end_year=end_year, updated_since=updated_since, redistribute=redistribute, limit=limit,
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
    ) -> ObservationsResult:
        """Observations of a series; remote series are fetched on demand (may be rate limited).
        filters: connector filters, e.g. {"partner": "USA", "hs": "85"} (Comtrade) or
        {"period": "CY2024Q2I"} (SEC)."""
        return service.get_observations(
            series_id, start=start, end=end, geo=geo, limit=limit, filters=filters
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


def run_stdio(args: argparse.Namespace | None = None) -> None:
    from statmesh.settings import Settings

    Settings.from_env().validate()
    build_server().run("stdio")
