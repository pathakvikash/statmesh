#!/usr/bin/env bash
# Usage: scripts/env-check.sh [local|hosted]   (default: local; hosted if STATMESH_MODE=hosted)
# Reads ./.env (if present) over the environment. Prints key names and problems, never values.
# Exit code = number of problems.
set -u
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  # Parse KEY=VALUE lines without executing anything; values are never evaluated; .env overrides the environment.
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"
    case "$line" in ''|\#*) continue ;; esac
    line="${line#export }"
    case "$line" in *=*) ;; *) continue ;; esac
    k="${line%%=*}"; v="${line#*=}"
    k="${k%"${k##*[![:space:]]}"}"
    [[ "$k" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    v="${v#"${v%%[![:space:]]*}"}"
    case "$v" in
      \"*\") v="${v:1:${#v}-2}" ;;
      \'*\') v="${v:1:${#v}-2}" ;;
    esac
    export "$k=$v"
  done < .env
  echo "loaded .env"
else echo "no .env (using the environment only)"; fi
target="${1:-}"; [ -z "$target" ] && { [ "${STATMESH_MODE:-}" = hosted ] && target=hosted || target=local; }
problems=0
bad() { echo "PROBLEM: $*"; problems=$((problems + 1)); }
warn() { echo "note:    $*"; }
set_() { [ -n "${!1:-}" ]; }
localish() { case "$1" in *//localhost*|*//127.*|*//\[::1\]*|*.localhost*) return 0 ;; esac; return 1; }
mask() { set_ "$1" && echo "  $1: set (hidden)" || echo "  $1: unset"; }

echo "target: $target"
case "${STATMESH_MODE:-self_host}" in self_host|hosted) ;; *) bad "STATMESH_MODE must be self_host or hosted" ;; esac
[ "$target" = hosted ] && [ "${STATMESH_MODE:-}" != hosted ] && bad "hosted run needs STATMESH_MODE=hosted"

# sec_edgar needs a contact email unless disabled
case ",${STATMESH_DISABLE:-}," in *,sec_edgar,*) ;; *) set_ STATMESH_CONTACT_EMAIL || bad "STATMESH_CONTACT_EMAIL is empty and sec_edgar is enabled (serve/worker/mcp refuse to start)" ;; esac

for v in STATMESH_SQL_TIMEOUT_S STATMESH_SQL_MAX_ROWS STATMESH_SQL_MAX_BYTES STATMESH_FETCH_TIMEOUT_S STATMESH_FETCH_MAX_ROWS STATMESH_FETCH_MAX_WAIT_S STATMESH_EXPORT_MAX_ROWS STATMESH_SHARE_MAX_BYTES STATMESH_SHARE_TTL_DAYS STATMESH_CACHE_MAX_AGE; do
  set_ "$v" && ! [[ "${!v}" =~ ^[0-9]+$ ]] && bad "$v is not a non-negative integer"
done
set_ STATMESH_DUCKDB_MEMORY && ! [[ "$STATMESH_DUCKDB_MEMORY" =~ ^[0-9.]+[KMGT]i?B$ ]] && bad "STATMESH_DUCKDB_MEMORY should look like 512MB or 2GB"

if [ "$target" = hosted ]; then
  [ "${STATMESH_PYTHON_SANDBOX:-}" ] && case "$STATMESH_PYTHON_SANDBOX" in 1|true|yes) bad "STATMESH_PYTHON_SANDBOX must be off when hosted" ;; esac
  case "${STATMESH_ONDEMAND:-}" in 1|true|yes) bad "STATMESH_ONDEMAND is on in hosted mode (default is off)" ;; esac
  [ "${STATMESH_ALLOW_SERVER_KEY:-}" = 1 ] && bad "STATMESH_ALLOW_SERVER_KEY=1 on a public deployment exposes the server's provider keys"
  [ "${STATMESH_ALLOWED_HOSTS:-}" = "*" ] && bad "STATMESH_ALLOWED_HOSTS=* disables DNS-rebinding protection"
  set_ STATMESH_PUBLIC_URL || set_ STATMESH_ALLOWED_HOSTS || warn "set STATMESH_PUBLIC_URL (OpenAPI servers entry) and STATMESH_ALLOWED_HOSTS to your hostname"
  set_ STATMESH_API_URL && localish "$STATMESH_API_URL" && bad "STATMESH_API_URL points at localhost"
  set_ STATMESH_API_URL || bad "STATMESH_API_URL is unset (web)"
  set_ STATMESH_SITE_URL || bad "STATMESH_SITE_URL is unset (web)"
  set_ STATMESH_SITE_URL && localish "$STATMESH_SITE_URL" && bad "STATMESH_SITE_URL points at localhost"
else
  [ "${STATMESH_MODE:-}" = hosted ] && warn "STATMESH_MODE=hosted in a local run: on-demand fetch and the sandbox are off"
  set_ STATMESH_API_URL && case "$STATMESH_API_URL" in http://*|https://*) ;; *) bad "STATMESH_API_URL must be http(s)" ;; esac
fi

echo "keys required by their source:"
for v in FRED_API_KEY DATAGOVIN_API_KEY CENSUS_API_KEY BEA_API_KEY EIA_API_KEY DATACOMMONS_API_KEY; do
  mask "$v"; set_ "$v" || warn "$v unset: that source returns 503 MissingKey (or add it to STATMESH_DISABLE)"
done
echo "optional keys:"; for v in BLS_API_KEY COMTRADE_API_KEY COMPANIES_HOUSE_API_KEY ANTHROPIC_API_KEY OPENAI_API_KEY; do mask "$v"; done

echo "$problems problem(s)"
exit "$problems"
