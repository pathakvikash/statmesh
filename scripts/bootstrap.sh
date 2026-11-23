#!/usr/bin/env bash
# One-time (re-runnable) dev setup: check tools, install deps, build demo data, seed .env.
#   scripts/bootstrap.sh [--no-web] [--no-data]
# Idempotent; never overwrites .env; needs no sudo.
set -euo pipefail
cd "$(dirname "$0")/.."

WEB=1; DATA=1
for a in "$@"; do
  case "$a" in
    --no-web) WEB=0 ;;
    --no-data) DATA=0 ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
    *) echo "unknown flag: $a (use --no-web, --no-data)" >&2; exit 2 ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }
say() { echo "==> $*"; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 not found. $2"; }

# --- tools -------------------------------------------------------------------
need uv "Install: https://docs.astral.sh/uv/getting-started/installation/"
say "uv $(uv --version | awk '{print $2}')"
# uv provisions python itself; this confirms >=3.12 resolves for the project.
py=$(uv run --quiet python -c 'import sys; assert sys.version_info>=(3,12); print("%d.%d.%d"%sys.version_info[:3])') \
  || die "python >=3.12 unavailable. Try: uv python install 3.12"
say "python $py"

if [ "$WEB" = 1 ]; then
  need node "Install Node (https://nodejs.org or nvm)."
  need npm "It ships with Node."
  want=20
  if [ -f web/.nvmrc ]; then
    want=$(tr -dc '0-9.' < web/.nvmrc | cut -d. -f1)
  elif [ -f web/package.json ]; then
    e=$(node -p "((require('./web/package.json').engines||{}).node||'')" 2>/dev/null | tr -dc '0-9.' | cut -d. -f1 || true)
    [ -n "$e" ] && want=$e
  fi
  have=$(node -p 'process.versions.node.split(".")[0]')
  [ "$have" -ge "$want" ] || die "node $have found, need >=$want"
  say "node $(node -v) (need >=$want), npm $(npm -v)"
fi

# --- dependencies ------------------------------------------------------------
say "uv sync --extra sdk"
uv sync --extra sdk

if [ "$WEB" = 1 ]; then
  if [ -f web/package-lock.json ]; then
    say "npm ci (web/)"
    (cd web && npm ci)
  else
    say "no lockfile: npm install (web/)"
    (cd web && npm install)
  fi
fi

# --- demo data ---------------------------------------------------------------
if [ "$DATA" = 1 ]; then
  if [ -f demo-data/catalog.sqlite ]; then
    say "demo data present (demo-data/catalog.sqlite)"
  else
    say "building demo data"
    uv run python -c "from statmesh.testing.fixture_catalog import build; build('demo-data')"
  fi
fi

# --- .env --------------------------------------------------------------------
if [ -f .env ]; then
  say ".env exists, left untouched"
elif [ -f .env.example ]; then
  cp .env.example .env
  say "created .env from .env.example"
  echo "    All keys are optional. STATMESH_CONTACT_EMAIL is needed only for SEC EDGAR"
  echo "    (otherwise set STATMESH_DISABLE=sec_edgar; scripts/dev.sh does this by default)."
  echo "    Free API keys (FRED, BLS, EIA, ...) unlock more sources; sources work keyless where they can."
else
  echo "warning: no .env.example found, skipped .env" >&2
fi

cat <<'MSG'

Done. Next:
  scripts/dev.sh       run API + web on demo data (scripts/dev.sh real for your own data)
  scripts/check.sh     run everything CI runs
  scripts/doctor.sh    diagnose a broken setup
MSG
