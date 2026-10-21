import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const itemId = 'garden-sandwich'

function catalog(priceCents = 800, stock = 5) {
  return {
    version: `menu-${priceCents}-${stock}`,
    categories: [{ name: 'Sandwiches', items: [
      { id: itemId, category: 'Sandwiches', name: 'Garden sandwich', description: 'Fresh greens and bread.', priceCents, stock, isAvailable: stock > 0, optionGroups: [] },
      { id: 'sold-out-soup', category: 'Sandwiches', name: 'Sold out soup', description: 'Unavailable today.', priceCents: 700, stock: 0, isAvailable: false, optionGroups: [] },
    ] }],
  }
}

function makeOrder(status: 'PAID' | 'PAYMENT_FAILED' | 'PENDING_PAYMENT', quantity = 1, priceCents = 800) {
  return {
    publicReference: 'PUBLIC-REF-123', status, pickupNumber: status === 'PAID' ? 8 : null,
    updatedAtUtc: '2026-10-20T00:00:00Z', message: status === 'PAID' ? 'Order confirmed.' : status === 'PAYMENT_FAILED' ? 'Payment was not recorded.' : 'Payment is still being confirmed.',
    lines: [{ itemId, name: 'Garden sandwich', quantity, unitPriceCents: priceCents, lineTotalCents: priceCents * quantity, optionIds: [] }],
    totalCents: priceCents * quantity, taxCents: Math.round(priceCents * quantity * 0.08), currency: 'USD',
  }
}

async function mockCheckoutApi(page: Page, options: { priceOnRefresh?: number; stockOnRefresh?: number; settleAfterPolls?: number; failMenuCall?: number; failMenuCalls?: number[]; orderRejection?: { code: string; retryAfter?: string }; quoteGate?: Promise<void>; orderGate?: Promise<void> } = {}) {
  let menuCalls = 0
  let paymentAttempts = 0
  let statusPolls = 0
  let orderRequestStartedAt = 0
  const idempotencyKeys: string[] = []
  const orderBodies: Record<string, unknown>[] = []
  let latestScenario = 'Approve'
  let latestQuantity = 1
  let latestPrice = 800

  await page.route('**/api/menu', async (route: Route) => {
    menuCalls += 1
    if (menuCalls === options.failMenuCall || options.failMenuCalls?.includes(menuCalls)) {
      await route.fulfill({ status: 503, json: { title: 'Menu temporarily unavailable.' } })
      return
    }
    const price = menuCalls > 1 && options.priceOnRefresh !== undefined ? options.priceOnRefresh : 800
    const stock = menuCalls > 1 && options.stockOnRefresh !== undefined ? options.stockOnRefresh : 5
    await route.fulfill({ json: catalog(price, stock) })
  })
  await page.route('**/api/quotes', async (route: Route) => {
    if (options.quoteGate) await options.quoteGate
    const body = route.request().postDataJSON() as { items: { itemId: string; quantity: number }[] }
    latestQuantity = body.items.reduce((sum, line) => sum + line.quantity, 0)
    const price = options.priceOnRefresh !== undefined && menuCalls > 1 ? options.priceOnRefresh : 800
    latestPrice = price
    await route.fulfill({ json: {
      quoteId: `quote-${menuCalls}-${latestQuantity}`, expiresAtUtc: '2099-01-01T00:00:00Z',
      lines: [{ itemId, name: 'Garden sandwich', quantity: latestQuantity, unitPriceCents: price, lineTotalCents: price * latestQuantity, optionIds: [] }],
      totalCents: price * latestQuantity, taxCents: Math.round(price * latestQuantity * 0.08), currency: 'USD',
    } })
  })
  await page.route('**/api/orders', async (route: Route) => {
    paymentAttempts += 1
    orderRequestStartedAt = Date.now()
    const body = route.request().postDataJSON() as Record<string, unknown>
    orderBodies.push(body)
    if (options.orderRejection) {
      await route.fulfill({ status: 429, headers: options.orderRejection.retryAfter ? { 'Retry-After': options.orderRejection.retryAfter } : {}, json: { title: 'Payment requests are temporarily limited.', code: options.orderRejection.code } })
      return
    }
    const orderRequest = body as { scenario: string; idempotencyKey: string }
    idempotencyKeys.push(orderRequest.idempotencyKey)
    latestScenario = orderRequest.scenario
    const status = latestScenario === 'Decline' ? 'PAYMENT_FAILED' : latestScenario === 'StillUnknown' || latestScenario === 'UnknownAfterApproval' ? 'PENDING_PAYMENT' : 'PAID'
    if (options.orderGate) await options.orderGate
    await route.fulfill({ status: 201, json: { order: makeOrder(status, latestQuantity, latestPrice) } })
  })
  await page.route('**/api/orders/status', async (route: Route) => {
    statusPolls += 1
    const settled = statusPolls >= (options.settleAfterPolls ?? 2)
    const status = latestScenario === 'Decline' ? 'PAYMENT_FAILED' : settled ? 'PAID' : 'PENDING_PAYMENT'
    await route.fulfill({ json: makeOrder(status, latestQuantity, latestPrice) })
  })
  return { get menuCalls() { return menuCalls }, get paymentAttempts() { return paymentAttempts }, get statusPolls() { return statusPolls }, get idempotencyKeys() { return idempotencyKeys }, get orderBodies() { return orderBodies }, get orderRequestStartedAt() { return orderRequestStartedAt } }
}

