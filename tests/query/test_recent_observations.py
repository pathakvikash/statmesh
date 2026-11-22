"""service.get_observations_recent: the short answer keeps every geo (or says it did not)."""

from datetime import UTC, date, datetime

import pyarrow as pa
import pycountry

from statmesh import service
from statmesh.core.catalog import Catalog
from statmesh.core.models import DatasetMeta, Licence, Manifest, SeriesMeta
from statmesh.core.schema import OBS_SCHEMA
from statmesh.core.storage import Storage
from statmesh.settings import Settings

YES = Licence(name="CC BY", url="https://cc", redistribute="yes", attribution="Open Org")
TS = datetime(2026, 1, 1, tzinfo=UTC)


def big(tmp_path, n_geos, years):
    real = sorted(c.alpha_3 for c in pycountry.countries)  # >249 geos: padded with fake codes
    geos = (real + [f"X{i:03d}" for i in range(n_geos)])[:n_geos]
    cat = Catalog(tmp_path / "catalog.sqlite")
    cat.upsert_source(Manifest(id="open", name="Open", kind="custom", licence=YES))
    ds = DatasetMeta("open", "D", "d", YES, source_url="https://o.example",
                     series=(SeriesMeta("BIG", "Big", freq="A", geos=tuple(geos)),))  # fmt: skip
    cat.upsert_discovery("open", [ds], core=[])
    cat.set_dataset_status("open", "D", "ingested")
    cat.close()
    rows = [{
        "series_id": f"open:D:BIG:{g}", "source_id": "open", "dataset_id": "D",
        "indicator_id": "BIG", "geo": g, "period_start": date(y, 1, 1),
        "period_end": date(y, 12, 31), "freq": "A", "value": float(y), "unit": "pct",
        "unit_mult": 0, "dims": [], "obs_status": None, "retrieved_at": TS, "vintage": None,
    } for g in geos for y in years]  # fmt: skip
    st = Storage(tmp_path)
    with st.update_manifest() as m:
        m["obs"]["open/D"] = st.write_parts(
            pa.Table.from_pylist(rows, schema=OBS_SCHEMA), "obs/open/D", "r1"
        )
    service.configure(Settings(data_dir=tmp_path))
    return geos


def test_217_geos_x_24_years_cuts_to_200_geos_and_says_so(tmp_path):
    big(tmp_path, 217, range(2000, 2024))
    r = service.get_observations_recent("open:D:BIG")
    gi = r.columns.index("geo")
    assert len(r.rows) == 200 and len({x[gi] for x in r.rows}) == 200
    assert r.omitted_rows == 217 * 24 - 200 and "200 of 217 geos" in r.warning


def test_under_cap_geos_get_latest_periods_each(tmp_path):
    geos = big(tmp_path, 40, range(2000, 2024))
    r = service.get_observations_recent("open:D:BIG")
    gi, pi = r.columns.index("geo"), r.columns.index("period_start")
    assert len(r.rows) == 200 and {x[gi] for x in r.rows} == set(geos)
    assert {x[pi] for x in r.rows} == {f"{y}-01-01" for y in range(2019, 2024)}  # 200 // 40 = 5
    assert r.omitted_rows == 40 * 24 - 200 and not r.truncated and r.next_offset is None
    assert "latest 5 per geo" in r.warning and "omitted entirely" not in r.warning


def test_266_geos_x_64_years_says_whole_geos_are_omitted(tmp_path):
    big(tmp_path, 266, range(1960, 2024))
    r = service.get_observations_recent("open:D:BIG")
    gi, pi = r.columns.index("geo"), r.columns.index("period_start")
    assert len(r.rows) == 200 and len({x[gi] for x in r.rows}) == 200
    assert {x[pi] for x in r.rows} == {"2023-01-01"}  # latest row of each shown geo
    assert r.omitted_rows == 266 * 64 - 200 and r.next_offset is None and not r.truncated
    assert "200 of 266 geos" in r.warning and "omitted entirely" in r.warning


def test_single_geo_and_small_series_are_whole(tmp_path):
    big(tmp_path, 3, range(2020, 2024))
    r = service.get_observations_recent("open:D:BIG")
    assert len(r.rows) == 12 and r.omitted_rows == 0 and r.warning is None
    r = service.get_observations_recent("open:D:BIG", geo="AFG", max_rows=2)
    assert [x[r.columns.index("period_start")] for x in r.rows] == ["2022-01-01", "2023-01-01"]
    assert r.omitted_rows == 2


def test_explicit_limit_paging_is_unchanged(tmp_path):
    big(tmp_path, 3, range(2020, 2024))
    a = service.get_observations("open:D:BIG", limit=5)
    assert a.truncated and a.next_offset == 5 and a.rows[0][a.columns.index("geo")] == "ABW"
