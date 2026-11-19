import tempfile
from dataclasses import replace
from pathlib import Path

from statmesh.settings import Settings
from statmesh.testing.contract import ContractSuite


class TestContract(ContractSuite):
    connector_id = "imf"

    def settings(self) -> Settings:  # the structure cache must not write into the repo
        return replace(Settings.from_env(), data_dir=Path(tempfile.mkdtemp()))

    def test_cpi_yoy_unit_set(self):
        c = self._connector()
        rows = [r for t in self._obs_tables(c, self._chunks(c)) for r in t.to_pylist()]
        yoy = [r for r in rows if r["indicator_id"].endswith("YOY_PCH_PA_PT")]
        assert yoy and {r["unit"] for r in yoy} == {"Percent change, year over year"}
