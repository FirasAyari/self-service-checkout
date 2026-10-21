import type { MenuItem } from '../api'
import type { Copy, Language } from '../copy'

export const formatMoney = (cents: number, currency = 'USD', language: Language = 'en') =>
  new Intl.NumberFormat(language === 'pt-BR' ? 'pt-BR' : 'en-US', { style: 'currency', currency }).format(cents / 100)

export function selectedUnitPrice(item: MenuItem | undefined, optionIds: string[]): number {
  if (!item) return 0
  const selectedOptions = item.optionGroups.flatMap((group) => group.options.filter((option) => optionIds.includes(option.id)))
  return item.priceCents + selectedOptions.reduce((sum, option) => sum + option.additionalPriceCents, 0)
}

export function defaultOptionIds(item: MenuItem): string[] {
  return item.optionGroups.filter((group) => group.isRequired).flatMap((group) => group.options.slice(0, 1).map((option) => option.id))
}

export function withRequiredOptionDefaults(item: MenuItem, optionIds: string[]): string[] {
  const validIds = new Set(item.optionGroups.flatMap((group) => group.options.map((option) => option.id)))
  const next = [...new Set(optionIds.filter((id) => validIds.has(id)))]
  for (const group of item.optionGroups) {
    if (group.isRequired && !group.options.some((option) => next.includes(option.id)) && group.options[0]) next.push(group.options[0].id)
  }
  return next
}

export function localizedOptionGroup(id: string, name: string, language: Language): string {
  if (language !== 'pt-BR') return name
  return ({ size: 'Tamanho', extras: 'Adicionais' } as Record<string, string>)[id] ?? name
}

export function localizedOption(id: string, name: string, language: Language): string {
  if (language !== 'pt-BR') return name
  return ({ small: 'Pequeno', large: 'Grande', 'oat-milk': 'Leite de aveia', 'extra-shot': 'Dose extra' } as Record<string, string>)[id] ?? name
}

export function localizedMenuText(text: string, language: Language): string {
  if (language !== 'pt-BR') return text
  const menuTranslations: Record<string, string> = {
    'Turkey melt': 'Sanduíche de peru gratinado',
    'Roasted turkey, cheddar, tomato, and toasted sourdough.': 'Peru assado, cheddar, tomate e pão de fermentação natural tostado.',
    'Garden wrap': 'Wrap de legumes',
    'Hummus, cucumber, greens, and pickled onion.': 'Homus, pepino, folhas verdes e cebola em conserva.',
    'Chicken club': 'Sanduíche club de frango',
    'Grilled chicken, crisp lettuce, and herb mayo.': 'Frango grelhado, alface crocante e maionese de ervas.',
    'Tomato panini': 'Panini de tomate',
    'Mozzarella, basil, and roasted tomato.': 'Muçarela, manjericão e tomate assado.',
    'Green grain bowl': 'Tigela de grãos verdes',
    'Warm grains, avocado, greens, and lemon dressing.': 'Grãos quentes, abacate, folhas verdes e molho de limão.',
    'Chicken harvest bowl': 'Tigela de frango com legumes da estação',
    'Grilled chicken, brown rice, and seasonal vegetables.': 'Frango grelhado, arroz integral e legumes da estação.',
    'Falafel bowl': 'Tigela de falafel',
    'Crisp falafel, hummus, cucumber, and tahini.': 'Falafel crocante, homus, pepino e tahine.',
    'Soup of the day': 'Sopa do dia',
    'A warm cup made fresh each morning.': 'Uma sopa quentinha, preparada todas as manhãs.',
    'Sparkling water': 'Água com gás',
    'Cold, lightly sparkling water.': 'Água gelada com gás suave.',
    'House iced tea': 'Chá gelado da casa',
    'Unsweetened black tea with lemon.': 'Chá preto sem açúcar com limão.',
    'Cold brew': 'Café extraído a frio',
    'Slow-steeped coffee, served over ice.': 'Café extraído lentamente e servido com gelo.',
    'Fresh lemonade': 'Limonada fresca',
    'Bright lemon with just enough sweetness.': 'Limão fresco com o toque certo de doçura.',
  }
  const optionTranslations: Record<string, string> = {
    Small: 'Pequeno',
    Large: 'Grande',
    'Oat milk': 'Leite de aveia',
    'Extra shot': 'Dose extra',
  }

  const configuredLine = /^(.+?) \(([^()]*)\)$/.exec(text)
  if (!configuredLine) return menuTranslations[text] ?? text

  const [, itemName, selectedOptions] = configuredLine
  const translatedItemName = menuTranslations[itemName] ?? itemName
  const translatedOptions = selectedOptions.split(', ').map((option) => optionTranslations[option] ?? option)
  return `${translatedItemName} (${translatedOptions.join(', ')})`
}

export function categoryName(name: string, language: Language, copy: Copy): string {
  if (name === 'All') return copy.all
  if (language === 'pt-BR') return ({ Sandwiches: 'Sanduíches', Bowls: 'Tigelas', Drinks: 'Bebidas' } as Record<string, string>)[name] ?? name
  return name
}
