import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const projectFile = resolve(projectRoot, 'src/SelfServiceCheckout/SelfServiceCheckout/SelfServiceCheckout.csproj')
const localDotnet = resolve(homedir(), '.dotnet', process.platform === 'win32' ? 'dotnet.exe' : 'dotnet')
const executable = existsSync(localDotnet) ? localDotnet : 'dotnet'
const child = spawn(executable, ['run', '--project', projectFile, '--launch-profile', 'http'], {
  cwd: projectRoot,
  env: { ...process.env, ASPNETCORE_ENVIRONMENT: 'Development' },
  stdio: 'inherit',
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('error', (error) => {
  console.error(`Could not start the .NET API: ${error.message}`)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
