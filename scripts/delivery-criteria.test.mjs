import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = process.cwd()
const read = (path) => readFile(join(root, path), 'utf8')

test('AC-D1 setup and development entry points are wired to the API and web client', async () => {
  const [readme, makefile, workflow, webPackageSource, vite, runApi, devSmoke] = await Promise.all([
    read('README.md'),
    read('Makefile'),
    read('.github/workflows/ci.yml'),
    read('web/package.json'),
    read('web/vite.config.ts'),
    read('web/scripts/run-api.mjs'),
    read('scripts/dev-smoke.mjs'),
  ])
  const webPackage = JSON.parse(webPackageSource)

  assert.match(readme, /make setup[\s\S]*make dev/)
  assert.match(makefile, /setup:[\s\S]*?dotnet\.mjs tool restore[\s\S]*?dotnet\.mjs restore[\s\S]*?npm --prefix web ci/)
  assert.match(makefile, /dev:[\s\S]*?npm --prefix web run dev/)
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

test('AC-D2 documented verification targets invoke the checks CI runs', async () => {
  const [readme, makefile, workflow, packageSource] = await Promise.all([
    read('README.md'),
    read('Makefile'),
    read('.github/workflows/ci.yml'),
    read('web/package.json'),
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
  assert.ok(trace.stdout.includes(`${cardValidationCriterion} (named test): web/src/App.test.tsx`))
  assert.ok(trace.stdout.includes(`${cardFormattingCriterion} (named test): web/src/App.test.tsx`))
  assert.ok(!trace.stdout.includes(`${cardValidationCriterion}: documented deviation`))
})

test('AC-D3 README and demo guide explain mock payment and protected chaos paths', async () => {
  const [readme, demoGuide, adr, makefile] = await Promise.all([
    read('README.md'),
    read('docs/demo-mode.md'),
    read('docs/adr/0002-no-card-data-in-demo.md'),
    read('Makefile'),
  ])

  assert.match(readme, /Payments are simulated[\s\S]*test values only[\s\S]*Never enter a real card/)
  assert.match(readme, /payment screen includes card-number, expiry, and CVC fields[\s\S]*fictional values[\s\S]*cleared when submission starts[\s\S]*never sent or saved/i)
  assert.doesNotMatch(readme, /demo does not ask for card numbers/i)
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
  assert.match(adr, /clear them as soon as submission starts[\s\S]*Do not create a payment token or persist, log, or capture the field values/)
})

test('AC-D4 OpenAPI snapshot generates the browser DTO types without drift', async () => {
  const [snapshot, generated, apiSource, updater, packageSource, makefile] = await Promise.all([
    read('tests/SelfServiceCheckout.Api.Tests/Contracts/openapi.v1.json'),
    read('web/src/api.generated.ts'),
    read('web/src/api.ts'),
    read('scripts/update-openapi-snapshot.mjs'),
    read('web/package.json'),
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
