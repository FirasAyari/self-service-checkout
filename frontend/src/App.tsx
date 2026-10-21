import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { MenuItem } from './api'
import { isDemoOutcomeSelectionEnabled } from './demo-outcome-selection'
import { messages, type Language } from './copy'
import { PaymentScreen } from './checkout/PaymentScreen'
import { ATTEMPT_STORAGE_KEY, CART_STORAGE_KEY, EMPTY_OPTION_IDS, PAYMENT_RETRY_STORAGE_KEY, createInitialState, readPaymentCooldownSeconds, reducer, type StoredAttempt } from './checkout/state'
import { categoryName, defaultOptionIds, formatMoney, selectedUnitPrice, withRequiredOptionDefaults } from './checkout/presentation'
import { CompleteScreen, ErrorBoundary, MenuCard, ProcessingScreen, ReviewScreen } from './checkout/screens'
import { useCatalogQuoteFlow } from './checkout/useCatalogQuoteFlow'
import { usePaymentFlow } from './checkout/usePaymentFlow'

const demoOutcomeSelectionEnabled = isDemoOutcomeSelectionEnabled(import.meta.env.MODE)
export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState)
  const [language, setLanguage] = useState<Language>(() => sessionStorage.getItem('goodtable.language') === 'pt-BR' ? 'pt-BR' : 'en')
  const [paymentCooldownSeconds, setPaymentCooldownSeconds] = useState(readPaymentCooldownSeconds)
  const copy = messages[language]
  const [category, setCategory] = useState('All')
  const [showIdlePrompt, setShowIdlePrompt] = useState(false)
  const [showClearDialog, setShowClearDialog] = useState(false)
  const [undoItem, setUndoItem] = useState<{ itemId: string; quantity: number; optionIds: string[]; name: string } | null>(null)
  const [undoSeconds, setUndoSeconds] = useState(0)
  const lastActivity = useRef(0)
  const idleDialogRef = useRef<HTMLElement | null>(null)
  const clearDialogRef = useRef<HTMLElement | null>(null)
  const lastFocusedScreen = useRef(state.screen)
  const undoTimer = useRef<number | null>(null)
  const { loadMenu, refreshQuote } = useCatalogQuoteFlow(state, dispatch, copy)
  const { checkStatus, submitPayment, retrySameAttempt, retryAfterDecline } = usePaymentFlow(state, dispatch, copy, setPaymentCooldownSeconds, refreshQuote)
  const cartCount = useMemo(() => Object.values(state.cart).reduce((sum, line) => sum + line.quantity, 0), [state.cart])
  const cartTotalCents = useMemo(() => Object.entries(state.cart).reduce((sum, [itemId, line]) => {
    const item = state.menu?.categories.flatMap((group) => group.items).find((candidate) => candidate.id === itemId)
    return sum + selectedUnitPrice(item, line.optionIds) * line.quantity
  }, 0), [state.cart, state.menu])
  const categories = useMemo(() => ['All', ...(state.menu?.categories.map((group) => group.name) ?? [])], [state.menu])
  const visibleItems = useMemo(() => state.menu?.categories
    .filter((group) => category === 'All' || group.name === category)
    .flatMap((group) => group.items) ?? [], [state.menu, category])
  const allItems = useMemo(() => new Map(state.menu?.categories.flatMap((group) => group.items).map((item) => [item.id, item]) ?? []), [state.menu])

  useEffect(() => { lastActivity.current = Date.now() }, [])

  useEffect(() => {
    if (!state.menu) return
    const items = new Map(state.menu.categories.flatMap((group) => group.items).map((item) => [item.id, item]))
    for (const [itemId, line] of Object.entries(state.cart)) {
      const item = items.get(itemId)
      if (!item) continue
      const options = withRequiredOptionDefaults(item, line.optionIds)
      if (JSON.stringify(options) !== JSON.stringify(line.optionIds)) dispatch({ type: 'quantity', itemId, quantity: line.quantity, optionIds: options })
    }
  }, [state.menu, state.cart])

  useEffect(() => {
    if ((state.screen === 'complete' && state.order?.status === 'PAID') || Object.keys(state.cart).length === 0) {
      sessionStorage.removeItem(CART_STORAGE_KEY)
      return
    }
    // Store catalog item/option IDs and integer quantities only. Prices and customer data never enter storage.
    sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart))
  }, [state.cart, state.screen, state.order?.status])

  useEffect(() => {
    if (state.screen === 'processing' && state.idempotencyKey && state.quoteId) {
      sessionStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify({
        idempotencyKey: state.idempotencyKey, quoteId: state.quoteId, scenario: state.scenario,
      } satisfies StoredAttempt))
    } else {
      sessionStorage.removeItem(ATTEMPT_STORAGE_KEY)
    }
  }, [state.screen, state.idempotencyKey, state.quoteId, state.scenario])

  useEffect(() => {
    sessionStorage.setItem('goodtable.language', language)
    document.documentElement.lang = language === 'pt-BR' ? 'pt-BR' : 'en'
  }, [language])

  useEffect(() => {
    if (lastFocusedScreen.current === state.screen) return
    lastFocusedScreen.current = state.screen
    document.querySelector<HTMLElement>(state.screen === 'browse' ? '#menu-title' : '#top h1')?.focus()
  }, [state.screen])

  useEffect(() => {
    const updateCooldown = () => {
      let retryAt = 0
      try { retryAt = Number(sessionStorage.getItem(PAYMENT_RETRY_STORAGE_KEY)) } catch { /* keep the in-memory countdown */ }
      const remaining = Number.isFinite(retryAt) ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1_000)) : 0
      setPaymentCooldownSeconds(remaining)
      if (remaining === 0) sessionStorage.removeItem(PAYMENT_RETRY_STORAGE_KEY)
    }
    updateCooldown()
    const timer = window.setInterval(updateCooldown, 1_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const markActivity = () => { lastActivity.current = Date.now() }
    window.addEventListener('pointerdown', markActivity, { passive: true })
    window.addEventListener('keydown', markActivity)
    const timer = window.setInterval(() => {
      if (state.screen === 'processing' || state.busy || (state.screen === 'complete' && state.order?.status === 'PENDING_PAYMENT')) return
      if (Date.now() - lastActivity.current > 60_000) setShowIdlePrompt(true)
    }, 1_000)
    return () => {
      window.removeEventListener('pointerdown', markActivity)
      window.removeEventListener('keydown', markActivity)
      window.clearInterval(timer)
    }
  }, [state.screen, state.busy, state.order])

  useEffect(() => {
    if (!showIdlePrompt && !showClearDialog) return
    const dialog = showIdlePrompt ? idleDialogRef.current : clearDialogRef.current
    const buttons = dialog?.querySelectorAll<HTMLButtonElement>('button')
    buttons?.[showIdlePrompt ? 1 : 0]?.focus()
    const containFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (showIdlePrompt) {
          setShowIdlePrompt(false)
          lastActivity.current = Date.now()
        } else setShowClearDialog(false)
        return
      }
      if (event.key !== 'Tab' || !buttons?.length) return
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', containFocus)
    const timer = showIdlePrompt ? window.setTimeout(() => {
      setShowIdlePrompt(false)
      dispatch({ type: 'idle-reset' })
      lastActivity.current = Date.now()
    }, 15_000) : null
    return () => { if (timer !== null) window.clearTimeout(timer); window.removeEventListener('keydown', containFocus) }
  }, [showIdlePrompt, showClearDialog])

  useEffect(() => () => { if (undoTimer.current !== null) window.clearTimeout(undoTimer.current) }, [])

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
      setUndoItem({ itemId, quantity: current, optionIds: currentLine?.optionIds ?? [], name: item.name })
      setUndoSeconds(5)
      if (undoTimer.current !== null) window.clearInterval(undoTimer.current)
      let remaining = 5
      undoTimer.current = window.setInterval(() => {
        remaining = Math.max(0, remaining - 1)
        setUndoSeconds(remaining)
        if (remaining === 0 && undoTimer.current !== null) {
          window.clearInterval(undoTimer.current)
          undoTimer.current = null
          setUndoItem(null)
        }
      }, 200)
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
    const current = state.cart[undoItem.itemId]?.quantity ?? 0
    const item = allItems.get(undoItem.itemId)
    if (item && !limitReason(item, true, undoItem.optionIds)) {
      const quantity = current + undoItem.quantity
      const nextCart = { ...state.cart, [undoItem.itemId]: { quantity, optionIds: undoItem.optionIds } }
      dispatch({ type: 'quantity', itemId: undoItem.itemId, quantity, optionIds: undoItem.optionIds })
      if (state.screen === 'review') void refreshQuote(copy.refreshed, nextCart)
    }
    if (undoTimer.current !== null) window.clearInterval(undoTimer.current)
    undoTimer.current = null
    setUndoItem(null)
  }

  function clearOrder() {
    if (undoTimer.current !== null) window.clearInterval(undoTimer.current)
    undoTimer.current = null
    setUndoItem(null)
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

  function startFreshAfterIdle() {
    if (undoTimer.current !== null) window.clearInterval(undoTimer.current)
    undoTimer.current = null
    setUndoItem(null)
    setShowIdlePrompt(false)
    dispatch({ type: 'idle-reset' })
  }

  const resumeOrder = () => { setShowIdlePrompt(false); lastActivity.current = Date.now() }
  const step = state.screen === 'browse' ? 1 : state.screen === 'review' ? 2 : 3

  return <ErrorBoundary copy={copy}>
    <div className="app-shell">
      <a className="skip-link" href="#top">{copy.skipToMain}</a>
      <header className="topbar">
        <a className="brand" href="#top"><img className="brand-mark" src="/goodtable-mark.png" alt="" />
          <span>goodtable<span className="brand-period">.</span><small>{copy.tagline}</small></span></a>
        <div className="topbar-right">
          <label className="language-picker"><span>{copy.language}</span><select value={language} onChange={(event) => setLanguage(event.target.value as Language)} aria-label={copy.language}>
            <option value="en">{copy.english}</option><option value="pt-BR">{copy.portuguese}</option></select></label>
          <span className="service-pill"><span className="status-dot" aria-hidden="true" />{copy.service}</span>
          <span className="order-step" aria-label={copy.step(step)}><span>{String(step).padStart(2, '0')}</span> / 03</span>
        </div>
      </header>

      <main id="top" className="main-content" tabIndex={-1}>
        {state.screen === 'browse' && <>
          <section className="welcome-row" aria-labelledby="welcome-title">
            <div className="welcome-copy"><span className="eyebrow"><span className="eyebrow-line" /> {copy.madeFresh}</span>
              <h1 id="welcome-title" tabIndex={-1}>{copy.hero}</h1><p>{copy.heroDescription}</p><div className="welcome-note"><span className="sparkle" aria-hidden="true" />{copy.readyTime}</div></div>
            <div className="welcome-art"><img className="welcome-photo" src="/images/hero-grain-bowl.jpg" alt="" fetchPriority="high" /></div>
          </section>

          <section className="menu-section" aria-labelledby="menu-title">
            <div className="section-heading"><div><span className="eyebrow"><span className="eyebrow-line" /> {copy.menuEyebrow}</span><h2 id="menu-title" tabIndex={-1}>{copy.menuTitle}</h2></div><span className="fresh-badge"><span className="fresh-leaf" aria-hidden="true" />{copy.fresh}</span></div>
            {state.error && state.menu && <div className="error-banner" role="alert"><span>{state.error}</span><button className="text-button" onClick={() => void loadMenu()}>{copy.retry}</button></div>}
            {state.notice && <div className="notice-banner" role="status">{state.notice}</div>}
            <div className="category-row" role="group" aria-label={copy.categoryFilter}>
              {categories.map((name) => <button key={name} className={`category-chip ${category === name ? 'active' : ''}`} aria-pressed={category === name} onClick={() => setCategory(name)}>{categoryName(name, language, copy)}</button>)}
            </div>
            {state.loadingMenu && !state.menu ? <div className="menu-skeleton" role="status" aria-label={copy.loadingMenu}>
              <span>{copy.loadingMenu}</span><div className="menu-skeleton-grid" aria-hidden="true">{[0, 1, 2].map((item) => <div className="menu-skeleton-card" key={item}><i /><b /><b /><em /></div>)}</div>
            </div> : !state.menu ? <div className="menu-state" role="alert">{state.error ?? (language === 'pt-BR' ? 'Não foi possível carregar o cardápio.' : 'We could not load the menu.')} <button className="text-button" onClick={() => void loadMenu()}>{copy.retry}</button></div> : visibleItems.length === 0 ? <div className="menu-state">{copy.noItems}</div> :
              <div className="menu-grid">{visibleItems.map((item, index) => <MenuCard key={item.id} item={item} quantity={state.cart[item.id]?.quantity ?? 0} optionIds={state.cart[item.id]?.optionIds ?? EMPTY_OPTION_IDS} index={index} language={language} copy={copy}
                getDisabledReason={(optionIds) => limitReason(item, true, optionIds)} onChange={(quantity, optionIds) => changeQuantity(item.id, quantity, quantity === 0, optionIds)} />)}</div>}
          </section>
        </>}

        {state.screen === 'review' && <ReviewScreen quote={state.quote} cart={state.cart} menuItems={allItems} language={language} copy={copy}
          busy={state.busy} error={state.error} notice={state.notice} stockIssue={state.stockIssue} changedItemIds={state.changedItemIds}
          quoteNeedsConsent={state.quoteNeedsConsent} paymentCooldownSeconds={paymentCooldownSeconds} onBack={() => dispatch({ type: 'back-to-menu' })} onClear={requestClearOrder}
          onQuantity={(itemId, quantity) => changeQuantity(itemId, quantity, quantity === 0)}
          onRefresh={() => void refreshQuote(copy.refreshed)} onAccept={() => dispatch({ type: 'accept-quote' })} onContinue={() => dispatch({ type: 'continue-payment' })} />}

        {state.screen === 'pay' && state.quote && <PaymentScreen quote={state.quote} scenario={state.scenario} language={language} copy={copy}
          paymentCooldownSeconds={paymentCooldownSeconds} allowOutcomeSelection={demoOutcomeSelectionEnabled} formatMoney={formatMoney} onBack={() => dispatch({ type: 'back-to-review' })}
          onScenario={(scenario) => dispatch({ type: 'scenario', scenario })} onSubmit={() => void submitPayment()} />}

        {state.screen === 'processing' && <ProcessingScreen order={state.order} busy={state.busy} recovering={state.recovering} error={state.error}
          language={language} copy={copy} onCheck={() => void checkStatus()} onRetry={() => void retrySameAttempt()} />}

        {state.screen === 'complete' && state.order && <CompleteScreen order={state.order} quote={state.quote} language={language} copy={copy}
          onRetry={retryAfterDecline} onNewOrder={() => { dispatch({ type: 'new-order' }); setCategory('All') }} />}
      </main>

      {state.screen === 'browse' && cartCount > 0 && <div className="cart-dock"><div className="dock-inner"><div className="dock-info" aria-live="polite" aria-atomic="true"><span className="cart-count">{cartCount}</span><span><strong>{copy.cart}</strong><small>{copy.choice(cartCount)} · {copy.cartTotal}: {formatMoney(cartTotalCents, 'USD', language)}</small></span></div>
        <div className="dock-actions"><button className="text-button clear-order" onClick={requestClearOrder}>{copy.clear}</button>
          <button className="primary-button dock-button" onClick={() => void refreshQuote()} disabled={state.busy}>{copy.review} <span aria-hidden="true">→</span></button></div>
      </div></div>}

      <footer className="site-footer"><span>{copy.footerOne}</span><span>{copy.footerTwo}</span></footer>

      {undoItem && <div className="undo-toast" role="status" aria-live="polite"><span>{copy.undoRemoved(undoItem.name)} {undoSeconds}</span>
        <button className="text-button" onClick={restoreRemovedItem}>{copy.undo}</button></div>}

      {showIdlePrompt && <div className="modal-backdrop"><section ref={idleDialogRef} className="idle-dialog" role="alertdialog" aria-modal="true" aria-labelledby="idle-title" aria-describedby="idle-copy">
        <span className="eyebrow"><span className="eyebrow-line" /> {copy.cart.toUpperCase()}</span><h2 id="idle-title">{copy.stillChoosing}</h2><p id="idle-copy">{copy.idleCopy}</p>
        <div className="idle-actions"><button className="secondary-button" onClick={startFreshAfterIdle}>{copy.freshStart}</button><button autoFocus className="primary-button" onClick={resumeOrder}>{copy.keepOrder}</button></div>
      </section></div>}
      {showClearDialog && <div className="modal-backdrop"><section ref={clearDialogRef} className="idle-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-title" aria-describedby="clear-copy">
        <span className="eyebrow"><span className="eyebrow-line" /> {copy.cart.toUpperCase()}</span><h2 id="clear-title">{copy.confirmClearTitle}</h2><p id="clear-copy">{copy.confirmClearCopy}</p>
        <div className="idle-actions"><button autoFocus className="secondary-button" onClick={() => setShowClearDialog(false)}>{copy.cancelClear}</button><button className="primary-button" onClick={confirmClearOrder}>{copy.confirmClear}</button></div>
      </section></div>}
    </div>
  </ErrorBoundary>
}
