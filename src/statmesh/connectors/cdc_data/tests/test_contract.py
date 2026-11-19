from statmesh.testing.contract import ContractSuite


class TestContract(ContractSuite):
    connector_id = "cdc_data"
    discover_limit = 5


def test_aadr_has_rate_unit():
    from datetime import UTC, datetime

    from statmesh.core.connector import load_connector
    from statmesh.core.models import RawChunk
    from statmesh.settings import Settings

    c = load_connector("cdc_data", Settings.from_env())
    chunk = RawChunk("cdc_data", "bi63-dtpu", b"year,cause_name,deaths,aadr\n2020,Stroke,10,5.5\n",
                     "text/csv", "u", {}, datetime(2026, 1, 1, tzinfo=UTC))  # fmt: skip
    units = {r["indicator_id"]: (r["unit"], r["unit_mult"]) for r in c.normalize(chunk).to_pylist()}
    assert units == {
        "deaths": ("deaths", 0),
        "age_adjusted_death_rate": ("per 100,000 population", 0),
    }