async function addOneAndReview(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Add Garden sandwich' }).click()
  await page.getByRole('button', { name: 'Review order' }).click()
  const heading = page.getByRole('heading', { name: 'Your order, your way.' })
  await expect(heading).toBeVisible()
  await expect(heading).toBeFocused()
}

async function continueToOrder(page: Page) {
  await page.getByRole('button', { name: 'Continue to place order' }).click()
  const heading = page.getByRole('heading', { name: 'Place your order' })
  await expect(heading).toBeVisible()
  await expect(heading).toBeFocused()
}

async function payDemoOrder(page: Page) {
  const pay = page.getByRole('button', { name: /Place demo order/ })
  await expect(pay).toBeEnabled()
  await pay.click()
}

async function analyzeAxe(page: Page) {
  await page.evaluate(() => document.getAnimations().forEach((animation) => {
    if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish()
  }))
  return new AxeBuilder({ page }).analyze()
}

async function expectNoSevereAxeViolations(page: Page) {
  const report = await analyzeAxe(page)
  const severe = report.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
  expect(severe, JSON.stringify(severe.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.target) })), null, 2)).toEqual([])
}

test('AC-M6 / AC-R6 selected cold-brew options are quoted, confirmed, and included in the QR receipt', async ({ page }) => {
  page.on('pageerror', (error) => console.error(`Cold-brew page error: ${error.message}`))
  page.on('console', (message) => { if (message.type() === 'error') console.error(`Cold-brew console error: ${message.text()}`) })
  let quotedOptions: string[] = []
  const optionGroups = [
    { id: 'size', name: 'Size', isRequired: true, maximumSelections: 1, options: [{ id: 'small', name: 'Small', additionalPriceCents: 0 }, { id: 'large', name: 'Large', additionalPriceCents: 125 }] },
    { id: 'extras', name: 'Add-ons', isRequired: false, maximumSelections: 2, options: [{ id: 'oat-milk', name: 'Oat milk', additionalPriceCents: 50 }, { id: 'extra-shot', name: 'Extra shot', additionalPriceCents: 100 }] },
  ]
  await page.route('**/api/menu', (route) => route.fulfill({ json: { version: 'cold-brew-v1', categories: [{ name: 'Drinks', items: [
    { id: 'cold-brew', category: 'Drinks', name: 'Cold brew', description: 'Slow-steeped coffee.', priceCents: 425, stock: 12, isAvailable: true, optionGroups },
  ] }] } }))
  await page.route('**/api/quotes', async (route) => {
    const body = route.request().postDataJSON() as { items: { itemId: string; quantity: number; optionIds: string[] }[] }
    quotedOptions = body.items[0]?.optionIds ?? []
    await route.fulfill({ json: { quoteId: 'cold-brew-quote', expiresAtUtc: '2099-01-01T00:00:00Z',
      lines: [{ itemId: 'cold-brew', name: 'Cold brew (Large, Oat milk)', quantity: 1, unitPriceCents: 600, lineTotalCents: 600, optionIds: quotedOptions }],
      totalCents: 600, taxCents: 44, currency: 'USD' } })
  })
  await page.route('**/api/orders', (route) => route.fulfill({ status: 201, json: { order: {
    publicReference: 'PUBLIC-REF-123', status: 'PAID', pickupNumber: 8, updatedAtUtc: '2026-10-20T00:00:00Z', message: 'Order confirmed.',
    lines: [{ itemId: 'cold-brew', name: 'Cold brew (Large, Oat milk)', quantity: 1, unitPriceCents: 600, lineTotalCents: 600 }],
    totalCents: 600, taxCents: 44, currency: 'USD',
  } } }))

  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Add Cold brew' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Size' }).selectOption('large')
  await page.getByRole('checkbox', { name: /Oat milk/ }).check()
  await expect(page.locator('.menu-card .price')).toHaveText('$6.00')
  await page.getByRole('button', { name: 'Add Cold brew' }).click()
  await page.getByRole('button', { name: 'Review order' }).click()
  await expect(page.getByText('Cold brew (Large, Oat milk)')).toBeVisible()
  await expect(page.locator('.review-total strong')).toHaveText('$6.00')
  expect(quotedOptions).toEqual(['large', 'oat-milk'])
  await continueToOrder(page)
  await payDemoOrder(page)
  await expect(page.getByRole('heading', { name: 'Order receipt' })).toBeVisible()
  await expect(page.locator('.receipt-card')).toContainText('Cold brew (Large, Oat milk)')
  await expect(page.locator('.receipt-qr svg')).toBeVisible()
})

