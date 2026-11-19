"""The W0 toy connector, replayed from its recorded fixtures, through discover + ingest."""

from pathlib import Path

import pyarrow.parquet as pq

from statmesh.core.catalog import Catalog
from statmesh.core.connector import load_connector
from statmesh.core.models import FetchRequest
from statmesh.core.storage import Storage
from statmesh.ingest.runner import discover, ingest
from statmesh.settings import Settings
from statmesh.testing.fixtures import replay_http


def test_toy_discover_and_ingest(tmp_path):
    settings = Settings(
        data_dir=tmp_path / "data",
        connectors_dir=Path(__file__).parents[1] / "toy_connector/connectors",
    )
    cat = Catalog(tmp_path / "data" / "catalog.sqlite")
    http, toy = replay_http("toy", settings), load_connector("toy", settings)
    assert discover("toy", settings, cat, http=http, connector=toy) == 1
    req = FetchRequest("T1", ("UNEMP",))
    assert ingest("toy", "T1", settings, cat, http=http, connector=toy, requests=[req]) == 5
    st = Storage(settings.data_dir)
    assert sum(pq.read_table(st.abs(p)).num_rows for p in st.read_manifest()["obs"]["toy/T1"]) == 5
    assert cat.get_dataset("toy", "T1")["status"] == "ingested"
