"""Generic file connector: CSV / XLSX / ZIP (containing either) / gzip CSV at
`manifest.datasets.<id>.url`, turned into observations by `mapping.yaml` in the connector folder.
URLs may be `file://` paths (self-hosted only; refused when STATMESH_MODE=hosted).

manifest.yaml (kind: file)::

    datasets:
      pop: {url: https://example.org/pop.zip}

mapping.yaml, one entry per dataset id (all keys optional unless marked)::

    datasets:
      pop:
        title: Population            # catalog title (default: id)
        format: csv | xlsx | zip | gz  # default: from the url suffix (gz = gzip-compressed CSV)
        member: data.csv             # zip: file inside (default: first .csv/.xlsx)
        sheet: Sheet1                # xlsx (default: first sheet)
        skip_rows: 0                 # rows above the header row
        encoding: utf-8-sig          # csv
        geo: Country                 # column, or geo_const: IND for a constant
        geo_scheme: iso3             # iso2 | iso3 | m49 | name (default iso3); geo_map.csv wins
        period: Year                 # column (required); parse_period forms, or:
        period_format: "%d/%m/%Y"    #   strptime format; then `freq` (A, M or D) is required
        fiscal_start_month: 1
        freq: A                      # constant; overrides the one parse_period infers
        value: Value                 # long layout: value column
        indicator: Series            # long layout: column holding the indicator, or a LIST of
                                     #   columns joined with "." (composite: [Item Code, Element Code])
        indicator_title: [Item, Element]  # with a composite/long indicator: name column(s) joined
                                     #   with " - " into dims["indicator_title"] (observations have no
                                     #   title column, and discover cannot list data-driven series)
        indicator_id: pop            #   a constant (default: dataset id)
        where: {Element Code: [5510, 5312], Flag: A}  # keep only rows whose column equals one of
                                     #   the values (compared as stripped text), applied while reading
        melt: [Male, Female]         # wide layout: these columns become indicators
                                     #   (a list, or {column: indicator_id})
        unit: persons                # constant, or unit_col: Unit
        units: {m: persons, f: persons}  # per-indicator unit (by indicator id), beats unit/unit_col
        unit_mult: 0                 # power of ten
        dims: [Sex, Age]             # columns copied into `dims`
        status: Flag                 # column copied into obs_status

A row too short to hold the geo/period/value columns (e.g. a "Source: ..." footer) or with an
unparseable period is skipped; if every row is skipped that is an error. Rows excluded by `where`
are not "malformed". The download is streamed to disk under a byte cap, then CSV (plain or inside a
ZIP) is parsed row by row (only the kept observations are held); the raw chunk is the downloaded
file (the zip itself for zips) held as bytes, so peak memory is about one copy of the download. XLSX is read in memory. Size caps (`max_uncompressed_mb`): CSV streams stop with an
error once more than that many bytes have been read (default 4096 MB; the declared sizes in the zip
header are also checked); XLSX and zip-wrapped XLSX use the default 500 MB.

Not done: request filters (geos/start/end/indicators are not applied), robots.txt is read once
per fetch, no multi-sheet files. Unparseable values become null with obs_status "missing".
"""

from __future__ import annotations

import contextlib
import csv
import gzip
import io
import itertools
import os
import tempfile
import zipfile
from collections.abc import Iterable
from datetime import UTC, date, datetime
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import url2pathname
from urllib.robotparser import RobotFileParser

import httpx
import pyarrow as pa
import yaml

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

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_MEDIA = {"csv": "text/csv", "xlsx": XLSX}
ZIP = "application/zip"
GZ = "application/gzip"  # gzip-compressed CSV; only ever a chunk's media type, never a zip member
_PERIOD_FMT = {"A": "%Y", "M": "%Y-%m", "D": "%Y-%m-%d"}
_NA = {"", "na", "n/a", "nan", "..", "-", "null"}
MAX_UNCOMPRESSED_MB = 500  # in-memory (xlsx) cap; override per dataset with `max_uncompressed_mb`
MAX_STREAM_MB = 4096  # streamed CSV cap, counted on bytes actually read


def _cap(m: dict, default: int = MAX_UNCOMPRESSED_MB) -> int:
    return int(m.get("max_uncompressed_mb", default)) * 1024 * 1024


class _Capped(io.RawIOBase):
    """Binary reader that raises once more than `cap` bytes have been read (zip-bomb guard)."""

    def __init__(self, f, cap: int):
        self.f, self.cap, self.n = f, cap, 0

    def readable(self) -> bool:
        return True

    def readinto(self, b) -> int:
        data = self.f.read(len(b))
        self.n += len(data)
        if self.n > self.cap:
            raise ValueError(f"file unpacks to more than {self.cap >> 20} MB; refusing")
        b[: len(data)] = data
        return len(data)


def _check_zip(z: zipfile.ZipFile, cap: int) -> None:
    if sum(i.file_size for i in z.infolist()) > cap:
        raise ValueError(f"archive unpacks to more than {cap >> 20} MB; refusing (zip bomb?)")


def _suffix(name: str) -> str:
    return Path(urlsplit(name).path).suffix.lower().lstrip(".")