test('AC-Y4 / AC-O1 / AC-O5 / AC-R1 approval shows the server quote and prints the receipt with pickup number', async ({ page }) => {
  const api = await mockCheckoutApi(page)
  await addOneAndReview(page)
  await expect(page.locator('.review-total strong')).toHaveText('$8.00')
  await expect(page.getByText('Total, tax included')).toBeVisible()
  await continueToOrder(page)
  await expect(page.locator('.review-total strong')).toHaveText('$8.00')
  await expect(page.getByRole('button', { name: /Place demo order/ })).toContainText('$8.00')
  await payDemoOrder(page)
  await expect(page.getByRole('heading', { name: 'That’s a good choice.' })).toBeVisible({ timeout: 2_000 })
  expect(Date.now() - api.orderRequestStartedAt).toBeLessThan(2_000)
  await expect(page.getByText('8', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Order receipt' })).toBeVisible()
  await expect(page.locator('.receipt-qr svg')).toBeVisible()
  await expect(page.locator('.receipt-total strong')).toHaveText('$8.00')
  await expect(page.getByRole('status').filter({ hasText: 'This screen clears in 30 seconds' })).toBeVisible()
  expect(Number(await page.locator('.pickup-card strong').evaluate((element) => getComputedStyle(element).fontSize.replace('px', '')))).toBeGreaterThanOrEqual(96)
  expect(api.paymentAttempts).toBe(1)
  await page.evaluate(() => { window.print = () => { document.body.dataset.printCalled = 'true' } })
  await page.getByRole('button', { name: 'Print receipt' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-print-called', 'true')
})

test('AC-Y5 / AC-R3 / AC-R4 / AC-M5 a decline retains cart, highlights price changes, and retry receipt matches accepted quote', async ({ page }) => {
  const api = await mockCheckoutApi(page, { priceOnRefresh: 900 })
  await addOneAndReview(page)
  await expect(page.getByText('Price or availability was updated.')).toBeVisible()
  await page.getByRole('checkbox', { name: 'I accept the updated total of $9.00' }).click()
  await expect(page.getByRole('button', { name: 'Continue to place order' })).toBeEnabled()
  await continueToOrder(page)
  await page.locator('#payment-scenario').selectOption('Decline')
  await payDemoOrder(page)
  await expect(page.getByText('DEMO ORDER NOT COMPLETED')).toBeVisible()
  await expect(page.getByLabel('Card number')).toHaveCount(0)
  await page.getByRole('button', { name: 'Try demo order again' }).click()
  const consent = page.getByRole('checkbox', { name: 'I accept the updated total of $9.00' })
  await expect(consent).toBeVisible()
  await expect(page.getByText('Garden sandwich')).toBeVisible()
  await consent.click()
  await continueToOrder(page)
  await expect(page.getByLabel('Card number')).toHaveCount(0)
  await page.locator('#payment-scenario').selectOption('Approve')
  await payDemoOrder(page)
  await expect(page.getByRole('heading', { name: 'That’s a good choice.' })).toBeVisible()
  await expect(page.locator('.receipt-total strong')).toHaveText('$9.00')
  expect(api.paymentAttempts).toBe(2)
  expect(new Set(api.idempotencyKeys).size).toBe(2)
})

test('AC-Y6 / AC-K2 an unknown result stays pending and resolves automatically by the same status key', async ({ page }) => {
  const api = await mockCheckoutApi(page, { settleAfterPolls: 1 })
  await addOneAndReview(page)
  await continueToOrder(page)
  await page.locator('#payment-scenario').selectOption('StillUnknown')
  await payDemoOrder(page)
  await expect(page.getByRole('heading', { name: 'Confirming your order.' })).toBeVisible()
  await expect(page.getByText('Checking automatically every 5 seconds…')).toBeVisible()
  await expect(page.getByRole('button', { name: /Place demo order/ })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'That’s a good choice.' })).toBeVisible({ timeout: 10_000 })
  expect(api.paymentAttempts).toBe(1)
  expect(api.statusPolls).toBeGreaterThanOrEqual(1)
})

test('AC-Y6 / AC-K2 a payment with no ledger result stays pending after 30 seconds without another Pay action or idle reset', async ({ page }) => {
  await page.clock.install()
  const api = await mockCheckoutApi(page, { settleAfterPolls: 999 })
  await addOneAndReview(page)
  await continueToOrder(page)
  await page.locator('#payment-scenario').selectOption('StillUnknown')
  await payDemoOrder(page)
  await expect(page.getByRole('heading', { name: 'Confirming your order.' })).toBeVisible()
  await page.clock.fastForward(30_000)
  await expect(page.getByRole('heading', { name: 'Confirming your order.' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Place demo order/ })).toHaveCount(0)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  expect(api.paymentAttempts).toBe(1)
  expect(api.statusPolls).toBeGreaterThanOrEqual(1)
})

test('AC-Y3 duplicate rapid taps create one request with one idempotency key', async ({ page }) => {
  let releaseOrder!: () => void
  const orderGate = new Promise<void>((resolve) => { releaseOrder = resolve })
  const api = await mockCheckoutApi(page, { orderGate })
  await addOneAndReview(page)
  await continueToOrder(page)
  const payButton = page.getByRole('button', { name: /Place demo order/ })
  await expect(payButton).toBeEnabled()
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('Place demo order'))
    if (!button) throw new Error('Pay action is missing')
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await expect(page.getByRole('heading', { name: 'Confirming your order.' })).toBeVisible()
  expect(api.paymentAttempts).toBe(1)
  await expect(payButton).toHaveCount(0)
  releaseOrder()
  await expect(page.getByRole('heading', { name: 'That’s a good choice.' })).toBeVisible()
  expect(api.paymentAttempts).toBe(1)
  expect(new Set(api.idempotencyKeys).size).toBe(1)
})

test('AC-Y7 PAYMENT_LOCKED is a known rejection with a countdown, no status poll, and retry after expiry', async ({ page }) => {
  await page.clock.install()
  const api = await mockCheckoutApi(page, { orderRejection: { code: 'PAYMENT_LOCKED' } })
  await addOneAndReview(page)
  await continueToOrder(page)
  await payDemoOrder(page)
  await expect(page.getByRole('heading', { name: 'Confirming your order.' })).toHaveCount(0)
  await expect(page.getByText('You can try again in 60 seconds.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to place order' })).toBeDisabled()
  expect(api.statusPolls).toBe(0)
  await expect(page.evaluate(() => sessionStorage.getItem('goodtable.attempt.v1'))).resolves.toBeNull()
  await page.clock.fastForward(60_000)
  await expect(page.getByRole('button', { name: 'Continue to place order' })).toBeEnabled()
})

