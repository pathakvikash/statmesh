from __future__ import annotations

import copy
import fcntl
import gzip
import json
import os
import time
from collections.abc import Collection, Iterator
from contextlib import contextmanager
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from statmesh.core.models import RawChunk

_EXT = {
    "application/json": "json",
    "text/csv": "csv",
    "application/xml": "xml",
    "text/xml": "xml",
    "application/zip": "zip",
    "text/plain": "txt",
}
GRACE_S = 600.0  # parts younger than this are never deleted
_EMPTY_MANIFEST = {"version": 0, "obs": {}, "vintages": {}, "tables": {}, "cache": {}}


def _check_id(s: str) -> None:
    if not s or "/" in s or "\\" in s or ".." in s:
        raise ValueError(f"unsafe id {s!r}")


def _paths(o: object) -> Iterator[str]:
    """Every string in the manifest; non-paths are harmless extras in the keep set."""
    if isinstance(o, str):
        yield o
    elif isinstance(o, dict):
        for v in o.values():
            yield from _paths(v)
    elif isinstance(o, list | tuple):
        for v in o:
            yield from _paths(v)


def _ext(media_type: str) -> str:
    base = media_type.split(";")[0].strip().lower()
    if base in _EXT:
        return _EXT[base]
    if base.endswith("+json"):
        return "json"
    if base.endswith("+xml"):
        return "xml"
    return "bin"


class Storage:
    def __init__(self, data_dir: Path):
        self.root = Path(data_dir)
        self.root.mkdir(parents=True, exist_ok=True)

    def abs(self, rel_path: str) -> Path:
        """Resolve under data_dir; anything that escapes it (.., absolute, symlink) is refused."""
        p = (self.root / rel_path).resolve()
        if not p.is_relative_to(self.root.resolve()):
            raise ValueError(f"path escapes data_dir: {rel_path!r}")
        return p

    def save_raw(self, chunk: RawChunk) -> Path:
        """Gzip the raw bytes; returns the path relative to data_dir."""
        _check_id(chunk.source_id)
        _check_id(chunk.dataset_id)
        ts = chunk.retrieved_at.strftime("%Y%m%dT%H%M%SZ")
        rel = Path("raw") / chunk.source_id / chunk.dataset_id
        name = f"{ts}-{chunk.sha256[:12]}.{_ext(chunk.media_type)}.gz"
        dest = self.abs(str(rel / name))
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".tmp")
        tmp.write_bytes(gzip.compress(chunk.content))
        os.replace(tmp, dest)
        return rel / name

    def read_raw(self, rel_path: str) -> bytes:
        return gzip.decompress(self.abs(rel_path).read_bytes())

    def write_parts(
        self,
        table: pa.Table,
        rel_dir: str,
        run_id: str,
        *,
        prefix: str = "part",
        max_rows: int = 1_000_000,
    ) -> list[str]:
        """Write zstd parquet parts (tmp + rename); returns paths relative to data_dir."""
        d = self.abs(rel_dir)
        d.mkdir(parents=True, exist_ok=True)
        out = []
        for n, off in enumerate(range(0, table.num_rows, max_rows)):
            rel = f"{rel_dir}/{prefix}-{run_id}-{n}.parquet"
            dest = self.abs(rel)
            tmp = dest.with_name(dest.name + ".tmp")
            pq.write_table(table.slice(off, max_rows), tmp, compression="zstd")
            os.replace(tmp, dest)
            out.append(rel)
        return out

    def read_manifest(self) -> dict:
        p = self.abs("manifest.json")
        data = json.loads(p.read_text()) if p.exists() else {}
        return {**copy.deepcopy(_EMPTY_MANIFEST), **data}

    def manifest_mtime_ns(self) -> int:
        try:
            return self.abs("manifest.json").stat().st_mtime_ns
        except FileNotFoundError:
            return 0

    @contextmanager
    def update_manifest(self) -> Iterator[dict]:
        """Locked read-modify-write. Atomic swap on exit; nothing is written if the body raises."""
        with open(self.abs("manifest.lock"), "a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                m = self.read_manifest()
                yield m
                m["version"] = int(m.get("version", 0)) + 1
                tmp = self.abs("manifest.json.tmp")
                with open(tmp, "w") as f:
                    json.dump(m, f, indent=1, sort_keys=True)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(tmp, self.abs("manifest.json"))
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    def delete_unreferenced(
        self, rel_dir: str, keep: Collection[str], *, grace_s: float | None = None
    ) -> None:
        """Remove *.parquet files directly in rel_dir that are not in `keep` (call after a swap).

        Also keeps every part the current manifest references, and any file younger than
        `grace_s` (default GRACE_S) so a concurrent writer's fresh parts are never removed.
        """
        d = self.abs(rel_dir)
        if not d.is_dir():
            return
        grace = GRACE_S if grace_s is None else grace_s
        with open(self.abs("manifest.lock"), "a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                kept = {str(self.abs(k)) for k in keep}
                kept |= {str(self.abs(p)) for p in _paths(self.read_manifest())}
                now = time.time()
                for f in d.glob("*.parquet"):
                    if str(f.resolve()) in kept or now - f.stat().st_mtime < grace:
                        continue
                    f.unlink(missing_ok=True)
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)
