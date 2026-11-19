import tempfile
from dataclasses import replace
from pathlib import Path

from statmesh.settings import Settings
from statmesh.testing.contract import ContractSuite


class TestContract(ContractSuite):
    connector_id = "eurostat"

    def settings(self) -> Settings:  # the structure cache must not write into the repo
        return replace(Settings.from_env(), data_dir=Path(tempfile.mkdtemp()))

    def test_ea19_does_not_collide_with_ea20(self):
        from statmesh.core.geo import to_geo

        c = self._connector()
        got = {k: to_geo(k, "iso2", c.geo_map) for k in ("EA20", "EA19")}
        assert got == {"EA20": "region:EMU", "EA19": "unmapped:EA19"}
        assert c._rev["region:EMU"] == "EA20"  # reverse mapping (sdmx.py) still picks EA20
