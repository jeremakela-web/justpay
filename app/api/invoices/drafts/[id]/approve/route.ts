import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateInvoiceNumber } from '@/lib/utils/invoice-number'
import { generateFinnishReferenceNumber } from '@/lib/utils/reference-number'

interface ApproveLine {
  description: string
  quantity: number
  unit_price: number
  vat_rate: number
  service_date?: string | null
}

interface ApproveBody {
  customer_id: string
  worker_name: string
  worker_name_note?: string | null
  issue_date: string
  due_date: string
  service_date_start: string
  service_date_end: string
  notes?: string | null
  lines: ApproveLine[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: draftId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Ei oikeuksia' }, { status: 401 })
  }

  const { data: org, error: orgErr } = await supabase
    .from('jp_organizations')
    .select('id, name, currency')
    .eq('owner_user_id', user.id)
    .maybeSingle()

  if (orgErr || !org) {
    return NextResponse.json({ error: 'Organisaatiota ei löydy.' }, { status: 400 })
  }

  const { data: draft, error: draftErr } = await supabase
    .from('jp_invoice_drafts')
    .select('id, status, resulting_invoice_id')
    .eq('id', draftId)
    .eq('org_id', org.id)
    .maybeSingle()

  if (draftErr || !draft) {
    return NextResponse.json({ error: 'Draftia ei löydy.' }, { status: 404 })
  }

  // Idempotentti: jos joku klikkaa hyväksyä kahdesti (esim. hidas
  // yhteys), palautetaan sama lasku uudelleen sen sijaan että
  // yritettäisiin luoda toinen.
  if (draft.status === 'approved' && draft.resulting_invoice_id) {
    return NextResponse.json({ invoice_id: draft.resulting_invoice_id })
  }

  if (draft.status !== 'ready_for_review') {
    return NextResponse.json(
      { error: `Draft ei ole tarkistettavissa (tila: ${draft.status}).` },
      { status: 400 }
    )
  }

  let body: ApproveBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Virheellinen pyyntö' }, { status: 400 })
  }

  if (!body.customer_id) {
    return NextResponse.json({ error: 'Valitse asiakas.' }, { status: 400 })
  }
  if (!body.worker_name?.trim()) {
    return NextResponse.json({ error: 'Merkitse kuka teki työn (tekijä).' }, { status: 400 })
  }
  if (body.worker_name.trim() !== org.name.trim() && !body.worker_name_note?.trim()) {
    return NextResponse.json({ error: 'Kerro miksi tekijä eroaa omasta nimestäsi.' }, { status: 400 })
  }
  if (!body.service_date_start || !body.service_date_end) {
    return NextResponse.json({ error: 'Merkitse työn suorituspäivä(t).' }, { status: 400 })
  }
  if (body.service_date_end < body.service_date_start) {
    return NextResponse.json(
      { error: 'Työn päättymispäivä ei voi olla ennen alkamispäivää.' },
      { status: 400 }
    )
  }

  const validLines = (body.lines ?? []).filter(
    (l) => l.description?.trim() && l.quantity > 0 && l.unit_price > 0
  )
  if (validLines.length === 0) {
    return NextResponse.json(
      { error: 'Lisää vähintään yksi laskurivi kuvauksen ja hinnan kera.' },
      { status: 400 }
    )
  }

  // Rivin summa lasketaan aina täällä palvelimella hyväksynnän
  // yhteydessä, riippumatta siitä mitä extracted_data sisälsi — käyttäjä
  // on voinut muokata rivejä tarkistusnäkymässä ennen hyväksyntää.
  const computedLines = validLines.map((l) => {
    const lineTotal = round2(l.quantity * l.unit_price)
    const vatAmount = round2(lineTotal * (l.vat_rate / 100))
    return { ...l, line_total: lineTotal, vat_amount: vatAmount }
  })
  const subtotal = round2(computedLines.reduce((s, l) => s + l.line_total, 0))
  const vatTotal = round2(computedLines.reduce((s, l) => s + l.vat_amount, 0))
  const totalAmount = round2(subtotal + vatTotal)

  const MAX_ATTEMPTS = 3
  let lastErr: unknown = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const invNumber = await generateInvoiceNumber(supabase, org.id)
      const refNumber = generateFinnishReferenceNumber(invNumber.replace('-', ''))

      const { data: invoice, error: invErr } = await supabase
        .from('jp_invoices')
        .insert({
          org_id: org.id,
          customer_id: body.customer_id,
          invoice_number: invNumber,
          reference_number: refNumber,
          issue_date: body.issue_date,
          due_date: body.due_date,
          worker_name: body.worker_name.trim(),
          worker_name_note: body.worker_name_note?.trim() || null,
          service_date_start: body.service_date_start,
          service_date_end: body.service_date_end,
          status: 'draft',
          subtotal,
          vat_total: vatTotal,
          total_amount: totalAmount,
          currency: org.currency,
          notes: body.notes?.trim() || null,
        })
        .select()
        .single()

      if (invErr) {
        if (invErr.code === '23505' && attempt < MAX_ATTEMPTS) {
          lastErr = invErr
          continue
        }
        throw invErr
      }

      const { error: linesErr } = await supabase.from('jp_invoice_lines').insert(
        computedLines.map((l, i) => ({
          invoice_id: invoice.id,
          description: l.description.trim(),
          quantity: l.quantity,
          unit_price: l.unit_price,
          vat_rate: l.vat_rate,
          vat_amount: l.vat_amount,
          line_total: l.line_total,
          sort_order: i,
          service_date: l.service_date || null,
        }))
      )

      if (linesErr) throw linesErr

      await supabase
        .from('jp_invoice_drafts')
        .update({
          status: 'approved',
          reviewed_at: new Date().toISOString(),
          resulting_invoice_id: invoice.id,
        })
        .eq('id', draftId)

      return NextResponse.json({ invoice_id: invoice.id })
    } catch (err: unknown) {
      lastErr = err
      const code = (err as { code?: string } | null)?.code
      if (code !== '23505') break
    }
  }

  console.error('Draft approve failed:', lastErr)
  return NextResponse.json(
    {
      error:
        lastErr instanceof Error
          ? lastErr.message
          : 'Tallennusvirhe. Yritä uudelleen.',
    },
    { status: 500 }
  )
}
