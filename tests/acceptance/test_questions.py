"""v1 acceptance gate: the four spec questions, offline, through REST and through MCP.

Each test does what an agent would: search -> describe -> observations / run_sql, and checks the
answer carries citations. Data comes from the recorded connector fixtures, so coverage is whatever
was recorded (stated per question).
"""


def ids(res):
    return [h["series_id"] for h in res["hits"]]


def rows(res):
    return [dict(zip(res["columns"], r, strict=True)) for r in res["rows"]]


def cited(res):
    return {(c["source_id"], c["dataset_id"]) for c in res["citations"]}


def test_q1_unemployment_ind_bgd_vnm(api):
    """ILOSTAT DF_UNE_DEAP_SEX_AGE_RT, 2015 -> latest; recorded 2018-2022 (BGD: 2022 only)."""
    key = "ilostat:DF_UNE_DEAP_SEX_AGE_RT:UNE_DEAP_RT"
    assert key in ids(api.search("unemployment rate", source="ilostat"))
    d = api.describe(key)
    assert d["citation"]["source_name"].startswith("ILOSTAT")
    assert d["citation"]["licence_name"] == "CC BY 4.0"
    for geo in ("IND", "BGD", "VNM"):  # the per-series route an agent takes first
        o = api.observations(f"{key}:{geo}")
        assert o["status"] == "ok" and o["rows"] and o["citations"][0]["source_id"] == "ilostat"
    res = api.sql(
        "SELECT geo, period_start, value, series_id FROM observations "
        f"WHERE series_id IN ('{key}:IND','{key}:BGD','{key}:VNM') "
        "AND period_start >= DATE '2015-01-01' ORDER BY geo, period_start"
    )
    got = rows(res)
    assert {r["geo"] for r in got} == {"IND", "BGD", "VNM"}
    assert all(r["value"] is not None for r in got)
    assert {r["geo"]: max(x["period_start"] for x in got if x["geo"] == r["geo"]) for r in got} == {
        "IND": "2022-01-01", "BGD": "2022-01-01", "VNM": "2022-01-01",
    }  # fmt: skip
    c = res["citations"]
    assert [x["source_id"] for x in c] == ["ilostat"]
    assert "ILOSTAT" in c[0]["attribution"] and c[0]["licence_name"] == "CC BY 4.0"
    assert c[0]["licence_url"]


Q2 = """
WITH y AS (
  SELECT dims['hs'] AS hs, year(period_start) AS yr, sum(value) AS usd
  FROM observations
  WHERE source_id='comtrade' AND dataset_id='HS-A' AND indicator_id='X' AND geo='IND'
    AND dims['partner']='USA' AND dims['hs_level']='2'
  GROUP BY 1, 2)
SELECT 'comtrade' AS source_id, 'HS-A' AS dataset_id, a.hs,
       (SELECT max(yr) FROM y) AS latest_year, a.usd AS latest_usd,
       (SELECT max(yr) - 5 FROM y) AS earlier_year, b.usd AS earlier_usd
FROM y a JOIN y b ON b.hs = a.hs
WHERE a.yr = (SELECT max(yr) FROM y) AND b.yr = (SELECT max(yr) - 5 FROM y)
ORDER BY a.usd DESC
"""


def test_q2_india_to_usa_exports_by_hs_chapter(api):
    """Comtrade on-demand cache: IND->USA exports, HS 2-digit, 2024 vs 2019."""
    assert "comtrade:HS-A:X" in ids(api.search("exports of goods by HS commodity"))
    d = api.describe("comtrade:HS-A:X:IND")
    assert d["citation"]["source_id"] == "comtrade"
    res = api.sql(Q2)
    got = rows(res)
    assert len(got) > 50 and not res["truncated"]
    assert {(r["latest_year"], r["earlier_year"]) for r in got} == {(2024, 2019)}
    assert all(r["latest_usd"] > 0 and r["earlier_usd"] > 0 for r in got)
    assert [r["latest_usd"] for r in got] == sorted((r["latest_usd"] for r in got), reverse=True)
    assert {r["hs"] for r in got} >= {"85", "30", "71"}  # electrical, pharma, gems
    assert cited(res) == {("comtrade", "HS-A")}  # every row's (source, dataset) is cited
    assert res["citations"][0]["licence_name"] and res["citations"][0]["redistribute"] == "no"


Q3 = """
WITH f AS (  -- one revenue per company and frame: filers report under several tags
  SELECT dims['cik'] AS cik, dims['frame'] AS fr, max(value) AS rev
  FROM observations WHERE source_id='sec_edgar' AND dataset_id='frames' GROUP BY 1, 2),
g AS (
  SELECT cik, max(rev) FILTER (WHERE fr = (SELECT max(fr) FROM f)) AS cur,
         max(rev) FILTER (WHERE fr = (SELECT min(fr) FROM f)) AS prev
  FROM f GROUP BY cik)
SELECT 'sec_edgar' AS source_id, 'frames' AS dataset_id, e.name, e.industry_code,
       g.prev, g.cur, g.cur / g.prev - 1 AS growth
FROM g JOIN entities e ON e.entity_id = 'cik:' || g.cik
WHERE e.industry_scheme = 'SIC' AND e.industry_code = '7372' AND g.prev > 0 AND g.cur IS NOT NULL
ORDER BY growth DESC
"""


