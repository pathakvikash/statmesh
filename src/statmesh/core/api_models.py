from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel

from statmesh.core.models import Redistribute


class Citation(BaseModel):
    source_id: str
    source_name: str
    dataset_id: str
    series_id: str | None = None
    licence_name: str
    licence_url: str
    redistribute: Redistribute
    attribution: str
    source_url: str | None = None
    retrieved_at: datetime | None = None
    vintage: date | None = None


class SeriesHit(BaseModel):
    series_id: str
    title: str
    unit: str | None
    freq: str | None
    geo: str | None
    start: date | None
    end: date | None
    source_id: str
    dataset_id: str
    licence_name: str
    redistribute: Redistribute
    status: str
    score: float
    topics: list[str] = []


class SearchResult(BaseModel):
    query: str
    hits: list[SeriesHit]


class SeriesDetail(SeriesHit):
    description: str
    dims: dict[str, list[str]]
    geos: list[str]
    source_url: str | None
    last_updated: datetime | None
    last_ingested_at: datetime | None
    citation: Citation


class ObservationsResult(BaseModel):
    series_id: str
    status: Literal["ok", "rate_limited", "not_found", "forbidden"]
    columns: list[str]
    rows: list[list[Any]]
    truncated: bool = False
    retry_after: float | None = None
    citations: list[Citation]
    warning: str | None = None


class SqlResult(BaseModel):
    sql: str
    columns: list[str]
    rows: list[list[Any]]
    truncated: bool
    citations: list[Citation]
    warning: str | None = None


class SourceStatus(BaseModel):
    id: str
    name: str
    kind: str
    auth: str
    key_configured: bool
    enabled: bool
    redistribute: Redistribute
    datasets: int
    series: int
    last_ingested_at: datetime | None
    stale_datasets: int
    topics: list[str] = []


class SchemaColumn(BaseModel):
    name: str
    type: str
    description: str
    example: str | None = None


class SchemaView(BaseModel):
    name: str
    description: str
    joins: list[str]
    columns: list[SchemaColumn]


class SchemaResult(BaseModel):
    views: list[SchemaView]
