import { randomBytes, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { join, resolve } from 'node:path'
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const projectName = `goodtable-smoke-${randomBytes(6).toString('hex')}`
const configuredPort = Number(process.env.CHECKOUT_SMOKE_PORT ?? 18080)

if (!Number.isInteger(configuredPort) || configuredPort < 1024 || configuredPort > 65535) {
  throw new Error('CHECKOUT_SMOKE_PORT must be an integer between 1024 and 65535.')
}

const baseUrl = `http://127.0.0.1:${configuredPort}`
const composePrefix = ['compose', '--project-name', projectName]
const environment = { ...process.env, CHECKOUT_PORT: String(configuredPort) }

function compose(args) {
  const result = spawnSync('docker', [...composePrefix, ...args], {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`docker compose ${args.join(' ')} failed with exit code ${result.status}.`)
}

async function request(path, init) {
  return fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(3_000) })
}

async function waitForReady() {
  const deadline = Date.now() + 45_000
  let lastStatus = 'no response'

  while (Date.now() < deadline) {
    try {
      const response = await request('/health/ready')
      lastStatus = `HTTP ${response.status}`
      if (response.ok) return
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error)
    }
    await delay(500)
  }

  throw new Error(`Docker checkout did not become ready within 45 seconds (${lastStatus}).`)
}

async function getJson(path, init) {
  const response = await request(path, init)
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}.`)
  return response.json()
}

let primaryFailure

try {
  compose(['up', '--detach', '--build', '--wait', '--wait-timeout', '120'])
  await waitForReady()

  const [home, menu, favicon, image, live] = await Promise.all([
    request('/'),
    getJson('/api/menu'),
    request('/favicon.svg'),
    request('/images/menu/turkey-melt.jpg'),
    request('/health/live'),
  ])

  const homeHtml = await home.text()
  if (!home.ok || !/<title>Good Table\s+—\s+Fresh food, good vibes<\/title>/i.test(homeHtml)) {
    throw new Error('The container did not serve the Good Table checkout page.')
  }
  if (!favicon.ok || !image.ok || !live.ok) throw new Error('The container did not serve the favicon, menu image, and liveness endpoint.')
  if (!Array.isArray(menu.categories) || menu.categories.length < 3) throw new Error('The container menu response is incomplete.')

  const menuImageFiles = await readdir(join(root, 'frontend', 'public', 'images', 'menu'))
  if (menuImageFiles.length !== 12) throw new Error(`Expected 12 packaged menu photos, found ${menuImageFiles.length}.`)
  const packagedImages = await Promise.all([
    request('/images/hero-grain-bowl.jpg', { method: 'HEAD' }),
    ...menuImageFiles.map((file) => request(`/images/menu/${encodeURIComponent(file)}`, { method: 'HEAD' })),
  ])
  if (packagedImages.some((response) => !response.ok)) throw new Error('One or more packaged menu photos are missing from the container.')

  const adminProbe = await request('/api/admin/chaos')
  if (adminProbe.status !== 404) throw new Error(`Production demo administration returned HTTP ${adminProbe.status}, expected 404.`)

  const oversizedBody = await request('/api/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ padding: 'x'.repeat(20_000) }),
  })
  if (oversizedBody.status !== 413) throw new Error(`An oversized API body returned HTTP ${oversizedBody.status}, expected 413.`)

  const item = menu.categories.flatMap((category) => category.items)
    .find((candidate) => candidate.isAvailable && candidate.stock !== 0 &&
      candidate.optionGroups.filter((group) => group.isRequired).every((group) => group.options.length > 0))
  if (!item) throw new Error('The container menu has no orderable seeded item.')

  const optionIds = item.optionGroups
    .filter((group) => group.isRequired)
    .flatMap((group) => group.options.slice(0, 1).map((option) => option.id))
  const quote = await getJson('/api/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ itemId: item.id, quantity: 1, optionIds }] }),
  })

  const idempotencyKey = randomUUID().replaceAll('-', '')
  // A customer-selected decline must still be normalized to the production demo approval.
  const requestBody = { quoteId: quote.quoteId, idempotencyKey, scenario: 'Decline' }
  const placeResponse = await request('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  })
  if (![200, 201, 202].includes(placeResponse.status)) {
    throw new Error(`The simulated order request returned HTTP ${placeResponse.status}.`)
  }

  const orderDeadline = Date.now() + 30_000
  let order
  while (Date.now() < orderDeadline) {
    try {
      order = await getJson('/api/orders/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey }),
      })
      if (order.status === 'PAID') break
      if (order.status !== 'PENDING_PAYMENT') throw new Error(`The simulated order finished with status ${order.status}.`)
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('HTTP 404')) throw error
    }
    await delay(500)
  }

  if (order?.status !== 'PAID' || !Number.isSafeInteger(order.pickupNumber)) {
    throw new Error('The container did not settle the simulated order to PAID with a pickup number.')
  }

  compose(['restart', 'checkout'])
  await waitForReady()

  const replay = await request('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  })
  if (replay.status !== 200) throw new Error(`Replaying the persisted order returned HTTP ${replay.status}, expected 200.`)
  const replayBody = await replay.json()
  if (replayBody.order?.publicReference !== order.publicReference || replayBody.order?.pickupNumber !== order.pickupNumber) {
    throw new Error('The order identity changed after the container restart.')
  }

  console.log('AC-D1/AC-D5 SC-G5 Docker smoke passed: packaged site and photos load, oversized requests are rejected, production forces demo approval, and the order survives restart.')
} catch (error) {
  primaryFailure = error
  try { compose(['logs', '--no-color', 'checkout']) } catch { /* preserve the original smoke failure */ }
  throw error
} finally {
  try {
    compose(['down', '--volumes', '--remove-orphans'])
  } catch (cleanupError) {
    if (!primaryFailure) throw cleanupError
    console.error('Could not remove the isolated Docker smoke project:', cleanupError)
  }
}
