// Kansallisvaranto Oy on Just.Pay-laskujen laskuttava osapuoli
// (kevytyrittäjä-/tekijämalli, sama rakenne kuin Ukko.fi/Kassavirtanen —
// Kansallisvaranto laskuttaa, ei vain välitä laskua). Tämä vakio korvaa
// organisaation (tekijän) omat tiedot laskun laskuttaja-kentässä sekä
// laskun sähköpostin lähettäjänä. Tekijän oma nimi näkyy laskulla
// erillisenä "Työn suoritti" -rivinä, ks. jp_invoices.worker_name.
export const KANSALLISVARANTO = {
  name: 'Kansallisvaranto Oy',
  businessId: '3254818-5',
  address: 'Paljekuja 7, 21260 Raisio',
} as const
