from __future__ import annotations

import importlib
import importlib.util
import sys
from collections.abc import Iterable
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

import pyarrow as pa

from statmesh.core.models import _ID_RE, DatasetMeta, FetchRequest, Manifest, RawChunk
from statmesh.settings import Settings

if TYPE_CHECKING:
    from statmesh.core.http import HttpClient

BUNDLED_DIR = Path(__file__).resolve().parent.parent / "connectors"

_GENERIC = {
    "sdmx": ("statmesh.core.generic.sdmx", "SdmxConnector"),
    "file": ("statmesh.core.generic.file", "FileConnector"),
    "ckan": ("statmesh.core.generic.ckan", "CkanConnector"),
    "socrata": ("statmesh.core.generic.socrata", "SocrataConnector"),
}


class Connector(Protocol):
    manifest: Manifest

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        """List datasets and series. Feeds the catalog. No observations."""

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        """Raw data for one dataset + filter. All HTTP through `http`."""

    def normalize(self, chunk: RawChunk) -> pa.Table:
        """Pure, no I/O. Returns a table matching TABLE_SCHEMAS[chunk.table]."""


def _roots(settings: Settings) -> list[Path]:
    roots = [BUNDLED_DIR]
    if settings.connectors_dir:  # the operator's folder wins over a bundled connector
        roots.insert(0, Path(settings.connectors_dir))
    return roots


def connector_dir(source_id: str, settings: Settings) -> Path:
    if not _ID_RE.fullmatch(source_id):
        raise KeyError(f"invalid connector id {source_id!r}")
    for root in _roots(settings):
        if (root / source_id / "manifest.yaml").is_file():
            return root / source_id
    raise KeyError(f"unknown connector {source_id!r}")


def list_connectors(settings: Settings) -> list[str]:
    ids: set[str] = set()
    for root in _roots(settings):
        if root.is_dir():
            ids.update(p.parent.name for p in root.glob("*/manifest.yaml"))
    return sorted(ids - settings.disabled)


def load_connector(source_id: str, settings: Settings) -> Connector:
    if source_id in settings.disabled:
        raise KeyError(f"connector {source_id!r} is disabled")
    d = connector_dir(source_id, settings)
    manifest = Manifest.load(d / "manifest.yaml")
    if manifest.id != d.name:
        raise ValueError(f"manifest id {manifest.id!r} does not match folder {d.name!r}")
    code = d / "connector.py"
    if code.is_file():
        modname = f"statmesh_connector_{source_id}"
        spec = importlib.util.spec_from_file_location(modname, code)
        assert spec and spec.loader
        mod = importlib.util.module_from_spec(spec)
        sys.modules[modname] = mod
        spec.loader.exec_module(mod)
        return mod.Connector(manifest, d)
    if manifest.kind in ("rest", "custom"):
        raise ValueError(f"{source_id}: kind {manifest.kind!r} requires a connector.py")
    modpath, cls = _GENERIC[manifest.kind]
    try:
        mod = importlib.import_module(modpath)
    except ModuleNotFoundError as e:
        if e.name != modpath:
            raise
        raise NotImplementedError(f"generic connector kind {manifest.kind!r} is not built yet")
    return getattr(mod, cls)(manifest, d)
