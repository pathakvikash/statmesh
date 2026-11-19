from __future__ import annotations

import base64
import copy
import gzip
import hashlib
import json
import os
import threading
import time
from collections.abc import Callable, Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import quote, quote_plus

import httpx

from statmesh import __version__
from statmesh.core.models import Manifest
from statmesh.settings import Settings

if TYPE_CHECKING:
    from statmesh.core.catalog import Catalog

ATTEMPTS = 3
BACKOFF_S = 1.0  # delays 1s, 2s between the 3 attempts


class RateLimited(Exception):
    def __init__(self, retry_after: float, message: str = ""):
        super().__init__(message or f"rate limited, retry after {retry_after:.1f}s")
        self.retry_after = retry_after


class MissingKey(Exception):
    pass


def _window(win: str, now: datetime) -> tuple[str, float]:
    """(window_start key, seconds until the window ends)."""
    if win == "hour":
        start = now.replace(minute=0, second=0, microsecond=0)
        end = start + timedelta(hours=1)
    else:
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)
    return start.strftime("%Y-%m-%dT%H:%M:%SZ"), (end - now).total_seconds()


class _Limiter:
    """Per-second spacing in memory; per-hour / per-day counters in the catalog (or memory)."""

    def __init__(self, manifest: Manifest, catalog: Catalog | None):
        self.source_id = manifest.id
        self.rl = manifest.rate_limit
        self.catalog = catalog
        self._next = 0.0
        self._mem: dict[tuple[str, str], int] = {}
        self._lock = threading.Lock()

    def _count(self, win: str, ws: str) -> int:
        if self.catalog is not None:
            return self.catalog.rate_count(self.source_id, win, ws)
        return self._mem.get((win, ws), 0)

    def _incr(self, win: str, ws: str) -> None:
        if self.catalog is not None:
            self.catalog.rate_incr(self.source_id, win, ws)
        else:
            self._mem[(win, ws)] = self._mem.get((win, ws), 0) + 1

    def acquire(self, max_wait: float | None, deadline: float | None) -> None:
        while True:
            with self._lock:
                now_m = time.monotonic()
                now = datetime.now(UTC)
                wait = 0.0
                windows = []
                if self.rl.per_second:
                    wait = max(wait, self._next - now_m)
                for win, limit in (("hour", self.rl.per_hour), ("day", self.rl.per_day)):
                    if limit:
                        ws, left = _window(win, now)
                        windows.append((win, ws))
                        if self._count(win, ws) >= limit:
                            wait = max(wait, left)
                if wait <= 0:
                    if self.rl.per_second:
                        self._next = max(now_m, self._next) + 1.0 / self.rl.per_second
                    for win, ws in windows:
                        self._incr(win, ws)
                    return
            if (max_wait is not None and wait > max_wait) or (
                deadline is not None and now_m + wait > deadline
            ):
                raise RateLimited(wait)
            time.sleep(wait)