def test_q3_sic_industry_by_revenue_growth(api):
    """SEC EDGAR frames CY2023 vs CY2024 + entities: SIC 7372 (prepackaged software); recorded
    companies are Microsoft, Oracle, Adobe only."""
    assert any(
        i.startswith("sec_edgar:frames:") for i in ids(api.search("revenue", source="sec_edgar"))
    )
    res = api.sql(Q3)
    got = rows(res)
    assert [r["name"] for r in got] == ["MICROSOFT CORP", "ADOBE INC.", "ORACLE CORP"]
    assert len(got) == len({r["name"] for r in got})  # duplicate concepts collapsed per CIK
    assert [r["growth"] for r in got] == sorted((r["growth"] for r in got), reverse=True)
    assert round(got[0]["growth"], 4) == round(245122 / 211915 - 1, 4)
    assert round(got[2]["growth"], 4) == round(57399 / 52961 - 1, 4)  # Oracle: two tags, one row
    assert {("sec_edgar", "frames"), ("sec_edgar", "entities")} <= cited(res)  # + companyconcept
    assert res["citations"][0]["licence_name"].startswith("US Government")


Q4 = """
SELECT o.geo, year(o.period_start) AS yr, o.value AS cpi_yoy, p.rate AS policy_rate,
       'imf:CPI:CPI._T.YOY_PCH_PA_PT' AS cpi_series, 'bis:WS_CBPOL:VALUE' AS policy_series
FROM observations o
JOIN (SELECT geo, year(period_start) AS y, avg(value) AS rate FROM observations
      WHERE series_id LIKE 'bis:WS_CBPOL:VALUE:%'
      GROUP BY 1, 2) p ON p.geo = o.geo AND p.y = year(o.period_start)
WHERE o.source_id='imf' AND o.dataset_id='CPI' AND o.indicator_id='CPI._T.YOY_PCH_PA_PT'
  AND o.geo IN (SELECT geo FROM geo_groups WHERE group_id = 'G20')
ORDER BY o.geo, yr
"""

# Q4 filters bis on series_id, not source_id: a bare source literal cites all of bis' datasets.
# G20 members with a BIS policy rate recorded (BIS reports DEU/FRA/ITA only as the euro area,
# region:EMU, which is not a G20 member geo).
Q4_GEOS = {"ARG", "AUS", "BRA", "CAN", "CHN", "GBR", "IDN", "IND", "JPN", "KOR", "MEX", "RUS",
           "SAU", "TUR", "USA", "ZAF"}  # fmt: skip


def test_q4_cpi_vs_policy_rate_g20(api):
    """IMF CPI y/y (annual, all 19 G20 countries recorded) joined on geo + year with the BIS
    WS_CBPOL policy rate (monthly, averaged per year; recorded 2022-2023 for 16 G20 members)."""
    assert "imf:CPI:CPI._T.YOY_PCH_PA_PT" in ids(
        api.search("consumer price inflation", source="imf")
    )
    assert "bis:WS_CBPOL:VALUE" in ids(api.search("central bank policy rate", source="bis"))
    for sid in ("imf:CPI:CPI._T.YOY_PCH_PA_PT", "bis:WS_CBPOL:VALUE"):
        assert api.describe(sid)["citation"]["licence_name"]
    res = api.sql(Q4)
    got = rows(res)
    assert {r["geo"] for r in got} == Q4_GEOS
    assert {(r["geo"], r["yr"]) for r in got} == {(g, y) for g in Q4_GEOS for y in (2022, 2023)}
    usa22 = next(r for r in got if (r["geo"], r["yr"]) == ("USA", 2022))
    assert 7 < usa22["cpi_yoy"] < 9 and 1 < usa22["policy_rate"] < 3
    assert all(r["cpi_yoy"] is not None and r["policy_rate"] is not None for r in got)
    assert cited(res) == {("imf", "CPI"), ("bis", "WS_CBPOL")}  # both sources cited
    assert {c["source_id"] for c in res["citations"]} == {"imf", "bis"}
    bis = next(c for c in res["citations"] if c["source_id"] == "bis")
    assert (
        bis["redistribute"] == "yes" and "Bank for International Settlements" in bis["attribution"]
    )
    g20 = api.sql(
        "SELECT count(DISTINCT geo) AS n FROM observations WHERE source_id='imf' "
        "AND geo IN (SELECT geo FROM geo_groups WHERE group_id='G20')"
    )
    assert g20["rows"] == [[19]]
