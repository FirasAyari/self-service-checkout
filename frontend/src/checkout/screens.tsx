import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import type { MenuItem, OrderLine, OrderStatus, Quote } from '../api'
import type { Copy, Language } from '../copy'
import type { Cart } from './state'
import { categoryName, formatMoney, localizedMenuText, localizedOption, localizedOptionGroup, selectedUnitPrice, withRequiredOptionDefaults } from './presentation'

const menuPhotoIds = new Set([
  'turkey-melt', 'garden-wrap', 'chicken-club', 'tomato-panini', 'grain-bowl', 'chicken-bowl',
  'falafel-bowl', 'soup-cup', 'sparkling-water', 'iced-tea', 'cold-brew', 'lemonade',
])
const fallbackPhotoByCategory: Record<string, string> = {
  Sandwiches: '/images/menu/turkey-melt.jpg',
  Bowls: '/images/menu/grain-bowl.jpg',
  Drinks: '/images/menu/lemonade.jpg',
}


export function MenuCard({ item, quantity, optionIds, index, language, copy, getDisabledReason, onChange }: {
  item: MenuItem; quantity: number; optionIds: string[]; index: number; language: Language; copy: Copy
  getDisabledReason: (optionIds: string[]) => string | undefined; onChange: (quantity: number, optionIds: string[]) => void
}) {
  const [draftOptionIds, setDraftOptionIds] = useState<string[]>(() => withRequiredOptionDefaults(item, optionIds))
  const selectedOptionIds = withRequiredOptionDefaults(item, quantity > 0 ? optionIds : draftOptionIds)
  const available = item.isAvailable && (item.stock === null || item.stock > 0)
  const lowStock = available && item.stock !== null && item.stock > 0 && item.stock <= 5
  const disabledReason = getDisabledReason(selectedOptionIds)
  const plusDisabled = Boolean(disabledReason)
  const itemName = localizedMenuText(item.name, language)
  const updateOption = (groupId: string, optionId: string, checked: boolean) => {
    const group = item.optionGroups.find((candidate) => candidate.id === groupId)
    if (!group) return
    const groupIds = group.options.map((option) => option.id)
    const currentSelection = selectedOptionIds.filter((id) => groupIds.includes(id))
    const updatedSelection = group.isRequired
      ? [optionId]
      : checked ? [...currentSelection, optionId] : currentSelection.filter((id) => id !== optionId)
    const next = [...selectedOptionIds.filter((id) => !groupIds.includes(id)), ...updatedSelection]
    setDraftOptionIds(next)
    if (quantity > 0) onChange(quantity, next)
  }
  const unitPriceCents = selectedUnitPrice(item, selectedOptionIds)
  const imageSource = menuPhotoIds.has(item.id)
    ? `/images/menu/${item.id}.jpg`
    : fallbackPhotoByCategory[item.category] ?? '/images/menu/grain-bowl.jpg'
  return <article className={`menu-card ${!available ? 'unavailable' : ''}`}>
    <div className="food-art" aria-hidden="true"><img src={imageSource} alt="" loading={index < 3 ? 'eager' : 'lazy'} decoding="async" /></div>
    <div className="menu-card-body"><div className="menu-card-title"><h3>{itemName}</h3><span className="price">{formatMoney(unitPriceCents, 'USD', language)}</span></div>
      <p>{localizedMenuText(item.description, language)}</p>
      {item.optionGroups.map((group) => <fieldset className="menu-options" key={group.id}><legend>{localizedOptionGroup(group.id, group.name, language)}{group.isRequired ? ' *' : ''}</legend>
        {group.isRequired ? <select aria-label={localizedOptionGroup(group.id, group.name, language)} value={selectedOptionIds.find((id) => group.options.some((option) => option.id === id)) ?? ''}
          onChange={(event) => updateOption(group.id, event.target.value, true)}>{group.options.map((option) => <option key={option.id} value={option.id}>{localizedOption(option.id, option.name, language)}{option.additionalPriceCents ? ` (+${formatMoney(option.additionalPriceCents, 'USD', language)})` : ''}</option>)}</select> :
          <div className="option-checkboxes">{group.options.map((option) => {
            const checked = selectedOptionIds.includes(option.id)
            const selectedInGroup = selectedOptionIds.filter((id) => group.options.some((candidate) => candidate.id === id)).length
            return <label key={option.id}><input type="checkbox" checked={checked} disabled={!checked && selectedInGroup >= group.maximumSelections}
              onChange={(event) => updateOption(group.id, option.id, event.target.checked)} />{localizedOption(option.id, option.name, language)}{option.additionalPriceCents ? ` (+${formatMoney(option.additionalPriceCents, 'USD', language)})` : ''}</label>
          })}</div>}
      </fieldset>)}
      <div className="menu-card-bottom"><span className="category-label">{categoryName(item.category, language, copy)}</span>
        {lowStock && <span className="low-stock-badge" role="status">{copy.lowStock(item.stock!)}</span>}
        {!available ? <button className="sold-out" type="button" disabled aria-label={`${itemName}, ${copy.soldOut}`}>{copy.soldOut}</button> : quantity === 0 ?
          <button className="add-button" onClick={() => onChange(1, selectedOptionIds)} disabled={plusDisabled} aria-label={`${copy.add} ${itemName}`} aria-describedby={plusDisabled ? `limit-${item.id}` : undefined} title={disabledReason}>
            <span aria-hidden="true">+</span> {copy.add}</button> :
          <div className="quantity-control" aria-label={`${itemName}, ${quantity}`}>
            <button onClick={() => onChange(quantity - 1, selectedOptionIds)} aria-label={`${copy.reduce}: ${itemName}`}>−</button><span aria-live="polite">{quantity}</span>
            <button onClick={() => onChange(quantity + 1, selectedOptionIds)} disabled={plusDisabled} aria-label={`${copy.increase}: ${itemName}`} aria-describedby={plusDisabled ? `limit-${item.id}` : undefined} title={disabledReason}>+</button>
          </div>}
      </div>
      {plusDisabled && <small className="limit-hint" id={`limit-${item.id}`}>{disabledReason}</small>}
    </div>
  </article>
}