test('generic 429 uses Retry-After and does not treat a pre-handler rejection as pending', async ({ page }) => {
  await page.clock.install()
  const api = await mockCheckoutApi(page, { orderRejection: { code: 'RATE_LIMITED', retryAfter: '7' } })
  await addOneAndReview(page)
  await continueToOrder(page)
  await payDemoOrder(page)
  await expect(page.getByText('You can try again in 7 seconds.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to place order' })).toBeDisabled()
  expect(api.statusPolls).toBe(0)
  await page.clock.fastForward(7_000)
  await expect(page.getByRole('button', { name: 'Continue to place order' })).toBeEnabled()
})

test('AC-Y8 Back from Pay returns to Review with the quoted cart intact', async ({ page }) => {
  await mockCheckoutApi(page)
  await addOneAndReview(page)
  await continueToOrder(page)
  await expect(page.locator('.review-total strong')).toHaveText('$8.00')
  await page.getByRole('button', { name: /Back to review/ }).click()
  await expect(page.getByRole('heading', { name: 'Your order, your way.' })).toBeVisible()
  await expect(page.getByText('Garden sandwich')).toBeVisible()
  await expect(page.locator('.review-total strong')).toHaveText('$8.00')
  await continueToOrder(page)
})

test('AC-R2 / AC-R5 stock shortfall offers reduce/remove and an empty cart cannot be reviewed or submitted', async ({ page }) => {
  await mockCheckoutApi(page, { stockOnRefresh: 0 })
  await addOneAndReview(page)
  await expect(page.getByRole('alert').getByText(/Some items are no longer available/).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove one: Garden sandwich' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Remove Garden sandwich' })).toBeVisible()
  await page.getByRole('button', { name: 'Remove Garden sandwich' }).click()
  await expect(page.getByText('Your order is empty. Add an item to continue.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Place demo order/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Review order' })).toHaveCount(0)
})

