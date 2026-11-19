from pathlib import Path

from statmesh.settings import Settings
from statmesh.testing.contract import ContractSuite


class TestContract(ContractSuite):
    connector_id = "toy"

    def settings(self) -> Settings:
        return Settings(connectors_dir=Path(__file__).parent / "connectors")