export function ReviewScreen({ quote, cart, menuItems, language, copy, busy, error, notice, stockIssue, changedItemIds, quoteNeedsConsent, paymentCooldownSeconds, onBack, onClear, onQuantity, onRefresh, onAccept, onContinue }: {
  quote: Quote | null; cart: Cart; menuItems: Map<string, MenuItem>; language: Language; copy: Copy; busy: boolean
  error: string | null; notice: string | null; stockIssue: boolean; changedItemIds: string[]; quoteNeedsConsent: boolean; paymentCooldownSeconds: number; onBack: () => void; onClear: () => void
  onQuantity: (itemId: string, quantity: number) => void; onRefresh: () => void; onAccept: () => void; onContinue: () => void
}) {
  const displayedLines = quote?.lines.map((line) => ({ itemId: line.itemId, name: localizedMenuText(line.name, language), quantity: line.quantity, unitPriceCents: line.unitPriceCents, lineTotalCents: line.lineTotalCents })) ??
    Object.entries(cart).map(([itemId, cartLine]) => {
      const item = menuItems.get(itemId)
      const unitPriceCents = selectedUnitPrice(item, cartLine.optionIds)
      return { itemId, name: localizedMenuText(item?.name ?? (language === 'pt-BR' ? 'Item indisponível' : 'Unavailable item'), language), quantity: cartLine.quantity, unitPriceCents, lineTotalCents: unitPriceCents * cartLine.quantity }
    })
  return <section className="checkout-screen" aria-labelledby="review-title">
    <button className="back-link" onClick={onBack} disabled={busy}>{copy.reviewBack}</button>
    <div className="checkout-heading"><span className="eyebrow"><span className="eyebrow-line" /> {copy.reviewStep}</span><h1 id="review-title" tabIndex={-1}>{copy.reviewTitle}</h1><p>{copy.reviewDescription}</p></div>
    {notice && !stockIssue && <div className="notice-banner" role="status">{notice}</div>}
    {stockIssue && <div className="error-banner" role="alert">{copy.stockShort}</div>}
    {error && <div className="error-banner" role="alert"><span>{error}{paymentCooldownSeconds > 0 && <small role="status"> {copy.retryCountdown(paymentCooldownSeconds)}</small>}</span><button className="text-button" onClick={onRefresh}>{copy.retry}</button></div>}
    <div className="review-layout"><div className="review-card"><div className="review-card-head"><h2>{copy.picks}</h2><div className="review-card-actions"><button className="text-button" onClick={onBack} disabled={busy}>{copy.edit}</button><button className="text-button clear-order" onClick={onClear} disabled={busy}>{copy.clear}</button></div></div>
      {displayedLines.map((line) => {
        const item = menuItems.get(line.itemId)
        const available = item?.isAvailable === true && (item.stock === null || item.stock > 0)
        const overStock = !available || (item?.stock !== null && item?.stock !== undefined && line.quantity > item.stock)
        const itemChanged = changedItemIds.includes(line.itemId)
        return <div className={`review-line ${overStock ? 'review-line-warning' : itemChanged ? 'review-line-updated' : ''}`} key={line.itemId}>
          <div className="review-item-summary"><span className="review-quantity">{line.quantity}</span><span className="review-name">{line.name}<small>{formatMoney(line.unitPriceCents, quote?.currency ?? 'USD', language)} {copy.each}</small></span>
            <strong>{formatMoney(line.lineTotalCents, quote?.currency ?? 'USD', language)}</strong></div>
          <div className="review-item-actions">{line.quantity > 1 && <button className="text-button" onClick={() => onQuantity(line.itemId, line.quantity - 1)} aria-label={`${copy.reduce}: ${line.name}`} disabled={busy}>{copy.reduce}</button>}
            <button className="text-button remove-line" onClick={() => onQuantity(line.itemId, 0)} aria-label={copy.removeItem(line.name)} disabled={busy}>{copy.remove}</button>
            {overStock && item && item.stock !== null && item.stock > 0 && <button className="text-button" onClick={() => onQuantity(line.itemId, item.stock!)} disabled={busy}>{copy.reduceTo(item.stock)}</button>}
            {item?.stock !== null && item?.stock !== undefined && <small>{language === 'pt-BR' ? `Disponível: ${item.stock}` : `Available now: ${item.stock}`}</small>}
          </div>
          {overStock && <small className="availability-note" role="alert">{item ? copy.stockShort : copy.missingItem}</small>}
          {!overStock && itemChanged && <small className="availability-note" role="status">{copy.updatedLine}</small>}
        </div>
      })}
      {!quote && !error && !stockIssue && <div className="quote-refresh-row"><p>{busy && <span className="inline-spinner" aria-hidden="true" />}{busy ? copy.refreshingQuote : copy.noQuote}</p>{!busy && <button className="secondary-button" onClick={onRefresh} disabled={Object.keys(cart).length === 0}>{copy.updateTotal}</button>}</div>}
      {quote && <><div className="review-total" aria-live="polite" aria-atomic="true"><span>{copy.totalIncluded}</span><strong>{formatMoney(quote.totalCents, quote.currency, language)}</strong></div>
        <p className="tax-note">{copy.taxIncluded(formatMoney(quote.taxCents, quote.currency, language))}</p></>}
    </div>
    {quote && <aside className="payment-card"><span className="payment-icon" aria-hidden="true">✓</span><h2>{copy.checkoutReady}</h2><p>{copy.reviewDescription}</p>
      {quoteNeedsConsent && <label className="quote-consent"><input type="checkbox" checked={!quoteNeedsConsent} onChange={onAccept} /><span>{copy.acceptUpdated(formatMoney(quote.totalCents, quote.currency, language))}</span></label>}
      <button className="primary-button pay-button" onClick={onContinue} disabled={busy || quoteNeedsConsent || paymentCooldownSeconds > 0}>{copy.continuePayment} <span aria-hidden="true">→</span></button>
    </aside>}
    </div>
  </section>
}

