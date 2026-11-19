from statmesh.testing.contract import ContractSuite


class TestContract(ContractSuite):
    connector_id = "worldbank"
    discover_limit = 2  # the recorded discover page; discover(limit=n) requests per_page=n
