import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import type {
  ExtractedDraftData,
  ExtractedDraftLine,
  InvoiceDraft,
  InvoiceDraftFieldConfidence,
  InvoiceDraftValidationFlags,
} from '@/types/database'

// Kept for the review page's confidence-threshold display and any
// remaining caller that still imports the pre-draft-pipeline shape.
export interface ExtractedLine {
  description: string
  quantity: number
  unit_price: number
  vat_rate: number
}

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number]

function isAllowedMediaType(v: string): v is AllowedMediaType {
  return (ALLOWED_MEDIA_TYPES as readonly string[]).includes(v)
}

// Ei virallista vaatimusta, mutta Claude vision -kutsu ja Storage-lataus
// molemmat kannattaa rajata järkevään kokoon ennen kuin niitä edes
// yritetään — 15 Mt kattaa reilusti puhelinkameran kuvan.
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024

// Poikkeuksellisen summan kynnysarvot verrattuna organisaation
// viimeaikaisten laskujen keskiarvoon. Ei lippua, jos vertailuun ei
// ole riittävästi historiaa (MIN_INVOICES_FOR_AMOUNT_CHECK) — muuten
// jokainen uuden organisaation ensimmäinen lasku näyttäisi poikkeavalta.
const MIN_INVOICES_FOR_AMOUNT_CHECK = 3
const UNUSUAL_AMOUNT_HIGH_MULTIPLIER = 2.5
const UNUSUAL_AMOUNT_LOW_MULTIPLIER = 0.2

// Kuvauksen "tunnistettavuus" aiempaan historiaan verrattuna on
// heuristiikka, ei luokittelija: pilkotaan sanoiksi (≥4 merkkiä, jotta
// yleiset pikkusanat eivät tuota vääriä osumia) ja katsotaan onko
// yhtään yhteistä sanaa. Ei lippua ilman riittävää historiaa.
const MIN_LINES_FOR_PATTERN_CHECK = 5
const PATTERN_WORD_MIN_LENGTH = 4

function normalizeWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= PATTERN_WORD_MIN_LENGTH)
  )
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export async function POST(request: NextRequest): Promise<NextResponse<{ draft: InvoiceDraft } | { error: string }>> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Ei oikeuksia' }, { status: 401 })
  }

  const { data: org, error: orgErr } = await supabase
    .from('jp_organizations')
    .select('id')
    .eq('owner_user_id', user.id)
    .maybeSingle()

  if (orgErr || !org) {
    return NextResponse.json(
      { error: 'Organisaatiota ei löydy. Täytä ensin yrityksesi tiedot.' },
      { status: 400 }
    )
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Virheellinen pyyntö' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File) || !isAllowedMediaType(file.type)) {
    return NextResponse.json({ error: 'Virheellinen kuva tai tiedostomuoto' }, { status: 400 })
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: 'Kuva on liian suuri (max 15 Mt)' }, { status: 400 })
  }

  const mediaType = file.type as AllowedMediaType
  const buffer = Buffer.from(await file.arrayBuffer())
  const contentHash = crypto.createHash('sha256').update(buffer).digest('hex')

  // Duplikaattivaroitus — lippu, ei esto (ks. migration_011:n kommentti).
  const { data: dupeDraft } = await supabase
    .from('jp_invoice_drafts')
    .select('id')
    .eq('org_id', org.id)
    .eq('content_hash', contentHash)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const draftId = crypto.randomUUID()
  const storagePath = `${org.id}/${draftId}/${file.name || 'kuva'}`

  const { error: uploadErr } = await supabase.storage
    .from('invoice-draft-sources')
    .upload(storagePath, buffer, { contentType: mediaType, upsert: false })

  if (uploadErr) {
    console.error('Invoice draft source upload failed:', uploadErr)
    return NextResponse.json({ error: 'Kuvan tallennus epäonnistui. Yritä uudelleen.' }, { status: 502 })
  }

  const initialFlags: InvoiceDraftValidationFlags = dupeDraft ? { duplicate_of_draft_id: dupeDraft.id } : {}

  const { data: insertedDraft, error: insertErr } = await supabase
    .from('jp_invoice_drafts')
    .insert({
      id: draftId,
      org_id: org.id,
      status: 'uploaded',
      source_file_path: storagePath,
      source_file_name: file.name || 'kuva',
      source_content_type: mediaType,
      content_hash: contentHash,
      validation_flags: initialFlags,
    })
    .select()
    .single<InvoiceDraft>()

  if (insertErr || !insertedDraft) {
    console.error('Invoice draft row insert failed:', insertErr)
    // Kuva on jo Storagessa mutta rivi puuttuu — ei yritetä siivota
    // Storagea täältä (RLS/omistus jo varmistettu latauksessa asti),
    // vain kerrotaan virhe. Ohjaimeton tiedosto ei vuoda mitään, se
    // vain roikkuu käyttämättömänä kunnes joku siivoaa.
    return NextResponse.json({ error: 'Poiminnan valmistelu epäonnistui. Yritä uudelleen.' }, { status: 502 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    await supabase
      .from('jp_invoice_drafts')
      .update({ status: 'failed', error_message: 'AI-poisto ei ole käytössä' })
      .eq('id', draftId)
    return NextResponse.json({ error: 'AI-poisto ei ole käytössä' }, { status: 503 })
  }

  const MODEL = 'claude-sonnet-5'

  await supabase
    .from('jp_invoice_drafts')
    .update({ status: 'processing', llm_provider: 'anthropic', llm_model: MODEL })
    .eq('id', draftId)

  try {
    const client = new Anthropic({ apiKey })

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') },
            },
            {
              type: 'text',
              text: `Olet laskurivien poimija. Analysoi kuva (kuitti, hinnasto, tuntilomake tai muu taloushallintodokumentti) ja tunnista laskurivit.

Palauta VAIN seuraava JSON ilman selityksiä tai muuta tekstiä:
{
  "lines": [
    {
      "description": "...",
      "quantity": 1,
      "unit_price": 0.00,
      "vat_rate": 0,
      "service_date": "2026-01-15",
      "confidence": 90
    }
  ],
  "customer_suggestion": "...",
  "worker_suggestion": "..."
}

Säännöt:
- description: lyhyt kuvaus suomeksi tai alkuperäiskielellä (max 80 merkkiä)
- quantity: numero (esim. 2 tai 1.5), oletus 1 jos ei selvä
- unit_price: yksikköhinta ilman ALV:a, desimaalipiste (esim. 49.90) — ÄLÄ laske rivin loppusummaa, pelkkä yksikköhinta riittää
- vat_rate: ALV-prosentti numerona (0, 10, 13.5 tai 25.5), oletus 25.5 jos ei selvä
- service_date: päivämäärä ISO-muodossa (VVVV-KK-PP) jos kuvassa näkyy tälle riville oma päivämäärä (esim. tuntilappu jolla eri päivät omilla riveillään), muuten null — ÄLÄ arvaa tämänpäiväistä jos mitään päivämäärää ei näy
- confidence: oma arviosi 0-100 siitä kuinka varmasti luit TÄMÄN rivin oikein kokonaisuutena (huono kuvanlaatu, epäselvä käsiala tms. = matala luku)
- customer_suggestion: asiakkaan/yrityksen nimi jos se näkyy kuvassa (esim. kuitin yläreunassa), muuten null
- worker_suggestion: työn tekijän nimi jos se näkyy kuvassa (esim. tuntilapun allekirjoitus), muuten null
- Jos kuvassa ei ole tunnistettavia laskurivejä, palauta: {"lines":[],"customer_suggestion":null,"worker_suggestion":null}
- Älä keksi tietoja — kirjaa vain mitä kuvassa selvästi näkyy`,
            },
          ],
        },
      ],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('Mallin vastauksesta ei löytynyt JSONia')
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      lines?: Array<{
        description?: string
        quantity?: number
        unit_price?: number
        vat_rate?: number
        service_date?: string | null
        confidence?: number
      }>
      customer_suggestion?: string | null
      worker_suggestion?: string | null
    }

    const rawLines = parsed.lines ?? []

    // Rivin summa lasketaan aina täällä, ei koskaan pyydetä mallilta —
    // sekä koska laskutoimitus on triviaali sovelluskoodille että jotta
    // poikkeamatarkistus (alla) vertaa aina samalla tavalla laskettuja
    // lukuja riippumatta siitä mitä malli mahdollisesti väitti.
    const lines: ExtractedDraftLine[] = rawLines.map((l) => ({
      description: (l.description ?? '').trim().slice(0, 200),
      quantity: typeof l.quantity === 'number' && l.quantity > 0 ? l.quantity : 1,
      unit_price: typeof l.unit_price === 'number' && l.unit_price >= 0 ? l.unit_price : 0,
      vat_rate: typeof l.vat_rate === 'number' ? l.vat_rate : 25.5,
      service_date: typeof l.service_date === 'string' && l.service_date ? l.service_date : null,
      confidence:
        typeof l.confidence === 'number' && l.confidence >= 0 && l.confidence <= 100
          ? Math.round(l.confidence)
          : 0, // ei ilmoitettu / virheellinen arvo -> kohdellaan matalimpana mahdollisena, ei ohiteta hiljaa
    }))

    let computedSubtotal = 0
    let computedVatTotal = 0
    for (const l of lines) {
      const lineTotal = round2(l.quantity * l.unit_price)
      computedSubtotal += lineTotal
      computedVatTotal += round2(lineTotal * (l.vat_rate / 100))
    }
    computedSubtotal = round2(computedSubtotal)
    computedVatTotal = round2(computedVatTotal)
    const computedTotal = round2(computedSubtotal + computedVatTotal)

    const extractedData: ExtractedDraftData = {
      lines,
      customer_suggestion: parsed.customer_suggestion?.trim() || null,
      worker_suggestion: parsed.worker_suggestion?.trim() || null,
      computed_subtotal: computedSubtotal,
      computed_vat_total: computedVatTotal,
      computed_total: computedTotal,
    }

    const fieldConfidence: InvoiceDraftFieldConfidence = {
      lines: lines.map((l, index) => ({ index, confidence: l.confidence })),
    }

    const validationFlags = await computeValidationFlags(supabase, org.id, extractedData, initialFlags)

    const { data: finalDraft, error: finalErr } = await supabase
      .from('jp_invoice_drafts')
      .update({
        status: 'ready_for_review',
        extracted_data: extractedData,
        field_confidence: fieldConfidence,
        validation_flags: validationFlags,
      })
      .eq('id', draftId)
      .select()
      .single<InvoiceDraft>()

    if (finalErr || !finalDraft) throw finalErr ?? new Error('Draftin päivitys epäonnistui')

    return NextResponse.json({ draft: finalDraft })
  } catch (err) {
    console.error('Invoice draft extraction failed:', err)
    const message = err instanceof Error ? err.message : 'tarkista rivit manuaalisesti'
    const { data: failedDraft } = await supabase
      .from('jp_invoice_drafts')
      .update({ status: 'failed', error_message: message })
      .eq('id', draftId)
      .select()
      .single<InvoiceDraft>()

    if (failedDraft) {
      // Palautetaan draft (status='failed') eikä paljasta virhettä —
      // käyttäjä näkee sen draft-listassa eikä se katoa hiljaa.
      return NextResponse.json({ draft: failedDraft }, { status: 200 })
    }
    return NextResponse.json({ error: 'Poiminta epäonnistui. Yritä uudelleen.' }, { status: 502 })
  }
}