test('AC-C1 / AC-C2 adding twice updates the total and increments one cart line', async ({ page }) => {
  await mockCheckoutApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Add Garden sandwich' }).click()
  await expect(page.getByText(/1 delicious choice.*Estimated subtotal: \$8\.00/)).toBeVisible()
  await page.getByRole('button', { name: 'Add one: Garden sandwich' }).click()
  await expect(page.getByText(/2 delicious choices.*Estimated subtotal: \$16\.00/)).toBeVisible()
  await expect(page.locator('.quantity-control')).toHaveCount(1)
  await expect(page.locator('.quantity-control')).toContainText('2')
})

test('AC-C1 adding an item updates the visible count and estimate within 100 milliseconds', async ({ page }) => {
  await mockCheckoutApi(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Add Garden sandwich' })).toBeVisible()
  const elapsedMilliseconds = await page.evaluate(() => new Promise<number>((resolve, reject) => {
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="Add Garden sandwich"]')
    if (!button) { reject(new Error('The add control is unavailable.')); return }
    const startedAt = performance.now()
    const observer = new MutationObserver(() => {
      if (document.querySelector('.dock-info')?.textContent?.includes('$8.00')) {
        observer.disconnect()
        resolve(performance.now() - startedAt)
      }
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    button.click()
  }))
  expect(elapsedMilliseconds).toBeLessThanOrEqual(100)
  await expect(page.locator('.dock-info')).toContainText('$8.00')
})

test('AC-M3 initial menu failure offers retry and automatic recovery without showing an empty menu', async ({ page }) => {
  await page.clock.install()
  await mockCheckoutApi(page, { failMenuCall: 1 })
  await page.goto('/')
  await expect(page.getByRole('alert').getByText('Menu temporarily unavailable.')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.getByText('No items are available in this category right now.')).toHaveCount(0)
  await page.clock.fastForward(2_000)
  await expect(page.getByRole('button', { name: 'Add Garden sandwich' })).toBeVisible()
})

test('AC-M3 automatic menu retry waits 2, 4, 8, then caps each later wait at 15 seconds', async ({ page }) => {
  await page.clock.install()
  const api = await mockCheckoutApi(page, { failMenuCalls: [1, 2, 3, 4, 5] })
  await page.goto('/')
  await expect(page.getByRole('alert').getByText('Menu temporarily unavailable.')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(1)
  expect(api.menuCalls).toBe(1)
  for (const [delay, expectedCalls] of [[1_999, 1], [1, 2], [4_000, 3], [8_000, 4], [14_999, 4], [1, 5], [15_000, 6]] as const) {
    await page.clock.fastForward(delay)
    await expect.poll(() => api.menuCalls).toBe(expectedCalls)
  }
  await expect(page.getByRole('button', { name: 'Add Garden sandwich' })).toBeVisible()
})

test('AC-M4 a failed refresh keeps the existing menu visible and signals reconnection', async ({ page }) => {
  await mockCheckoutApi(page, { failMenuCall: 2 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Add Garden sandwich' }).click()
  await page.getByRole('button', { name: 'Review order' }).click()
  await expect(page.getByRole('status').getByText('Reconnecting. Your current menu is still available.')).toBeVisible()
  await expect(page.getByText('Garden sandwich')).toBeVisible()
  await expect(page.getByText('Available now: 5')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to place order' })).toBeEnabled()
})

test('AC-R1 review shows progress while the authoritative quote is loading, then displays its total', async ({ page }) => {
  let finishQuote!: () => void
  const quoteGate = new Promise<void>((resolve) => { finishQuote = resolve })
  await mockCheckoutApi(page, { quoteGate })
  await page.goto('/')
  await page.getByRole('button', { name: 'Add Garden sandwich' }).click()
  await page.getByRole('button', { name: 'Review order' }).click()
  await expect(page.locator('.inline-spinner')).toBeVisible()
  await expect(page.getByText('Checking current price and availability…')).toBeVisible()
  finishQuote()
  await expect(page.locator('.review-total strong')).toHaveText('$8.00')
  await expect(page.locator('.inline-spinner')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Update total' })).toHaveCount(0)
})

test('AC-R1 editing a reviewed cart automatically refreshes the quote and requests consent', async ({ page }) => {
  await mockCheckoutApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Add Garden sandwich' }).click()
  await page.getByRole('button', { name: 'Add one: Garden sandwich' }).click()
  await page.getByRole('button', { name: 'Review order' }).click()
  await expect(page.locator('.review-total strong')).toHaveText('$16.00')

  await page.getByRole('button', { name: 'Remove one: Garden sandwich' }).click()
  await expect(page.locator('.review-total strong')).toHaveText('$8.00')
  await expect(page.getByRole('checkbox', { name: 'I accept the updated total of $8.00' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to place order' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Update total' })).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'I accept the updated total of $8.00' }).click()
  await expect(page.getByRole('button', { name: 'Continue to place order' })).toBeEnabled()
})

test('AC-C5 clear order asks for confirmation when multiple units are in the cart', async ({ page }) => {
  await mockCheckoutApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Add Garden sandwich' }).click()
  await page.getByRole('button', { name: 'Add one: Garden sandwich' }).click()
  await page.getByRole('button', { name: 'Clear order' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Clear this order?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep order' }).click()
  await expect(page.getByRole('button', { name: 'Review order' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear order' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Clear order' }).click()
  await expect(page.getByRole('button', { name: 'Review order' })).toHaveCount(0)
})

test('AC-C5 clearing a one-unit cart happens immediately without a confirmation dialog', async ({ page }) => {
  await mockCheckoutApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Add Garden sandwich' }).click()
  await page.getByRole('button', { name: 'Clear order' }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Review order' })).toHaveCount(0)
})

test('AC-C4 removing the last unit offers a five-second undo that expires', async ({ page }) => {
  await page.clock.install()
  await mockCheckoutApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Add Garden sandwich' }).click()
  await page.getByRole('button', { name: 'Remove one: Garden sandwich' }).click()
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()
  await page.clock.fastForward(4_000)
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()
  await page.clock.fastForward(1_200)
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0)
})

test('AC-R2 offers a one-tap reduction to current stock and enables checkout after re-quote', async ({ page }) => {
  await mockCheckoutApi(page, { stockOnRefresh: 2 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Add Garden sandwich' }).click()
  await page.getByRole('button', { name: 'Add one: Garden sandwich' }).click()
  await page.getByRole('button', { name: 'Add one: Garden sandwich' }).click()
  await page.getByRole('button', { name: 'Review order' }).click()
  await expect(page.getByRole('alert').getByText(/Some items are no longer available/).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove one: Garden sandwich' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove Garden sandwich' })).toBeVisible()
  await page.getByRole('button', { name: 'Reduce to 2' }).click()
  await expect(page.getByRole('button', { name: 'Continue to place order' })).toBeEnabled()
  await expect(page.locator('.review-quantity')).toHaveText('2')
  await expect(page.getByRole('button', { name: 'Update total' })).toHaveCount(0)
})

test('AC-K1 / AC-C6 idle timeout warns, can be dismissed, then clears the cart and session storage', async ({ page }) => {
  await page.clock.install()
  await mockCheckoutApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Add Garden sandwich' }).click()
  await page.clock.fastForward(61_000)
  const dialog = page.getByRole('alertdialog', { name: 'Still choosing?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep my order' }).click()
  await expect(page.getByRole('button', { name: 'Review order' })).toBeVisible()
  await page.clock.fastForward(61_000)
  await expect(dialog).toBeVisible()
  await page.clock.fastForward(15_000)
  await expect(page.getByRole('button', { name: 'Review order' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'A little good goes a long way.' })).toBeVisible()
  await expect(page.evaluate(() => sessionStorage.getItem('goodtable.cart.v1'))).resolves.toBeNull()
})

test('AC-C6 a browser reload restores quantities and option IDs without persisting prices or payment data', async ({ page }) => {
  await mockCheckoutApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Add Garden sandwich' }).click()
  const storedCart = await page.evaluate(() => sessionStorage.getItem('goodtable.cart.v1'))
  expect(storedCart).toContain('garden-sandwich')
  expect(storedCart).toContain('quantity')
  expect(storedCart).not.toContain('price')
  expect(storedCart).not.toContain('cents')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Remove one: Garden sandwich' })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('goodtable.attempt.v1'))).toBeNull()
})

test('AC-K5 keyboard basics and axe show labelled controls and no serious or critical violations', async ({ page }) => {
  await mockCheckoutApi(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Add Garden sandwich' })).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: /goodtable/i })).toBeFocused()
  await page.getByRole('link', { name: 'Skip to main content' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('main')).toBeFocused()
  const initial = await analyzeAxe(page)
  const severeInitial = initial.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
  expect(severeInitial, JSON.stringify(severeInitial.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.target) })), null, 2)).toEqual([])
  await page.getByRole('button', { name: 'Add Garden sandwich' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Remove one: Garden sandwich' })).toBeVisible()
  await expect(page.locator('.dock-info')).toHaveAttribute('aria-live', 'polite')
  await page.getByRole('button', { name: 'Review order' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Your order, your way.' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your order, your way.' })).toBeFocused()
  const review = await analyzeAxe(page)
  const severeReview = review.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
  expect(severeReview, JSON.stringify(severeReview.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.target) })), null, 2)).toEqual([])
})

test('AC-K5 labels, announcements, focus order, dialogs, and every checkout state pass axe serious checks', async ({ page }) => {
  await page.clock.install()
  await mockCheckoutApi(page, { settleAfterPolls: 1 })
  await page.goto('/')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: /goodtable/i })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('combobox', { name: 'Language' })).toBeFocused()
  await expectNoSevereAxeViolations(page)

  await page.clock.fastForward(61_000)
  await expect(page.getByRole('alertdialog', { name: 'Still choosing?' })).toBeVisible()
  await expectNoSevereAxeViolations(page)
  await page.getByRole('button', { name: 'Keep my order' }).click()

  await page.getByRole('button', { name: 'Add Garden sandwich' }).click()
  await page.getByRole('button', { name: 'Add one: Garden sandwich' }).click()
  await page.getByRole('button', { name: 'Clear order' }).click()
  await expect(page.getByRole('alertdialog', { name: 'Clear this order?' })).toBeVisible()
  await expectNoSevereAxeViolations(page)
  await page.getByRole('button', { name: 'Keep order' }).click()

  await page.getByRole('button', { name: 'Review order' }).click()
  await expect(page.getByRole('heading', { name: 'Your order, your way.' })).toBeVisible()
  await expect(page.locator('.review-total')).toHaveAttribute('aria-live', 'polite')
  await expectNoSevereAxeViolations(page)
  await continueToOrder(page)
  await expect(page.getByRole('combobox', { name: 'Demo payment outcome' })).toBeVisible()
  await expect(page.locator('.review-total')).toHaveAttribute('aria-live', 'polite')
  await expectNoSevereAxeViolations(page)

  await page.locator('#payment-scenario').selectOption('StillUnknown')
  await payDemoOrder(page)
  await expect(page.getByRole('heading', { name: 'Confirming your order.' })).toBeVisible()
  await expect(page.locator('.status-screen')).toHaveAttribute('aria-live', 'polite')
  await expectNoSevereAxeViolations(page)
  await page.clock.fastForward(5_000)
  await expect(page.getByRole('heading', { name: 'Order receipt' })).toBeVisible()
  await expectNoSevereAxeViolations(page)

  await page.getByRole('button', { name: 'Start a new order' }).click()
  await page.getByRole('button', { name: 'Add Garden sandwich' }).click()
  await page.getByRole('button', { name: 'Review order' }).click()
  await continueToOrder(page)
  await page.locator('#payment-scenario').selectOption('Decline')
  await payDemoOrder(page)
  await expect(page.getByText('DEMO ORDER NOT COMPLETED')).toBeVisible()
  await expectNoSevereAxeViolations(page)
})

