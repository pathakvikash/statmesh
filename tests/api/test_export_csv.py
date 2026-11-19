import csv
import io
from datetime import UTC, date, datetime, timedelta

import pyarrow as pa
from tests.api.test_api import build

from statmesh import service
from statmesh.core.schema import OBS_SCHEMA
from statmesh.core.storage import Storage

TS = datetime(2026, 1, 1, tzinfo=UTC)
GEOS = [
    "AFG",
    "ALB",
    "DZA",
    "AGO",
    "ARG",
    "ARM",
    "AUS",
    "AUT",
    "AZE",
    "BHS",
    "BHR",
    "BGD",
    "BLR",
    "BEL",
    "BLZ",
    "BEN",
    "BTN",
    "BOL",
    "BIH",
    "BWA",
    "BRA",
    "BRN",
    "BGR",
    "BFA",
    "BDI",
]
URL = "/series/open:D:UNEMP/observations.csv"


def big(n_per_geo=1000, status="ok"):
    rows = [{
        "series_id": f"open:D:UNEMP:{g}", "source_id": "open", "dataset_id": "D",
        "indicator_id": "UNEMP", "geo": g, "period_start": date(2000, 1, 1) + timedelta(i),
        "period_end": date(2000, 1, 1) + timedelta(i), "freq": "D", "value": float(i),
        "unit": "pct", "unit_mult": 0, "dims": [], "obs_status": status, "retrieved_at": TS,
        "vintage": None,
    } for g in GEOS for i in range(n_per_geo)]  # fmt: skip
    return pa.Table.from_pylist(rows, schema=OBS_SCHEMA)


def load(tmp_path, tbl, **kw):
    c = build(tmp_path, **kw)
    st = Storage(tmp_path)
    with st.update_manifest() as m:
        m["obs"]["open/D"] = st.write_parts(tbl, "obs/open/D", "r2")
    return c


def test_25k_rows_multi_geo(tmp_path):
    with load(tmp_path, big()) as c:
        r = c.get(URL)
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
        assert r.headers["x-statmesh-attribution"] == "Open Org"
        assert 'filename="open_D_UNEMP.csv"' in r.headers["content-disposition"]
        assert len(r.text.splitlines()) == 25_001
        rows = list(csv.DictReader(io.StringIO(r.text)))
        assert {x["geo"] for x in rows} == set(GEOS) and rows[0]["period_start"] == "2000-01-01"
        one = c.get("/series/open:D:UNEMP:ALB/observations.csv").text.splitlines()
        assert len(one) == 1001
        assert len(c.get(URL, params={"geo": "ALB"}).text.splitlines()) == 1001


def test_formula_escape(tmp_path):
    with load(tmp_path, big(1, status="=1+1")) as c:
        assert "'=1+1" in c.get(URL).text


def test_cap_and_errors(tmp_path):
    with load(tmp_path, big(), export_max_rows=12_345) as c:
        assert len(c.get(URL).text.splitlines()) == 12_346
        assert c.get("/series/open:D:NOPE/observations.csv").status_code == 404
        assert c.get("/series/open:D/observations.csv").status_code == 404
        assert c.get(URL, params={"geo": "ZZZ"}).status_code == 400
        assert c.get(URL, params={"filter": "nope=1"}).status_code == 400
        assert c.get(URL, headers={"host": "evil.example"}).status_code == 421


def test_hosted_licence(tmp_path):
    with build(tmp_path, mode="hosted") as c:
        assert c.get("/series/closed:D:UNEMP/observations.csv").status_code == 403
        assert len(c.get(URL).text.splitlines()) == 3  # header + the 2 open rows


def test_open_stream_does_not_block_queries(tmp_path):
    with load(tmp_path, big()):
        s = service.stream_observations("open:D:UNEMP")
        first = next(s.batches)
        assert len(first) == 5000
        assert service.run_sql("SELECT count(*) AS n FROM observations").rows == [
            [25_002]
        ]  # + 2 rows of the `closed` source
        assert sum(len(b) for b in s.batches) == 20_000


def test_row_cap_header_and_non_latin1_filename(tmp_path):
    with load(tmp_path, big(1), export_max_rows=7) as c:
        r = c.get(URL)
        assert r.headers["x-statmesh-row-cap"] == "7" and len(r.text.splitlines()) == 8
        assert "x-statmesh-row-cap" not in c.get("/series/open:D:NOPE/observations.csv").headers
        r = c.get("/series/open:D:UNł中/observations.csv")  # not found, but must not 500
        assert r.status_code == 404


def test_non_latin1_id_in_filename_does_not_500(tmp_path, monkeypatch):
    with load(tmp_path, big(1)) as c:
        stub = service.ObservationsStream("x", ["a"], iter([[[1]]]), None)
        monkeypatch.setattr(service, "stream_observations", lambda *a, **k: stub)
        r = c.get("/series/open:D:\u0142\u4e2d/observations.csv")
        assert r.status_code == 200 and 'filename="open_D_.csv"' in r.headers["content-disposition"]
