"""FastAPI app: REST over statmesh.service, MCP streamable HTTP mounted at /mcp."""

from __future__ import annotations

import argparse
import logging
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Annotated

import uvicorn
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import BaseModel, ConfigDict

from statmesh import service
from statmesh.api import export_csv, shares
from statmesh.core.api_models import (
    ObservationsResult,
    RelatedResult,
    SchemaResult,
    SearchResult,
    SeriesDetail,
    SourceStatus,
    SqlResult,
)
from statmesh.core.http import MissingKey
from statmesh.mcp_server import build_server
from statmesh.query import SqlTimeout
from statmesh.sandbox import PythonResult
from statmesh.settings import Settings

CODES = {"not_found": 404, "forbidden": 403, "rate_limited": 429}


class SqlRequest(BaseModel):
    sql: str
    model_config = ConfigDict(json_schema_extra={"examples": [{
        "sql": "SELECT source_id, count(*) AS n FROM observations GROUP BY 1"}]})  # fmt: skip


class PythonRequest(BaseModel):
    code: str
    model_config = ConfigDict(json_schema_extra={"examples": [{
        "code": "print(len(open('/data/obs/.keep').read()))"}]})  # fmt: skip


_FILTER = Query(default=[])
Multi = Annotated[list[str] | None, Query()]  # repeatable query param
_LLMS_CANDIDATES = (  # packaged copy first (wheel), then the checkout's docs/
    Path(__file__).resolve().parents[1] / "llms.txt",
    Path(__file__).resolve().parents[3] / "docs" / "llms.txt",
)

# operationId, summary and description for every operation, keyed by (path, method). Applied
# after routing, so the routers in api/shares.py and api/export_csv.py need no edits.
OPERATIONS = {
    ("/healthz", "GET"): (
        "get_health",
        "Health check",
        'Returns {"ok": true} when the API process is up. Does not check the catalog.',
    ),
    ("/search", "GET"): (
        "search_series",
        "Search series",
        (
            "Keyword search over the series catalog. Filters combine. Returns the "
            "matching series with citations. `q` may be empty when a filter is set."
        ),
    ),
    ("/sources", "GET"): (
        "list_sources",
        "List sources",
        (
            "Sources with freshness, key status and topics. `q` matches a substring of "
            "name, id or dataset titles; `auth` is keyless|key; `status` is data|catalogue."
        ),
    ),
    ("/schema", "GET"): (
        "get_schema",
        "SQL view schema",
        (
            "Columns, types, descriptions, examples and join hints of every SQL view that "
            "POST /query can read."
        ),
    ),
    ("/query", "POST"): (
        "run_sql",
        "Run a read-only SQL query",
        "One allowlisted SELECT over the views listed by GET /schema. Times out with 504.",
    ),
    ("/python", "POST"): (
        "run_python",
        "Run sandboxed Python",
        (
            "Runs code in a no-network sandbox with Parquet observations at /data/obs. "
            "Registered only when the sandbox is enabled."
        ),
    ),
    ("/series/{series_id}/related", "GET"): (
        "related_series",
        "Related series",
        (
            "Series related to one series: same dataset, shared topics, similar titles, other "
            "sources. Deterministic, each hit has a `reason`; hosted mode serves only "
            "redistributable series."
        ),
    ),
    ("/series/{series_id}/observations", "GET"): (
        "get_observations",
        "Get series observations",
        (
            "Observations of one series, fetched on demand for remote datasets (may return "
            "429 with Retry-After). `filter` takes key=value pairs for connector filters."
        ),
    ),
    ("/series/{series_id}/observations.csv", "GET"): (
        "download_observations_csv",
        "Download observations as CSV",
        (
            "Streams the observations of one series as text/csv. The row cap is in "
            "X-Statmesh-Row-Cap; compare it with the rows received."
        ),
    ),
    ("/series/{series_id}", "GET"): (
        "get_series",
        "Get series metadata",
        "Metadata, dimensions, licence and citation of one series.",
    ),
    ("/shares", "POST"): (
        "create_share",
        "Create a share link",
        (
            "Stores one answer and returns its id; the public read-only link is /a/{id}. "
            "Answers over the size cap get 413."
        ),
    ),
    ("/shares/{share_id}", "GET"): (
        "get_share",
        "Read a shared answer",
        "The stored answer behind a share link.",
    ),
    ("/llms.txt", "GET"): (
        "get_llms_txt",
        "Agent guide (llms.txt)",
        (
            "Plain-text guide for AI agents: what statmesh is, the MCP tools, the REST "
            "endpoints, citation rules and how to report missing data."
        ),
    ),
}


