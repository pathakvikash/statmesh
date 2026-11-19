from statmesh.testing.contract import ContractSuite


class TestContract(ContractSuite):
    connector_id = "esef"

    def test_dims_are_identity_only_and_comparatives_do_not_duplicate(self):
        c = self._connector()
        chunks = [ch for ch in self._chunks(c) if ch.table == "observations"]
        rows = [r for ch in chunks for r in c.normalize(ch).to_pylist()]
        assert rows and all(set(dict(r["dims"])) == {"lei"} for r in rows)
        keys = [(r["series_id"], r["period_start"], r["freq"], tuple(r["dims"])) for r in rows]
        assert len(keys) == len(set(keys))  # no filing's comparative repeats a newer filing's fact

    def test_superseded_facts_are_dropped_from_older_filing(self):
        import json
        from dataclasses import replace

        c = self._connector()
        ch = next(ch for ch in self._chunks(c) if ch.table == "observations")
        keys = sorted(f["key"] for f in c._iter_facts(json.loads(ch.content)))
        full = c.normalize(ch).num_rows
        assert full == len(keys) > 1
        part = c.normalize(replace(ch, meta={**ch.meta, "superseded": keys[:1]}))
        assert part.num_rows == full - 1
        assert c.normalize(replace(ch, meta={**ch.meta, "superseded": keys})).num_rows == 0
