import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { isDemoOutcomeSelectionEnabled } from './demo-outcome-selection'
import { messages, type Language } from './copy'
import { PaymentScreen } from './checkout/PaymentScreen'
import { ATTEMPT_STORAGE_KEY, CART_STORAGE_KEY, EMPTY_OPTION_IDS, PAYMENT_RETRY_STORAGE_KEY, createInitialState, readPaymentCooldownSeconds, reducer, type StoredAttempt } from './checkout/state'
import { categoryName, formatMoney, localizedMenuText, selectedUnitPrice, withRequiredOptionDefaults } from './checkout/presentation'
import { CompleteScreen, ErrorBoundary, MenuCard, ProcessingScreen, ReviewScreen } from './checkout/screens'
import { useCatalogQuoteFlow } from './checkout/useCatalogQuoteFlow'
import { useCartActions } from './checkout/useCartActions'
import { useKioskSession } from './checkout/useKioskSession'
import { usePaymentFlow } from './checkout/usePaymentFlow'

const demoOutcomeSelectionEnabled = isDemoOutcomeSelectionEnabled(import.meta.env.MODE)
export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState)
  const [language, setLanguage] = useState<Language>(() => sessionStorage.getItem('goodtable.language') === 'pt-BR' ? 'pt-BR' : 'en')
  const [paymentCooldownSeconds, setPaymentCooldownSeconds] = useState(readPaymentCooldownSeconds)
  const copy = messages[language]
  const [category, setCategory] = useState('All')
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
  const cartActions = useCartActions(state, dispatch, copy, cartCount, cartTotalCents, allItems, refreshQuote)
  const idleDialogRef = useRef<HTMLElement | null>(null)
  const clearDialogRef = useRef<HTMLElement | null>(null)
  const kioskSession = useKioskSession(
    state,
    dispatch,
    idleDialogRef,
    clearDialogRef,
    cartActions.showClearDialog,
    cartActions.cancelClearOrder,
    cartActions.clearUndo,
  )

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

  const step = state.screen === 'browse' ? 1 : state.screen === 'review' ? 2 : 3

  return <ErrorBoundary copy={copy}>
    <div className="app-shell">
      <a className="skip-link" href="#top">{copy.skipToMain}</a>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Good Table — Fresh food, good vibes">
          <img className="brand-mark" src="/goodtable-mark.png" alt="" />
          <span className="brand-wordmark">good table</span>
        </a>
        <div className="topbar-right">
          <label className="language-picker"><span>{copy.language}</span><select value={language} onChange={(event) => setLanguage(event.target.value as Language)} aria-label={copy.language}>
            <option value="en">{copy.english}</option><option value="pt-BR">{copy.portuguese}</option></select></label>
          <span className="service-pill"><span className="status-dot" aria-hidden="true" /><span className="service-label-full">{copy.service}</span><span className="service-label-short" aria-hidden="true">{copy.serviceShort}</span></span>
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
                getDisabledReason={(optionIds) => cartActions.limitReason(item, true, optionIds)} onChange={(quantity, optionIds) => cartActions.changeQuantity(item.id, quantity, quantity === 0, optionIds)} />)}</div>}
          </section>
        </>}

        {state.screen === 'review' && <ReviewScreen quote={state.quote} cart={state.cart} menuItems={allItems} language={language} copy={copy}
          busy={state.busy} error={state.error} notice={state.notice} stockIssue={state.stockIssue} changedItemIds={state.changedItemIds}
          quoteNeedsConsent={state.quoteNeedsConsent} paymentCooldownSeconds={paymentCooldownSeconds} onBack={() => dispatch({ type: 'back-to-menu' })} onClear={cartActions.requestClearOrder}
          onQuantity={(itemId, quantity) => cartActions.changeQuantity(itemId, quantity, quantity === 0)}
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
        <div className="dock-actions"><button className="text-button clear-order" onClick={cartActions.requestClearOrder}>{copy.clear}</button>
          <button className="primary-button dock-button" onClick={() => void refreshQuote()} disabled={state.busy}>{copy.review} <span aria-hidden="true">→</span></button></div>
      </div></div>}

      <footer className="site-footer"><span>{copy.footerOne}</span><span>{copy.footerTwo}</span></footer>

      {cartActions.undoItem && <div className="undo-toast" role="status" aria-live="polite"><span>{copy.undoRemoved(localizedMenuText(cartActions.undoItem.name, language))} {cartActions.undoSeconds}</span>
        <button className="text-button" onClick={cartActions.restoreRemovedItem}>{copy.undo}</button></div>}

      {kioskSession.showIdlePrompt && <div className="modal-backdrop"><section ref={idleDialogRef} className="idle-dialog" role="alertdialog" aria-modal="true" aria-labelledby="idle-title" aria-describedby="idle-copy">
        <span className="eyebrow"><span className="eyebrow-line" /> {copy.cart.toUpperCase()}</span><h2 id="idle-title">{copy.stillChoosing}</h2><p id="idle-copy">{copy.idleCopy}</p>
        <div className="idle-actions"><button className="secondary-button" onClick={kioskSession.startFreshAfterIdle}>{copy.freshStart}</button><button autoFocus className="primary-button" onClick={kioskSession.resumeOrder}>{copy.keepOrder}</button></div>
      </section></div>}
      {cartActions.showClearDialog && <div className="modal-backdrop"><section ref={clearDialogRef} className="idle-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-title" aria-describedby="clear-copy">
        <span className="eyebrow"><span className="eyebrow-line" /> {copy.cart.toUpperCase()}</span><h2 id="clear-title">{copy.confirmClearTitle}</h2><p id="clear-copy">{copy.confirmClearCopy}</p>
        <div className="idle-actions"><button autoFocus className="secondary-button" onClick={cartActions.cancelClearOrder}>{copy.cancelClear}</button><button className="primary-button" onClick={cartActions.confirmClearOrder}>{copy.confirmClear}</button></div>
      </section></div>}
    </div>
  </ErrorBoundary>
}
