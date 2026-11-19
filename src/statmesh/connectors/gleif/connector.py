"""GLEIF: REST lookups by LEI / legal name (dataset `lei`) and opt-in bulk files.

REST (api.gleif.org/api/v1, no key, ~60 req/min): per LEI, `lei-records/{lei}` -> entities,
`.../isins` (first 200) -> xref lei->isin, `.../direct-parent-relationship` -> xref child->parent
(404 = no parent, skipped). Name search: `lei-records?filter[entity.legalName]=` (exact name).
Bulk (`golden-copy` = entities, `isin-lei`, `bic-lei` = xref): the manifest's `meta_url` returns JSON
naming the current zip; the zip is downloaded to a temp file and its CSV streamed in row batches. Bulk downloads honour the file host's robots.txt (PermissionError if disallowed).
Not done: children, ultimate parent, ISIN paging beyond 200, delta files.
"""

from __future__ import annotations

import csv
import io
import json
import tempfile
import zipfile
from collections.abc import Iterable, Iterator
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pyarrow as pa

from statmesh.core.generic.file import FileConnector
from statmesh.core.geo import to_geo
from statmesh.core.http import HttpClient
from statmesh.core.models import DatasetMeta, FetchRequest, Manifest, RawChunk
from statmesh.core.schema import ENTITIES_SCHEMA, XREF_SCHEMA

BATCH = 5000
_TITLES = {
    "lei": "LEI records (REST lookup by lei or name)",
    "golden-copy": "GLEIF golden copy, full LEI file (bulk)",
    "isin-lei": "ISIN to LEI mapping (bulk)",
    "bic-lei": "BIC to LEI mapping (bulk)",
}


def _country(code: str | None) -> str | None:
    if not code:
        return None
    g = to_geo(code, "iso2")
    return None if g.startswith("unmapped:") else g


def _entity_row(lei: str, name: str, legal: dict, hq: dict, extra: dict, now: datetime) -> dict:
    """legal/hq: line, city, region, country (ISO2), postcode. Matching reads attrs state/postcode
    (HQ) and legal_state/legal_postcode; region 'US-CA' is stored as state 'CA'."""
    st = lambda a: (a.get("region") or "").split("-")[-1]
    addr = ", ".join(x for x in (hq.get("line"), hq.get("city"), hq.get("region"),
                                 hq.get("postcode"), hq.get("country")) if x)  # fmt: skip
    attrs = {"city": hq.get("city"), "state": st(hq), "postcode": hq.get("postcode"),
             "legal_state": st(legal), "legal_postcode": legal.get("postcode"), **extra}  # fmt: skip
    return {
        "entity_id": f"lei:{lei}", "source_id": "gleif", "name": name,
        "country": _country(hq.get("country") or legal.get("country")),
        "industry_code": None, "industry_scheme": None, "address": addr or None,
        "attrs": {k: v for k, v in attrs.items() if v}, "retrieved_at": now,
    }  # fmt: skip


