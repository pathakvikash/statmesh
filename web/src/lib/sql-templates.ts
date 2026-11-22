import { sqlLiteral } from "./sql";

export type SqlTemplate = { id: string; title: string; description: string; sql: string };

// Each one runs on the demo data (checked against /query). Edit the codes in WHERE to ask about something else.
export const TEMPLATES: SqlTemplate[] = [
  {
    id: "unemployment-south-asia",
    title: "Unemployment in India, Bangladesh and Vietnam",
    description: "Annual unemployment rate from ILOSTAT since 2015, one column per country.",
    sql: `SELECT period_start,
  max(value) FILTER (WHERE geo = 'IND') AS india,
  max(value) FILTER (WHERE geo = 'BGD') AS bangladesh,
  max(value) FILTER (WHERE geo = 'VNM') AS vietnam
FROM observations
WHERE source_id = 'ilostat' AND freq = 'A'
  AND geo IN ('IND', 'BGD', 'VNM')
  AND period_start >= DATE '2015-01-01'
GROUP BY period_start
ORDER BY period_start`,
  },
  {
    id: "cpi-vs-policy-rate",
    title: "Inflation vs policy rate, G20 (2023)",
    description: "IMF consumer-price inflation next to the average BIS central-bank policy rate.",
    sql: `WITH cpi AS (
  SELECT geo, year(period_start) AS yr, value AS inflation_pct
  FROM observations
  WHERE source_id = 'imf' AND dataset_id = 'CPI' AND indicator_id = 'CPI._T.YOY_PCH_PA_PT'
), rate AS (
  SELECT geo, year(period_start) AS yr, avg(value) AS policy_rate_pct
  FROM observations
  WHERE source_id = 'bis' AND dataset_id = 'WS_CBPOL'
  GROUP BY geo, yr
)
SELECT c.geo, round(c.inflation_pct, 2) AS inflation_pct, round(r.policy_rate_pct, 2) AS policy_rate_pct
FROM cpi c JOIN rate r USING (geo, yr)
WHERE c.yr = 2023 AND c.geo IN (SELECT geo FROM geo_groups WHERE group_id = 'G20')
ORDER BY inflation_pct DESC`,
  },
  {
    id: "latest-per-country",
    title: "Latest value per country for a series",
    description: "The most recent observation for each country. Swap the indicator to try another series.",
    sql: `SELECT geo, value, period_start, unit, series_id
FROM observations
WHERE source_id = 'imf' AND dataset_id = 'CPI' AND indicator_id = 'CPI._T.YOY_PCH_PA_PT'
QUALIFY row_number() OVER (PARTITION BY geo ORDER BY period_start DESC) = 1
ORDER BY value DESC`,
  },
  {
    id: "top10-in-year",
    title: "Top 10 countries by an indicator in a year",
    description: "Highest year-on-year inflation in 2023. Change the indicator and the year.",
    sql: `SELECT geo, value, series_id
FROM observations
WHERE source_id = 'imf' AND indicator_id = 'CPI._T.YOY_PCH_PA_PT'
  AND year(period_start) = 2023
ORDER BY value DESC
LIMIT 10`,
  },
  {
    id: "sources-for-country",
    title: "Which sources cover a country",
    description: "Every dataset that has data for India, with how much and over what period.",
    sql: `SELECT source_id, dataset_id, count(DISTINCT indicator_id) AS indicators, count(*) AS observations,
  min(period_start) AS first_period, max(period_end) AS last_period
FROM observations
WHERE geo = 'IND'
GROUP BY source_id, dataset_id
ORDER BY observations DESC`,
  },
  {
    id: "updated-30-days",
    title: "Series updated in the last 30 days",
    description: "Series whose dataset was refreshed in the past month.",
    sql: `SELECT s.series_key, s.title, d.last_ingested_at
FROM series s
JOIN datasets d ON d.source_id = s.source_id AND d.dataset_id = s.dataset_id
WHERE CAST(d.last_ingested_at AS TIMESTAMP) >= now() - INTERVAL 30 DAY
ORDER BY d.last_ingested_at DESC
LIMIT 100`,
  },
  {
    id: "india-exports-usa-hs",
    title: "India exports to the USA by HS chapter",
    description: "UN Comtrade, 2024, in USD millions, biggest chapters first.",
    sql: `SELECT dims['hs'] AS hs_chapter, round(sum(value) / 1e6, 1) AS usd_millions
FROM observations
WHERE source_id = 'comtrade' AND geo = 'IND'
  AND dims['partner'] = 'USA' AND dims['flow'] = 'X' AND dims['hs_level'] = '2'
  AND year(period_start) = 2024
GROUP BY hs_chapter
ORDER BY usd_millions DESC
LIMIT 20`,
  },
  {
    id: "software-revenue-growth",
    title: "Revenue growth in SIC 7372 (packaged software)",
    description: "SEC EDGAR calendar-year revenue, CY2023 to CY2024, for companies in that industry.",
    sql: `WITH rev AS (
  SELECT dims['cik'] AS cik, dims['frame'] AS frame, max(value) AS revenue
  FROM observations
  WHERE source_id = 'sec_edgar' AND dataset_id = 'frames'
  GROUP BY cik, frame
)
SELECT e.name, round(100 * (b.revenue / a.revenue - 1), 1) AS growth_pct,
  a.revenue AS revenue_cy2023, b.revenue AS revenue_cy2024
FROM entities e
JOIN rev a ON 'cik:' || a.cik = e.entity_id AND a.frame = 'CY2023'
JOIN rev b ON b.cik = a.cik AND b.frame = 'CY2024'
WHERE e.industry_scheme = 'SIC' AND e.industry_code = '7372'
ORDER BY growth_pct DESC`,
  },
  {
    id: "gdp-per-capita",
    title: "GDP per person, joining two sources",
    description: "BEA GDP (millions of current dollars) divided by a Data Commons population series for the same place and year.",
    sql: `SELECT gdp.geo, year(gdp.period_start) AS year,
  round(gdp.value * 1e6 / pop.value) AS gdp_per_person_usd,
  gdp.series_id AS gdp_series, pop.series_id AS population_series
FROM observations gdp
JOIN observations pop ON pop.geo = gdp.geo AND pop.period_start = gdp.period_start
WHERE gdp.source_id = 'bea' AND gdp.dataset_id = 'regional' AND gdp.indicator_id = 'SAGDP1-3'
  AND pop.source_id = 'datacommons' AND pop.indicator_id = 'Count_Person'`,
  },
  {
    id: "redistribute-by-licence",
    title: "What can I redistribute",
    description: "Number of series under each licence, and whether it may be redistributed (yes, no or review).",
    sql: `SELECT licence_name, count(*) AS series, redistribute
FROM series
GROUP BY licence_name, redistribute
ORDER BY redistribute, series DESC`,
  },
  {
    id: "india-policy-rate",
    title: "India policy rate over time",
    description: "BIS central-bank policy rate for India, monthly.",
    sql: `SELECT period_start, value AS policy_rate_pct
FROM observations
WHERE source_id = 'bis' AND dataset_id = 'WS_CBPOL' AND geo = 'IND'
ORDER BY period_start`,
  },
];

