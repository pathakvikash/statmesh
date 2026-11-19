"""DBnomics API v22 (keyless). dataset_id = <provider>_<dataset>.

Per-dataset options (manifest `datasets.<id>`): geo_dim (dimension holding the country),
geo_scheme (iso2|iso3), indicator_dims (ordered non-geo dimensions; indicator_id is their values
joined with "."), unit. A dataset without geo_dim is catalogued but cannot be fetched.
Per-provider licence: manifest `options.providers.<CODE>.licence`.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path

import pyarrow as pa
import pycountry

from statmesh.core.geo import to_geo
from statmesh.core.http import HttpClient
from statmesh.core.models import (
    DatasetMeta,
    FetchRequest,
    Licence,
    Manifest,
    RawChunk,
    SeriesMeta,
    make_series_id,
)
from statmesh.core.periods import parse_period
from statmesh.core.schema import OBS_SCHEMA

PAGE = 50


def _leaves(nodes: list[dict]) -> Iterable[dict]:
    for n in nodes:
        if "children" in n:
            yield from _leaves(n["children"])
        else:
            yield n


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory
        self.providers = manifest.options.get("providers", {})

    def _split(self, dataset_id: str) -> tuple[str, str]:
        provider, _, code = dataset_id.partition("_")
        return provider, code

    def _licence(self, provider: str) -> Licence:
        lic = self.providers.get(provider, {}).get("licence")
        return Licence(**lic) if lic else self.manifest.licence

    def _cfg(self, dataset_id: str) -> dict:
        return self.manifest.datasets.get(dataset_id, {})

    def _indicator(self, cfg: dict, dims: dict[str, str]) -> str:
        parts = [dims[d] for d in cfg.get("indicator_dims", [])]
        return ".".join(parts).replace(":", "_") or "all"

    def _geo(self, cfg: dict, code: str) -> str:
        return to_geo(code, cfg.get("geo_scheme", "iso2"))

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        n = 0
        for provider in self.providers:
            resp = http.get(f"{self.manifest.endpoint}/providers/{provider}").json()
            leaves = {
                f"{provider}_{x['code']}".replace(":", "_"): x
                for x in _leaves(resp["category_tree"])
            }.items()  # a dataset can sit in several categories
            leaves = sorted(
                leaves, key=lambda t: t[0] not in self.manifest.core_datasets
            )  # core first
            for did, leaf in leaves:
                if limit is not None and n >= limit:
                    return
                n += 1
                yield DatasetMeta(
                    source_id=self.manifest.id,
                    dataset_id=did,
                    title=leaf["name"].strip(),
                    licence=self._licence(provider),
                    source_url=f"https://db.nomics.world/{provider}/{leaf['code']}",
                    series=self._series(http, did) if did in self.manifest.core_datasets else (),
                )

    def _series(self, http: HttpClient, dataset_id: str) -> tuple[SeriesMeta, ...]:
        provider, code = self._split(dataset_id)
        cfg = self._cfg(dataset_id)
        docs = http.get(
            f"{self.manifest.endpoint}/series/{provider}/{code}",
            params={"metadata": "0", "observations": "0", "limit": "1000"},
        ).json()["series"]["docs"]
        out: dict[str, SeriesMeta] = {}
        for d in docs:
            ind = self._indicator(cfg, d["dimensions"])
            geo = self._geo(cfg, d["dimensions"][cfg["geo_dim"]])
            old = out.get(ind)
            title = f"{d['dataset_name']} ({ind})"
            out[ind] = SeriesMeta(
                ind, title, unit=cfg.get("unit"), geos=(*(old.geos if old else ()), geo)
            )
        return tuple(out.values())

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        provider, code = self._split(req.dataset_id)
        cfg = self._cfg(req.dataset_id)
        if "geo_dim" not in cfg:
            raise ValueError(f"datasets.{req.dataset_id}.geo_dim is not configured")
        dims: dict[str, list[str]] = {}
        if req.geos:
            to_code = (
                (lambda g: pycountry.countries.get(alpha_3=g).alpha_2)
                if (cfg.get("geo_scheme", "iso2") == "iso2")
                else (lambda g: g)
            )
            dims[cfg["geo_dim"]] = [to_code(g) for g in req.geos]
        for i, d in enumerate(cfg.get("indicator_dims", [])):
            vals = {x.split(".")[i] for x in req.indicator_ids}
            if vals:
                dims[d] = sorted(vals)
        url = f"{self.manifest.endpoint}/series/{provider}/{code}"
        offset = 0
        while True:
            params = {
                "metadata": "0",
                "observations": "1",
                "limit": str(PAGE),
                "offset": str(offset),
            }
            if dims:
                params["dimensions"] = json.dumps(dims, sort_keys=True, separators=(",", ":"))
            resp = http.get(url, params=params)
            found = resp.json()["series"]["num_found"]
            yield RawChunk(
                source_id=self.manifest.id,
                dataset_id=req.dataset_id,
                content=resp.content,
                media_type="application/json",
                url=url,
                params=params,
                retrieved_at=datetime.now(UTC),
            )
            offset += PAGE
            if offset >= found:
                return

    def normalize(self, chunk: RawChunk) -> pa.Table:
        cfg = self._cfg(chunk.dataset_id)
        cols: dict[str, list] = {f.name: [] for f in OBS_SCHEMA}
        for s in json.loads(chunk.content)["series"]["docs"]:
            ind = self._indicator(cfg, s["dimensions"])
            geo = self._geo(cfg, s["dimensions"][cfg["geo_dim"]])
            for per, val in zip(s["period"], s["value"], strict=True):
                start, end, freq = parse_period(per)
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
                cols["value"].append(None if val in ("NA", None) else float(val))
                cols["unit"].append(cfg.get("unit"))
                cols["unit_mult"].append(0)
                cols["dims"].append(
                    {k: v for k, v in sorted(s["dimensions"].items()) if k != cfg["geo_dim"]}
                )
                cols["obs_status"].append(
                    "NA" if val == "NA" else "missing" if val is None else None
                )
                cols["retrieved_at"].append(chunk.retrieved_at)
                cols["vintage"].append(None)
        return pa.table(cols, schema=OBS_SCHEMA)
