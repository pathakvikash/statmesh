from __future__ import annotations

import pyarrow as pa

# unit_mult is the scale BEYOND what `unit` already says: a connector whose published unit text
# names the scale ("Billions of Dollars", "Millions of chained 2017 dollars") keeps that text and
# sets unit_mult 0; a bare unit ("Level", "Persons") with a scale factor sets unit_mult (6 = millions).
# Real value = value * 10**unit_mult in the unit as worded. Never both, or the UI scales twice.
OBS_SCHEMA = pa.schema(
    [
        pa.field("series_id", pa.string(), nullable=False),
        pa.field("source_id", pa.string(), nullable=False),
        pa.field("dataset_id", pa.string(), nullable=False),
        pa.field("indicator_id", pa.string(), nullable=False),
        pa.field("geo", pa.string(), nullable=False),  # ISO3 | region:<code> | IN-XX | unmapped:<c>
        pa.field("period_start", pa.date32(), nullable=False),
        pa.field("period_end", pa.date32(), nullable=False),  # inclusive
        pa.field("freq", pa.string(), nullable=False),  # A S Q M W D
        pa.field("value", pa.float64()),  # null allowed when obs_status explains it
        pa.field("unit", pa.string()),  # as published
        pa.field("unit_mult", pa.int8()),  # power of ten BEYOND what `unit` says; see docstring
        pa.field("dims", pa.map_(pa.string(), pa.string())),  # keys sorted ascending
        pa.field("obs_status", pa.string()),
        pa.field("retrieved_at", pa.timestamp("us", tz="UTC"), nullable=False),
        pa.field("vintage", pa.date32()),
    ]
)

ENTITIES_SCHEMA = pa.schema(
    [
        pa.field("entity_id", pa.string(), nullable=False),  # lei:<LEI> | cik:<10 digits> | uk:<n>
        pa.field("source_id", pa.string(), nullable=False),
        pa.field("name", pa.string(), nullable=False),
        pa.field("country", pa.string()),  # ISO3
        pa.field("industry_code", pa.string()),
        pa.field("industry_scheme", pa.string()),  # SIC | NACE | ISIC | NIC
        pa.field("address", pa.string()),
        pa.field("attrs", pa.map_(pa.string(), pa.string())),
        pa.field("retrieved_at", pa.timestamp("us", tz="UTC"), nullable=False),
    ]
)

XREF_SCHEMA = pa.schema(
    [
        pa.field("from_id", pa.string(), nullable=False),  # entity_id form, isin:/ticker:/bic:
        pa.field("to_id", pa.string(), nullable=False),
        pa.field("source_id", pa.string(), nullable=False),
        pa.field("confidence", pa.float32(), nullable=False),  # 1.0 for official mappings
        pa.field("inferred", pa.bool_(), nullable=False),
        pa.field("retrieved_at", pa.timestamp("us", tz="UTC"), nullable=False),
    ]
)

TABLE_SCHEMAS: dict[str, pa.Schema] = {
    "observations": OBS_SCHEMA,
    "entities": ENTITIES_SCHEMA,
    "entity_xref": XREF_SCHEMA,
}

_FREQS = {"A", "S", "Q", "M", "W", "D"}


def validate_table(table: pa.Table, name: str = "observations") -> None:
    """Exact schema, no nulls in non-nullable fields, freq enum, sorted dims keys."""
    if name not in TABLE_SCHEMAS:
        raise ValueError(f"unknown table {name!r}")
    schema = TABLE_SCHEMAS[name]
    if not table.schema.equals(schema):
        raise ValueError(f"{name}: schema mismatch\nexpected:\n{schema}\ngot:\n{table.schema}")
    for f in schema:
        if not f.nullable and table[f.name].null_count:
            raise ValueError(f"{name}.{f.name}: nulls in non-nullable column")
    if name == "observations":
        bad = set(table["freq"].to_pylist()) - _FREQS
        if bad:
            raise ValueError(f"observations.freq: invalid values {sorted(bad)}")
        for dims in table["dims"].to_pylist():
            if dims:
                keys = [k for k, _ in dims]
                if keys != sorted(keys):
                    raise ValueError(f"observations.dims: keys not sorted: {keys}")


def empty_table(name: str = "observations") -> pa.Table:
    return TABLE_SCHEMAS[name].empty_table()


def obs_row_key_sql() -> str:
    return "series_id, period_start, freq, CAST(dims AS VARCHAR)"
