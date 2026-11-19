"""DuckDB query engine: views over Parquet + a catalog copy, locked down, with timeout + row cap.

Layer 1 of SQL safety is here: the connection is built by trusted code, then
`allowed_directories` is narrowed to obs/, tables/, cache/obs/, `enable_external_access=false`
(no ATTACH/COPY/INSTALL/LOAD/file or URL reads, no extension autoload) and
`lock_configuration=true` (SET cannot undo any of it). Layer 2 is sqlsafe.check.
"""

from __future__ import annotations

import threading
from typing import Any

import duckdb
import pyarrow as pa
import pycountry

from statmesh.core import geo as geo_mod
from statmesh.core.api_models import Citation
from statmesh.core.catalog import Catalog
from statmesh.core.licence import can_serve
from statmesh.core.models import Licence
from statmesh.core.schema import empty_table, obs_row_key_sql
from statmesh.core.storage import Storage
from statmesh.query import citations as cit
from statmesh.query.sqlsafe import SqlRejected, check
from statmesh.settings import Settings

S, N = pa.string(), pa.int64()
_EFF = """COALESCE({a}.licence_name, {b}.licence_name) AS licence_name,
 COALESCE({a}.licence_url, {b}.licence_url) AS licence_url,
 COALESCE({a}.redistribute, {b}.redistribute) AS redistribute,
 COALESCE({a}.attribution, {b}.attribution) AS attribution"""
_SQLITE = {
    "sources": (
        {"id": S, "name": S, "kind": S, "endpoint": S, "auth": S, "key_required": N,
         "licence_name": S, "licence_url": S, "redistribute": S, "attribution": S,
         "discovered_at": S},
        ("SELECT id,name,kind,endpoint,auth,key_required,licence_name,licence_url,redistribute,"
         "attribution,discovered_at FROM sources"),
    ),
    "datasets": (
        {"source_id": S, "dataset_id": S, "title": S, "description": S, "source_url": S,
         "freq": S, "licence_name": S, "licence_url": S, "redistribute": S, "attribution": S,
         "is_core": N, "status": S, "source_updated_at": S, "last_ingested_at": S},
        "SELECT d.source_id,d.dataset_id,d.title,d.description,d.source_url,d.freq,"
        + _EFF.format(a="d", b="s")
        + ",d.is_core,d.status,d.source_updated_at,d.last_ingested_at "
        "FROM datasets d JOIN sources s ON s.id=d.source_id",
    ),
    "series": (
        {"series_key": S, "source_id": S, "dataset_id": S, "indicator_id": S, "title": S,
         "description": S, "unit": S, "freq": S, "geos": S, "start_date": S, "end_date": S,
         "dims_json": S, "licence_name": S, "licence_url": S, "redistribute": S,
         "attribution": S},
        ("SELECT x.series_key,x.source_id,x.dataset_id,x.indicator_id,x.title,x.description,"
        "x.unit,x.freq,x.geos,x.start_date,x.end_date,x.dims_json,"
        "COALESCE(x.licence_name,d.licence_name,s.licence_name) AS licence_name,"
        "COALESCE(x.licence_url,d.licence_url,s.licence_url) AS licence_url,"
        "COALESCE(x.redistribute,d.redistribute,s.redistribute) AS redistribute,"
        "COALESCE(x.attribution,d.attribution,s.attribution) AS attribution "
        "FROM series x JOIN datasets d ON d.source_id=x.source_id AND d.dataset_id=x.dataset_id "
        "JOIN sources s ON s.id=x.source_id"),
    ),
}  # fmt: skip
_PARQUET = "read_parquet({files}, union_by_name=true)"


_FILTER_DIM = {"partner": "partner", "hs": "hs", "period": "frame"}  # filter key -> dims key
_FILTER_VAL = {"World": "WLD"}


class QueryError(ValueError):
    """Execution failed (bad column, DuckDB error). Subclass of ValueError like SqlRejected."""


class SqlTimeout(QueryError):
    pass


def _q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


