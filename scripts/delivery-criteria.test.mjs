import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = process.cwd()
const read = (path) => readFile(join(root, path), 'utf8')

test('AC-D1 setup and development entry points are wired to the API and frontend', async () => {
  const [readme, makefile, workflow, webPackageSource, vite, runApi, devSmoke] = await Promise.all([
    read('README.md'),
    read('Makefile'),
    read('.github/workflows/ci.yml'),
    read('frontend/package.json'),
    read('frontend/vite.config.ts'),
    read('frontend/scripts/run-api.mjs'),
    read('scripts/dev-smoke.mjs'),
  ])
  const webPackage = JSON.parse(webPackageSource)

  assert.match(readme, /make setup[\s\S]*make dev/)
  assert.match(makefile, /setup:[\s\S]*?dotnet\.mjs tool restore[\s\S]*?dotnet\.mjs restore[\s\S]*?npm --prefix frontend ci/)
  assert.match(makefile, /dev:[\s\S]*?npm --prefix frontend run dev/)
  assert.match(webPackage.scripts.dev, /run-api\.mjs/)
  assert.match(webPackage.scripts.dev, /vite/)
  assert.match(vite, /proxy:\s*\{\s*'\/api':\s*'http:\/\/127\.0\.0\.1:5080'/)
  assert.match(runApi, /SelfServiceCheckout\.csproj/)
  assert.match(workflow, /runs-on:\s*ubuntu-latest/)
  assert.match(workflow, /run:\s*make setup/)
  assert.match(workflow, /node scripts\/dev-smoke\.mjs/)
  assert.match(devSmoke, /\/healthz/)
  assert.match(devSmoke, /127\.0\.0\.1:5173/)
})

test('AC-D1 Docker builds the full checkout and persists its SQLite data', async () => {
  const [dockerfile, compose, dockerignore, makefile, workflow, runbook] = await Promise.all([
    read('Dockerfile'),
    read('compose.yaml'),
    read('.dockerignore'),
    read('Makefile'),
    read('.github/workflows/ci.yml'),
    read('docs/production-kiosk-runbook.md'),
  ])

  assert.match(dockerfile, /FROM node:22-alpine AS frontend-build/)
  assert.match(dockerfile, /FROM mcr\.microsoft\.com\/dotnet\/sdk:10\.0 AS backend-build/)
  assert.match(dockerfile, /COPY Directory\.Build\.props \.\//)
  assert.match(dockerfile, /FROM mcr\.microsoft\.com\/dotnet\/aspnet:10\.0 AS runtime/)
  assert.match(dockerfile, /USER \$APP_UID/)
  assert.match(dockerfile, /\/health\/ready/)
  assert.match(compose, /checkout-data:\/var\/lib\/goodtable/)
  assert.match(compose, /read_only:\s*true/)
  assert.match(dockerignore, /data\/\*\.db/)
  assert.match(dockerignore, /\.env\.\*/)
  assert.match(makefile, /docker-up:[\s\S]*docker compose up --build/)
  assert.match(workflow, /docker compose config --quiet/)
  assert.match(workflow, /node scripts\/docker-smoke\.mjs/)
  assert.match(runbook, /make docker-smoke/)
})

test('AC-D1 the container smoke completes an order and verifies its identity after restart', async () => {
  const [smoke, makefile, readme] = await Promise.all([
    read('scripts/docker-smoke.mjs'),
    read('Makefile'),
    read('README.md'),
  ])

  assert.match(smoke, /randomBytes\(6\)/)
  assert.match(smoke, /--project-name/)
  assert.match(smoke, /compose\(\['down', '--volumes', '--remove-orphans'\]\)/)
  assert.match(smoke, /\/api\/quotes/)
  assert.match(smoke, /\/api\/orders\/status/)
  assert.match(smoke, /compose\(\['restart', 'checkout'\]\)/)
  assert.match(smoke, /publicReference !== order\.publicReference/)
  assert.match(smoke, /images\/menu\/turkey-melt\.jpg/)
  assert.match(smoke, /scenario: 'Decline'/)
  assert.match(smoke, /adminProbe\.status !== 404/)
  assert.match(smoke, /menuImageFiles\.length !== 12/)
  assert.match(makefile, /docker-smoke:[\s\S]*?scripts\/docker-smoke\.mjs/)
  assert.match(readme, /make docker-smoke[\s\S]*restart the container/)
})

test('AC-D2 documented verification targets invoke the checks CI runs', async () => {
  const [readme, makefile, workflow, packageSource] = await Promise.all([
    read('README.md'),
    read('Makefile'),
    read('.github/workflows/ci.yml'),
    read('frontend/package.json'),
  ])
  const packageJson = JSON.parse(packageSource)

  for (const target of ['build', 'test', 'e2e', 'check', 'trace']) {
    assert.match(readme, new RegExp(`make ${target}`))
    assert.match(makefile, new RegExp(`^${target}:`, 'm'))
  }
  assert.match(makefile, /test:[\s\S]*?scripts\/run-tests\.mjs/)
  assert.match(makefile, /e2e:[\s\S]*?scripts\/run-e2e\.mjs/)
  assert.match(makefile, /trace:[\s\S]*?traceability\.mjs --strict/)
  assert.match(makefile, /check:[\s\S]*?run-tests\.mjs[\s\S]*?traceability\.mjs --strict/)
  assert.equal(typeof packageJson.scripts.test, 'string')
  assert.equal(typeof packageJson.scripts.e2e, 'string')
  assert.match(workflow, /run:\s*make build/)
  assert.match(workflow, /run:\s*make test/)
  assert.match(workflow, /run:\s*make e2e/)
  assert.match(workflow, /traceability\.mjs --strict/)
  const trace = spawnSync(process.execPath, ['scripts/traceability.mjs', '--strict'], { cwd: root, encoding: 'utf8' })
  assert.equal(trace.status, 0, trace.stderr || trace.stdout)
  assert.match(trace.stdout, /Every required criterion has a named test/)
  const cardValidationCriterion = ['AC', 'Y1'].join('-')
  const cardFormattingCriterion = ['AC', 'Y2'].join('-')
  const noCredentialsCriterion = ['AC', 'D7'].join('-')
  assert.ok(trace.stdout.includes(`${cardValidationCriterion}: documented deviation (ADR-0002)`))
  assert.ok(trace.stdout.includes(`${cardFormattingCriterion}: documented deviation (ADR-0002)`))
  assert.match(trace.stdout, new RegExp(`${noCredentialsCriterion} \\(named test\\): .*frontend/src/App\\.test\\.tsx`))
  assert.ok(!trace.stdout.includes(`${cardValidationCriterion} (named test):`))
})

test('AC-D3 README and demo guide explain mock payment and protected chaos paths', async () => {
  const [readme, demoGuide, adr, makefile] = await Promise.all([
    read('README.md'),
    read('docs/demo-mode.md'),
    read('docs/adr/0002-no-card-data-in-demo.md'),
    read('Makefile'),
  ])

  assert.match(readme, /checkout collects no payment details[\s\S]*never contacts a payment provider/i)
  assert.match(readme, /does not ask for a card number, expiry, security code, or token/i)
  assert.match(readme, /no payment provider is contacted/i)
  assert.doesNotMatch(readme, /payment screen includes card-number, expiry, and CVC fields/i)
  assert.match(readme, /Development-only demo controls/)
  assert.match(readme, /docs\/demo-mode\.md/)
  assert.match(demoGuide, /DemoMode:Enabled/)
  assert.match(demoGuide, /DemoMode:AdminToken/)
  assert.match(demoGuide, /POST \/chaos/)
  assert.match(demoGuide, /StillUnknown/)
  assert.match(demoGuide, /CrashAfterReservation/)
  assert.match(demoGuide, /order remains pending/i)
  assert.match(demoGuide, /ledger result/i)
  assert.match(demoGuide, /POST \/reset/)
  for (const target of ['chaos-latency', 'chaos-decline', 'chaos-timeout-after-charge', 'chaos-timeout-no-charge', 'chaos-drop-response', 'chaos-crash-after-reservation', 'chaos-clear']) {
    assert.match(makefile, new RegExp(`^${target}:`, 'm'))
  }
  assert.match(adr, /collects no payment details[\s\S]*No card fields, card-like test values, or payment tokens are rendered, sent, stored, logged, or captured/i)
})

test('AC-D4 OpenAPI snapshot generates the browser DTO types without drift', async () => {
  const [snapshot, generated, apiSource, updater, packageSource, makefile] = await Promise.all([
    read('backend/tests/SelfServiceCheckout.Api.Tests/Contracts/openapi.v1.json'),
    read('frontend/src/api.generated.ts'),
    read('frontend/src/api.ts'),
    read('scripts/update-openapi-snapshot.mjs'),
    read('frontend/package.json'),
    read('Makefile'),
  ])
  const contract = JSON.parse(snapshot)
  const packageJson = JSON.parse(packageSource)

  assert.equal(contract.openapi, '3.1.1')
  assert.ok(contract.paths['/api/menu'])
  assert.ok(contract.paths['/api/orders'])
  assert.match(generated, /export type MenuResponse =/)
  assert.match(generated, /export type OrderStatusResponse =/)
  assert.match(apiSource, /from '\.\/api\.generated'/)
  assert.match(updater, /UPDATE_OPENAPI_SNAPSHOT/)
  assert.match(makefile, /^api-snapshot:/m)
  assert.match(packageJson.scripts['api:update'], /update-openapi-snapshot/)

  const result = spawnSync(process.execPath, ['scripts/generate-api-types.mjs', '--check'], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('AC-D5 EVAL-PROD-07 Production browser checks run through the real ASP.NET host with isolated data', async () => {
  const [config, packageSource, testRunner, apiRunner, productionSpec] = await Promise.all([
    read('frontend/playwright.production.config.ts'),
    read('frontend/package.json'),
    read('scripts/run-production-e2e.mjs'),
    read('scripts/run-production-api.mjs'),
    read('frontend/e2e-production/production.spec.ts'),
  ])
  const packageJson = JSON.parse(packageSource)

  assert.match(packageJson.scripts['test:production'], /run-production-e2e\.mjs/)
  assert.match(config, /run-production-api\.mjs/)
  assert.doesNotMatch(config, /vite preview/)
  assert.match(testRunner, /mkdtempSync/)
  assert.match(testRunner, /CHECKOUT_E2E_DATABASE_PATH/)
  assert.match(testRunner, /rmSync\(resolvedDirectory, \{ recursive: true, force: true \}\)/)
  assert.match(apiRunner, /ASPNETCORE_ENVIRONMENT: 'Production'/)
  assert.match(apiRunner, /Checkout__DatabasePath: databasePath/)
  assert.match(apiRunner, /Checkout__MockPaymentsEnabled: 'true'/)
  assert.match(apiRunner, /DemoMode__Enabled: 'false'/)
  assert.match(productionSpec, /content-security-policy/)
  assert.match(productionSpec, /Place demo order/)
  assert.doesNotMatch(productionSpec, /page\.route\(/)
})
