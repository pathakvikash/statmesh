import csv
from datetime import date
from importlib import resources

from statmesh.core.models import FetchRequest
from statmesh.testing.contract import ContractSuite


class TestContract(ContractSuite):
    connector_id = "comtrade"

    def _http(self):
        http = super()._http()
        http.key = None  # fixtures are the keyless preview, even if the dev has a key in env
        return http


def _hs2() -> set[str]:
    text = resources.files("statmesh.data").joinpath("hs/hs2.csv").read_text(encoding="utf-8")
    return {r["code"] for r in csv.DictReader(text.splitlines())}


def test_q2_india_to_us_by_chapter():
    t = TestContract()
    c, http = t._connector(), t._http()
    rows = []
    for y in (2019, 2024):
        req = FetchRequest("HS-A", ("X",), ("IND",), date(y, 1, 1), date(y, 12, 31),
                           {"partner": "USA", "hs": "AG2"})  # fmt: skip
        for chunk in c.fetch(req, http):
            rows += c.normalize(chunk).to_pylist()
    assert {r["geo"] for r in rows} == {"IND"}
    assert {dict(r["dims"])["partner"] for r in rows} == {"USA"}
    assert {r["period_start"].year for r in rows} == {2019, 2024}
    assert {r["unit"] for r in rows} == {"USD"}
    hs = {dict(r["dims"])["hs"] for r in rows}
    assert hs <= _hs2(), sorted(hs - _hs2())
    assert {dict(r["dims"])["hs_level"] for r in rows} == {"2"}
    assert all(r["value"] is not None for r in rows)


def test_request_pins_mot_customs_partner2_and_world_partner_is_region_wld():
    import json
    from dataclasses import replace

    t = TestContract()
    c, http = t._connector(), t._http()
    req = FetchRequest("HS-A", ("X",), ("IND",), date(2024, 1, 1), date(2024, 12, 31),
                       {"partner": "USA", "hs": "AG2"})  # fmt: skip
    chunk = next(iter(c.fetch(req, http)))
    assert {k: chunk.params[k] for k in ("motCode", "customsCode", "partner2Code")} == {
        "motCode": "0", "customsCode": "C00", "partner2Code": "0",
    }  # fmt: skip
    doc = json.loads(chunk.content)
    for r in doc["data"]:
        r["partnerCode"] = 0
    rows = c.normalize(replace(chunk, content=json.dumps(doc).encode())).to_pylist()
    assert rows and {dict(r["dims"])["partner"] for r in rows} == {"region:WLD"}
