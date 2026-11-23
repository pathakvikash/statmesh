#!/usr/bin/env bash
# One command to run statmesh locally: API + web, on the demo data, both stopped with Ctrl-C.
#   scripts/dev.sh            demo data (built on first run)
#   scripts/dev.sh real       your own data dir (STATMESH_DATA_DIR, default ./data)
# Ports: API_PORT (default 8000), WEB_PORT (default 3000).
set -euo pipefail
cd "$(dirname "$0")/.."

API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-3000}"

for p in "$API_PORT" "$WEB_PORT"; do
  if lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $p is already in use. Stop that process or set API_PORT / WEB_PORT." >&2
    exit 1
  fi
done

export STATMESH_DISABLE="${STATMESH_DISABLE:-sec_edgar}" # SEC EDGAR needs STATMESH_CONTACT_EMAIL
if [ "${1:-demo}" = "demo" ]; then
  export STATMESH_DATA_DIR="$PWD/demo-data"
  if [ ! -f "$STATMESH_DATA_DIR/catalog.sqlite" ]; then
    echo "Building demo data (first run only)..."
    uv run python -c "from statmesh.testing.fixture_catalog import build; build('demo-data')"
  fi
fi

[ -d web/node_modules ] || (cd web && npm install)

uv run statmesh serve --port "$API_PORT" &
api=$!
(cd web && STATMESH_API_URL="http://127.0.0.1:$API_PORT" npm run dev -- --port "$WEB_PORT") &
web=$!
trap 'kill $api $web 2>/dev/null; wait 2>/dev/null' INT TERM EXIT

echo
echo "  web  http://localhost:$WEB_PORT"
echo "  api  http://127.0.0.1:$API_PORT   (data: ${STATMESH_DATA_DIR:-./data})"
echo "  Ctrl-C stops both."
wait
