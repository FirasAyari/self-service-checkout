import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError } from './api'
import { demoAdminApi, type DemoCatalogItem, type DemoChaosState } from './demoAdminApi'
import type { DemoChaosMode, MockPaymentScenario } from './api.generated'

type ItemDraft = { price: string; stock: string; unlimited: boolean; active: boolean }
type CatalogInputError = { field: 'price' | 'stock'; message: string }
type ChaosScenario = MockPaymentScenario | 'client-selected'
type ChaosMode = Exclude<DemoChaosMode, null> | 'normal'

const emptyChaos: DemoChaosState = { scenarioOverride: null, mode: null, latencyMilliseconds: 0 }

function moneyInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

export function parseMoneyToCents(value: string): number | null {
  const match = /^(\d{1,11})(?:\.(\d{1,2}))?$/.exec(value)
  if (!match) return null
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
  if (cents <= 0n || cents > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return Number(cents)
}

function toDrafts(items: DemoCatalogItem[]): Record<string, ItemDraft> {
  return Object.fromEntries(items.map((item) => [item.id, {
    price: moneyInput(item.priceCents),
    stock: item.stock?.toString() ?? '',
    unlimited: item.stock === null,
    active: item.isActive,
  }]))
}

function failureMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) {
    return 'Admin controls were not found. Check that the API is running in Development with DemoMode:Enabled=true and the matching token.'
  }
  if (error instanceof ApiError && error.status === 0) return 'The API could not be reached. Check that the Development API is running.'
  return error instanceof Error ? error.message : 'The request could not be completed.'
}

