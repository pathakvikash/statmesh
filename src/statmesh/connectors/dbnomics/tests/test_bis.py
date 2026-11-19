from statmesh.testing.contract import ContractSuite


class TestBisPolicyRates(ContractSuite):
    connector_id = "dbnomics"

    def test_q4_policy_rate_rows(self):
        c = self._connector()
        rows = [r for t in self._obs_tables(c, self._chunks(c)) for r in t.to_pylist()]
        assert {r["geo"] for r in rows} == {"USA", "IND"}
        assert {r["series_id"].rsplit(":", 1)[0] for r in rows} == {"dbnomics:BIS_WS_CBPOL:M"}
        assert all(r["freq"] == "M" for r in rows)

    def test_dataset_series_expanded(self):
        # core_datasets is empty (decision 2), so ask for the dataset's series explicitly
        s = self._connector()._series(self._http(), "BIS_WS_CBPOL")
        assert "M" in {x.indicator_id for x in s} and {"USA", "IND"} <= set(s[0].geos) | set(
            s[-1].geos
        )


def test_null_value_becomes_missing_row():
    import dataclasses
    import json

    c = TestBisPolicyRates()._connector()
    chunk = TestBisPolicyRates()._chunks(c)[0]
    body = json.loads(chunk.content)
    body["series"]["docs"][0]["value"][0] = None
    rows = c.normalize(dataclasses.replace(chunk, content=json.dumps(body).encode())).to_pylist()
    assert rows[0]["value"] is None and rows[0]["obs_status"] == "missing"
