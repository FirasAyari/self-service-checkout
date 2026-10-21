import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const packageJson = JSON.parse(await readFile(join(root, 'frontend', 'package.json'), 'utf8'))
if (!packageJson.scripts?.lint) {
  console.log('No frontend lint script is configured; skipped.')
  process.exit(0)
}

const result = spawnSync('npm', ['run', 'lint', '--prefix', 'frontend'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
