"""Operational hardening: request IDs, access log, readiness probe, JSON logging."""

from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import time
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from statmesh.settings import Settings

_ID = re.compile(r"[A-Za-z0-9_.-]{8,64}")
access_log = logging.getLogger("statmesh.access")


class RequestContextMiddleware:
    """Pure ASGI. Logs method/path/status/duration only: never headers, bodies or query strings."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        t0 = time.perf_counter()
        client = dict(scope["headers"]).get(b"x-request-id", b"").decode("latin-1")
        rid = client if _ID.fullmatch(client) else uuid.uuid4().hex
        status = 500

        async def send_wrapped(msg):
            nonlocal status
            if msg["type"] == "http.response.start":
                status = msg["status"]
                ms = (time.perf_counter() - t0) * 1000
                msg["headers"] = [
                    *(
                        h
                        for h in msg.get("headers", [])
                        if h[0].lower() not in (b"x-request-id", b"server-timing")
                    ),
                    (b"x-request-id", rid.encode()),
                    (b"server-timing", f"app;dur={ms:.1f}".encode()),
                ]
            await send(msg)

        try:
            await self.app(scope, receive, send_wrapped)
        finally:
            access_log.info(
                json.dumps(
                    {
                        "ts": datetime.now(UTC).isoformat(timespec="milliseconds"),
                        "request_id": rid,
                        "method": scope["method"],
                        "path": scope["path"],
                        "status": status,
                        "duration_ms": round((time.perf_counter() - t0) * 1000, 1),
                    }
                )
            )


def readiness(settings: Settings) -> tuple[bool, dict]:
    """Catalog opens read-only and has >= 1 source row. Local file only, no network."""
    path = settings.data_dir / "catalog.sqlite"
    try:
        c = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=1)
        try:
            n = c.execute("SELECT count(*) FROM sources").fetchone()[0]
        finally:
            c.close()
    except sqlite3.Error as e:
        return False, {"catalog": "unavailable", "error": type(e).__name__}
    return n > 0, {"catalog": "ok" if n else "empty", "sources": n}


def readyz_router(settings_fn) -> APIRouter:
    """`settings_fn()` returns the live Settings (e.g. lambda: service._engine().settings)."""
    router = APIRouter()

    @router.get("/readyz", include_in_schema=False)
    def readyz() -> JSONResponse:
        ok, details = readiness(settings_fn())
        return JSONResponse(
            {"ok": ok, **details, "build": os.environ.get("STATMESH_VCS_REF", "unknown")},
            200 if ok else 503,
        )

    return router


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        msg = record.getMessage()
        if record.name == "statmesh.access" and msg.startswith("{"):
            return msg  # already JSON
        d = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": msg,
        }
        if record.exc_info:
            d["exc"] = self.formatException(record.exc_info)
        return json.dumps(d)


def configure_logging(level: str | int = "INFO") -> None:
    """Idempotent: one JSON stream handler on the `statmesh` logger."""
    log = logging.getLogger("statmesh")
    log.setLevel(level)
    if not any(getattr(h, "_statmesh_json", False) for h in log.handlers):
        h = logging.StreamHandler()
        h.setFormatter(_JsonFormatter())
        h._statmesh_json = True  # type: ignore[attr-defined]
        log.addHandler(h)
