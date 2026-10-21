import { useCallback, useEffect, useRef, type Dispatch } from 'react'
import { ApiError, api } from '../api'
import { messages, type Language } from '../copy'
import { type Cart, type State, type Action } from './state'
import { selectedUnitPrice } from './presentation'

export function useCatalogQuoteFlow(
  state: State,
  dispatch: Dispatch<Action>,
  copy: (typeof messages)[Language],
) {
  const quoteRequestId = useRef(0)

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

  return { loadMenu, refreshQuote }
}

function getMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong. Please try again.'
}
