#!/usr/bin/env bash
# Runs the pilot personas' questions against the offline fixture demo data.
# Offline, no keys. Builds a fresh catalog in a temp dir and deletes it on exit.
# Usage: bash docs/pilots/demo.sh   (from anywhere)
# Exits 1 if any question fails or returns no rows.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/statmesh-demo.XXXXXX")"
trap 'rm -rf "$DATA_DIR"' EXIT
export STATMESH_DATA_DIR="$DATA_DIR" STATMESH_DISABLE=sec_edgar
export UV_CACHE_DIR="${UV_CACHE_DIR:-${TMPDIR:-/tmp}/uvcache}"

sm() { uv run --offline statmesh "$@"; }

echo "Building fixture demo data in a temp dir (offline)..."
uv run --offline python -c "
from statmesh.testing.fixture_catalog import build
_, errors = build('$DATA_DIR')
assert not errors, errors
"
echo "Build OK."

QUESTIONS=0
ROWS_TOTAL=0
FAILED=0

# ask PERSONA QUESTION MODE ARG   (MODE: search | sql; ARG: search text or SQL)
ask() {
  local persona="$1" question="$2" mode="$3" arg="$4" out lines rows
  QUESTIONS=$((QUESTIONS + 1))
  echo
  echo "[$persona] $question"
  if [[ "$mode" == search ]]; then
    out="$(sm search "$arg" --local --limit 5)" || out=""
  else
    out="$(sm sql --local "$arg")" || out=""
  fi
  lines="$(awk 'NF' <<<"$out" | wc -l | tr -d ' ')"
  rows=$((lines > 0 ? lines - 1 : 0))  # first line is the CSV header
  if [[ "$rows" -eq 0 ]]; then
    echo "  FAIL: no rows returned"
    FAILED=$((FAILED + 1))
    return
  fi
  ROWS_TOTAL=$((ROWS_TOTAL + rows))
  echo "  rows: $rows"
  head -n 5 <<<"$out" | sed 's/^/  /'
}

echo
echo "== Newsroom =="
ask newsroom "How high is unemployment in India?" search "unemployment rate India"
ask newsroom "What was India's unemployment rate from 2018 to 2022?" sql \
  "SELECT series_id, geo, period_start, value FROM observations WHERE series_id='ilostat:DF_UNE_DEAP_SEX_AGE_RT:UNE_DEAP_RT:IND' ORDER BY period_start"
ask newsroom "What was the US unemployment rate each month of 2023 and 2024?" sql \
  "SELECT series_id, period_start, value FROM observations WHERE series_id='bls:LN:LNS14000000:USA' ORDER BY period_start"
ask newsroom "How fast are consumer prices rising in Germany, France and Italy in 2024?" sql \
  "SELECT series_id, geo, period_start, value FROM observations WHERE series_id LIKE 'ecb:ICP:000000.ANR:%' AND geo IN ('DEU','FRA','ITA') ORDER BY geo, period_start"
ask newsroom "What is the central bank policy rate in the US and India?" sql \
  "SELECT series_id, geo, period_start, value FROM observations WHERE series_id IN ('bis:WS_CBPOL:VALUE:USA','bis:WS_CBPOL:VALUE:IND') AND freq='M' ORDER BY geo, period_start LIMIT 50"
ask newsroom "How has the US population changed since 2010?" sql \
  "SELECT series_id, period_start, value FROM observations WHERE series_id='census:popest:POP:USA' ORDER BY period_start"
ask newsroom "What was US GDP by quarter in 2023?" sql \
  "SELECT series_id, period_start, value FROM observations WHERE series_id='fred:series:GDP:USA' ORDER BY period_start"
ask newsroom "What was India's inflation in 2022 and 2023, according to the IMF?" sql \
  "SELECT series_id, geo, period_start, value FROM observations WHERE series_id='imf:CPI:CPI._T.YOY_PCH_PA_PT:IND' ORDER BY period_start"

echo
echo "== NGO and policy analysts =="
ask ngo "What share of people live in extreme poverty in Brazil and Nigeria?" sql \
  "SELECT series_id, geo, period_start, value FROM observations WHERE series_id LIKE 'unsdg:DF_SDG_GLH:SI_POV_DAY1:%' AND geo IN ('BRA','NGA') ORDER BY geo, period_start"
