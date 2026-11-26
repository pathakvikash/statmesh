"""MoSPI eSankhyiki REST connector. All behaviour is data-driven from manifest.yaml `datasets`.

Paging stops at `FetchRequest.max_rows` (default 20,000 rows per indicator). When the cap is
reached while more pages exist, that chunk carries `meta["truncated"] = True` and a warning is
logged; narrow with filters or raise max_rows.
"""

from __future__ import annotations

import calendar
import itertools
import json
import logging
import re
from collections.abc import Iterable
from datetime import UTC, date, datetime, timedelta, timezone
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

IST = timezone(timedelta(hours=5, minutes=30))
log = logging.getLogger(__name__)
_FREQ = {
    "cy": "A",
    "fy": "A",
    "cyq": "Q",
    "fyq": "Q",
    "monthly": "M",
    "fym": "M",
    "span": "A",
}
_MONTHS = {m: i for i, m in enumerate(calendar.month_name) if m}
_MAX_PAGE = 200  # API rejects limit > 200
_MAX_ROWS = 20_000  # ponytail: row cap per fetch when the request sets none; narrow with filters


def _fy(d: date) -> str:
    y = d.year - (d.month < 4)
    return f"{y}-{(y + 1) % 100:02d}"


def _years(start: date | None, end: date | None) -> list[str]:
    """Every Indian FY label (April-March) touched by start..end."""
    a = int(_fy(start)[:4])
    b = int(_fy(end or start)[:4])
    return [f"{y}-{(y + 1) % 100:02d}" for y in range(a, b + 1)]


def _unit(row: dict):
    u = row.get("unit")
    return None if u in (None, "", "-") else u  # "-" means unitless in several datasets


def _span(y: str):
    """'1951', '2016-20' (multi-year), '2022-23' (fiscal) or 'July 2014 - June 2015'."""
    if m := re.fullmatch(r"([A-Za-z]+) (\d{4}) ?- ?([A-Za-z]+) (\d{4})", y):
        a = parse_period(f"{m[2]}M{_MONTHS[m[1]]:02d}")
        return a[0], parse_period(f"{m[4]}M{_MONTHS[m[3]]:02d}")[1], "A"
    m = re.fullmatch(r"(\d{4})(?:-(\d{2,4}))?", y)
    if not m[2]:
        return parse_period(m[1])
    a, b = int(m[1]), int(m[2])
    b = b if b > 99 else a // 100 * 100 + b
    if b == a + 1:
        return parse_period(f"{a}-{b % 100:02d}", fiscal_start_month=4)
    return date(a, 1, 1), date(b, 12, 31), "A"


