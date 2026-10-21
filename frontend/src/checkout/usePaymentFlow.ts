import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { ApiError, api, type OrderStatus } from '../api'
import { getEffectivePaymentScenario } from '../demo-outcome-selection'
import { messages, type Language } from '../copy'
import { ATTEMPT_STORAGE_KEY, PAYMENT_RETRY_STORAGE_KEY, type State, type Action, type StoredAttempt } from './state'

type RefreshQuote = (notice?: string) => Promise<void>

export function usePaymentFlow(
  state: State,
  dispatch: Dispatch<Action>,
  copy: (typeof messages)[Language],
  setPaymentCooldownSeconds: Dispatch<SetStateAction<number>>,
  refreshQuote: RefreshQuote,
) {
  const polling = useRef(false)
  const submittingPayment = useRef(false)

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

  return { checkStatus, submitPayment, retrySameAttempt, retryAfterDecline }
}