class HttpClient:
    def __init__(
        self,
        manifest: Manifest,
        settings: Settings,
        catalog: Catalog | None = None,
        *,
        transport: httpx.BaseTransport | None = None,
    ):
        self.manifest = manifest
        self.settings = settings
        self.key: str | None = os.environ.get(manifest.key_env) if manifest.key_env else None
        ua = f"statmesh/{__version__}"
        if settings.contact_email:
            ua += f" (+{settings.contact_email})"
        self._client = httpx.Client(
            transport=transport, timeout=30.0, headers={"User-Agent": ua}, follow_redirects=False
        )
        self._limiter = _Limiter(manifest, catalog)
        self._max_wait: float | None = None
        self._deadline: float | None = None

    # ---- public ----------------------------------------------------------------------------

    def redact(self, text: str) -> str:
        if not self.key:
            return text
        # raw, then percent-encoded forms (quote_plus gives '+' for spaces, quote gives %20)
        forms = {self.key, quote(self.key, safe=""), quote_plus(self.key)}
        for raw in (self.key, self.key + ":"):  # HTTP basic auth: base64(key:) or base64(key)
            b = base64.b64encode(raw.encode()).decode()
            forms |= {b, b.rstrip("="), base64.urlsafe_b64encode(raw.encode()).decode()}
        for form in sorted(forms, key=len, reverse=True):  # longest first (padded before stripped)
            text = text.replace(form, "***")
        return text

    def get(
        self,
        url: str,
        *,
        params: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        cache_ttl_s: int | None = None,
    ) -> httpx.Response:
        cache_file = self._cache_file(url, params, headers) if cache_ttl_s else None
        if (
            cache_file
            and cache_file.exists()
            and (time.time() - cache_file.stat().st_mtime < cache_ttl_s)
        ):
            ctype, _, body = gzip.decompress(cache_file.read_bytes()).partition(b"\n")
            hdrs = {"content-type": ctype.decode()} if ctype else {}
            return httpx.Response(
                200, content=body, headers=hdrs, request=httpx.Request("GET", url)
            )
        resp = self._retrying(lambda: self._send("GET", url, params=params, headers=headers))
        if cache_file:
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            tmp = cache_file.with_name(cache_file.name + ".tmp")
            ctype = resp.headers.get("content-type", "").replace("\n", " ").encode()
            tmp.write_bytes(gzip.compress(ctype + b"\n" + resp.content))
            os.replace(tmp, cache_file)
        return resp

    def post(
        self,
        url: str,
        *,
        json: Any = None,
        data: Any = None,
        headers: Mapping[str, str] | None = None,
    ) -> httpx.Response:
        return self._retrying(
            lambda: self._send("POST", url, json=json, data=data, headers=headers)
        )

    def download(
        self,
        url: str,
        dest: Path,
        *,
        params: Mapping[str, Any] | None = None,
        max_bytes: int | None = None,
    ) -> Path:
        """Stream to `dest`; with `max_bytes`, raise ValueError once more than that arrives."""
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".tmp")

        def attempt() -> httpx.Response:
            r = self._send("GET", url, params=params, stream=True)
            try:
                if r.is_success:
                    n = 0
                    with open(tmp, "wb") as f:
                        for b in r.iter_bytes():
                            n += len(b)
                            if max_bytes is not None and n > max_bytes:
                                raise ValueError(f"download exceeds {max_bytes >> 20} MB; refusing")
                            f.write(b)
                else:
                    r.read()
            finally:
                r.close()
            return r

        self._retrying(attempt)
        os.replace(tmp, dest)
        return dest

    def with_budget(self, *, max_wait_s: float | None, deadline: float | None = None) -> HttpClient:
        """Shallow copy sharing the limiter and connection pool; `deadline` is time.monotonic()."""
        c = copy.copy(self)
        c._max_wait = max_wait_s
        c._deadline = deadline
        return c

    # ---- internals -------------------------------------------------------------------------

    def _cache_file(
        self, url: str, params: Mapping[str, Any] | None, headers: Mapping[str, str] | None
    ) -> Path:
        # non-secret request headers (Accept etc.) change the response, so they key the cache
        hdrs = sorted((k.lower(), v) for k, v in (headers or {}).items() if self.redact(v) == v)
        ps = sorted((k, self.redact(str(v))) for k, v in (params or {}).items())
        ident = json.dumps([url, ps, hdrs], default=str)
        sha = hashlib.sha256(ident.encode()).hexdigest()
        return self.settings.data_dir / "cache" / "http" / self.manifest.id / f"{sha}.gz"

    def _timeout(self) -> float:
        if self._deadline is None:
            return 30.0
        left = self._deadline - time.monotonic()
        if left <= 0:
            raise TimeoutError("request budget exhausted")
        return min(30.0, left)

    def _send(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        json: Any = None,
        data: Any = None,
        stream: bool = False,
    ) -> httpx.Response:
        """One request with redirects followed by hand so the key never leaves its host."""
        hdrs = dict(headers or {})
        for _ in range(10):
            req = self._client.build_request(
                method, url, params=params, headers=hdrs, json=json, data=data,
                timeout=self._timeout(),
            )  # fmt: skip
            resp = self._client.send(req, stream=stream)
            loc = resp.headers.get("location")
            if not (resp.is_redirect and loc):
                return resp
            resp.close()
            nxt = req.url.join(loc)
            if (nxt.scheme, nxt.host, nxt.port) != (req.url.scheme, req.url.host, req.url.port):
                hdrs = {
                    k: v
                    for k, v in hdrs.items()
                    if self.redact(v) == v and k.lower() not in ("authorization", "cookie")
                }
            if resp.status_code in (301, 302, 303) and method != "GET":
                method, json, data = "GET", None, None
            url, params = str(nxt), None
        raise httpx.TooManyRedirects("too many redirects", request=req)

    def _sleep_within_budget(self, seconds: float) -> None:
        if (self._max_wait is not None and seconds > self._max_wait) or (
            self._deadline is not None and time.monotonic() + seconds > self._deadline
        ):
            raise RateLimited(seconds)
        time.sleep(seconds)

    def _retrying(self, do: Callable[[], httpx.Response]) -> httpx.Response:
        m = self.manifest
        if m.auth == "free_key" and m.key_required and not self.key:
            raise MissingKey(f"{m.id}: set {m.key_env} (free key required)")
        resp: httpx.Response | None = None
        for i in range(ATTEMPTS):
            self._limiter.acquire(self._max_wait, self._deadline)
            last = i == ATTEMPTS - 1
            try:
                resp = do()
            except httpx.TransportError as e:
                if last:
                    e.args = tuple(self.redact(str(a)) for a in e.args)
                    raise
                self._sleep_within_budget(BACKOFF_S * 2**i)
                continue
            if resp.status_code == 429 or resp.status_code >= 500:
                delay = self._retry_after(resp) if resp.status_code == 429 else None
                if last:
                    break
                if delay is not None:
                    self._sleep_within_budget(delay)
                else:
                    self._sleep_within_budget(BACKOFF_S * 2**i)
                continue
            break
        assert resp is not None
        if resp.status_code == 429:
            raise RateLimited(self._retry_after(resp) or BACKOFF_S)
        if not resp.is_success:
            u = resp.request.url
            q = "&".join(f"{k}={self.redact(v)}" for k, v in u.params.multi_items())
            url = self.redact(str(u.copy_with(query=None, fragment=None))) + (f"?{q}" if q else "")
            raise httpx.HTTPStatusError(
                f"HTTP {resp.status_code} for {url}", request=resp.request, response=resp
            )
        return resp

    @staticmethod
    def _retry_after(resp: httpx.Response) -> float | None:
        v = resp.headers.get("Retry-After")
        if v is None:
            return None
        try:
            return max(0.0, float(v))
        except ValueError:
            return None  # HTTP-date form is not supported; falls back to backoff


_clients: dict[tuple[str, Path, Path], HttpClient] = {}
_clients_lock = threading.Lock()


def get_http(source_id: str, settings: Settings, catalog: Catalog) -> HttpClient:
    """One HttpClient per source per process (and per data dir / catalog)."""
    from statmesh.core.connector import connector_dir

    k = (source_id, settings.data_dir, catalog.path)
    with _clients_lock:
        if k not in _clients:
            manifest = Manifest.load(connector_dir(source_id, settings) / "manifest.yaml")
            _clients[k] = HttpClient(manifest, settings, catalog)
        return _clients[k]
