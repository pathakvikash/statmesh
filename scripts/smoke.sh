#!/usr/bin/env bash
# Live smoke test of the hosted web + API. Exit code = number of failed checks.
# Usage: WEB_URL=... API_URL=... scripts/smoke.sh
WEB_URL=${WEB_URL:-https://statmesh-ten.vercel.app}
API_URL=${API_URL:-https://statmesh-api.onrender.com}
WEB_URL=${WEB_URL%/}; API_URL=${API_URL%/}
fails=0
rows=""

# get URL -> sets CODE and BODY; 3 tries, 60s each (Render free tier cold start)
get() {
  local i
  CODE=000; BODY=""
  for i in 1 2 3; do
    BODY=$(curl -sL --max-time 60 -w $'\n%{http_code}' "$1" 2>/dev/null)
    CODE=${BODY##*$'\n'}; BODY=${BODY%$'\n'*}
    [ "$CODE" = 200 ] && return 0
    sleep 3
  done
  return 1
}
rec() { # name ok detail
  if [ "$2" = 1 ]; then s=PASS; else s=FAIL; fails=$((fails + 1)); fi
  rows+=$(printf '%-34s %-5s %s' "$1" "$s" "$3")$'\n'
}
py() { python3 -c "$1" 2>/dev/null; }

get "$API_URL/healthz"; rec "api /healthz" $([ "$CODE" = 200 ] && echo 1) "HTTP $CODE"

get "$API_URL/search?q=gdp&limit=1"; sc=$CODE
sid=$(printf '%s' "$BODY" | py '
import sys, json
d = json.load(sys.stdin)
r = d if isinstance(d, list) else next((v for v in d.values() if isinstance(v, list)), [])
print(r[0].get("series_id") or r[0].get("id") or "")')
rec "api /search?q=gdp" $([ "$sc" = 200 ] && [ -n "$sid" ] && echo 1) "HTTP $sc id=${sid:-none}"

get "$API_URL/sources"; sc=$CODE
n=$(printf '%s' "$BODY" | py '
import sys, json
d = json.load(sys.stdin)
print(len(d if isinstance(d, list) else next((v for v in d.values() if isinstance(v, list)), [])))')
rec "api /sources (>=1)" $([ "$sc" = 200 ] && [ "${n:-0}" -ge 1 ] && echo 1) "HTTP $sc n=${n:-0}"

if [ -n "$sid" ]; then
  get "$WEB_URL/series/$sid"; rec "web /series/<id>" $([ "$CODE" = 200 ] && echo 1) "HTTP $CODE"
else
  rec "web /series/<id>" "" "no series id from search"
fi

get "$WEB_URL/"; sc=$CODE
ok=$(printf '%s' "$BODY" | grep -qi statmesh && printf '%s' "$BODY" | grep -q '/series/' && echo 1)
rec "web / (name + /series/ link)" $([ "$sc" = 200 ] && [ -n "$ok" ] && echo 1) "HTTP $sc"

get "$WEB_URL/search?q=unemployment"; rec "web /search?q=unemployment" $([ "$CODE" = 200 ] && echo 1) "HTTP $CODE"

printf '%s\n%s' "CHECK                              RESULT" "$rows"
echo "failures: $fails"
exit "$fails"
