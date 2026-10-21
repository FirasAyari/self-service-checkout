import type {
  MenuItemDto,
  MenuResponse,
  MockPaymentScenario,
  OrderLineStatusDto,
  OrderStatusResponse,
  QuoteResponse,
} from './api.generated'

export type MenuItem = MenuItemDto
export type Menu = MenuResponse
export type Quote = QuoteResponse
export type Scenario = MockPaymentScenario
export type OrderLine = OrderLineStatusDto
export type OrderStatus = OrderStatusResponse

export class ApiError extends Error {
  public readonly status: number
  public readonly code?: string
  public readonly retryAfterSeconds?: number

  constructor(message: string, status: number, code?: string, retryAfterSeconds?: number) {
    super(message)
    this.status = status
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
    this.name = 'ApiError'
  }
}

function readRetryAfter(response: Response): number | undefined {
  const value = response.headers.get('Retry-After')
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds)
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1_000))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMenuItem(value: unknown): value is MenuItem {
  return isRecord(value) && typeof value.id === 'string' && typeof value.category === 'string' &&
    typeof value.name === 'string' && typeof value.description === 'string' &&
    Number.isSafeInteger(value.priceCents) && typeof value.isAvailable === 'boolean' &&
    (value.stock === null || Number.isSafeInteger(value.stock)) && Array.isArray(value.optionGroups) &&
    value.optionGroups.every((group) => isRecord(group) && typeof group.id === 'string' && typeof group.name === 'string' &&
      typeof group.isRequired === 'boolean' && typeof group.maximumSelections === 'number' && Number.isSafeInteger(group.maximumSelections) && group.maximumSelections >= 0 &&
      Array.isArray(group.options) && group.options.every((option) => isRecord(option) && typeof option.id === 'string' &&
        typeof option.name === 'string' && typeof option.additionalPriceCents === 'number' && Number.isSafeInteger(option.additionalPriceCents) && option.additionalPriceCents >= 0))
}

function isMenu(value: unknown): value is Menu {
  return isRecord(value) && typeof value.version === 'string' && Array.isArray(value.categories) &&
    value.categories.every((category) => isRecord(category) && typeof category.name === 'string' &&
      Array.isArray(category.items) && category.items.every(isMenuItem))
}

function isQuote(value: unknown): value is Quote {
  return isRecord(value) && typeof value.quoteId === 'string' && typeof value.expiresAtUtc === 'string' &&
    Array.isArray(value.lines) && value.lines.every((line) => isRecord(line) &&
      typeof line.itemId === 'string' && typeof line.name === 'string' && Number.isSafeInteger(line.quantity) &&
      Number.isSafeInteger(line.unitPriceCents) && Number.isSafeInteger(line.lineTotalCents) && Array.isArray(line.optionIds) &&
      line.optionIds.every((optionId) => typeof optionId === 'string')) &&
    Number.isSafeInteger(value.totalCents) && Number.isSafeInteger(value.taxCents) && typeof value.currency === 'string'
}

function isOrderStatus(value: unknown): value is OrderStatus {
  return isRecord(value) && typeof value.publicReference === 'string' && typeof value.status === 'string' &&
    (value.pickupNumber === null || Number.isSafeInteger(value.pickupNumber)) &&
    typeof value.updatedAtUtc === 'string' && typeof value.message === 'string' &&
    Array.isArray(value.lines) && value.lines.every((line) => isRecord(line) && typeof line.itemId === 'string' &&
      typeof line.name === 'string' && Number.isSafeInteger(line.quantity) && Number.isSafeInteger(line.unitPriceCents) &&
      Number.isSafeInteger(line.lineTotalCents)) && Number.isSafeInteger(value.totalCents) &&
    Number.isSafeInteger(value.taxCents) && typeof value.currency === 'string'
}

async function request<T>(path: string, init: RequestInit, validate: (value: unknown) => value is T): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } })
  } catch {
    throw new ApiError('The connection was interrupted. Check the same payment attempt before trying again.', 0)
  }

  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = isRecord(body) && (typeof body.title === 'string' || typeof body.message === 'string')
      ? String(body.title ?? body.message)
      : 'We could not complete that request. Please try again.'
    const code = isRecord(body) && typeof body.code === 'string' ? body.code : undefined
    throw new ApiError(message, response.status, code, readRetryAfter(response))
  }
  if (!validate(body)) throw new ApiError('The checkout service returned an unexpected response. Please check your order status.', response.status)
  return body
}

export const api = {
  menu: () => request('/api/menu', { method: 'GET' }, isMenu),
  quote: (items: { itemId: string; quantity: number; optionIds: string[] }[]) =>
    request('/api/quotes', { method: 'POST', body: JSON.stringify({ items }) }, isQuote),
  placeOrder: async (quoteId: string, idempotencyKey: string, scenario: Scenario) => {
    const response = await request('/api/orders', {
      method: 'POST', body: JSON.stringify({ quoteId, idempotencyKey, scenario }),
    }, (value): value is { order: OrderStatus } => isRecord(value) && isOrderStatus(value.order))
    return response.order
  },
  status: (idempotencyKey: string) => request('/api/orders/status', {
    method: 'POST', body: JSON.stringify({ idempotencyKey }),
  }, isOrderStatus),
}
