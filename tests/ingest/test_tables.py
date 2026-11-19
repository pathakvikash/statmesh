"""Entity tables: per-dataset part directories, the per-dataset lock, inferred xref links."""

import fcntl
import json
from datetime import UTC, datetime

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from statmesh.core.catalog import Catalog
from statmesh.core.models import DatasetMeta, Manifest, RawChunk
from statmesh.core.schema import ENTITIES_SCHEMA, XREF_SCHEMA
from statmesh.core.storage import Storage
from statmesh.ingest.runner import DatasetBusy, ingest
from statmesh.settings import Settings

T0 = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)
LIC = {"name": "n", "url": "u", "redistribute": "yes", "attribution": "a"}


class EntConn:
    """Body = JSON list. Dataset 'recs' -> entities rows [id, name, country, attrs]; any other
    dataset -> entity_xref rows [from, to]."""

    def __init__(self, source, body):
        self.manifest = Manifest.model_validate({"id": source, "name": source, "kind": "custom",
                                                 "licence": LIC})  # fmt: skip
        self.body = body

    def discover(self, http, limit=None):
        for d in ("recs", "isins", "parent"):
            yield DatasetMeta(self.manifest.id, d, d, self.manifest.licence)

    def fetch(self, req, http):
        table = "entities" if req.dataset_id == "recs" else "entity_xref"
        yield RawChunk(self.manifest.id, req.dataset_id, json.dumps(self.body).encode(),
                       "application/json", "u", {}, T0, table)  # fmt: skip

    def normalize(self, chunk):
        sid, rows = chunk.source_id, json.loads(chunk.content)
        if chunk.table == "entities":
            return pa.Table.from_pylist(
                [{"entity_id": i, "source_id": sid, "name": n, "country": c, "industry_code": None,
                  "industry_scheme": None, "address": None, "attrs": a, "retrieved_at": T0}
                 for i, n, c, a in rows], schema=ENTITIES_SCHEMA)  # fmt: skip
        return pa.Table.from_pylist(
            [{"from_id": a, "to_id": b, "source_id": sid, "confidence": 1.0, "inferred": False,
              "retrieved_at": T0} for a, b in rows], schema=XREF_SCHEMA)  # fmt: skip


@pytest.fixture
def env(tmp_path):
    s = Settings(data_dir=tmp_path / "data")
    cat = Catalog(tmp_path / "data" / "catalog.sqlite")
    yield s, cat
    cat.close()


def run(env, source, ds, body, **kw):
    s, cat = env
    return ingest(source, ds, s, cat, http=object(), connector=EntConn(source, body), **kw)


def xrefs(env, only_inferred=None):
    st = Storage(env[0].data_dir)
    rows = [r for p in st.read_manifest()["tables"].get("entity_xref", [])
            for r in pq.read_table(st.abs(p)).to_pylist()]  # fmt: skip
    return {(r["from_id"], r["to_id"], r["source_id"]) for r in rows
            if only_inferred is None or r["inferred"] == only_inferred}  # fmt: skip


def test_reprocessing_one_dataset_keeps_its_siblings(env):
    run(env, "gleif", "isins", [["lei:A", "isin:1"]])
    run(env, "gleif", "parent", [["lei:A", "lei:P"]])
    run(env, "gleif", "isins", [["lei:A", "isin:2"]])
    run(env, "gleif", "isins", [], reprocess=True)  # replays the stored chunks: isin:1 + isin:2
    assert xrefs(env, False) == {("lei:A", "lei:P", "gleif"), ("lei:A", "isin:2", "gleif")} | {
        ("lei:A", "isin:1", "gleif")
    }
    parts = Storage(env[0].data_dir).read_manifest()["tables"]["entity_xref"]
    assert any("/gleif/parent/" in p for p in parts) and any("/gleif/isins/" in p for p in parts)


