"""SEC EDGAR: XBRL frames, company concept, and entities (submissions) -> observations/entities/xref.

Quirks (see also the report in docs): frames carry the fact's own `start` when the source has it
(else it is derived from the end, flagged obs_status=start_derived) and `loc` (US-WA -> USA, other
ISO2 prefixes -> that country, unknown -> unmapped:<loc>); companyconcept repeats a fact in every later filing (comparatives, 10-K/A)
so we keep the latest filing per period. dims hold identity only (cik[, frame]); form/fp/fy
describe the filing, not the fact, and change on every refresh, so they are not part of the key.
"""

from __future__ import annotations

import calendar
import json
import re
from collections.abc import Iterable
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from urllib.parse import quote

import httpx
import pyarrow as pa
import pycountry

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
from statmesh.core.schema import ENTITIES_SCHEMA, OBS_SCHEMA, XREF_SCHEMA

WWW = "https://www.sec.gov"
_US = {x.code[3:] for x in pycountry.subdivisions.get(country_code="US")}
_CCP = re.compile(r"^CY(\d{4})(?:Q([1-4]))?(I)?$")


def _cik10(cik) -> str:
    return f"{int(cik):010d}"


def _months_back(end: date, n: int) -> date:
    """First day of the n-month period that ends on `end` (inclusive)."""
    d = end + timedelta(days=1)
    y, m = divmod(d.year * 12 + d.month - 1 - n, 12)
    return date(y, m + 1, min(d.day, calendar.monthrange(y, m + 1)[1]))


def _loc_geo(loc: str | None) -> str:
    """Frames `loc`: "US-WA" -> USA; "GB" / "CA-ON" -> that country; missing/unknown -> unmapped."""
    return to_geo(loc.split("-")[0], "iso2") if loc else "unmapped:unknown"


def _get_or_none(http: HttpClient, url: str) -> httpx.Response | None:
    try:
        return http.get(url)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:  # concept unused in that period / by that filer
            return None
        raise


def frame_periods(period: str | None, start: date | None, end: date | None) -> list[str]:
    if period:
        return [period]
    last = date.today().year - 1  # latest complete calendar year
    y1 = start.year if start else (end.year if end else last)
    y2 = end.year if end else max(last, y1)
    return [f"CY{y}" for y in range(y1, max(y1, y2) + 1)]


