import json
import logging
import sqlite3

from fastapi import FastAPI
from fastapi.testclient import TestClient

from statmesh.api import ops
from statmesh.core.catalog import SCHEMA
from statmesh.settings import Settings


def app_client():
    app = FastAPI()

    @app.get("/x")
    def x():
        return {"ok": 1}

    app.add_middleware(ops.RequestContextMiddleware)
    return TestClient(app)


def test_request_id_propagates_and_bad_ids_replaced():
    c = app_client()
    r = c.get("/x", headers={"X-Request-ID": "abc-123_XYZ.9"})
    assert r.headers["x-request-id"] == "abc-123_XYZ.9"
    assert r.headers["server-timing"].startswith("app;dur=")
    for bad in ("short", "has space in it!", "x" * 65):
        got = c.get("/x", headers={"X-Request-ID": bad}).headers["x-request-id"]
        assert got != bad and len(got) == 32
    assert c.get("/x").headers["x-request-id"]


def test_log_has_no_query_string(caplog):
    c = app_client()
    with caplog.at_level(logging.INFO, logger="statmesh.access"):
        c.get("/x?q=secret-user-text", headers={"Authorization": "Bearer tok"})
    (rec,) = [r for r in caplog.records if r.name == "statmesh.access"]
    d = json.loads(rec.getMessage())
    assert d["path"] == "/x" and d["status"] == 200 and d["method"] == "GET"
    assert set(d) == {"ts", "request_id", "method", "path", "status", "duration_ms"}
    assert "secret" not in rec.getMessage() and "tok" not in rec.getMessage()


def test_readiness(tmp_path):
    s = Settings(data_dir=tmp_path)
    assert ops.readiness(s)[0] is False  # no file
    db = sqlite3.connect(tmp_path / "catalog.sqlite")
    db.executescript(SCHEMA)
    db.commit()
    ok, d = ops.readiness(s)
    assert not ok and d["catalog"] == "empty"
    db.execute(
        "INSERT INTO sources VALUES ('a','A','k',NULL,'keyless',NULL,0,'n','u','yes','at',1,'{}',NULL)"
    )
    db.commit()
    db.close()
    assert ops.readiness(s)[0] is True
    app = FastAPI()
    app.include_router(ops.readyz_router(lambda: s))
    r = TestClient(app).get("/readyz")
    assert r.status_code == 200 and r.json()["sources"] == 1
    assert r.json()["build"] == "unknown"
    bad = Settings(data_dir=tmp_path / "nope")
    app2 = FastAPI()
    app2.include_router(ops.readyz_router(lambda: bad))
    assert TestClient(app2).get("/readyz").status_code == 503


def test_readyz_reports_build(tmp_path, monkeypatch):
    monkeypatch.setenv("STATMESH_VCS_REF", "abc123")
    app = FastAPI()
    app.include_router(ops.readyz_router(lambda: Settings(data_dir=tmp_path / "nope")))
    assert TestClient(app).get("/readyz").json()["build"] == "abc123"


def test_configure_logging_idempotent():
    log = logging.getLogger("statmesh")
    before = list(log.handlers)
    try:
        ops.configure_logging("WARNING")
        ops.configure_logging("INFO")
        mine = [h for h in log.handlers if getattr(h, "_statmesh_json", False)]
        assert len(mine) == 1 and log.level == logging.INFO
    finally:
        log.handlers[:] = before
