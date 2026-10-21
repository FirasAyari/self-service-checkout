import type { Quote, Scenario } from '../api'
import type { Copy, Language } from '../copy'
import { localizedMenuText } from './presentation'

type PaymentScreenProps = {
  quote: Quote
  scenario: Scenario
  language: Language
  copy: Copy
  paymentCooldownSeconds: number
  allowOutcomeSelection: boolean
  formatMoney: (cents: number, currency: string, language: Language) => string
  onBack: () => void
  onScenario: (scenario: Scenario) => void
  onSubmit: () => void
}

export function PaymentScreen({
  quote,
  scenario,
  language,
  copy,
  paymentCooldownSeconds,
  allowOutcomeSelection,
  formatMoney,
  onBack,
  onScenario,
  onSubmit,
}: PaymentScreenProps) {
  const scenarioLabels: { value: Scenario; label: string }[] = [
    { value: 'Approve', label: copy.approve },
    { value: 'Decline', label: copy.decline },
    { value: 'UnknownAfterApproval', label: copy.slowApproval },
    { value: 'StillUnknown', label: copy.keepConfirming },
  ]

  return (
    <section className="checkout-screen" aria-labelledby="payment-title">
      <button className="back-link" onClick={onBack}>
        <span aria-hidden="true">&#8592; </span>{copy.backToReview}
      </button>
      <div className="checkout-heading">
        <span className="eyebrow"><span className="eyebrow-line" /> {copy.stepCheckout}</span>
        <h1 id="payment-title" tabIndex={-1}>{copy.paymentTitle}</h1>
        <p>{copy.demoCopy}</p>
      </div>
      <div className="review-layout">
        <div className="review-card">
          <div className="review-card-head"><h2>{copy.picks}</h2></div>
          <ul className="payment-summary">
            {quote.lines.map((line) => (
              <li key={line.itemId}>
                <span>{line.quantity} &#215; {localizedMenuText(line.name, language)}</span>
                <strong>{formatMoney(line.lineTotalCents, quote.currency, language)}</strong>
              </li>
            ))}
          </ul>
          <div className="review-total" aria-live="polite" aria-atomic="true">
            <span>{copy.totalIncluded}</span>
            <strong>{formatMoney(quote.totalCents, quote.currency, language)}</strong>
          </div>
          <p className="tax-note">{copy.taxIncluded(formatMoney(quote.taxCents, quote.currency, language))}</p>
        </div>
        <aside className="payment-card">
          <span className="payment-icon" aria-hidden="true">&#10003;</span>
          <h2>{copy.checkoutReady}</h2>
          {allowOutcomeSelection && <>
            <label className="field-label" htmlFor="payment-scenario">{copy.demoOutcome}</label>
            <select id="payment-scenario" value={scenario} onChange={(event) => onScenario(event.target.value as Scenario)}>
              {scenarioLabels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </>}
          <button className="primary-button pay-button" onClick={onSubmit} disabled={paymentCooldownSeconds > 0}>
            {paymentCooldownSeconds > 0
              ? copy.retryCountdown(paymentCooldownSeconds)
              : <>{copy.placeOrder} &#183; {formatMoney(quote.totalCents, quote.currency, language)} <span aria-hidden="true">&#8594;</span></>}
          </button>
          <div className="demo-notice"><span aria-hidden="true" className="demo-mark" />{copy.demoNotice}</div>
        </aside>
      </div>
    </section>
  )
}
