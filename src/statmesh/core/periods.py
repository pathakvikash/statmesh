from __future__ import annotations

import calendar
import re
from datetime import date, timedelta

from statmesh.core.models import Freq


def _month_end(y: int, m: int) -> date:
    return date(y, m, calendar.monthrange(y, m)[1])


def _add_months(y: int, m: int, n: int) -> tuple[int, int]:
    i = y * 12 + (m - 1) + n
    return i // 12, i % 12 + 1


def parse_period(s: str, fiscal_start_month: int = 1) -> tuple[date, date, Freq]:
    """'2024' '2024-Q1' '2024-03' '2024-03-15' '2024-S1' '2024-W05' '2024-25' -> (start, end, freq).

    With fiscal_start_month=4, '2024' and '2024-25' are the year starting April 2024; '2024-Q1'
    is the first quarter of that fiscal year. '2024-25' with the default month 1 is read as
    April-March (a month value above 12 cannot be a month). '2011-12' is ambiguous: with the
    default it is December 2011; with a fiscal start month it is the fiscal year.
    """
    s = s.strip()
    fm = fiscal_start_month

    def year_range(y: int, sm: int = fm) -> tuple[date, date]:
        ey, em = _add_months(y, sm, 11)
        return date(y, sm, 1), _month_end(ey, em)

    if m := re.fullmatch(r"(\d{4})", s):
        a, b = year_range(int(m[1]))
        return a, b, "A"
    if m := re.fullmatch(r"(\d{4})-?M(\d{2})", s):  # 2024M03, 2024-M03
        y, n = int(m[1]), int(m[2])
        if not 1 <= n <= 12:
            raise ValueError(f"bad period {s!r}")
        return date(y, n, 1), _month_end(y, n), "M"
    if m := re.fullmatch(r"(\d{4})-(\d{2})", s):
        y, n = int(m[1]), int(m[2])
        if n == (y + 1) % 100 and (fm != 1 or not 1 <= n <= 12):  # fiscal '2024-25'
            a, b = year_range(y, fm if fm != 1 else 4)
            return a, b, "A"
        if not 1 <= n <= 12:
            raise ValueError(f"bad period {s!r}")
        return date(y, n, 1), _month_end(y, n), "M"
    if m := re.fullmatch(r"(\d{4})-?Q([1-4])", s):
        y, q = int(m[1]), int(m[2])
        sy, sm = _add_months(y, fm, (q - 1) * 3)
        ey, em = _add_months(sy, sm, 2)
        return date(sy, sm, 1), _month_end(ey, em), "Q"
    if m := re.fullmatch(r"(\d{4})-?S([12])", s):
        y, h = int(m[1]), int(m[2])
        sy, sm = _add_months(y, fm, (h - 1) * 6)
        ey, em = _add_months(sy, sm, 5)
        return date(sy, sm, 1), _month_end(ey, em), "S"
    if m := re.fullmatch(r"(\d{4})-?W(\d{2})", s):
        y, w = int(m[1]), int(m[2])
        start = date.fromisocalendar(y, w, 1)
        return start, start + timedelta(days=6), "W"
    if m := re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", s):
        d = date(int(m[1]), int(m[2]), int(m[3]))
        return d, d, "D"
    raise ValueError(f"unrecognised period {s!r}")
