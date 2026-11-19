"""SdmxConnector behaviour beyond the contract suite: quirks of IMF/OECD/ILO/Eurostat as config."""

from __future__ import annotations

import tempfile
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from statmesh.core.connector import load_connector
from statmesh.core.generic.sdmx import SdmxConnector
from statmesh.core.models import FetchRequest, Manifest, RawChunk
from statmesh.settings import Settings
from statmesh.testing.fixtures import fixtures_dir, load_requests, replay_http

S = replace(Settings.from_env(), data_dir=Path(tempfile.mkdtemp()))


def _chunk(csv_text: str, manifest: Manifest, dims: list[str]) -> tuple[SdmxConnector, RawChunk]:
    c = SdmxConnector(manifest, Path("/nonexistent"))
    return c, RawChunk(
        source_id=manifest.id,
        dataset_id="DS",
        content=csv_text.encode(),
        media_type="text/csv",
        url="u",
        params={},
        retrieved_at=datetime(2026, 1, 1, tzinfo=UTC),
        meta={"dims": dims},
    )


def _manifest(**options) -> Manifest:
    return Manifest.model_validate(
        {
            "id": "t",
            "name": "T",
            "kind": "sdmx",
            "endpoint": "https://x.example/sdmx",
            "licence": {"name": "n", "url": "u", "redistribute": "yes", "attribution": "a"},
            "options": options,
        }
    )


def test_imf_style_csv_metadata_row_month_period_and_namibia():
    csv_text = (
        "DATAFLOW,COUNTRY,TIME_PERIOD,OBS_VALUE,SCALE\n"
        "X,,,,\n"  # dataset-level metadata row: no period
        "X,NA,2024-M03,1.5,3\n"  # ISO2 'NA' is Namibia, not a null
        "X,IN,2024-Q2,,0\n"
    )
    c, chunk = _chunk(
        csv_text,
        _manifest(geo_dim="COUNTRY", geo_scheme="iso2", unit_mult_col="SCALE"),
        ["COUNTRY"],
    )
    rows = c.normalize(chunk).to_pylist()
    assert [r["geo"] for r in rows] == ["NAM", "IND"]
    assert rows[0]["freq"] == "M" and str(rows[0]["period_start"]) == "2024-03-01"
    assert rows[0]["unit_mult"] == 3 and rows[0]["indicator_id"] == "VALUE"
    assert rows[1]["value"] is None and rows[1]["freq"] == "Q"


def test_max_rows_caps_output():
    csv_text = "REF_AREA,TIME_PERIOD,OBS_VALUE\nIND,2020,1\nIND,2021,2\nIND,2022,3\n"
    c, chunk = _chunk(csv_text, _manifest(), ["REF_AREA"])
    chunk = replace(chunk, meta={**chunk.meta, "max_rows": 2})
    assert c.normalize(chunk).num_rows == 2


def test_key_from_dsd_order_and_reverse_geo_map():
    """Eurostat: iso2 + geo_map.csv; GRC is sent as EL, and the key follows the DSD order."""
    c = load_connector("eurostat", S)
    http = replay_http("eurostat", S)
    (req,) = load_requests(fixtures_dir("eurostat", S))
    (chunk,) = c.fetch(req, http)
    assert chunk.url.endswith("/ESTAT,une_rt_a/.Y15-74.PC_ACT.T.FR+DE+EL+ES")
    geos = {r["geo"] for r in c.normalize(chunk).to_pylist()}
    assert geos == {"FRA", "DEU", "GRC", "ESP"}


@pytest.mark.parametrize("v", [".", "A.B.C", "USA+."])
def test_filter_values_with_key_separator_rejected(v):
    c = load_connector("eurostat", S)
    (req,) = load_requests(fixtures_dir("eurostat", S))
    with pytest.raises(ValueError, match="key separator"):
        list(c.fetch(replace(req, filters={"freq": v}), replay_http("eurostat", S)))


def test_updated_after_only_when_manifest_enables_it():
    http = replay_http("eurostat", S)
    c = load_connector("eurostat", S)
    (req,) = load_requests(fixtures_dir("eurostat", S))
    req = replace(req, updated_after=datetime(2026, 1, 1, tzinfo=UTC))
    # the recorded fixture has no updatedAfter, so a request carrying it must be a fixture miss
    with pytest.raises(Exception, match="no fixture"):
        list(c.fetch(req, http))
    off = load_connector("oecd", S)  # oecd does not set refresh.incremental
    assert off.manifest.refresh.incremental is None


def test_discover_puts_core_first_and_expands_indicators():
    c = load_connector("ilostat", S)
    ds = list(c.discover(replay_http("ilostat", S), limit=3))
    assert ds[0].dataset_id == "DF_UNE_DEAP_SEX_AGE_RT" and len(ds) == 3
    assert any(s.indicator_id == "UNE_DEAP_RT" for s in ds[0].series)
    assert all(not d.series for d in ds[1:])


def test_imf_indicator_codes_use_manifest_codelist_override():
    c = load_connector("imf", S)
    (core,) = list(c.discover(replay_http("imf", S), limit=1))
    ids = {s.indicator_id for s in core.series}
    assert ids == {"CPI._T.IX", "CPI._T.YOY_PCH_PA_PT"}


