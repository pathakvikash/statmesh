"""World Bank Indicators API v2 (WDI). The reference custom connector: copy it for a new REST source.

Shape: discover() lists the catalog, fetch() does the HTTP and yields raw chunks, normalize() turns
one chunk into an observations table with no I/O.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from datetime import UTC, date, datetime
from pathlib import Path

import pyarrow as pa

from statmesh.core.geo import load_geo_map, to_geo
from statmesh.core.http import HttpClient
from statmesh.core.models import (
    DatasetMeta,
    FetchRequest,
    Manifest,
    RawChunk,
    SeriesMeta,
    make_series_id,
)
from statmesh.core.periods import parse_period
from statmesh.core.schema import OBS_SCHEMA

DATASET = "WDI"
SOURCE_ID = "2"  # World Bank source id of World Development Indicators
PER_PAGE = 1000


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory
        self.geo_map = load_geo_map(directory)  # e.g. EUU -> region:EU27

    def _pages(self, http: HttpClient, path: str, params: dict) -> Iterable[bytes]:
        """Yield each page's body. The API reports errors as HTTP 200 with a `message` body."""
        page, pages = 1, 1
        while page <= pages:
            query = {"format": "json", **params, **({"page": page} if page > 1 else {})}
            resp = http.get(f"{self.manifest.endpoint}/{path}", params=query)
            head = json.loads(resp.content)[0]
            if "message" in head:
                raise ValueError(f"World Bank API error on {path}: {head['message']}")
            pages = head["pages"]
            page += 1
            yield resp.content

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        """One dataset (WDI) whose series are the indicators. `limit` caps the indicators."""
        series: list[SeriesMeta] = []
        params = {"source": SOURCE_ID, "per_page": min(limit or PER_PAGE, PER_PAGE)}
        for body in self._pages(http, "indicator", params):
            for ind in json.loads(body)[1]:
                series.append(
                    SeriesMeta(
                        indicator_id=ind["id"],
                        title=ind["name"],
                        description=ind.get("sourceNote", ""),
                        unit=_unit(ind["name"]),
                        freq="A",
                    )
                )
            if limit and len(series) >= limit:
                break
        yield DatasetMeta(
            source_id=self.manifest.id,
            dataset_id=DATASET,
            title="World Development Indicators",
            licence=self.manifest.licence,
            source_url="https://datatopics.worldbank.org/world-development-indicators/",
            freq="A",
            series=tuple(series[:limit]),
        )

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        """One chunk per indicator per page. Aggregates (WLD, SAS) use the same path as countries."""
        indicators = req.indicator_ids or tuple(self.manifest.options["core_indicators"])
        countries = ";".join(g.removeprefix("region:") for g in req.geos) or "all"
        params: dict[str, str | int] = {"per_page": PER_PAGE}
        if req.start or req.end:
            first = req.start.year if req.start else 1960
            last = req.end.year if req.end else date.today().year
            params["date"] = f"{first}:{last}"
        for ind in indicators:
            path = f"country/{countries}/indicator/{ind}"
            for body in self._pages(http, path, params):
                yield RawChunk(
                    source_id=self.manifest.id,
                    dataset_id=req.dataset_id,
                    content=body,
                    media_type="application/json",
                    url=f"{self.manifest.endpoint}/{path}",
                    params={k: str(v) for k, v in params.items()},
                    retrieved_at=datetime.now(UTC),
                    meta={"indicator": ind},
                )

    def normalize(self, chunk: RawChunk) -> pa.Table:
        head, rows = json.loads(chunk.content)
        vintage = date.fromisoformat(head["lastupdated"])
        cols: dict[str, list] = {f.name: [] for f in OBS_SCHEMA}
        for r in rows or []:  # `rows` is null when nothing matches
            if r["value"] is None:  # the API pads missing years with nulls; skip them
                continue
            ind = r["indicator"]["id"]
            # countryiso3code is ISO3 for countries and the WB code for aggregates; it is empty for
            # a few odd entities, so fall back to the (ISO2-like) country id
            geo = to_geo(r["countryiso3code"] or r["country"]["id"], "iso3", self.geo_map)
            start, end, freq = parse_period(r["date"])
            cols["series_id"].append(make_series_id(chunk.source_id, chunk.dataset_id, ind, geo))
            cols["source_id"].append(chunk.source_id)
            cols["dataset_id"].append(chunk.dataset_id)
            cols["indicator_id"].append(ind)
            cols["geo"].append(geo)
            cols["period_start"].append(start)
            cols["period_end"].append(end)
            cols["freq"].append(freq)
            cols["value"].append(float(r["value"]))
            cols["unit"].append(_unit(r["indicator"]["value"]))
            cols["unit_mult"].append(0)
            cols["dims"].append({})
            cols["obs_status"].append(r.get("obs_status") or None)
            cols["retrieved_at"].append(chunk.retrieved_at)
            cols["vintage"].append(vintage)
        return pa.table(cols, schema=OBS_SCHEMA)


def _unit(name: str) -> str | None:
    """The API's `unit` field is empty; the unit is the last '(...)' of the title, if any."""
    m = re.search(r"\(([^()]*)\)\s*$", name)
    return m.group(1) if m else None
