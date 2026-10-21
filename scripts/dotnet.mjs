import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const localDotnet = resolve(homedir(), '.dotnet', process.platform === 'win32' ? 'dotnet.exe' : 'dotnet')
const executable = existsSync(localDotnet) ? localDotnet : 'dotnet'
const result = spawnSync(executable, process.argv.slice(2), { stdio: 'inherit' })

if (result.error) {
  console.error(`Could not run the .NET SDK: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
