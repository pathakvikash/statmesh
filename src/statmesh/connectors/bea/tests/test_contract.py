from statmesh.testing.contract import ContractSuite


class TestContract(ContractSuite):
    connector_id = "bea"

    def test_unit_mult_is_not_double_counted(self):
        """Regional CL_UNIT names the scale -> mult 0; NIPA's bare "Level" keeps UNIT_MULT 6."""
        c = self._connector()
        nipa, regional = (c.normalize(ch) for ch in self._chunks())
        assert set(nipa["unit"].to_pylist()) == {"Level"}
        assert set(nipa["unit_mult"].to_pylist()) == {6}
        assert "Millions of chained 2017 dollars" in regional["unit"].to_pylist()
        assert set(regional["unit_mult"].to_pylist()) == {0}