def test_acceptance_q1_and_q4_series_present():
    il = load_connector("ilostat", S)
    (req,) = load_requests(fixtures_dir("ilostat", S))
    rows = il.normalize(next(iter(il.fetch(req, replay_http("ilostat", S))))).to_pylist()
    assert {r["geo"] for r in rows} == {"IND", "BGD", "VNM"}
    assert {r["series_id"].rsplit(":", 1)[0] for r in rows} == {
        "ilostat:DF_UNE_DEAP_SEX_AGE_RT:UNE_DEAP_RT"
    }
    imf = load_connector("imf", S)
    (req,) = load_requests(fixtures_dir("imf", S))
    rows = imf.normalize(next(iter(imf.fetch(req, replay_http("imf", S))))).to_pylist()
    assert len({r["geo"] for r in rows}) >= 15  # G20 countries
    assert isinstance(req, FetchRequest)


@pytest.mark.live
@pytest.mark.parametrize("source", ["imf", "oecd", "ilostat", "eurostat"])
def test_live_smoke(source):
    """Run with `pytest -m live --force-enable-socket`: the recorded requests against the real API."""
    from statmesh.core.http import HttpClient

    c = load_connector(source, S)
    http = HttpClient(c.manifest, S)
    rows = 0
    for req in load_requests(fixtures_dir(source, S)):
        rows += sum(c.normalize(ch).num_rows for ch in c.fetch(req, http))
    assert rows > 0


def test_ecb_titles_from_codelist_and_text_csv_accept():
    """ECB: FM indicator titles come from the (huge, pruned in the fixture) codelist; data is
    requested with `accept: text/csv` because the ECB API answers 406 to SDMX-CSV."""
    c = load_connector("ecb", S)
    http = replay_http("ecb", S)
    fm = next(d for d in c.discover(http, limit=5) if d.dataset_id == "FM")
    titles = {s.indicator_id: s.title for s in fm.series}
    assert set(titles) == {"MRR_FR", "DFR", "MLFR"}
    assert all(t != f"{fm.title} - {i}" for i, t in titles.items())  # not bare codes
    assert c._cfg("ICP")["accept"] == "text/csv"


def test_nan_observation_becomes_null():
    m = _manifest()
    c, ch = _chunk(
        "REF_AREA,TIME_PERIOD,OBS_VALUE\nUS,2024-01,NaN\nUS,2024-02,1.5\n", m, ["REF_AREA"]
    )
    assert [r["value"] for r in c.normalize(ch).to_pylist()] == [None, 1.5]


def test_discover_skips_deleted_placeholder_codes():
    c = load_connector("ilostat", S)
    http = replay_http("ilostat", S)
    for d in c.discover(http, limit=5):
        assert not any(
            s.indicator_id.startswith("XXX_") or s.title.endswith("- DEL") for s in d.series
        )


def test_max_rows_truncation_flag_and_warning(caplog):
    c = load_connector("eurostat", S)
    http = replay_http("eurostat", S)
    (req,) = load_requests(fixtures_dir("eurostat", S))
    (full,) = c.fetch(req, http)
    assert full.meta["truncated"] is False
    (cut,) = c.fetch(replace(req, max_rows=1), http)
    assert cut.meta["truncated"] is True and "max_rows" in caplog.text


def test_missing_values_get_status_and_units_option():
    m = _manifest(unit="U", units={"A": "Percent"})
    csv_text = "REF_AREA,TIME_PERIOD,OBS_VALUE\nUS,2024,\nUS,2025,NaN\nUS,2026,1\n"
    c, ch = _chunk(csv_text, m, ["REF_AREA"])
    rows = c.normalize(ch).to_pylist()
    assert [(r["value"], r["obs_status"], r["unit"]) for r in rows] == [
        (None, "missing", "U"),
        (None, "missing", "U"),
        (1.0, None, "U"),
    ]
    m2 = _manifest(indicator_dims=["REF_AREA"], units={"US": "Percent"})
    c2, ch2 = _chunk(csv_text, m2, ["REF_AREA"])
    assert {r["unit"] for r in c2.normalize(ch2).to_pylist()} == {"Percent"}


def test_reverse_geo_prefers_first_row():
    c = load_connector("eurostat", S)
    assert c._src_geo("region:EMU") == "EA20"


def test_unit_code_resolved_to_label_and_scale_in_label_zeroes_unit_mult():
    csv_text = (
        "REF_AREA,TIME_PERIOD,OBS_VALUE,UNIT_MEASURE,UNIT_MULT\nIN,2024,1,367,6\nIN,2025,2,5,3\n"
    )
    c, chunk = _chunk(csv_text, _manifest(unit_col="UNIT_MEASURE", unit_mult_col="UNIT_MULT"), [])
    chunk = replace(
        chunk, meta={"dims": [], "unit_labels": {"367": "Millions of USD", "5": "Index"}}
    )
    rows = c.normalize(chunk).to_pylist()
    assert [(r["unit"], r["unit_mult"]) for r in rows] == [("Millions of USD", 0), ("Index", 3)]
