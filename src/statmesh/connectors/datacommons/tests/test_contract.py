from statmesh.testing.contract import ContractSuite


class TestContract(ContractSuite):
    connector_id = "datacommons"

    def test_dims_hold_no_provenance(self):
        c = self._connector()
        rows = [r for t in self._obs_tables(c, self._chunks(c)) for r in t.to_pylist()]
        assert rows and all(not r["dims"] for r in rows)
