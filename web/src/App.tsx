import { Component, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { QRCodeSVG } from 'qrcode.react'
import { ApiError, api, type Menu, type MenuItem, type OrderLine, type OrderStatus, type Quote, type Scenario } from './api'
import { formatCardNumber, formatCvc, formatExpiry, isValidCardNumber, isValidCvc, isValidExpiry } from './payment-card'

type CartLine = { quantity: number; optionIds: string[] }
type Cart = Record<string, CartLine>
type Screen = 'browse' | 'review' | 'pay' | 'processing' | 'complete'
type Language = 'en' | 'pt-BR'
type State = {
  screen: Screen
  cart: Cart
  menu: Menu | null
  quote: Quote | null
  quoteId: string | null
  order: OrderStatus | null
  idempotencyKey: string | null
  scenario: Scenario
  error: string | null
  notice: string | null
  loadingMenu: boolean
  busy: boolean
  recovering: boolean
  stockIssue: boolean
  changedItemIds: string[]
  requireConsentOnNextQuote: boolean
  quoteNeedsConsent: boolean
  resumeStatus: boolean
}
type Action =
  | { type: 'menu-loading' }
  | { type: 'menu-loaded'; menu: Menu; changedItemIds?: string[] }
  | { type: 'menu-failed'; message: string }
  | { type: 'menu-refresh-failed'; message: string }
  | { type: 'quantity'; itemId: string; quantity: number; optionIds?: string[]; emptyNotice?: string }
  | { type: 'clear-cart'; emptyNotice?: string }
  | { type: 'back-to-menu'; notice?: string }
  | { type: 'continue-payment' }
  | { type: 'back-to-review' }
  | { type: 'review-start' }
  | { type: 'stock-issue'; message: string }
  | { type: 'quote-loaded'; quote: Quote; notice?: string; requiresConsent: boolean; changedItemIds?: string[] }
  | { type: 'quote-failed'; message: string }
  | { type: 'accept-quote' }
  | { type: 'scenario'; scenario: Scenario }
  | { type: 'order-start'; idempotencyKey: string }
  | { type: 'recovery-start' }
  | { type: 'order-updated'; order: OrderStatus }
  | { type: 'order-unknown'; message: string }
  | { type: 'payment-error'; message: string }
  | { type: 'retry-declined' }
  | { type: 'new-order' }
  | { type: 'idle-reset' }

const CART_STORAGE_KEY = 'goodtable.cart.v1'
const ATTEMPT_STORAGE_KEY = 'goodtable.attempt.v1'
const PAYMENT_RETRY_STORAGE_KEY = 'goodtable.paymentRetryAt.v1'
const EMPTY_OPTION_IDS: string[] = []
const EMPTY_STATE: State = {
  screen: 'browse', cart: {}, menu: null, quote: null, quoteId: null, order: null, idempotencyKey: null,
  scenario: 'Approve', error: null, notice: null, loadingMenu: true, busy: false, recovering: false,
  stockIssue: false, requireConsentOnNextQuote: false, quoteNeedsConsent: false,
  changedItemIds: [],
  resumeStatus: false,
}

const messages = {
  en: {
    tagline: 'FRESH · MADE HERE', service: 'Order at the counter', step: (step: number) => `Step ${step} of three`,
    madeFresh: 'MADE FRESH, JUST FOR YOU', hero: <>A little good<br />goes a <em>long way.</em></>,
    heroDescription: 'Simple ingredients. Big lunch energy. Find your favorite and we’ll make it fresh.', readyTime: 'Ready in about 10 minutes',
    menuEyebrow: 'THE MENU', menuTitle: 'Made for your moment.', fresh: 'FRESH TODAY', retry: 'Try again', reconnecting: 'Reconnecting. Your current menu is still available.', menuUpdated: 'Price or availability changed. Check the highlighted item below.',
    categoryFilter: 'Filter menu by category', all: 'All', loadingMenu: 'Loading today’s menu…', noItems: 'No items are available in this category right now.',
    add: 'Add', soldOut: 'Sold out', unavailable: 'Unavailable', lowStock: (n: number) => `Only ${n} left`,
    limitPerLine: 'Up to 10 of each item.', limitUnits: 'An order can contain up to 30 items.', limitLines: 'Choose up to 15 different items.',
    limitTotal: 'The order limit is $150.00.', limitStock: 'No more stock is available for this item.',
    cart: 'Your order', choice: (n: number) => `${n} delicious choice${n === 1 ? '' : 's'}`, cartTotal: 'Estimated subtotal', review: 'Review order', clear: 'Clear order',
    confirmClearTitle: 'Clear this order?', confirmClearCopy: 'This will remove every item from the current order.', confirmClear: 'Clear order', cancelClear: 'Keep order',
    undoRemoved: (name: string) => `${name} was removed.`, undo: 'Undo',
    footerOne: 'Good food, made with care.', footerTwo: 'Fresh ingredients · Friendly service',
    reviewBack: '← Back to menu', reviewStep: 'STEP 02 · REVIEW', reviewTitle: 'Your order, your way.',
    reviewDescription: 'Take a moment to make sure everything looks right.', picks: 'Your picks', edit: 'Edit order',
    continuePayment: 'Continue to payment', backToReview: 'Back to review', paymentTitle: 'Confirm your payment',
    remove: 'Remove', reduce: 'Remove one', increase: 'Add one', removeItem: (name: string) => `Remove ${name}`,
    stockShort: 'Some items are no longer available in the quantity selected. Reduce or remove them to continue.', updatedLine: 'Price or availability was updated.',
    missingItem: 'This item is no longer on the menu. Remove it to continue.', updateTotal: 'Update total',
    reduceTo: (n: number) => `Reduce to ${n}`,
    noQuote: 'Update your order to see its current price and availability.', totalIncluded: 'Total, tax included', taxIncluded: (tax: string) => `Includes ${tax} tax. Your final price is confirmed before checkout.`,
    refreshed: 'Your total has been refreshed. Review it before continuing.', updatedQuote: 'The price or availability changed. Review and accept the updated total before continuing.',
    acceptUpdated: (total: string) => `I accept the updated total of ${total}`,
    checkoutReady: 'Ready when you are.', demoCopy: 'Demo only: use test values, never a real card. These fields are checked in this browser and erased when you place the order. The payment result is simulated.',
    cardNumber: 'Card number', expiryDate: 'Expiry (MM/YY)', securityCode: 'Security code',
    cardNumberError: 'Enter a valid card number.', expiryError: 'Enter a valid future expiry date (MM/YY).', cvcError: 'Enter a 3 or 4 digit security code.',
    demoOutcome: 'Demo payment outcome', approve: 'Approve — pickup ready', decline: 'Decline — no payment recorded',
    slowApproval: 'Confirm slowly — approved', keepConfirming: 'Keep confirming', placeOrder: 'Place demo order', starting: 'Starting checkout…',
    noCard: 'Card fields are never sent or saved', stepCheckout: 'STEP 03 · CHECKOUT', confirming: 'Confirming your order.', checking: 'Checking your order.',
    pending: 'Please keep this page open while we confirm the demo payment. Do not start another payment.',
    checkStatus: 'Check payment status', checkingAttempt: 'Checking this attempt…', retryAttempt: 'Retry the same attempt', retryPayment: 'Try payment again',
    sameAttempt: 'We’ll keep checking this same attempt. Do not pay again while its result is pending.',
    confirmed: 'ORDER CONFIRMED', declined: 'PAYMENT NOT RECORDED', goodChoice: 'That’s a good choice.', tryAgain: 'No worries. Try again.',
    pickup: 'YOUR PICKUP NUMBER', pickupHint: 'Keep this number with you for pickup.', reference: 'Order reference',
    receipt: 'Order receipt', print: 'Print receipt', qrReceipt: 'Scan for pickup reference and total', resetIn: (n: number) => `This screen clears in ${n} seconds for the next customer.`,
    newOrder: 'Start a new order', subtotal: 'Items', tax: 'Tax included', stillChoosing: 'Still choosing?',
    cartEmpty: 'Your order is empty. Add an item to continue.',
    idleCopy: 'We’ll clear this screen in one minute to keep the next order private.', freshStart: 'Start fresh', keepOrder: 'Keep my order',
    language: 'Language', english: 'English', portuguese: 'Português (Brasil)',
    errorFallbackTitle: 'This screen needs a refresh.', errorFallbackCopy: 'Your saved cart is still on this tab. Reload to continue.', reload: 'Reload checkout',
    paymentRateLimited: 'Payment could not start because requests are temporarily limited.', retryCountdown: (n: number) => `You can try again in ${n} seconds.`,
  },
  'pt-BR': {
    tagline: 'FRESCO · FEITO AQUI', service: 'Peça no balcão', step: (step: number) => `Etapa ${step} de três`,
    madeFresh: 'FEITO NA HORA PARA VOCÊ', hero: <>Um pouco de sabor<br />faz toda a <em>diferença.</em></>,
    heroDescription: 'Ingredientes simples, um ótimo almoço. Escolha seu favorito e preparamos na hora.', readyTime: 'Pronto em cerca de 10 minutos',
    menuEyebrow: 'CARDÁPIO', menuTitle: 'Feito para o seu momento.', fresh: 'FEITO HOJE', retry: 'Tentar novamente', reconnecting: 'Reconectando. O cardápio atual continua disponível.', menuUpdated: 'Preço ou disponibilidade mudou. Confira o item destacado abaixo.',
    categoryFilter: 'Filtrar cardápio por categoria', all: 'Todos', loadingMenu: 'Carregando o cardápio…', noItems: 'Não há itens disponíveis nesta categoria agora.',
    add: 'Adicionar', soldOut: 'Esgotado', unavailable: 'Indisponível', lowStock: (n: number) => `Restam ${n}`,
    limitPerLine: 'Até 10 unidades de cada item.', limitUnits: 'O pedido pode ter até 30 itens.', limitLines: 'Escolha até 15 itens diferentes.',
    limitTotal: 'O limite do pedido é R$ 150,00.', limitStock: 'Não há mais estoque disponível deste item.',
    cart: 'Seu pedido', choice: (n: number) => `${n} escolha${n === 1 ? '' : 's'} deliciosa${n === 1 ? '' : 's'}`, cartTotal: 'Subtotal estimado', review: 'Revisar pedido', clear: 'Limpar pedido',
    confirmClearTitle: 'Limpar este pedido?', confirmClearCopy: 'Todos os itens do pedido atual serão removidos.', confirmClear: 'Limpar pedido', cancelClear: 'Manter pedido',
    undoRemoved: (name: string) => `${name} foi removido.`, undo: 'Desfazer',
    footerOne: 'Comida boa, feita com carinho.', footerTwo: 'Ingredientes frescos · Atendimento amigável',
    reviewBack: '← Voltar ao cardápio', reviewStep: 'ETAPA 02 · REVISÃO', reviewTitle: 'Seu pedido, do seu jeito.',
    reviewDescription: 'Confira se tudo está como você deseja.', picks: 'Sua seleção', edit: 'Editar pedido',
    remove: 'Remover', reduce: 'Remover uma unidade', increase: 'Adicionar uma unidade', removeItem: (name: string) => `Remover ${name}`,
    stockShort: 'Alguns itens não estão mais disponíveis na quantidade escolhida. Reduza ou remova para continuar.', updatedLine: 'Preço ou disponibilidade foi atualizado.',
    missingItem: 'Este item não está mais no cardápio. Remova para continuar.', updateTotal: 'Atualizar total',
    reduceTo: (n: number) => `Reduzir para ${n}`,
    noQuote: 'Atualize seu pedido para conferir preço e disponibilidade.', totalIncluded: 'Total com impostos', taxIncluded: (tax: string) => `Inclui ${tax} em impostos. O preço final é confirmado antes do pagamento.`,
    refreshed: 'O total foi atualizado. Confira antes de continuar.', updatedQuote: 'O preço ou estoque mudou. Confira e aceite o novo total para continuar.',
    acceptUpdated: (total: string) => `Aceito o novo total de ${total}`,
    checkoutReady: 'Quando quiser, pode continuar.', demoCopy: 'Apenas demonstração: use dados de teste, nunca um cartão real. Os campos são conferidos neste navegador e apagados ao fazer o pedido. O resultado do pagamento é simulado.',
    cardNumber: 'Número do cartão', expiryDate: 'Validade (MM/AA)', securityCode: 'Código de segurança',
    cardNumberError: 'Digite um número de cartão válido.', expiryError: 'Digite uma validade futura (MM/AA).', cvcError: 'Digite um código de segurança de 3 ou 4 dígitos.',
    demoOutcome: 'Resultado do pagamento de demonstração', approve: 'Aprovar — pronto para retirar', decline: 'Recusar — nenhum pagamento registrado',
    slowApproval: 'Confirmar lentamente — aprovado', keepConfirming: 'Continuar confirmando', placeOrder: 'Fazer pedido de demonstração', starting: 'Iniciando…',
    noCard: 'Os campos do cartão não são enviados nem salvos', stepCheckout: 'ETAPA 03 · PAGAMENTO', confirming: 'Confirmando seu pedido.', checking: 'Consultando seu pedido.',
    pending: 'Mantenha esta página aberta enquanto confirmamos o pagamento de demonstração. Não inicie outro pagamento.',
    checkStatus: 'Consultar pagamento', checkingAttempt: 'Consultando esta tentativa…', retryAttempt: 'Tentar novamente a mesma tentativa', retryPayment: 'Tentar pagar novamente',
    sameAttempt: 'Vamos consultar esta mesma tentativa. Não pague novamente enquanto o resultado estiver pendente.',
    confirmed: 'PEDIDO CONFIRMADO', declined: 'PAGAMENTO NÃO REGISTRADO', goodChoice: 'Uma ótima escolha.', tryAgain: 'Sem problemas. Tente novamente.',
    pickup: 'NÚMERO PARA RETIRADA', pickupHint: 'Guarde este número para retirar seu pedido.', reference: 'Referência do pedido',
    receipt: 'Comprovante do pedido', print: 'Imprimir comprovante', qrReceipt: 'Escaneie para ver a referência e o total', resetIn: (n: number) => `Esta tela será limpa em ${n} segundos para o próximo cliente.`,
    newOrder: 'Fazer novo pedido', subtotal: 'Itens', tax: 'Impostos incluídos', stillChoosing: 'Ainda escolhendo?',
    cartEmpty: 'Seu pedido está vazio. Adicione um item para continuar.',
    idleCopy: 'Vamos limpar esta tela em um minuto para proteger o próximo pedido.', freshStart: 'Começar de novo', keepOrder: 'Manter pedido',
    language: 'Idioma', english: 'English', portuguese: 'Português (Brasil)',
    errorFallbackTitle: 'Esta tela precisa ser atualizada.', errorFallbackCopy: 'Seu carrinho ainda está salvo nesta aba. Atualize para continuar.', reload: 'Atualizar checkout',
    paymentRateLimited: 'O pagamento não foi iniciado porque há muitas solicitações temporariamente.', retryCountdown: (n: number) => `Você poderá tentar novamente em ${n} segundos.`,
    continuePayment: 'Continuar para pagamento', backToReview: 'Voltar à revisão', paymentTitle: 'Confirme seu pagamento',
  },
} as const

type Copy = typeof messages[Language]

function readStoredCart(): Cart {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(CART_STORAGE_KEY) ?? '{}')
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {}
    const cart: Cart = {}
    for (const [itemId, value] of Object.entries(stored)) {
      const legacyQuantity = typeof value === 'number' ? value : undefined
      const entry = typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown> : null
      const quantity = legacyQuantity ?? entry?.quantity
      const optionIds = entry?.optionIds ?? []
      if (itemId.length <= 64 && Number.isInteger(quantity) && Number(quantity) >= 1 && Number(quantity) <= 10 &&
        Array.isArray(optionIds) && optionIds.length <= 8 && optionIds.every((optionId) => typeof optionId === 'string' && optionId.length <= 64)) {
        cart[itemId] = { quantity: Number(quantity), optionIds: [...new Set(optionIds as string[])] }
      }
    }
    let units = 0
    let lines = 0
    for (const [itemId, line] of Object.entries(cart)) {
      if (units + line.quantity > 30 || lines >= 15) delete cart[itemId]
      else { units += line.quantity; lines += 1 }
    }
    return cart
  } catch {
    return {}
  }
}

