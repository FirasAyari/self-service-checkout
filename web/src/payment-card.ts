export function formatCardNumber(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 19)
  return digits.match(/.{1,4}/g)?.join(' ') ?? ''
}

export function formatExpiry(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits
}

export function formatCvc(value: string): string {
  return value.replace(/\D/g, '').slice(0, 4)
}

export function isValidCardNumber(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 13 || digits.length > 19) return false

  let sum = 0
  let doubleDigit = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index])
    if (doubleDigit) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    doubleDigit = !doubleDigit
  }
  return sum % 10 === 0
}

export function isValidExpiry(value: string, now = new Date()): boolean {
  const match = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(value)
  if (!match) return false
  const expiryYear = 2000 + Number(match[2])
  return expiryYear > now.getFullYear() ||
    (expiryYear === now.getFullYear() && Number(match[1]) >= now.getMonth() + 1)
}

export function isValidCvc(value: string): boolean {
  return /^\d{3,4}$/.test(value)
}
