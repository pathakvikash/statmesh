from statmesh.core.connector import load_connector
from statmesh.settings import Settings
from statmesh.testing.fixtures import replay_http


def test_nso_redistribute_yes_rbi_review():
    s = Settings.from_env()
    c = load_connector("mospi", s)
    assert c.manifest.licence.redistribute == "yes"
    assert "not endorsed by MoSPI" in c.manifest.licence.attribution
    got = {d.dataset_id: d.licence.redistribute for d in c.discover(replay_http("mospi", s))}
    assert got["cpi"] == got["plfs_annual"] == "yes"
    assert {k for k, v in got.items() if v == "review"} == {
        "rbi_trade_inr", "rbi_bop", "rbi_fx_annual", "nas_state_annual",
        "cpialrl", "envstats", "gender_stats", "sppi",
    }  # fmt: skip


def test_series_titles_name_the_dataset_and_country():
    s = Settings.from_env()
    c = load_connector("mospi", s)
    by = {d.dataset_id: d for d in c.discover(replay_http("mospi", s))}
    assert (
        by["wpi"].series[0].title
        == "Wholesale Price Index (major group down to item) — Index, India"
    )
    assert any(x.title.endswith("Unemployment rate, India") and x.title.startswith("PLFS quarterly")
               for x in by["plfs_quarterly"].series)  # fmt: skip
    assert all(" — " in x.title and x.description for d in by.values() for x in d.series)


def test_cap_hit_with_more_pages_sets_truncated():
    import httpx

    from statmesh.core.http import HttpClient
    from statmesh.core.models import FetchRequest, RateLimit
    from statmesh.settings import Settings

    def handler(req):
        return httpx.Response(200, json={"data": [{"x": 1}] * 3, "meta_data": {"totalPages": 5}})

    s = Settings.from_env()
    c = load_connector("mospi", s)
    m = c.manifest.model_copy(update={"rate_limit": RateLimit()})
    h = HttpClient(m, s, None, transport=httpx.MockTransport(handler))
    chunks = list(c.fetch(FetchRequest("plfs_annual", max_rows=6, indicator_ids=("lfpr",)), h))
    assert [ch.meta.get("truncated") for ch in chunks] == [None, True]


def test_new_datasets_replay_with_state_geo_and_energy_unit():
    s = Settings.from_env()
    c = load_connector("mospi", s)
    http = replay_http("mospi", s)
    got = {d.dataset_id for d in c.discover(http)}
    assert {"nas_state_annual", "asi", "hces", "energy_supply", "energy_consumption"} <= got
    from statmesh.core.models import FetchRequest

    req = FetchRequest(
        "nas_state_annual",
        indicator_ids=("gsdp",),
        filters={"year": "2023-24", "limit": "20"},
        max_rows=20,
    )
    t = c.normalize(next(iter(c.fetch(req, http)))).to_pylist()
    assert any(r["geo"].startswith("IN-") for r in t)
    req = FetchRequest(
        "energy_supply",
        indicator_ids=("ktoe",),
        filters={"year": "2023-24", "limit": "20"},
        max_rows=20,
    )
    assert {r["unit"] for r in c.normalize(next(iter(c.fetch(req, http)))).to_pylist()} == {"KToE"}


def test_core_datasets_are_exactly_the_mirrorable_yes_ones():
    from statmesh.ingest.mirror import effective_redistribute

    m = load_connector("mospi", Settings.from_env()).manifest
    assert set(m.core_datasets) == {
        "plfs_annual", "plfs_quarterly", "plfs_monthly", "cpi", "iip_annual", "nas_annual",
        "nas_quarterly", "tus", "asuse_annual", "asuse_quarterly", "nss72t_tourism",
    }  # fmt: skip
    assert m.refresh.schedule
    assert {d for d in m.core_datasets if effective_redistribute(m, d) != "yes"} == set()
    # what `statmesh mirror` would ingest: the yes ones among core_datasets, never a review dataset
    review = {d for d in m.datasets if effective_redistribute(m, d) == "review"}
    assert review and not review & set(m.core_datasets)


def test_mirror_dry_run_selects_every_core_dataset(monkeypatch, tmp_path, capsys):
    from types import SimpleNamespace

    from statmesh.ingest.mirror import mirror_cmd

    monkeypatch.setenv("STATMESH_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STATMESH_CONTACT_EMAIL", "t@example.org")
    monkeypatch.setattr("statmesh.ingest.mirror.list_connectors", lambda s: ["mospi"])
    assert mirror_cmd(SimpleNamespace(dry_run=True)) == 0
    out = capsys.readouterr().out
    m = load_connector("mospi", Settings.from_env()).manifest
    assert {ln.split(":")[0] for ln in out.splitlines() if "would ingest" in ln} == {
        f"mospi/{d}" for d in m.core_datasets
    } and "skip" not in out
