"""Generic SDMX 2.1 connector, driven entirely by `manifest.yaml`.

Data is requested as SDMX-CSV (`Accept: application/vnd.sdmx.data+csv`) and parsed with pyarrow;
structure messages (dataflow list, DSD, codelists) are parsed with sdmx1. All HTTP goes through
the `HttpClient` we are handed. SDMX-ML data is not supported: IMF, OECD, ILOSTAT and Eurostat
all serve SDMX-CSV.

Manifest fields used: `endpoint` (SDMX 2.1 REST root), `refresh.incremental: updatedAfter`
(adds `updatedAfter` to data requests), `core_datasets`.

Options. Put them in `options:` (all datasets) and override per dataset in `datasets.<id>:`;
a dataset key wins. Names are the source's own, case-sensitive (Eurostat is lower case).

  agency            Agency in the flow ref `AGENCY,ID`. Omit it to send only `ID` (IMF, OECD).
  list_path         Dataflow-list path under `endpoint`. Default `dataflow/all`.
  list_params       Query params for the list, e.g. `{detail: allstubs}`.
  structure_path    Per-dataflow structure path; `{agency}` (default `all`) and `{id}` are filled.
                    Default `dataflow/{agency}/{id}/latest`.
  structure_references  `references` for the structure request made by `fetch` (it only needs
                    the DSD's dimension order). Default `descendants`; use `children` when the
                    codelists are huge (ECB FM: 23 MB vs 36 KB). `discover` always uses
                    `descendants`, because indicator titles come from codelist names.
  accept            Accept header for data requests. Default SDMX-CSV 1.0 (`CSV`); ECB only
                    serves `text/csv`.
  geo_dim           Geo dimension. Default `REF_AREA`.
  geo_scheme        iso3 (default) | iso2 | m49 | name. Exceptions go in `geo_map.csv`
                    (`src_code,geo`, also used in reverse for request geos).
  time_dim          Default `TIME_PERIOD`.
  freq_dim          Default `FREQ`; excluded from `dims` (frequency comes from the period).
  value_col         Default `OBS_VALUE`.
  unit_col          CSV column holding the unit (e.g. `UNIT_MEASURE`). Optional.
  unit              Constant unit used when the unit column is absent or empty. Optional.
  units             `{indicator_id: unit}` for indicators whose unit column is empty (wins over
                    `unit`), e.g. `{"CPI._T.YOY_PCH_PA_PT": "Percent change, year over year"}`.
  unit_mult_col     CSV column holding the power of ten (`UNIT_MULT`, IMF `SCALE`). Optional.
  status_col        Observation status column. Default `OBS_STATUS`.
  indicator_dims    Dimensions that make up `indicator_id` (values joined by "."). Default none:
                    indicator_id is then `VALUE`. Every other dimension lands in `dims`.
  filters           `{DIM: code | [codes]}` applied to every request unless the FetchRequest
                    overrides that dim; also limits indicator expansion in `discover`.
  codelists         `{DIM: codelist id}` for dimensions whose DSD does not link a codelist
                    (IMF). Falls back to `CL_<DIM>`.
  fiscal_start_month  Passed to `parse_period`. Default 1.

Period strings like `2024-M01` (IMF) are rewritten to `2024-01` before parsing.
"""

from __future__ import annotations

import csv
import io
import itertools
import logging
import math
import re
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

import pyarrow as pa
import pyarrow.csv as pacsv
import pycountry
import sdmx

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

log = logging.getLogger(__name__)
CSV = "application/vnd.sdmx.data+csv;version=1.0.0"
MAX_INDICATORS = 500  # per dataset in discover; narrow with `filters` for wider codelists
_DEFAULTS: dict[str, Any] = {
    "accept": CSV,
    "units": {},
    "geo_dim": "REF_AREA",
    "geo_scheme": "iso3",
    "time_dim": "TIME_PERIOD",
    "freq_dim": "FREQ",
    "value_col": "OBS_VALUE",
    "status_col": "OBS_STATUS",
    "list_path": "dataflow/all",
    "structure_path": "dataflow/{agency}/{id}/latest",
    "structure_references": "descendants",
    "fiscal_start_month": 1,
    "indicator_dims": [],
    "filters": {},
    "codelists": {},
}


def _list(v: Any) -> list[str]:
    return [] if v is None else [str(x) for x in v] if isinstance(v, list | tuple) else [str(v)]


def _name(x: Any) -> str:
    try:
        return str(x.name.localized_default())
    except Exception:  # noqa: BLE001 - structure names are best effort
        return str(x.id)


def _period(s: str) -> str:
    return s.replace("-M", "-") if "-M" in s else s


_SCALE = re.compile(r"\b(thousand|million|billion|trillion)s?\b", re.IGNORECASE)


def _int(s: str | None) -> int | None:
    try:
        return int(float(s)) if s else None
    except ValueError:
        return None