function readPaymentCooldownSeconds(): number {
  try {
    const retryAt = Number(sessionStorage.getItem(PAYMENT_RETRY_STORAGE_KEY))
    return Number.isFinite(retryAt) ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1_000)) : 0
  } catch { return 0 }
}

type StoredAttempt = { idempotencyKey: string; quoteId: string; scenario: Scenario }

function readStoredAttempt(): StoredAttempt | null {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(ATTEMPT_STORAGE_KEY) ?? 'null')
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return null
    const candidate = stored as Record<string, unknown>
    if (typeof candidate.idempotencyKey !== 'string' || !/^[a-f0-9]{32}$/i.test(candidate.idempotencyKey) ||
      typeof candidate.quoteId !== 'string' || candidate.quoteId.length > 128 ||
      !['Approve', 'Decline', 'UnknownAfterApproval', 'StillUnknown'].includes(String(candidate.scenario))) return null
    return { idempotencyKey: candidate.idempotencyKey, quoteId: candidate.quoteId, scenario: candidate.scenario as Scenario }
  } catch {
    return null
  }
}

function createInitialState(): State {
  const cart = readStoredCart()
  const attempt = readStoredAttempt()
  return attempt
    ? { ...EMPTY_STATE, screen: 'processing', cart, quoteId: attempt.quoteId, idempotencyKey: attempt.idempotencyKey, scenario: attempt.scenario, loadingMenu: false, resumeStatus: true }
    : { ...EMPTY_STATE, cart }
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'menu-loading': return { ...state, loadingMenu: state.menu === null, error: null }
    case 'menu-loaded': return { ...state, menu: action.menu, loadingMenu: false, error: null, changedItemIds: action.changedItemIds ?? state.changedItemIds }
    case 'menu-failed': return { ...state, loadingMenu: false, error: action.message }
    case 'menu-refresh-failed': return { ...state, notice: action.message }
    case 'quantity': {
      const next = { ...state.cart }
      if (action.quantity <= 0) delete next[action.itemId]
      else next[action.itemId] = { quantity: action.quantity, optionIds: action.optionIds ?? next[action.itemId]?.optionIds ?? [] }
      return {
        ...state, screen: state.screen === 'review' && Object.keys(next).length === 0 ? 'browse' : state.screen,
        cart: next, quote: null, stockIssue: false, notice: Object.keys(next).length === 0 ? action.emptyNotice ?? null : null,
        changedItemIds: state.changedItemIds.filter((changedId) => changedId !== action.itemId),
        requireConsentOnNextQuote: state.requireConsentOnNextQuote || (state.screen === 'review' && state.quote !== null),
      }
    }
    case 'clear-cart': return {
      ...state, screen: state.screen === 'review' ? 'browse' : state.screen, cart: {}, quote: null, stockIssue: false,
      notice: action.emptyNotice ?? null, requireConsentOnNextQuote: false, quoteNeedsConsent: false,
    }
    case 'back-to-menu': return { ...state, screen: 'browse', quote: null, quoteId: null, error: null, notice: action.notice ?? null, idempotencyKey: null, stockIssue: false, requireConsentOnNextQuote: false }
    case 'continue-payment': return state.quote && !state.quoteNeedsConsent ? { ...state, screen: 'pay', error: null } : state
    case 'back-to-review': return { ...state, screen: 'review', error: null }
    case 'review-start': return { ...state, screen: 'review', busy: true, error: null, notice: null, stockIssue: false }
    case 'stock-issue': return { ...state, screen: 'review', quote: null, busy: false, error: null, notice: action.message, stockIssue: true, requireConsentOnNextQuote: state.requireConsentOnNextQuote || state.quote !== null }
    case 'quote-loaded': return {
      ...state, screen: 'review', quote: action.quote, busy: false, error: null, notice: action.notice ?? null,
      stockIssue: false, quoteNeedsConsent: action.requiresConsent, requireConsentOnNextQuote: false,
      changedItemIds: [...new Set([...state.changedItemIds, ...(action.changedItemIds ?? [])])],
    }
    case 'quote-failed': return { ...state, screen: 'review', quote: null, busy: false, error: action.message, stockIssue: false }
    case 'accept-quote': return { ...state, quoteNeedsConsent: false }
    case 'scenario': return { ...state, scenario: action.scenario }
    case 'order-start': return { ...state, screen: 'processing', idempotencyKey: action.idempotencyKey, quoteId: state.quote?.quoteId ?? state.quoteId, order: null, busy: true, recovering: false, resumeStatus: false, error: null }
    case 'recovery-start': return { ...state, busy: true, recovering: true, resumeStatus: false, error: null }
    case 'order-updated': return {
      ...state, order: action.order, screen: action.order.status === 'PENDING_PAYMENT' ? 'processing' : 'complete',
      busy: false, recovering: false, resumeStatus: false, error: null,
    }
    case 'order-unknown': return { ...state, busy: false, recovering: false, resumeStatus: false, error: action.message }
    case 'payment-error': return { ...state, busy: false, recovering: false, error: action.message, screen: 'review', idempotencyKey: null, quoteId: null }
    case 'retry-declined': return { ...state, screen: 'review', order: null, idempotencyKey: null, quoteId: null, busy: false, recovering: false, error: null }
    case 'new-order': return { ...EMPTY_STATE, menu: state.menu, loadingMenu: false }
    case 'idle-reset': return state.screen === 'processing' ? state : { ...EMPTY_STATE, menu: state.menu, loadingMenu: false }
  }
}