def _cell(v) -> str:
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def _member(z: zipfile.ZipFile, m: dict, url: str = "") -> str:
    name = m.get("member") or next(
        (n for n in z.namelist() if _suffix(n) in _MEDIA and not n.endswith("/")), ""
    )
    if not name:
        raise ValueError(f"{url}: no .csv or .xlsx inside the zip; set `member`")
    return name


def _grid(chunk: RawChunk, m: dict) -> Iterable[list[str]]:
    """Rows (stripped cells) after `skip_rows`; CSV is a generator over the stream."""
    skip, data, media = int(m.get("skip_rows", 0)), chunk.content, chunk.media_type
    with contextlib.ExitStack() as stack:
        if media == ZIP:
            z = stack.enter_context(zipfile.ZipFile(io.BytesIO(data)))
            name = _member(z, m, chunk.url)
            media = XLSX if _suffix(name) == "xlsx" else "text/csv"
            if media == XLSX:
                _check_zip(z, _cap(m))
                data = z.read(name)
            else:
                _check_zip(z, _cap(m, MAX_STREAM_MB))
                src = stack.enter_context(z.open(name))
        if media == XLSX:
            import openpyxl

            with zipfile.ZipFile(io.BytesIO(data)) as xz:
                _check_zip(xz, _cap(m))
            wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
            ws = wb[m["sheet"]] if m.get("sheet") else wb.worksheets[0]
            rows = ([_cell(c) for c in r] for r in ws.iter_rows(values_only=True))
        else:
            if media == GZ:  # decompressed bytes count toward the stream cap (gzip-bomb guard)
                src = stack.enter_context(gzip.open(io.BytesIO(data)))
            elif chunk.media_type != ZIP:
                src = io.BytesIO(data)
            capped = io.BufferedReader(_Capped(src, _cap(m, MAX_STREAM_MB)))
            text = io.TextIOWrapper(capped, encoding=m.get("encoding", "utf-8-sig"), newline="")
            rows = ([c.strip() for c in r] for r in csv.reader(text))
        yield from itertools.islice(rows, skip, None)


def _allowed(m: dict) -> dict[str, set[str]]:
    w = m.get("where") or {}
    return {c: {str(x).strip() for x in (v if isinstance(v, list) else [v])} for c, v in w.items()}


def _as_list(v) -> list[str]:
    return [] if v is None else [v] if isinstance(v, str) else list(v)


def _number(s: str) -> float | None:
    s = s.strip().replace(",", "")
    if s.lower() in _NA:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _local_file(url: str, cap: int) -> Path:
    """A `file://` URL as a local path. Refused in hosted mode: the server must not read its own disk.

    Reads os.environ directly: Settings.from_env() validates unrelated settings (contact email).
    """
    if os.environ.get("STATMESH_MODE", "self_host") == "hosted":
        raise PermissionError(f"{url}: file:// URLs are refused when STATMESH_MODE=hosted")
    p = urlsplit(url)
    if p.netloc not in ("", "localhost"):
        raise ValueError(f"{url}: file:// URLs must be local paths, e.g. file:///data/x.csv")
    path = Path(url2pathname(p.path))
    if not path.is_file():
        raise FileNotFoundError(f"{url}: no such file")
    if path.stat().st_size > cap:
        raise ValueError(f"{url}: file is larger than {cap >> 20} MB; refusing")
    return path


def robots_ok(url: str, http: HttpClient) -> bool:
    p = urlsplit(url)
    try:
        body = http.get(f"{p.scheme}://{p.netloc}/robots.txt").text
    except httpx.HTTPError:
        return True  # no robots.txt: allowed
    rp = RobotFileParser()
    rp.parse(body.splitlines())
    return rp.can_fetch("statmesh", url)


