import gzip
import io
import zipfile

import openpyxl
import pytest
import yaml

from statmesh.core.connector import load_connector
from statmesh.core.models import FetchRequest
from statmesh.core.schema import validate_table
from statmesh.devtools.scaffold import scaffold, write_fixture
from statmesh.settings import Settings
from statmesh.testing.contract import ContractSuite
from statmesh.testing.fixtures import replay_http

CSV = b"Country,Year,Male,Female\nIND,2020,1,2\nBGD,2021,3,..\n"
LONG = b'Country,Period,Series,Val,Sex\nIndia,2020-Q1,gdp,"1,000",F\nViet Nam,2020-Q2,gdp,2,M\n'
ROBOTS = b"User-agent: *\nAllow: /\n"
MAPPING = {
    "wide": {"geo": "Country", "period": "Year", "melt": {"Male": "m", "Female": "f"}, "unit": "n"},
    "long": {"geo": "Country", "geo_scheme": "name", "period": "Period", "indicator": "Series",
             "value": "Val", "dims": ["Sex"], "unit_mult": 3},
}  # fmt: skip


def _xlsx() -> bytes:
    wb = openpyxl.Workbook()
    wb.active.append(["Country", "Year", "Male", "Female"])
    wb.active.append(["IND", 2020, 1.0, 2.0])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def _zip(name: str, data: bytes) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("readme.txt", "x")
        z.writestr(name, data)
    return out.getvalue()


CASES = {  # id -> (url, body, mapping)
    "csvwide": ("https://f.test/a.csv", CSV, MAPPING["wide"]),
    "csvlong": ("https://f.test/b.csv", LONG, MAPPING["long"]),
    "xlsx": ("https://f.test/c.xlsx", _xlsx(), MAPPING["wide"]),
    "zipcsv": ("https://f.test/d.zip", _zip("d.csv", CSV), MAPPING["wide"]),
    "zipxlsx": ("https://f.test/e.zip", _zip("e.xlsx", _xlsx()), MAPPING["wide"]),
    "gzcsv": ("https://f.test/f.csv.gz", gzip.compress(CSV), MAPPING["wide"]),
}


def make(root, cid, robots=ROBOTS):
    url, body, mapping = CASES[cid]
    d = scaffold(cid, "file", root)
    man = yaml.safe_load((d / "manifest.yaml").read_text())
    man["datasets"] = {"d": {"url": url}}
    man["core_datasets"] = ["d"]
    (d / "manifest.yaml").write_text(yaml.dump(man))
    (d / "mapping.yaml").write_text(yaml.dump({"datasets": {"d": mapping}}))
    fx = d / "tests" / "fixtures"
    for f in (fx / "http").iterdir():
        f.unlink()
    (fx / "requests.yaml").write_text("- dataset_id: d\n")
    write_fixture(fx, "https://f.test/robots.txt", robots, "text/plain")
    write_fixture(fx, url, body, "application/octet-stream")
    return Settings(connectors_dir=root)


@pytest.mark.parametrize("cid", CASES)
def test_contract(tmp_path, cid):
    s = make(tmp_path, cid)

    class T(ContractSuite):
        connector_id = cid

        def settings(self):
            return s

    t = T()
    for name in dir(ContractSuite):
        if name.startswith("test_"):
            getattr(t, name)()


def _rows(s, cid):
    c = load_connector(cid, s)
    (chunk,) = c.fetch(FetchRequest("d"), replay_http(cid, s))
    t = c.normalize(chunk)
    validate_table(t)
    return t.to_pylist()


def test_wide_melt_and_missing(tmp_path):
    rows = _rows(make(tmp_path, "csvwide"), "csvwide")
    assert len(rows) == 4
    assert {r["indicator_id"] for r in rows} == {"m", "f"}
    miss = [r for r in rows if r["value"] is None]
    assert [(r["geo"], r["obs_status"]) for r in miss] == [("BGD", "missing")]
    assert "csvwide:d:m:IND" in {r["series_id"] for r in rows}


