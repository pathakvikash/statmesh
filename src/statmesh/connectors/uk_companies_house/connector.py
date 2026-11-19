"""UK Companies House -> entities (`uk:<number>`).

Datasets: `snapshot` (free monthly bulk CSV zip, no key; filters.part=1..7 picks a ~70 MB part file
instead of the 470 MB one-file zip) and `company` (REST, key as HTTP basic-auth username; filters
`number` = comma list -> /company/{n}, `q` -> /search/companies). Quirks: bulk CSV header names carry
stray leading spaces; dates are dd/mm/yyyy; SIC cells look like "62020 - Computer consultancy ..."
(SIC 2007); REST profiles list `sic_codes` as bare codes. The bulk download honours robots.txt (PermissionError if disallowed). Accounts bulk data is deferred (plan).
"""

from __future__ import annotations

import base64
import csv
import io
import json
import re
import tempfile
import zipfile
from collections.abc import Iterable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote

import httpx
import pyarrow as pa

from statmesh.core.generic.file import FileConnector
from statmesh.core.geo import to_geo
from statmesh.core.http import HttpClient, MissingKey
from statmesh.core.models import DatasetMeta, FetchRequest, Manifest, RawChunk
from statmesh.core.schema import ENTITIES_SCHEMA

BATCH = 5000
_TITLES = {
    "snapshot": "Company register snapshot (monthly bulk CSV)",
    "company": "Company profile / name search (REST lookup by number or q)",
}


def _iso(d: str | None) -> str | None:
    d = (d or "").strip()
    return f"{d[6:]}-{d[3:5]}-{d[:2]}" if re.fullmatch(r"\d\d/\d\d/\d{4}", d) else (d or None)


def _country(name: str | None) -> str | None:
    g = to_geo(name or "United Kingdom", "name")
    return None if g.startswith("unmapped:") else g


