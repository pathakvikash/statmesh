"""FastAPI app: REST over statmesh.service, MCP streamable HTTP mounted at /mcp."""

from __future__ import annotations

import argparse
import logging
from contextlib import asynccontextmanager
from datetime import date
from typing import Annotated

import uvicorn
from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse, Response
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import BaseModel

from statmesh import service
from statmesh.api import export_csv, shares
from statmesh.core.api_models import (
    ObservationsResult,
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


class PythonRequest(BaseModel):
    code: str


_FILTER = Query(default=[])
Multi = Annotated[list[str] | None, Query()]  # repeatable query param


def create_app() -> FastAPI:
    hosts = list(service._engine().settings.allowed_hosts)
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
        if not off and not host_ok(request.headers.get("host", "")):
            return Response("Invalid Host header", status_code=421)
        return await call_next(request)

    def err(code: int, e: Exception) -> JSONResponse:
        return JSONResponse({"detail": str(e.args[0] if isinstance(e, KeyError) else e)}, code)

    app.add_exception_handler(ValueError, lambda r, e: err(400, e))
    app.add_exception_handler(SqlTimeout, lambda r, e: err(504, e))
    app.add_exception_handler(KeyError, lambda r, e: err(404, e))
    app.add_exception_handler(TimeoutError, lambda r, e: err(504, e))
    app.add_exception_handler(MissingKey, lambda r, e: err(503, e))

    app.include_router(shares.router)
    app.include_router(export_csv.router)

    @app.get("/healthz")
    def healthz() -> dict:
        return {"ok": True}

    @app.get("/search")
    def search(q: str = "", geo: str | None = None, freq: str | None = None,
               source: Multi = None, topic: Multi = None,
               start_year: int | None = None, end_year: int | None = None,
               updated_since: str | None = None, redistribute: str | None = None,
               limit: int = Query(10, ge=1, le=service.MAX_SEARCH)) -> SearchResult:  # fmt: skip
        """`source` and `topic` repeat or take a comma list (any-of). `q` may be empty when a
        filter is set. `start_year`/`end_year`: coverage overlaps; `updated_since`: YYYY-MM-DD;
        `redistribute`: yes|review|no."""
        return service.search_series(
            q, geo=geo, freq=freq, source=source, topic=topic, start_year=start_year,
            end_year=end_year, updated_since=updated_since, redistribute=redistribute, limit=limit,
        )  # fmt: skip

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
                     filter: list[str] = _FILTER):  # fmt: skip
        """`filter=key=value`, repeatable (e.g. filter=partner=USA&filter=hs=85): connector
        filters for on-demand fetches of remote datasets."""
        r: ObservationsResult = service.get_observations(
            series_id,
            start=start,
            end=end,
            geo=geo,
            limit=limit,
            filters=service.parse_filters(filter),
        )
        headers = {"Retry-After": str(int(r.retry_after) + 1)} if r.retry_after else None
        return JSONResponse(r.model_dump(mode="json"), CODES.get(r.status, 200), headers)

    @app.get("/series/{series_id:path}")
    def series(series_id: str) -> SeriesDetail:
        return service.describe_series(series_id)

    app.mount("/", mcp_app)
    return app


def serve(args: argparse.Namespace) -> None:
    Settings.from_env().validate()
    service.configure()
    uvicorn.run(create_app(), host=args.host, port=args.port)
