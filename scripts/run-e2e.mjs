import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const packageJson = JSON.parse(await readFile(join(root, 'web', 'package.json'), 'utf8'))

if (!packageJson.scripts?.e2e) {
  console.error('End-to-end tests are not configured. Add a web/e2e suite and an npm "e2e" script before relying on this target.')
  process.exit(1)
}

const result = spawnSync('npm', ['run', 'e2e', '--prefix', 'web'], { stdio: 'inherit', shell: process.platform === 'win32' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
