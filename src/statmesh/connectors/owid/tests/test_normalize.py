from datetime import UTC, datetime

from statmesh.core.connector import load_connector
from statmesh.core.models import RawChunk
from statmesh.settings import Settings

CSV = (
    "entity,code,year,a,b\n"
    "India,IND,2019,1.5,2\n"
    "World,OWID_WRL,2019,3,\n"
    "Africa (UN),,2019,9,9\n"
    "Daily,IND,-5,1,1\n"
)


def _chunk(cols):
    return RawChunk("owid", "grapher", CSV.encode(), "text/csv", "u", {},
                    datetime(2026, 1, 1, tzinfo=UTC), meta={"slug": "s", "columns": cols})  # fmt: skip


def test_multi_column_world_and_skips():
    c = load_connector("owid", Settings.from_env())
    rows = c.normalize(_chunk({"a": "x", "b": None})).to_pylist()
    assert {(r["series_id"], r["value"]) for r in rows} == {
        ("owid:grapher:s:IND", 1.5), ("owid:grapher:s.b:IND", 2.0),
        ("owid:grapher:s:region:WLD", 3.0),
    }  # fmt: skip


def test_single_column_uses_slug():
    c = load_connector("owid", Settings.from_env())
    ids = c.normalize(_chunk({"a": None})).column("indicator_id").to_pylist()
    assert set(ids) == {"s"}


def _meta(cite, short=None, **col):
    return {"chart": {"citation": cite}, "columns": {"x": {"citationShort": short or cite, **col}}}


def _lic(meta):
    c = load_connector("owid", Settings.from_env())
    from statmesh.connectors.owid.connector import series_licence

    return series_licence(meta, c.manifest.licence, c.manifest.options["open_producers"])


def test_licence_branches():
    gbd = _lic(_meta("GBD 2019 Snakebite Envenomation Collaborators (2022)"))
    assert gbd.redistribute == "no"
    assert _lic(_meta("IHME (2024)")).redistribute == "no"
    owid = _lic(_meta("Our World in Data (2024)", "Our World in Data"))
    assert owid.redistribute == "yes"
    wb = _lic(_meta("World Bank (2025)", "World Bank (2025) – processed by Our World in Data"))
    assert wb.redistribute == "yes" and "CC BY 4.0" in wb.name
    wpp = _lic(_meta("UN, World Population Prospects (2024)"))
    assert wpp.redistribute == "yes" and "3.0 IGO" in wpp.name
    who = _lic(_meta("World Health Organization – Global Health Observatory (2026)"))
    assert who.redistribute == "review"
    assert who.name == "upstream provider terms (World Health Organization)"
    mixed = _lic(_meta("World Bank (2025); UNODC (2024)"))
    assert mixed.redistribute == "review"  # one non-allowlisted producer is enough
    assert _lic(_meta("")).redistribute == "review"
    assert _lic(_meta("Our World in Data based on Foo (2020)")).redistribute == "review"
    org = {"chart": {}, "columns": {"x": {"origins": [{"producer": "World Bank"}]}}}
    assert _lic(org).redistribute == "yes"


def test_vintage_is_latest_last_updated():
    from statmesh.connectors.owid.connector import release_date

    m = {
        "dateDownloaded": "2026-11-19",
        "columns": {"a": {"lastUpdated": "2023-01-02"}, "b": {"lastUpdated": "2024-05-06"}},
    }
    assert release_date(m) == "2024-05-06"
    assert release_date({"dateDownloaded": "2026-11-19", "columns": {"a": {}}}) == "2026-11-19"


def test_primary_column_keeps_slug():
    from statmesh.connectors.owid.connector import indicator_id

    cols = {"a": None, "b": None}
    assert (indicator_id("s", "a", cols), indicator_id("s", "b", cols)) == ("s", "s.b")


def test_discover_attaches_fixture_licences():
    from statmesh.testing.fixtures import replay_http

    s = Settings.from_env()
    c = load_connector("owid", s)
    (ds,) = c.discover(replay_http("owid", s), limit=4)
    assert ds.licence.redistribute == "review"
    got = {x.indicator_id: x.licence.redistribute for x in ds.series}
    assert got == {
        "death-rate-from-snakebite-envenoming": "no",
        "alcohol-attributable-fraction-of-mortality": "review",
        "road-traffic-deaths-to-alcohol": "review",
        "death-rate-road-traffic-injuries": "review",
    }


def test_fetch_skips_gone_and_renamed_slugs():
    import httpx

    from statmesh.core.http import HttpClient
    from statmesh.core.models import FetchRequest

    codes = {"a": 404, "b": 301, "c": 410, "d": 403}

    def handler(req):
        slug = req.url.path.split("/")[-1].split(".")[0]
        return httpx.Response(codes[slug], headers={"location": ""} if codes[slug] == 301 else {})

    c = load_connector("owid", Settings.from_env())
    http = HttpClient(c.manifest, Settings.from_env(), None, transport=httpx.MockTransport(handler))
    req = FetchRequest("grapher", tuple(codes))
    assert list(c.fetch(req, http)) == []