def _xref(pairs: list[tuple[str, str]], now: datetime) -> pa.Table:
    return pa.table(
        {
            "from_id": [a for a, _ in pairs], "to_id": [b for _, b in pairs],
            "source_id": ["gleif"] * len(pairs), "confidence": [1.0] * len(pairs),
            "inferred": [False] * len(pairs), "retrieved_at": [now] * len(pairs),
        },
        schema=XREF_SCHEMA,
    )  # fmt: skip


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        for ds, title in list(_TITLES.items())[:limit]:
            yield DatasetMeta(
                source_id="gleif", dataset_id=ds, title=title, licence=self.manifest.licence,
                source_url="https://www.gleif.org/en/lei-data/gleif-golden-copy",
            )  # fmt: skip

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        if req.dataset_id == "lei":
            yield from self._rest(req, http)
        elif req.dataset_id in ("golden-copy", "isin-lei", "bic-lei"):
            yield from self._bulk(req, http)
        else:
            raise ValueError(f"unknown gleif dataset {req.dataset_id!r}")

    def _chunk(self, req, url, params, content, kind, table, media="application/json"):
        return RawChunk(
            source_id="gleif", dataset_id=req.dataset_id, content=content, media_type=media,
            url=url, params=params, retrieved_at=datetime.now(UTC), table=table,
            meta={"kind": kind},
        )  # fmt: skip

    def _rest(self, req: FetchRequest, http: HttpClient) -> Iterator[RawChunk]:
        base = self.manifest.endpoint
        name = req.filters.get("name")
        if name:
            p = {"filter[entity.legalName]": name, "page[size]": "10"}
            r = http.get(f"{base}/lei-records", params=p)
            yield self._chunk(req, f"{base}/lei-records", p, r.content, "record", "entities")
        for lei in filter(None, (s.strip() for s in req.filters.get("lei", "").split(","))):
            url = f"{base}/lei-records/{lei}"
            r = http.get(url)
            yield self._chunk(req, url, {}, r.content, "record", "entities")
            p = {
                "page[size]": "200"
            }  # ponytail: first 200 ISINs only, page via links.next if needed
            r = http.get(f"{url}/isins", params=p)
            yield self._chunk(req, f"{url}/isins", p, r.content, "isins", "entity_xref")
            try:
                r = http.get(f"{url}/direct-parent-relationship")
            except httpx.HTTPStatusError as e:
                if e.response.status_code != 404:  # 404 = no parent on file
                    raise
                continue
            yield self._chunk(req, f"{url}/direct-parent-relationship", {}, r.content,
                              "parent", "entity_xref")  # fmt: skip

    def _bulk(self, req: FetchRequest, http: HttpClient) -> Iterator[RawChunk]:
        ds = req.dataset_id
        meta_url = self.manifest.datasets[ds]["meta_url"]
        d = http.get(meta_url).json()["data"]
        url = (
            d["full_file"]["csv"]["url"] if ds == "golden-copy" else d["attributes"]["downloadLink"]
        )
        if not FileConnector._robots_ok(self, url, http):  # same check as generic file.py
            raise PermissionError(f"robots.txt disallows {url}")
        kind, table = ("golden", "entities") if ds == "golden-copy" else (ds, "entity_xref")
        with tempfile.TemporaryDirectory() as tmp:
            zpath = http.download(url, Path(tmp) / "f.zip")
            with zipfile.ZipFile(zpath) as z:
                member = next(n for n in z.namelist() if n.lower().endswith(".csv"))
                with z.open(member) as f:
                    rows = csv.reader(io.TextIOWrapper(f, encoding="utf-8", newline=""))
                    header = next(rows)
                    while batch := [r for _, r in zip(range(BATCH), rows, strict=False)]:
                        buf = io.StringIO()
                        w = csv.writer(buf)
                        w.writerow(header)
                        w.writerows(batch)
                        yield self._chunk(req, url, {}, buf.getvalue().encode(), kind, table,
                                          "text/csv")  # fmt: skip

    # ---- pure ------------------------------------------------------------------------------

    def normalize(self, chunk: RawChunk) -> pa.Table:
        kind, now = chunk.meta["kind"], chunk.retrieved_at
        if kind in ("record", "isins", "parent"):
            body = json.loads(chunk.content)["data"]
        if kind == "record":
            return self._records(body if isinstance(body, list) else [body], now)
        if kind == "isins":
            pairs = [(f"lei:{a['lei']}", f"isin:{a['isin']}") for i in body
                     if (a := i["attributes"]).get("isin")]  # fmt: skip
            return _xref(pairs, now)
        if kind == "parent":
            n = body["attributes"]["relationship"]
            return _xref([(f"lei:{n['startNode']['id']}", f"lei:{n['endNode']['id']}")], now)
        rows = list(csv.DictReader(io.StringIO(chunk.content.decode())))
        if kind == "golden":
            return self._golden(rows, now)
        col = "ISIN" if kind == "isin-lei" else "BIC"
        pfx = col.lower()
        return _xref([(f"lei:{r['LEI']}", f"{pfx}:{r[col]}") for r in rows if r.get(col)], now)

    def _records(self, recs: list[dict], now: datetime) -> pa.Table:
        out = []
        for rec in recs:
            a, e = rec["attributes"], rec["attributes"]["entity"]

            def adr(x: dict) -> dict:
                return {"line": (x.get("addressLines") or [""])[0], "city": x.get("city"),
                        "region": x.get("region"), "country": x.get("country"),
                        "postcode": x.get("postalCode")}  # fmt: skip

            extra = {"status": e.get("status"), "jurisdiction": e.get("jurisdiction"),
                     "category": e.get("category"), "registered_as": e.get("registeredAs"),
                     "legal_form": (e.get("legalForm") or {}).get("id"),
                     "bic": ",".join(a.get("bic") or [])}  # fmt: skip
            out.append(_entity_row(a["lei"], e["legalName"]["name"], adr(e["legalAddress"]),
                                   adr(e["headquartersAddress"]), extra, now))  # fmt: skip
        return pa.Table.from_pylist(out, schema=ENTITIES_SCHEMA)

    def _golden(self, rows: list[dict], now: datetime) -> pa.Table:
        def adr(r: dict, p: str) -> dict:
            return {"line": r[f"{p}.FirstAddressLine"], "city": r[f"{p}.City"],
                    "region": r[f"{p}.Region"], "country": r[f"{p}.Country"],
                    "postcode": r[f"{p}.PostalCode"]}  # fmt: skip

        out = [
            _entity_row(
                r["LEI"], r["Entity.LegalName"], adr(r, "Entity.LegalAddress"),
                adr(r, "Entity.HeadquartersAddress"),
                {"status": r["Entity.EntityStatus"], "jurisdiction": r["Entity.LegalJurisdiction"],
                 "category": r["Entity.EntityCategory"],
                 "registered_as": r["Entity.RegistrationAuthority.RegistrationAuthorityEntityID"],
                 "legal_form": r["Entity.LegalForm.EntityLegalFormCode"]},
                now,
            )
            for r in rows
        ]  # fmt: skip
        return pa.Table.from_pylist(out, schema=ENTITIES_SCHEMA)
