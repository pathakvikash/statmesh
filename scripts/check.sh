#!/usr/bin/env bash
# Python tests + ruff lint/format check, then web typecheck + lint + tests. Stops at the first failure.
# Does NOT run `npm run build`, the search eval or the bench; CI covers those.
set -euo pipefail
cd "$(dirname "$0")/.."

uv run pytest -q
uv run ruff check .
uv run ruff format --check .
(cd web && npm run typecheck && npm run lint && npm test)
echo "All checks passed."