def _row(number, name, sics, addr, attrs, now, country=None) -> dict:
    sics = [s for s in sics if s]
    return {
        "entity_id": f"uk:{number.strip()}", "source_id": "uk_companies_house",
        "name": name.strip(), "country": country, "industry_code": sics[0] if sics else None,
        "industry_scheme": "SIC" if sics else None,  # SIC 2007
        "address": ", ".join(p.strip() for p in addr if p and p.strip()) or None,
        "attrs": {k: v for k, v in {**attrs, "sic_codes": ",".join(sics)}.items() if v},
        "retrieved_at": now,
    }  # fmt: skip


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        for ds, title in list(_TITLES.items())[:limit]:
            yield DatasetMeta(
                source_id="uk_companies_house", dataset_id=ds, title=title,
                licence=self.manifest.licence,
                source_url="https://download.companieshouse.gov.uk/en_output.html",
            )  # fmt: skip

    def _chunk(self, req, url, content, kind, media="application/json") -> RawChunk:
        return RawChunk(
            source_id="uk_companies_house", dataset_id=req.dataset_id, content=content,
            media_type=media, url=url, params={}, retrieved_at=datetime.now(UTC),
            table="entities", meta={"kind": kind},
        )  # fmt: skip

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        if req.dataset_id == "snapshot":
            return self._bulk(req, http)
        if req.dataset_id == "company":
            return self._rest(req, http)
        raise ValueError(f"unknown dataset {req.dataset_id!r}")

    def _rest(self, req: FetchRequest, http: HttpClient) -> Iterator[RawChunk]:
        if not http.key:
            raise MissingKey("uk_companies_house: set COMPANIES_HOUSE_API_KEY for REST lookups")
        auth = {"Authorization": "Basic " + base64.b64encode(f"{http.key}:".encode()).decode()}
        base = self.manifest.endpoint
        if q := req.filters.get("q"):
            n = min(req.max_rows or 20, 100)
            r = http.get(f"{base}/search/companies", params={"q": q, "items_per_page": n},
                         headers=auth)  # fmt: skip
            yield self._chunk(req, str(r.request.url), r.content, "search")
        for num in filter(None, (s.strip() for s in req.filters.get("number", "").split(","))):
            try:
                r = http.get(f"{base}/company/{quote(num, safe='')}", headers=auth)
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 404:  # no such company
                    continue
                raise
            yield self._chunk(req, str(r.request.url), r.content, "profile")

    def _bulk(self, req: FetchRequest, http: HttpClient) -> Iterator[RawChunk]:
        page = self.manifest.options["bulk_page"]
        names = re.findall(r'href="(BasicCompanyData[^"]*\.zip)"', http.get(page).text)
        part = req.filters.get("part")
        pick = [n for n in names if (f"part{part}_" in n if part else "AsOneFile" in n)]
        if not pick:
            raise ValueError(f"no snapshot zip on {page} for part={part!r}")
        url = page.rsplit("/", 1)[0] + "/" + pick[0]
        if not FileConnector._robots_ok(self, url, http):  # same check as generic file.py
            raise PermissionError(f"robots.txt disallows {url}")
        left = req.max_rows
        with tempfile.TemporaryDirectory() as tmp:
            zpath = http.download(url, Path(tmp) / "f.zip")
            with zipfile.ZipFile(zpath) as z:
                member = next(n for n in z.namelist() if n.lower().endswith(".csv"))
                with z.open(member) as f:
                    rows = csv.reader(io.TextIOWrapper(f, encoding="utf-8", newline=""))
                    header = [h.strip() for h in next(rows)]
                    while batch := [r for _, r in zip(range(min(BATCH, left or BATCH)), rows,
                                                      strict=False)]:  # fmt: skip
                        buf = io.StringIO()
                        w = csv.writer(buf)
                        w.writerow(header)
                        w.writerows(batch)
                        yield self._chunk(req, url, buf.getvalue().encode(), "bulk", "text/csv")
                        if left is not None and (left := left - len(batch)) <= 0:
                            break

    # ---- pure ------------------------------------------------------------------------------

    def normalize(self, chunk: RawChunk) -> pa.Table:
        kind, now = chunk.meta["kind"], chunk.retrieved_at
        if kind == "bulk":
            out = [
                self._bulk_row(r, now) for r in csv.DictReader(io.StringIO(chunk.content.decode()))
            ]
        else:
            d = json.loads(chunk.content)
            out = [self._profile(d, now)] if kind == "profile" else [
                self._hit(i, now) for i in d.get("items", [])
            ]  # fmt: skip
        return pa.Table.from_pylist(out, schema=ENTITIES_SCHEMA)

    def _bulk_row(self, r: dict, now) -> dict:
        sics = [(r.get(f"SICCode.SicText_{i}") or "").split(" - ")[0].strip() for i in range(1, 5)]
        a = [r[k] for k in ("RegAddress.AddressLine1", "RegAddress.AddressLine2",
                            "RegAddress.PostTown", "RegAddress.County", "RegAddress.PostCode")]  # fmt: skip
        attrs = {"status": r["CompanyStatus"], "category": r["CompanyCategory"],
                 "incorporated": _iso(r["IncorporationDate"]), "dissolved": _iso(r["DissolutionDate"]),
                 "postcode": r["RegAddress.PostCode"].strip(), "country_of_origin": r["CountryOfOrigin"],
                 "accounts_category": r["Accounts.AccountCategory"]}  # fmt: skip
        return _row(r["CompanyNumber"], r["CompanyName"], sics, a, attrs, now,
                    _country(r["CountryOfOrigin"]))  # fmt: skip

    def _profile(self, d: dict, now) -> dict:
        o = d.get("registered_office_address") or {}
        a = [o.get(k) for k in ("address_line_1", "address_line_2", "locality", "region", "postal_code")]  # fmt: skip
        attrs = {"status": d.get("company_status"), "category": d.get("type"),
                 "incorporated": d.get("date_of_creation"), "dissolved": d.get("date_of_cessation"),
                 "postcode": o.get("postal_code"), "jurisdiction": d.get("jurisdiction")}  # fmt: skip
        return _row(d["company_number"], d["company_name"], d.get("sic_codes") or [], a, attrs, now,
                    "GBR")  # fmt: skip

    def _hit(self, i: dict, now) -> dict:
        o = i.get("address") or {}
        a = [o.get(k) for k in ("premises", "address_line_1", "locality", "region", "postal_code")]
        attrs = {"status": i.get("company_status"), "category": i.get("company_type"),
                 "incorporated": i.get("date_of_creation"), "postcode": o.get("postal_code")}  # fmt: skip
        return _row(i["company_number"], i["title"], [], a, attrs, now, "GBR")