class QueryEngine:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.storage = Storage(settings.data_dir)
        self.catalog = Catalog(self.storage.abs("catalog.sqlite"))
        self._lock = threading.RLock()
        self._con: duckdb.DuckDBPyConnection | None = None
        self._key: tuple[int, int] | None = None

    def close(self) -> None:
        self.catalog.close()

    # ---- views ------------------------------------------------------------------------------

    def _ensure(self) -> duckdb.DuckDBPyConnection:
        """Rebuild the connection when the manifest or the catalog changed (cheap check)."""
        with self._lock:
            ver = self.catalog.conn().execute("PRAGMA data_version").fetchone()[0]
            key = (self.storage.read_manifest()["version"], ver)  # version: mtime ticks can collide
            if self._con is None or key != self._key:
                self._con = self._build()
                self._key = key
            return self._con

    def _build(self) -> duckdb.DuckDBPyConnection:
        st, cat, hosted = self.storage, self.catalog, self.settings.mode == "hosted"
        con = duckdb.connect()
        con.execute("SET GLOBAL TimeZone='UTC'")  # plain SET does not reach cursors
        con.execute("SET autoload_known_extensions=false")
        con.execute("SET autoinstall_known_extensions=false")

        def load(name: str, tbl: pa.Table) -> None:
            con.register("_tmp", tbl)
            con.execute(f"CREATE TABLE {name} AS SELECT * FROM _tmp")
            con.unregister("_tmp")

        # Licence rule (core/licence.py via Catalog.licence_for): series > dataset > source, the
        # most specific level that sets one wins. The `series` rows carry the resolved licence.
        raw = {
            name: [dict(r) for r in cat.conn().execute(sql).fetchall()]
            for name, (_, sql) in _SQLITE.items()
        }
        data = raw
        denied: list[str] = []  # series_keys not servable (hosted), inside served datasets
        src_ok: set[str] | None = None
        if hosted:
            serv = lambda r: can_serve(_lic(r), "hosted")
            ser_ok = [serv(r) for r in raw["series"]]
            denied = [r["series_key"] for r, k in zip(raw["series"], ser_ok, strict=True) if not k]
            ds_in = {
                (r["source_id"], r["dataset_id"])
                for r, k in zip(raw["series"], ser_ok, strict=True)
                if k
            }
            data = {
                "series": [r for r, k in zip(raw["series"], ser_ok, strict=True) if k],
                "datasets": [
                    r
                    for r in raw["datasets"]
                    if serv(r) or (r["source_id"], r["dataset_id"]) in ds_in
                ],
            }
            src_ok = {r["id"] for r in raw["sources"] if serv(r)}
            keep_src = src_ok | {s for s, _ in ds_in}
            data["sources"] = [r for r in raw["sources"] if r["id"] in keep_src]
        for name, (cols, _) in _SQLITE.items():
            rows = data[name]
            load(name, pa.table({c: pa.array([r[c] for r in rows], t) for c, t in cols.items()}))
        ok_ds = {(r["source_id"], r["dataset_id"]) for r in data["datasets"]}
        ingested = {(r["source_id"], r["dataset_id"]) for r in data["datasets"]
                    if r["status"] == "ingested"}  # fmt: skip
        ok_src = src_ok if src_ok is not None else {r["id"] for r in data["sources"]}
        load("_denied_series", pa.table({"series_key": pa.array(denied, S)}))

        # geos, geo_groups
        gs = [(c.alpha_3, c.name, c.alpha_2, int(c.numeric)) for c in pycountry.countries]
        gs += [(f"region:{k}", v, None, None) for k, v in geo_mod._regions().items()]
        load("geos", pa.table({
            "geo": pa.array([g[0] for g in gs], S), "name": pa.array([g[1] for g in gs], S),
            "iso2": pa.array([g[2] for g in gs], S), "m49": pa.array([g[3] for g in gs], N),
        }))  # fmt: skip
        gg = [(g, m) for g, ms in geo_mod._groups().items() for m in ms]
        load("geo_groups", pa.table({
            "group_id": pa.array([g for g, _ in gg], S), "geo": pa.array([m for _, m in gg], S),
        }))  # fmt: skip

        # parquet-backed views
        m = st.read_manifest()

        served: list[str] = []

        def files(*sections: str) -> list[str]:
            out = []
            for sec in sections:
                for k, paths in m.get(sec, {}).items():
                    kk = tuple(k.split("/", 1))
                    if hosted and kk not in ok_ds:
                        continue
                    if sec == "cache" and kk in ingested:
                        continue  # ingested copies are authoritative
                    out += [str(st.abs(p).resolve()) for p in paths]
            served.extend(out)
            return out

        def rd(fs: list[str]) -> str:
            return _PARQUET.format(files="[" + ",".join(_q(f) for f in fs) + "]")

        def view(name: str, fs: list[str], table: str, where: str = "", cache=(), vint=False):
            if not fs and not cache:
                load(f"_empty_{name}", empty_table(table))
                src = f"_empty_{name}"
            elif not cache:
                src = rd(fs)
            else:
                # on-demand parts overlap each other and the ingested rows: keep one row per
                # obs row key, ingested first, then latest retrieved_at.
                # ponytail: window over the union only while cache parts exist.
                key = obs_row_key_sql() + (", vintage" if vint else "")
                u = " UNION ALL BY NAME ".join(
                    f"SELECT *, {i} AS _src FROM {rd(f)}"
                    for i, f in enumerate((fs, list(cache)))
                    if f
                )
                src = (
                    f"(SELECT * EXCLUDE (_src, _rn) FROM (SELECT *, row_number() OVER "
                    f"(PARTITION BY {key} ORDER BY _src, retrieved_at DESC) AS _rn "
                    f"FROM ({u})) WHERE _rn=1)"
                )
            # naive UTC: fetching TIMESTAMPTZ would need pytz, which is not a dependency
            con.execute(
                f"CREATE VIEW {name} AS SELECT * REPLACE "
                f"(timezone('UTC', retrieved_at) AS retrieved_at) FROM {src} {where}"
            )

        deny = (
            "WHERE source_id || ':' || dataset_id || ':' || indicator_id "
            "NOT IN (SELECT series_key FROM _denied_series)"
            if denied
            else ""
        )
        cache_fs = files("cache")
        view("observations", files("obs"), "observations", deny, cache_fs)
        view(
            "observations_vintages",
            files("obs", "vintages"),
            "observations",
            deny,
            cache_fs,
            vint=True,
        )
        for t in ("entities", "entity_xref"):
            fs = [str(st.abs(p).resolve()) for p in m.get("tables", {}).get(t, [])]
            served.extend(fs)
            ids = ",".join(_q(s) for s in sorted(ok_src)) or "NULL"
            view(t, fs, t, f"WHERE source_id IN ({ids})" if hosted else "")

        dirs = [st.abs(d).resolve() for d in ("obs", "tables", "cache/obs")]
        for d in dirs:
            d.mkdir(parents=True, exist_ok=True)
        if hosted:  # exact served files only: a path trick cannot reach a sibling file
            con.execute(f"SET allowed_paths=[{','.join(_q(f) for f in sorted(set(served)))}]")
        else:
            con.execute(f"SET allowed_directories=[{','.join(_q(str(d)) for d in dirs)}]")
        con.execute("SET enable_external_access=false")
        con.execute(f"SET memory_limit={_q(self.settings.duckdb_memory_limit)}")
        con.execute("SET lock_configuration=true")
        return con

    # ---- execution --------------------------------------------------------------------------

    def _run(self, sql: str, params: list | None, cap: int) -> tuple[list[str], list[list], bool]:
        cur = self._ensure().cursor()
        timed_out = threading.Event()

        def fire() -> None:
            timed_out.set()
            cur.interrupt()

        timer = threading.Timer(self.settings.sql_timeout_s, fire)
        timer.start()
        try:
            rel = cur.sql(sql, params=params or None)
            cols = list(rel.columns)
            rows: list[list] = []
            size = 0
            rd = rel.to_arrow_reader(16)  # small batches: abort before a huge value piles up
            for b in rd:
                size += b.nbytes
                if size > self.settings.sql_max_bytes:
                    raise QueryError(
                        f"result larger than {self.settings.sql_max_bytes} bytes; select less"
                    )
                rows += [list(r.values()) for r in b.to_pylist(maps_as_pydicts="lossy")]
                if len(rows) > cap:
                    break
        except duckdb.Error as e:
            if timed_out.is_set():
                raise SqlTimeout(f"query exceeded {self.settings.sql_timeout_s}s") from e
            raise QueryError(str(e)) from e
        finally:
            timer.cancel()
            cur.close()
        return cols, rows[:cap], len(rows) > cap

    def execute(self, sql: str) -> tuple[list[str], list[list[Any]], bool]:
        """Run one allowlisted SELECT. Raises SqlRejected / SqlTimeout / QueryError (ValueErrors)."""
        check(sql)
        return self._run(sql, None, self.settings.sql_max_rows)

    def observations(
        self,
        series_id: str,
        start=None,
        end=None,
        geo: str | None = None,
        limit: int | None = None,
        filters: dict[str, str] | None = None,
        strict: bool = True,
    ) -> tuple[list[str], list[list[Any]], bool]:
        """Rows of one series (`src:ds:ind` = all geos) or one `src:ds:ind:geo`, by period."""
        parts = series_id.split(":", 3)
        if len(parts) < 3:
            raise QueryError(f"bad series id {series_id!r}")
        w = ["source_id=?", "dataset_id=?", "indicator_id=?"]
        p: list[Any] = parts[:3]
        if len(parts) == 4:
            w.append("series_id=?")
            p.append(series_id)
        for cond, v in (("period_start>=?", start), ("period_end<=?", end), ("geo=?", geo)):
            if v is not None:
                w.append(cond)
                p.append(v)
        for k, v in (filters or {}).items():
            dk = _FILTER_DIM.get(k, k)  # a filter narrows rows when it names a dims key
            if strict and not self._run(
                f"SELECT 1 FROM observations WHERE {' AND '.join(w)} AND dims[?] IS NOT NULL",
                [*p, dk], 1,
            )[1]:  # fmt: skip
                raise ValueError("filter not supported for this series: " + k)
            vals = [_FILTER_VAL.get(x, x) for x in v.split(",") if not x.startswith("AG")]
            if vals:
                w.append(f"dims[?] IN ({','.join('?' * len(vals))})")
                p += [dk, *vals]
        sql = f"SELECT * FROM observations WHERE {' AND '.join(w)} ORDER BY geo, period_start"
        cap = min(limit or self.settings.sql_max_rows, self.settings.sql_max_rows)
        return self._run(sql, p, cap)

    def citations(
        self, sql: str, columns: list[str], rows: list[list[Any]]
    ) -> tuple[list[Citation], str | None]:
        with self._lock:
            return cit.citations_for(self.catalog, self.settings.mode, sql, columns, rows)


def _lic(r: dict) -> Licence:
    return Licence(
        name=r["licence_name"], url=r["licence_url"],
        redistribute=r["redistribute"], attribution=r["attribution"],
    )  # fmt: skip


__all__ = ["QueryEngine", "QueryError", "SqlRejected", "SqlTimeout"]
