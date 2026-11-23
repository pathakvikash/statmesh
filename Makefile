SHELL := bash
.DEFAULT_GOAL := help

# Live targets for `make smoke`; override: make smoke WEB_BASE=http://127.0.0.1:3000 API_BASE=http://127.0.0.1:8000
WEB_BASE ?= https://statmesh-ten.vercel.app
API_BASE ?= https://statmesh-api.onrender.com

.PHONY: help bootstrap dev dev-real check test lint format web-test web-typecheck web-lint \
        demo-data bench doctor smoke docker-build docker-up docker-down mirror clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

bootstrap: ## First-time setup (uv sync, web npm install, env)
	scripts/bootstrap.sh

dev: ## API + web on demo data (Ctrl-C stops both)
	scripts/dev.sh

dev-real: ## API + web on your own data dir (STATMESH_DATA_DIR, default ./data)
	scripts/dev.sh real

check: ## Full local gate (lint, tests, web checks)
	scripts/check.sh

test: ## Offline Python tests
	uv run pytest -q

lint: ## ruff check + format check
	uv run ruff check . && uv run ruff format --check .

format: ## ruff format + autofix
	uv run ruff check --fix . && uv run ruff format .

web-test: ## Web unit tests (vitest)
	cd web && npm test

web-typecheck: ## Web type check
	cd web && npm run typecheck

web-lint: ## Web eslint
	cd web && npm run lint

demo-data: ## Build the offline demo catalog in ./demo-data
	STATMESH_DATA_DIR=$(CURDIR)/demo-data STATMESH_DISABLE=sec_edgar uv run python -c "from statmesh.testing.fixture_catalog import build; build('demo-data')"

bench: ## 200-question benchmark (gated)
	uv run statmesh bench

doctor: ## Diagnose the local environment
	scripts/doctor.sh

smoke: ## Read-only smoke test of the live web/API (WEB_BASE, API_BASE)
	WEB_BASE=$(WEB_BASE) API_BASE=$(API_BASE) WEB_URL=$(WEB_BASE) API_URL=$(API_BASE) scripts/smoke.sh

docker-build: ## Build the docker compose images
	docker compose build

docker-up: ## Start the compose stack: api, worker, web (docker compose up -d)
	docker compose up -d

docker-down: ## Stop the compose stack (volumes kept)
	docker compose down

mirror: ## Dry run of the hosted-mirror ingest prune
	uv run statmesh mirror --prune --dry-run

clean: ## Remove caches only (.pytest_cache, .ruff_cache, web/.next)
	rm -rf .pytest_cache .ruff_cache web/.next