export function DemoAdminApp() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const tokenInputRef = useRef<HTMLInputElement>(null)
  const tokenRef = useRef('')
  const resetDialogRef = useRef<HTMLDialogElement>(null)
  const [connected, setConnected] = useState(false)
  const [items, setItems] = useState<DemoCatalogItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({})
  const [catalogErrors, setCatalogErrors] = useState<Record<string, CatalogInputError | undefined>>({})
  const [chaos, setChaos] = useState<DemoChaosState>(emptyChaos)
  const [scenario, setScenario] = useState<ChaosScenario>('client-selected')
  const [mode, setMode] = useState<ChaosMode>('normal')
  const [latency, setLatency] = useState(3000)
  const [busy, setBusy] = useState(false)
  const [savingItem, setSavingItem] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [resetOpen, setResetOpen] = useState(false)

  useEffect(() => { headingRef.current?.focus() }, [])
  useEffect(() => {
    const dialog = resetDialogRef.current
    if (!dialog) return
    if (resetOpen && !dialog.open) dialog.showModal()
    if (!resetOpen && dialog.open) dialog.close()
  }, [resetOpen])

  const sortedItems = items

  async function loadData(token: string) {
    const [nextItems, nextChaos] = await Promise.all([demoAdminApi.items(token), demoAdminApi.chaos(token)])
    setItems(nextItems)
    setDrafts(toDrafts(nextItems))
    setChaos(nextChaos)
    setScenario(nextChaos.scenarioOverride ?? 'client-selected')
    setMode(nextChaos.mode ?? 'normal')
    setLatency(nextChaos.mode === 'Latency' ? nextChaos.latencyMilliseconds : 3000)
  }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    const supplied = tokenInputRef.current?.value ?? ''
    if (supplied.length < 32) {
      setError('Enter the Development admin token (at least 32 characters).')
      if (tokenInputRef.current) tokenInputRef.current.value = ''
      tokenInputRef.current?.focus()
      return
    }
    tokenRef.current = supplied
    if (tokenInputRef.current) tokenInputRef.current.value = ''
    setBusy(true)
    try {
      await loadData(supplied)
      setConnected(true)
      setMessage('Connected to the Development demo controls.')
    } catch (requestError) {
      tokenRef.current = ''
      setError(failureMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  function disconnect() {
    tokenRef.current = ''
    setConnected(false)
    setItems([])
    setDrafts({})
    setChaos(emptyChaos)
    setMessage('Disconnected. The token was cleared from this page.')
    setError('')
  }

  async function refresh() {
    setBusy(true)
    setError('')
    try {
      await loadData(tokenRef.current)
      setMessage('Demo data refreshed.')
    } catch (requestError) {
      setError(failureMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  function updateDraft(itemId: string, change: Partial<ItemDraft>) {
    setDrafts((current) => ({ ...current, [itemId]: { ...current[itemId], ...change } }))
    const changedField = 'price' in change ? 'price' : 'stock' in change || 'unlimited' in change ? 'stock' : null
    if (changedField) {
      setCatalogErrors((current) => {
        if (current[itemId]?.field !== changedField) return current
        const next = { ...current }
        delete next[itemId]
        return next
      })
      setError('')
    }
  }

  async function saveItem(event: FormEvent<HTMLFormElement>, item: DemoCatalogItem) {
    event.preventDefault()
    const draft = drafts[item.id]
    const priceCents = parseMoneyToCents(draft.price)
    if (priceCents === null) {
      const validation = { field: 'price' as const, message: 'Enter a price greater than zero with up to two decimal places.' }
      setCatalogErrors((current) => ({ ...current, [item.id]: validation }))
      setError(`${item.name}: ${validation.message}`)
      return
    }
    let stock: number | null = null
    if (!draft.unlimited) {
      if (!/^\d{1,9}$/.test(draft.stock) || !Number.isSafeInteger(Number(draft.stock))) {
        const validation = { field: 'stock' as const, message: 'Enter a whole stock quantity from 0 to 999,999,999, or choose unlimited.' }
        setCatalogErrors((current) => ({ ...current, [item.id]: validation }))
        setError(`${item.name}: ${validation.message}`)
        return
      }
      stock = Number(draft.stock)
    }
    setSavingItem(item.id)
    setCatalogErrors((current) => {
      if (!current[item.id]) return current
      const next = { ...current }
      delete next[item.id]
      return next
    })
    setError('')
    setMessage('')
    try {
      await demoAdminApi.updateItem(tokenRef.current, item.id, {
        priceCents,
        stock,
        isActive: draft.active,
        clearStock: draft.unlimited,
      })
      await loadData(tokenRef.current)
      setMessage(`${item.name} saved.`)
    } catch (requestError) {
      setError(failureMessage(requestError))
    } finally {
      setSavingItem(null)
    }
  }

  async function saveChaos(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const next = await demoAdminApi.updateChaos(tokenRef.current, {
        scenarioOverride: scenario === 'client-selected' ? null : scenario,
        mode: mode === 'normal' ? null : mode,
        latencyMilliseconds: mode === 'Latency' ? latency : 0,
      })
      setChaos(next)
      setMessage('Mock payment behavior saved for this API process.')
    } catch (requestError) {
      setError(failureMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  async function resetDemo() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await demoAdminApi.reset(tokenRef.current)
      await loadData(tokenRef.current)
      setResetOpen(false)
      setMessage('Demo data was reset to the seeded catalog. Orders, quotes, attempts, ledger records, and lockouts were cleared.')
    } catch (requestError) {
      setError(failureMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  return <div className="app-shell demo-admin-shell">
    <a className="skip-link" href="#main-content">Skip to admin controls</a>
    <header className="topbar demo-admin-topbar">
      <a className="brand" href="/" aria-label="Good Table checkout"><img className="brand-mark" src="/goodtable-mark.png" alt="" /><span className="brand-wordmark">good table</span></a>
      <div className="demo-admin-nav"><span className="demo-only-badge"><span aria-hidden="true" />Development only</span><a className="text-button" href="/">Checkout</a></div>
    </header>
    <main className="demo-admin-main" id="main-content">
      <section className="demo-admin-heading" aria-labelledby="admin-title">
        <p className="eyebrow"><span className="eyebrow-line" /> Demo operations</p>
        <h1 id="admin-title" ref={headingRef} tabIndex={-1}>Admin controls</h1>
        <p>Manage the local demo catalog and test recovery scenarios. These controls change this Development API only.</p>
      </section>

      <section className="admin-panel admin-access-panel" aria-labelledby="access-title">
        <div className="admin-panel-heading"><div><p className="admin-kicker">Protected access</p><h2 id="access-title">{connected ? 'Development API connected' : 'Connect to demo controls'}</h2></div><span className={`admin-connection ${connected ? 'is-connected' : ''}`}><span aria-hidden="true" />{connected ? 'Connected' : 'Not connected'}</span></div>
        {!connected ? <form className="admin-connect-form" onSubmit={(event) => void connect(event)}>
          <label htmlFor="admin-token">Development admin token</label>
          <p className="admin-field-hint" id="admin-token-hint">The token stays in page memory and is sent only in the X-Admin-Token request header. It is not saved in browser storage.</p>
          <div className="admin-connect-row"><input id="admin-token" ref={tokenInputRef} type="password" autoComplete="new-password" spellCheck={false} aria-invalid={Boolean(error)} aria-describedby={`admin-token-hint${error ? ' admin-token-error' : ''}`} placeholder="Paste the 32+ character token" /><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button></div>
        </form> : <div className="admin-connected-row"><p>Token is held in memory for this page only.</p><button className="secondary-button" type="button" onClick={disconnect}>Disconnect</button></div>}
      </section>

      {error && <p id={!connected ? 'admin-token-error' : undefined} className="admin-feedback admin-error" role="alert">{error}</p>}
      {message && <p className="admin-feedback admin-success" role="status" aria-live="polite">{message}</p>}

      {!connected ? <aside className="admin-setup-note"><strong>Demo administration is disabled by default.</strong><span>Start the API in Development with DemoMode:Enabled=true and a token of at least 32 characters. The repository guide is docs/demo-mode.md.</span></aside> : <>
        <section className="admin-panel" aria-labelledby="catalog-title">
          <div className="admin-panel-heading"><div><p className="admin-kicker">Catalog</p><h2 id="catalog-title">Items <span className="admin-count">{items.length}</span></h2><p className="admin-section-copy">Edit prices, stock, and whether an item appears on the customer menu.</p></div><button className="secondary-button" type="button" onClick={() => void refresh()} disabled={busy}>Refresh</button></div>
          {sortedItems.length === 0 ? <p className="admin-empty">No catalog items were returned.</p> : <div className="admin-catalog-list">{sortedItems.map((item) => {
            const draft = drafts[item.id]
            const prefix = `item-${item.id}`
            const inputError = catalogErrors[item.id]
            return <article className="admin-item" key={item.id}>
              <div className="admin-item-title"><div><h3>{item.name}</h3><p>{item.category} <span aria-hidden="true">·</span> <code>{item.id}</code></p></div><span className={`admin-item-status ${draft.active ? 'is-active' : ''}`}>{draft.active ? 'On menu' : 'Hidden'}</span></div>
              <p className="admin-item-description">{item.description}</p>
              <form className="admin-item-form" onSubmit={(event) => void saveItem(event, item)}>
              <div className="admin-item-fields">
                  <div className="admin-field"><label htmlFor={`${prefix}-price`}>Price (USD)</label><div className="admin-input-prefix"><span aria-hidden="true">$</span><input id={`${prefix}-price`} type="text" inputMode="decimal" value={draft?.price ?? moneyInput(item.priceCents)} onChange={(event) => updateDraft(item.id, { price: event.target.value })} aria-invalid={inputError?.field === 'price'} aria-describedby={`${prefix}-price-hint${inputError?.field === 'price' ? ` ${prefix}-price-error` : ''}`} autoComplete="off" /></div><small id={`${prefix}-price-hint`}>Use dollars and cents, for example 8.95.</small>{inputError?.field === 'price' && <small id={`${prefix}-price-error`} className="admin-inline-error">{inputError.message}</small>}</div>
                  <div className="admin-field"><label htmlFor={`${prefix}-stock`}>Stock quantity</label><input id={`${prefix}-stock`} type="number" min="0" max="999999999" step="1" value={draft?.stock ?? ''} onChange={(event) => updateDraft(item.id, { stock: event.target.value })} disabled={draft?.unlimited ?? item.stock === null} aria-invalid={inputError?.field === 'stock'} aria-describedby={`${prefix}-stock-hint${inputError?.field === 'stock' ? ` ${prefix}-stock-error` : ''}`} /><small id={`${prefix}-stock-hint`}>{(draft?.unlimited ?? item.stock === null) ? 'Unlimited stock' : 'Whole number from zero up.'}</small>{inputError?.field === 'stock' && <small id={`${prefix}-stock-error`} className="admin-inline-error">{inputError.message}</small>}</div>
                </div>
                <div className="admin-item-options"><label className="admin-check"><input type="checkbox" checked={draft?.unlimited ?? item.stock === null} onChange={(event) => updateDraft(item.id, { unlimited: event.target.checked })} /><span>Unlimited stock</span></label><label className="admin-check"><input type="checkbox" checked={draft?.active ?? item.isActive} onChange={(event) => updateDraft(item.id, { active: event.target.checked })} /><span>Available on customer menu</span></label><button className="primary-button admin-save-button" type="submit" disabled={busy || savingItem === item.id}>{savingItem === item.id ? 'Saving…' : 'Save item'}</button></div>
              </form>
            </article>
          })}</div>}
        </section>

        <section className="admin-panel" aria-labelledby="chaos-title">
          <div className="admin-panel-heading"><div><p className="admin-kicker">Testing</p><h2 id="chaos-title">Mock payment behavior</h2><p className="admin-section-copy">These overrides affect new checkout attempts on this API process.</p></div></div>
          <form className="admin-chaos-form" onSubmit={(event) => void saveChaos(event)}>
            <div className="admin-chaos-fields">
              <div className="admin-field"><label htmlFor="chaos-scenario">Payment outcome</label><select id="chaos-scenario" value={scenario} onChange={(event) => setScenario(event.target.value as ChaosScenario)}><option value="client-selected">Use customer selection</option><option value="Approve">Approve</option><option value="Decline">Decline</option><option value="UnknownAfterApproval">Unknown after approval</option><option value="StillUnknown">Remain pending (no result)</option></select><small>Still pending keeps its stock reservation until reset or an authoritative outcome.</small></div>
              <div className="admin-field"><label htmlFor="chaos-mode">Network / recovery behavior</label><select id="chaos-mode" value={mode} onChange={(event) => setMode(event.target.value as ChaosMode)}><option value="normal">Normal</option><option value="Latency">Add latency</option><option value="DropResponse">Drop response after outcome</option><option value="CrashAfterReservation">Fail after reservation (pending)</option></select><small>Use these controls only with local demo orders; dropped responses may follow a recorded approval.</small></div>
              <div className="admin-field"><label htmlFor="chaos-latency">Added latency (ms)</label><input id="chaos-latency" type="number" min="0" max="7000" step="100" value={latency} onChange={(event) => setLatency(Number(event.target.value))} disabled={mode !== 'Latency'} /><small>Allowed range: 0–7000 ms.</small></div>
            </div>
            <div className="admin-chaos-actions"><p className="admin-current-state"><strong>Current:</strong> {chaos.scenarioOverride ?? 'customer selected'} · {chaos.mode ?? 'normal'}{chaos.mode === 'Latency' ? ` · ${chaos.latencyMilliseconds} ms` : ''}</p><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save behavior'}</button></div>
          </form>
        </section>

        <section className="admin-panel admin-reset-panel" aria-labelledby="reset-title">
          <div><p className="admin-kicker">Destructive action</p><h2 id="reset-title">Reset the local demo</h2><p className="admin-section-copy">Restore seeded products and stock, and clear demo orders, quotes, payment attempts, ledger records, lockouts, and active chaos settings.</p></div>
          <button className="danger-button" type="button" onClick={() => setResetOpen(true)} disabled={busy}>Review reset</button>
        </section>
      </>}
    </main>

    <dialog ref={resetDialogRef} className="admin-reset-dialog" aria-labelledby="reset-dialog-title" onClose={() => setResetOpen(false)}>
      <p className="admin-kicker">Confirm reset</p><h2 id="reset-dialog-title">Clear demo checkout data?</h2>
      <p>This permanently removes orders, quotes, payment attempts and ledger entries from the local demo database. It restores the seeded catalog and clears chaos settings. It cannot be undone.</p>
      <div className="admin-dialog-actions"><button className="secondary-button" type="button" onClick={() => setResetOpen(false)} disabled={busy}>Cancel</button><button className="danger-button" type="button" onClick={() => void resetDemo()} disabled={busy}>{busy ? 'Resetting…' : 'Reset demo data'}</button></div>
    </dialog>
  </div>
}
