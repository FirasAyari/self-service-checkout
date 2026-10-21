import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { api, type Menu, type OrderStatus, type Quote } from './api'
import { getEffectivePaymentScenario, isDemoOutcomeSelectionEnabled } from './demo-outcome-selection'

vi.mock('./api', () => ({
  ApiError: class ApiError extends Error {
    status: number
    code?: string
    constructor(message: string, status: number, code?: string) { super(message); this.status = status; this.code = code }
  },
  api: { menu: vi.fn(), quote: vi.fn(), placeOrder: vi.fn(), status: vi.fn() },
}))

const menu: Menu = {
  version: 'menu-v1',
  categories: [{ name: 'Sandwiches', items: [
    { id: 'garden-sandwich', category: 'Sandwiches', name: 'Garden sandwich', description: 'Fresh greens and bread.', priceCents: 500, stock: 20, isAvailable: true, optionGroups: [] },
    { id: 'sold-out-soup', category: 'Sandwiches', name: 'Sold out soup', description: 'Not available today.', priceCents: 700, stock: 0, isAvailable: false, optionGroups: [] },
  ] }],
}

const quote: Quote = {
  quoteId: 'quote-1', expiresAtUtc: '2099-01-01T00:00:00Z',
  lines: [{ itemId: 'garden-sandwich', name: 'Garden sandwich', quantity: 1, unitPriceCents: 500, lineTotalCents: 500, optionIds: [] }],
  totalCents: 500, taxCents: 40, currency: 'USD',
}

const paidOrder: OrderStatus = {
  publicReference: 'PUBLIC-REF-123', status: 'PAID', pickupNumber: 8, updatedAtUtc: '2026-10-20T00:00:00Z', message: 'Order confirmed.',
  lines: quote.lines, totalCents: quote.totalCents, taxCents: quote.taxCents, currency: quote.currency,
}

