.PHONY: setup dev build test e2e trace check clean api-types api-snapshot docker-build docker-up docker-down docker-smoke chaos-latency chaos-decline chaos-timeout-after-charge chaos-timeout-no-charge chaos-drop-response chaos-crash-after-reservation chaos-clear

SOLUTION := backend/SelfServiceCheckout.slnx
DEMO_API_URL ?= http://127.0.0.1:5080

setup:
	node scripts/dotnet.mjs tool restore
	node scripts/dotnet.mjs restore $(SOLUTION)
	npm --prefix frontend ci

dev:
	npm --prefix frontend run dev

build:
	npm --prefix frontend run build
	node scripts/dotnet.mjs build $(SOLUTION) --configuration Release

test:
	node scripts/run-tests.mjs

e2e:
	node scripts/run-e2e.mjs

trace:
	node scripts/traceability.mjs --strict

api-types:
	npm --prefix frontend run api:types

api-snapshot:
	npm --prefix frontend run api:update

docker-build:
	docker compose build

docker-up:
	docker compose up --build

docker-down:
	docker compose down

docker-smoke:
	node scripts/docker-smoke.mjs

chaos-latency:
	@test -n "$$DEMO_ADMIN_TOKEN" || { echo 'Set DEMO_ADMIN_TOKEN before using demo presets.' >&2; exit 1; }
	curl -fsS -X POST "$(DEMO_API_URL)/api/admin/chaos" -H "X-Admin-Token: $$DEMO_ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"scenarioOverride":"Approve","mode":"Latency","latencyMilliseconds":5000}'

chaos-decline:
	@test -n "$$DEMO_ADMIN_TOKEN" || { echo 'Set DEMO_ADMIN_TOKEN before using demo presets.' >&2; exit 1; }
	curl -fsS -X POST "$(DEMO_API_URL)/api/admin/chaos" -H "X-Admin-Token: $$DEMO_ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"scenarioOverride":"Decline"}'

chaos-timeout-after-charge:
	@test -n "$$DEMO_ADMIN_TOKEN" || { echo 'Set DEMO_ADMIN_TOKEN before using demo presets.' >&2; exit 1; }
	curl -fsS -X POST "$(DEMO_API_URL)/api/admin/chaos" -H "X-Admin-Token: $$DEMO_ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"scenarioOverride":"UnknownAfterApproval"}'

chaos-timeout-no-charge:
	@test -n "$$DEMO_ADMIN_TOKEN" || { echo 'Set DEMO_ADMIN_TOKEN before using demo presets.' >&2; exit 1; }
	curl -fsS -X POST "$(DEMO_API_URL)/api/admin/chaos" -H "X-Admin-Token: $$DEMO_ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"scenarioOverride":"StillUnknown"}'

chaos-drop-response:
	@test -n "$$DEMO_ADMIN_TOKEN" || { echo 'Set DEMO_ADMIN_TOKEN before using demo presets.' >&2; exit 1; }
	curl -fsS -X POST "$(DEMO_API_URL)/api/admin/chaos" -H "X-Admin-Token: $$DEMO_ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"scenarioOverride":"Approve","mode":"DropResponse","latencyMilliseconds":0}'

chaos-crash-after-reservation:
	@test -n "$$DEMO_ADMIN_TOKEN" || { echo 'Set DEMO_ADMIN_TOKEN before using demo presets.' >&2; exit 1; }
	curl -fsS -X POST "$(DEMO_API_URL)/api/admin/chaos" -H "X-Admin-Token: $$DEMO_ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"scenarioOverride":"Approve","mode":"CrashAfterReservation","latencyMilliseconds":0}'

chaos-clear:
	@test -n "$$DEMO_ADMIN_TOKEN" || { echo 'Set DEMO_ADMIN_TOKEN before using demo presets.' >&2; exit 1; }
	curl -fsS -X POST "$(DEMO_API_URL)/api/admin/chaos" -H "X-Admin-Token: $$DEMO_ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"scenarioOverride":null,"mode":null,"latencyMilliseconds":0}'

check:
	node scripts/generate-api-types.mjs --check
	node scripts/submission-matrix-evidence.mjs
	npm --prefix frontend run typecheck
	node scripts/run-lint.mjs
	node scripts/dotnet.mjs build $(SOLUTION) --configuration Release
	npm --prefix frontend run build
	node scripts/run-tests.mjs
	node scripts/traceability.mjs --strict

clean:
	node scripts/dotnet.mjs clean $(SOLUTION)
