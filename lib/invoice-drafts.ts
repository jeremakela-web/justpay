// Jaettu vakio app/api/invoices/extract/route.ts:n (palvelin) ja
// draft-tarkistusnäkymän (asiakas) välillä. Ei saa tuoda vakiota
// suoraan route.ts:stä clientiin — se vetäisi mukaan @anthropic-ai/sdk:n
// ja muun palvelinkoodin selainkimppuun (type-only importit ovat
// turvallisia, arvot eivät).
export const LOW_CONFIDENCE_THRESHOLD = 85
