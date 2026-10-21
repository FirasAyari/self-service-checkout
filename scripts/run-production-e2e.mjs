import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const webRoot = resolve(repositoryRoot, 'frontend')
const playwrightCli = resolve(webRoot, 'node_modules/@playwright/test/cli.js')
if (!existsSync(playwrightCli)) {
  throw new Error('Playwright is not installed. Run npm ci from the frontend directory first.')
}

const temporaryRoot = realpathSync(tmpdir())
const databaseDirectory = mkdtempSync(join(temporaryRoot, 'goodtable-production-e2e-'))
const databasePath = join(databaseDirectory, 'checkout.db')
let cleaned = false
function cleanTemporaryDatabase() {
  if (cleaned || !existsSync(databaseDirectory)) return
  cleaned = true

  const resolvedDirectory = realpathSync(databaseDirectory)
  if (dirname(resolvedDirectory) !== temporaryRoot || !basename(resolvedDirectory).startsWith('goodtable-production-e2e-')) {
    throw new Error('Refusing to remove a temporary database outside its dedicated test directory.')
  }

  rmSync(resolvedDirectory, { recursive: true, force: true })
}

const child = spawn(process.execPath, [playwrightCli, 'test', '--config', 'playwright.production.config.ts'], {
  cwd: webRoot,
  env: { ...process.env, CHECKOUT_E2E_DATABASE_PATH: databasePath },
  stdio: 'inherit',
})

let stopping = false
let requestedSignal
let forceStopTimer
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    stopping = true
    requestedSignal = signal
    child.kill('SIGTERM')
    forceStopTimer = setTimeout(() => child.kill('SIGKILL'), 10_000)
    forceStopTimer.unref()
  })
}

child.once('error', (error) => {
  console.error(`Could not start the Production browser check: ${error.message}`)
  cleanTemporaryDatabase()
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  if (forceStopTimer) clearTimeout(forceStopTimer)
  cleanTemporaryDatabase()
  process.exitCode = stopping ? requestedSignal === 'SIGINT' ? 130 : 143 : code ?? (signal ? 1 : 0)
})
