import { describe, expect, it } from 'vitest'
import { formatMoney } from './presentation'

describe('BR-M4 currency formatting', () => {
  it('uses integer cents and the selected deployment currency and locale', () => {
    expect(formatMoney(12_345, 'USD', 'en')).toBe('$123.45')
    expect(formatMoney(12_345, 'BRL', 'pt-BR')).toContain('R$')
    expect(formatMoney(12_345, 'BRL', 'pt-BR')).toContain('123,45')
  })
})
