import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const child = spawn('make', ['dev'], {
  cwd: root,
  detached: process.platform !== 'win32',
  stdio: 'inherit',
})

let childExit
child.once('exit', (code, signal) => { childExit = { code, signal } })
child.once('error', (error) => { childExit = { error } })

async function isReady(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
    return response.ok
  } catch {
    return false
  }
}

async function stop() {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit))
  try {
    if (process.platform === 'win32') child.kill('SIGTERM')
    else process.kill(-child.pid, 'SIGTERM')
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
  if (await Promise.race([exited.then(() => true), delay(5_000, undefined, { ref: false }).then(() => false)])) return

  try {
    if (process.platform === 'win32') child.kill('SIGKILL')
    else process.kill(-child.pid, 'SIGKILL')
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
  if (!await Promise.race([exited.then(() => true), delay(1_000, undefined, { ref: false }).then(() => false)])) {
    throw new Error('The Unix development process did not stop after termination was requested.')
  }
}

try {
  const deadline = Date.now() + 90_000
  let apiReady = false
  let webReady = false
  while (Date.now() < deadline && !childExit && !(apiReady && webReady)) {
    [apiReady, webReady] = await Promise.all([
      isReady('http://127.0.0.1:5080/healthz'),
      isReady('http://127.0.0.1:5173/'),
    ])
    if (!apiReady || !webReady) await delay(250)
  }

  if (childExit?.error) throw childExit.error
  if (!apiReady || !webReady) {
    throw new Error(`Development command did not serve both endpoints (API ready: ${apiReady}; web ready: ${webReady}; child exit: ${JSON.stringify(childExit ?? null)})`)
  }

  console.log('Development command served the API health endpoint and Vite client.')
} finally {
  await stop()
}
