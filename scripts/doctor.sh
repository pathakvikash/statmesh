#!/usr/bin/env bash
# Read-only diagnosis of a local statmesh setup. Exit code = number of failed checks.
#   scripts/doctor.sh
# Warnings and skips do not count as failures.
set -uo pipefail
cd "$(dirname "$0")/.."

if [ -t 1 ]; then G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; N=$'\033[0m'; else G=; R=; Y=; N=; fi
fails=0
ok()   { printf '%sok%s    %s\n' "$G" "$N" "$*"; }
warn() { printf '%swarn%s  %s\n' "$Y" "$N" "$*"; }
fail() { printf '%sFAIL%s  %s\n' "$R" "$N" "$*"; fails=$((fails + 1)); }
skip() { printf 'skip  %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# --- tools -------------------------------------------------------------------
if have uv; then
  ok "uv $(uv --version | awk '{print $2}')"
  # project venv directly: `uv run` could sync, and doctor must stay read-only
  vpy=.venv/bin/python; [ -x "$vpy" ] || vpy=python3
  py=$("$vpy" -c 'import sys; print("%d.%d"%sys.version_info[:2])' 2>/dev/null || true)
  case "$py" in
    3.1[2-9]|3.[2-9][0-9]) ok "python $py (project env)" ;;
    "") fail "python: no usable python (run scripts/bootstrap.sh)" ;;
    *) fail "python $py, need >=3.12" ;;
  esac
else
  fail "uv not found (https://docs.astral.sh/uv/)"
fi
if have node; then
  nm=$(node -p 'process.versions.node.split(".")[0]')
  if [ "$nm" -ge 20 ]; then ok "node $(node -v)"; else fail "node $(node -v), need >=20"; fi
else
  fail "node not found"
fi
if have npm; then ok "npm $(npm -v)"; else fail "npm not found"; fi
[ -d web/node_modules ] && ok "web/node_modules present" || warn "web/node_modules missing (run scripts/bootstrap.sh)"

# --- ports -------------------------------------------------------------------
api_port="${API_PORT:-8000}"
for p in 3000 "$api_port" 8001; do
  [ "$p" = 8000 ] && [ "$api_port" != 8000 ] && continue
  pid=""
  have lsof && pid=$(lsof -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $1" (pid "$2")"}')
  if [ -n "$pid" ]; then
    echo "info  port $p in use by $pid"
  else
    echo "info  port $p free$(have lsof || echo ' (lsof unavailable, cannot tell)')"
  fi
done

# --- data dir ----------------------------------------------------------------
dd="${STATMESH_DATA_DIR:-data}"
case "$dd" in /*) abs="$dd" ;; *) abs="$PWD/$dd" ;; esac
echo "info  STATMESH_DATA_DIR=${STATMESH_DATA_DIR:-<unset>} -> $abs"
db="$abs/catalog.sqlite"
if [ ! -d "$abs" ]; then
  fail "data dir does not exist: $abs"
elif [ ! -f "$db" ]; then
  fail "no catalog.sqlite in $abs (demo: scripts/bootstrap.sh; real: statmesh ingest)"
elif [ ! -r "$db" ]; then
  fail "catalog.sqlite not readable: $db"
else
  if have sqlite3; then
    s=$(sqlite3 "file:$db?immutable=1" 'select count(*) from sources' 2>&1) \
      && n=$(sqlite3 "file:$db?immutable=1" 'select count(*) from series' 2>&1) \
      && ok "catalog: $s sources, $n series" || fail "catalog unreadable by sqlite3: $s"
  else
    ok "catalog.sqlite present (sqlite3 not installed, counts skipped)"
  fi
fi
if [ -d "$abs" ]; then
  df -Pk "$abs" 2>/dev/null | awk 'NR==2{printf "info  disk: %.1f GB free (%s used) on %s\n",$4/1048576,$5,$6}'
  free_kb=$(df -Pk "$abs" 2>/dev/null | awk 'NR==2{print $4}')
  [ -n "$free_kb" ] && [ "$free_kb" -lt 1048576 ] && warn "less than 1 GB free for the data dir"
fi

# --- env sanity --------------------------------------------------------------
dis=",${STATMESH_DISABLE:-},"
if [ -n "${STATMESH_CONTACT_EMAIL:-}" ]; then
  case "$STATMESH_CONTACT_EMAIL" in *?@?*.?*) ok "STATMESH_CONTACT_EMAIL set" ;; *) fail "STATMESH_CONTACT_EMAIL does not look like an email" ;; esac
elif [[ "$dis" == *,sec_edgar,* ]]; then
  ok "sec_edgar disabled (no contact email needed)"
else
  fail "sec_edgar enabled but STATMESH_CONTACT_EMAIL unset: set it or STATMESH_DISABLE=sec_edgar"
fi
[ -n "${STATMESH_DISABLE:-}" ] && echo "info  STATMESH_DISABLE=$STATMESH_DISABLE"
[ -f .env ] && echo "info  .env present (not read by this script; export vars to check them)" || warn ".env missing"

# --- API ---------------------------------------------------------------------
url="http://127.0.0.1:$api_port/healthz"
if have curl; then
  if code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$url" 2>/dev/null) && [ "$code" != 000 ]; then
    if [ "$code" = 200 ]; then ok "API healthy: $url"; else fail "API answered $code at $url"; fi
  else
    skip "API not running at $url"
  fi
else
  skip "curl not installed, API check skipped"
fi

# --- git ---------------------------------------------------------------------
if git rev-parse --git-dir >/dev/null 2>&1; then
  echo "info  git branch $(git rev-parse --abbrev-ref HEAD), $(git status --porcelain | wc -l | tr -d ' ') uncommitted file(s)"
else
  skip "not a git checkout"
fi

echo
if [ "$fails" -eq 0 ]; then echo "doctor: all checks passed"; else echo "doctor: $fails check(s) failed"; fi
exit "$fails"