def test_long_names_quarters_dims_mult(tmp_path):
    rows = _rows(make(tmp_path, "csvlong"), "csvlong")
    assert [r["geo"] for r in rows] == ["IND", "VNM"]
    assert [r["freq"] for r in rows] == ["Q", "Q"]
    assert rows[0]["value"] == 1000.0 and rows[0]["unit_mult"] == 3
    assert rows[0]["dims"] == [("Sex", "F")]


def test_discover_lists_melt_series(tmp_path):
    s = make(tmp_path, "csvwide")
    (ds,) = load_connector("csvwide", s).discover(replay_http("csvwide", s))
    assert {x.indicator_id for x in ds.series} == {"m", "f"}


def test_robots_disallow(tmp_path):
    s = make(tmp_path, "csvwide", robots=b"User-agent: *\nDisallow: /\n")
    with pytest.raises(PermissionError):
        _rows(s, "csvwide")


def _norm(tmp_path, body, mapping=None, media="text/csv"):
    from datetime import UTC, datetime

    from statmesh.core.generic.file import FileConnector
    from statmesh.core.models import Manifest, RawChunk

    lic = {"name": "n", "url": "u", "redistribute": "yes", "attribution": "a"}
    man = Manifest.model_validate({"id": "f", "name": "F", "kind": "file", "licence": lic,
                                   "datasets": {"d": {"url": "https://f.test/a.csv"}}})  # fmt: skip
    (tmp_path / "mapping.yaml").write_text(
        yaml.dump({"datasets": {"d": mapping or MAPPING["wide"]}})
    )
    c = FileConnector(man, tmp_path)
    return c.normalize(RawChunk("f", "d", body, media, "u", {}, datetime.now(UTC)))


def test_footer_rows_are_skipped(tmp_path):
    t = _norm(tmp_path, CSV + b"Source: ministry of x\n\nNote,only,three\n")
    assert t.num_rows == 4


def test_empty_file_is_zero_rows(tmp_path):
    assert _norm(tmp_path, b"").num_rows == 0
    assert _norm(tmp_path, b"Country,Year,Male,Female\n").num_rows == 0


def test_all_rows_malformed_or_bad_header_raises(tmp_path):
    with pytest.raises(ValueError, match="malformed"):
        _norm(tmp_path, b"Country,Year,Male,Female\nSource: x\n")
    with pytest.raises(ValueError, match="not in header"):
        _norm(tmp_path, b"A,B\n1,2\n")


def test_url_without_extension_needs_format(tmp_path, monkeypatch):
    monkeypatch.setitem(CASES, "noext", ("https://f.test/download", CSV, MAPPING["wide"]))
    s = make(tmp_path, "noext")
    c = load_connector("noext", s)
    with pytest.raises(ValueError, match="format"):
        list(c.fetch(FetchRequest("d"), replay_http("noext", s)))
    monkeypatch.setitem(
        CASES, "noext2", ("https://f.test/download", CSV, {**MAPPING["wide"], "format": "csv"})
    )
    s = make(tmp_path / "b", "noext2")
    assert len(_rows(s, "noext2")) == 4


@pytest.mark.parametrize("cid", ["zipcsv", "xlsx"])
def test_oversized_archive_is_refused(tmp_path, monkeypatch, cid):
    url, body, mapping = CASES[cid]
    monkeypatch.setitem(CASES, "big", (url, body, {**mapping, "max_uncompressed_mb": 0}))
    s = make(tmp_path, "big")
    c = load_connector("big", s)
    with pytest.raises(ValueError, match="refusing"):
        for ch in c.fetch(FetchRequest("d"), replay_http("big", s)):
            c.normalize(ch)  # xlsx is checked here, zip already at fetch


