from statmesh.testing.contract import ContractSuite


class TestFredLicence(ContractSuite):
    """Fixtures are synthetic (no FRED key yet); the tag-to-series pairing is invented."""

    connector_id = "fred"

    def test_copyright_tag_sets_series_licence(self):
        (ds,) = self._connector().discover(self._http())
        got = {s.indicator_id: s.licence.redistribute for s in ds.series}
        assert got == {"UNRATE": "yes", "CPIAUCSL": "review", "FEDFUNDS": "review", "GDP": "no"}

    def test_units_and_freq_from_metadata(self):
        (ds,) = self._connector().discover(self._http())
        gdp = next(s for s in ds.series if s.indicator_id == "GDP")
        assert (gdp.freq, gdp.unit) == ("Q", "Billions of Dollars")
        t = self._connector().normalize(self._chunks()[1])
        assert (
            t["unit_mult"][0].as_py() == 0  # unit text already says Billions
            and t["unit"][0].as_py() == "Billions of Dollars"
            and t["period_end"][0].as_py().isoformat() == "2023-03-31"
        )

    def test_weekly_ending_dates_are_period_ends(self):
        import json
        from dataclasses import replace

        base = self._chunks()[1]
        obs = {"observations": [{"date": "2024-01-12", "value": "1.0"}]}
        for short, text, span in (
            ("W", "Weekly, Ending Friday", 6),
            ("BW", "Biweekly, Ending Wednesday", 13),
        ):
            chunk = replace(
                base,
                content=json.dumps(obs).encode(),
                meta={**base.meta, "freq": short, "freq_text": text},
            )
            t = self._connector().normalize(chunk)
            assert t["period_end"][0].as_py().isoformat() == "2024-01-12"
            assert (t["period_end"][0].as_py() - t["period_start"][0].as_py()).days == span
            assert t["freq"][0].as_py() == "W"

    def test_attribution_notice(self):
        assert "not endorsed or certified by the Federal Reserve Bank of St. Louis" in (
            self._connector().manifest.licence.attribution
        )