def hosted_api_base(s: Settings) -> str | None:
    """Where the hosted mirror serves the API (nginx strips /v1): `<origin>/v1`. None when self-hosted."""
    if s.mode != "hosted":
        return None
    if s.public_url:
        return s.public_url.rstrip("/") + "/v1"
    host = next((h for h in s.allowed_hosts if "*" not in h), None)  # e.g. stats.example.org
    return f"https://{host}/v1" if host else None


def create_app() -> FastAPI:
    settings = service._engine().settings
    hosts = list(settings.allowed_hosts)
    off = "*" in hosts
    if off:
        logging.getLogger(__name__).warning(
            "STATMESH_ALLOWED_HOSTS=*: MCP DNS-rebinding protection is OFF"
        )
    mcp_app = build_server().streamable_http_app(
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=not off,
            allowed_hosts=hosts,
            allowed_origins=[f"{sch}://{h}" for h in hosts for sch in ("http", "https")],
        )
    )  # serves /mcp

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        async with mcp_app.router.lifespan_context(mcp_app):
            yield

    app = FastAPI(title="statmesh", lifespan=lifespan)

    def host_ok(host: str) -> bool:  # same semantics as the MCP check: exact or "name:*"
        return host in hosts or any(a.endswith(":*") and host.startswith(a[:-1]) for a in hosts)

    @app.middleware("http")
    async def check_host(request: Request, call_next):
        probe = request.url.path == "/healthz" and request.method in ("GET", "HEAD")
        if not off and not probe and not host_ok(request.headers.get("host", "")):
            return Response("Invalid Host header", status_code=421)
        return await call_next(request)

    max_age = service._engine().settings.cache_max_age_s
    cors = service._engine().settings.cors_origins

    @app.middleware("http")
    async def cache_control(request: Request, call_next):
        r = await call_next(request)
        if "cache-control" not in r.headers:  # a route may set its own
            p = request.url.path
            public = (request.method == "GET" and r.status_code == 200 and max_age > 0
                      and p != "/healthz" and not p.startswith("/mcp"))  # fmt: skip
            r.headers["Cache-Control"] = (
                f"public, max-age={max_age}, stale-while-revalidate=3600" if public else "no-store"
            )
            if (
                public and cors
            ):  # the body can differ per Origin (CORS headers), so shared caches key on it
                r.headers.append("Vary", "Origin")
        return r

    if cors:  # added last = outermost, so preflights and 421s carry CORS headers too
        app.add_middleware(CORSMiddleware, allow_origins=list(cors), allow_methods=["GET", "POST"],
                           allow_headers=["content-type"], allow_credentials=False)  # fmt: skip

    def err(code: int, e: Exception) -> JSONResponse:
        return JSONResponse({"detail": str(e.args[0] if isinstance(e, KeyError) else e)}, code)

    app.add_exception_handler(ValueError, lambda r, e: err(400, e))
    app.add_exception_handler(SqlTimeout, lambda r, e: err(504, e))
    app.add_exception_handler(KeyError, lambda r, e: err(404, e))
    app.add_exception_handler(TimeoutError, lambda r, e: err(504, e))
    app.add_exception_handler(MissingKey, lambda r, e: err(503, e))

    app.include_router(shares.router)
    app.include_router(export_csv.router)

    @app.api_route("/healthz", methods=["GET", "HEAD"])
    def healthz() -> dict:
        return {"ok": True}

    @app.get("/llms.txt", response_class=PlainTextResponse)
    def llms_txt() -> Response:
        for p in _LLMS_CANDIDATES:
            if p.is_file():
                return PlainTextResponse(p.read_text(encoding="utf-8"))
        return PlainTextResponse("llms.txt is not installed", status_code=404)

    @app.get("/search")
    def search(q: str = Query("", examples=["unemployment India"]),
               geo: str | None = None, freq: str | None = None,
               source: Multi = None, topic: Multi = None,
               start_year: int | None = None, end_year: int | None = None,
               updated_since: str | None = None, redistribute: str | None = None,
               limit: int = Query(10, ge=1, le=service.MAX_SEARCH),
               offset: int = Query(0, ge=0)) -> SearchResult:  # fmt: skip
        """`source` and `topic` repeat or take a comma list (any-of). `q` may be empty when a
        filter is set. `start_year`/`end_year`: coverage overlaps; `updated_since`: YYYY-MM-DD;
        `redistribute`: yes|review|no. `offset` pages: pass next_offset until it is null."""
        try:
            return service.search_series(
                q, geo=geo, freq=freq, source=source, topic=topic, start_year=start_year,
                end_year=end_year, updated_since=updated_since, redistribute=redistribute,
                limit=limit, offset=offset,
            )  # fmt: skip
        except service.OffsetBeyondPool as e:
            raise HTTPException(422, str(e)) from e

    @app.get("/sources", response_model=list[SourceStatus])
    def sources(q: str | None = None, kind: str | None = None, topic: Multi = None,
                redistribute: str | None = None, auth: str | None = None,
                status: str | None = None):  # fmt: skip
        """`q`: substring of name, id or dataset titles; `auth`: keyless|key; `status`:
        data|catalogue; `topic` repeats or is a comma list (any-of)."""
        return service.list_sources(
            q=q, kind=kind, topic=topic, redistribute=redistribute, auth=auth, status=status
        )

    @app.get("/schema")
    def schema() -> SchemaResult:
        return service.describe_schema()

    @app.post("/query")
    def query(body: SqlRequest) -> SqlResult:
        return service.run_sql(body.sql)

    if service.python_enabled():  # absent route -> 404 when disabled

        @app.post("/python")
        def python(body: PythonRequest) -> PythonResult:
            return service.run_python(body.code)

    # {id:path}: ids contain ':' and '/'. The longer route is registered first.
    _err = {c: {"model": ObservationsResult} for c in (403, 404, 429)}

    @app.get(
        "/series/{series_id:path}/observations", response_model=ObservationsResult, responses=_err
    )
    def observations(series_id: str, start: date | None = None, end: date | None = None,
                     geo: str | None = None,
                     limit: int | None = Query(None, ge=1, le=service.MAX_LIMIT),
                     offset: int = Query(0, ge=0),
                     filter: list[str] = _FILTER):  # fmt: skip
        """`filter=key=value`, repeatable (e.g. filter=partner=USA&filter=hs=85): connector
        filters for on-demand fetches of remote datasets. `offset` pages: pass next_offset
        until it is null. `truncated`: more rows follow at next_offset. `partial` with a `warning`
        means the dataset itself is partial (a row cap cut its ingest or on-demand fetch)."""
        r: ObservationsResult = service.get_observations(
            series_id,
            start=start,
            end=end,
            geo=geo,
            limit=limit,
            filters=service.parse_filters(filter),
            offset=offset,
        )
        headers = {"Retry-After": str(int(r.retry_after) + 1)} if r.retry_after else None
        return JSONResponse(r.model_dump(mode="json"), CODES.get(r.status, 200), headers)

    # Suffix route, registered before the greedy /series/{id:path}; a series id never ends in
    # "/related" (ids are src:dataset:indicator[:geo]), so the suffix is unambiguous.
    @app.get("/series/{series_id:path}/related")
    def related(series_id: str, geo: str | None = None,
                limit: int = Query(8, ge=1, le=service.MAX_SEARCH)) -> RelatedResult:  # fmt: skip
        return service.related_series(series_id, geo=geo, limit=limit)

    @app.get("/series/{series_id:path}")
    def series(series_id: str) -> SeriesDetail:
        return service.describe_series(series_id)

    app.mount("/", mcp_app)
    _openapi = app.openapi  # the spec is built lazily; patch its result, routers included

    def openapi() -> dict:
        schema = _openapi()
        for (path, method), (op_id, summary, desc) in OPERATIONS.items():
            op = schema["paths"].get(path, {}).get(method.lower())
            if op is not None:
                op.update(operationId=op_id, summary=summary, description=desc)
        if base := hosted_api_base(settings):  # ChatGPT Actions call this server URL
            schema["servers"] = [{"url": base}]
        return schema

    app.openapi = openapi
    return app


def serve(args: argparse.Namespace) -> None:
    Settings.from_env().validate()
    service.configure()
    uvicorn.run(create_app(), host=args.host, port=args.port)
