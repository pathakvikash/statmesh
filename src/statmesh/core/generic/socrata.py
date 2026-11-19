"""Generic Socrata (SODA) connector, same shape as `ckan.py`: the domain's discovery API lists
datasets (catalog-only); observations only for datasets mapped in `mapping.yaml` (keys as in
`file.py`), read from `/resource/<id>.json` with `$limit/$offset/$where` paging.

manifest.yaml (kind: socrata)::

    endpoint: https://data.cdc.gov          # the portal domain
    options:
      page_size: 1000                       # rows per request
      max_rows: 100000                      # fetch cap when the request sets none
    datasets:
      bi63-dtpu:                            # 4x4 id
        where: "state='United States'"      # optional $where

The licence of a dataset is the portal's `metadata.license` string where present, else the
manifest's; the attribution is the manifest's, and `redistribute` is too unless the portal's
licence name differs from the manifest's, which downgrades it to `review`. When `max_rows` is hit
and the portal has more rows, the chunk carries `meta["truncated"] = True` and a warning is
logged. Socrata omits null fields, so
the CSV header is the union of keys seen. Not done: app tokens, request filters.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import UTC, datetime

from statmesh.core.generic.ckan import CkanConnector, parse_ts, records_csv
from statmesh.core.http import HttpClient
from statmesh.core.models import DatasetMeta, FetchRequest, RawChunk

log = logging.getLogger(__name__)


class SocrataConnector(CkanConnector):  # reuses the options helper and the CSV bridge
    def _catalog(self, http: HttpClient, **params) -> list[dict]:
        base = self.manifest.endpoint.rstrip("/")
        domain = base.split("//")[-1]
        r = http.get(
            f"{base}/api/catalog/v1", params={"domains": domain, "only": "datasets", **params}
        )
        r.raise_for_status()
        return r.json()["results"]

    def _meta(self, r: dict) -> DatasetMeta:
        res, lic = r["resource"], self.manifest.licence
        if name := r.get("metadata", {}).get("license"):
            upd = {"name": name}
            if name.strip().lower() != lic.name.strip().lower():
                upd["redistribute"] = "review"  # dataset licence differs from the portal's
            lic = lic.model_copy(update=upd)
        return DatasetMeta(
            source_id=self.manifest.id,
            dataset_id=res["id"],
            title=res["name"],
            description=res.get("description") or "",
            licence=lic,
            source_url=r.get("permalink"),
            last_updated=parse_ts(res.get("data_updated_at")),
        )

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        seen: set[str] = set()
        for ds in self.manifest.datasets:  # mapped datasets are always catalogued
            for r in self._catalog(http, ids=ds):
                seen.add(ds)
                yield self._meta(r)
        page, start = int(self._opt("page_size", 1000)), 0
        while limit is None or start < limit:
            rows = self._catalog(
                http, limit=min(page, limit - start) if limit else page, offset=start
            )
            for r in rows:
                if r["resource"]["id"] not in seen:
                    yield self._meta(r)
            start += len(rows)
            if not rows:
                break

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        opts = self.manifest.datasets[req.dataset_id] or {}
        self._map(req.dataset_id)
        url = f"{self.manifest.endpoint.rstrip('/')}/resource/{req.dataset_id}.json"
        cap = req.max_rows or int(self._opt("max_rows", 100_000))
        page = int(self._opt("page_size", 1000))
        records: list[dict] = []
        base = {"$order": ":id", **({"$where": opts["where"]} if opts.get("where") else {})}
        while len(records) < cap:
            n = min(page, cap - len(records))
            r = http.get(url, params={**base, "$limit": n, "$offset": len(records)})
            r.raise_for_status()
            rows = r.json()
            records += rows
            if len(rows) < n:
                break
        truncated = False
        if len(records) >= cap:  # probe one row past the cap
            probe = http.get(url, params={**base, "$limit": 1, "$offset": len(records)})
            probe.raise_for_status()
            truncated = bool(probe.json())
            if truncated:
                log.warning("%s: %s truncated at %d rows (max_rows)", self.manifest.id,
                            req.dataset_id, cap)  # fmt: skip
        yield RawChunk(
            source_id=self.manifest.id,
            dataset_id=req.dataset_id,
            content=records_csv(records),
            media_type="text/csv",
            url=url,
            params=base,
            retrieved_at=datetime.now(UTC),
            meta={"truncated": True} if truncated else {},
        )
