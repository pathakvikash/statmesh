from datetime import date

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