class SdmxConnector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = Path(directory)
        self.geo_map = load_geo_map(self.dir)
        self._rev: dict[str, str] = {}  # first geo_map row wins (list EA20 before EA19)
        for k, v in self.geo_map.items():
            self._rev.setdefault(v, k)

    def _cfg(self, dataset_id: str | None = None) -> dict[str, Any]:
        cfg = {**_DEFAULTS, **self.manifest.options}
        if dataset_id:
            cfg.update(self.manifest.datasets.get(dataset_id, {}))
        return cfg

    def _url(self, path: str) -> str:
        return f"{(self.manifest.endpoint or '').rstrip('/')}/{path}"

    def _structure(
        self, dataset_id: str, http: HttpClient, references: str | None = None
    ) -> sdmx.message.StructureMessage:
        cfg = self._cfg(dataset_id)
        path = cfg["structure_path"].format(agency=cfg.get("agency") or "all", id=dataset_id)
        r = http.get(
            self._url(path),
            params={"references": references or cfg["structure_references"]},
            cache_ttl_s=self.manifest.cache_ttl_days * 86400,
        )
        return sdmx.read_sdmx(io.BytesIO(r.content))

    @staticmethod
    def _codes(msg: Any, dsd: Any, dim: str, cfg: dict[str, Any]) -> dict[str, str]:
        cl = None
        d = next((c.get(dim) for c in (dsd.dimensions, dsd.attributes) if dim in c), None)
        # (UNIT_MEASURE is an attribute in some DSDs)
        if d is not None and d.local_representation and d.local_representation.enumerated:
            cl = d.local_representation.enumerated
        if cl is None or not len(cl):
            cl = msg.codelist.get(cfg["codelists"].get(dim) or f"CL_{dim}")
        return {c.id: _name(c) for c in cl} if cl is not None else {}

    # ---- discover ----------------------------------------------------------------------------

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        cfg = self._cfg()
        r = http.get(
            self._url(cfg["list_path"]),
            params=cfg.get("list_params"),
            cache_ttl_s=self.manifest.cache_ttl_days * 86400,
        )
        flows = {str(f.id): f for f in sdmx.read_sdmx(io.BytesIO(r.content)).dataflow.values()}
        core = list(self.manifest.core_datasets)
        ids = core + [i for i in flows if i not in core]  # core first so `limit` never drops it
        for ds_id in ids[:limit]:
            f = flows.get(ds_id)
            title = _name(f) if f is not None else ds_id
            desc = str(f.description.localized_default()) if f is not None and f.description else ""
            series = self._series(ds_id, title, http) if ds_id in core else ()
            yield DatasetMeta(
                source_id=self.manifest.id,
                dataset_id=ds_id,
                title=title,
                licence=self.manifest.licence,
                description=desc,
                source_url=self.manifest.endpoint,
                series=series,
            )

    def _series(self, ds_id: str, title: str, http: HttpClient) -> tuple[SeriesMeta, ...]:
        cfg = self._cfg(ds_id)
        if not cfg["indicator_dims"]:
            return (SeriesMeta("VALUE", title),)
        msg = self._structure(ds_id, http, "descendants")
        dsd = next(iter(msg.structure.values()))
        axes = []
        for dim in cfg["indicator_dims"]:
            names = self._codes(msg, dsd, dim, cfg)
            want = _list(cfg["filters"].get(dim)) or [
                c for c, n in names.items() if not (n.endswith("- DEL") or c.startswith("XXX_"))
            ]  # ILOSTAT keeps deleted placeholder codes in its codelists
            axes.append([(c, names.get(c, c)) for c in want])
        out = []
        for combo in itertools.islice(itertools.product(*axes), MAX_INDICATORS):
            out.append(
                SeriesMeta(
                    ".".join(c.replace(":", "_") for c, _ in combo),
                    f"{title} - {' / '.join(n for _, n in combo)}",
                )
            )
        return tuple(out)

    # ---- fetch -------------------------------------------------------------------------------

    def _src_geo(self, geo: str) -> str:
        if geo in self._rev:
            return self._rev[geo]
        if geo.startswith("region:"):
            return geo[7:]
        scheme = self._cfg()["geo_scheme"]
        c = pycountry.countries.get(alpha_3=geo)
        if c is None or scheme == "iso3":
            return geo
        return {"iso2": c.alpha_2, "m49": c.numeric}.get(scheme, geo)

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        for k, v in req.filters.items():
            if "." in str(v):  # "." separates the dimensions of the SDMX key
                raise ValueError(f"filter {k!r}: '.' is the SDMX key separator, not allowed")
        cfg = self._cfg(req.dataset_id)
        msg = self._structure(req.dataset_id, http)
        dsd = next(iter(msg.structure.values()))
        dims = [d.id for d in dsd.dimensions if d.id != cfg["time_dim"]]
        sel = {d: _list(cfg["filters"].get(d)) for d in dims}
        sel.update({k: _list(v) for k, v in req.filters.items()})
        # ponytail: several indicator_ids become a per-dim union, i.e. a cross product
        for pos, dim in enumerate(cfg["indicator_dims"]):
            if req.indicator_ids:
                sel[dim] = sorted({i.split(".")[pos] for i in req.indicator_ids})
        if req.geos:
            sel[cfg["geo_dim"]] = [self._src_geo(g) for g in req.geos]
        key = ".".join("+".join(quote(x, safe="+") for x in sel.get(d, [])) for d in dims)
        agency = cfg.get("agency")
        url = self._url(
            f"data/{quote(agency, safe='') + ',' if agency else ''}{quote(req.dataset_id, safe='@')}/{key}"
        )
        params: dict[str, str] = {}
        if req.start:
            params["startPeriod"] = req.start.isoformat()[:7]
        if req.end:
            params["endPeriod"] = req.end.isoformat()[:7]
        if req.updated_after and self.manifest.refresh.incremental == "updatedAfter":
            params["updatedAfter"] = req.updated_after.astimezone(UTC).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )
        resp = http.get(url, params=params, headers={"Accept": cfg["accept"]})
        truncated = req.max_rows is not None and resp.content.count(b"\n") - 1 > req.max_rows
        if truncated:
            log.warning(
                "%s/%s: max_rows=%s reached, rows dropped",
                self.manifest.id,
                req.dataset_id,
                req.max_rows,
            )
        yield RawChunk(
            source_id=self.manifest.id,
            dataset_id=req.dataset_id,
            content=resp.content,
            media_type="text/csv",
            url=url,
            params=params,
            retrieved_at=datetime.now(UTC),
            meta={
                "dims": dims,
                "max_rows": req.max_rows,
                "truncated": truncated,
                "unit_labels": self._unit_labels(msg, dsd, cfg),
            },
        )

    def _unit_labels(self, msg: Any, dsd: Any, cfg: dict[str, Any]) -> dict[str, str]:
        col = cfg.get("unit_col")
        try:
            return self._codes(msg, dsd, col, cfg) if col else {}
        except Exception:  # noqa: BLE001 - labels are best effort; raw codes stay as the unit
            return {}

    # ---- normalize ---------------------------------------------------------------------------

    def normalize(self, chunk: RawChunk) -> pa.Table:
        cfg = self._cfg(chunk.dataset_id)
        head = chunk.content.split(b"\n", 1)[0].decode("utf-8-sig")
        names = next(csv.reader([head]))
        t = pacsv.read_csv(
            io.BytesIO(chunk.content),
            convert_options=pacsv.ConvertOptions(
                column_types={n: pa.string() for n in names},
                null_values=[""],
                strings_can_be_null=True,
            ),
        )
        col = {n: t[n].to_pylist() for n in names}
        n_rows = t.num_rows
        none = [None] * n_rows
        geo_dim, time_dim = cfg["geo_dim"], cfg["time_dim"]
        ind_dims = cfg["indicator_dims"]
        other = [
            d
            for d in chunk.meta["dims"]
            if d not in (geo_dim, time_dim, cfg["freq_dim"], *ind_dims) and d in col
        ]
        unit = col.get(cfg.get("unit_col"), none)
        mult = col.get(cfg.get("unit_mult_col"), none)
        status = col.get(cfg["status_col"], none)
        labels = chunk.meta.get("unit_labels") or {}
        out: dict[str, list] = {f.name: [] for f in OBS_SCHEMA}
        cap = chunk.meta.get("max_rows")
        for i in range(n_rows):
            if cap is not None and len(out["series_id"]) >= cap:
                break
            period = col[time_dim][i]
            if period is None:  # e.g. IMF prepends a dataset-metadata row with no observation
                continue
            start, end, freq = parse_period(_period(period), cfg["fiscal_start_month"])
            geo = to_geo(col[geo_dim][i], cfg["geo_scheme"], self.geo_map)
            ind = ".".join(col[d][i] or "" for d in ind_dims).replace(":", "_") or "VALUE"
            v = col[cfg["value_col"]][i]
            try:
                value = float(v) if v is not None else None
            except ValueError:
                value = None
            if value is not None and math.isnan(value):  # BIS writes missing obs as "NaN"
                value = None
            out["series_id"].append(make_series_id(chunk.source_id, chunk.dataset_id, ind, geo))
            out["source_id"].append(chunk.source_id)
            out["dataset_id"].append(chunk.dataset_id)
            out["indicator_id"].append(ind)
            out["geo"].append(geo)
            out["period_start"].append(start)
            out["period_end"].append(end)
            out["freq"].append(freq)
            out["value"].append(value)
            u = cfg["units"].get(ind) or labels.get(unit[i], unit[i]) or cfg.get("unit")
            out["unit"].append(u)
            # the label already names the scale ("Millions of USD"): a multiplier would double it
            out["unit_mult"].append(0 if u and _SCALE.search(u) else _int(mult[i]))
            out["dims"].append({d: col[d][i] or "" for d in sorted(other)})
            out["obs_status"].append(status[i] or ("missing" if value is None else None))
            out["retrieved_at"].append(chunk.retrieved_at)
            out["vintage"].append(None)
        return pa.table(out, schema=OBS_SCHEMA)
