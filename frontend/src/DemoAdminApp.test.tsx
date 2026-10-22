import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApiError } from './api'
import { demoAdminApi, type DemoCatalogItem, type DemoChaosState } from './demoAdminApi'
import { DemoAdminApp, parseMoneyToCents } from './DemoAdminApp'

const adminToken = 'local-development-admin-token-with-32-chars'
const seedItem: DemoCatalogItem = {
  id: 'garden-bowl',
  category: 'Bowls',
  name: 'Garden grain bowl',
  description: 'A fresh bowl with seasonal greens.',
  priceCents: 1095,
  stock: 10,
  isActive: false,
  sortOrder: 1,
}
const defaultChaos: DemoChaosState = { scenarioOverride: null, mode: null, latencyMilliseconds: 0 }
const dialogPrototype = HTMLDialogElement.prototype
const originalShowModal = Object.getOwnPropertyDescriptor(dialogPrototype, 'showModal')
const originalClose = Object.getOwnPropertyDescriptor(dialogPrototype, 'close')

beforeAll(() => {
  Object.defineProperty(dialogPrototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute('open', '') },
  })
  Object.defineProperty(dialogPrototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    },
  })
})

afterAll(() => {
  if (originalShowModal) Object.defineProperty(dialogPrototype, 'showModal', originalShowModal)
  else Reflect.deleteProperty(dialogPrototype, 'showModal')
  if (originalClose) Object.defineProperty(dialogPrototype, 'close', originalClose)
  else Reflect.deleteProperty(dialogPrototype, 'close')
})

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => cleanup())

function mockAdminApi() {
  let catalog = [{ ...seedItem }]
  let currentChaos = { ...defaultChaos }

  vi.spyOn(demoAdminApi, 'items').mockImplementation(async () => catalog.map((item) => ({ ...item })))
  vi.spyOn(demoAdminApi, 'chaos').mockImplementation(async () => ({ ...currentChaos }))
  vi.spyOn(demoAdminApi, 'updateItem').mockImplementation(async (_token, itemId, patch) => {
    catalog = catalog.map((item) => item.id === itemId ? {
      ...item,
      priceCents: patch.priceCents ?? item.priceCents,
      stock: patch.clearStock ? null : patch.stock ?? item.stock,
      isActive: patch.isActive ?? item.isActive,
    } : item)
    return null
  })
  vi.spyOn(demoAdminApi, 'updateChaos').mockImplementation(async (_token, configuration) => {
    currentChaos = {
      scenarioOverride: configuration.scenarioOverride,
      mode: configuration.mode ?? null,
      latencyMilliseconds: configuration.mode === 'Latency' ? configuration.latencyMilliseconds ?? 0 : 0,
    }
    return { ...currentChaos }
  })
  vi.spyOn(demoAdminApi, 'reset').mockImplementation(async () => {
    catalog = [{ ...seedItem }]
    currentChaos = { ...defaultChaos }
    return null
  })
}

async function connectAdmin() {
  const input = screen.getByLabelText('Development admin token') as HTMLInputElement
  fireEvent.change(input, { target: { value: adminToken } })
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
  await screen.findByRole('heading', { name: /Items 1/ })
  return input
}