const formatMoney = (cents: number, currency = 'USD', language: Language = 'en') =>
  new Intl.NumberFormat(language === 'pt-BR' ? 'pt-BR' : 'en-US', { style: 'currency', currency }).format(cents / 100)

function selectedUnitPrice(item: MenuItem | undefined, optionIds: string[]): number {
  if (!item) return 0
  const selectedOptions = item.optionGroups.flatMap((group) => group.options.filter((option) => optionIds.includes(option.id)))
  return item.priceCents + selectedOptions.reduce((sum, option) => sum + option.additionalPriceCents, 0)
}

function defaultOptionIds(item: MenuItem): string[] {
  return item.optionGroups.filter((group) => group.isRequired).flatMap((group) => group.options.slice(0, 1).map((option) => option.id))
}

function withRequiredOptionDefaults(item: MenuItem, optionIds: string[]): string[] {
  const validIds = new Set(item.optionGroups.flatMap((group) => group.options.map((option) => option.id)))
  const next = [...new Set(optionIds.filter((id) => validIds.has(id)))]
  for (const group of item.optionGroups) {
    if (group.isRequired && !group.options.some((option) => next.includes(option.id)) && group.options[0]) next.push(group.options[0].id)
  }
  return next
}

function localizedOptionGroup(id: string, name: string, language: Language): string {
  if (language !== 'pt-BR') return name
  return ({ size: 'Tamanho', extras: 'Adicionais' } as Record<string, string>)[id] ?? name
}

