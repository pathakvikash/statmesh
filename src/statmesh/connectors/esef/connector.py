"""ESEF filings via filings.xbrl.org (JSON:API) -> entities (`lei:`) and IFRS facts -> observations.

Datasets: `filings` (filing index; one entity per LEI) and `facts` (Revenue, ProfitLoss, Assets from
each filing's xBRL-JSON file). filters: `lei`, `country` (ISO2); req.start filters period_end >=.
max_rows caps filings listed (facts default: manifest max_filings). Quirks: xBRL-JSON period ends
are exclusive (T00:00:00 of the next day), so period_end = that minus 1 day; instants are freq D;
values are full units (not scaled); only facts with no extra dimensions are kept; the same filing may
exist in several languages/amendments and later filings repeat prior-year comparatives: dims hold
identity only (lei), and fetch marks facts already in a newer filing `superseded` so the latest filing wins; some filings have no
json_url (skipped); geo is the filing country (ISO2 -> ISO3), not the currency area.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx
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
from statmesh.core.schema import ENTITIES_SCHEMA, OBS_SCHEMA

_FREQ = (("A", 350, 380), ("S", 170, 190), ("Q", 80, 100))


def _d(s: str) -> date:
    return date.fromisoformat(s[:10])


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory
        self.concepts = manifest.options["concepts"]

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        lic, sid = self.manifest.licence, "esef"
        url = "https://filings.xbrl.org/docs/api"
        series = tuple(
            SeriesMeta(c.split(":")[1], f"{c} (ESEF reported fact)", freq=None)
            for c in self.concepts
        )
        yield from (
            DatasetMeta(sid, "filings", "ESEF filing index: issuers by LEI", lic, source_url=url),
            DatasetMeta(sid, "facts", "ESEF reported IFRS facts per filing", lic,
                        source_url=url, series=series),
        )[:limit]  # fmt: skip

    def _listing(self, req: FetchRequest, http: HttpClient, cap: int) -> Iterator[httpx.Response]:
        f = req.filters
        conds = [{"name": "entity.identifier", "op": "eq", "val": f["lei"]}] if f.get("lei") else []
        if f.get("country"):
            conds.append({"name": "country", "op": "eq", "val": f["country"]})
        if req.start:
            conds.append({"name": "period_end", "op": "ge", "val": req.start.isoformat()})
        params = {"include": "entity", "page[size]": min(cap, 1000)}
        if conds:
            params["filter"] = json.dumps(conds, separators=(",", ":"))
        url, seen = f"{self.manifest.endpoint}/api/filings", 0
        while url and seen < cap:
            r = http.get(url, params=params)
            yield r
            seen += len(r.json()["data"])
            url, params = r.json()["links"].get("next"), None

    def _chunk(self, req, resp, table, **meta) -> RawChunk:
        return RawChunk(
            source_id="esef", dataset_id=req.dataset_id, content=resp.content,
            media_type="application/json", url=str(resp.request.url), params={},
            retrieved_at=datetime.now(UTC), table=table, meta=meta,
        )  # fmt: skip

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        if req.dataset_id == "filings":
            for r in self._listing(req, http, req.max_rows or 1_000_000):
                yield self._chunk(req, r, "entities")
        elif req.dataset_id == "facts":
            cap = req.max_rows or self.manifest.options["max_filings"]
            left, got = cap, []
            for page in self._listing(req, http, cap):
                for x in page.json()["data"][:left]:
                    a = x["attributes"]
                    if not a.get("json_url"):
                        continue
                    try:
                        r = http.get(self.manifest.endpoint + a["json_url"])
                    except httpx.HTTPStatusError as e:
                        if e.response.status_code == 404:
                            continue
                        raise
                    got.append((a.get("published") or "", a, r))
                left -= len(page.json()["data"])
            # Newest filing first: a fact repeated as a comparative in an older filing is marked
            # superseded so only the latest filing's row survives (dims hold identity only).
            # ponytail: buffers the (<= max_filings) responses; stream per LEI if that grows.
            claimed: set[str] = set()
            for pub, a, r in sorted(got, key=lambda g: g[0], reverse=True):
                keys = {f["key"] for f in self._iter_facts(r.json())}
                yield self._chunk(req, r, "observations", country=a["country"],
                                  filing=a["fxo_id"], published=pub,
                                  superseded=sorted(keys & claimed))  # fmt: skip
                claimed |= keys
        else:
            raise ValueError(f"unknown dataset {req.dataset_id!r}")

    # ---- pure ------------------------------------------------------------------------------

    def normalize(self, chunk: RawChunk) -> pa.Table:
        doc = json.loads(chunk.content)
        return self._entities(doc, chunk) if chunk.table == "entities" else self._facts(doc, chunk)

    def _entities(self, doc, chunk) -> pa.Table:
        ents = {e["id"]: e["attributes"] for e in doc.get("included", [])}
        rows: dict[str, dict] = {}
        for x in doc["data"]:
            a, e = x["attributes"], ents[x["relationships"]["entity"]["data"]["id"]]
            row = rows.setdefault(e["identifier"], {
                "entity_id": f"lei:{e['identifier']}", "source_id": chunk.source_id,
                "name": e["name"], "country": _geo(a["country"]), "industry_code": None,
                "industry_scheme": None, "address": None, "attrs": {},
                "retrieved_at": chunk.retrieved_at,
            })  # fmt: skip
            row["attrs"] = {"latest_period_end": max(a["period_end"], row["attrs"].get("latest_period_end", ""))}  # fmt: skip
        return pa.Table.from_pylist(list(rows.values()), schema=ENTITIES_SCHEMA)

    def _iter_facts(self, doc) -> Iterator[dict]:
        seen = set()
        for f in doc["facts"].values():
            d = f["dimensions"]
            if (
                set(d) != {"concept", "entity", "period", "unit"}
                or d["concept"] not in self.concepts
            ):
                continue
            try:
                value = float(f["value"])
            except (TypeError, ValueError):
                continue
            a, _, b = d["period"].partition("/")
            end = _d(b or a) - timedelta(days=1)  # exclusive end -> inclusive
            start = _d(a) if b else end
            days = (end - start).days + 1
            freq = "D" if not b else next((q for q, lo, hi in _FREQ if lo <= days <= hi), None)
            lei = d["entity"].split(":")[-1]
            key = f"{lei}|{d['concept']}|{start}|{end}|{d['unit']}"
            if freq is None or key in seen:  # ponytail: drops YTD/odd stubs; first duplicate wins
                continue
            seen.add(key)
            yield {"key": key, "concept": d["concept"], "lei": lei, "start": start, "end": end,
                   "freq": freq, "value": value, "unit": d["unit"]}  # fmt: skip

    def _facts(self, doc, chunk) -> pa.Table:
        geo = _geo(chunk.meta["country"])
        pub = chunk.meta.get("published")
        skip = set(chunk.meta.get("superseded") or [])
        cols = {f.name: [] for f in OBS_SCHEMA}
        for f in self._iter_facts(doc):
            if f["key"] in skip:
                continue
            ind = f["concept"].split(":")[1]
            vals = {
                "series_id": make_series_id(chunk.source_id, chunk.dataset_id, ind, geo),
                "source_id": chunk.source_id, "dataset_id": chunk.dataset_id, "indicator_id": ind, "geo": geo,
                "period_start": f["start"], "period_end": f["end"], "freq": f["freq"], "value": f["value"],
                "unit": f["unit"].split(":")[-1], "unit_mult": 0,
                "dims": {"lei": f["lei"]}, "retrieved_at": chunk.retrieved_at,
                "vintage": _d(pub) if pub else None,
            }  # fmt: skip
            for k, col in cols.items():
                col.append(vals.get(k))
        return pa.table(cols, schema=OBS_SCHEMA)


def _geo(iso2: str) -> str:
    return to_geo(iso2, "iso2")
