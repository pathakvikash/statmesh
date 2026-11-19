from datetime import date

import pytest

from statmesh.core.periods import parse_period


@pytest.mark.parametrize(
    ("s", "fm", "expect"),
    [
        ("2024", 1, (date(2024, 1, 1), date(2024, 12, 31), "A")),
        ("2024", 4, (date(2024, 4, 1), date(2025, 3, 31), "A")),
        ("2024-25", 4, (date(2024, 4, 1), date(2025, 3, 31), "A")),
        ("2024-25", 1, (date(2024, 4, 1), date(2025, 3, 31), "A")),
        ("2024-Q1", 1, (date(2024, 1, 1), date(2024, 3, 31), "Q")),
        ("2024-Q4", 1, (date(2024, 10, 1), date(2024, 12, 31), "Q")),
        ("2024-Q1", 4, (date(2024, 4, 1), date(2024, 6, 30), "Q")),
        ("2024-Q4", 4, (date(2025, 1, 1), date(2025, 3, 31), "Q")),
        ("2024-S1", 1, (date(2024, 1, 1), date(2024, 6, 30), "S")),
        ("2024-S2", 1, (date(2024, 7, 1), date(2024, 12, 31), "S")),
        ("2024-03", 1, (date(2024, 3, 1), date(2024, 3, 31), "M")),
        ("2024-02", 1, (date(2024, 2, 1), date(2024, 2, 29), "M")),
        ("2024-03-15", 1, (date(2024, 3, 15), date(2024, 3, 15), "D")),
        ("2024-W05", 1, (date(2024, 1, 29), date(2024, 2, 4), "W")),
        ("2024Q2", 1, (date(2024, 4, 1), date(2024, 6, 30), "Q")),
    ],
)
def test_parse_period(s, fm, expect):
    assert parse_period(s, fm) == expect


@pytest.mark.parametrize("s", ["", "abc", "2024-13", "2024-Q5", "24"])
def test_parse_period_bad(s):
    with pytest.raises(ValueError):
        parse_period(s)
