from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Collection, Iterable, Iterator, Sequence
from contextlib import contextmanager
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from statmesh.core.models import DatasetMeta, Licence, Manifest, RawChunk

SCHEMA = """
CREATE TABLE sources (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, endpoint TEXT,
  auth TEXT NOT NULL, key_env TEXT, key_required INTEGER NOT NULL,
  licence_name TEXT NOT NULL, licence_url TEXT NOT NULL,
  redistribute TEXT NOT NULL CHECK (redistribute IN ('yes','no','review')),
  attribution TEXT NOT NULL, connector_version INTEGER NOT NULL,
  manifest_json TEXT NOT NULL, discovered_at TEXT
);
CREATE TABLE datasets (
  source_id TEXT NOT NULL REFERENCES sources(id), dataset_id TEXT NOT NULL,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', source_url TEXT, freq TEXT,
  licence_name TEXT, licence_url TEXT, redistribute TEXT, attribution TEXT,   -- NULL = inherit from source
  is_core INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'remote' CHECK (status IN ('ingested','remote','stale')),
  source_updated_at TEXT, last_ingested_at TEXT, last_error TEXT,
  PRIMARY KEY (source_id, dataset_id)
);
CREATE TABLE series (
  series_key TEXT PRIMARY KEY,                    -- source:dataset:indicator
  source_id TEXT NOT NULL, dataset_id TEXT NOT NULL, indicator_id TEXT NOT NULL,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', synonyms TEXT NOT NULL DEFAULT '',
  unit TEXT, freq TEXT, geos TEXT NOT NULL DEFAULT '',   -- space separated canonical codes, '' = unknown
  start_date TEXT, end_date TEXT, dims_json TEXT NOT NULL DEFAULT '{}',
  licence_name TEXT, licence_url TEXT, redistribute TEXT, attribution TEXT,   -- NULL = inherit from dataset
  FOREIGN KEY (source_id, dataset_id) REFERENCES datasets(source_id, dataset_id)
);
CREATE INDEX series_dataset ON series(source_id, dataset_id);
CREATE VIRTUAL TABLE series_fts USING fts5(
  series_key UNINDEXED, source_id UNINDEXED, title, description, synonyms,
  tokenize = 'porter unicode61'
);                                               -- standalone; rebuilt per source by upsert_discovery
CREATE TABLE codelists (
  source_id TEXT NOT NULL, codelist_id TEXT NOT NULL, code TEXT NOT NULL, label TEXT,
  mapped_code TEXT, mapped_scheme TEXT,           -- e.g. 'IND','iso3' | '85','hs2' | NULL = unmapped
  PRIMARY KEY (source_id, codelist_id, code)
);
CREATE TABLE lineage (
  id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('ingest','ondemand')),
  source_id TEXT NOT NULL, dataset_id TEXT NOT NULL, url TEXT NOT NULL, params_json TEXT NOT NULL,
  raw_path TEXT NOT NULL, raw_sha256 TEXT NOT NULL, retrieved_at TEXT NOT NULL,
  connector_version INTEGER NOT NULL, parts_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX lineage_dataset ON lineage(source_id, dataset_id, retrieved_at);
CREATE TABLE jobs (
  source_id TEXT NOT NULL, dataset_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'idle' CHECK (state IN ('idle','running','failed','stale')),
  attempts INTEGER NOT NULL DEFAULT 0, next_run_at TEXT, last_run_at TEXT,
  last_success_at TEXT, last_error TEXT,
  PRIMARY KEY (source_id, dataset_id)
);
CREATE TABLE cache_entries (
  key TEXT PRIMARY KEY,                           -- source:dataset:FetchRequest.cache_key()
  source_id TEXT NOT NULL, dataset_id TEXT NOT NULL, request_json TEXT NOT NULL,
  part_path TEXT NOT NULL, rows INTEGER NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE rate_usage (
  source_id TEXT NOT NULL, win TEXT NOT NULL CHECK (win IN ('hour','day')),
  window_start TEXT NOT NULL, count INTEGER NOT NULL,
  PRIMARY KEY (source_id, win, window_start)
);
PRAGMA user_version = 1;
"""

_JOB_FIELDS = {
    "state", "attempts", "next_run_at", "last_run_at", "last_success_at", "last_error",
}  # fmt: skip