ask ngo "How did unemployment change in Germany, France, Spain and Greece, 2021 to 2023?" sql \
  "SELECT series_id, geo, period_start, value FROM observations WHERE series_id LIKE 'eurostat:une_rt_a:PC_ACT:%' AND geo IN ('DEU','FRA','ESP','GRC') ORDER BY geo, period_start"
ask ngo "What was unemployment in India and its states, 2024?" sql \
  "SELECT series_id, geo, period_start, value FROM observations WHERE series_id LIKE 'mospi:plfs_annual:ur:%' AND geo IN ('IND','IN-DH','IN-LD') ORDER BY geo"
ask ngo "How does unemployment compare across Bangladesh, India and Vietnam, 2018 to 2022?" sql \
  "SELECT series_id, geo, period_start, value FROM observations WHERE series_id LIKE 'ilostat:DF_UNE_DEAP_SEX_AGE_RT:UNE_DEAP_RT:%' ORDER BY geo, period_start"
ask ngo "Does inflation track the policy rate? IMF CPI joined to BIS policy rates, 2022 and 2023" sql \
  "SELECT c.series_id, c.geo, year(c.period_start) AS yr, c.value AS cpi_yoy_pct, p.rate AS policy_rate_avg FROM observations c JOIN (SELECT geo, year(period_start) AS y, avg(value) AS rate FROM observations WHERE series_id LIKE 'bis:WS_CBPOL:VALUE:%' GROUP BY 1, 2) p ON p.geo = c.geo AND p.y = year(c.period_start) WHERE c.series_id LIKE 'imf:CPI:CPI._T.YOY_PCH_PA_PT:%' AND c.freq = 'A' ORDER BY c.geo, yr"
ask ngo "What is consumer price inflation across OECD countries in 2024?" sql \
  "SELECT series_id, geo, period_start, value FROM observations WHERE series_id LIKE 'oecd:DSD_PRICES@DF_PRICES_ALL:CPI.GY:%' ORDER BY geo, period_start"
ask ngo "How many people live in India, by year?" sql \
  "SELECT series_id, geo, period_start, value FROM observations WHERE series_id='datacommons:stat_vars:Count_Person:IND' ORDER BY period_start"
ask ngo "What is the median age in India and the US?" sql \
  "SELECT series_id, geo, period_start, value FROM observations WHERE series_id LIKE 'datacommons:stat_vars:Median_Age_Person:%' AND geo IN ('IND','USA') ORDER BY geo, period_start"

echo
echo "== Course (students) =="
ask course "Which series cover consumer price inflation?" search "consumer price inflation"
ask course "How do US unemployment figures from BLS and FRED compare in 2023?" sql \
  "SELECT series_id, period_start, value FROM observations WHERE series_id IN ('fred:series:UNRATE:USA','bls:LN:LNS14000000:USA') AND period_start >= DATE '2023-01-01' AND period_start < DATE '2024-01-01' ORDER BY series_id, period_start"
ask course "What was euro-area inflation each month of 2024?" sql \
  "SELECT series_id, geo, period_start, value FROM observations WHERE series_id = 'ecb:ICP:000000.ANR:region:EMU' ORDER BY period_start"
ask course "How did the policy rate move in Japan, the UK and India, 2022 to 2024?" sql \
  "SELECT series_id, geo, period_start, value FROM observations WHERE series_id IN ('bis:WS_CBPOL:VALUE:JPN','bis:WS_CBPOL:VALUE:GBR','bis:WS_CBPOL:VALUE:IND') ORDER BY geo, period_start LIMIT 40"
ask course "How much electricity did the US generate in 2024?" sql \
  "SELECT series_id, period_start, value FROM observations WHERE series_id = 'eia:electricity_generation:generation_ALL:USA' ORDER BY period_start"
ask course "What was the US crude oil price in 2024?" sql \
  "SELECT series_id, period_start, value FROM observations WHERE series_id = 'eia:crude_oil_price:RWTC:USA' ORDER BY period_start"
ask course "What was India's real GDP by quarter in 2023 and 2024?" sql \
  "SELECT series_id, period_start, value FROM observations WHERE series_id = 'mospi:nas_quarterly:gdp_constant:IND' ORDER BY period_start"
ask course "What were a Swedish listed company's total assets in 2020 and 2021?" sql \
  "SELECT series_id, period_start, value FROM observations WHERE series_id = 'esef:facts:Assets:SWE' ORDER BY period_start"

echo
echo "Summary: $QUESTIONS questions, $ROWS_TOTAL rows returned, $FAILED failed."
if [[ "$FAILED" -gt 0 ]]; then
  exit 1
fi
