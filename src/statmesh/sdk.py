"""Thin REST client (pandas or polars frames) plus the client CLI commands."""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from typing import Any

import httpx


class SdkError(Exception):
    def __init__(self, msg: str, retry_after: float | None = None):
        super().__init__(msg)
        self.retry_after = retry_after


def _frame(kind: str, cols: list[str], rows: list[list[Any]]):
    try:
        if kind == "polars":
            import polars as pl

            return pl.DataFrame(rows, schema=cols, orient="row")
        import pandas as pd
    except ImportError as e:
        raise ImportError(f"frame={kind!r} needs the extra: pip install 'statmesh[sdk]'") from e
    return pd.DataFrame(rows, columns=cols)


class Client:
    """`http` may be any httpx.Client (e.g. a FastAPI TestClient); default hits STATMESH_URL."""

    def __init__(self, base_url: str | None = None, *, frame: str = "pandas",
                 http: httpx.Client | None = None):  # fmt: skip
        if frame not in ("pandas", "polars"):
            raise ValueError("frame must be 'pandas' or 'polars'")
        self.frame = frame
        self.http = http or httpx.Client(
            base_url=base_url or os.environ.get("STATMESH_URL", "http://localhost:8000"),
            timeout=60,
        )

    # raw JSON-shaped dicts (CLI and export use these)
    def _call(self, method: str, path: str, **kw) -> dict | list:
        r = self.http.request(method, path, **kw)
        try:
            body = r.json()
        except ValueError:
            body = None
        if r.status_code == 200 and body is not None:
            return body
        if isinstance(body, dict) and "status" in body and "series_id" in body:
            return body  # observations: model body on 403/404/429
        detail = body.get("detail") if isinstance(body, dict) else r.text
        raise SdkError(f"HTTP {r.status_code}: {detail}")

    def _search(self, q, **filters):
        return self._call("GET", "/search", params={"q": q, **{k: v for k, v in filters.items() if v is not None}})  # fmt: skip

    def _describe(self, series_id):
        return self._call("GET", f"/series/{series_id}")

    def _obs(self, series_id, start=None, end=None, geo=None, limit=None, filters=None):
        params = {"start": start, "end": end, "geo": geo, "limit": limit}
        q = [(k, str(v)) for k, v in params.items() if v is not None]
        q += [("filter", f"{k}={v}") for k, v in (filters or {}).items()]
        body = self._call("GET", f"/series/{series_id}/observations", params=q)
        if body["status"] != "ok":
            ra = body.get("retry_after")
            raise SdkError(f"{series_id}: {body['status']}" + (f", retry in {ra}s" if ra else ""), ra)  # fmt: skip
        return body

    def _sql(self, query):
        return self._call("POST", "/query", json={"sql": query})

    def _sources(self):
        return self._call("GET", "/sources")

    # frames
    def search(self, q: str, **filters):
        """filters: geo, freq, source, limit"""
        hits = self._search(q, **filters)["hits"]
        cols = list(hits[0]) if hits else ["series_id", "title"]
        return _frame(self.frame, cols, [[h[c] for c in cols] for h in hits])

    def get(self, series_id: str, start=None, end=None, geo=None, limit=None, filters=None):
        """filters: connector filters, e.g. {"partner": "USA"}."""
        r = self._obs(series_id, start, end, geo, limit, filters)
        df = _frame(self.frame, r["columns"], r["rows"])
        self.citations = r["citations"]
        if self.frame == "pandas":
            df.attrs["citations"] = r["citations"]  # polars frames have no attrs: client.citations
        return df

    def sql(self, query: str):
        r = self._sql(query)
        self.citations = r["citations"]
        df = _frame(self.frame, r["columns"], r["rows"])
        if self.frame == "pandas":
            df.attrs["citations"] = r["citations"]
        return df

    def sources(self):
        s = self._sources()
        cols = list(s[0]) if s else ["id"]
        return _frame(self.frame, cols, [[x[c] for c in cols] for x in s])

    def describe(self, series_id: str) -> dict:
        return self._describe(series_id)


class LocalClient(Client):
    """Same surface, calls statmesh.service in-process (no server)."""

    def __init__(self, frame: str = "pandas"):
        self.frame = frame

    def _search(self, q, **f):
        from statmesh import service

        return service.search_series(q, **{k: v for k, v in f.items() if v is not None}).model_dump(
            mode="json"
        )

    def _describe(self, series_id):
        from statmesh import service

        return service.describe_series(series_id).model_dump(mode="json")

    def _obs(self, series_id, start=None, end=None, geo=None, limit=None, filters=None):
        from datetime import date

        from statmesh import service

        d = lambda v: date.fromisoformat(v) if isinstance(v, str) else v
        r = service.get_observations(
            series_id, start=d(start), end=d(end), geo=geo, limit=limit, filters=filters
        )
        body = r.model_dump(mode="json")
        if r.status != "ok":
            raise SdkError(f"{series_id}: {r.status}", r.retry_after)
        return body

    def _sql(self, query):
        from statmesh import service

        return service.run_sql(query).model_dump(mode="json")

    def _sources(self):
        from statmesh import service

        return [s.model_dump(mode="json") for s in service.list_sources()]


def _client(args: argparse.Namespace) -> Client:
    return LocalClient() if getattr(args, "local", False) else Client()


def _csv(cols: list[str], rows: list[list[Any]]) -> None:
    w = csv.writer(sys.stdout, lineterminator="\n")
    w.writerow(cols)
    w.writerows(rows)


def _run(fn):
    try:
        return fn()
    except (SdkError, KeyError, ValueError, httpx.HTTPError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


def search_cmd(args: argparse.Namespace) -> int:
    def go():
        hits = _client(args)._search(
            args.query, geo=args.geo, freq=args.freq, source=args.source, limit=args.limit
        )["hits"]
        _csv(["series_id", "title", "unit", "freq", "geo", "source_id", "licence_name", "status"],
             [[h[c] for c in ("series_id", "title", "unit", "freq", "geo", "source_id", "licence_name", "status")] for h in hits])  # fmt: skip
        return 0

    return _run(go)


def get_cmd(args: argparse.Namespace) -> int:
    def go():
        from statmesh.service import parse_filters

        r = _client(args)._obs(
            args.series_id,
            args.start,
            args.end,
            geo=args.geo,
            limit=args.limit,
            filters=parse_filters(args.filter),
        )
        if r.get("warning"):
            print(f"warning: {r['warning']}", file=sys.stderr)
        if args.format == "json":
            print(json.dumps(r, indent=2))
        else:
            _csv(r["columns"], r["rows"])
        return 0

    return _run(go)


def sql_cmd(args: argparse.Namespace) -> int:
    def go():
        r = _client(args)._sql(args.query)
        _csv(r["columns"], r["rows"])
        if r.get("warning"):
            print(f"warning: {r['warning']}", file=sys.stderr)
        return 0

    return _run(go)


def sources_cmd(args: argparse.Namespace) -> int:
    def go():
        s = _client(args)._sources()
        cols = [
            "id",
            "name",
            "kind",
            "redistribute",
            "key_configured",
            "datasets",
            "series",
            "last_ingested_at",
        ]
        _csv(cols, [[x[c] for c in cols] for x in s])
        return 0

    return _run(go)
