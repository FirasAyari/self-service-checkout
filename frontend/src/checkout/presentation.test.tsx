import { describe, expect, it } from 'vitest'
import { messages } from '../copy'
import { categoryName, formatMoney, localizedMenuText } from './presentation'

describe('BR-M4 currency formatting', () => {
  it('uses integer cents and the selected deployment currency and locale', () => {
    expect(formatMoney(12_345, 'USD', 'en')).toBe('$123.45')
    expect(formatMoney(12_345, 'BRL', 'pt-BR')).toContain('R$')
    expect(formatMoney(12_345, 'BRL', 'pt-BR')).toContain('123,45')
  })
})

describe('BR-K8 category localization', () => {
  it('translates supported Portuguese categories and preserves unknown names', () => {
    const copy = messages['pt-BR']
    expect(categoryName('All', 'pt-BR', copy)).toBe('Todos')
    expect(categoryName('Sandwiches', 'pt-BR', copy)).toBe('Sanduíches')
    expect(categoryName('Bowls', 'pt-BR', copy)).toBe('Tigelas')
    expect(categoryName('Drinks', 'pt-BR', copy)).toBe('Bebidas')
    expect(categoryName('Seasonal', 'pt-BR', copy)).toBe('Seasonal')
    expect(categoryName('Sandwiches', 'en', messages.en)).toBe('Sandwiches')
  })

  it('localizes configured option names in server-priced order lines', () => {
    expect(localizedMenuText('Cold brew (Large, Oat milk)', 'pt-BR'))
      .toBe('Café extraído a frio (Grande, Leite de aveia)')
    expect(localizedMenuText('Cold brew (Small, Extra shot)', 'pt-BR'))
      .toBe('Café extraído a frio (Pequeno, Dose extra)')
    expect(localizedMenuText('Cold brew (Large, Oat milk)', 'en'))
      .toBe('Cold brew (Large, Oat milk)')
  })
})