function localizedOption(id: string, name: string, language: Language): string {
  if (language !== 'pt-BR') return name
  return ({ small: 'Pequeno', large: 'Grande', 'oat-milk': 'Leite de aveia', 'extra-shot': 'Dose extra' } as Record<string, string>)[id] ?? name
}

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
  const lastActivity = useRef(Date.now())
  const idleDialogRef = useRef<HTMLElement | null>(null)
  const clearDialogRef = useRef<HTMLElement | null>(null)
  const undoTimer = useRef<number | null>(null)
  const polling = useRef(false)
  const submittingPayment = useRef(false)
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
  }, [])

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
  }, [state.screen, state.menu, state.cart, state.changedItemIds, copy.reconnecting])

  useEffect(() => {
    if (!state.menu) return
    const items = new Map(state.menu.categories.flatMap((group) => group.items).map((item) => [item.id, item]))
    for (const [itemId, line] of Object.entries(state.cart)) {
      const item = items.get(itemId)
      if (!item) continue
      const options = withRequiredOptionDefaults(item, line.optionIds)
      if (JSON.stringify(options) !== JSON.stringify(line.optionIds)) dispatch({ type: 'quantity', itemId, quantity: line.quantity, optionIds: options })
    }
  }, [state.menu])

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

  const refreshQuote = useCallback(async (notice?: string) => {
    dispatch({ type: 'review-start' })
    if (Object.keys(state.cart).length === 0) {
      dispatch({ type: 'quote-failed', message: copy.noQuote })
      return
    }
    let latestMenu = state.menu
    let reconnecting = false
    let changedCartItemIds: string[] = []
    try {
      latestMenu = await api.menu()
      const priorItems = new Map(state.menu?.categories.flatMap((group) => group.items).map((item) => [item.id, item]) ?? [])
      const currentItems = new Map(latestMenu.categories.flatMap((group) => group.items).map((item) => [item.id, item]))
      changedCartItemIds = Object.keys(state.cart).filter((itemId) => {
        const before = priorItems.get(itemId)
        const after = currentItems.get(itemId)
        return !before || !after || before.priceCents !== after.priceCents || before.stock !== after.stock || before.isAvailable !== after.isAvailable || JSON.stringify(before.optionGroups) !== JSON.stringify(after.optionGroups)
      })
      changedCartItemIds = [...new Set([...changedCartItemIds, ...state.changedItemIds.filter((itemId) => itemId in state.cart)])]
      dispatch({ type: 'menu-loaded', menu: latestMenu, changedItemIds: changedCartItemIds })
    } catch { reconnecting = true /* The quote endpoint remains authoritative; keep the last known menu for recovery controls. */ }

    if (latestMenu) {
      const currentItems = new Map(latestMenu.categories.flatMap((group) => group.items).map((item) => [item.id, item]))
      const unavailable = Object.entries(state.cart).some(([itemId, line]) => {
        const item = currentItems.get(itemId)
        return !item || !item.isAvailable || (item.stock !== null && line.quantity > item.stock)
      })
      if (unavailable) {
        dispatch({ type: 'stock-issue', message: copy.stockShort })
        return
      }
    }

    try {
      const quote = await api.quote(Object.entries(state.cart).map(([itemId, line]) => ({ itemId, quantity: line.quantity, optionIds: line.optionIds })))
      const oldItems = new Map(state.menu?.categories.flatMap((group) => group.items).map((item) => [item.id, item]) ?? [])
      const oldPrices = new Map(Object.entries(state.cart).map(([itemId, line]) => [itemId, selectedUnitPrice(oldItems.get(itemId), line.optionIds)]))
      const changedPriceIds = quote.lines.filter((line) => oldPrices.has(line.itemId) && oldPrices.get(line.itemId) !== line.unitPriceCents).map((line) => line.itemId)
      const pricesChanged = changedPriceIds.length > 0
      const menuChangeNeedsConsent = state.changedItemIds.some((itemId) => itemId in state.cart)
      const requiresConsent = state.requireConsentOnNextQuote || state.quote !== null || pricesChanged || menuChangeNeedsConsent
      const allChangedIds = [...new Set([...changedCartItemIds, ...changedPriceIds])]
      dispatch({ type: 'quote-loaded', quote, notice: requiresConsent ? copy.updatedQuote : reconnecting ? copy.reconnecting : allChangedIds.length ? copy.menuUpdated : notice, requiresConsent, changedItemIds: allChangedIds })
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.code?.includes('STOCK') === true)) {
        try { dispatch({ type: 'menu-loaded', menu: await api.menu() }) } catch { /* keep the last menu */ }
        dispatch({ type: 'stock-issue', message: copy.stockShort })
        return
      }
      dispatch({ type: 'quote-failed', message: getMessage(error) })
    }
  }, [state.cart, state.menu, state.quote, state.requireConsentOnNextQuote, copy])

  const updateOrder = useCallback((order: OrderStatus) => {
    if (order.status !== 'PENDING_PAYMENT') submittingPayment.current = false
    dispatch({ type: 'order-updated', order })
  }, [])

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
  }, [state.idempotencyKey, updateOrder])

  useEffect(() => {
    if (state.screen !== 'processing' || !state.idempotencyKey || (state.order !== null && state.order.status !== 'PENDING_PAYMENT') || state.busy) return
    if (state.resumeStatus) {
      void checkStatus()
      return
    }
    const timer = window.setInterval(() => { void checkStatus() }, 5_000)
    return () => window.clearInterval(timer)
  }, [state.screen, state.order?.status, state.busy, state.idempotencyKey, state.resumeStatus, checkStatus])

  const submitPayment = useCallback(async () => {
    if (!state.quote || state.quoteNeedsConsent || submittingPayment.current) return
    submittingPayment.current = true
    const key = state.idempotencyKey ?? crypto.randomUUID().replaceAll('-', '')
    try {
      // Save the attempt before the network request so a reload can resolve this same idempotency key.
      sessionStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify({
        idempotencyKey: key, quoteId: state.quote.quoteId, scenario: state.scenario,
      } satisfies StoredAttempt))
    } catch {
      submittingPayment.current = false
      dispatch({ type: 'payment-error', message: 'This browser could not save the checkout attempt. Please try again before placing the order.' })
      return
    }
    dispatch({ type: 'order-start', idempotencyKey: key })
    try {
      const order = await api.placeOrder(state.quote.quoteId, key, state.scenario)
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
      dispatch({ type: 'order-unknown', message: 'We could not confirm the response. Checking this same attempt now.' })
      try { updateOrder(await api.status(key)) }
      catch { dispatch({ type: 'order-unknown', message: 'We could not confirm the result yet. Do not pay again. We will keep checking this attempt.' }) }
    }
  }, [state.quote, state.quoteNeedsConsent, state.idempotencyKey, state.scenario, updateOrder, refreshQuote, copy.updatedQuote, copy.paymentRateLimited])

  const retrySameAttempt = useCallback(async () => {
    if (!state.idempotencyKey || !state.quoteId) return
    dispatch({ type: 'order-start', idempotencyKey: state.idempotencyKey })
    try { updateOrder(await api.placeOrder(state.quoteId, state.idempotencyKey, state.scenario)) }
    catch { dispatch({ type: 'order-unknown', message: 'We could not confirm the response. Checking this same attempt.' }); await checkStatus() }
  }, [state.idempotencyKey, state.quoteId, state.scenario, updateOrder, checkStatus])

  const retryAfterDecline = useCallback(() => {
    submittingPayment.current = false
    dispatch({ type: 'retry-declined' })
    void refreshQuote(copy.updatedQuote)
  }, [refreshQuote, copy.updatedQuote])

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
      const until = Date.now() + 5_000
      undoTimer.current = window.setInterval(() => {
        const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000))
        setUndoSeconds(remaining)
        if (remaining === 0 && undoTimer.current !== null) {
          window.clearInterval(undoTimer.current)
          undoTimer.current = null
          setUndoItem(null)
        }
      }, 200)
    }
    dispatch({ type: 'quantity', itemId, quantity, optionIds: selectedOptions, emptyNotice: state.screen === 'review' && quantity === 0 && Object.keys(state.cart).length === 1 ? copy.cartEmpty : undefined })
  }

  function restoreRemovedItem() {
    if (!undoItem) return
    const current = state.cart[undoItem.itemId]?.quantity ?? 0
    const item = allItems.get(undoItem.itemId)
    if (item && !limitReason(item, true, undoItem.optionIds)) dispatch({ type: 'quantity', itemId: undoItem.itemId, quantity: current + undoItem.quantity, optionIds: undoItem.optionIds })
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
      <header className="topbar">
        <a className="brand" href="#top"><span className="brand-mark" aria-hidden="true"><span /></span>
          <span>goodtable<span className="brand-period">.</span><small>{copy.tagline}</small></span></a>
        <div className="topbar-right">
          <label className="language-picker"><span>{copy.language}</span><select value={language} onChange={(event) => setLanguage(event.target.value as Language)} aria-label={copy.language}>
            <option value="en">{copy.english}</option><option value="pt-BR">{copy.portuguese}</option></select></label>
          <span className="service-pill"><span className="status-dot" aria-hidden="true" />{copy.service}</span>
          <span className="order-step" aria-label={copy.step(step)}><span>{String(step).padStart(2, '0')}</span> / 03</span>
        </div>
      </header>

      <main id="top" className="main-content">
        {state.screen === 'browse' && <>
          <section className="welcome-row" aria-labelledby="welcome-title">
            <div className="welcome-copy"><span className="eyebrow"><span className="eyebrow-line" /> {copy.madeFresh}</span>
              <h1 id="welcome-title">{copy.hero}</h1><p>{copy.heroDescription}</p><div className="welcome-note"><span className="sparkle" aria-hidden="true" />{copy.readyTime}</div></div>
            <div className="welcome-art" aria-hidden="true"><div className="art-sun" /><div className="art-bowl"><div className="art-food"><i /><i /><i /><i /><i /></div><span className="bowl-rim" /></div><div className="art-leaf leaf-one" /><div className="art-leaf leaf-two" /><div className="art-caption"><span>GOOD FOOD</span><b>GOOD MOOD</b></div></div>
          </section>

          <section className="menu-section" aria-labelledby="menu-title">
            <div className="section-heading"><div><span className="eyebrow"><span className="eyebrow-line" /> {copy.menuEyebrow}</span><h2 id="menu-title">{copy.menuTitle}</h2></div><span className="fresh-badge"><span className="fresh-leaf" aria-hidden="true" />{copy.fresh}</span></div>
            {state.error && <div className="error-banner" role="alert"><span>{state.error}</span><button className="text-button" onClick={() => void loadMenu()}>{copy.retry}</button></div>}
            {state.notice && <div className="notice-banner" role="status">{state.notice}</div>}
            <div className="category-row" role="group" aria-label={copy.categoryFilter}>
              {categories.map((name) => <button key={name} className={`category-chip ${category === name ? 'active' : ''}`} aria-pressed={category === name} onClick={() => setCategory(name)}>{categoryName(name, language, copy)}</button>)}
            </div>
            {state.loadingMenu && !state.menu ? <div className="menu-skeleton" role="status" aria-label={copy.loadingMenu}>
              <span>{copy.loadingMenu}</span><div className="menu-skeleton-grid" aria-hidden="true">{[0, 1, 2].map((item) => <div className="menu-skeleton-card" key={item}><i /><b /><b /><em /></div>)}</div>
            </div> : !state.menu ? <div className="menu-state" role="alert">{language === 'pt-BR' ? 'Não foi possível carregar o cardápio.' : 'We could not load the menu.'} <button className="text-button" onClick={() => void loadMenu()}>{copy.retry}</button></div> : visibleItems.length === 0 ? <div className="menu-state">{copy.noItems}</div> :
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
          paymentCooldownSeconds={paymentCooldownSeconds} onBack={() => dispatch({ type: 'back-to-review' })}
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

function MenuCard({ item, quantity, optionIds, index, language, copy, getDisabledReason, onChange }: {
  item: MenuItem; quantity: number; optionIds: string[]; index: number; language: Language; copy: Copy
  getDisabledReason: (optionIds: string[]) => string | undefined; onChange: (quantity: number, optionIds: string[]) => void
}) {
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>(() => withRequiredOptionDefaults(item, optionIds))
  useEffect(() => { setSelectedOptionIds(withRequiredOptionDefaults(item, optionIds)) }, [item, quantity, optionIds])
  const available = item.isAvailable && (item.stock === null || item.stock > 0)
  const lowStock = available && item.stock !== null && item.stock > 0 && item.stock <= 5
  const disabledReason = getDisabledReason(selectedOptionIds)
  const plusDisabled = Boolean(disabledReason)
  const updateOption = (groupId: string, optionId: string, checked: boolean) => {
    const group = item.optionGroups.find((candidate) => candidate.id === groupId)
    if (!group) return
    const groupIds = group.options.map((option) => option.id)
    const currentSelection = selectedOptionIds.filter((id) => groupIds.includes(id))
    const updatedSelection = group.isRequired
      ? [optionId]
      : checked ? [...currentSelection, optionId] : currentSelection.filter((id) => id !== optionId)
    const next = [...selectedOptionIds.filter((id) => !groupIds.includes(id)), ...updatedSelection]
    setSelectedOptionIds(next)
    if (quantity > 0) onChange(quantity, next)
  }
  const unitPriceCents = selectedUnitPrice(item, selectedOptionIds)
  return <article className={`menu-card ${!available ? 'unavailable' : ''}`} style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
    <div className={`food-art food-art-${item.category.toLowerCase()}`} aria-hidden="true"><FoodIllustration category={item.category} /><span className="food-stamp">{item.category === 'Drinks' ? 'SIP' : item.category === 'Bowls' ? 'BOWL' : 'FAVE'}</span></div>
    <div className="menu-card-body"><div className="menu-card-title"><h3>{item.name}</h3><span className="price">{formatMoney(unitPriceCents, 'USD', language)}</span></div>
      <p>{item.description}</p>
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
        {!available ? <button className="sold-out" type="button" disabled aria-label={`${item.name}, ${copy.soldOut}`}>{copy.soldOut}</button> : quantity === 0 ?
          <button className="add-button" onClick={() => onChange(1, selectedOptionIds)} disabled={plusDisabled} aria-label={`${copy.add} ${item.name}`} aria-describedby={plusDisabled ? `limit-${item.id}` : undefined} title={disabledReason}>
            <span aria-hidden="true">+</span> {copy.add}</button> :
          <div className="quantity-control" aria-label={`${item.name}, ${quantity}`}>
            <button onClick={() => onChange(quantity - 1, selectedOptionIds)} aria-label={`${copy.reduce}: ${item.name}`}>−</button><span aria-live="polite">{quantity}</span>
            <button onClick={() => onChange(quantity + 1, selectedOptionIds)} disabled={plusDisabled} aria-label={`${copy.increase}: ${item.name}`} aria-describedby={plusDisabled ? `limit-${item.id}` : undefined} title={disabledReason}>+</button>
          </div>}
      </div>
      {plusDisabled && <small className="limit-hint" id={`limit-${item.id}`}>{disabledReason}</small>}
    </div>
  </article>
}

function FoodIllustration({ category }: { category: string }) {
  if (category === 'Drinks') return <svg viewBox="0 0 160 125" focusable="false"><path d="M57 24h47l-5 81H62z" fill="#f8f1df" stroke="#a95b39" strokeWidth="3" strokeLinejoin="round"/><path d="M60 43h42l-3 48H63z" fill="#d88f55"/><path d="M94 24l13-12" stroke="#637a54" strokeWidth="4" strokeLinecap="round"/><circle cx="78" cy="62" r="4" fill="#fff5cc"/><circle cx="91" cy="77" r="3" fill="#fff5cc"/><path d="M56 24h49" stroke="#a95b39" strokeWidth="4" strokeLinecap="round"/></svg>
  if (category === 'Bowls') return <svg viewBox="0 0 160 125" focusable="false"><ellipse cx="80" cy="66" rx="48" ry="34" fill="#f8f1df" stroke="#a95b39" strokeWidth="3"/><ellipse cx="80" cy="62" rx="36" ry="23" fill="#8f9b5e"/><path d="M42 69c5 21 20 33 38 33s33-12 38-33" fill="#dfaa6a" stroke="#a95b39" strokeWidth="3"/><circle cx="65" cy="54" r="8" fill="#f1cf76"/><circle cx="91" cy="54" r="7" fill="#db7353"/><path d="M80 48l8 13h-15z" fill="#f4e8ca"/><path d="M51 63h58" stroke="#f4e8ca" strokeWidth="3" strokeLinecap="round"/></svg>
  return <svg viewBox="0 0 160 125" focusable="false"><path d="M44 45h72l-7 49c-1 8-6 12-15 12H66c-9 0-14-4-15-12z" fill="#e8c58c" stroke="#a95b39" strokeWidth="3" strokeLinejoin="round"/><path d="M48 50h64l-2 16H50z" fill="#64805a"/><path d="M47 44h66" stroke="#d77a55" strokeWidth="9" strokeLinecap="round"/><path d="M51 70h58" stroke="#f8f1df" strokeWidth="5"/><path d="M60 85h40" stroke="#a95b39" strokeWidth="5" strokeLinecap="round"/><path d="M65 30c5-9 14-9 18 0M87 31c4-8 12-9 17-1" fill="none" stroke="#637a54" strokeWidth="4" strokeLinecap="round"/></svg>
}

function ReviewScreen({ quote, cart, menuItems, language, copy, busy, error, notice, stockIssue, changedItemIds, quoteNeedsConsent, paymentCooldownSeconds, onBack, onClear, onQuantity, onRefresh, onAccept, onContinue }: {
  quote: Quote | null; cart: Cart; menuItems: Map<string, MenuItem>; language: Language; copy: Copy; busy: boolean
  error: string | null; notice: string | null; stockIssue: boolean; changedItemIds: string[]; quoteNeedsConsent: boolean; paymentCooldownSeconds: number; onBack: () => void; onClear: () => void
  onQuantity: (itemId: string, quantity: number) => void; onRefresh: () => void; onAccept: () => void; onContinue: () => void
}) {
  const displayedLines = quote?.lines.map((line) => ({ itemId: line.itemId, name: line.name, quantity: line.quantity, unitPriceCents: line.unitPriceCents, lineTotalCents: line.lineTotalCents })) ??
    Object.entries(cart).map(([itemId, cartLine]) => {
      const item = menuItems.get(itemId)
      const unitPriceCents = selectedUnitPrice(item, cartLine.optionIds)
      return { itemId, name: item?.name ?? (language === 'pt-BR' ? 'Item indisponível' : 'Unavailable item'), quantity: cartLine.quantity, unitPriceCents, lineTotalCents: unitPriceCents * cartLine.quantity }
    })
  return <section className="checkout-screen" aria-labelledby="review-title">
    <button className="back-link" onClick={onBack}>{copy.reviewBack}</button>
    <div className="checkout-heading"><span className="eyebrow"><span className="eyebrow-line" /> {copy.reviewStep}</span><h1 id="review-title">{copy.reviewTitle}</h1><p>{copy.reviewDescription}</p></div>
    {notice && !stockIssue && <div className="notice-banner" role="status">{notice}</div>}
    {stockIssue && <div className="error-banner" role="alert">{copy.stockShort}</div>}
    {error && <div className="error-banner" role="alert"><span>{error}{paymentCooldownSeconds > 0 && <small role="status"> {copy.retryCountdown(paymentCooldownSeconds)}</small>}</span><button className="text-button" onClick={onRefresh}>{copy.retry}</button></div>}
    <div className="review-layout"><div className="review-card"><div className="review-card-head"><h2>{copy.picks}</h2><div className="review-card-actions"><button className="text-button" onClick={onBack}>{copy.edit}</button><button className="text-button clear-order" onClick={onClear}>{copy.clear}</button></div></div>
      {displayedLines.map((line) => {
        const item = menuItems.get(line.itemId)
        const available = item?.isAvailable === true && (item.stock === null || item.stock > 0)
        const overStock = !available || (item?.stock !== null && item?.stock !== undefined && line.quantity > item.stock)
        const itemChanged = changedItemIds.includes(line.itemId)
        return <div className={`review-line ${overStock ? 'review-line-warning' : itemChanged ? 'review-line-updated' : ''}`} key={line.itemId}>
          <div className="review-item-summary"><span className="review-quantity">{line.quantity}</span><span className="review-name">{line.name}<small>{formatMoney(line.unitPriceCents, quote?.currency ?? 'USD', language)} each</small></span>
            <strong>{formatMoney(line.lineTotalCents, quote?.currency ?? 'USD', language)}</strong></div>
          <div className="review-item-actions"><button className="text-button" onClick={() => onQuantity(line.itemId, Math.max(0, line.quantity - 1))} aria-label={`${copy.reduce}: ${line.name}`}>{copy.reduce}</button>
            <button className="text-button remove-line" onClick={() => onQuantity(line.itemId, 0)} aria-label={copy.removeItem(line.name)}>{copy.remove}</button>
            {overStock && item && item.stock !== null && item.stock > 0 && <button className="text-button" onClick={() => onQuantity(line.itemId, item.stock!)}>{copy.reduceTo(item.stock)}</button>}
            {item?.stock !== null && item?.stock !== undefined && <small>{language === 'pt-BR' ? `Disponível: ${item.stock}` : `Available now: ${item.stock}`}</small>}
          </div>
          {overStock && <small className="availability-note" role="alert">{item ? copy.stockShort : copy.missingItem}</small>}
          {!overStock && itemChanged && <small className="availability-note" role="status">{copy.updatedLine}</small>}
        </div>
      })}
      {!quote && <div className="quote-refresh-row"><p>{busy && <span className="inline-spinner" aria-hidden="true" />}{busy ? copy.loadingMenu : copy.noQuote}</p><button className="secondary-button" onClick={onRefresh} disabled={busy || Object.keys(cart).length === 0}>{busy ? copy.loadingMenu : copy.updateTotal}</button></div>}
      {quote && <><div className="review-total" aria-live="polite" aria-atomic="true"><span>{copy.totalIncluded}</span><strong>{formatMoney(quote.totalCents, quote.currency, language)}</strong></div>
        <p className="tax-note">{copy.taxIncluded(formatMoney(quote.taxCents, quote.currency, language))}</p></>}
      {quote && <button className="text-button refresh-total" onClick={onRefresh} disabled={busy}>{copy.updateTotal}</button>}
    </div>
    {quote && <aside className="payment-card"><span className="payment-icon" aria-hidden="true">✓</span><h2>{copy.checkoutReady}</h2><p>{copy.reviewDescription}</p>
      {quoteNeedsConsent && <label className="quote-consent"><input type="checkbox" checked={!quoteNeedsConsent} onChange={onAccept} /><span>{copy.acceptUpdated(formatMoney(quote.totalCents, quote.currency, language))}</span></label>}
      <button className="primary-button pay-button" onClick={onContinue} disabled={busy || quoteNeedsConsent || paymentCooldownSeconds > 0}>{copy.continuePayment} <span aria-hidden="true">→</span></button>
    </aside>}
    </div>
  </section>
}

function PaymentScreen({ quote, scenario, language, copy, paymentCooldownSeconds, onBack, onScenario, onSubmit }: {
  quote: Quote; scenario: Scenario; language: Language; copy: Copy; paymentCooldownSeconds: number
  onBack: () => void; onScenario: (scenario: Scenario) => void; onSubmit: () => void
}) {
  const [cardNumber, setCardNumber] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvc, setCvc] = useState('')
  const [touched, setTouched] = useState({ cardNumber: false, expiry: false, cvc: false })
  const validCardNumber = isValidCardNumber(cardNumber)
  const validExpiry = isValidExpiry(expiry)
  const validCvc = isValidCvc(cvc)
  const canSubmit = validCardNumber && validExpiry && validCvc && paymentCooldownSeconds === 0
  const submit = () => {
    if (!canSubmit) {
      setTouched({ cardNumber: true, expiry: true, cvc: true })
      return
    }
    flushSync(() => {
      setCardNumber('')
      setExpiry('')
      setCvc('')
    })
    onSubmit()
  }
  const scenarioLabels: { value: Scenario; label: string }[] = [
    { value: 'Approve', label: copy.approve }, { value: 'Decline', label: copy.decline },
    { value: 'UnknownAfterApproval', label: copy.slowApproval }, { value: 'StillUnknown', label: copy.keepConfirming },
  ]
  return <section className="checkout-screen" aria-labelledby="payment-title">
    <button className="back-link" onClick={onBack}>← {copy.backToReview}</button>
    <div className="checkout-heading"><span className="eyebrow"><span className="eyebrow-line" /> {copy.stepCheckout}</span><h1 id="payment-title">{copy.paymentTitle}</h1><p>{copy.demoCopy}</p></div>
    <div className="review-layout">
      <div className="review-card"><div className="review-card-head"><h2>{copy.picks}</h2></div>
        <ul className="payment-summary">{quote.lines.map((line) => <li key={line.itemId}><span>{line.quantity} × {line.name}</span><strong>{formatMoney(line.lineTotalCents, quote.currency, language)}</strong></li>)}</ul>
        <div className="review-total" aria-live="polite" aria-atomic="true"><span>{copy.totalIncluded}</span><strong>{formatMoney(quote.totalCents, quote.currency, language)}</strong></div>
        <p className="tax-note">{copy.taxIncluded(formatMoney(quote.taxCents, quote.currency, language))}</p>
      </div>
      <aside className="payment-card"><span className="payment-icon" aria-hidden="true">✓</span><h2>{copy.checkoutReady}</h2>
        <div className="card-entry-fields">
          <label className="card-field"><span>{copy.cardNumber}</span><input aria-invalid={touched.cardNumber && !validCardNumber} aria-describedby={touched.cardNumber && !validCardNumber ? 'card-number-error' : undefined}
            type="text" inputMode="numeric" autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={23} value={cardNumber}
            onChange={(event) => setCardNumber(formatCardNumber(event.target.value))} onBlur={() => setTouched((current) => ({ ...current, cardNumber: true }))} />
            {touched.cardNumber && !validCardNumber && <small className="field-error" id="card-number-error">{copy.cardNumberError}</small>}</label>
          <div className="card-field-pair">
            <label className="card-field"><span>{copy.expiryDate}</span><input aria-invalid={touched.expiry && !validExpiry} aria-describedby={touched.expiry && !validExpiry ? 'card-expiry-error' : undefined}
              type="text" inputMode="numeric" autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={5} placeholder="MM/YY" value={expiry}
              onChange={(event) => setExpiry(formatExpiry(event.target.value))} onBlur={() => setTouched((current) => ({ ...current, expiry: true }))} />
              {touched.expiry && !validExpiry && <small className="field-error" id="card-expiry-error">{copy.expiryError}</small>}</label>
            <label className="card-field"><span>{copy.securityCode}</span><input aria-invalid={touched.cvc && !validCvc} aria-describedby={touched.cvc && !validCvc ? 'card-cvc-error' : undefined}
              type="password" inputMode="numeric" autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={4} value={cvc}
              onChange={(event) => setCvc(formatCvc(event.target.value))} onBlur={() => setTouched((current) => ({ ...current, cvc: true }))} />
              {touched.cvc && !validCvc && <small className="field-error" id="card-cvc-error">{copy.cvcError}</small>}</label>
          </div>
        </div>
        <label className="field-label" htmlFor="payment-scenario">{copy.demoOutcome}</label>
        <select id="payment-scenario" value={scenario} onChange={(event) => onScenario(event.target.value as Scenario)}>{scenarioLabels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        <button className="primary-button pay-button" onClick={submit} disabled={!canSubmit}>{paymentCooldownSeconds > 0 ? copy.retryCountdown(paymentCooldownSeconds) : <>{copy.placeOrder} · {formatMoney(quote.totalCents, quote.currency, language)} <span aria-hidden="true">→</span></>}</button>
        <div className="privacy-note"><span aria-hidden="true" className="privacy-mark" />{copy.noCard}</div>
      </aside>
    </div>
  </section>
}

function ProcessingScreen({ order, busy, recovering, error, language, copy, onCheck, onRetry }: {
  order: OrderStatus | null; busy: boolean; recovering: boolean; error: string | null; language: Language; copy: Copy; onCheck: () => void; onRetry: () => void
}) {
  const pending = order === null || order.status === 'PENDING_PAYMENT'
  return <section className="status-screen" aria-labelledby="processing-title" aria-live="polite">
    <div className="status-orbit" aria-hidden="true"><span /><i /><b /></div><span className="eyebrow"><span className="eyebrow-line" /> {copy.stepCheckout}</span>
    <h1 id="processing-title">{pending ? copy.confirming : copy.checking}</h1><p className="status-message">{pending ? copy.pending : order.message}</p>
    {pending && <p className="polling-note" role="status">{language === 'pt-BR' ? 'Verificando automaticamente a cada 5 segundos…' : 'Checking automatically every 5 seconds…'}</p>}
    {error && <div className="error-banner status-error" role="status">{error}</div>}
    <div className="status-actions"><button className="primary-button" onClick={onCheck} disabled={busy}>{recovering ? copy.checkingAttempt : copy.checkStatus}</button>
      {error && <button className="secondary-button" onClick={onRetry} disabled={busy}>{copy.retryAttempt}</button>}</div>
    <span className="attempt-note">{copy.sameAttempt}</span>
  </section>
}

function CompleteScreen({ order, quote, language, copy, onRetry, onNewOrder }: { order: OrderStatus; quote: Quote | null; language: Language; copy: Copy; onRetry: () => void; onNewOrder: () => void }) {
  const [seconds, setSeconds] = useState(30)
  const paid = order.status === 'PAID'
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
    <h1 id="complete-title">{paid ? copy.goodChoice : copy.tryAgain}</h1><p>{order.message}</p>
    {paid && order.pickupNumber !== null && <div className="pickup-card"><span>{copy.pickup}</span><strong>{order.pickupNumber}</strong><small>{copy.pickupHint}</small></div>}
    {paid && <>
      <p className="reference-note">{copy.reference} <strong>{order.publicReference.slice(0, 8).toUpperCase()}</strong></p>
      {receiptLines.length > 0 && <div className="receipt-card" id="print-receipt"><h2>{copy.receipt}</h2><ul>{receiptLines.map((line) => <li key={line.itemId}><span>{line.quantity} × {line.name}</span><strong>{formatMoney(line.lineTotalCents, currency, language)}</strong></li>)}</ul>
        <div className="receipt-row"><span>{copy.tax}</span><strong>{formatMoney(order.taxCents, currency, language)}</strong></div>
        <div className="receipt-row receipt-total"><span>{copy.totalIncluded}</span><strong>{formatMoney(order.totalCents, currency, language)}</strong></div>
        <div className="receipt-qr"><QRCodeSVG value={receiptQrValue} size={132} level="M" includeMargin title={copy.qrReceipt} /><span>{copy.qrReceipt}</span></div></div>}
      <button className="secondary-button print-button" onClick={() => window.print()}>{copy.print}</button>
      <p className="reset-countdown" role="status" aria-live="polite">{copy.resetIn(seconds)}</p>
    </>}
    {paid ? <button className="primary-button new-order-button" onClick={onNewOrder}>{copy.newOrder} <span aria-hidden="true">→</span></button> :
      <div className="decline-actions"><button className="primary-button new-order-button" onClick={onRetry}>{copy.retryPayment}</button><button className="secondary-button" onClick={onNewOrder}>{copy.newOrder}</button></div>}
  </section>
}

class ErrorBoundary extends Component<{ children: ReactNode; copy: Copy }, { hasError: boolean }> {
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

function categoryName(name: string, language: Language, copy: Copy): string {
  if (name === 'All') return copy.all
  if (language === 'pt-BR') return ({ Sandwiches: 'Sanduíches', Bowls: 'Tigelas', Drinks: 'Bebidas' } as Record<string, string>)[name] ?? name
  return name
}

function getMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong. Please try again.'
}
