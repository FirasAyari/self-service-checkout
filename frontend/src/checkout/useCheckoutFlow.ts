import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { ApiError, api, type OrderStatus } from '../api'
import { getEffectivePaymentScenario } from '../demo-outcome-selection'
import { messages, type Language } from '../copy'
import { ATTEMPT_STORAGE_KEY, PAYMENT_RETRY_STORAGE_KEY, type Cart, type State, type Action, type StoredAttempt } from './state'
import { selectedUnitPrice } from './presentation'

export function useCheckoutFlow(
  state: State,
  dispatch: Dispatch<Action>,
  copy: (typeof messages)[Language],
  setPaymentCooldownSeconds: Dispatch<SetStateAction<number>>,
) {
  const quoteRequestId = useRef(0)
  const polling = useRef(false)
  const submittingPayment = useRef(false)

  const loadMenu = useCallback(async () => {
    dispatch({ type: 'menu-loading' })
    const backoff = [2_000, 4_000, 8_000, 15_000]
    for (let attempt = 0; ; attempt += 1) {
      try {
        dispatch({ type: 'menu-loaded', menu: await api.menu() })
        return
      } catch (error) {
        dispatch({ type: 'menu-failed', message: getMessage(error) })
        await new Promise((resolve) => window.setTimeout(resolve, backoff[Math.min(attempt, backoff.length - 1)]))
        dispatch({ type: 'menu-loading' })
      }
    }
  }, [dispatch])

  useEffect(() => { void loadMenu() }, [loadMenu])

  useEffect(() => {
    if (state.screen !== 'browse' || !state.menu) return
    const timer = window.setInterval(() => {
      void api.menu().then((menu) => {
        const priorItems = new Map(state.menu?.categories.flatMap((group) => group.items).map((item) => [item.id, item]) ?? [])
        const nextItems = new Map(menu.categories.flatMap((group) => group.items).map((item) => [item.id, item]))
        const changedCartItemIds = Object.keys(state.cart).filter((itemId) => {
          const before = priorItems.get(itemId)
          const after = nextItems.get(itemId)
          return !before || !after || before.priceCents !== after.priceCents || before.stock !== after.stock ||
            before.isAvailable !== after.isAvailable || JSON.stringify(before.optionGroups) !== JSON.stringify(after.optionGroups)
        })
        dispatch({ type: 'menu-loaded', menu, changedItemIds: [...new Set([...state.changedItemIds, ...changedCartItemIds])] })
      }).catch(() => dispatch({ type: 'menu-refresh-failed', message: copy.reconnecting }))
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [state.screen, state.menu, state.cart, state.changedItemIds, copy.reconnecting, dispatch])

  const refreshQuote = useCallback(async (notice?: string, cart: Cart = state.cart, pendingChangedItemIds: string[] = state.changedItemIds) => {
    const requestId = ++quoteRequestId.current
    dispatch({ type: 'review-start' })
    if (Object.keys(cart).length === 0) {
      dispatch({ type: 'quote-failed', message: copy.noQuote })
      return
    }
    let latestMenu = state.menu
    let reconnecting = false
    let changedCartItemIds: string[] = []
    try {
      latestMenu = await api.menu()
      if (requestId !== quoteRequestId.current) return
      const priorItems = new Map(state.menu?.categories.flatMap((group) => group.items).map((item) => [item.id, item]) ?? [])
      const currentItems = new Map(latestMenu.categories.flatMap((group) => group.items).map((item) => [item.id, item]))
      changedCartItemIds = Object.keys(cart).filter((itemId) => {
        const before = priorItems.get(itemId)
        const after = currentItems.get(itemId)
        return !before || !after || before.priceCents !== after.priceCents || before.stock !== after.stock || before.isAvailable !== after.isAvailable || JSON.stringify(before.optionGroups) !== JSON.stringify(after.optionGroups)
      })
      changedCartItemIds = [...new Set([...changedCartItemIds, ...pendingChangedItemIds.filter((itemId) => itemId in cart)])]
      dispatch({ type: 'menu-loaded', menu: latestMenu, changedItemIds: changedCartItemIds })
    } catch {
      if (requestId !== quoteRequestId.current) return
      reconnecting = true /* The quote endpoint remains authoritative; keep the last known menu for recovery controls. */
    }

    if (latestMenu) {
      const currentItems = new Map(latestMenu.categories.flatMap((group) => group.items).map((item) => [item.id, item]))
      const unavailable = Object.entries(cart).some(([itemId, line]) => {
        const item = currentItems.get(itemId)
        return !item || !item.isAvailable || (item.stock !== null && line.quantity > item.stock)
      })
      if (unavailable) {
        if (requestId !== quoteRequestId.current) return
        dispatch({ type: 'stock-issue', message: copy.stockShort })
        return
      }
    }

    try {
      const quote = await api.quote(Object.entries(cart).map(([itemId, line]) => ({ itemId, quantity: line.quantity, optionIds: line.optionIds })))
      if (requestId !== quoteRequestId.current) return
      const oldItems = new Map(state.menu?.categories.flatMap((group) => group.items).map((item) => [item.id, item]) ?? [])
      const oldPrices = new Map(Object.entries(cart).map(([itemId, line]) => [itemId, selectedUnitPrice(oldItems.get(itemId), line.optionIds)]))
      const changedPriceIds = quote.lines.filter((line) => oldPrices.has(line.itemId) && oldPrices.get(line.itemId) !== line.unitPriceCents).map((line) => line.itemId)
      const pricesChanged = changedPriceIds.length > 0
      const menuChangeNeedsConsent = pendingChangedItemIds.some((itemId) => itemId in cart)
      const requiresConsent = state.requireConsentOnNextQuote || state.quote !== null || pricesChanged || menuChangeNeedsConsent
      const allChangedIds = [...new Set([...changedCartItemIds, ...changedPriceIds])]
      dispatch({ type: 'quote-loaded', quote, notice: requiresConsent ? copy.updatedQuote : reconnecting ? copy.reconnecting : allChangedIds.length ? copy.menuUpdated : notice, requiresConsent, changedItemIds: allChangedIds })
    } catch (error) {
      if (requestId !== quoteRequestId.current) return
      if (error instanceof ApiError && (error.status === 409 || error.code?.includes('STOCK') === true)) {
        try {
          const menu = await api.menu()
          if (requestId !== quoteRequestId.current) return
          dispatch({ type: 'menu-loaded', menu })
        } catch {
          if (requestId !== quoteRequestId.current) return
          /* keep the last menu */
        }
        if (requestId !== quoteRequestId.current) return
        dispatch({ type: 'stock-issue', message: copy.stockShort })
        return
      }
      dispatch({ type: 'quote-failed', message: getMessage(error) })
    }
  }, [state.cart, state.menu, state.changedItemIds, state.quote, state.requireConsentOnNextQuote, copy, dispatch])

  const updateOrder = useCallback((order: OrderStatus) => {
    if (order.status !== 'PENDING_PAYMENT') submittingPayment.current = false
    dispatch({ type: 'order-updated', order })
  }, [dispatch])

  const checkStatus = useCallback(async () => {
    if (!state.idempotencyKey || polling.current) return
    polling.current = true
    dispatch({ type: 'recovery-start' })
    try {
      updateOrder(await api.status(state.idempotencyKey))
    } catch (error) {
      dispatch({ type: 'order-unknown', message: error instanceof ApiError && error.status === 404
        ? 'This attempt is not visible yet. We will check this same attempt again.'
        : 'We could not confirm the result yet. Keep this page open; do not pay again.' })
    } finally {
      polling.current = false
    }
  }, [state.idempotencyKey, updateOrder, dispatch])

  useEffect(() => {
    if (state.screen !== 'processing' || !state.idempotencyKey || (state.order !== null && state.order.status !== 'PENDING_PAYMENT') || state.busy) return
    if (state.resumeStatus) {
      void checkStatus()
      return
    }
    const timer = window.setInterval(() => { void checkStatus() }, 5_000)
    return () => window.clearInterval(timer)
  }, [state.screen, state.order, state.busy, state.idempotencyKey, state.resumeStatus, checkStatus])

  const submitPayment = useCallback(async () => {
    if (!state.quote || state.quoteNeedsConsent || submittingPayment.current) return
    submittingPayment.current = true
    const key = state.idempotencyKey ?? crypto.randomUUID().replaceAll('-', '')
    try {
      // Save the attempt before the network request so a reload can resolve this same idempotency key.
      sessionStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify({
        idempotencyKey: key, quoteId: state.quote.quoteId, scenario: getEffectivePaymentScenario(import.meta.env.MODE, state.scenario),
      } satisfies StoredAttempt))
    } catch {
      submittingPayment.current = false
      dispatch({ type: 'payment-error', message: 'This browser could not save the checkout attempt. Please try again before placing the order.' })
      return
    }
    dispatch({ type: 'order-start', idempotencyKey: key })
    try {
      const order = await api.placeOrder(state.quote.quoteId, key, getEffectivePaymentScenario(import.meta.env.MODE, state.scenario))
      updateOrder(order)
      if (order.status !== 'PENDING_PAYMENT') submittingPayment.current = false
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        submittingPayment.current = false
        // A 429 rejects submission before an order exists; status lookup would strand the kiosk in a pending state.
        const seconds = Math.min(3_600, Math.max(0, error.retryAfterSeconds ?? (error.code === 'PAYMENT_LOCKED' ? 60 : 5)))
        if (seconds > 0) {
          try { sessionStorage.setItem(PAYMENT_RETRY_STORAGE_KEY, String(Date.now() + seconds * 1_000)) } catch { /* use the in-memory countdown */ }
          setPaymentCooldownSeconds(seconds)
        }
        dispatch({ type: 'payment-error', message: copy.paymentRateLimited })
        return
      }
      if (error instanceof ApiError && error.status > 0 && error.status < 500 && error.status !== 429) {
        if (error.status === 409 || error.status === 400) {
          submittingPayment.current = false
          dispatch({ type: 'payment-error', message: error.message })
          if (error.code === 'PRICE_CHANGED' || error.code === 'QUOTE_EXPIRED' || error.code === 'STOCK_CHANGED' || error.status === 409) {
            void refreshQuote(copy.updatedQuote)
          }
          return
        }
      }
      const recoveryMessage = error instanceof ApiError && error.status === 0
        ? copy.connectionInterrupted
        : error instanceof ApiError && error.status >= 200 && error.status < 300
          ? error.message
          : copy.sameAttempt
      dispatch({ type: 'order-unknown', message: recoveryMessage })
      try { updateOrder(await api.status(key)) }
      catch { dispatch({ type: 'order-unknown', message: recoveryMessage }) }
    }
  }, [state.quote, state.quoteNeedsConsent, state.idempotencyKey, state.scenario, updateOrder, refreshQuote, copy.updatedQuote, copy.paymentRateLimited, copy.connectionInterrupted, copy.sameAttempt, dispatch, setPaymentCooldownSeconds])

  const retrySameAttempt = useCallback(async () => {
    if (!state.idempotencyKey || !state.quoteId) return
    dispatch({ type: 'order-start', idempotencyKey: state.idempotencyKey })
    try { updateOrder(await api.placeOrder(state.quoteId, state.idempotencyKey, getEffectivePaymentScenario(import.meta.env.MODE, state.scenario))) }
    catch { dispatch({ type: 'order-unknown', message: 'We could not confirm the response. Checking this same attempt.' }); await checkStatus() }
  }, [state.idempotencyKey, state.quoteId, state.scenario, updateOrder, checkStatus, dispatch])

  const retryAfterDecline = useCallback(() => {
    submittingPayment.current = false
    dispatch({ type: 'retry-declined' })
    void refreshQuote(copy.updatedQuote)
  }, [refreshQuote, copy.updatedQuote, dispatch])

  return { loadMenu, refreshQuote, checkStatus, submitPayment, retrySameAttempt, retryAfterDecline }
}

function getMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong. Please try again.'
}