async function computeValidationFlags(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  data: ExtractedDraftData,
  carriedFlags: InvoiceDraftValidationFlags
): Promise<InvoiceDraftValidationFlags> {
  const flags: InvoiceDraftValidationFlags = { ...carriedFlags }

  // new_customer: onko customer_suggestion lähelläkään mitään olemassa
  // olevaa asiakasta tässä organisaatiossa.
  if (data.customer_suggestion) {
    const { data: customers } = await supabase
      .from('jp_customers')
      .select('name')
      .eq('org_id', orgId)
    const suggestion = data.customer_suggestion.toLowerCase()
    const hasMatch = (customers ?? []).some((c) => {
      const name = (c.name as string).toLowerCase()
      return name.includes(suggestion) || suggestion.includes(name)
    })
    if (!hasMatch) flags.new_customer = true
  }

  // unusual_amount: computed_total vs. organisaation viimeaikaisten
  // laskujen keskiarvo.
  const { data: recentInvoices } = await supabase
    .from('jp_invoices')
    .select('total_amount')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (recentInvoices && recentInvoices.length >= MIN_INVOICES_FOR_AMOUNT_CHECK) {
    const mean =
      recentInvoices.reduce((s, i) => s + (i.total_amount as number), 0) / recentInvoices.length
    if (
      mean > 0 &&
      (data.computed_total > mean * UNUSUAL_AMOUNT_HIGH_MULTIPLIER ||
        data.computed_total < mean * UNUSUAL_AMOUNT_LOW_MULTIPLIER)
    ) {
      flags.unusual_amount = true
    }
  }

  // out_of_pattern_lines: sanaosumaton kuvaus verrattuna organisaation
  // aiempiin laskuriveihin.
  const { data: recentLines } = await supabase
    .from('jp_invoice_lines')
    .select('description, jp_invoices!inner(org_id)')
    .eq('jp_invoices.org_id', orgId)
    .limit(200)

  if (recentLines && recentLines.length >= MIN_LINES_FOR_PATTERN_CHECK) {
    const historyWords = new Set<string>()
    for (const row of recentLines) {
      for (const w of normalizeWords((row as { description: string }).description)) {
        historyWords.add(w)
      }
    }
    const outOfPattern: number[] = []
    data.lines.forEach((line, index) => {
      const words = normalizeWords(line.description)
      const overlaps = [...words].some((w) => historyWords.has(w))
      if (words.size > 0 && !overlaps) outOfPattern.push(index)
    })
    if (outOfPattern.length > 0) flags.out_of_pattern_lines = outOfPattern
  }

  return flags
}