def _q(v: str) -> str:
    return quote(v, safe="")


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory
        o = manifest.options
        self.taxonomy, self.unit, self.concepts = o["taxonomy"], o["unit"], o["revenue_concepts"]

    # ---- discover ------------------------------------------------------------------------------

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        lic, sid = self.manifest.licence, self.manifest.id
        series = tuple(
            SeriesMeta(c, f"{c} (revenue concept)", unit="USD", freq="A", geos=("USA",))
            for c in self.concepts
        )
        yield from (
            DatasetMeta(
                sid,
                "frames",
                "XBRL frames: one concept across all filers per period",
                lic,
                source_url="https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
                freq="A",
                series=series,
            ),
            DatasetMeta(
                sid,
                "companyconcept",
                "XBRL company concept: one concept for one filer",
                lic,
                freq="A",
                series=series,
            ),
            DatasetMeta(sid, "entities", "EDGAR filers: name, SIC industry, tickers, state", lic),
        )

    # ---- fetch ---------------------------------------------------------------------------------

    def _chunk(self, req, resp, table="observations", **meta) -> RawChunk:
        return RawChunk(
            source_id=self.manifest.id,
            dataset_id=req.dataset_id,
            content=resp.content,
            media_type="application/json",
            url=str(resp.request.url),
            params={},
            retrieved_at=datetime.now(UTC),
            table=table,
            meta=meta,
        )

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        base, f = self.manifest.endpoint, req.filters
        tax, unit = f.get("taxonomy", self.taxonomy), f.get("unit", self.unit)
        concepts = req.indicator_ids or self.concepts
        if req.dataset_id == "frames":
            # filters.period wins (CY2024, CY2024Q2, CY2024Q2I); else every CY in start..end;
            # else the latest complete CY.
            for period in frame_periods(f.get("period"), req.start, req.end):
                for c in concepts:
                    url = f"{base}/api/xbrl/frames/{_q(tax)}/{_q(c)}/{_q(unit)}/{_q(period)}.json"
                    if r := _get_or_none(http, url):
                        yield self._chunk(req, r)
        elif req.dataset_id == "companyconcept":
            for cik in f["ciks"].split(","):
                for c in concepts:
                    url = f"{base}/api/xbrl/companyconcept/CIK{_cik10(cik)}/{_q(tax)}/{_q(c)}.json"
                    if r := _get_or_none(http, url):
                        yield self._chunk(req, r)
        elif req.dataset_id == "entities":
            ciks = f["ciks"].split(",") if f.get("ciks") else None
            if ciks is None:  # enumerate filers from the tickers file, largest first
                tickers = http.get(f"{WWW}/files/company_tickers.json").json().values()
                ciks = list(dict.fromkeys(str(t["cik_str"]) for t in tickers))[: req.max_rows]
            for cik in ciks:
                r = http.get(f"{base}/submissions/CIK{_cik10(cik)}.json")
                yield self._chunk(req, r, "entities")
                yield self._chunk(req, r, "entity_xref")  # same body, ticker rows
        else:
            raise ValueError(f"unknown dataset {req.dataset_id!r}")

    # ---- normalize -----------------------------------------------------------------------------

    def normalize(self, chunk: RawChunk) -> pa.Table:
        doc = json.loads(chunk.content)
        if chunk.table == "entities":
            return self._entities(doc, chunk)
        if chunk.table == "entity_xref":
            return self._xref(doc, chunk)
        rows = self._frames(doc) if chunk.dataset_id == "frames" else self._concept(doc)
        cols = {f.name: [] for f in OBS_SCHEMA}
        for r in rows:
            geo = r.pop("geo", "USA")
            vals = dict(
                series_id=make_series_id(chunk.source_id, chunk.dataset_id, doc["tag"], geo),
                source_id=chunk.source_id,
                dataset_id=chunk.dataset_id,
                indicator_id=doc["tag"],
                geo=geo,
                unit_mult=0,
                retrieved_at=chunk.retrieved_at,
                **r,
            )
            for k, col in cols.items():
                col.append(vals.get(k))
        return pa.table(cols, schema=OBS_SCHEMA)

    def _frames(self, doc) -> Iterable[dict]:
        m = _CCP.match(doc["ccp"])
        n = 12 if m.group(2) is None else 3  # months in the period (instants ignore it)
        freq = "D" if m.group(3) else ("A" if m.group(2) is None else "Q")
        for d in doc["data"]:
            end = date.fromisoformat(d["end"])
            if freq == "D":
                start = end
            elif d.get("start"):
                start = date.fromisoformat(d["start"])
            else:
                start = _months_back(end, n)
            yield {
                "geo": _loc_geo(d.get("loc")),
                "period_start": start,
                "period_end": end,
                "freq": freq,
                "value": float(d["val"]),
                "unit": doc["uom"],
                "dims": {"cik": _cik10(d["cik"]), "frame": doc["ccp"]},
                "obs_status": "start_derived" if freq != "D" and not d.get("start") else None,
                "vintage": None,
            }

    def _concept(self, doc) -> Iterable[dict]:
        latest: dict[tuple, dict] = {}  # one fact per (unit, start, end): the latest filing wins
        for unit, facts in doc["units"].items():
            for x in facts:
                k = (unit, x.get("start"), x["end"])
                if k not in latest or (x["filed"], x["accn"]) > (
                    latest[k]["filed"],
                    latest[k]["accn"],
                ):
                    latest[k] = {**x, "unit": unit}
        for (unit, start, end), x in sorted(latest.items(), key=lambda kv: kv[0][1:] + kv[0][:1]):
            e = date.fromisoformat(end)
            s = date.fromisoformat(start) if start else e
            days = (e - s).days + 1 if start else 0
            freq = (
                "D"
                if not start
                else next(
                    (
                        f
                        for f, lo, hi in (("A", 350, 380), ("S", 170, 190), ("Q", 80, 100))
                        if lo <= days <= hi
                    ),
                    None,
                )
            )
            if (
                freq is None
            ):  # ponytail: drops 9-month YTD and odd stubs; add "YTD" handling if needed
                continue
            yield {
                "period_start": s,
                "period_end": e,
                "freq": freq,
                "value": float(x["val"]),
                "unit": unit,
                "dims": {"cik": _cik10(doc["cik"])},
                "obs_status": "amended" if x["form"].endswith("/A") else None,
                "vintage": date.fromisoformat(x["filed"]),
            }

    def _entities(self, d, chunk) -> pa.Table:
        biz = (d.get("addresses") or {}).get("business") or {}
        st = biz.get("stateOrCountry")
        address = ", ".join(
            p for p in (biz.get("street1"), biz.get("city"), st, biz.get("zipCode")) if p
        )
        attrs = {
            "sic_description": d.get("sicDescription"),
            "state": st,
            "state_of_incorporation": d.get("stateOfIncorporation"),
            "fiscal_year_end": d.get("fiscalYearEnd"),
            "tickers": ",".join(d.get("tickers") or []),
            "exchanges": ",".join(e for e in d.get("exchanges") or [] if e),
        }
        row = {
            "entity_id": f"cik:{_cik10(d['cik'])}",
            "source_id": chunk.source_id,
            "name": d["name"],
            "country": "USA"
            if st in _US
            else None,  # SEC uses 2-letter state codes, non-ISO abroad
            "industry_code": d.get("sic") or None,
            "industry_scheme": "SIC" if d.get("sic") else None,
            "address": address or None,
            "attrs": {k: v for k, v in attrs.items() if v},
            "retrieved_at": chunk.retrieved_at,
        }
        return pa.Table.from_pylist([row], schema=ENTITIES_SCHEMA)

    def _xref(self, d, chunk) -> pa.Table:
        rows = [
            {
                "from_id": f"cik:{_cik10(d['cik'])}",
                "to_id": f"ticker:{t}",
                "source_id": chunk.source_id,
                "confidence": 1.0,
                "inferred": False,
                "retrieved_at": chunk.retrieved_at,
            }
            for t in d.get("tickers") or []
        ]
        return pa.Table.from_pylist(rows, schema=XREF_SCHEMA)