FAO = (
    b"Item Code,Item,Element Code,Element,Area Code (M49),Year,Value,Flag\n"
    b"15,Wheat,5510,Production,'356,2020,100,A\n"
    b"15,Wheat,5312,Area harvested,'356,2020,30,A\n"
    b"56,Maize,5510,Production,'356,2020,50,E\n"
    b"56,Maize,5510,Production,'356,2021,60,A\n"
)
FAO_MAP = {"geo": "Area Code (M49)", "period": "Year", "freq": "A", "value": "Value",
           "indicator": ["Item Code", "Element Code"]}  # fmt: skip


def _fao(tmp_path, body=FAO, **extra):
    (tmp_path / "geo_map.csv").write_text("src_code,geo\n'356,IND\n")
    return _norm(tmp_path, body, {**FAO_MAP, **extra}).to_pylist()


def test_composite_indicator_and_title(tmp_path):
    rows = _fao(tmp_path, indicator_title=["Item", "Element"])
    assert [r["indicator_id"] for r in rows] == ["15.5510", "15.5312", "56.5510", "56.5510"]
    assert rows[1]["series_id"] == "f:d:15.5312:IND"
    assert rows[0]["dims"] == [("indicator_title", "Wheat - Production")]


def test_composite_without_title_and_bad_column(tmp_path):
    assert _fao(tmp_path)[0]["dims"] == []
    with pytest.raises(ValueError, match="not in header"):
        _fao(tmp_path, indicator_title=["Nope"])


def test_single_column_indicator_unchanged(tmp_path):
    rows = _fao(tmp_path, indicator="Element Code")
    assert {r["indicator_id"] for r in rows} == {"5510", "5312"}


def test_where_scalar_and_list(tmp_path):
    assert len(_fao(tmp_path, where={"Item Code": 56})) == 2
    rows = _fao(tmp_path, where={"Item Code": [15, "56"], "Element Code": 5510, "Flag": ["A"]})
    assert [(r["indicator_id"], r["period_start"].year) for r in rows] == [
        ("15.5510", 2020), ("56.5510", 2021)
    ]  # fmt: skip
    assert _fao(tmp_path, where={"Item Code": 99}) == []  # filtered out is not "malformed"
    with pytest.raises(ValueError, match="not in header"):
        _fao(tmp_path, where={"Nope": 1})


def test_csv_in_zip_is_streamed_with_flat_memory(tmp_path):
    import tracemalloc
    from datetime import UTC, datetime

    from statmesh.core.generic.file import ZIP, FileConnector
    from statmesh.core.models import Manifest, RawChunk

    big = FAO + b"".join(b"56,Maize,5510,Production,'356,2020,%d,A\n" % i for i in range(300_000))
    chunk = RawChunk("f", "d", _zip("faostat.csv", big), ZIP, "https://f.test/x.zip", {},
                     datetime.now(UTC))  # fmt: skip
    (tmp_path / "geo_map.csv").write_text("src_code,geo\n'356,IND\n")
    lic = {"name": "n", "url": "u", "redistribute": "yes", "attribution": "a"}
    man = Manifest.model_validate({"id": "f", "name": "F", "kind": "file", "licence": lic,
                                   "datasets": {"d": {"url": "https://f.test/x.zip"}}})  # fmt: skip
    m = {**FAO_MAP, "where": {"Item Code": 15}}
    (tmp_path / "mapping.yaml").write_text(yaml.dump({"datasets": {"d": m}}))
    c = FileConnector(man, tmp_path)
    tracemalloc.start()
    t = c.normalize(chunk)
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert t.num_rows == 2
    assert peak < 3_000_000  # the CSV itself is ~15 MB


def test_stream_cap_counts_bytes_read(tmp_path):
    with pytest.raises(ValueError, match="refusing"):
        _fao(tmp_path, max_uncompressed_mb=0)  # plain CSV chunk: no zip header to pre-check


