.PHONY: setup dev build test e2e trace check clean api-types api-snapshot chaos-latency chaos-decline chaos-timeout-after-charge chaos-timeout-no-charge chaos-drop-response chaos-crash-after-reservation chaos-clear

SOLUTION := SelfServiceCheckout.slnx
DEMO_API_URL ?= http://127.0.0.1:5080

setup:
	node scripts/dotnet.mjs tool restore
	node scripts/dotnet.mjs restore $(SOLUTION)
	npm --prefix web ci

dev:
	npm --prefix web run dev

build:
	npm --prefix web run build
	node scripts/dotnet.mjs build $(SOLUTION) --configuration Release

test:
	node scripts/run-tests.mjs

e2e:
	node scripts/run-e2e.mjs

trace:
	node scripts/traceability.mjs --strict

api-types:
	npm --prefix web run api:types

api-snapshot:
	npm --prefix web run api:update

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
	npm --prefix web run typecheck
	node scripts/run-lint.mjs
	node scripts/dotnet.mjs build $(SOLUTION) --configuration Release
	npm --prefix web run build
	node scripts/run-tests.mjs
	node scripts/traceability.mjs --strict

clean:
	node scripts/dotnet.mjs clean $(SOLUTION)