describe('Development demo admin', () => {
  it('AC-D8 shows a disabled loading action until the protected data is ready', async () => {
    mockAdminApi()
    let completeCatalog: (catalog: DemoCatalogItem[]) => void = () => { throw new Error('Catalog was not requested.') }
    vi.spyOn(demoAdminApi, 'items').mockImplementation(() => new Promise((resolve) => { completeCatalog = resolve }))
    render(<DemoAdminApp />)

    fireEvent.change(screen.getByLabelText('Development admin token'), { target: { value: adminToken } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    const loadingButton = screen.getByRole('button', { name: 'Connecting…' }) as HTMLButtonElement
    expect(loadingButton.disabled).toBe(true)
    expect(screen.queryByRole('heading', { name: /Items/ })).toBeNull()

    await act(async () => { completeCatalog([{ ...seedItem }]) })
    await screen.findByRole('heading', { name: /Items 1/ })
  })

  it('AC-D8 gives a safe recovery message when the token is rejected', async () => {
    mockAdminApi()
    vi.spyOn(demoAdminApi, 'items').mockRejectedValue(new ApiError('Not found', 404))
    render(<DemoAdminApp />)

    const tokenInput = screen.getByLabelText('Development admin token') as HTMLInputElement
    fireEvent.change(tokenInput, { target: { value: adminToken } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Check that the API is running in Development')
    expect(tokenInput.value).toBe('')
    expect(screen.queryByRole('heading', { name: /Items/ })).toBeNull()
  })

  it('AC-D8 explains when the connected catalog is empty', async () => {
    mockAdminApi()
    vi.spyOn(demoAdminApi, 'items').mockResolvedValue([])
    render(<DemoAdminApp />)

    const tokenInput = screen.getByLabelText('Development admin token') as HTMLInputElement
    fireEvent.change(tokenInput, { target: { value: adminToken } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    await screen.findByText('No catalog items were returned.')
    expect(screen.getByRole('heading', { name: /Items 0/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy()
  })

  it('AC-D8 keeps the token out of browser storage and can disconnect', async () => {
    mockAdminApi()
    render(<DemoAdminApp />)

    const tokenInput = await connectAdmin()

    expect(demoAdminApi.items).toHaveBeenCalledWith(adminToken)
    expect(tokenInput.value).toBe('')
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(screen.getByRole('heading', { name: 'Connect to demo controls' })).toBeTruthy()
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('AC-D8 shows inactive items, saves integer-cent catalog edits, and updates mock behavior', async () => {
    mockAdminApi()
    render(<DemoAdminApp />)
    await connectAdmin()

    expect(screen.getByText('Hidden')).toBeTruthy()
    const priceInput = screen.getByLabelText('Price (USD)') as HTMLInputElement
    fireEvent.change(priceInput, { target: { value: '8.999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save item' }))
    expect(priceInput.getAttribute('aria-invalid')).toBe('true')
    expect(priceInput.getAttribute('aria-describedby')).toContain('item-garden-bowl-price-error')
    expect(screen.getByText('Enter a price greater than zero with up to two decimal places.')).toBeTruthy()

    fireEvent.change(priceInput, { target: { value: '8.95' } })
    fireEvent.change(screen.getByLabelText('Stock quantity'), { target: { value: '0' } })
    fireEvent.click(screen.getByLabelText('Available on customer menu'))
    fireEvent.click(screen.getByRole('button', { name: 'Save item' }))
    await screen.findByText('Garden grain bowl saved.')

    expect(demoAdminApi.updateItem).toHaveBeenCalledWith(adminToken, 'garden-bowl', {
      priceCents: 895,
      stock: 0,
      isActive: true,
      clearStock: false,
    })
    expect(demoAdminApi.items).toHaveBeenCalledTimes(2)
    expect(screen.getByText('On menu')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Payment outcome'), { target: { value: 'StillUnknown' } })
    fireEvent.change(screen.getByLabelText('Network / recovery behavior'), { target: { value: 'CrashAfterReservation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save behavior' }))
    await screen.findByText(/StillUnknown · CrashAfterReservation/)
    expect(demoAdminApi.updateChaos).toHaveBeenCalledWith(adminToken, {
      scenarioOverride: 'StillUnknown',
      mode: 'CrashAfterReservation',
      latencyMilliseconds: 0,
    })
  })

  it('AC-D8 requires confirmation before clearing local demo records', async () => {
    mockAdminApi()
    render(<DemoAdminApp />)
    await connectAdmin()

    fireEvent.click(screen.getByRole('button', { name: 'Review reset' }))
    expect(screen.getByRole('heading', { name: 'Clear demo checkout data?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(demoAdminApi.reset).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Review reset' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset demo data' }))
    await waitFor(() => expect(demoAdminApi.reset).toHaveBeenCalledWith(adminToken))
    await screen.findByText(/Demo data was reset to the seeded catalog/)
  })

  it('AC-D8 parses prices without floating-point rounding', () => {
    expect(parseMoneyToCents('10.05')).toBe(1005)
    expect(parseMoneyToCents('8')).toBe(800)
    expect(parseMoneyToCents('0.00')).toBeNull()
    expect(parseMoneyToCents('8.999')).toBeNull()
    expect(parseMoneyToCents('not a price')).toBeNull()
  })
})
