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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value)
}

function isDateTime(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
}

function isMenuItem(value: unknown): value is MenuItem {
  return isRecord(value) && isNonEmptyString(value.id) && isNonEmptyString(value.category) &&
    isNonEmptyString(value.name) && isNonEmptyString(value.description) &&
    isPositiveSafeInteger(value.priceCents) && typeof value.isAvailable === 'boolean' &&
    (value.stock === null || isNonNegativeSafeInteger(value.stock)) && Array.isArray(value.optionGroups) &&
    value.optionGroups.every((group) => isRecord(group) && isNonEmptyString(group.id) && isNonEmptyString(group.name) &&
      typeof group.isRequired === 'boolean' && typeof group.maximumSelections === 'number' && Number.isSafeInteger(group.maximumSelections) && group.maximumSelections >= 0 &&
      Array.isArray(group.options) && group.options.every((option) => isRecord(option) && isNonEmptyString(option.id) &&
        isNonEmptyString(option.name) && isNonNegativeSafeInteger(option.additionalPriceCents)))
}

function isMenu(value: unknown): value is Menu {
  return isRecord(value) && isNonEmptyString(value.version) && Array.isArray(value.categories) &&
    value.categories.every((category) => isRecord(category) && isNonEmptyString(category.name) &&
      Array.isArray(category.items) && category.items.every(isMenuItem))
}

function isQuoteLine(value: unknown): value is QuoteResponse['lines'][number] {
  return isRecord(value) && isNonEmptyString(value.itemId) && isNonEmptyString(value.name) &&
    Number.isSafeInteger(value.quantity) && Number(value.quantity) >= 1 && Number(value.quantity) <= 10 &&
    isPositiveSafeInteger(value.unitPriceCents) && isPositiveSafeInteger(value.lineTotalCents) &&
    value.lineTotalCents === Number(value.unitPriceCents) * Number(value.quantity) &&
    Array.isArray(value.optionIds) && value.optionIds.every(isNonEmptyString)
}

function isQuote(value: unknown): value is Quote {
  if (!isRecord(value) || !isNonEmptyString(value.quoteId) || !isDateTime(value.expiresAtUtc) ||
    !Array.isArray(value.lines) || value.lines.length === 0 || !value.lines.every(isQuoteLine) ||
    !isNonNegativeSafeInteger(value.totalCents) || !isNonNegativeSafeInteger(value.taxCents) ||
    value.taxCents > value.totalCents || !isCurrencyCode(value.currency)) return false

  const lineTotal = value.lines.reduce((sum, line) => sum + line.lineTotalCents, 0)
  return Number.isSafeInteger(lineTotal) && lineTotal === value.totalCents
}

function isOrderLine(value: unknown): value is OrderStatusResponse['lines'][number] {
  return isRecord(value) && isNonEmptyString(value.itemId) && isNonEmptyString(value.name) &&
    Number.isSafeInteger(value.quantity) && Number(value.quantity) >= 1 && Number(value.quantity) <= 10 &&
    isPositiveSafeInteger(value.unitPriceCents) && isPositiveSafeInteger(value.lineTotalCents) &&
    value.lineTotalCents === Number(value.unitPriceCents) * Number(value.quantity)
}

function isOrderStatus(value: unknown): value is OrderStatus {
  if (!isRecord(value) || !isNonEmptyString(value.publicReference) ||
    !['PENDING_PAYMENT', 'PAID', 'PAYMENT_FAILED'].includes(String(value.status)) ||
    !isDateTime(value.updatedAtUtc) || !isNonEmptyString(value.message) ||
    !Array.isArray(value.lines) || value.lines.length === 0 || !value.lines.every(isOrderLine) ||
    !isNonNegativeSafeInteger(value.totalCents) || !isNonNegativeSafeInteger(value.taxCents) ||
    value.taxCents > value.totalCents || !isCurrencyCode(value.currency)) return false

  const lineTotal = value.lines.reduce((sum, line) => sum + line.lineTotalCents, 0)
  if (!Number.isSafeInteger(lineTotal) || lineTotal !== value.totalCents) return false

  if (value.status === 'PAID') return isPositiveSafeInteger(value.pickupNumber)
  return value.pickupNumber === null
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