def _period(kind: str, row: dict, year_field: str):
    y = str(row[year_field])
    if kind == "span":
        return _span(y)
    if kind == "fym":  # FY "2025-26" + month name: April-December fall in the first year
        m = _MONTHS[row["month"].strip()]
        return parse_period(f"{int(y[:4]) + (m < 4)}M{m:02d}")
    if kind == "cy":  # "PLFS 2022" is a calendar year (the API gives no other annual rounds)
        return parse_period(re.search(r"(\d{4})$", y)[1])
    if kind == "cyq":  # "Jan-Mar" .. "Oct-Dec" with the calendar year
        q = {"Jan": 1, "Apr": 2, "Jul": 3, "Oct": 4}[row["quarter"][:3].title()]
        return parse_period(f"{y}Q{q}")
    if kind == "monthly":
        return parse_period(f"{y}M{list(calendar.month_name).index(row['month']):02d}")
    if kind == "fy":
        return parse_period(y, fiscal_start_month=4)
    return parse_period(f"{y[:4]}{row['quarter']}", fiscal_start_month=4)  # fyq: "2023-24" + "Q4"


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory
        self.geo_map = load_geo_map(directory)  # source misspellings, e.g. Chhatisgarh

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        for ds_id, cfg in list(self.manifest.datasets.items())[:limit]:
            inds = cfg.get("indicators") or {"": {"title": ""}}
            series = tuple(
                SeriesMeta(
                    f"{i}_{suffix}".strip("_"),
                    f"{cfg['title']} — "
                    + (" ".join(x for x in (ind["title"], vtitle) if x) or "Value")
                    + ", India",
                    description=f"{cfg['title']}; India (MoSPI eSankhyiki). Unit: {unit or 'per row'}.",
                    unit=unit or ind.get("unit"),
                    freq=_FREQ[cfg["period"]],
                    geos=("IND",),
                )
                for i, ind in inds.items()
                for suffix, vtitle, unit in cfg["values"].values()
            )
            yield DatasetMeta(
                source_id=self.manifest.id,
                dataset_id=ds_id,
                title=cfg["title"],
                licence=self.manifest.licence.model_copy(update=cfg.get("licence", {})),
                freq=_FREQ[cfg["period"]],
                series=series,
            )

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        cfg = self.manifest.datasets[req.dataset_id]
        ids = req.indicator_ids or tuple(cfg.get("indicators") or ("",))
        inds = cfg.get("indicators") or {}
        sfx = ["_" + v[0] for v in cfg["values"].values() if v[0]]
        # a series id ("gsdp_current") names the indicator plus a values suffix: strip the suffix
        ids = tuple(dict.fromkeys(
            next((i[: -len(x)] for x in sfx if i not in inds and i.endswith(x)), i) for i in ids
        ))  # fmt: skip
        dy = cfg.get("default_year")  # unfiltered calls time out: always send a year
        dys = [dy]
        if dy == "current_fy":
            cur = _fy(datetime.now(UTC).astimezone(IST).date())
            # the API lists the new FY before it has data: with no start and no year filter,
            # ask for the previous FY too, so an unfiltered call returns the latest FY with rows
            y0 = int(cur[:4])
            dys = [cur] if "year" in req.filters else [f"{y0 - 1}-{y0 % 100:02d}", cur]
        years = _years(req.start, req.end) if dy and req.start else dys
        for ind, yr in itertools.product(ids, years):
            params = {
                **cfg["params"],
                **cfg.get("all_india", {}),
                "limit": cfg.get("page_size", _MAX_PAGE),
            }
            if ind:
                params[cfg["code_param"]] = cfg["indicators"][ind]["code"]
            if yr:
                params["year"] = yr
            params.update(req.filters)  # raw API params: year, state_code, sector_code, ...
            cap, rows, page = req.max_rows or cfg.get("max_rows", _MAX_ROWS), 0, 1
            while True:
                resp = http.get(
                    self.manifest.endpoint + cfg["path"], params={**params, "page": page}
                )
                body = resp.json()
                rows += len(body.get("data", []))
                pages = (body.get("meta_data") or {}).get("totalPages", 1)
                truncated = page < pages and rows >= cap
                if truncated:
                    log.warning("mospi %s truncated at %d rows (max_rows)", req.dataset_id, cap)
                if page == 1 or body.get("data"):  # always one chunk so empty answers are visible
                    yield RawChunk(
                        source_id=self.manifest.id,
                        dataset_id=req.dataset_id,
                        content=resp.content,
                        media_type="application/json",
                        url=self.manifest.endpoint + cfg["path"],
                        params={**params, "page": page},
                        retrieved_at=datetime.now(UTC),
                        meta={"indicator": ind, **({"truncated": True} if truncated else {})},
                    )
                if page >= pages or rows >= cap:
                    break
                page += 1

    def normalize(self, chunk: RawChunk) -> pa.Table:
        cfg = self.manifest.datasets[chunk.dataset_id]
        cols: dict[str, list] = {f.name: [] for f in OBS_SCHEMA}
        for row in json.loads(chunk.content).get("data", []):
            start, end, freq = _period(cfg["period"], row, cfg["year"])
            state = row.get(cfg.get("geo", ""), "All India")
            geo = "IND" if state == "All India" else to_geo(state, "lgd_state", self.geo_map)
            dims = sorted(
                (d, str(row[f])) for f, d in cfg["dims"].items() if row.get(f) not in (None, "")
            )
            for field, (suffix, _title, unit) in cfg["values"].items():
                ind = f"{chunk.meta['indicator']}_{suffix}".strip("_")
                try:
                    value, status = float(row[field]), row.get("status")
                except (TypeError, ValueError, KeyError):
                    value, status = None, "missing"
                cols["series_id"].append(
                    make_series_id(chunk.source_id, chunk.dataset_id, ind, geo)
                )
                cols["source_id"].append(chunk.source_id)
                cols["dataset_id"].append(chunk.dataset_id)
                cols["indicator_id"].append(ind)
                cols["geo"].append(geo)
                cols["period_start"].append(start)
                cols["period_end"].append(end)
                cols["freq"].append(freq)
                cols["value"].append(value)
                cols["unit"].append(
                    "GWh"
                    if "in GWh" in str(row.get("end_use_sector"))
                    else None
                    or unit
                    or (cfg.get("indicators") or {}).get(chunk.meta["indicator"], {}).get("unit")
                    or _unit(row)
                )
                cols["unit_mult"].append(0)
                cols["dims"].append(dims)
                cols["obs_status"].append(status)
                cols["retrieved_at"].append(chunk.retrieved_at)
                cols["vintage"].append(None)
        return pa.table(cols, schema=OBS_SCHEMA)
