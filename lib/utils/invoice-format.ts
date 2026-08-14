// Muotoiluapurit, joita käytetään sekä laskun näyttö-/tulostusnäkymässä
// (invoices/[id]/page.tsx), laskun sähköpostissa (api/invoices/[id]/
// send-email/route.ts), että Kansallisvarannon palvelumaksukuitissa
// (service-fee/[id]/page.tsx ja sen sähköpostireitti) — yksi
// toteutus kolmen sijaan.

export function formatDate(s: string) {
  return new Date(s).toLocaleDateString('fi-FI')
}

export function formatServiceDate(start: string | null, end: string | null) {
  if (!start) return null
  if (!end || end === start) return formatDate(start)
  return `${formatDate(start)} – ${formatDate(end)}`
}

export function formatCurrency(n: number, currency = 'EUR') {
  return new Intl.NumberFormat('fi-FI', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(n)
}
