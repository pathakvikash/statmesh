"""Orrery app support: service-token auth for /mcp, the app manifest, structuredContent helpers.

Contract: Orrery's docs/design/apps-integration.md. Stdlib only. Auth is off (today's public
behaviour) unless ORRERY_APP_SECRET is set.
"""

from __future__ import annotations

import base64
import contextvars
import hashlib
import hmac
import json
import logging
import os
import time
from datetime import UTC, date, datetime
from typing import Any

SKEW_S = 30
ROW_CAP = 5000  # rows/points in structuredContent and text; the warning says when cut
log = logging.getLogger("statmesh.orrery")
current_sub: contextvars.ContextVar[str | None] = contextvars.ContextVar("orrery_sub", default=None)


class AuthError(Exception):
    pass


def _env(name: str, default: str | None = None) -> str | None:
    return os.environ.get(name) or default


def auth_enabled() -> bool:
    return bool(_env("ORRERY_APP_SECRET"))


def _b64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def verify_jwt(token: str, *, now: float | None = None) -> dict[str, Any]:
    """Verify an Orrery HS256 token; return its claims or raise AuthError."""
    secret = _env("ORRERY_APP_SECRET")
    if not secret:
        raise AuthError("auth not configured")
    try:
        h, p, s = token.split(".")
        header, claims, sig = json.loads(_b64(h)), json.loads(_b64(p)), _b64(s)
    except Exception as e:
        raise AuthError("malformed token") from e
    if not isinstance(header, dict) or header.get("alg") != "HS256":  # rejects none and others
        raise AuthError("alg must be HS256")
    want = hmac.new(secret.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(want, sig):
        raise AuthError("bad signature")
    if not isinstance(claims, dict):
        raise AuthError("bad claims")
    t = time.time() if now is None else now
    if claims.get("iss") != _env("ORRERY_ISSUER", "orrery"):
        raise AuthError("bad iss")
    aud = claims.get("aud")
    want_aud = _env("ORRERY_APP_ID", "statmesh")
    if want_aud != aud and not (isinstance(aud, list) and want_aud in aud):
        raise AuthError("bad aud")
    exp, iat = claims.get("exp"), claims.get("iat")
    if not isinstance(exp, (int, float)) or exp + SKEW_S < t:
        raise AuthError("expired")
    if not isinstance(iat, (int, float)) or iat - SKEW_S > t:
        raise AuthError("iat in the future")
    if not isinstance(claims.get("sub"), str) or not claims["sub"]:
        raise AuthError("missing sub")
    return claims


class OrreryAuth:
    """ASGI wrapper for the MCP app: guards /mcp when ORRERY_APP_SECRET is set and logs each call."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/mcp") or not auth_enabled():
            return await self.app(scope, receive, send)
        auth = dict(scope["headers"]).get(b"authorization", b"").decode("latin-1")
        try:
            if not auth[:7].lower() == "bearer ":
                raise AuthError("missing bearer token")
            sub = verify_jwt(auth[7:].strip())["sub"]
        except AuthError as e:
            body = json.dumps({"error": "unauthorized", "detail": str(e)}).encode()
            await send({"type": "http.response.start", "status": 401, "headers": [
                (b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()),
                (b"www-authenticate", b"Bearer")]})  # fmt: skip
            return await send({"type": "http.response.body", "body": body})
        tool = None
        if (
            scope["method"] == "POST"
        ):  # buffer the (small) JSON-RPC body to log the tool, then replay
            chunks, more = [], True
            while more and sum(map(len, chunks)) < 1_000_000:
                m = await receive()
                chunks.append(m.get("body", b""))
                more = m.get("more_body", False)
            raw = b"".join(chunks)
            try:
                msg = json.loads(raw)
                if isinstance(msg, dict) and msg.get("method") == "tools/call":
                    tool = (msg.get("params") or {}).get("name")
            except ValueError:
                pass
            sent = False

            async def replay():
                nonlocal sent
                if sent:
                    return await receive()
                sent = True
                return {"type": "http.request", "body": raw, "more_body": False}

            inner = replay
        else:
            inner = receive
        # ponytail: log line only; no per-user quota store. Add one here if abuse shows in logs.
        log.info(
            json.dumps({"event": "orrery_mcp", "sub": sub, "method": scope["method"], "tool": tool})
        )
        token = current_sub.set(sub)
        try:
            await self.app(scope, inner, send)
        finally:
            current_sub.reset(token)


def manifest(request_origin: str) -> dict[str, Any]:
    """The /.well-known/orrery-app.json body. ORRERY_BASE_URL pins the one public origin
    (e.g. the Vercel web app that rewrites /mcp and this file to the API); without it the
    request origin is used and only API-side fields are advertised."""
    pinned = _env("ORRERY_BASE_URL")
    base = (pinned or request_origin).rstrip("/")
    m: dict[str, Any] = {
        "manifestVersion": 1,
        "id": _env("ORRERY_APP_ID", "statmesh"),
        "name": "StatMesh",
        "icon": f"{base}/icon.svg",
        "baseUrl": base,
        "description": "Open statistics: search series, read observations, run read-only SQL, with citations.",
        "goodFor": "Public statistics (economy, health, labour, prices, trade) as tables and time series.",
        "mcp": {"url": f"{base}/mcp"},
        "auth": "orrery-jwt" if auth_enabled() else "none",
        "capabilities": ["table", "timeseries", "link"],
        "permission": "read",
    }
    if not pinned:
        del m["icon"]  # the icon is served by the web app, not the API
    else:
        m["sso"] = {"path": "/sso"}
        m["deepLinks"] = {"sql": "/sql?sql={sql}&run=1", "search": "/search?q={q}"}
    return m


# --- structuredContent -------------------------------------------------------------------------


def cap_note(total: int) -> str:
    return f"Showing the first {ROW_CAP} of {total} rows; narrow the query to see the rest."


def table(title: str, columns: list[str], rows: list[list[Any]]) -> dict[str, Any]:
    return {"orrery": 1, "type": "table", "title": title, "columns": columns, "rows": rows}


def _ms(v: Any) -> int | None:
    try:
        d = v if isinstance(v, date) else date.fromisoformat(str(v)[:10])
    except ValueError:
        return None
    return int(datetime(d.year, d.month, d.day, tzinfo=UTC).timestamp() * 1000)


def timeseries(
    title: str, series_id: str, columns: list[str], rows: list[list[Any]]
) -> tuple[dict, int]:
    """Group rows by geo into series of [epoch_ms, value]; returns (payload, points_dropped)."""
    try:
        gi, pi, vi = (columns.index(c) for c in ("geo", "period_start", "value"))
    except ValueError:
        return {"orrery": 1, "type": "timeseries", "title": title, "series": []}, 0
    by: dict[str, list[list[float]]] = {}
    n = dropped = 0
    for r in rows:
        t, v = _ms(r[pi]), r[vi]
        if t is None or isinstance(v, bool) or not isinstance(v, (int, float)):
            continue
        if n >= ROW_CAP:
            dropped += 1
            continue
        n += 1
        by.setdefault(r[gi] or "", []).append([t, v])
    one = len(by) <= 1
    series = [
        {"name": series_id if one or not g else f"{series_id} ({g})", "points": p}
        for g, p in by.items()
    ]
    return {"orrery": 1, "type": "timeseries", "title": title, "series": series}, dropped
