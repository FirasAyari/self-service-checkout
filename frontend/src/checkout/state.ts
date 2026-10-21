import type { Menu, OrderStatus, Quote, Scenario } from '../api'

export type CartLine = { quantity: number; optionIds: string[] }
export type Cart = Record<string, CartLine>
export type Screen = 'browse' | 'review' | 'pay' | 'processing' | 'complete'
export type State = {
  screen: Screen
  cart: Cart
  menu: Menu | null
  quote: Quote | null
  quoteId: string | null
  order: OrderStatus | null
  idempotencyKey: string | null
  scenario: Scenario
  error: string | null
  notice: string | null
  loadingMenu: boolean
  busy: boolean
  recovering: boolean
  stockIssue: boolean
  changedItemIds: string[]
  requireConsentOnNextQuote: boolean
  quoteNeedsConsent: boolean
  resumeStatus: boolean
}
export type Action =
  | { type: 'menu-loading' }
  | { type: 'menu-loaded'; menu: Menu; changedItemIds?: string[] }
  | { type: 'menu-failed'; message: string }
  | { type: 'menu-refresh-failed'; message: string }
  | { type: 'quantity'; itemId: string; quantity: number; optionIds?: string[]; emptyNotice?: string }
  | { type: 'clear-cart'; emptyNotice?: string }
  | { type: 'back-to-menu'; notice?: string }
  | { type: 'continue-payment' }
  | { type: 'back-to-review' }
  | { type: 'review-start' }
  | { type: 'stock-issue'; message: string }
  | { type: 'quote-loaded'; quote: Quote; notice?: string; requiresConsent: boolean; changedItemIds?: string[] }
  | { type: 'quote-failed'; message: string }
  | { type: 'accept-quote' }
  | { type: 'scenario'; scenario: Scenario }
  | { type: 'order-start'; idempotencyKey: string }
  | { type: 'recovery-start' }
  | { type: 'order-updated'; order: OrderStatus }
  | { type: 'order-unknown'; message: string }
  | { type: 'payment-error'; message: string }
  | { type: 'retry-declined' }
  | { type: 'new-order' }
  | { type: 'idle-reset' }

export const CART_STORAGE_KEY = 'goodtable.cart.v1'
export const ATTEMPT_STORAGE_KEY = 'goodtable.attempt.v1'
export const PAYMENT_RETRY_STORAGE_KEY = 'goodtable.paymentRetryAt.v1'
export const EMPTY_OPTION_IDS: string[] = []
export const EMPTY_STATE: State = {
  screen: 'browse', cart: {}, menu: null, quote: null, quoteId: null, order: null, idempotencyKey: null,
  scenario: 'Approve', error: null, notice: null, loadingMenu: true, busy: false, recovering: false,
  stockIssue: false, requireConsentOnNextQuote: false, quoteNeedsConsent: false,
  changedItemIds: [],
  resumeStatus: false,
}


export function readStoredCart(): Cart {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(CART_STORAGE_KEY) ?? '{}')
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {}
    const cart: Cart = {}
    for (const [itemId, value] of Object.entries(stored)) {
      const legacyQuantity = typeof value === 'number' ? value : undefined
      const entry = typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown> : null
      const quantity = legacyQuantity ?? entry?.quantity
      const optionIds = entry?.optionIds ?? []
      if (itemId.length <= 64 && Number.isInteger(quantity) && Number(quantity) >= 1 && Number(quantity) <= 10 &&
        Array.isArray(optionIds) && optionIds.length <= 8 && optionIds.every((optionId) => typeof optionId === 'string' && optionId.length <= 64)) {
        cart[itemId] = { quantity: Number(quantity), optionIds: [...new Set(optionIds as string[])] }
      }
    }
    let units = 0
    let lines = 0
    for (const [itemId, line] of Object.entries(cart)) {
      if (units + line.quantity > 30 || lines >= 15) delete cart[itemId]
      else { units += line.quantity; lines += 1 }
    }
    return cart
  } catch {
    return {}
  }
}

export function readPaymentCooldownSeconds(): number {
  try {
    const retryAt = Number(sessionStorage.getItem(PAYMENT_RETRY_STORAGE_KEY))
    return Number.isFinite(retryAt) ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1_000)) : 0
  } catch { return 0 }
}

export type StoredAttempt = { idempotencyKey: string; quoteId: string; scenario: Scenario }

export function readStoredAttempt(): StoredAttempt | null {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(ATTEMPT_STORAGE_KEY) ?? 'null')
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return null
    const candidate = stored as Record<string, unknown>
    if (typeof candidate.idempotencyKey !== 'string' || !/^[a-f0-9]{32}$/i.test(candidate.idempotencyKey) ||
      typeof candidate.quoteId !== 'string' || candidate.quoteId.length > 128 ||
      !['Approve', 'Decline', 'UnknownAfterApproval', 'StillUnknown'].includes(String(candidate.scenario))) return null
    return { idempotencyKey: candidate.idempotencyKey, quoteId: candidate.quoteId, scenario: candidate.scenario as Scenario }
  } catch {
    return null
  }
}

