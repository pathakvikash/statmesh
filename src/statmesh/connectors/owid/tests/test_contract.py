from statmesh.testing.contract import ContractSuite


class TestContract(ContractSuite):
    connector_id = "owid"
    discover_limit = 4  # the recorded discover: first four core slugs
