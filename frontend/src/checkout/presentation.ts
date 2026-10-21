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

export function categoryName(name: string, language: Language, copy: Copy): string {
  if (name === 'All') return copy.all
  if (language === 'pt-BR') return ({ Sandwiches: 'SanduÃ­ches', Bowls: 'Tigelas', Drinks: 'Bebidas' } as Record<string, string>)[name] ?? name
  return name
}
