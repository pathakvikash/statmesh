from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import AliasChoices, BaseModel, Field, field_validator, model_validator

Freq = Literal["A", "S", "Q", "M", "W", "D"]
Redistribute = Literal["yes", "no", "review"]
TableName = Literal["observations", "entities", "entity_xref"]

_ID_RE = re.compile(r"^[a-z][a-z0-9_]*$")


class Licence(BaseModel, frozen=True):
    name: str = Field(min_length=1)
    url: str
    redistribute: Redistribute
    attribution: str


class RateLimit(BaseModel, frozen=True):
    per_second: float | None = None
    per_hour: int | None = Field(
        None, validation_alias=AliasChoices("per_hour", "max_downloads_per_hour")
    )
    per_day: int | None = None


class Refresh(BaseModel, frozen=True):
    schedule: str | None = None  # 5-field cron, UTC
    incremental: str | None = None  # e.g. "updatedAfter"; meaning is connector-specific

    @field_validator("schedule")
    @classmethod
    def _cron(cls, v: str | None) -> str | None:
        if v is not None and len(v.split()) != 5:
            raise ValueError("schedule must be a 5-field cron expression")
        return v


class Manifest(BaseModel, frozen=True, extra="forbid"):
    id: str
    name: str
    kind: Literal["sdmx", "file", "rest", "custom", "ckan", "socrata"]
    endpoint: str | None = None
    sdmx_version: Literal["2.1", "3.0"] | None = None
    auth: Literal["none", "free_key"] = "none"
    key_env: str | None = None
    key_required: bool = True
    licence: Licence
    rate_limit: RateLimit = RateLimit()
    refresh: Refresh = Refresh()
    core_datasets: list[str] = []
    datasets: dict[str, dict[str, Any]] = {}
    options: dict[str, Any] = {}
    cache_ttl_days: int = 7
    version: int = 1

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        if not _ID_RE.match(v):
            raise ValueError("id must match ^[a-z][a-z0-9_]*$")
        return v

    @model_validator(mode="after")
    def _key(self) -> Manifest:
        if self.auth == "free_key" and not self.key_env:
            raise ValueError("key_env is required when auth == 'free_key'")
        return self

    @classmethod
    def load(cls, path: Path) -> Manifest:
        data = yaml.safe_load(Path(path).read_text())
        if not isinstance(data, dict):
            raise TypeError(f"{path}: manifest must be a mapping")
        return cls.model_validate(data)


@dataclass(frozen=True)
class SeriesMeta:
    indicator_id: str
    title: str
    description: str = ""
    synonyms: tuple[str, ...] = ()
    unit: str | None = None
    freq: Freq | None = None
    geos: tuple[str, ...] = ()
    start: date | None = None
    end: date | None = None
    dims: Mapping[str, tuple[str, ...]] = field(default_factory=dict)
    licence: Licence | None = None


@dataclass(frozen=True)
class DatasetMeta:
    source_id: str
    dataset_id: str
    title: str
    licence: Licence
    description: str = ""
    source_url: str | None = None
    freq: Freq | None = None
    last_updated: datetime | None = None
    series: tuple[SeriesMeta, ...] = ()


@dataclass(frozen=True)
class FetchRequest:
    dataset_id: str
    indicator_ids: tuple[str, ...] = ()
    geos: tuple[str, ...] = ()
    start: date | None = None
    end: date | None = None
    filters: Mapping[str, str] = field(default_factory=dict)
    updated_after: datetime | None = None
    max_rows: int | None = None

    def cache_key(self) -> str:
        payload = {
            "dataset_id": self.dataset_id,
            "indicator_ids": sorted(self.indicator_ids),
            "geos": sorted(self.geos),
            "start": self.start.isoformat() if self.start else None,
            "end": self.end.isoformat() if self.end else None,
            "filters": dict(sorted(self.filters.items())),
            "updated_after": self.updated_after.isoformat() if self.updated_after else None,
            "max_rows": self.max_rows,
        }
        blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(blob.encode()).hexdigest()[:16]


@dataclass(frozen=True)
class RawChunk:
    source_id: str
    dataset_id: str
    content: bytes
    media_type: str
    url: str
    params: Mapping[str, str]
    retrieved_at: datetime
    table: TableName = "observations"
    meta: Mapping[str, Any] = field(default_factory=dict)

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.content).hexdigest()


def _clean(part: str) -> str:
    return part.replace(":", "_")


def make_series_id(source: str, dataset: str, indicator: str, geo: str) -> str:
    return f"{source}:{_clean(dataset)}:{_clean(indicator)}:{geo}"


def split_series_id(s: str) -> tuple[str, str, str, str | None]:
    """'src:ds:ind' -> (src, ds, ind, None); 'src:ds:ind:geo' -> 4-tuple. Geo may contain ':'."""
    parts = s.split(":", 3)
    if len(parts) < 3 or not all(parts[:3]):
        raise ValueError(f"not a series id: {s!r}")
    return parts[0], parts[1], parts[2], (parts[3] if len(parts) == 4 and parts[3] else None)