def test_second_ingest_of_same_dataset_is_busy(env):
    st = Storage(env[0].data_dir)
    (st.root / "locks").mkdir(parents=True)
    with open(st.root / "locks" / "gleif__isins.lock", "a+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)  # another process holds it
        with pytest.raises(DatasetBusy, match="already being ingested"):
            run(env, "gleif", "isins", [["lei:A", "isin:1"]])
        run(env, "gleif", "parent", [["lei:A", "lei:P"]])  # other datasets are unaffected
    run(env, "gleif", "isins", [["lei:A", "isin:1"]])  # released


def test_inferred_links_follow_entity_ingests(env):
    sec = [["cik:1", "Foo Inc", "USA", {"state": "CA"}]]
    lei = [["lei:A", "FOO INC", "USA", {"state": "CA"}]]
    run(env, "sec_edgar", "recs", sec)
    assert xrefs(env) == set()
    run(env, "gleif", "recs", lei)
    assert xrefs(env, True) == {
        ("cik:1", "lei:A", "gleif")
    }  # source 'gleif': hosted mode serves it
    run(env, "gleif", "isins", [["lei:A", "isin:1"]])  # a sibling xref dataset keeps the links
    run(env, "gleif", "isins", [], reprocess=True)
    assert ("cik:1", "lei:A", "gleif") in xrefs(env, True) and len(xrefs(env)) == 2
    run(env, "gleif", "recs", [["lei:A", "Other Corp", "USA", {}]])  # the LEI was renamed
    assert xrefs(env, True) == set()


def test_uk_registered_as_exact_match(env):
    uk = [["uk:445790", "TESCO PLC", "GBR", {}], ["uk:SC1", "Foo Ltd", "GBR", {}]]
    lei = [["lei:T", "Tesco Stores Holdings", "GBR", {"registered_as": "00445790"}],
           ["lei:F", "FOO LIMITED", "GBR", {"postcode": "EH1 1AA"}]]  # fmt: skip
    run(env, "uk_companies_house", "recs", uk)
    run(env, "gleif", "recs", lei)
    assert xrefs(env, True) == {("uk:445790", "lei:T", "gleif"), ("uk:SC1", "lei:F", "gleif")}


def _legacy(env, rows):
    st = Storage(env[0].data_dir)
    old = pa.Table.from_pylist([{"from_id": a, "to_id": b, "source_id": "gleif", "confidence": 1.0,
                                 "inferred": False, "retrieved_at": T0} for a, b in rows],
                               schema=XREF_SCHEMA)  # fmt: skip
    with st.update_manifest() as m:
        m["tables"]["entity_xref"] = st.write_parts(old, "tables/entity_xref/gleif", "old")
    return st


def _live(st):
    parts = st.read_manifest()["tables"]["entity_xref"]
    return sorted((r["from_id"], r["to_id"]) for p in parts
                  for r in pq.read_table(st.abs(p)).to_pylist())  # fmt: skip


A_ISIN, A_PAR = ("lei:A", "isin:1"), ("lei:A", "lei:P")


def test_legacy_flat_rows_move_to_their_owner_and_are_never_live_twice(env):
    st = _legacy(env, [A_ISIN, A_PAR])
    run(env, "gleif", "isins", [list(A_ISIN)])
    assert _live(st) == [A_ISIN, A_PAR]  # isins row moved; parent row still legacy-live
    run(env, "gleif", "parent", [list(A_PAR)])
    assert _live(st) == [A_ISIN, A_PAR]  # not duplicated by the second dataset
    parts = st.read_manifest()["tables"]["entity_xref"]
    assert all(st.abs(p).parent.name != "gleif" for p in parts)  # legacy set emptied


def test_reprocess_does_not_lose_another_datasets_legacy_rows(env):
    st = _legacy(env, [A_ISIN, A_PAR])
    run(env, "gleif", "isins", [list(A_ISIN)])
    run(env, "gleif", "isins", [], reprocess=True)
    assert _live(st) == [A_ISIN, A_PAR]
    run(env, "gleif", "parent", [], reprocess=True)  # no stored chunks: touches nothing
    assert _live(st) == [A_ISIN, A_PAR]