def test_per_indicator_units_and_robots_helper(tmp_path):
    from statmesh.core.generic.file import robots_ok

    rows = _norm(tmp_path, CSV, {**MAPPING["wide"], "units": {"m": "men"}}).to_pylist()
    assert {r["indicator_id"]: r["unit"] for r in rows} == {"m": "men", "f": "n"}

    class H:
        def get(self, url):
            class R:
                text = "User-agent: *\nDisallow: /"

            return R()

    assert robots_ok("https://x.test/a", H()) is False


def test_gzip_csv_is_gunzipped_while_streaming(tmp_path):
    rows = _rows(make(tmp_path, "gzcsv"), "gzcsv")
    assert {r["indicator_id"] for r in rows} == {"m", "f"}
    assert len(rows) == 4


def test_gzip_format_and_bomb_cap(tmp_path):
    from datetime import UTC, datetime

    from statmesh.core.generic.file import GZ, FileConnector
    from statmesh.core.models import Manifest, RawChunk

    lic = {"name": "n", "url": "u", "redistribute": "yes", "attribution": "a"}
    man = Manifest.model_validate({"id": "f", "name": "F", "kind": "file", "licence": lic,
                                   "datasets": {"d": {"url": "https://f.test/x.bin"}}})  # fmt: skip
    body = gzip.compress(CSV)
    chunk = RawChunk("f", "d", body, GZ, "https://f.test/x.bin", {}, datetime.now(UTC))
    (tmp_path / "mapping.yaml").write_text(
        yaml.dump({"datasets": {"d": {**MAPPING["wide"], "format": "gz"}}})
    )
    assert FileConnector(man, tmp_path).normalize(chunk).num_rows == 4
    capped = {**MAPPING["wide"], "format": "gz", "max_uncompressed_mb": 0}
    (tmp_path / "mapping.yaml").write_text(yaml.dump({"datasets": {"d": capped}}))
    with pytest.raises(ValueError, match="refusing"):
        FileConnector(man, tmp_path).normalize(chunk)


def _local_conn(tmp_path, src, mapping=None):
    from statmesh.core.generic.file import FileConnector
    from statmesh.core.models import Manifest

    lic = {"name": "n", "url": "u", "redistribute": "yes", "attribution": "a"}
    man = Manifest.model_validate({"id": "f", "name": "F", "kind": "file", "licence": lic,
                                   "datasets": {"d": {"url": src.as_uri()}}})  # fmt: skip
    (tmp_path / "mapping.yaml").write_text(
        yaml.dump({"datasets": {"d": mapping or MAPPING["wide"]}})
    )
    return FileConnector(man, tmp_path)


def test_file_url_reads_local_csv_and_gz(tmp_path, monkeypatch):
    monkeypatch.delenv("STATMESH_MODE", raising=False)
    plain = tmp_path / "pop.csv"
    plain.write_bytes(CSV)
    gz = tmp_path / "pop.csv.gz"
    gz.write_bytes(gzip.compress(CSV))
    for src in (plain, gz):
        c = _local_conn(tmp_path, src)
        (chunk,) = c.fetch(FetchRequest("d"), None)  # no HTTP for file://
        assert c.normalize(chunk).num_rows == 4


def test_file_url_refused_when_hosted(tmp_path, monkeypatch):
    src = tmp_path / "pop.csv"
    src.write_bytes(CSV)
    monkeypatch.setenv("STATMESH_MODE", "hosted")
    c = _local_conn(tmp_path, src)
    with pytest.raises(PermissionError, match="hosted"):
        list(c.fetch(FetchRequest("d"), None))


def test_file_url_must_be_local(tmp_path, monkeypatch):
    monkeypatch.delenv("STATMESH_MODE", raising=False)
    c = _local_conn(tmp_path, tmp_path / "pop.csv")
    c.manifest.datasets["d"]["url"] = "file://server/share/pop.csv"
    with pytest.raises(ValueError, match="local paths"):
        list(c.fetch(FetchRequest("d"), None))
