import { describe, expect, it } from 'vitest'
import { messages } from '../copy'
import { categoryName, formatMoney, localizedConfiguredLineName, localizedMenuDescription, localizedMenuItemName } from './presentation'

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

  it('localizes configured order lines from item and option IDs, not punctuation in display text', () => {
    expect(localizedConfiguredLineName(
      'cold-brew',
      'Cold brew',
      ['large', 'oat-milk'],
      'Cold brew (seasonal, "Large"), Oat milk',
      'pt-BR',
    )).toBe('Caf\u00e9 extra\u00eddo a frio (Grande, Leite de aveia)')
    expect(localizedConfiguredLineName(
      'cold-brew',
      'Cold brew, seasonal',
      ['small', 'extra-shot'],
      'Cold brew, seasonal (Small, Extra shot)',
      'pt-BR',
    )).toBe('Cold brew, seasonal (Pequeno, Dose extra)')
    expect(localizedConfiguredLineName(
      'cold-brew',
      'Cold brew',
      ['large', 'oat-milk'],
      'Cold brew (Large, Oat milk)',
      'en',
    )).toBe('Cold brew (Large, Oat milk)')
  })

  it('localizes seeded item text by stable ID while preserving Development edits and unknown items', () => {
    expect(localizedMenuItemName('cold-brew', 'Cold brew', 'pt-BR')).toBe('Caf\u00e9 extra\u00eddo a frio')
    expect(localizedMenuItemName('cold-brew', 'Seasonal cold brew', 'pt-BR')).toBe('Seasonal cold brew')
    expect(localizedMenuDescription('cold-brew', 'Slow-steeped coffee, served over ice.', 'pt-BR'))
      .toBe('Caf\u00e9 extra\u00eddo lentamente e servido com gelo.')
    expect(localizedMenuDescription('custom-item', 'A changing Development description.', 'pt-BR'))
      .toBe('A changing Development description.')
  })
})
