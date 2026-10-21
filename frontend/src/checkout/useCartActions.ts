import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react'
import type { MenuItem } from '../api'
import { messages, type Language } from '../copy'
import { defaultOptionIds, selectedUnitPrice } from './presentation'
import type { Action, Cart, State } from './state'

type QuoteRefresher = (notice?: string, cart?: Cart, changedItemIds?: string[]) => Promise<void>
type RemovedLine = { itemId: string; quantity: number; optionIds: string[]; name: string }

export function useCartActions(
  state: State,
  dispatch: Dispatch<Action>,
  copy: (typeof messages)[Language],
  cartCount: number,
  cartTotalCents: number,
  allItems: Map<string, MenuItem>,
  refreshQuote: QuoteRefresher,
) {
  const [showClearDialog, setShowClearDialog] = useState(false)
  const [undoItem, setUndoItem] = useState<RemovedLine | null>(null)
  const [undoSeconds, setUndoSeconds] = useState(0)
  const undoTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (undoTimer.current !== null) window.clearInterval(undoTimer.current)
  }, [])

  const clearUndo = useCallback(() => {
    if (undoTimer.current !== null) window.clearInterval(undoTimer.current)
    undoTimer.current = null
    setUndoItem(null)
    setUndoSeconds(0)
  }, [])

  function limitReason(item: MenuItem, adding: boolean, optionIds?: string[]): string | undefined {
    if (!adding) return undefined
    const quantity = state.cart[item.id]?.quantity ?? 0
    if (!item.isAvailable || (item.stock !== null && quantity >= item.stock)) return copy.limitStock
    if (quantity >= 10) return copy.limitPerLine
    if (cartCount >= 30) return copy.limitUnits
    if (quantity === 0 && Object.keys(state.cart).length >= 15) return copy.limitLines
    const proposedUnitPrice = selectedUnitPrice(item, optionIds ?? state.cart[item.id]?.optionIds ?? defaultOptionIds(item))
    if (cartTotalCents + proposedUnitPrice > 15_000) return copy.limitTotal
    return undefined
  }

  function changeQuantity(itemId: string, quantity: number, allowUndo = false, optionIds?: string[]) {
    const currentLine = state.cart[itemId]
    const current = currentLine?.quantity ?? 0
    const item = allItems.get(itemId)
    const selectedOptions = optionIds ?? currentLine?.optionIds ?? (item ? defaultOptionIds(item) : [])
    if (item && quantity > 0) {
      const oldLineTotal = selectedUnitPrice(item, currentLine?.optionIds ?? []) * current
      const proposedTotal = cartTotalCents - oldLineTotal + selectedUnitPrice(item, selectedOptions) * quantity
      if (proposedTotal > 15_000) return
    }
    if (quantity > current && item && limitReason(item, true, selectedOptions)) return
    if (allowUndo && current > 0 && quantity === 0 && item) {
      clearUndo()
      setUndoItem({ itemId, quantity: current, optionIds: currentLine?.optionIds ?? [], name: item.name })
      setUndoSeconds(5)
      let remaining = 5
      undoTimer.current = window.setInterval(() => {
        remaining = Math.max(0, remaining - 1)
        setUndoSeconds(remaining)
        if (remaining === 0 && undoTimer.current !== null) {
          window.clearInterval(undoTimer.current)
          undoTimer.current = null
          setUndoItem(null)
        }
      }, 1_000)
    }
    const nextCart = { ...state.cart }
    if (quantity <= 0) delete nextCart[itemId]
    else nextCart[itemId] = { quantity, optionIds: selectedOptions }
    const nextChangedItemIds = state.changedItemIds.filter((changedId) => changedId !== itemId)
    dispatch({ type: 'quantity', itemId, quantity, optionIds: selectedOptions, emptyNotice: state.screen === 'review' && quantity === 0 && Object.keys(state.cart).length === 1 ? copy.cartEmpty : undefined })
    if (state.screen === 'review' && Object.keys(nextCart).length > 0) void refreshQuote(copy.refreshed, nextCart, nextChangedItemIds)
  }

  function restoreRemovedItem() {
    if (!undoItem) return
    const currentLine = state.cart[undoItem.itemId]
    const current = currentLine?.quantity ?? 0
    const item = allItems.get(undoItem.itemId)
    const quantity = current + undoItem.quantity
    let reason: string | undefined

    if (!item) reason = copy.missingItem
    else if (!item.isAvailable || (item.stock !== null && item.stock < quantity)) reason = copy.limitStock
    else if (quantity > 10) reason = copy.limitPerLine
    else if (current === 0 && Object.keys(state.cart).length >= 15) reason = copy.limitLines
    else if (cartCount + undoItem.quantity > 30) reason = copy.limitUnits

    if (!reason && item) {
      const oldUnitPrice = selectedUnitPrice(item, currentLine?.optionIds ?? [])
      const restoredUnitPrice = selectedUnitPrice(item, undoItem.optionIds)
      const restoredTotal = cartTotalCents - oldUnitPrice * current + restoredUnitPrice * quantity
      if (restoredTotal > 15_000) reason = copy.limitTotal
    }

    if (reason) {
      dispatch({ type: 'notice', message: reason })
    } else {
      const nextCart = { ...state.cart, [undoItem.itemId]: { quantity, optionIds: undoItem.optionIds } }
      dispatch({ type: 'quantity', itemId: undoItem.itemId, quantity, optionIds: undoItem.optionIds })
      if (state.screen === 'review') void refreshQuote(copy.refreshed, nextCart)
    }
    clearUndo()
  }

  function clearOrder() {
    clearUndo()
    dispatch({ type: 'clear-cart', emptyNotice: state.screen === 'review' ? copy.cartEmpty : undefined })
  }

  function requestClearOrder() {
    if (cartCount >= 2) setShowClearDialog(true)
    else clearOrder()
  }

  function confirmClearOrder() {
    setShowClearDialog(false)
    clearOrder()
  }

  const cancelClearOrder = useCallback(() => setShowClearDialog(false), [])

  return {
    limitReason,
    showClearDialog,
    undoItem,
    undoSeconds,
    changeQuantity,
    clearUndo,
    restoreRemovedItem,
    requestClearOrder,
    confirmClearOrder,
    cancelClearOrder,
  }
}
