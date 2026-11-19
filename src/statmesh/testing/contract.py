"""Contract suite every connector must pass. A connector's tests/test_contract.py is:

from statmesh.testing.contract import ContractSuite

class TestContract(ContractSuite):
    connector_id = "<id>"
"""

from __future__ import annotations

import os
import re
from unittest import mock
from urllib.parse import urlparse

import pyarrow as pa

from statmesh.core.connector import connector_dir, load_connector
from statmesh.core.geo import is_valid_geo
from statmesh.core.http import HttpClient
from statmesh.core.models import FetchRequest, Manifest, RawChunk
from statmesh.core.schema import validate_table
from statmesh.settings import Settings
from statmesh.testing.fixtures import fixtures_dir, load_requests, replay_http

_KEY_PARAM = re.compile(r"(?i)api[_-]?key=([^&\s\"'\\]*)")
_PLACEHOLDER_HOST = "example.org"  # the scaffold's stand-in host; never a real licence page


def licence_url_problem(licence) -> str | None:
    """Why a licence url is not a real one (empty, the scaffold's TODO, or the example.org host)."""
    url = (licence.url or "").strip()
    if not url:
        return "licence.url is empty"
    if "todo" in url.lower() or (urlparse(url).hostname or "") == _PLACEHOLDER_HOST:
        hint = " (redistribute: yes needs the provider's real licence page)" if licence.redistribute == "yes" else ""  # fmt: skip
        return f"licence.url {url!r} is a placeholder{hint}"
    return None


def _no_socket(*a, **k):
    raise AssertionError("normalize() must not touch the network")


class ContractSuite:
    connector_id: str
    discover_limit: int = 20
    max_unmapped: float = 0.05

    # ---- helpers (not tests) -----------------------------------------------------------------

    def settings(self) -> Settings:
        """Override to point `connectors_dir` at a folder outside the package."""
        return Settings.from_env()

    def _connector(self):
        return load_connector(self.connector_id, self.settings())

    def _http(self) -> HttpClient:
        return replay_http(self.connector_id, self.settings())

    def _requests(self) -> list[FetchRequest]:
        return load_requests(fixtures_dir(self.connector_id, self.settings()))

    def _chunks(self, connector=None, http=None) -> list[RawChunk]:
        connector = connector or self._connector()
        http = http or self._http()
        return [c for req in self._requests() for c in connector.fetch(req, http)]

    def _obs_tables(self, connector, chunks: list[RawChunk]) -> list[pa.Table]:
        return [connector.normalize(c) for c in chunks if c.table == "observations"]

    def _licence_todos(self) -> list[str]:
        """Licence fields the scaffold left as TODO placeholders."""
        m = Manifest.load(connector_dir(self.connector_id, self.settings()) / "manifest.yaml")
        return [
            f for f in ("name", "url", "attribution") if "todo" in getattr(m.licence, f).lower()
        ]

    def _skip_while_todo(self) -> None:
        """While a licence TODO remains, the TODO check is the only failure: the rest skip."""
        if self._licence_todos():
            import pytest  # test-only dependency; imported here so the package imports without it

            pytest.skip("licence TODO remains; see test_licence_has_no_todo")

    # ---- the contract ------------------------------------------------------------------------

    def test_licence_has_no_todo(self):
        todo = self._licence_todos()
        assert not todo, f"licence TODO remains in {todo}: fill in name, url and attribution"

    def test_licence_url_is_real(self):
        self._skip_while_todo()
        m = Manifest.load(connector_dir(self.connector_id, self.settings()) / "manifest.yaml")
        problem = licence_url_problem(m.licence)
        assert problem is None, problem

    def test_manifest_valid(self):
        d = connector_dir(self.connector_id, self.settings())
        m = Manifest.load(d / "manifest.yaml")
        assert m.id == d.name == self.connector_id
        for f in ("name", "url", "attribution"):
            assert getattr(m.licence, f).strip(), f"licence.{f} is empty"
        if m.auth == "free_key":
            assert m.key_env, "free_key needs key_env"
        assert self._requests(), "fixtures/requests.yaml needs at least one request"

    def test_discover(self):
        self._skip_while_todo()
        c = self._connector()
        datasets = list(c.discover(self._http(), limit=self.discover_limit))
        assert datasets, "discover returned no datasets"
        for ds in datasets:
            assert ds.source_id == c.manifest.id
            assert ds.licence is not None
            assert ":" not in ds.dataset_id, f"':' in dataset id {ds.dataset_id!r}"
            for s in ds.series:
                assert ":" not in s.indicator_id, f"':' in indicator id {s.indicator_id!r}"

    def test_fetch_and_normalize(self):
        self._skip_while_todo()
        c = self._connector()
        http = self._http()
        rows = 0
        for req in self._requests():
            chunks = list(c.fetch(req, http))
            assert chunks, f"fetch returned no chunks for {req}"
            for chunk in chunks:
                validate_table(c.normalize(chunk), chunk.table)
                rows += c.normalize(chunk).num_rows
        assert rows >= 1, "no rows produced overall"

    def test_normalize_is_pure(self):
        self._skip_while_todo()
        chunks = self._chunks()
        fresh = self._connector()
        with mock.patch("socket.socket", _no_socket):
            first = [fresh.normalize(c) for c in chunks]
            second = [fresh.normalize(c) for c in chunks]
        for a, b in zip(first, second, strict=True):
            assert a.equals(b)

    def test_codes_mapped(self):
        self._skip_while_todo()
        c = self._connector()
        geos: list[str] = []
        for t in self._obs_tables(c, self._chunks(c)):
            geos += t["geo"].to_pylist()
        bad = sorted({g for g in geos if not is_valid_geo(g)})
        assert not bad, f"invalid geo codes: {bad[:10]}"
        if geos:
            share = sum(g.startswith("unmapped:") for g in geos) / len(geos)
            assert share <= self.max_unmapped, (
                f"unmapped share {share:.2%} > {self.max_unmapped:.0%}"
            )

    def test_series_ids(self):
        self._skip_while_todo()
        c = self._connector()
        for t in self._obs_tables(c, self._chunks(c)):
            for r in t.to_pylist():
                assert r["source_id"] == c.manifest.id
                assert ":" not in r["dataset_id"] and ":" not in r["indicator_id"]
                expect = f"{r['source_id']}:{r['dataset_id']}:{r['indicator_id']}:{r['geo']}"
                assert r["series_id"] == expect

    def test_no_secrets_in_fixtures(self):
        self._skip_while_todo()
        c = self._connector()
        secret = os.environ.get(c.manifest.key_env or "")
        for f in fixtures_dir(self.connector_id, self.settings()).rglob("*"):
            if not f.is_file():
                continue
            raw = f.read_bytes()
            text = raw.decode("utf-8", "replace")
            if secret and len(secret) >= 4:
                assert secret not in text, f"secret in {f.name}"
            for val in _KEY_PARAM.findall(text):
                assert val in ("", "REDACTED"), f"unredacted key in {f.name}"
