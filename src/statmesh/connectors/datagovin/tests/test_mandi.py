from statmesh.core.connector import load_connector
from statmesh.core.models import FetchRequest
from statmesh.settings import Settings
from statmesh.testing.fixtures import replay_http

RID = "9ef84268-d588-465a-a308-a864a43d0070"


def test_mandi_normalizes_min_max_modal_by_state():
    s = Settings.from_env()
    c = load_connector("datagovin", s)
    rows = []
    for ch in c.fetch(FetchRequest(RID, max_rows=20), replay_http("datagovin", s)):
        rows += c.normalize(ch).to_pylist()
    assert len(rows) == 24  # 8 records x 3 indicators
    assert {r["indicator_id"] for r in rows} == {"price_min", "price_max", "price_modal"}
    assert {r["unit"] for r in rows} == {"INR per quintal"} and {r["freq"] for r in rows} == {"D"}
    geos = {r["geo"] for r in rows}
    assert {"IN-BR", "IN-UK", "IN-DL", "IN-MH"} <= geos and not any(
        g.startswith("unmapped") for g in geos
    )
    pune = next(r for r in rows if r["indicator_id"] == "price_modal" and r["geo"] == "IN-MH")
    assert pune["value"] == 2200.0 and str(pune["period_start"]) == "2026-11-26"
    assert ("commodity", "Onion") in pune["dims"] and ("market", "Pune") in pune["dims"]
    na = [r for r in rows if r["value"] is None]
    assert len(na) == 1 and na[0]["obs_status"] == "missing"  # "NA" modal price


def test_bad_arrival_date_skips_row_not_chunk(caplog):
    import json
    from datetime import UTC, datetime

    import pytest

    from statmesh.core.models import RawChunk

    c = load_connector("datagovin", Settings.from_env())
    rec = {"state": "Bihar", "arrival_date": "26/11/2026", "min_price": "1", "max_price": "2",
           "modal_price": "3"}  # fmt: skip

    def chunk(*dates):
        body = json.dumps({"records": [{**rec, "arrival_date": d} for d in dates]}).encode()
        return RawChunk("datagovin", RID, body, "application/json", "u", {}, datetime.now(UTC))

    t = c.normalize(chunk("26/11/2026", "", "garbage"))
    assert t.num_rows == 3 and "skipped 2 of 3" in caplog.text  # one good row x 3 indicators
    with pytest.raises(ValueError, match="every row"):
        c.normalize(chunk("", "x"))