test('AC-K3 confirmation countdown clears the paid receipt and browser Back cannot reveal the prior order', async ({ page }) => {
  await page.clock.install()
  await mockCheckoutApi(page)
  await addOneAndReview(page)
  await continueToOrder(page)
  await payDemoOrder(page)
  await expect(page.getByRole('heading', { name: 'Order receipt' })).toBeVisible()
  await page.clock.runFor(30_000)
  await expect(page.getByRole('button', { name: 'Add Garden sandwich' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Made for your moment.' })).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Order receipt' })).toHaveCount(0)
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(page.getByRole('heading', { name: 'Order receipt' })).toHaveCount(0)
})

test('AC-K4 tablet portrait and landscape keep cart and checkout controls reachable', async ({ page }) => {
  await mockCheckoutApi(page)
  for (const [index, viewport] of [{ width: 768, height: 1024 }, { width: 1280, height: 800 }].entries()) {
    if (index > 0) {
      await page.evaluate(() => sessionStorage.clear())
      await page.goto('about:blank')
    }
    await page.setViewportSize(viewport)
    await page.goto('/')
    await page.getByRole('button', { name: 'Add Garden sandwich' }).click()
    await expect(page.getByRole('button', { name: 'Review order' })).toBeVisible()
    await page.getByRole('button', { name: 'Review order' }).click()
    await expect(page.getByRole('button', { name: 'Continue to place order' })).toBeVisible()
    await page.getByRole('button', { name: 'Continue to place order' }).click()
    const pay = page.getByRole('button', { name: /Place demo order/ })
    await expect(pay).toBeVisible()
    await pay.scrollIntoViewIfNeeded()
    const box = await pay.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
  }
})

