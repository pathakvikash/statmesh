"""`statmesh doctor`: per-connector key status plus one live request (status and size only)."""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

from statmesh.core.connector import connector_dir, list_connectors, load_connector
from statmesh.core.http import HttpClient
from statmesh.core.models import Manifest
from statmesh.settings import Settings
from statmesh.testing.fixtures import RecordingTransport, load_requests

TIMEOUT_S = 20.0


@dataclass
class Result:
    source: str
    key: str  # "set" | "missing" | "optional": never a value
    status: str  # "ok" | "skip" | "fail"
    latency_ms: int | None = None
    detail: str = ""


class _Probe(RecordingTransport):
    """Passes requests through (proxy env honoured) and keeps only status and size."""

    def __init__(self) -> None:
        super().__init__(Path(os.devnull))
        self.seen: list[tuple[int, int]] = []

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        resp = self._transport(request.url).handle_request(request)
        resp.read()
        self.seen.append((resp.status_code, len(resp.content)))
        return resp


def key_status(m: Manifest) -> str:
    if m.auth != "free_key" or not m.key_env:
        return "optional"
    if os.environ.get(m.key_env):
        return "set"
    return "missing" if m.key_required else "optional"


def check(source: str, *, offline: bool = False, settings: Settings | None = None) -> Result:
    settings = settings or Settings.from_env()
    m = Manifest.load(connector_dir(source, settings) / "manifest.yaml")
    key = key_status(m)
    if key == "missing":
        return Result(source, key, "skip", detail=f"{m.key_env} not set")
    if offline:
        return Result(source, key, "skip", detail="offline")
    t0 = time.monotonic()
    http = None
    try:
        # a throwaway data dir so the HTTP cache can never answer instead of the network
        with tempfile.TemporaryDirectory() as tmp:
            s = dataclasses.replace(settings, data_dir=Path(tmp))
            c = load_connector(source, s)
            fdir = connector_dir(source, s) / "tests" / "fixtures"
            probe = _Probe()
            http = HttpClient(c.manifest, s, None, transport=probe).with_budget(
                max_wait_s=TIMEOUT_S, deadline=t0 + TIMEOUT_S
            )
            for _ in c.fetch(load_requests(fdir)[0], http):
                pass
        status = probe.seen[-1][0] if probe.seen else 0
        detail = f"{len(probe.seen)} request(s), last {status}, {sum(n for _, n in probe.seen)} B"
        return Result(source, key, "ok", round((time.monotonic() - t0) * 1000), detail)
    except Exception as e:  # noqa: BLE001 - any failure is a doctor "fail", never a crash
        msg = f"{type(e).__name__}: {e}"
        return Result(  # redact the whole message first: a key cut at 160 would no longer match
            source, key, "fail", round((time.monotonic() - t0) * 1000),
            (http.redact(msg) if http else msg)[:160],
        )  # fmt: skip


def doctor_cmd(args: argparse.Namespace) -> int:
    settings = Settings.from_env()
    ids = [args.source] if args.source else list_connectors(settings)
    results = []
    for i in ids:
        try:
            results.append(check(i, offline=args.offline, settings=settings))
        except KeyError as e:
            results.append(Result(i, "optional", "fail", detail=str(e.args[0])))
    if args.json:
        print(json.dumps([dataclasses.asdict(r) for r in results], indent=1))
    else:
        print(f"{'source':<22}{'key':<10}{'status':<8}{'ms':>6}  detail")
        for r in results:
            ms = "" if r.latency_ms is None else r.latency_ms
            print(f"{r.source:<22}{r.key:<10}{r.status:<8}{ms:>6}  {r.detail}")
    return 1 if any(r.status == "fail" for r in results) else 0
