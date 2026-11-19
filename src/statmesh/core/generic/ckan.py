"""Generic CKAN connector. Datasets are catalogued from `package_search` (catalog-only, resources
stay remote); observations exist only for datasets that have an entry in `mapping.yaml` (same
keys as `file.py`, which this class extends, plus `units: {indicator_id: unit}` for melted
columns that need different units) and are fetched on demand.

manifest.yaml (kind: ckan)::

    endpoint: https://open.canada.ca/data/api/3/action   # the CKAN action API root
    options:
      site_url: https://open.canada.ca/data   # optional: citation link is {site_url}/dataset/{id}
      q: "*:*"                                # optional package_search query / fq
      fq: "res_format:CSV"
      page_size: 100                          # rows per request (discover and datastore)
      max_rows: 100000                        # fetch cap when the request sets none
    datasets:
      <package name or id>:
        resource: <resource id or name>       # optional; default: first CSV/XLSX resource

A resource with `datastore_active` is read with `datastore_search`; any other resource is
downloaded (CSV or XLSX; no ZIP). The licence of each dataset comes from the package's
`license_title`/`license_url`; the attribution is the manifest's, and `redistribute` is too unless
the package's licence name differs from the manifest's, which downgrades it to `review`. When
`max_rows` is hit and the portal has more rows, the chunk carries `meta["truncated"] = True` and a
warning is logged. Not done: request filters, `datastore_search` filters, resource format ZIP.
"""

from __future__ import annotations

import csv
import io
import logging
from collections.abc import Iterable
from datetime import UTC, datetime

import pyarrow as pa
import pyarrow.compute as pc

from statmesh.core.generic.file import _MEDIA, FileConnector, _suffix
from statmesh.core.http import HttpClient
from statmesh.core.models import DatasetMeta, FetchRequest, RawChunk

log = logging.getLogger(__name__)


def records_csv(records: Iterable[dict], fields: list[str] | None = None) -> bytes:
    """JSON records -> CSV bytes, so `FileConnector.normalize` can read them. `fields` defaults to
    the union of keys (Socrata omits nulls)."""
    records = list(records)
    fields = fields or list(dict.fromkeys(k for r in records for k in r))
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(fields)
    for r in records:
        w.writerow(["" if r.get(f) is None else r[f] for f in fields])
    return out.getvalue().encode()


def parse_ts(s: str | None) -> datetime | None:
    try:
        return datetime.fromisoformat(s).astimezone(UTC) if s else None
    except ValueError:
        return None


class CkanConnector(FileConnector):
    def _opt(self, key: str, default=None):
        return self.manifest.options.get(key, default)

    def normalize(self, chunk: RawChunk) -> pa.Table:
        """FileConnector.normalize, then mapping `units: {indicator_id: unit}` (melted columns
        share one `unit`, so this is how each gets its own)."""
        t = super().normalize(chunk)
        for ind, unit in (self._map(chunk.dataset_id).get("units") or {}).items():
            unit_col = pc.if_else(pc.equal(t["indicator_id"], ind), unit, t["unit"])
            t = t.set_column(t.schema.get_field_index("unit"), t.schema.field("unit"), unit_col)
        return t

    def _api(self, http: HttpClient, action: str, **params):
        r = http.get(f"{self.manifest.endpoint.rstrip('/')}/{action}", params=params)
        r.raise_for_status()
        body = r.json()
        if not body.get("success"):
            raise RuntimeError(f"{self.manifest.id}: CKAN {action} failed: {body.get('error')}")
        return body["result"]

    def _meta(self, p: dict) -> DatasetMeta:
        lic = self.manifest.licence
        if p.get("license_title"):
            upd = {"name": p["license_title"], "url": p.get("license_url") or lic.url}
            if p["license_title"].strip().lower() != lic.name.strip().lower():
                upd["redistribute"] = "review"  # package licence differs from the portal's
            lic = lic.model_copy(update=upd)
        site = self._opt("site_url")
        return DatasetMeta(
            source_id=self.manifest.id,
            dataset_id=p["name"].replace(":", "_"),
            title=str(p.get("title") or p["name"]),
            description=str(p.get("notes") or ""),
            licence=lic,
            source_url=f"{site.rstrip('/')}/dataset/{p['name']}" if site else None,
            last_updated=parse_ts(p.get("metadata_modified")),
        )

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        seen: set[str] = set()
        for ds in self.manifest.datasets:  # mapped datasets are always catalogued
            seen.add(ds)
            yield self._meta(self._api(http, "package_show", id=ds))
        page, start = int(self._opt("page_size", 100)), 0
        while limit is None or start < limit:
            q = {"q": self._opt("q", "*:*"), "rows": min(page, limit - start) if limit else page}
            if fq := self._opt("fq"):
                q["fq"] = fq
            res = self._api(http, "package_search", start=start, **q)
            for p in res["results"]:
                if p["name"] not in seen:
                    yield self._meta(p)
            start += len(res["results"])
            if not res["results"] or start >= res["count"]:
                break

    def _resource(self, pkg: dict, want: str | None) -> dict:
        for r in pkg["resources"]:
            if want and want in (r["id"], r.get("name")):
                return r
            if not want and (r.get("format") or "").lower() in _MEDIA:
                return r
        raise KeyError(f"{self.manifest.id}: no usable resource in {pkg['name']!r} (want {want!r})")

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        opts = self.manifest.datasets[req.dataset_id] or {}
        self._map(req.dataset_id)
        res = self._resource(
            self._api(http, "package_show", id=req.dataset_id), opts.get("resource")
        )
        cap = req.max_rows or int(self._opt("max_rows", 100_000))
        page = int(self._opt("page_size", 100))
        if res.get("datastore_active"):
            truncated = False
            records, fields, url = (
                [],
                None,
                f"{self.manifest.endpoint.rstrip('/')}/datastore_search",
            )
            while len(records) < cap:
                r = self._api(
                    http, "datastore_search", resource_id=res["id"],
                    limit=min(page, cap - len(records)), offset=len(records),
                )  # fmt: skip
                fields = fields or [f["id"] for f in r["fields"] if f["id"] != "_id"]
                records += r["records"]
                truncated = len(records) >= cap and r["total"] > len(records)
                if len(r["records"]) < page or len(records) >= r["total"]:
                    break
            content, media, params = (
                records_csv(records, fields),
                "text/csv",
                {"resource_id": res["id"]},
            )
        else:
            truncated = False
            url, params = res["url"], {}
            if not self._robots_ok(url, http):
                raise PermissionError(f"robots.txt disallows {url}")
            resp = http.get(url)
            resp.raise_for_status()
            content, media = resp.content, _MEDIA[(res.get("format") or _suffix(url)).lower()]
        if truncated:
            log.warning(
                "%s: %s truncated at %d rows (max_rows)", self.manifest.id, req.dataset_id, cap
            )
        yield RawChunk(
            source_id=self.manifest.id,
            dataset_id=req.dataset_id,
            content=content,
            media_type=media,
            url=url,
            params=params,
            retrieved_at=datetime.now(UTC),
            meta={"truncated": True} if truncated else {},
        )
