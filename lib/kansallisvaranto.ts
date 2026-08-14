// Kansallisvaranto Oy on Just.Pay-laskujen laskuttava osapuoli
// (kevytyrittäjä-/tekijämalli, sama rakenne kuin Ukko.fi/Kassavirtanen —
// Kansallisvaranto laskuttaa, ei vain välitä laskua). Tämä vakio korvaa
// organisaation (tekijän) omat tiedot laskun laskuttaja-kentässä sekä
// laskun sähköpostin lähettäjänä. Tekijän oma nimi näkyy laskulla
// erillisenä "Työn suoritti" -rivinä, ks. jp_invoices.worker_name.
//
// TODO ennen pilottiasiakkaan laskutuksen käynnistämistä:
// `address` on paikkamerkki. Päivitä oikea rekisteröity osoite tähän
// ennen kuin laskuja lähetetään oikealle maksavalle asiakkaalle.
export const KANSALLISVARANTO = {
  name: 'Kansallisvaranto Oy',
  businessId: '3254818-5',
  address: 'OSOITE PUUTTUU — TODO ennen pilottiasiakasta', // TODO: real registered address
} as const
