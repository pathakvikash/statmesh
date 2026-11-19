from datetime import UTC, date, datetime

import pyarrow as pa
import pytest

from statmesh.core.schema import (
    OBS_SCHEMA,
    TABLE_SCHEMAS,
    empty_table,
    obs_row_key_sql,
    validate_table,
)


def _row(**over):
    row = {
        "series_id": "s:d:i:IND", "source_id": "s", "dataset_id": "d", "indicator_id": "i",
        "geo": "IND", "period_start": date(2024, 1, 1), "period_end": date(2024, 12, 31),
        "freq": "A", "value": 1.0, "unit": "pct", "unit_mult": 0, "dims": {"a": "1", "b": "2"},
        "obs_status": None, "retrieved_at": datetime(2026, 1, 1, tzinfo=UTC), "vintage": None,
    }  # fmt: skip
    row.update(over)
    return row


def _table(**over):
    row = _row(**over)
    return pa.table({k: [v] for k, v in row.items()}, schema=OBS_SCHEMA)


def test_valid_and_empty():
    validate_table(_table())
    for name in TABLE_SCHEMAS:
        validate_table(empty_table(name), name)


def test_wrong_schema():
    with pytest.raises(ValueError, match="schema mismatch"):
        validate_table(pa.table({"x": [1]}))


def test_null_in_required_column():
    with pytest.raises(ValueError, match="non-nullable"):
        validate_table(_table(geo=None))


def test_bad_freq():
    with pytest.raises(ValueError, match="freq"):
        validate_table(_table(freq="X"))


def test_unsorted_dims():
    t = _table()
    bad = t.set_column(
        t.schema.get_field_index("dims"),
        OBS_SCHEMA.field("dims"),
        pa.array([[("b", "2"), ("a", "1")]], type=OBS_SCHEMA.field("dims").type),
    )
    with pytest.raises(ValueError, match="sorted"):
        validate_table(bad)


def test_unknown_table_and_key_sql():
    with pytest.raises(ValueError):
        validate_table(empty_table(), "nope")
    assert obs_row_key_sql().startswith("series_id, period_start, freq")
