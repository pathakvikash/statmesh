import json

import httpx
import yaml

from statmesh.core.generic.ckan import CkanConnector
from statmesh.core.http import HttpClient
from statmesh.core.models import FetchRequest, Manifest
from statmesh.core.schema import validate_table
from statmesh.settings import Settings

PKG = {"name": "pkg", "title": "P", "license_title": "CC-BY", "license_url": "https://l",
       "resources": [{"id": "r1", "name": "n", "format": "CSV", "url": "https://x.test/d.csv"}]}  # fmt: skip


def make(tmp_path, handler):
    m = {"id": "demo", "name": "Demo", "kind": "ckan", "endpoint": "https://x.test/api/3/action",
         "licence": {"name": "L", "url": "https://u", "redistribute": "yes", "attribution": "A"},
         "options": {"page_size": 2}, "datasets": {"pkg": {}}}  # fmt: skip
    (tmp_path / "mapping.yaml").write_text(yaml.dump(
        {"datasets": {"pkg": {"geo_const": "IND", "period": "Y", "value": "V"}}}))  # fmt: skip
    man = Manifest.model_validate(m)
    http = HttpClient(man, Settings.from_env(), None, transport=httpx.MockTransport(handler))
    return CkanConnector(man, tmp_path), http


def ok(result):
    return httpx.Response(200, json={"success": True, "result": result})


def test_download_path_and_licence(tmp_path):
    def handler(req):
        if req.url.path.endswith("robots.txt"):
            return httpx.Response(404)
        if req.url.path.endswith("d.csv"):
            return httpx.Response(200, content=b"Y,V\n2020,1\n2021,2\n")
        if req.url.path.endswith("package_show"):
            return ok(PKG)
        # package_search: 3 packages in total, pages of 2
        start = int(req.url.params["start"])
        return ok(
            {
                "count": 3,
                "results": [dict(PKG, name=f"p{i}") for i in range(start, min(start + 2, 3))],
            }
        )

    c, http = make(tmp_path, handler)
    metas = list(c.discover(http))
    assert [d.dataset_id for d in metas] == ["pkg", "p0", "p1", "p2"]
    assert metas[0].licence.name == "CC-BY" and metas[0].licence.url == "https://l"
    (chunk,) = c.fetch(FetchRequest("pkg"), http)
    t = c.normalize(chunk)
    validate_table(t)
    assert t["value"].to_pylist() == [1.0, 2.0] and t["geo"][0].as_py() == "IND"


def test_datastore_paging(tmp_path):
    rows = [{"_id": i, "Y": str(2000 + i), "V": str(i)} for i in range(5)]

    def handler(req):
        if req.url.path.endswith("package_show"):
            return ok(
                dict(PKG, resources=[{"id": "r1", "format": "CSV", "datastore_active": True}])
            )
        p = req.url.params
        o, n = int(p["offset"]), int(p["limit"])
        fields = [{"id": "_id"}, {"id": "Y"}, {"id": "V"}]
        return ok({"fields": fields, "records": rows[o : o + n], "total": 5})

    c, http = make(tmp_path, handler)
    (chunk,) = c.fetch(FetchRequest("pkg"), http)
    assert c.normalize(chunk).num_rows == 5
    (chunk,) = c.fetch(FetchRequest("pkg", max_rows=3), http)
    assert c.normalize(chunk).num_rows == 3


def test_api_error_raises(tmp_path):
    c, http = make(tmp_path, lambda r: httpx.Response(200, content=json.dumps({"success": False})))
    try:
        list(c.discover(http))
    except RuntimeError as e:
        assert "package_show" in str(e)
    else:
        raise AssertionError("expected RuntimeError")


def test_truncation_flag_and_licence_downgrade(tmp_path):
    rows = [{"_id": i, "Y": str(2000 + i), "V": str(i)} for i in range(5)]

    def handler(req):
        if req.url.path.endswith("package_show"):
            return ok(
                dict(PKG, resources=[{"id": "r1", "format": "CSV", "datastore_active": True}])
            )
        p = req.url.params
        o, n = int(p["offset"]), int(p["limit"])
        return ok({"fields": [{"id": "Y"}, {"id": "V"}], "records": rows[o : o + n], "total": 5})

    c, http = make(tmp_path, handler)
    (cut,) = c.fetch(FetchRequest("pkg", max_rows=3), http)
    assert cut.meta["truncated"] is True
    (full,) = c.fetch(FetchRequest("pkg", max_rows=5), http)
    assert not full.meta.get("truncated")
    assert c._meta(PKG).licence.redistribute == "review"  # CC-BY != manifest "L"
    assert c._meta({**PKG, "license_title": "L"}).licence.redistribute == "yes"
