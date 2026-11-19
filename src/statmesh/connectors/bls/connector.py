"""BLS Public Data API. v2 (POST /v2/timeseries/data/, key in body as registrationkey) when
BLS_API_KEY is set, else keyless v1. No catalog API: series come from manifest `datasets.<id>.series`
({series_id: {title, unit}}). Chunking: v2 50 series / 20 years per call, v1 25 / 10.
A requested series missing from the manifest is stored with unit null. Periods M01-M12, Q01-Q04, S01-S02, A01 are kept; M13/S03/Q05 (annual averages) are dropped.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from datetime import UTC, date, datetime
from pathlib import Path

import pyarrow as pa

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


def _period(year: str, code: str) -> str | None:
    kind, n = code[0], int(code[1:])
    if kind == "M" and n <= 12:
        return f"{year}-{n:02d}"
    if kind == "Q" and n <= 4 or kind == "S" and n <= 2:
        return f"{year}{kind}{n}"
    return year if kind == "A" else None


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        for did, cfg in list(self.manifest.datasets.items())[:limit]:
            yield DatasetMeta(
                source_id=self.manifest.id,
                dataset_id=did,
                title=cfg["title"],
                licence=self.manifest.licence,
                source_url="https://www.bls.gov/data/",
                series=tuple(
                    SeriesMeta(sid, s["title"], unit=s["unit"], geos=("USA",))
                    for sid, s in cfg["series"].items()
                ),
            )

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        v2 = bool(http.key)
        max_series, max_years = (50, 20) if v2 else (25, 10)
        url = f"{self.manifest.endpoint}/{'v2' if v2 else 'v1'}/timeseries/data/"
        ids = list(req.indicator_ids or self.manifest.datasets[req.dataset_id]["series"])
        end = (req.end or date.today()).year
        start = (req.start or date(end - max_years + 1, 1, 1)).year
        for i in range(0, len(ids), max_series):
            for y in range(start, end + 1, max_years):
                body = {
                    "seriesid": ids[i : i + max_series],
                    "startyear": str(y),
                    "endyear": str(min(y + max_years - 1, end)),
                }
                resp = http.post(
                    url, json={**body, **({"registrationkey": http.key} if v2 else {})}
                )
                status = resp.json()
                if status.get("status") != "REQUEST_SUCCEEDED":
                    msg = " ".join(status.get("message", [])).replace(http.key or "\0", "REDACTED")
                    raise RuntimeError(f"BLS: {status.get('status')} {msg}")
                yield RawChunk(
                    source_id=self.manifest.id,
                    dataset_id=req.dataset_id,
                    content=resp.content,
                    media_type="application/json",
                    url=url,
                    params={
                        **body,
                        "seriesid": ",".join(body["seriesid"]),
                        **({"registrationkey": "REDACTED"} if v2 else {}),
                    },
                    retrieved_at=datetime.now(UTC),
                )

    def normalize(self, chunk: RawChunk) -> pa.Table:
        cfg = self.manifest.datasets[chunk.dataset_id]["series"]
        cols: dict[str, list] = {f.name: [] for f in OBS_SCHEMA}
        for s in json.loads(chunk.content)["Results"]["series"]:
            sid = s["seriesID"]
            for d in s["data"]:
                per = _period(d["year"], d["period"])
                if per is None:
                    continue
                start, end, freq = parse_period(per)
                val = None if d["value"] in ("-", "") else float(d["value"])
                codes = [f["code"] for f in d.get("footnotes", []) if f.get("code")]
                cols["series_id"].append(
                    make_series_id(chunk.source_id, chunk.dataset_id, sid, "USA")
                )
                cols["source_id"].append(chunk.source_id)
                cols["dataset_id"].append(chunk.dataset_id)
                cols["indicator_id"].append(sid)
                cols["geo"].append("USA")
                cols["period_start"].append(start)
                cols["period_end"].append(end)
                cols["freq"].append(freq)
                cols["value"].append(val)
                cols["unit"].append(cfg.get(sid, {}).get("unit"))  # on-demand series: unit unknown
                cols["unit_mult"].append(0)
                cols["dims"].append({})
                cols["obs_status"].append(",".join(codes) or (None if val is not None else "-"))
                cols["retrieved_at"].append(chunk.retrieved_at)
                cols["vintage"].append(None)
        return pa.table(cols, schema=OBS_SCHEMA)
