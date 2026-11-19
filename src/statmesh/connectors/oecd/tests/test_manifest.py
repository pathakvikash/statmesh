from statmesh.core.connector import load_connector
from statmesh.settings import Settings


def test_weekly_full_refresh_and_core_capped():
    m = load_connector("oecd", Settings.from_env()).manifest
    assert m.refresh.incremental is None  # updatedAfter returns 403 (2026-11)
    assert m.refresh.schedule == "0 2 * * 1"
    assert len(m.core_datasets) <= 5
