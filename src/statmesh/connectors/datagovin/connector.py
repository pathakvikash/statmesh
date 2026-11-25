"""data.gov.in (OGD India) connector: paged catalog discover, resource fetch by id.

Fetch stops at `FetchRequest.max_rows` (default 5,000). When that cap is reached and the resource
has more rows, the last chunk carries `meta["truncated"] = True` and a warning is logged; narrow
with filters or raise max_rows.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path

import pyarrow as pa

from statmesh.core.geo import to_geo
from statmesh.core.http import HttpClient
from statmesh.core.models import DatasetMeta, FetchRequest, Manifest, RawChunk, make_series_id
from statmesh.core.periods import parse_period
from statmesh.core.schema import OBS_SCHEMA

log = logging.getLogger(__name__)
_CATALOG_PAGE = 100
_RESOURCE_PAGE = 500
_MAX_ROWS = 5_000  # ponytail: default row cap per fetch; raise via FetchRequest.max_rows


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory

    def _params(self, http: HttpClient, offset: int, limit: int) -> dict:
        return {"api-key": http.key, "format": "json", "offset": offset, "limit": limit}

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        offset = 0
        while limit is None or offset < limit:
            size = min(_CATALOG_PAGE, limit - offset) if limit else _CATALOG_PAGE
            body = http.get(
                f"{self.manifest.endpoint}/lists", params=self._params(http, offset, size)
            ).json()
            records = body.get("records", [])
            for r in records:
                updated = r.get("updated")
                yield DatasetMeta(
                    source_id=self.manifest.id,
                    dataset_id=r["index_name"],
                    title=r.get("title", r["index_name"]),
                    description=", ".join(r.get("sector") or []),
                    licence=self.manifest.licence,
                    last_updated=datetime.fromtimestamp(updated, UTC)
                    if isinstance(updated, int)
                    else None,
                )
            offset += len(records)
            if not records or offset >= int(body.get("total", 0)):
                return

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        url = f"{self.manifest.endpoint}/resource/{req.dataset_id}"
        cfg = self.manifest.datasets.get(req.dataset_id, {})
        cap, offset = req.max_rows or cfg.get("max_rows") or _MAX_ROWS, 0
        extra = {f"filters[{k}]": v for k, v in req.filters.items()}
        while True:
            params = {**self._params(http, offset, min(_RESOURCE_PAGE, cap - offset)), **extra}
            resp = http.get(url, params=params)
            body = resp.json()
            n = len(body.get("records", []))
            total = int(body.get("total", 0))
            truncated = bool(n) and offset + n >= cap and total > offset + n
            if truncated:
                log.warning("datagovin %s truncated at %d rows (max_rows)", req.dataset_id, cap)
            yield RawChunk(
                source_id=self.manifest.id,
                dataset_id=req.dataset_id,
                content=resp.content,
                media_type="application/json",
                url=url,
                params={**params, "api-key": "REDACTED"},
                retrieved_at=datetime.now(UTC),
                meta={"truncated": True} if truncated else {},
            )
            offset += n
            if not n or offset >= min(cap, total):
                return

    def normalize(self, chunk: RawChunk) -> pa.Table:
        cols: dict[str, list] = {f.name: [] for f in OBS_SCHEMA}
        cfg = self.manifest.datasets.get(chunk.dataset_id)
        if not cfg:
            log.warning(
                "datagovin resource %s has no `datasets.%s` mapping in manifest.yaml: 0 rows",
                chunk.dataset_id,
                chunk.dataset_id,
            )
            return pa.table(cols, schema=OBS_SCHEMA)
        # `indicators: {id: field}` makes one observation per field per record (mandi min/max/modal);
        # otherwise the single `indicator` + `value_field`.
        inds = cfg.get("indicators") or {cfg["indicator"]: cfg["value_field"]}
        records, bad = json.loads(chunk.content).get("records", []), 0
        for r in records:
            try:
                raw = str(r[cfg["period_field"]]).strip()
                if fmt := cfg.get("period_format"):
                    raw = datetime.strptime(raw, fmt).date().isoformat()
                start, end, freq = parse_period(
                    raw, fiscal_start_month=4 if cfg.get("period") == "fy" else 1
                )
            except (KeyError, ValueError):
                bad += 1
                continue
            state = r.get(cfg.get("geo_field", ""), "All India")
            if state == "All India":
                geo = "IND"
            elif cfg.get("geo_scheme"):
                geo = to_geo(state, cfg["geo_scheme"])
            else:
                geo = f"unmapped:{state}"
            dims = sorted((d, str(r[d])) for d in cfg.get("dims", []) if d in r)
            for indicator, field in inds.items():
                try:
                    value, status = float(r[field]), None
                except (TypeError, ValueError, KeyError):
                    value, status = None, "missing"
                cols["series_id"].append(
                    make_series_id(chunk.source_id, chunk.dataset_id, indicator, geo)
                )
                cols["source_id"].append(chunk.source_id)
                cols["dataset_id"].append(chunk.dataset_id)
                cols["indicator_id"].append(indicator)
                cols["geo"].append(geo)
                cols["period_start"].append(start)
                cols["period_end"].append(end)
                cols["freq"].append(freq)
                cols["value"].append(value)
                cols["unit"].append(cfg.get("unit"))
                cols["unit_mult"].append(0)
                cols["dims"].append(dims)
                cols["obs_status"].append(status)
                cols["retrieved_at"].append(chunk.retrieved_at)
                cols["vintage"].append(None)
        if bad:
            log.warning("datagovin %s: skipped %d of %d rows with a bad %s",
                        chunk.dataset_id, bad, len(records), cfg["period_field"])  # fmt: skip
            if bad == len(records):
                raise ValueError(f"datagovin {chunk.dataset_id}: every row has a bad period")
        if bad:
            log.warning("datagovin %s: skipped %d of %d rows with a bad %s",
                        chunk.dataset_id, bad, len(records), cfg["period_field"])  # fmt: skip
            if bad == len(records):
                raise ValueError(f"datagovin {chunk.dataset_id}: every row has a bad period")
        return pa.table(cols, schema=OBS_SCHEMA)
