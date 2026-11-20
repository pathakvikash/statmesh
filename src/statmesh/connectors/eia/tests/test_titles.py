from statmesh.core.connector import load_connector
from statmesh.settings import Settings

FUELS = {"ALL": "all fuels", "NG": "natural gas", "COL": "coal", "NUC": "nuclear",
         "SUN": "solar", "WND": "wind"}  # fmt: skip


def test_generation_titles_name_fuel_and_unit():
    c = load_connector("eia", Settings.from_env())
    (ds,) = [d for d in c.discover(None) if d.dataset_id == "electricity_generation"]
    titles = {s.indicator_id.removeprefix("generation_"): s.title for s in ds.series}
    assert set(titles) == set(c.manifest.datasets["electricity_generation"]["facets"]["fueltypeid"])
    for code, t in titles.items():
        assert FUELS[code] in t and "electricity generation" in t and "megawatthours" in t, t
