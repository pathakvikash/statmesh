import pyarrow.parquet as pq
import pytest
from tests.api.test_api import build

from statmesh import cli, export, sdk


@pytest.fixture
def http(tmp_path):
    with build(tmp_path) as c:
        yield c


def test_client_frames(http):
    c = sdk.Client(http=http)
    df = c.search("unemployment", source="open")
    assert list(df.series_id) == ["open:D:UNEMP"]
    g = c.get("open:D:UNEMP:IND")
    assert len(g) == 2 and g.attrs["citations"][0]["licence_name"] == "CC BY"
    assert c.sql("SELECT COUNT(*) AS n FROM observations").n[0] == 4
    assert "open" in set(c.sources().id)
    assert c.describe("open:D:UNEMP")["dims"] == {"sex": ["M", "F"]}
    with pytest.raises(sdk.SdkError, match="not_found"):
        c.get("open:D:NOPE")
    with pytest.raises(sdk.SdkError, match="400"):
        c.sql("DROP TABLE x")


def test_forbidden_in_hosted(tmp_path):
    with build(tmp_path, mode="hosted") as h, pytest.raises(sdk.SdkError, match="forbidden"):
        sdk.Client(http=h).get("closed:D:UNEMP:IND")


def test_polars_missing_is_clear(http):
    pytest.importorskip("polars")
    assert sdk.Client(http=http, frame="polars").get("open:D:UNEMP:IND").shape[0] == 2


def run(argv, capsys):
    args = cli.build_parser().parse_args(argv)
    args.local = True  # export has no --local flag in cli.py
    rc = cli._dispatch(args.target, args)
    return rc, capsys.readouterr()


def test_cli_local(http, capsys):
    rc, o = run(["search", "unemployment", "--source", "open"], capsys)
    assert rc == 0 and "open:D:UNEMP" in o.out
    rc, o = run(["get", "open:D:UNEMP:IND", "--format", "json"], capsys)
    assert rc == 0 and '"status": "ok"' in o.out
    rc, o = run(["sql", "SELECT 1 AS x"], capsys)
    assert o.out.split() == ["x", "1"]
    rc, o = run(["sources"], capsys)
    assert rc == 0 and "open" in o.out
    rc, o = run(["get", "open:D:NOPE"], capsys)
    assert rc == 1 and "not_found" in o.err


@pytest.mark.parametrize("fmt", ["csv", "parquet"])
def test_export(http, tmp_path, capsys, fmt):
    out = tmp_path / "out"
    rc, _ = run(["export", "open:D:UNEMP:IND", "--out", str(out), "--format", fmt], capsys)
    assert rc == 0
    f = out / f"open_D_UNEMP_IND.{fmt}"
    assert f.exists()
    if fmt == "parquet":
        assert pq.read_table(f).num_rows == 2
    md = (out / "SOURCES.md").read_text()
    for s in ("Open", "https://open.example", "CC BY", "https://cc", "Open Org", "Retrieved at"):
        assert s in md
    assert "WARNING" not in md


def test_export_warns_on_no(http, tmp_path):
    files = export.export(sdk.Client(http=http), ["open:D:UNEMP:IND"], tmp_path / "o")
    assert files
    assert "WARNING" in export._sources_md([{"source_id": "s", "source_name": "S",
        "dataset_id": "d", "redistribute": "review"}])  # fmt: skip
