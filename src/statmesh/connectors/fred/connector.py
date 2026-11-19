"""FRED API (key required, sent as api_key). One dataset, `series`; indicator_id = FRED series id;
the series list is manifest `options.series`. All series are geo USA (FRED's non-US series are not
mapped). Per-series licence comes from the series' copyright tag (/fred/series/tags):
  "pre-approval" -> no, "citation required" -> review, "public domain" -> yes, no tag -> review.
Dates are period starts; end is derived from frequency_short, except "Weekly/Biweekly, Ending
<day>" series, whose dates are period ends (start = date - 6 / 13 days).
unit_mult is 0: FRED's units already name the scale ("Billions of Dollars"), see core/schema.py.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pyarrow as pa

from statmesh.core.http import HttpClient
from statmesh.core.models import (
    DatasetMeta,
    FetchRequest,
    Licence,
    Manifest,
    RawChunk,
    SeriesMeta,
    make_series_id,
)
from statmesh.core.schema import OBS_SCHEMA

_FREQ = {"A": "A", "SA": "S", "Q": "Q", "M": "M", "W": "W", "BW": "W", "D": "D"}
_MONTHS = {"A": 12, "S": 6, "Q": 3, "M": 1}
_SPAN = {"W": 7, "BW": 14}  # days; "Weekly, Ending <day>" dates are the END of the span


def _end(start: date, freq: str) -> date:
    if freq == "D":
        return start
    m = start.month - 1 + _MONTHS[freq]
    y, m = start.year + m // 12, m % 12 + 1
    return date(y, m, 1) - timedelta(days=1)


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory

    def _get(self, http: HttpClient, path: str, **params) -> dict:
        p = {**params, "api_key": http.key, "file_type": "json"}
        return http.get(f"{self.manifest.endpoint}/{path}", params=p).json()

    def _licence(self, tags: list[str]) -> Licence:
        base = self.manifest.licence
        names = " ".join(tags).lower()  # case-insensitive substring on the tag name
        # NOTE: tag strings unverified against live /fred/series/tags (written from memory); the
        # live smoke test (tests/test_smoke.py, -m live) checks UNRATE and SP500 on the first keyed run.
        for needle, red in (
            ("pre-approval", "no"),
            ("citation required", "review"),
            ("public domain", "yes"),
        ):
            if needle in names:
                return base.model_copy(update={"redistribute": red})
        return base

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        series = []
        for sid in self.manifest.options["series"][:limit]:
            m = self._get(http, "series", series_id=sid)["seriess"][0]
            tags = [t["name"] for t in self._get(http, "series/tags", series_id=sid)["tags"]]
            series.append(
                SeriesMeta(
                    sid,
                    m["title"],
                    description=m.get("notes", ""),
                    unit=m["units"],
                    freq=_FREQ.get(m["frequency_short"]),
                    geos=("USA",),
                    licence=self._licence(tags),
                )
            )
        yield DatasetMeta(
            source_id=self.manifest.id,
            dataset_id="series",
            title="FRED economic data series",
            licence=self.manifest.licence,
            source_url="https://fred.stlouisfed.org/",
            series=tuple(series),
        )

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        for sid in req.indicator_ids or self.manifest.options["series"]:
            m = self._get(http, "series", series_id=sid)["seriess"][0]
            params = {"series_id": sid}
            if req.start:
                params["observation_start"] = req.start.isoformat()
            if req.end:
                params["observation_end"] = req.end.isoformat()
            resp = http.get(
                f"{self.manifest.endpoint}/series/observations",
                params={**params, "api_key": http.key, "file_type": "json"},
            )
            yield RawChunk(
                source_id=self.manifest.id,
                dataset_id=req.dataset_id,
                content=resp.content,
                media_type="application/json",
                url=f"{self.manifest.endpoint}/series/observations",
                params={**params, "api_key": "REDACTED", "file_type": "json"},
                retrieved_at=datetime.now(UTC),
                meta={
                    "series_id": sid,
                    "units": m["units"],
                    "freq": m["frequency_short"],
                    "freq_text": m.get("frequency", ""),
                },
            )

    def normalize(self, chunk: RawChunk) -> pa.Table:
        sid, units = chunk.meta["series_id"], chunk.meta["units"]
        freq = _FREQ[chunk.meta["freq"]]
        short, ending = chunk.meta["freq"], "ending" in chunk.meta.get("freq_text", "").lower()
        cols: dict[str, list] = {f.name: [] for f in OBS_SCHEMA}
        for o in json.loads(chunk.content)["observations"]:
            d = date.fromisoformat(o["date"])
            if short in _SPAN:
                n = _SPAN[short] - 1
                start, end = (d - timedelta(days=n), d) if ending else (d, d + timedelta(days=n))
            else:
                start, end = d, _end(d, freq)
            missing = o["value"] == "."
            for k, v in (
                ("series_id", make_series_id(chunk.source_id, chunk.dataset_id, sid, "USA")),
                ("source_id", chunk.source_id),
                ("dataset_id", chunk.dataset_id),
                ("indicator_id", sid),
                ("geo", "USA"),
                ("period_start", start),
                ("period_end", end),
                ("freq", freq),
                ("value", None if missing else float(o["value"])),
                ("unit", units),
                ("unit_mult", 0),
                ("dims", {}),
                ("obs_status", "missing" if missing else None),
                ("retrieved_at", chunk.retrieved_at),
                ("vintage", None),
            ):
                cols[k].append(v)
        return pa.table(cols, schema=OBS_SCHEMA)