def iso(dt: datetime | None) -> str | None:
    """Sortable ISO-8601 UTC string; naive datetimes are taken as UTC."""
    if dt is None:
        return None
    dt = dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _d(x: date | None) -> str | None:
    return x.isoformat() if x else None


def _lic(lic: Licence | None, parent: Licence | None) -> tuple[Any, Any, Any, Any]:
    """Licence columns; all NULL when it equals what would be inherited."""
    if lic is None or lic == parent:
        return (None, None, None, None)
    return (lic.name, lic.url, lic.redistribute, lic.attribution)


TRUNCATED = "truncated: the connector dropped rows at max_rows; results are incomplete"


class Catalog:
    def __init__(self, path: Path, *, readonly: bool = False):
        path = Path(path)
        self.path = path
        self._lock = threading.RLock()
        if readonly:
            self._c = sqlite3.connect(
                f"file:{path}?mode=ro", uri=True, check_same_thread=False, isolation_level=None
            )
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            self._c = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._c.row_factory = sqlite3.Row
        if not readonly:
            self._c.execute("PRAGMA journal_mode=WAL")
        self._c.execute("PRAGMA busy_timeout=5000")
        self._c.execute("PRAGMA foreign_keys=ON")
        if not readonly and self._c.execute("PRAGMA user_version").fetchone()[0] == 0:
            self._c.executescript(SCHEMA)

    def close(self) -> None:
        self._c.close()

    def conn(self) -> sqlite3.Connection:
        return self._c

    @contextmanager
    def _tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._c.execute("BEGIN IMMEDIATE")
            try:
                yield self._c
            except BaseException:
                self._c.execute("ROLLBACK")
                raise
            else:
                self._c.execute("COMMIT")

    def _one(self, sql: str, args: Sequence[Any] = ()) -> dict | None:
        with self._lock:
            r = self._c.execute(sql, args).fetchone()
        return dict(r) if r else None

    def _all(self, sql: str, args: Sequence[Any] = ()) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._c.execute(sql, args).fetchall()]

    # ---- writes ----------------------------------------------------------------------------

    def upsert_source(self, manifest: Manifest) -> None:
        lic = manifest.licence
        with self._tx() as c:
            c.execute(
                """INSERT INTO sources (id, name, kind, endpoint, auth, key_env, key_required,
                     licence_name, licence_url, redistribute, attribution, connector_version,
                     manifest_json)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind,
                     endpoint=excluded.endpoint, auth=excluded.auth, key_env=excluded.key_env,
                     key_required=excluded.key_required, licence_name=excluded.licence_name,
                     licence_url=excluded.licence_url, redistribute=excluded.redistribute,
                     attribution=excluded.attribution,
                     connector_version=excluded.connector_version,
                     manifest_json=excluded.manifest_json""",
                (
                    manifest.id, manifest.name, manifest.kind, manifest.endpoint, manifest.auth,
                    manifest.key_env, int(manifest.key_required), lic.name, lic.url,
                    lic.redistribute, lic.attribution, manifest.version,
                    manifest.model_dump_json(),
                ),
            )  # fmt: skip

    def upsert_discovery(
        self, source_id: str, datasets: Iterable[DatasetMeta], core: Collection[str]
    ) -> int:
        """Upsert datasets + series, rebuild this source's FTS rows, set discovered_at.

        A dataset with no series is indexed itself under the 2-part key 'source:dataset'.
        Returns the series count (series rows of this source after the upsert).
        """
        datasets = list(datasets)  # a lazy iterable must not run (HTTP, ...) inside the write lock
        with self._tx() as c:
            src = c.execute("SELECT * FROM sources WHERE id=?", (source_id,)).fetchone()
            if src is None:
                raise KeyError(f"unknown source {source_id!r}; call upsert_source first")
            src_lic = Licence(
                name=src["licence_name"], url=src["licence_url"],
                redistribute=src["redistribute"], attribution=src["attribution"],
            )  # fmt: skip
            for ds in datasets:
                if ds.source_id != source_id:
                    raise ValueError(f"dataset {ds.dataset_id} belongs to {ds.source_id}")
                ds_cols = _lic(ds.licence, src_lic)
                c.execute(
                    """INSERT INTO datasets (source_id, dataset_id, title, description,
                         source_url, freq, licence_name, licence_url, redistribute, attribution,
                         is_core, source_updated_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                       ON CONFLICT(source_id, dataset_id) DO UPDATE SET title=excluded.title,
                         description=excluded.description, source_url=excluded.source_url,
                         freq=excluded.freq, licence_name=excluded.licence_name,
                         licence_url=excluded.licence_url, redistribute=excluded.redistribute,
                         attribution=excluded.attribution, is_core=excluded.is_core,
                         source_updated_at=excluded.source_updated_at""",
                    (
                        source_id, ds.dataset_id, ds.title, ds.description, ds.source_url,
                        ds.freq, *ds_cols, int(ds.dataset_id in core), iso(ds.last_updated),
                    ),
                )  # fmt: skip
                keys = []
                for s in ds.series:
                    key = f"{source_id}:{ds.dataset_id}:{s.indicator_id}"
                    keys.append(key)
                    c.execute(
                        """INSERT INTO series (series_key, source_id, dataset_id, indicator_id,
                             title, description, synonyms, unit, freq, geos, start_date,
                             end_date, dims_json, licence_name, licence_url, redistribute,
                             attribution)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                           ON CONFLICT(series_key) DO UPDATE SET title=excluded.title,
                             description=excluded.description, synonyms=excluded.synonyms,
                             unit=excluded.unit, freq=excluded.freq, geos=excluded.geos,
                             start_date=excluded.start_date, end_date=excluded.end_date,
                             dims_json=excluded.dims_json, licence_name=excluded.licence_name,
                             licence_url=excluded.licence_url,
                             redistribute=excluded.redistribute,
                             attribution=excluded.attribution""",
                        (
                            key, source_id, ds.dataset_id, s.indicator_id, s.title,
                            s.description, " ".join(s.synonyms), s.unit, s.freq,
                            " ".join(s.geos), _d(s.start), _d(s.end),
                            json.dumps({k: list(v) for k, v in s.dims.items()}),
                            *_lic(s.licence, ds.licence),
                        ),
                    )  # fmt: skip
                if keys:  # a discovery that lists series is authoritative for the dataset
                    marks = ",".join("?" * len(keys))
                    c.execute(
                        f"DELETE FROM series WHERE source_id=? AND dataset_id=? "
                        f"AND series_key NOT IN ({marks})",
                        (source_id, ds.dataset_id, *keys),
                    )
            c.execute("DELETE FROM series_fts WHERE source_id=?", (source_id,))
            c.execute(
                """INSERT INTO series_fts (series_key, source_id, title, description, synonyms)
                   SELECT series_key, source_id, title, description, synonyms
                   FROM series WHERE source_id=?""",
                (source_id,),
            )
            c.execute(
                """INSERT INTO series_fts (series_key, source_id, title, description, synonyms)
                   SELECT d.source_id || ':' || d.dataset_id, d.source_id, d.title,
                          d.description, ''
                   FROM datasets d WHERE d.source_id=? AND NOT EXISTS
                     (SELECT 1 FROM series s
                      WHERE s.source_id=d.source_id AND s.dataset_id=d.dataset_id)""",
                (source_id,),
            )
            c.execute(
                "UPDATE sources SET discovered_at=? WHERE id=?",
                (iso(datetime.now(UTC)), source_id),
            )
            return c.execute(
                "SELECT COUNT(*) FROM series WHERE source_id=?", (source_id,)
            ).fetchone()[0]

    def upsert_codelist(
        self,
        source_id: str,
        codelist_id: str,
        rows: Iterable[tuple[str, str | None, str | None, str | None]],
    ) -> None:
        """rows: (code, label, mapped_code, mapped_scheme)."""
        with self._tx() as c:
            c.executemany(
                """INSERT INTO codelists (source_id, codelist_id, code, label, mapped_code,
                     mapped_scheme) VALUES (?,?,?,?,?,?)
                   ON CONFLICT(source_id, codelist_id, code) DO UPDATE SET label=excluded.label,
                     mapped_code=excluded.mapped_code, mapped_scheme=excluded.mapped_scheme""",
                [(source_id, codelist_id, *r) for r in rows],
            )

    def set_dataset_status(
        self,
        source_id: str,
        dataset_id: str,
        status: str,
        *,
        error: str | None = None,
        ingested_at: datetime | None = None,
    ) -> None:
        with self._tx() as c:
            c.execute(
                """UPDATE datasets SET status=?, last_error=?,
                     last_ingested_at=COALESCE(?, last_ingested_at)
                   WHERE source_id=? AND dataset_id=?""",
                (status, error, iso(ingested_at), source_id, dataset_id),
            )

    def set_truncated(self, source_id: str, dataset_id: str, truncated: bool) -> None:
        """Record (or clear) "the connector dropped rows at max_rows" in datasets.last_error."""
        with self._tx() as c:
            c.execute(
                "UPDATE datasets SET last_error=? WHERE source_id=? AND dataset_id=? AND "
                + ("1" if truncated else "last_error LIKE 'truncated:%'"),
                (TRUNCATED if truncated else None, source_id, dataset_id),
            )

    def add_lineage(
        self,
        *,
        run_id: str,
        kind: str,
        chunk: RawChunk,
        raw_path: str,
        connector_version: int,
        parts: Sequence[str],
    ) -> int:
        with self._tx() as c:
            cur = c.execute(
                """INSERT INTO lineage (run_id, kind, source_id, dataset_id, url, params_json,
                     raw_path, raw_sha256, retrieved_at, connector_version, parts_json)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    run_id, kind, chunk.source_id, chunk.dataset_id, chunk.url,
                    json.dumps(dict(chunk.params), sort_keys=True), raw_path, chunk.sha256,
                    iso(chunk.retrieved_at), connector_version, json.dumps(list(parts)),
                ),
            )  # fmt: skip
            return int(cur.lastrowid)

    def get_job(self, source_id: str, dataset_id: str) -> dict | None:
        return self._one(
            "SELECT * FROM jobs WHERE source_id=? AND dataset_id=?", (source_id, dataset_id)
        )

    def set_job(self, source_id: str, dataset_id: str, **fields: Any) -> None:
        bad = set(fields) - _JOB_FIELDS
        if bad:
            raise ValueError(f"unknown job fields {sorted(bad)}")
        with self._tx() as c:
            c.execute(
                "INSERT OR IGNORE INTO jobs (source_id, dataset_id) VALUES (?,?)",
                (source_id, dataset_id),
            )
            if fields:
                sets = ", ".join(f"{k}=?" for k in fields)
                c.execute(
                    f"UPDATE jobs SET {sets} WHERE source_id=? AND dataset_id=?",
                    (*fields.values(), source_id, dataset_id),
                )

    def due_jobs(self, now: datetime) -> list[dict]:
        return self._all(
            """SELECT * FROM jobs WHERE state != 'running' AND next_run_at IS NOT NULL
               AND next_run_at <= ? ORDER BY next_run_at""",
            (iso(now),),
        )

    def put_cache(
        self,
        key: str,
        source_id: str,
        dataset_id: str,
        request_json: str,
        part_path: str,
        rows: int,
        expires_at: datetime,
    ) -> None:
        with self._tx() as c:
            c.execute(
                """INSERT OR REPLACE INTO cache_entries (key, source_id, dataset_id,
                     request_json, part_path, rows, created_at, expires_at)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (key, source_id, dataset_id, request_json, part_path, rows,
                 iso(datetime.now(UTC)), iso(expires_at)),
            )  # fmt: skip

    def get_cache(self, key: str, now: datetime) -> dict | None:
        return self._one(
            "SELECT * FROM cache_entries WHERE key=? AND expires_at > ?", (key, iso(now))
        )

    def expired_cache(self, now: datetime) -> list[dict]:
        return self._all("SELECT * FROM cache_entries WHERE expires_at <= ?", (iso(now),))

    def delete_dataset(self, source_id: str, dataset_id: str) -> None:
        """Remove every catalog row of one dataset (series, FTS, lineage, jobs, cache, dataset)."""
        a = (source_id, dataset_id)
        with self._tx() as c:
            c.execute(
                "DELETE FROM series_fts WHERE series_key IN "
                "(SELECT series_key FROM series WHERE source_id=? AND dataset_id=?) OR series_key=?",
                (*a, f"{source_id}:{dataset_id}"),
            )
            for t in ("series", "lineage", "jobs", "cache_entries", "datasets"):
                c.execute(f"DELETE FROM {t} WHERE source_id=? AND dataset_id=?", a)

    def delete_cache(self, key: str) -> None:
        with self._tx() as c:
            c.execute("DELETE FROM cache_entries WHERE key=?", (key,))

    def rate_incr(self, source_id: str, win: str, window_start: str) -> int:
        with self._tx() as c:
            return c.execute(
                """INSERT INTO rate_usage (source_id, win, window_start, count) VALUES (?,?,?,1)
                   ON CONFLICT(source_id, win, window_start) DO UPDATE SET count=count+1
                   RETURNING count""",
                (source_id, win, window_start),
            ).fetchone()[0]

    def rate_count(self, source_id: str, win: str, window_start: str) -> int:
        with self._lock:
            r = self._c.execute(
                "SELECT count FROM rate_usage WHERE source_id=? AND win=? AND window_start=?",
                (source_id, win, window_start),
            ).fetchone()
        return r[0] if r else 0

    # ---- reads -----------------------------------------------------------------------------

    def get_source(self, source_id: str) -> dict | None:
        return self._one("SELECT * FROM sources WHERE id=?", (source_id,))

    def list_sources(self) -> list[dict]:
        return self._all("SELECT * FROM sources ORDER BY id")

    def get_dataset(self, source_id: str, dataset_id: str) -> dict | None:
        return self._one(
            "SELECT * FROM datasets WHERE source_id=? AND dataset_id=?", (source_id, dataset_id)
        )

    def get_series(self, series_key: str) -> dict | None:
        return self._one("SELECT * FROM series WHERE series_key=?", (series_key,))

    def licence_for(self, series_key: str) -> Licence:
        """series -> dataset -> source fallback. Accepts 'src:ds:ind' or 'src:ds'."""
        parts = series_key.split(":")
        if len(parts) < 2:
            raise KeyError(series_key)
        rows = []
        if len(parts) >= 3:
            rows.append(self.get_series(":".join(parts[:3])))
        rows.append(self.get_dataset(parts[0], parts[1]))
        rows.append(self.get_source(parts[0]))
        if rows[-1] is None:
            raise KeyError(series_key)
        for r in rows:
            if r and r.get("licence_name") is not None:
                return Licence(
                    name=r["licence_name"], url=r["licence_url"],
                    redistribute=r["redistribute"], attribution=r["attribution"],
                )  # fmt: skip
        raise KeyError(series_key)  # unreachable: sources.licence_* are NOT NULL

    def latest_lineage(self, source_id: str, dataset_id: str) -> dict | None:
        return self._one(
            """SELECT * FROM lineage WHERE source_id=? AND dataset_id=?
               ORDER BY retrieved_at DESC, id DESC LIMIT 1""",
            (source_id, dataset_id),
        )

    def fts(
        self,
        match: str,
        *,
        source: str | None = None,
        sources: list[str] | None = None,
        freq: str | None = None,
        geo: str | None = None,
        limit: int = 10,
    ) -> list[dict]:
        """Raw FTS5 MATCH ordered by bm25 (weights title 10, description 2, synonyms 5).

        Rows: series_key, source_id, title, score (higher is better), plus series columns
        (dataset_id, indicator_id, unit, freq, geos, start_date, end_date) which are NULL for
        dataset-level rows. A series with unknown geos ('') or freq (NULL) is not excluded.
        """
        sql = """SELECT series_fts.series_key, series_fts.source_id, series_fts.title,
                   -bm25(series_fts, 0, 0, 10, 2, 5) AS score,
                   s.dataset_id, s.indicator_id, s.unit, s.freq, s.geos, s.start_date, s.end_date
                 FROM series_fts LEFT JOIN series s ON s.series_key = series_fts.series_key
                 WHERE series_fts MATCH ?"""
        args: list[Any] = [match]
        if source:
            sql += " AND series_fts.source_id = ?"
            args.append(source)
        if sources:
            sql += f" AND series_fts.source_id IN ({','.join('?' * len(sources))})"
            args += sources
        if freq:
            sql += " AND (s.freq IS NULL OR s.freq = ?)"
            args.append(freq)
        if geo:
            sql += " AND (s.geos IS NULL OR s.geos = '' OR (' ' || s.geos || ' ') LIKE ?)"
            args.append(f"% {geo} %")
        sql += " ORDER BY bm25(series_fts, 0, 0, 10, 2, 5) LIMIT ?"
        args.append(limit)
        return self._all(sql, args)
