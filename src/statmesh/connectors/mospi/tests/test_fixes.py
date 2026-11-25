import sys
from datetime import UTC, date, datetime

import httpx

from statmesh.core.connector import load_connector
from statmesh.core.http import HttpClient
from statmesh.core.models import FetchRequest, RateLimit
from statmesh.settings import Settings
from statmesh.testing.fixtures import replay_http


def _rows(req):
    s = Settings.from_env()
    c = load_connector("mospi", s)
    http = replay_http("mospi", s)
    return [r for ch in c.fetch(req, http) for r in c.normalize(ch).to_pylist()]


def test_gwh_rows_get_gwh_unit_other_rows_keep_pj():
    req = FetchRequest("energy_consumption", indicator_ids=("pj",),
                       filters={"year": "2023-24", "limit": "20"}, max_rows=20)  # fmt: skip
    rows = _rows(req)
    gwh = {
        r["unit"] for r in rows if any(k == "end_use_sector" and "GWh" in v for k, v in r["dims"])
    }
    assert gwh == {"GWh"} and {r["unit"] for r in rows} == {"GWh", "PJ"}
    assert {r["indicator_id"] for r in rows} == {"pj"}


def test_series_id_with_values_suffix_is_accepted():
    req = FetchRequest("nas_state_annual", indicator_ids=("gsdp_current", "gsdp_constant"),
                       filters={"year": "2023-24", "limit": "20"}, max_rows=20)  # fmt: skip
    assert {r["indicator_id"] for r in _rows(req)} >= {"gsdp_current"}


def test_hces_sends_a_year_default_and_maps_start():
    seen = []

    def handler(r):
        seen.append(r.url.params.get("year"))
        return httpx.Response(200, json={"data": [], "meta_data": {"totalPages": 1}})

    s = Settings.from_env()
    c = load_connector("mospi", s)
    m = c.manifest.model_copy(update={"rate_limit": RateLimit()})
    h = HttpClient(m, s, None, transport=httpx.MockTransport(handler))
    for req in (FetchRequest("hces", indicator_ids=("mpce",)),
                FetchRequest("hces", indicator_ids=("mpce",), start=date(2022, 6, 1)),
                FetchRequest("hces", indicator_ids=("mpce",), start=date(2023, 2, 1)),
                FetchRequest("hces", indicator_ids=("mpce",), filters={"year": "2022-23"})):  # fmt: skip
        list(c.fetch(req, h))
    assert seen == ["2023-24", "2022-23", "2022-23", "2022-23"]


def _chunk(ds, ind, body):
    import json

    from statmesh.core.models import RawChunk

    return RawChunk(source_id="mospi", dataset_id=ds, content=json.dumps(body).encode(),
                    media_type="application/json", url="u", params={},
                    retrieved_at=datetime.now(UTC), meta={"indicator": ind})  # fmt: skip


def _recording_http(seen):
    def handler(r):
        seen.append(r.url.params.get("year"))
        return httpx.Response(200, json={"data": [], "meta_data": {"totalPages": 1}})

    s = Settings.from_env()
    c = load_connector("mospi", s)
    m = c.manifest.model_copy(update={"rate_limit": RateLimit()})
    return c, HttpClient(m, s, None, transport=httpx.MockTransport(handler))


def test_isp_default_year_is_current_fy_and_ranges_span_fy_boundaries(monkeypatch):
    seen: list = []
    c, h = _recording_http(seen)
    mod = sys.modules[type(c).__module__]  # the loaded connector module, not the import path

    def freeze(*ymdh):
        class Frozen(datetime):
            @classmethod
            def now(cls, tz=None):
                return cls(*ymdh, tzinfo=tz)

        monkeypatch.setattr(mod, "datetime", Frozen)

    freeze(2026, 11, 26)
    list(c.fetch(FetchRequest("isp_annual"), h))
    list(c.fetch(FetchRequest("isp_monthly", start=date(2026, 2, 1), end=date(2026, 5, 1)), h))
    list(c.fetch(FetchRequest("hces", indicator_ids=("mpce",)), h))
    assert seen == ["2026-27", "2025-26", "2026-27", "2023-24"]
    freeze(2027, 3, 31, 20)  # 20:00 UTC is already April 1 in IST
    seen.clear()
    list(c.fetch(FetchRequest("isp_annual"), h))
    assert seen == ["2027-28"]


def test_misspelt_chhattisgarh_maps_to_state_and_asuse_year_is_calendar():
    c = load_connector("mospi", Settings.from_env())
    body = {
        "data": [{"survey_period": "July 2014 - June 2015", "state": "Chhatisgarh", "value": "1"}]
    }
    ch = _chunk("nss72t_tourism", "overnight_trips", body)
    assert c.normalize(ch).to_pylist()[0]["geo"] == "IN-CG"


def test_percent_units_for_tus_and_gender_literacy():
    c = load_connector("mospi", Settings.from_env())

    def unit(ds, ind, row):
        return c.normalize(_chunk(ds, ind, {"data": [row]})).to_pylist()[0]["unit"]

    base = {"year": "2024", "state": "All India", "value": "1"}
    assert unit("tus", "pct_major", {**base, "unit": "%"}) == "percent"
    assert unit("tus", "min_person_major", {**base, "unit": "mins"}) == "mins"
    g = {"year": "2019", "state/UT": "All India", "value": "1", "unit": "-"}
    assert {unit("gender_stats", i, g) for i in ("literacy", "lfpr_15plus", "ur_15plus")} == {
        "percent"
    }
