import json
from datetime import UTC, datetime

from statmesh.core.connector import load_connector
from statmesh.core.models import RawChunk
from statmesh.settings import Settings


def test_series_not_in_manifest_normalizes_with_null_unit():
    c = load_connector("bls", Settings.from_env())
    body = {"Results": {"series": [{"seriesID": "ZZZ999", "data": [
        {"year": "2024", "period": "M01", "value": "1.0"}]}]}}  # fmt: skip
    chunk = RawChunk("bls", "LN", json.dumps(body).encode(), "application/json", "u", {},
                     datetime(2026, 1, 1, tzinfo=UTC))  # fmt: skip
    (row,) = c.normalize(chunk).to_pylist()
    assert row["indicator_id"] == "ZZZ999" and row["unit"] is None and row["value"] == 1.0
