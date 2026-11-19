"""`statmesh connector new <id> --kind sdmx|file|rest|custom`: writes a connector folder.

Goes to STATMESH_CONNECTORS_DIR if set, else the bundled connectors folder. The `file` kind ships a
working example on a synthetic fixture; the others pass `test_manifest_valid` and need
`statmesh connector record <id>` (after filling in the TODOs) before the rest of the suite passes.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import httpx

from statmesh.core.connector import BUNDLED_DIR
from statmesh.settings import Settings
from statmesh.testing.fixtures import fixture_key

_MANIFEST = """\
id: {id}
name: {id}  # TODO: human name
kind: {kind}
endpoint: https://example.org/{id}  # TODO
licence:  # TODO: fill in from the provider's terms
  name: TODO licence
  url: https://example.org/terms
  redistribute: review
  attribution: "Source: TODO"
rate_limit:
  per_second: 1
core_datasets: [{dataset}]
"""
_FILE_EXTRA = """\
datasets:
  example: {url: https://example.org/example.csv}
"""
_MAPPING = """\
datasets:
  example:
    title: Example
    geo: country
    geo_scheme: iso3
    period: year
    value: value
    indicator_id: example
    unit: percent
"""
_CONNECTOR = """\
from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

import pyarrow as pa

from statmesh.core.http import HttpClient
from statmesh.core.models import DatasetMeta, FetchRequest, Manifest, RawChunk


class Connector:
    def __init__(self, manifest: Manifest, directory: Path):
        self.manifest = manifest
        self.dir = directory

    def discover(self, http: HttpClient, limit: int | None = None) -> Iterable[DatasetMeta]:
        raise NotImplementedError  # TODO: http.get(...) -> DatasetMeta(...)

    def fetch(self, req: FetchRequest, http: HttpClient) -> Iterable[RawChunk]:
        raise NotImplementedError  # TODO: http.get(...) -> RawChunk(...)

    def normalize(self, chunk: RawChunk) -> pa.Table:
        raise NotImplementedError  # TODO: pure; return a table matching OBS_SCHEMA
"""
_CONTRACT = """\
from statmesh.testing.contract import ContractSuite


class TestContract(ContractSuite):
    connector_id = "{id}"
"""
_SMOKE = """\
import pytest

from statmesh.core.schema import validate_table
from statmesh.settings import Settings


@pytest.mark.live
@pytest.mark.enable_socket
def test_live_fetch_and_normalize():
    from statmesh.core.connector import load_connector
    from statmesh.core.http import HttpClient
    from statmesh.testing.fixtures import fixtures_dir, load_requests

    s = Settings.from_env()
    c = load_connector("{id}", s)
    http = HttpClient(c.manifest, s)
    if c.manifest.auth == "free_key" and not http.key:
        pytest.skip("API key not set")
    req = load_requests(fixtures_dir("{id}", s))[0]
    chunk = next(iter(c.fetch(req, http)))
    validate_table(c.normalize(chunk), chunk.table)
"""
_CSV = b"country,year,value\nIND,2020,1.5\nBGD,2020,2.5\nVNM,2021,3.5\n"
_ROBOTS = b"User-agent: *\nAllow: /\n"


def write_fixture(fixtures: Path, url: str, body: bytes, content_type: str) -> None:
    """Write a synthetic replay fixture for GET `url`."""
    sha, desc = fixture_key(httpx.Request("GET", url))
    d = fixtures / "http"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{sha}.body").write_bytes(body)
    meta = {**desc, "status": 200, "headers": {"content-type": content_type},
            "body": f"{sha}.body", "synthetic": True}  # fmt: skip
    (d / f"{sha}.json").write_text(json.dumps(meta, indent=1, sort_keys=True))


def scaffold(cid: str, kind: str, root: Path) -> Path:
    if not re.fullmatch(r"[a-z][a-z0-9_]*", cid):
        raise ValueError(f"bad connector id {cid!r}: use ^[a-z][a-z0-9_]*$")
    d = root / cid
    if d.exists():
        raise FileExistsError(d)
    dataset = "example" if kind == "file" else "TODO"
    (d / "tests" / "fixtures").mkdir(parents=True)
    manifest = _MANIFEST.format(id=cid, kind=kind, dataset=dataset)
    if kind == "file":
        manifest += _FILE_EXTRA
        (d / "mapping.yaml").write_text(_MAPPING)
        fx = d / "tests" / "fixtures"
        write_fixture(fx, "https://example.org/robots.txt", _ROBOTS, "text/plain")
        write_fixture(fx, "https://example.org/example.csv", _CSV, "text/csv")
    elif kind in ("rest", "custom"):
        (d / "connector.py").write_text(_CONNECTOR)
    (d / "manifest.yaml").write_text(manifest)
    (d / "tests" / "fixtures" / "requests.yaml").write_text(f"- dataset_id: {dataset}\n")
    (d / "tests" / "test_contract.py").write_text(_CONTRACT.format(id=cid))
    (d / "tests" / "test_smoke.py").write_text(_SMOKE.format(id=cid))
    return d


def new_cmd(args) -> int | None:
    root = Settings.from_env().connectors_dir or BUNDLED_DIR
    print(f"created {scaffold(args.id, args.kind, Path(root))}")
