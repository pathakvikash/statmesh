from statmesh.testing.contract import ContractSuite


class TestContract(ContractSuite):
    connector_id = "mospi"
    # pre-2020 Daman & Diu and Dadra & Nagar Haveli CPI rows stay unmapped (distinct from IN-DH)
    max_unmapped = 0.10
