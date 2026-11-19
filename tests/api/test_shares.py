import json
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from statmesh import service
from statmesh.api.app import create_app
from statmesh.core.catalog import Catalog
from statmesh.core.models import DatasetMeta, Licence, Manifest, SeriesMeta
from statmesh.settings import Settings

YES = Licence(name="CC BY", url="https://cc", redistribute="yes", attribution="Open Org")
NO = Licence(name="Closed", url="https://c", redistribute="no", attribution="Closed Org")


def build(tmp_path, **kw):
    cat = Catalog(tmp_path / "catalog.sqlite")
    for sid, lic in (("open", YES), ("closed", NO)):
        cat.upsert_source(Manifest(id=sid, name=sid.title(), kind="custom", licence=lic))
        meta = DatasetMeta(sid, "D", f"{sid} data", lic, source_url=f"https://{sid}.example",
                           series=(SeriesMeta("UNEMP", "Unemployment", freq="A", unit="pct",
                                              geos=("IND",)),))  # fmt: skip
        cat.upsert_discovery(sid, [meta], core=[])
        cat.set_dataset_status(sid, "D", "remote")
    cat.close()
    kw.setdefault("allowed_hosts", ("testserver",))
    service.configure(Settings(data_dir=tmp_path, **kw))
    return TestClient(create_app())


def events(*ids, text="Unemployment fell."):
    ev = [{"t": "text", "text": text}]
    for i, sid in enumerate(ids):
        ev += [{"t": "call", "id": f"c{i}", "name": "describe_series", "input": {"series_id": sid}},
               {"t": "result", "id": f"c{i}", "name": "describe_series",
                "output": {"series_id": sid, "title": "secret rows", "value": 7.7}}]  # fmt: skip
    return ev


def make(c, ev, **extra):
    return c.post("/shares", json={"question": "How is unemployment?", "events": ev, **extra})


def test_create_then_get_roundtrip(tmp_path):
    c = build(tmp_path)
    ev = events("open:D:UNEMP")
    r = make(c, ev, config={"apiKey": "x", "model": "m"})  # unknown fields are dropped
    assert r.status_code == 200 and len(r.json()["id"]) == 12
    s = c.get(f"/shares/{r.json()['id']}").json()
    assert s["question"] == "How is unemployment?" and s["events"] == ev
    assert "config" not in s and "apiKey" not in json.dumps(s)
    assert [x["source_id"] for x in s["citations"]] == ["open"] and s["unavailable"] == []
    assert s["created_at"].endswith("Z")


def test_oversize_413_and_keylike_400(tmp_path):
    c = build(tmp_path, share_max_bytes=2000)
    assert make(c, events("open:D:UNEMP", text="x" * 3000)).status_code == 413
    for key in (
        "sk-ant-api03-abcdefghijklmnop1234",
        "Authorization: Bearer abcdefghijklmnopqrstuvwx",
    ):
        assert make(c, events("open:D:UNEMP", text=f"my key {key}")).status_code == 400
    ev = events("open:D:UNEMP")
    ev[2]["output"]["note"] = "AIza" + "a" * 35  # also inside tool results
    assert make(c, ev).status_code == 400
    assert c.post("/shares", json={"question": "q", "events": [{"t": "weird"}]}).status_code == 400
    assert c.post("/shares", content=b"not json").status_code == 400


def test_expired_404_and_purged_on_insert(tmp_path):
    c = build(tmp_path, share_ttl_days=30)
    st = service._engine().settings
    from statmesh import shares

    old = shares.create(
        st,
        json.dumps({"question": "q", "events": events()}).encode(),
        now=datetime.now(UTC) - timedelta(days=31),
    )
    fresh = make(c, events()).json()["id"]  # this insert deletes the expired row
    assert c.get(f"/shares/{old}").status_code == 404
    assert c.get(f"/shares/{fresh}").status_code == 200
    with shares._connect(st) as db:
        assert db.execute("SELECT count(*) FROM shares").fetchone()[0] == 1
    with pytest.raises(KeyError):
        shares.get(st, fresh, now=datetime.now(UTC) + timedelta(days=31))


def test_disabled_404(tmp_path):
    c = build(tmp_path)
    sid = make(c, events()).json()["id"]
    c = build(tmp_path, shares_enabled=False)
    assert make(c, events()).status_code == 404
    assert c.get(f"/shares/{sid}").status_code == 404
    assert build(tmp_path).get("/shares/not-an-id").status_code == 404


def test_hosted_rebuilds_citations_from_servable_series_only(tmp_path):
    ev = events("open:D:UNEMP", "closed:D:UNEMP", "open:D:GONE")
    sid = make(build(tmp_path), ev).json()["id"]
    s = build(tmp_path, mode="hosted").get(f"/shares/{sid}").json()
    assert s["events"][0]["text"] == "Unemployment fell."  # stored text still renders
    assert [c["source_id"] for c in s["citations"]] == ["open"]
    assert s["unavailable"] == ["closed:D:UNEMP", "open:D:GONE"]
    outs = {e["id"]: e["output"] for e in s["events"] if e["t"] == "result"}
    assert outs["c0"]["value"] == 7.7 and outs["c1"] == outs["c2"] == {"unavailable": True}
    # self-host serves the closed series too
    s = build(tmp_path).get(f"/shares/{sid}").json()
    assert sorted(c["source_id"] for c in s["citations"]) == ["closed", "open"]


def test_non_string_event_type_is_400(tmp_path):
    c = build(tmp_path)
    for t in ([], {}, 5, None):
        assert c.post("/shares", json={"question": "q", "events": [{"t": t}]}).status_code == 400


def test_rebuild_is_fast_on_crafted_payload():
    import time

    from statmesh import shares

    results = [
        {
            "t": "result",
            "id": str(i),
            "name": "n",
            "output": {"series_id": f"x:y:z{i % 3000}", "d": "p" * 200},
        }
        for i in range(5000)
    ]
    t0 = time.monotonic()
    cites, gone, out = shares.rebuild(results)
    assert time.monotonic() - t0 < 1.0
    assert cites == [] and len(gone) <= shares.MAX_IDS
    assert all(e["output"] == shares.UNAVAILABLE for e in out)