test('AC-K5 mobile menu keeps its first action visible with readable copy and 44px touch controls', async ({ page }) => {
  await mockCheckoutApi(page)
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/')

  const add = page.getByRole('button', { name: 'Add Garden sandwich' })
  await expect(add).toBeVisible()
  const addBox = await add.boundingBox()
  expect(addBox).not.toBeNull()
  expect(addBox!.y + addBox!.height).toBeLessThanOrEqual(667)
  expect(await add.evaluate((element) => Number.parseFloat(getComputedStyle(element).height))).toBeGreaterThanOrEqual(44)
  expect(await page.locator('.menu-card-body > p').first().evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(13)
  expect(await page.locator('.category-chip').first().evaluate((element) => Number.parseFloat(getComputedStyle(element).height))).toBeGreaterThanOrEqual(44)
})

test('EVAL-PROD-02: simulated order is labeled and collects no payment details', async ({ page }) => {
  const api = await mockCheckoutApi(page)
  await addOneAndReview(page)
  await continueToOrder(page)
  await expect(page.getByText(/Demo only: no payment is taken/)).toBeVisible()
  await expect(page.getByLabel('Card number')).toHaveCount(0)
  await expect(page.getByLabel('Expiry (MM/YY)')).toHaveCount(0)
  await expect(page.getByLabel('Security code')).toHaveCount(0)
  await expect(page.locator('input')).toHaveCount(0)
  await expect(page.locator('#payment-scenario')).toBeVisible()
  await payDemoOrder(page)
  await expect(page.locator('.receipt-demo-disclaimer')).toContainText('DEMO ONLY')
  await expect(page.locator('.receipt-demo-disclaimer')).toContainText('no money was charged')
  const sentKeys = Object.keys(api.orderBodies[0] ?? {}).sort()
  expect(sentKeys).toEqual(['idempotencyKey', 'quoteId', 'scenario'])
})
