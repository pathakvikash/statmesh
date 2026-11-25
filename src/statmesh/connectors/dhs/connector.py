"""DHS Program indicator API (api.dhsprogram.com/rest/dhs) -> observations.

Quirks (probed 2026-11-26): keyless JSON, `{"Data": [...], "TotalPages": n}`; `/data` takes
countryIds (DHS codes: India is IA, not ISO), indicatorIds (comma list), breakdown=all (national
total + residence, wealth, education, ... + state rows) and page/perpage. One row per indicator x
survey x characteristic. SurveyYearLabel ("2019-21") gives the fieldwork span; SurveyYear is one
year of it. Some indicators repeat a row per reference window (ByVariableLabel, e.g. "Five years
preceding the survey"), kept as dims['by']. Value is numeric; CILow/CIHigh are strings, empty when
not published. State rows (CharacteristicCategory "Region") carry pre-split composites such as
"Bihar, inc Jharkhand": those do not map to one state and are dropped (logged as a warning).
"Jammu, Kashmir & Ladakh" is the whole J&K state before Ladakh was split off in 2019 (surveys up
to 2015-16: checked against the live region lists, 2026-11-26), so it maps to IN-JK there; the
2019-21 survey also carries it as a re-tabulated composite next to "Jammu & Kashmir" and "Ladakh"
rows, and that copy is dropped.
Gap: the observations schema has no confidence-interval columns, so CILow/CIHigh are not stored.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterable
from datetime import UTC, date, datetime
from pathlib import Path

import pyarrow as pa

from statmesh.core.geo import to_geo
from statmesh.core.http import HttpClient
from statmesh.core.models import (
    DatasetMeta,
    FetchRequest,
    Manifest,
    RawChunk,
    SeriesMeta,
    make_series_id,
)
from statmesh.core.schema import OBS_SCHEMA

log = logging.getLogger(__name__)
DATASET = "indicators"
PERPAGE = 1000
_REGION_ALIAS = {"New Delhi": "IN-DL", "Dadra and Nagar Haveli, Daman and Diu": "IN-DH"}


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        ds = self.manifest.datasets[DATASET]
        params = {"f": "json", "perpage": limit or 5000}  # 4,655 indicators fit one page
        rows = json.loads(http.get(f"{self.manifest.endpoint}/indicators", params=params).content)
        units = self.manifest.options["core_indicators"]
        series = tuple(
            SeriesMeta(
                r["IndicatorId"].replace(":", "_"),
                r["Label"].strip(),
                description=(r.get("Definition") or "").strip(),
                unit=units.get(r["IndicatorId"]),
                freq="A",
            )
            for r in rows["Data"]
        )
        yield DatasetMeta(
            self.manifest.id,
            DATASET,
            ds["title"],
            self.manifest.licence,
            source_url="https://dhsprogram.com/data/",
            freq="A",
            series=series,
        )

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        o = self.manifest.options
        by_iso = {iso: dhs for dhs, iso in o["countries"].items()}

        # a subnational geo ("IN-BR") is served by its country's fetch, which carries the state
        # rows; normalize then keeps only the requested geos (chunk.meta["geos"])
        def country(g: str) -> str:
            return to_geo(g.split("-")[0], "iso2") if "-" in g else g

        countries = (
            list(dict.fromkeys(by_iso[c] for g in req.geos if (c := country(g)) in by_iso))
            if req.geos
            else list(o["countries"])
        )
        inds = req.indicator_ids or tuple(o["core_indicators"])
        for cc in countries:
            params: dict[str, str | int] = {
                "countryIds": cc,
                "indicatorIds": ",".join(inds),
                "breakdown": "all",
                "perpage": PERPAGE,
                "f": "json",
            }
            if req.start:
                params["surveyYearStart"] = req.start.year
            if req.end:
                params["surveyYearEnd"] = req.end.year
            page, pages = 1, 1
            while page <= pages:
                r = http.get(f"{self.manifest.endpoint}/data", params={**params, "page": page})
                pages = int(r.json().get("TotalPages") or 1)
                yield RawChunk(
                    source_id=self.manifest.id,
                    dataset_id=DATASET,
                    content=r.content,
                    media_type="application/json",
                    url=str(r.request.url.copy_with(query=None)),
                    params={**params, "page": page},
                    retrieved_at=datetime.now(UTC),
                    meta={"geos": list(req.geos)} if req.geos else {},
                )
                page += 1

    def _span(self, r: dict) -> tuple[date, date]:
        label = str(r.get("SurveyYearLabel") or "")  # "1998-99", "2019-21", or "2015"
        y0 = int(r["SurveyYear"])
        if len(label) >= 4 and label[:4].isdigit():
            y0 = int(label[:4])
            tail = label[5:]
            y1 = int(label[:2] + tail) if len(tail) == 2 and tail.isdigit() else y0
            if y1 < y0:
                y1 = y0 + 1  # century rollover, e.g. "1999-00"
        else:
            y1 = y0
        return date(y0, 1, 1), date(y1, 12, 31)

    def _geo(self, r: dict, year: int) -> str | None:
        o = self.manifest.options
        cc = r["DHS_CountryCode"]
        cat, label = r["CharacteristicCategory"], r["CharacteristicLabel"]
        if cat == "Region":
            scheme = o.get("region_schemes", {}).get(cc)
            if not scheme:
                return None
            name = label.lstrip(".")
            if name == "Jammu, Kashmir & Ladakh" and year < 2019:
                return "IN-JK"  # the whole state before Ladakh was split off
            g = to_geo(_REGION_ALIAS.get(name, name), scheme)
            return None if g.startswith("unmapped:") else g
        return to_geo(o["countries"].get(cc, cc), "iso3")

    def normalize(self, chunk: RawChunk) -> pa.Table:
        o = self.manifest.options
        cols = {f.name: [] for f in OBS_SCHEMA}
        skipped: dict[str, int] = {}
        want = set(chunk.meta.get("geos") or ())
        for r in json.loads(chunk.content)["Data"]:
            v = r.get("Value")
            if v in (None, ""):
                continue
            cat = r["CharacteristicCategory"]
            dims: dict[str, str] = {}
            if cat not in ("Total", "Region"):
                if cat not in o["dim_categories"]:
                    continue
                dims[o["dim_categories"][cat]] = r["CharacteristicLabel"]
            start, end = self._span(r)
            geo = self._geo(r, start.year)
            if geo is None:
                label = r["CharacteristicLabel"].lstrip(".")
                skipped[label] = skipped.get(label, 0) + 1
                continue
            if want and geo not in want:
                continue
            if r.get("ByVariableLabel"):
                dims["by"] = r["ByVariableLabel"]
            if r.get("SurveyType") not in (None, "DHS"):
                dims["survey"] = r["SurveyType"]  # MIS etc. can share a year with a DHS
            ind = r["IndicatorId"].replace(":", "_")
            vals = dict(  # noqa: C408
                series_id=make_series_id(chunk.source_id, DATASET, ind, geo),
                source_id=chunk.source_id,
                dataset_id=DATASET,
                indicator_id=ind,
                geo=geo,
                period_start=start,
                period_end=end,
                freq="A",
                value=float(v),
                unit=o["core_indicators"].get(r["IndicatorId"]),
                unit_mult=0,
                dims=dict(sorted(dims.items())),
                obs_status=None,
                retrieved_at=chunk.retrieved_at,
                vintage=None,
            )
            for k, col in cols.items():
                col.append(vals[k])
        if skipped:
            log.warning("dhs: skipped %d region rows that map to no single state: %s",
                        sum(skipped.values()), ", ".join(sorted(skipped)))  # fmt: skip
        return pa.table(cols, schema=OBS_SCHEMA)
