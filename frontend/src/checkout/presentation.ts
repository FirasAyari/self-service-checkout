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

type MenuTextTranslation = { name: string; description: string; translatedName: string; translatedDescription: string }

const menuTextTranslations: Record<string, MenuTextTranslation> = {
  'turkey-melt': { name: 'Turkey melt', description: 'Roasted turkey, cheddar, tomato, and toasted sourdough.', translatedName: 'Sandu\u00edche de peru gratinado', translatedDescription: 'Peru assado, cheddar, tomate e p\u00e3o de fermenta\u00e7\u00e3o natural tostado.' },
  'garden-wrap': { name: 'Garden wrap', description: 'Hummus, cucumber, greens, and pickled onion.', translatedName: 'Wrap de legumes', translatedDescription: 'Homus, pepino, folhas verdes e cebola em conserva.' },
  'chicken-club': { name: 'Chicken club', description: 'Grilled chicken, crisp lettuce, and herb mayo.', translatedName: 'Sandu\u00edche club de frango', translatedDescription: 'Frango grelhado, alface crocante e maionese de ervas.' },
  'tomato-panini': { name: 'Tomato panini', description: 'Mozzarella, basil, and roasted tomato.', translatedName: 'Panini de tomate', translatedDescription: 'Mu\u00e7arela, manjeric\u00e3o e tomate assado.' },
  'grain-bowl': { name: 'Green grain bowl', description: 'Warm grains, avocado, greens, and lemon dressing.', translatedName: 'Tigela de gr\u00e3os verdes', translatedDescription: 'Gr\u00e3os quentes, abacate, folhas verdes e molho de lim\u00e3o.' },
  'chicken-bowl': { name: 'Chicken harvest bowl', description: 'Grilled chicken, brown rice, and seasonal vegetables.', translatedName: 'Tigela de frango com legumes da esta\u00e7\u00e3o', translatedDescription: 'Frango grelhado, arroz integral e legumes da esta\u00e7\u00e3o.' },
  'falafel-bowl': { name: 'Falafel bowl', description: 'Crisp falafel, hummus, cucumber, and tahini.', translatedName: 'Tigela de falafel', translatedDescription: 'Falafel crocante, homus, pepino e tahine.' },
  'soup-cup': { name: 'Soup of the day', description: 'A warm cup made fresh each morning.', translatedName: 'Sopa do dia', translatedDescription: 'Uma sopa quentinha, preparada todas as manh\u00e3s.' },
  'sparkling-water': { name: 'Sparkling water', description: 'Cold, lightly sparkling water.', translatedName: '\u00c1gua com g\u00e1s', translatedDescription: '\u00c1gua gelada com g\u00e1s suave.' },
  'iced-tea': { name: 'House iced tea', description: 'Unsweetened black tea with lemon.', translatedName: 'Ch\u00e1 gelado da casa', translatedDescription: 'Ch\u00e1 preto sem a\u00e7\u00facar com lim\u00e3o.' },
  'cold-brew': { name: 'Cold brew', description: 'Slow-steeped coffee, served over ice.', translatedName: 'Caf\u00e9 extra\u00eddo a frio', translatedDescription: 'Caf\u00e9 extra\u00eddo lentamente e servido com gelo.' },
  lemonade: { name: 'Fresh lemonade', description: 'Bright lemon with just enough sweetness.', translatedName: 'Limonada fresca', translatedDescription: 'Lim\u00e3o fresco com o toque certo de do\u00e7ura.' },
}

const optionNames: Record<string, string> = {
  small: 'Small',
  large: 'Large',
  'oat-milk': 'Oat milk',
  'extra-shot': 'Extra shot',
}

export function localizedMenuItemName(itemId: string, name: string, language: Language): string {
  if (language !== 'pt-BR') return name
  const translation = menuTextTranslations[itemId]
  return translation && name === translation.name ? translation.translatedName : name
}

export function localizedMenuDescription(itemId: string, description: string, language: Language): string {
  if (language !== 'pt-BR') return description
  const translation = menuTextTranslations[itemId]
  return translation && description === translation.description ? translation.translatedDescription : description
}

export function localizedConfiguredLineName(
  itemId: string,
  itemName: string,
  optionIds: string[],
  fallbackLineName: string,
  language: Language,
): string {
  if (language !== 'pt-BR') return fallbackLineName

  // Without stable option IDs, preserve the server's full snapshot instead of parsing display punctuation.
  if (optionIds.length === 0) {
    return fallbackLineName === itemName ? localizedMenuItemName(itemId, itemName, language) : fallbackLineName
  }

  const translatedOptions = optionIds.map((id) => {
    const optionName = optionNames[id]
    return optionName ? localizedOption(id, optionName, language) : undefined
  })
  if (translatedOptions.some((name) => name === undefined)) return fallbackLineName

  return `${localizedMenuItemName(itemId, itemName, language)} (${translatedOptions.join(', ')})`
}

export function categoryName(name: string, language: Language, copy: Copy): string {
  if (name === 'All') return copy.all
  if (language === 'pt-BR') return ({ Sandwiches: 'Sandu\u00edches', Bowls: 'Tigelas', Drinks: 'Bebidas' } as Record<string, string>)[name] ?? name
  return name
}
