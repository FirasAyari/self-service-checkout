import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { demoAdminApi } from './demoAdminApi'

const validOrder = (status: string) => ({
  publicReference: 'GT-20261021-AB12',
  status,
  pickupNumber: status === 'PAID' ? 12 : null,
  updatedAtUtc: '2026-10-21T12:00:00Z',
  message: 'Order status updated.',
  lines: [{ itemId: 'turkey-melt', name: 'Turkey melt', quantity: 1, unitPriceCents: 1095, lineTotalCents: 1095 }],
  totalCents: 1095,
  taxCents: 95,
  currency: 'USD',
})

const validMenu = () => ({
  version: 'menu-v1',
  categories: [{
    name: 'Sandwiches',
    items: [{ id: 'turkey-melt', category: 'Sandwiches', name: 'Turkey melt', description: 'Warm sandwich.',
      priceCents: 1095, stock: 2, isAvailable: true, optionGroups: [] }],
  }],
})

const validQuote = () => ({
  quoteId: 'quote-1',
  expiresAtUtc: '2026-10-21T12:02:00Z',
  lines: [{ itemId: 'turkey-melt', name: 'Turkey melt', quantity: 1, unitPriceCents: 1095,
    lineTotalCents: 1095, optionIds: [] }],
  totalCents: 1095,
  taxCents: 95,
  currency: 'USD',
})

function respondWith(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response)))
}

afterEach(() => vi.unstubAllGlobals())

describe('AC-D4 runtime API response validation', () => {
  it('accepts a valid menu response and rejects invalid catalog amounts and stock', async () => {
    const body = validMenu()
    respondWith(body)
    await expect(api.menu()).resolves.toEqual(body)

    for (const invalidItem of [
      { ...body.categories[0].items[0], priceCents: -1 },
      { ...body.categories[0].items[0], stock: -1 },
    ]) {
      respondWith({ ...body, categories: [{ ...body.categories[0], items: [invalidItem] }] })
      await expect(api.menu()).rejects.toMatchObject({ name: 'ApiError', status: 200 })
    }
  })

  it('accepts a valid quote and rejects inconsistent server totals', async () => {
    const body = validQuote()
    respondWith(body)
    await expect(api.quote([])).resolves.toEqual(body)

    respondWith({ ...body, totalCents: 1 })
    await expect(api.quote([])).rejects.toMatchObject({ name: 'ApiError', status: 200 })
  })

  it.each(['PENDING_PAYMENT', 'PAID', 'PAYMENT_FAILED'])(
    'accepts the supported %s order status', async (status) => {
      const body = validOrder(status)
      respondWith(body)

      await expect(api.status('a'.repeat(32))).resolves.toEqual(body)
    },
  )

  it.each([
    ['an unknown order status', { status: 'REFUNDED' }],
    ['a negative order total', { totalCents: -1 }],
    ['a negative line amount', { lines: [{ itemId: 'turkey-melt', name: 'Turkey melt', quantity: 1, unitPriceCents: -1, lineTotalCents: -1 }] }],
    ['a line total inconsistent with its quantity', { lines: [{ itemId: 'turkey-melt', name: 'Turkey melt', quantity: 2, unitPriceCents: 1095, lineTotalCents: 1095 }] }],
    ['a pickup number on an unresolved attempt', { status: 'PENDING_PAYMENT', pickupNumber: 12 }],
    ['an invalid currency code', { currency: 'US dollars' }],
  ])('rejects %s as an invalid successful response', async (_description, override) => {
    respondWith({ ...validOrder('PAID'), ...override })

    await expect(api.status('a'.repeat(32))).rejects.toMatchObject({ name: 'ApiError', status: 200 })
  })
})


describe('AC-D8 protected Development admin API validation', () => {
  it('accepts a valid full catalog and rejects invalid item prices or stock', async () => {
    const catalog = [{
      id: 'garden-bowl', category: 'Bowls', name: 'Garden grain bowl', description: 'Seasonal greens.',
      priceCents: 1095, stock: null, isActive: false, sortOrder: 1,
    }]
    respondWith(catalog)
    await expect(demoAdminApi.items('x'.repeat(32))).resolves.toEqual(catalog)

    respondWith([{ ...catalog[0], priceCents: -1 }])
    await expect(demoAdminApi.items('x'.repeat(32))).rejects.toMatchObject({ name: 'ApiError', status: 200 })

    respondWith([{ ...catalog[0], stock: -1 }])
    await expect(demoAdminApi.items('x'.repeat(32))).rejects.toMatchObject({ name: 'ApiError', status: 200 })
  })

  it('validates the current chaos configuration at the network boundary', async () => {
    const current = { scenarioOverride: 'StillUnknown', mode: 'Latency', latencyMilliseconds: 250 }
    respondWith(current)
    await expect(demoAdminApi.chaos('x'.repeat(32))).resolves.toEqual(current)

    respondWith({ ...current, mode: 'UnrecognizedMode' })
    await expect(demoAdminApi.chaos('x'.repeat(32))).rejects.toMatchObject({ name: 'ApiError', status: 200 })
  })

  it('sends the admin secret only in the request header and accepts a no-content edit', async () => {
    const secret = 'local-development-token-without-browser-persistence'
    let requestInit: RequestInit | undefined
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestInit = init
      return { ok: true, status: 204, headers: { get: () => null }, json: async () => null } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(demoAdminApi.updateItem(secret, 'garden bowl', {
      priceCents: 895, stock: 0, isActive: true, clearStock: false,
    })).resolves.toBeNull()

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/items/garden%20bowl', expect.any(Object))
    expect(requestInit?.headers).toMatchObject({ 'X-Admin-Token': secret })
    expect(requestInit?.body).not.toContain(secret)
  })
})