export function createInitialState(): State {
  const cart = readStoredCart()
  const attempt = readStoredAttempt()
  return attempt
    ? { ...EMPTY_STATE, screen: 'processing', cart, quoteId: attempt.quoteId, idempotencyKey: attempt.idempotencyKey, scenario: attempt.scenario, loadingMenu: false, resumeStatus: true }
    : { ...EMPTY_STATE, cart }
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'menu-loading': return { ...state, loadingMenu: state.menu === null, error: null }
    case 'menu-loaded': return { ...state, menu: action.menu, loadingMenu: false, error: null, changedItemIds: action.changedItemIds ?? state.changedItemIds }
    case 'menu-failed': return { ...state, loadingMenu: false, error: action.message }
    case 'menu-refresh-failed': return { ...state, notice: action.message }
    case 'quantity': {
      const next = { ...state.cart }
      if (action.quantity <= 0) delete next[action.itemId]
      else next[action.itemId] = { quantity: action.quantity, optionIds: action.optionIds ?? next[action.itemId]?.optionIds ?? [] }
      return {
        ...state, screen: state.screen === 'review' && Object.keys(next).length === 0 ? 'browse' : state.screen,
        cart: next, quote: null, stockIssue: false, notice: Object.keys(next).length === 0 ? action.emptyNotice ?? null : null,
        changedItemIds: state.changedItemIds.filter((changedId) => changedId !== action.itemId),
        requireConsentOnNextQuote: state.requireConsentOnNextQuote || (state.screen === 'review' && state.quote !== null),
      }
    }
    case 'clear-cart': return {
      ...state, screen: state.screen === 'review' ? 'browse' : state.screen, cart: {}, quote: null, stockIssue: false,
      notice: action.emptyNotice ?? null, requireConsentOnNextQuote: false, quoteNeedsConsent: false,
    }
    case 'back-to-menu': return { ...state, screen: 'browse', quote: null, quoteId: null, error: null, notice: action.notice ?? null, idempotencyKey: null, stockIssue: false, requireConsentOnNextQuote: false }
    case 'continue-payment': return state.quote && !state.quoteNeedsConsent ? { ...state, screen: 'pay', error: null } : state
    case 'back-to-review': return { ...state, screen: 'review', error: null }
    case 'review-start': return { ...state, screen: 'review', busy: true, error: null, notice: null, stockIssue: false }
    case 'stock-issue': return { ...state, screen: 'review', quote: null, busy: false, error: null, notice: action.message, stockIssue: true, requireConsentOnNextQuote: state.requireConsentOnNextQuote || state.quote !== null }
    case 'quote-loaded': return {
      ...state, screen: 'review', quote: action.quote, busy: false, error: null, notice: action.notice ?? null,
      stockIssue: false, quoteNeedsConsent: action.requiresConsent, requireConsentOnNextQuote: false,
      changedItemIds: [...new Set([...state.changedItemIds, ...(action.changedItemIds ?? [])])],
    }
    case 'quote-failed': return { ...state, screen: 'review', quote: null, busy: false, error: action.message, stockIssue: false }
    case 'accept-quote': return { ...state, quoteNeedsConsent: false }
    case 'scenario': return { ...state, scenario: action.scenario }
    case 'order-start': return { ...state, screen: 'processing', idempotencyKey: action.idempotencyKey, quoteId: state.quote?.quoteId ?? state.quoteId, order: null, busy: true, recovering: false, resumeStatus: false, error: null }
    case 'recovery-start': return { ...state, busy: true, recovering: true, resumeStatus: false, error: null }
    case 'order-updated': return {
      ...state, order: action.order, screen: action.order.status === 'PENDING_PAYMENT' ? 'processing' : 'complete',
      busy: false, recovering: false, resumeStatus: false, error: null,
    }
    case 'order-unknown': return { ...state, busy: false, recovering: false, resumeStatus: false, error: action.message }
    case 'payment-error': return { ...state, busy: false, recovering: false, error: action.message, screen: 'review', idempotencyKey: null, quoteId: null }
    case 'retry-declined': return { ...state, screen: 'review', order: null, idempotencyKey: null, quoteId: null, busy: false, recovering: false, error: null }
    case 'new-order': return { ...EMPTY_STATE, menu: state.menu, loadingMenu: false }
    case 'idle-reset': return state.screen === 'processing' ? state : { ...EMPTY_STATE, menu: state.menu, loadingMenu: false }
  }
}