async function openPaymentScreen() {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Add Garden sandwich' }))
  fireEvent.click(screen.getByRole('button', { name: 'Review order' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Continue to place order' }))
  await screen.findByRole('heading', { name: 'Place your order' })
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  vi.mocked(api.menu).mockResolvedValue(menu)
  vi.mocked(api.quote).mockResolvedValue(quote)
  vi.mocked(api.placeOrder).mockResolvedValue(paidOrder)
  vi.mocked(api.status).mockResolvedValue(paidOrder)
})

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('checkout client acceptance criteria', () => {
  it('AC-D5: outcome selection is limited to development and test builds', () => {
    expect(isDemoOutcomeSelectionEnabled('production')).toBe(false)
    expect(isDemoOutcomeSelectionEnabled('development')).toBe(true)
    expect(isDemoOutcomeSelectionEnabled('test')).toBe(true)
    expect(isDemoOutcomeSelectionEnabled('e2e')).toBe(true)
    expect(getEffectivePaymentScenario('production', 'StillUnknown')).toBe('Approve')
    expect(getEffectivePaymentScenario('development', 'StillUnknown')).toBe('StillUnknown')
  })

  it('AC-D7: places a simulated order without requesting payment details', async () => {
    await openPaymentScreen()
    expect(screen.queryByLabelText(/card number|expiry|security code/i)).toBeNull()
    const submit = screen.getByRole('button', { name: /Place demo order/i }) as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => expect(api.placeOrder).toHaveBeenCalledTimes(1))
    const call = vi.mocked(api.placeOrder).mock.calls[0]
    expect(call.length).toBe(3)
    expect(call[0]).toBe('quote-1')
    expect(call[2]).toBe('Approve')
  })

  it('AC-D7: the simulated checkout renders no payment credential inputs', async () => {
    await openPaymentScreen()
    expect(screen.queryByLabelText(/card number|expiry|security code/i)).toBeNull()
    expect(document.querySelectorAll('input').length).toBe(0)
    expect((screen.getByRole('button', { name: /Place demo order/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('AC-M6 / AC-R6 lets the customer choose options and sends their IDs for server pricing', async () => {
    const optionMenu: Menu = { ...menu, categories: [{ name: 'Drinks', items: [{
      id: 'cold-brew', category: 'Drinks', name: 'Cold brew', description: 'Slow-steeped coffee.', priceCents: 425, stock: 12, isAvailable: true,
      optionGroups: [
        { id: 'size', name: 'Size', isRequired: true, maximumSelections: 1, options: [{ id: 'small', name: 'Small', additionalPriceCents: 0 }, { id: 'large', name: 'Large', additionalPriceCents: 125 }] },
        { id: 'extras', name: 'Add-ons', isRequired: false, maximumSelections: 2, options: [{ id: 'oat-milk', name: 'Oat milk', additionalPriceCents: 50 }, { id: 'extra-shot', name: 'Extra shot', additionalPriceCents: 100 }] },
      ],
    }] }] }
    vi.mocked(api.menu).mockResolvedValue(optionMenu)
    vi.mocked(api.quote).mockResolvedValue({ ...quote, lines: [{ itemId: 'cold-brew', name: 'Cold brew (Large, Oat milk)', quantity: 1, unitPriceCents: 600, lineTotalCents: 600, optionIds: ['large', 'oat-milk'] }], totalCents: 600, taxCents: 44 })
    render(<App />)
    fireEvent.change(await screen.findByRole('combobox', { name: 'Size' }), { target: { value: 'large' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Oat milk/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Cold brew' }))
    expect(screen.getByText('$6.00')).toBeTruthy()
    await waitFor(() => expect(sessionStorage.getItem('goodtable.cart.v1')).toBe('{"cold-brew":{"quantity":1,"optionIds":["large","oat-milk"]}}'))
    fireEvent.click(screen.getByRole('button', { name: 'Review order' }))
    expect(await screen.findByText('Cold brew (Large, Oat milk)')).toBeTruthy()
    expect(api.quote).toHaveBeenCalledWith([{ itemId: 'cold-brew', quantity: 1, optionIds: ['large', 'oat-milk'] }])
  })

  it('AC-M1 / AC-M2 renders available and sold-out catalog items accessibly', async () => {
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Add Garden sandwich' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sandwiches' })).toBeTruthy()
    expect(screen.getByText('$5.00')).toBeTruthy()
    expect(screen.getByText('Sold out')).toBeTruthy()
    const unavailable = screen.getByRole('button', { name: 'Sold out soup, Sold out' }) as HTMLButtonElement
    expect(unavailable.disabled).toBe(true)
    expect(unavailable.closest('.menu-card')?.classList.contains('unavailable')).toBe(true)
  })

  it('AC-M1 shows an accessible loading skeleton before the first menu response', async () => {
    let resolveMenu!: (loadedMenu: Menu) => void
    vi.mocked(api.menu).mockReturnValueOnce(new Promise((resolve) => { resolveMenu = resolve }))
    render(<App />)

    expect(screen.getByRole('status', { name: 'Loading today’s menu…' })).toBeTruthy()
    expect(document.querySelectorAll('.menu-skeleton-card')).toHaveLength(3)
    await act(async () => { resolveMenu(menu) })
    expect(await screen.findByRole('button', { name: 'Add Garden sandwich' })).toBeTruthy()
    expect(screen.queryByRole('status', { name: 'Loading today’s menu…' })).toBeNull()
  })

  it('AC-C3 / AC-C7 disables the add control at the per-line cart limit with an explanation', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add Garden sandwich' }))
    for (let count = 1; count < 10; count += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Add one: Garden sandwich' }))
    }
    const addOne = screen.getByRole('button', { name: 'Add one: Garden sandwich' }) as HTMLButtonElement
    expect(addOne.disabled).toBe(true)
    expect(screen.getByText('Up to 10 of each item.')).toBeTruthy()
  })

  it('AC-C7 explains the distinct-line, total-unit, and $150 cart caps before an add', async () => {
    const makeItems = (count: number, priceCents = 100): Menu => ({ version: 'limits', categories: [{ name: 'Limits', items: Array.from({ length: count }, (_, index) => ({
      id: `limit-${index}`, category: 'Limits', name: `Limit item ${index}`, description: 'Cart limit test item.', priceCents,
      stock: null, isAvailable: true, optionGroups: [],
    })) }] })

    vi.mocked(api.menu).mockResolvedValueOnce(makeItems(16))
    const lines = render(<App />)
    for (let index = 0; index < 15; index += 1) fireEvent.click(await screen.findByRole('button', { name: `Add Limit item ${index}` }))
    expect((screen.getByRole('button', { name: 'Add Limit item 15' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Choose up to 15 different items.')).toBeTruthy()
    lines.unmount()
    sessionStorage.clear()

    vi.mocked(api.menu).mockResolvedValueOnce(makeItems(4))
    render(<App />)
    for (const index of [0, 1, 2]) {
      fireEvent.click(await screen.findByRole('button', { name: `Add Limit item ${index}` }))
      for (let quantity = 1; quantity < 10; quantity += 1) fireEvent.click(screen.getByRole('button', { name: `Add one: Limit item ${index}` }))
    }
    expect((screen.getByRole('button', { name: 'Add Limit item 3' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('An order can contain up to 30 items.')).toBeTruthy()
    cleanup()
    sessionStorage.clear()

    vi.mocked(api.menu).mockResolvedValueOnce({ ...makeItems(2), categories: [{ name: 'Limits', items: [
      { ...makeItems(1, 10_000).categories[0].items[0], id: 'limit-0', name: 'Limit item 0' },
      { ...makeItems(1, 6_000).categories[0].items[0], id: 'limit-1', name: 'Limit item 1' },
    ] }] })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add Limit item 0' }))
    expect((screen.getByRole('button', { name: 'Add Limit item 1' }) as HTMLButtonElement).disabled).toBe(true)
    const totalLimitButton = screen.getByRole('button', { name: 'Add Limit item 1' })
    const totalLimitDescriptionId = totalLimitButton.getAttribute('aria-describedby')
    expect(totalLimitDescriptionId).toBeTruthy()
    expect(document.getElementById(totalLimitDescriptionId!)?.textContent).toBe('The order limit is $150.00.')
  })

  it('AC-M5 refreshes the menu while browsing and requires consent for a changed cart price', async () => {
    vi.useFakeTimers()
    const changedMenu: Menu = { ...menu, version: 'menu-v2', categories: [{ ...menu.categories[0], items: menu.categories[0].items.map((item) =>
      item.id === 'garden-sandwich' ? { ...item, priceCents: 900 } : item) }] }
    vi.mocked(api.menu).mockResolvedValueOnce(menu).mockResolvedValueOnce(changedMenu).mockResolvedValueOnce(changedMenu)
    vi.mocked(api.quote).mockResolvedValue({ ...quote, lines: [{ ...quote.lines[0], unitPriceCents: 900, lineTotalCents: 900 }], totalCents: 900 })
    render(<App />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByRole('button', { name: 'Add Garden sandwich' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add Garden sandwich' }))

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(api.menu).toHaveBeenCalledTimes(2)
    expect(screen.getByText('$9.00')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Review order' }))
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })
    expect(screen.getByRole('checkbox', { name: 'I accept the updated total of $9.00' })).toBeTruthy()
    expect(screen.getByText('Price or availability was updated.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Continue to place order' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('AC-C4 removes the final unit and lets the customer undo within five seconds', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add Garden sandwich' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove one: Garden sandwich' }))
    expect(await screen.findByText(/Garden sandwich was removed/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByRole('button', { name: 'Remove one: Garden sandwich' })).toBeTruthy()
  })

  it('AC-C6 restores only item IDs and quantities from session storage', async () => {
    const first = render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add Garden sandwich' }))
    await waitFor(() => expect(sessionStorage.getItem('goodtable.cart.v1')).toBe('{"garden-sandwich":{"quantity":1,"optionIds":[]}}'))
    first.unmount()
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Remove one: Garden sandwich' })).toBeTruthy()
    expect(sessionStorage.getItem('goodtable.cart.v1')).toBe('{"garden-sandwich":{"quantity":1,"optionIds":[]}}')
  })

  it('AC-Y3 / AC-C6 writes the attempt without card fields and clears it after a terminal result', async () => {
    vi.mocked(api.placeOrder).mockImplementation(async (quoteId, idempotencyKey, scenario) => {
      expect(quoteId).toBe('quote-1')
      expect(JSON.parse(sessionStorage.getItem('goodtable.attempt.v1') ?? 'null')).toEqual({ idempotencyKey, quoteId, scenario })
      return paidOrder
    })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add Garden sandwich' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review order' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to place order' }))
    fireEvent.click(await screen.findByRole('button', { name: /Place demo order/i }))
    expect(await screen.findByRole('heading', { name: 'That’s a good choice.' })).toBeTruthy()
    expect(sessionStorage.getItem('goodtable.attempt.v1')).toBeNull()
  })

  it('AC-Y3 locks payment synchronously so a double tap submits exactly one order', async () => {
    let resolvePayment!: (order: OrderStatus) => void
    vi.mocked(api.placeOrder).mockReturnValueOnce(new Promise((resolve) => { resolvePayment = resolve }))
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add Garden sandwich' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review order' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to place order' }))
    const submit = await screen.findByRole('button', { name: /Place demo order/i })

    act(() => { fireEvent.click(submit); fireEvent.click(submit) })
    expect(api.placeOrder).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('heading', { name: 'Confirming your order.' })).toBeTruthy()
    await act(async () => { resolvePayment(paidOrder) })
    expect(await screen.findByRole('heading', { name: 'That’s a good choice.' })).toBeTruthy()
  })

  it('AC-C6 / AC-Y6 resumes the saved attempt by status lookup after remount', async () => {
    sessionStorage.setItem('goodtable.cart.v1', '{"garden-sandwich":1}')
    sessionStorage.setItem('goodtable.attempt.v1', JSON.stringify({ idempotencyKey: 'a'.repeat(32), quoteId: 'quote-recovery', scenario: 'Approve' }))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'That’s a good choice.' })).toBeTruthy()
    expect(api.status).toHaveBeenCalledWith('a'.repeat(32))
    await waitFor(() => {
      expect(sessionStorage.getItem('goodtable.attempt.v1')).toBeNull()
      expect(sessionStorage.getItem('goodtable.cart.v1')).toBeNull()
    })
  })

  it('BR-S4 shows low stock at five units and hides the badge at six', async () => {
    const stockFive: Menu = { ...menu, categories: [{ ...menu.categories[0], items: menu.categories[0].items.map((item) => item.id === 'garden-sandwich' ? { ...item, stock: 5 } : item) }] }
    const stockSix: Menu = { ...menu, categories: [{ ...menu.categories[0], items: menu.categories[0].items.map((item) => item.id === 'garden-sandwich' ? { ...item, stock: 6 } : item) }] }
    vi.mocked(api.menu).mockResolvedValueOnce(stockFive)
    const first = render(<App />)
    expect(await screen.findByText('Only 5 left')).toBeTruthy()
    first.unmount()
    vi.mocked(api.menu).mockResolvedValueOnce(stockSix)
    render(<App />)
    await screen.findByRole('button', { name: 'Add Garden sandwich' })
    expect(screen.queryByText('Only 6 left')).toBeNull()
  })

  it('AC-R3 requires explicit consent when a refreshed server quote changes the item price', async () => {
    const raisedPrice: Menu = { ...menu, version: 'menu-v2', categories: [{ ...menu.categories[0], items: menu.categories[0].items.map((item) => item.id === 'garden-sandwich' ? { ...item, priceCents: 900 } : item) }] }
    vi.mocked(api.menu).mockResolvedValueOnce(menu).mockResolvedValueOnce(raisedPrice)
    vi.mocked(api.quote).mockResolvedValue({ ...quote, lines: [{ ...quote.lines[0], unitPriceCents: 900, lineTotalCents: 900 }], totalCents: 900 })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add Garden sandwich' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review order' }))
    const consent = await screen.findByRole('checkbox', { name: 'I accept the updated total of $9.00' })
    expect((screen.getByRole('button', { name: 'Continue to place order' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(consent)
    expect((screen.getByRole('button', { name: 'Continue to place order' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Continue to place order' }))
    expect(await screen.findByRole('heading', { name: 'Place your order' })).toBeTruthy()
  })

  it('AC-Y4 / AC-O5 shows the server order summary and pickup number after approval', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add Garden sandwich' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review order' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to place order' }))
    fireEvent.click(await screen.findByRole('button', { name: /Place demo order/i }))
    expect(await screen.findByRole('heading', { name: 'That’s a good choice.' })).toBeTruthy()
    expect(screen.getByText('8')).toBeTruthy()
    expect(screen.getAllByText('$5.00').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/Garden sandwich/)).toBeTruthy()
    expect(screen.getByTitle('Scan for pickup reference and total')).toBeTruthy()
  })
})
