import pytest

from statmesh.testing.contract import ContractSuite


@pytest.fixture(autouse=True)
def _keyless(monkeypatch):
    monkeypatch.delenv("BLS_API_KEY", raising=False)


class TestContract(ContractSuite):
    connector_id = "bls"
