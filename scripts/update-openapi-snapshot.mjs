import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const testProject = join('tests', 'SelfServiceCheckout.Api.Tests', 'SelfServiceCheckout.Api.Tests.csproj')
const update = spawnSync(process.execPath, [
  join(root, 'scripts', 'dotnet.mjs'),
  'test',
  testProject,
  '--configuration',
  'Release',
  '--filter',
  'FullyQualifiedName~OpenApiDocument_MatchesCommittedContractSnapshot',
], {
  cwd: root,
  env: { ...process.env, UPDATE_OPENAPI_SNAPSHOT: '1' },
  stdio: 'inherit',
})

if (update.error) throw update.error
if (update.status !== 0) process.exit(update.status ?? 1)

const generate = spawnSync(process.execPath, [join(root, 'scripts', 'generate-api-types.mjs')], {
  cwd: root,
  stdio: 'inherit',
})
if (generate.error) throw generate.error
process.exit(generate.status ?? 1)
