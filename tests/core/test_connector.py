from pathlib import Path

import pytest

from statmesh.core.connector import connector_dir, list_connectors, load_connector
from statmesh.settings import Settings

TOY = Path(__file__).parent.parent / "toy_connector" / "connectors"
MANIFEST = """id: {id}
name: X
kind: {kind}
licence: {{name: n, url: u, redistribute: "yes", attribution: a}}
"""


def test_list_and_load_toy():
    s = Settings(connectors_dir=TOY)
    assert "toy" in list_connectors(s)
    assert "toy" not in list_connectors(Settings(connectors_dir=TOY, disabled=frozenset({"toy"})))
    assert connector_dir("toy", s) == TOY / "toy"
    assert load_connector("toy", s).manifest.id == "toy"


def test_unknown_and_id_mismatch(tmp_path):
    s = Settings(connectors_dir=tmp_path)
    with pytest.raises(KeyError):
        load_connector("nope", s)
    (tmp_path / "abc").mkdir()
    (tmp_path / "abc" / "manifest.yaml").write_text(MANIFEST.format(id="other", kind="custom"))
    with pytest.raises(ValueError, match="folder"):
        load_connector("abc", s)


def test_rest_without_code_is_error(tmp_path):
    (tmp_path / "abc").mkdir()
    (tmp_path / "abc" / "manifest.yaml").write_text(MANIFEST.format(id="abc", kind="rest"))
    with pytest.raises(ValueError, match="connector.py"):
        load_connector("abc", Settings(connectors_dir=tmp_path))


def test_generic_kind_resolves_to_its_class(tmp_path):
    (tmp_path / "abc").mkdir()
    (tmp_path / "abc" / "manifest.yaml").write_text(MANIFEST.format(id="abc", kind="sdmx"))
    assert (
        type(load_connector("abc", Settings(connectors_dir=tmp_path))).__name__ == "SdmxConnector"
    )
