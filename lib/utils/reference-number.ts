/**
 * Finnish bank reference number (viitenumero) algorithm.
 * Weights 7, 3, 1 cycle from right to left.
 * Check digit = (10 - (sum mod 10)) mod 10
 */
export function generateFinnishReferenceNumber(base: string): string {
  const digits = base.replace(/\D/g, '')
  const weights = [7, 3, 1]
  let sum = 0

  for (let i = 0; i < digits.length; i++) {
    const digit = parseInt(digits[digits.length - 1 - i])
    sum += digit * weights[i % 3]
  }

  const checkDigit = (10 - (sum % 10)) % 10
  return digits + checkDigit
}

/**
 * Format reference number with spaces (groups of 5 from right).
 * E.g. "202600017" → "2026 00017"
 */
export function formatReferenceNumber(refNum: string): string {
  const reversed = refNum.split('').reverse().join('')
  const groups = reversed.match(/.{1,5}/g) || []
  return groups
    .map((g) => g.split('').reverse().join(''))
    .reverse()
    .join(' ')
}
