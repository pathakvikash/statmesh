import httpx
import yaml

from statmesh.core.generic.socrata import SocrataConnector
from statmesh.core.http import HttpClient
from statmesh.core.models import FetchRequest, Manifest
from statmesh.core.schema import validate_table
from statmesh.settings import Settings


def make(tmp_path, handler):
    m = {"id": "demo", "name": "Demo", "kind": "socrata", "endpoint": "https://x.test",
         "licence": {"name": "L", "url": "https://u", "redistribute": "yes", "attribution": "A"},
         "options": {"page_size": 2}, "datasets": {"abcd-1234": {"where": "k='a'"}}}  # fmt: skip
    (tmp_path / "mapping.yaml").write_text(yaml.dump({"datasets": {"abcd-1234": {
        "geo_const": "IND", "period": "y", "value": "v", "dims": ["k"]}}}))  # fmt: skip
    man = Manifest.model_validate(m)
    http = HttpClient(man, Settings.from_env(), None, transport=httpx.MockTransport(handler))
    return SocrataConnector(man, tmp_path), http


def entry(i, lic=None):
    return {"resource": {"id": i, "name": i}, "metadata": {"license": lic} if lic else {}}


def test_discover_licence_and_paging(tmp_path):
    def handler(req):
        p = req.url.params
        if "ids" in p:
            return httpx.Response(200, json={"results": [entry("abcd-1234", "PD")]})
        off = int(p["offset"])
        allr = [entry("abcd-1234"), entry("aaaa-0001"), entry("aaaa-0002")]
        return httpx.Response(200, json={"results": allr[off : off + int(p["limit"])]})

    c, http = make(tmp_path, handler)
    metas = list(c.discover(http))
    assert [d.dataset_id for d in metas] == ["abcd-1234", "aaaa-0001", "aaaa-0002"]
    assert metas[0].licence.name == "PD" and metas[1].licence.name == "L"


def test_soda_paging_and_missing_nulls(tmp_path):
    data = [
        {"y": "2020", "v": "1", "k": "a"},
        {"y": "2021", "v": "2"},
        {"y": "2022", "v": "3", "k": "a"},
    ]
    seen = []

    def handler(req):
        p = req.url.params
        seen.append((p["$offset"], p["$limit"], p["$where"]))
        o = int(p["$offset"])
        return httpx.Response(200, json=data[o : o + int(p["$limit"])])

    c, http = make(tmp_path, handler)
    (chunk,) = c.fetch(FetchRequest("abcd-1234"), http)
    t = c.normalize(chunk)
    validate_table(t)
    assert t["value"].to_pylist() == [1.0, 2.0, 3.0]
    assert seen == [("0", "2", "k='a'"), ("2", "2", "k='a'")]
    (chunk,) = c.fetch(FetchRequest("abcd-1234", max_rows=1), http)
    assert c.normalize(chunk).num_rows == 1


def test_truncation_flag_and_licence_downgrade(tmp_path):
    data = [{"y": "2020", "v": str(i), "k": "a"} for i in range(5)]

    def handler(req):
        p = req.url.params
        o = int(p["$offset"])
        return httpx.Response(200, json=data[o : o + int(p["$limit"])])

    c, http = make(tmp_path, handler)
    (cut,) = c.fetch(FetchRequest("abcd-1234", max_rows=4), http)
    assert cut.meta["truncated"] is True and c.normalize(cut).num_rows == 4
    (full,) = c.fetch(FetchRequest("abcd-1234", max_rows=5), http)
    assert not full.meta.get("truncated")
    assert c._meta(entry("x", "PD")).licence.redistribute == "review"
    assert c._meta(entry("x", "L")).licence.redistribute == "yes"
