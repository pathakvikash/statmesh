import { buildQuery, type BuildQuery } from "./sql-builder";

export type SqlExample = { id: string; group: "Jobs" | "Prices" | "Economy" | "Health" | "Trade"; title: string; description: string; sql: string };
export const EXAMPLE_GROUPS = ["Jobs", "Prices", "Economy", "Health", "Trade"] as const;

const STATES = ["IN-MH", "IN-KL", "IN-UP", "IN-BR", "IN-TN", "IN-KA", "IN-GJ", "IN-WB", "IN-RJ", "IN-DL"];
const UR = { age_group: "15 years and above", gender: "person", sector: "rural + urban", weekly_status: "PS+SS", religion: "", social_group: "" }; // the all-persons headline, without religion or caste splits
const ex = (id: string, group: SqlExample["group"], title: string, description: string, q: Omit<BuildQuery, "geoNames">): SqlExample =>
  ({ id, group, title, description, sql: buildQuery(q).sql });

// Every series below is in the demo catalog or a connector in src/statmesh/connectors. State-level ones
// (PLFS, state GSDP, DHS/NFHS) need those datasets loaded; they return no rows otherwise.
export const EXAMPLES: SqlExample[] = [
  ex("unemployment-by-state", "Jobs", "Unemployment rate by state", "The latest unemployment rate from the Periodic Labour Force Survey for ten large states.",
    { seriesKey: "mospi:plfs_annual:ur", title: "unemployment rate", geos: STATES, show: "latest", dims: UR }),
  ex("unemployment-india", "Jobs", "Unemployment in India over time", "Yearly unemployment rate for all of India from the Periodic Labour Force Survey.",
    { seriesKey: "mospi:plfs_annual:ur", title: "unemployment rate", geos: ["IND"], show: "trend", dims: UR }),
  ex("lfpr-india-monthly", "Jobs", "Share of people in the workforce", "Monthly labour force participation rate for India.",
    { seriesKey: "mospi:plfs_monthly:lfpr", title: "labour force participation rate", geos: ["IND"], show: "trend", fromYear: 2020, freq: "M", dims: { age_group: "15 years and above", gender: "person", sector: "rural + urban" } }),
  ex("inflation-highest-countries", "Prices", "Countries with the highest inflation", "The ten highest year-on-year inflation rates from the IMF, using each country's latest figure.",
    { seriesKey: "imf:CPI:CPI._T.YOY_PCH_PA_PT", title: "yearly inflation", unit: "%", geos: [], show: "topN", n: 10 }),
  ex("gsdp-states", "Economy", "Size of state economies (GSDP)", "Gross State Domestic Product for ten large states, year by year.",
    { seriesKey: "mospi:nas_state_annual:gsdp", title: "Gross State Domestic Product", geos: STATES, show: "compare" }),
  ex("gdp-india", "Economy", "India's GDP over time", "Gross domestic product at current prices, by financial year, on the 2011-12 base using the First Revised Estimates.",
    { seriesKey: "mospi:nas_annual:gdp_current", title: "GDP at current prices", geos: ["IND"], show: "trend", dims: { base_year: "2011-12", revision: "First Revised Estimates" } }),
  ex("policy-rate-india", "Economy", "RBI policy rate", "The central bank policy rate for India since 2015.",
    { seriesKey: "bis:WS_CBPOL:VALUE", title: "policy rate", unit: "%", geos: ["IND"], show: "trend", fromYear: 2015, freq: "M" }),
  ex("factory-output-india", "Economy", "Factory output growth", "Monthly growth in industrial production for India since 2020.",
    { seriesKey: "mospi:iip_monthly:growth_rate", title: "industrial production growth", unit: "%", geos: ["IND"], show: "trend", fromYear: 2020, freq: "M" }),
  ex("stunting-by-state", "Health", "Child stunting by state", "Share of children who are too short for their age (NFHS survey), latest round for ten large states.",
    { seriesKey: "dhs:indicators:CN_NUTS_C_HA2", title: "children stunted", unit: "%", geos: STATES, show: "latest" }),
  ex("infant-mortality-by-state", "Health", "Infant deaths by state", "Deaths of babies under one year per 1,000 births (NFHS survey), latest round.",
    { seriesKey: "dhs:indicators:CM_ECMR_C_IMR", title: "infant mortality rate", unit: "deaths per 1,000 live births", geos: STATES, show: "latest" }),
  ex("life-expectancy-india", "Health", "Life expectancy in India", "Average years a person is expected to live, over time.",
    { seriesKey: "owid:grapher:life-expectancy", title: "life expectancy", unit: "years", geos: ["IND"], show: "trend" }),
  {
    id: "india-exports-usa-hs", group: "Trade", title: "What India sells to the USA", description: "India's exports to the USA in 2024 by product chapter, in USD millions, biggest first.",
    sql: `SELECT dims['hs'] AS hs_chapter, round(sum(value) / 1e6, 1) AS usd_millions, any_value(series_id) AS series_id
FROM observations
WHERE source_id = 'comtrade' AND geo = 'IND'
  AND dims['partner'] = 'USA' AND dims['flow'] = 'X' AND dims['hs_level'] = '2'
  AND year(period_start) = 2024
GROUP BY hs_chapter
ORDER BY usd_millions DESC
LIMIT 20`,
  },
  ex("india-balance-of-payments", "Trade", "India's current account deficit", "The current account deficit as a share of GDP (RBI balance of payments), year by year.",
    { seriesKey: "mospi:rbi_bop:value", title: "current account deficit as a share of GDP", geos: ["IND"], show: "trend", dims: { balance_of_payments: "Current account", trade_category: "CAD/ GDP" } }),
  ex("rupee-exchange-rate", "Trade", "Rupee exchange rate", "Yearly average rupees per US dollar from the RBI.",
    { seriesKey: "mospi:rbi_fx_annual:value", title: "rupees per US dollar", geos: ["IND"], show: "trend", dims: { currency: "US Dollar" } }),
];