class FileConnector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = Path(directory)
        raw = yaml.safe_load((self.dir / "mapping.yaml").read_text()) or {}
        self.mapping: dict[str, dict] = raw.get("datasets", {})
        self.geo_map = load_geo_map(self.dir)

    def _map(self, dataset_id: str) -> dict:
        try:
            return self.mapping[dataset_id]
        except KeyError:
            raise KeyError(f"{self.manifest.id}: no mapping for dataset {dataset_id!r}") from None

    @staticmethod
    def _indicators(m: dict) -> dict[str, str]:
        melt = m.get("melt")
        if isinstance(melt, dict):
            return {k: str(v) for k, v in melt.items()}
        if melt:
            return {k: k for k in melt}
        return {}

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        for ds, opts in list(self.manifest.datasets.items())[:limit]:
            m = self._map(ds)
            ids = list(self._indicators(m).values()) or (
                [m["indicator_id"]] if "indicator_id" in m else []
            )
            yield DatasetMeta(
                source_id=self.manifest.id,
                dataset_id=ds,
                title=m.get("title", ds),
                licence=self.manifest.licence,
                source_url=opts.get("url"),
                freq=m.get("freq"),
                series=tuple(
                    SeriesMeta(
                        i.replace(":", "_"),
                        i,
                        freq=m.get("freq"),
                        unit=(m.get("units") or {}).get(i.replace(":", "_"), m.get("unit")),
                    )
                    for i in ids
                ),
            )

    def _robots_ok(self, url: str, http: HttpClient) -> bool:
        return robots_ok(url, http)

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        m = self._map(req.dataset_id)
        url = self.manifest.datasets[req.dataset_id]["url"]
        local = urlsplit(url).scheme == "file"
        if not local and not self._robots_ok(url, http):
            raise PermissionError(f"robots.txt disallows {url}")
        name, fmt = m.get("member") or url, m.get("format", _suffix(url))
        cap = _cap(m) if fmt == "xlsx" else _cap(m, MAX_STREAM_MB)
        with tempfile.TemporaryDirectory() as tmp:  # streamed to disk with a byte cap
            path = (
                _local_file(url, cap)
                if local
                else http.download(url, Path(tmp) / "f", max_bytes=cap)
            )
            if fmt == "zip":
                with zipfile.ZipFile(path) as z:
                    name = _member(z, m, url)
                    _check_zip(z, _cap(m) if _suffix(name) == "xlsx" else _cap(m, MAX_STREAM_MB))
            content = path.read_bytes()  # the raw chunk is bytes
        if fmt == "zip":
            media = ZIP  # normalize streams the member out of the zip
        else:
            fmt = m.get("format") if m.get("format") in (*_MEDIA, "gz") else _suffix(name)
            if fmt == "gz":
                media = GZ  # normalize gunzips it while streaming
            elif fmt in _MEDIA:
                media = _MEDIA[fmt]
            else:
                raise ValueError(
                    f"{url}: cannot tell the file format (no .csv/.xlsx/.zip/.gz suffix); "
                    "set `format: csv | xlsx | zip | gz` in mapping.yaml"
                )
        yield RawChunk(
            source_id=self.manifest.id,
            dataset_id=req.dataset_id,
            content=content,
            media_type=media,
            url=url,
            params={},
            retrieved_at=datetime.now(UTC),
        )

    def _period(self, raw: str, m: dict):
        fm = int(m.get("fiscal_start_month", 1))
        if f := m.get("period_format"):
            raw = datetime.strptime(raw, f).strftime(_PERIOD_FMT[m["freq"]])
        start, end, freq = parse_period(raw, fm)
        return start, end, m.get("freq", freq)

    def normalize(self, chunk: RawChunk) -> pa.Table:
        m = self._map(chunk.dataset_id)
        melt = self._indicators(m)
        scheme = m.get("geo_scheme", "iso3")
        cols: dict[str, list] = {f.name: [] for f in OBS_SCHEMA}
        ind_cols, titles, keep = (
            _as_list(m.get("indicator")),
            _as_list(m.get("indicator_title")),
            _allowed(m),
        )
        need = [m["period"], *([] if "geo_const" in m else [m["geo"]]),
                *(melt or [m["value"], *ind_cols])]  # fmt: skip
        head: list[str] | None = None
        checked, skipped = False, 0
        for cells in _grid(chunk, m):
            if head is None:
                head = cells
                continue
            if not any(cells):
                continue
            if not checked:  # header check happens at the first data row (header-only = 0 rows)
                checked = True
                if gone := [c for c in [*need, *titles, *keep] if c not in head]:
                    raise ValueError(f"{chunk.dataset_id}: columns {gone} not in header {head}")
            row = dict(zip(head, cells, strict=False))
            if any(row.get(c) not in ok for c, ok in keep.items()):
                continue
            if any(c not in row for c in need):  # footer / notes row
                skipped += 1
                continue
            try:
                geo = to_geo(
                    m["geo_const"] if "geo_const" in m else row[m["geo"]], scheme, self.geo_map
                )
                start, end, freq = self._period(row[m["period"]], m)
            except ValueError:  # unparseable period: not a data row
                skipped += 1
                continue
            dims = {c: row[c] for c in m.get("dims", [])}
            if melt:
                points = [(i, row[c]) for c, i in melt.items()]
            else:
                if ind_cols:
                    ind = ".".join(row[c] for c in ind_cols)
                    if titles:
                        dims["indicator_title"] = " - ".join(row.get(c, "") for c in titles)
                else:
                    ind = m.get("indicator_id")
                points = [(ind or chunk.dataset_id, row[m["value"]])]
            dims = dict(sorted(dims.items()))
            for ind, raw in points:
                ind = ind.replace(":", "_")
                v = _number(raw)
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
                cols["value"].append(v)
                unit = row.get(m["unit_col"]) if "unit_col" in m else m.get("unit")
                cols["unit"].append((m.get("units") or {}).get(ind, unit))
                cols["unit_mult"].append(int(m.get("unit_mult", 0)))
                cols["dims"].append(dims)
                status = row.get(m["status"]) if "status" in m else None
                cols["obs_status"].append(status or (None if v is not None else "missing"))
                cols["retrieved_at"].append(chunk.retrieved_at)
                cols["vintage"].append(None)
        if skipped and not cols["series_id"]:
            raise ValueError(f"{chunk.dataset_id}: all {skipped} rows were malformed")
        return pa.table(cols, schema=OBS_SCHEMA)