export function ProcessingScreen({ order, busy, recovering, error, language, copy, onCheck, onRetry }: {
  order: OrderStatus | null; busy: boolean; recovering: boolean; error: string | null; language: Language; copy: Copy; onCheck: () => void; onRetry: () => void
}) {
  const pending = order === null || order.status === 'PENDING_PAYMENT'
  const orderMessage = order?.status === 'PAID' ? copy.orderPaidMessage : order?.status === 'PAYMENT_FAILED' ? copy.orderDeclinedMessage : order?.message
  return <section className="status-screen" aria-labelledby="processing-title" aria-live="polite">
    <div className="status-orbit" aria-hidden="true"><span /><i /><b /></div><span className="eyebrow"><span className="eyebrow-line" /> {copy.stepCheckout}</span>
    <h1 id="processing-title" tabIndex={-1}>{pending ? copy.confirming : copy.checking}</h1><p className="status-message">{pending ? copy.pending : orderMessage}</p>
    {pending && <p className="polling-note" role="status">{language === 'pt-BR' ? 'Verificando automaticamente a cada 5 segundos…' : 'Checking automatically every 5 seconds…'}</p>}
    {error && <div className="error-banner status-error" role="status">{error}</div>}
    <div className="status-actions"><button className="primary-button" onClick={onCheck} disabled={busy}>{recovering ? copy.checkingAttempt : copy.checkStatus}</button>
      {error && <button className="secondary-button" onClick={onRetry} disabled={busy}>{copy.retryAttempt}</button>}</div>
    <span className="attempt-note">{copy.sameAttempt}</span>
  </section>
}

