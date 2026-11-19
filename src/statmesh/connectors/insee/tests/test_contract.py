import tempfile
from dataclasses import replace
from pathlib import Path

from statmesh.settings import Settings
from statmesh.testing.contract import ContractSuite


class TestContract(ContractSuite):
    connector_id = "insee"

    def settings(self) -> Settings:  # the structure cache must not write into the repo
        return replace(Settings.from_env(), data_dir=Path(tempfile.mkdtemp()))

    def test_france_deaths_mapped_to_fra(self):
        c = self._connector()
        rows = [r for t in self._obs_tables(c, self._chunks(c)) for r in t.to_pylist()]
        assert rows and {r["geo"] for r in rows} == {"FRA"}
        assert {r["indicator_id"] for r in rows} == {"DECES_DOMICILIES"}
