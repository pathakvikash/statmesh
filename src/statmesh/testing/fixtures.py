"""Record and replay HTTP for connector tests. Fixtures are keyed on method + URL + sorted params
(the secret redacted), so a replay never depends on a live key."""

from __future__ import annotations

import hashlib
import json
import os
import urllib.request
from pathlib import Path

import httpx
import yaml

from statmesh.core.connector import connector_dir, load_connector
from statmesh.core.http import HttpClient
from statmesh.core.models import FetchRequest, Manifest, RateLimit
from statmesh.settings import Settings

REDACTED = "REDACTED"
_DROP_HEADERS = {"set-cookie", "authorization", "content-encoding", "content-length"}


class FixtureMissing(Exception):
    pass


class UnrecordableResponse(Exception):
    """A 5xx (outage, HTML error page) must never become a fixture; 4xx stay (real 404s are used)."""


def _redact(s: str, secret: str | None) -> str:
    return s.replace(secret, REDACTED) if secret else s


def fixture_key(request: httpx.Request, secret: str | None = None) -> tuple[str, dict]:
    """(sha16, canonical description) for a request."""
    url = request.url.copy_with(query=None, fragment=None)
    params = sorted([k, _redact(v, secret)] for k, v in request.url.params.multi_items())
    desc = {"method": request.method, "url": _redact(str(url), secret), "params": params}
    if request.method in ("POST", "PUT", "PATCH") and request.content:
        body = _redact(request.content.decode("utf-8", "replace"), secret)
        desc["body_sha"] = hashlib.sha256(body.encode()).hexdigest()[:16]
    blob = json.dumps(desc, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode()).hexdigest()[:16], desc


class ReplayTransport(httpx.BaseTransport):
    def __init__(self, fixtures_dir: Path, secret: str | None = None):
        self.dir = Path(fixtures_dir) / "http"
        self.secret = secret

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        sha, desc = fixture_key(request, self.secret)
        meta_path = self.dir / f"{sha}.json"
        if not meta_path.exists():
            raise FixtureMissing(f"no fixture {sha} for {json.dumps(desc)} in {self.dir}")
        meta = json.loads(meta_path.read_text())
        body = (self.dir / meta["body"]).read_bytes()
        return httpx.Response(
            meta["status"], headers=meta.get("headers", {}), content=body, request=request
        )


class RecordingTransport(httpx.BaseTransport):
    def __init__(self, fixtures_dir: Path, secret: str | None = None):
        self.dir = Path(fixtures_dir) / "http"
        self.secret = secret
        self._inner: httpx.BaseTransport | None = None  # tests may inject a transport
        self._pool: dict[str | None, httpx.BaseTransport] = {}

    def _transport(self, url: httpx.URL) -> httpx.BaseTransport:
        """A custom transport bypasses httpx's proxy env handling, so apply it here."""
        if self._inner is not None:
            return self._inner
        proxy = urllib.request.getproxies().get(url.scheme)
        if proxy and urllib.request.proxy_bypass_environment(url.host):
            proxy = None
        if proxy not in self._pool:
            self._pool[proxy] = httpx.HTTPTransport(proxy=proxy)
        return self._pool[proxy]

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        resp = self._transport(request.url).handle_request(request)
        resp.read()
        if resp.status_code >= 500:
            raise UnrecordableResponse(
                f"{request.method} {request.url.copy_with(query=None)} returned "
                f"{resp.status_code}; not recording a server error as a fixture"
            )
        sha, desc = fixture_key(request, self.secret)
        headers = {k: _redact(v, self.secret) for k, v in resp.headers.items()
                   if k.lower() not in _DROP_HEADERS}  # fmt: skip
        body = resp.content
        stored = body.replace(self.secret.encode(), REDACTED.encode()) if self.secret else body
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / f"{sha}.body").write_bytes(stored)
        meta = {**desc, "status": resp.status_code, "headers": headers, "body": f"{sha}.body",
                "synthetic": False}  # fmt: skip
        (self.dir / f"{sha}.json").write_text(json.dumps(meta, indent=1, sort_keys=True))
        live = [(k, v) for k, v in resp.headers.items() if k.lower() not in _DROP_HEADERS]
        return httpx.Response(resp.status_code, headers=live, content=body, request=request)


def fixtures_dir(source_id: str, settings: Settings) -> Path:
    return connector_dir(source_id, settings) / "tests" / "fixtures"


def load_requests(fixtures_dir: Path) -> list[FetchRequest]:
    raw = yaml.safe_load((Path(fixtures_dir) / "requests.yaml").read_text()) or []
    out = []
    for r in raw:
        r = dict(r)
        for k in ("indicator_ids", "geos"):
            if k in r:
                r[k] = tuple(r[k])
        out.append(FetchRequest(**r))
    return out


def replay_http(source_id: str, settings: Settings) -> HttpClient:
    manifest = Manifest.load(connector_dir(source_id, settings) / "manifest.yaml")
    manifest = manifest.model_copy(update={"rate_limit": RateLimit()})  # no sleeps in replay
    key = os.environ.get(manifest.key_env) if manifest.key_env else None
    if not key and manifest.auth == "free_key":
        key = (
            "replay-key"  # offline runs need no real key; the transport redacts it like a real one
        )
    client = HttpClient(
        manifest, settings, None, transport=ReplayTransport(fixtures_dir(source_id, settings), key)
    )
    client.key = key
    return client


def record(source_id: str, settings: Settings, discover_limit: int = 20) -> None:
    """Run discover(limit) and every request in requests.yaml against the live API."""
    connector = load_connector(source_id, settings)
    fdir = fixtures_dir(source_id, settings)
    key = os.environ.get(connector.manifest.key_env) if connector.manifest.key_env else None
    http = HttpClient(connector.manifest, settings, None, transport=RecordingTransport(fdir, key))
    list(connector.discover(http, limit=discover_limit))
    for req in load_requests(fdir):
        for _ in connector.fetch(req, http):
            pass