export function CompleteScreen({ order, quote, language, copy, onRetry, onNewOrder }: { order: OrderStatus; quote: Quote | null; language: Language; copy: Copy; onRetry: () => void; onNewOrder: () => void }) {
  const [seconds, setSeconds] = useState(30)
  const paid = order.status === 'PAID'
  const orderMessage = paid ? copy.orderPaidMessage : copy.orderDeclinedMessage
  const receiptLines: OrderLine[] = order.lines.length > 0 ? order.lines : quote?.lines ?? []
  const currency = order.currency || quote?.currency || 'USD'
  const receiptQrValue = JSON.stringify({
    receiptVersion: 1,
    reference: order.publicReference.slice(0, 8).toUpperCase(),
    pickupNumber: order.pickupNumber,
    totalCents: order.totalCents,
    currency,
  })
  useEffect(() => {
    if (!paid) return
    const timer = window.setInterval(() => setSeconds((current) => {
      if (current <= 1) { window.clearInterval(timer); onNewOrder(); return 0 }
      return current - 1
    }), 1_000)
    return () => window.clearInterval(timer)
  }, [paid, onNewOrder])
  return <section className={`complete-screen ${paid ? '' : 'declined-screen'}`} aria-labelledby="complete-title">
    <span className="complete-check" aria-hidden="true">{paid ? '✓' : '↻'}</span><span className="eyebrow"><span className="eyebrow-line" /> {paid ? copy.confirmed : copy.declined}</span>
    <h1 id="complete-title" tabIndex={-1}>{paid ? copy.goodChoice : copy.tryAgain}</h1><p>{orderMessage}</p>
    {paid && order.pickupNumber !== null && <div className="pickup-card"><span>{copy.pickup}</span><strong>{order.pickupNumber}</strong><small>{copy.pickupHint}</small></div>}
    {paid && <>
      <p className="reference-note">{copy.reference} <strong>{order.publicReference.slice(0, 8).toUpperCase()}</strong></p>
      {receiptLines.length > 0 && <div className="receipt-card" id="print-receipt"><h2>{copy.receipt}</h2><ul>{receiptLines.map((line) => <li key={line.itemId}><span>{line.quantity} × {localizedMenuText(line.name, language)}</span><strong>{formatMoney(line.lineTotalCents, currency, language)}</strong></li>)}</ul>
        <div className="receipt-row"><span>{copy.tax}</span><strong>{formatMoney(order.taxCents, currency, language)}</strong></div>
        <div className="receipt-row receipt-total"><span>{copy.totalIncluded}</span><strong>{formatMoney(order.totalCents, currency, language)}</strong></div>
        <p className="receipt-demo-disclaimer">{copy.receiptDemo}</p>
        <div className="receipt-qr"><QRCodeSVG value={receiptQrValue} size={132} level="M" includeMargin title={copy.qrReceipt} /><span>{copy.qrReceipt}</span></div></div>}
      <button className="secondary-button print-button" onClick={() => window.print()}>{copy.print}</button>
      <p className="reset-countdown" role="status" aria-live="polite">{copy.resetIn(seconds)}</p>
    </>}
    {paid ? <button className="primary-button new-order-button" onClick={onNewOrder}>{copy.newOrder} <span aria-hidden="true">→</span></button> :
      <div className="decline-actions"><button className="primary-button new-order-button" onClick={onRetry}>{copy.retryPayment}</button><button className="secondary-button" onClick={onNewOrder}>{copy.newOrder}</button></div>}
  </section>
}

export class ErrorBoundary extends Component<{ children: ReactNode; copy: Copy }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() { return { hasError: true } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Avoid sending checkout data to a remote logging service. The browser console is local to this kiosk.
    console.error('Checkout screen rendering failed.', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) return <main className="fatal-error" role="alert"><h1>{this.props.copy.errorFallbackTitle}</h1><p>{this.props.copy.errorFallbackCopy}</p>
      <button className="primary-button" onClick={() => window.location.reload()}>{this.props.copy.reload}</button></main>
    return this.props.children
  }
}

