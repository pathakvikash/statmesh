"""`statmesh connector new <id> --kind sdmx|file|ckan|socrata|rest|custom`: writes a connector folder.

Goes to STATMESH_CONNECTORS_DIR if set, else the bundled connectors folder. The `file` kind ships a
working example on a synthetic fixture. The others pass `test_manifest_valid`; while any licence
field still says TODO the contract suite fails on `test_licence_has_no_todo` and skips the rest.
After the licence is filled in, the others need `statmesh connector record <id>` for fixtures.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import httpx

from statmesh.core.connector import BUNDLED_DIR
from statmesh.settings import Settings
from statmesh.testing.fixtures import fixture_key

KINDS = ("sdmx", "file", "ckan", "socrata", "rest", "custom")
_FILE_LIKE = ("file", "ckan", "socrata")  # kinds that read a mapping.yaml
_ENDPOINT = {"ckan": "https://example.org/api/3/action", "socrata": "https://example.org"}
_MANIFEST = """\
id: {id}
name: {id}  # TODO: human name
kind: {kind}
endpoint: {endpoint}  # TODO
licence:  # TODO: fill in from the provider's terms
  name: TODO licence
  url: https://example.org/TODO-terms  # TODO: the provider's licence page
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
_CKAN_EXTRA = """\
options:
  page_size: 100        # rows per request
  max_rows: 100000      # fetch cap when the request sets none
datasets:
  example: {}           # TODO: CKAN package name or id (optional: resource: <id or name>)
"""
_SOCRATA_EXTRA = """\
options:
  page_size: 1000       # rows per request
  max_rows: 100000      # fetch cap when the request sets none
datasets:
  example: {}           # TODO: Socrata 4x4 dataset id (optional: where: "<$where clause>")
"""
_EXTRA = {"file": _FILE_EXTRA, "ckan": _CKAN_EXTRA, "socrata": _SOCRATA_EXTRA}
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


_NEXT_KIND = {
    "sdmx": "set `endpoint`, `options` (agency, list_path, geo_dim...) and `core_datasets` in "
    "manifest.yaml",
    "file": "point `datasets.example.url` at the real file and map its columns in mapping.yaml",
    "ckan": "set `endpoint` (the CKAN action API root), the package under `datasets` and the "
    "columns in mapping.yaml",
    "socrata": "set `endpoint` (the portal domain), the 4x4 id under `datasets` and the columns "
    "in mapping.yaml",
    "rest": "write connector.py: discover, fetch and normalize (docs/connectors.md, level 3)",
    "custom": "write connector.py: discover, fetch and normalize (docs/connectors.md, level 3)",
}


def scaffold(cid: str, kind: str, root: Path) -> Path:
    if not re.fullmatch(r"[a-z][a-z0-9_]*", cid):
        raise ValueError(f"bad connector id {cid!r}: use ^[a-z][a-z0-9_]*$")
    d = root / cid
    if d.exists():
        raise FileExistsError(d)
    dataset = "example" if kind in _FILE_LIKE else "TODO"
    (d / "tests" / "fixtures").mkdir(parents=True)
    endpoint = _ENDPOINT.get(kind, f"https://example.org/{cid}")
    manifest = _MANIFEST.format(id=cid, kind=kind, dataset=dataset, endpoint=endpoint)
    manifest += _EXTRA.get(kind, "")
    if kind in _FILE_LIKE:
        (d / "mapping.yaml").write_text(_MAPPING)
    if kind == "file":
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


def next_steps(cid: str, kind: str, d: Path) -> str:
    return "\n".join([
        f"created {d}",
        "",
        "next steps:",
        f"  1. Fill in the licence block in {d}/manifest.yaml: name, url, attribution and",
        "     redistribute. Read the provider's terms first and keep `review` until you have",
        "     checked them. The contract suite fails while a licence TODO remains.",
        f"  2. {_NEXT_KIND[kind][0].upper()}{_NEXT_KIND[kind][1:]}.",
        f"  3. statmesh connector record {cid}     # live fetch, writes tests/fixtures (needs network)",
        f"  4. statmesh connector test {cid}       # offline suite; file kind passes after step 1",
        "  5. Open a PR with .github/PULL_REQUEST_TEMPLATE.md filled in.",
        "",
        "Guide: docs/first-connector.md (file kind), docs/connectors.md (all kinds).",
    ])  # fmt: skip


def new_cmd(args) -> int | None:
    root = Settings.from_env().connectors_dir or BUNDLED_DIR
    d = scaffold(args.id, args.kind, Path(root))
    print(next_steps(args.id, args.kind, d))