/** Three starting points for one source. Columns are those of the datasets and observations views. */
export function sourceStarters(sourceId: string): SqlTemplate[] {
  const id = sqlLiteral(sourceId);
  return [
    {
      id: `starter-datasets-${sourceId}`,
      title: "Datasets in this source",
      description: "Every dataset the source publishes, with its frequency and when we last refreshed it.",
      sql: `SELECT dataset_id, title, freq, status, last_ingested_at
FROM datasets
WHERE source_id = ${id}
ORDER BY dataset_id`,
    },
    {
      id: `starter-indicators-${sourceId}`,
      title: "Top indicators by rows",
      description: "The indicators with the most observations.",
      sql: `SELECT dataset_id, indicator_id, count(*) AS observations
FROM observations
WHERE source_id = ${id}
GROUP BY dataset_id, indicator_id
ORDER BY observations DESC
LIMIT 20`,
    },
    {
      id: `starter-latest-${sourceId}`,
      title: "Latest value per country",
      description: "The most recent observation for each country and indicator. Add an indicator_id filter to focus on one.",
      sql: `SELECT geo, indicator_id, value, period_start, unit
FROM observations
WHERE source_id = ${id}
QUALIFY row_number() OVER (PARTITION BY geo, indicator_id ORDER BY period_start DESC) = 1
ORDER BY geo, indicator_id
LIMIT 200`,
    },
  ];
}
