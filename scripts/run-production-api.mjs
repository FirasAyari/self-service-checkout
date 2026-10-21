import { spawn, spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const projectDirectory = resolve(repositoryRoot, 'backend/src/SelfServiceCheckout/SelfServiceCheckout')
const projectFile = resolve(projectDirectory, 'SelfServiceCheckout.csproj')
const applicationAssembly = resolve(projectDirectory, 'bin/Release/net10.0/SelfServiceCheckout.dll')
const dotnetWrapper = resolve(repositoryRoot, 'scripts/dotnet.mjs')
const localDotnet = resolve(homedir(), '.dotnet', process.platform === 'win32' ? 'dotnet.exe' : 'dotnet')
const dotnet = existsSync(localDotnet) ? localDotnet : 'dotnet'
const databasePath = process.env.CHECKOUT_E2E_DATABASE_PATH
if (!databasePath || basename(databasePath) !== 'checkout.db') {
  throw new Error('The isolated Production test database path is required.')
}

const temporaryRoot = realpathSync(tmpdir())
const databaseDirectory = realpathSync(dirname(databasePath))
if (dirname(databaseDirectory) !== temporaryRoot || !basename(databaseDirectory).startsWith('goodtable-production-e2e-')) {
  throw new Error('The Production browser check accepts only its isolated temporary database path.')
}

const build = spawnSync(process.execPath, [dotnetWrapper, 'build', projectFile, '--configuration', 'Release'], {
  cwd: repositoryRoot,
  stdio: 'inherit',
})
if (build.error) throw build.error
if (build.status !== 0) process.exit(build.status ?? 1)

const child = spawn(dotnet, [applicationAssembly], {
  cwd: projectDirectory,
  env: {
    ...process.env,
    ASPNETCORE_ENVIRONMENT: 'Production',
    ASPNETCORE_URLS: 'http://127.0.0.1:4174',
    AllowedHosts: '127.0.0.1',
    Checkout__DatabasePath: databasePath,
    Checkout__MockPaymentsEnabled: 'true',
    Checkout__KioskId: 'production-e2e-kiosk',
    DemoMode__Enabled: 'false',
  },
  stdio: 'inherit',
})

let stopping = false
let forceStopTimer
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    stopping = true
    child.kill('SIGTERM')
    forceStopTimer = setTimeout(() => child.kill('SIGKILL'), 10_000)
    forceStopTimer.unref()
  })
}

child.once('error', (error) => {
  console.error(`Could not start the Production checkout API: ${error.message}`)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  if (forceStopTimer) clearTimeout(forceStopTimer)
  process.exitCode = stopping ? 0 : code ?? (signal ? 1 : 0)
})
