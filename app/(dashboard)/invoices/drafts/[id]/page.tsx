'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Customer, Organization, InvoiceDraft, ExtractedDraftLine } from '@/types/database'
import { ArrowLeft, AlertTriangle, ExternalLink, Check, X as XIcon } from 'lucide-react'
import { LOW_CONFIDENCE_THRESHOLD } from '@/lib/invoice-drafts'

const INPUT =
  'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500'

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function futureDateStr(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

export default function DraftReviewPage() {
  const params = useParams()
  const id = params?.id as string
  const router = useRouter()
  const supabase = createClient()

  const [org, setOrg] = useState<Organization | null>(null)
  const [draft, setDraft] = useState<InvoiceDraft | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [lines, setLines] = useState<ExtractedDraftLine[]>([])
  const [customerId, setCustomerId] = useState('')
  const [workerName, setWorkerName] = useState('')
  const [workerNameNote, setWorkerNameNote] = useState('')
  const [issueDate, setIssueDate] = useState(todayStr())
  const [dueDate, setDueDate] = useState(futureDateStr(14))
  const [serviceDateStart, setServiceDateStart] = useState(todayStr())
  const [serviceDateEnd, setServiceDateEnd] = useState(todayStr())

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    const { data: orgData } = await supabase
      .from('jp_organizations')
      .select('*')
      .eq('owner_user_id', user.id)
      .maybeSingle()
    if (!orgData) {
      router.push('/onboarding')
      return
    }
    setOrg(orgData)
    setWorkerName((prev) => prev || orgData.name)

    const { data: custData } = await supabase
      .from('jp_customers')
      .select('*')
      .eq('org_id', orgData.id)
      .order('name')
    setCustomers(custData || [])

    const { data: draftData } = await supabase
      .from('jp_invoice_drafts')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgData.id)
      .maybeSingle<InvoiceDraft>()

    if (!draftData) {
      setError('Draftia ei löydy.')
      setLoading(false)
      return
    }
    setDraft(draftData)

    if (draftData.extracted_data && lines.length === 0) {
      setLines(draftData.extracted_data.lines)
      const serviceDates = draftData.extracted_data.lines
        .map((l) => l.service_date)
        .filter((d): d is string => !!d)
        .sort()
      if (serviceDates.length > 0) {
        setServiceDateStart(serviceDates[0])
        setServiceDateEnd(serviceDates[serviceDates.length - 1])
      }
      if (draftData.extracted_data.worker_suggestion) {
        setWorkerName(draftData.extracted_data.worker_suggestion)
      }
      if (draftData.extracted_data.customer_suggestion) {
        const suggestion = draftData.extracted_data.customer_suggestion.toLowerCase()
        const match = (custData || []).find((c) => {
          const name = c.name.toLowerCase()
          return name.includes(suggestion) || suggestion.includes(name)
        })
        if (match) setCustomerId(match.id)
      }
    }

    if (draftData.source_file_path) {
      const { data: signed } = await supabase.storage
        .from('invoice-draft-sources')
        .createSignedUrl(draftData.source_file_path, 3600)
      setImageUrl(signed?.signedUrl ?? null)
    }

    setLoading(false)
    // Draft pysyy 'processing'-tilassa vain hetken (sama pyyntö tekee
    // koko putken), mutta jos jää jumiin, käyttäjä voi päivittää sivun
    // manuaalisesti nähdäkseen onko se edennyt.
  }, [id, router, supabase]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const updateLine = (index: number, field: keyof ExtractedDraftLine, value: string) => {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l
        if (field === 'quantity' || field === 'unit_price' || field === 'vat_rate') {
          return { ...l, [field]: parseFloat(value) || 0 }
        }
        return { ...l, [field]: value }
      })
    )
  }

  const removeLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index))
  }

  const computed = lines.map((l) => {
    const lineTotal = Math.round(l.quantity * l.unit_price * 100) / 100
    const vatAmount = Math.round(lineTotal * (l.vat_rate / 100) * 100) / 100
    return { ...l, lineTotal, vatAmount }
  })
  const subtotal = computed.reduce((s, l) => s + l.lineTotal, 0)
  const vatTotal = computed.reduce((s, l) => s + l.vatAmount, 0)
  const totalAmount = subtotal + vatTotal

  const fmt = (n: number) =>
    new Intl.NumberFormat('fi-FI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

  const handleApprove = async () => {
    if (!customerId) {
      setError('Valitse asiakas.')
      return
    }
    setApproving(true)
    setError(null)
    try {
      const res = await fetch(`/api/invoices/drafts/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          worker_name: workerName,
          worker_name_note: workerNameNote,
          issue_date: issueDate,
          due_date: dueDate,
          service_date_start: serviceDateStart,
          service_date_end: serviceDateEnd,
          lines,
        }),
      })
      const data = (await res.json()) as { invoice_id?: string; error?: string }
      if (!res.ok || data.error || !data.invoice_id) {
        setError(data.error ?? 'Hyväksyntä epäonnistui.')
        setApproving(false)
        return
      }
      router.push(`/invoices/${data.invoice_id}`)
    } catch {
      setError('Hyväksyntä epäonnistui. Yritä uudelleen.')
      setApproving(false)
    }
  }

  const handleReject = async () => {
    setRejecting(true)
    setError(null)
    try {
      const res = await fetch(`/api/invoices/drafts/${id}/reject`, { method: 'POST' })
      const data = (await res.json()) as { success?: boolean; error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? 'Hylkäys epäonnistui.')
        setRejecting(false)
        return
      }
      router.push('/invoices/drafts')
    } catch {
      setError('Hylkäys epäonnistui. Yritä uudelleen.')
      setRejecting(false)
    }
  }

  if (loading || !org) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!draft) {
    return <div className="max-w-2xl mx-auto text-sm text-red-400">{error ?? 'Draftia ei löydy.'}</div>
  }

  if (draft.status === 'uploaded' || draft.status === 'processing') {
    return (
      <div className="max-w-2xl mx-auto text-center py-24">
        <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-zinc-400">
          Luetaan kuvaa... Jos tämä jää roikkumaan pitkäksi aikaa, päivitä sivu.
        </p>
      </div>
    )
  }

  if (draft.status === 'failed') {
    return (
      <div className="max-w-2xl mx-auto">
        <Link href="/invoices/drafts" className="text-zinc-400 hover:text-white text-sm flex items-center gap-2 mb-6">
          <ArrowLeft size={16} /> Takaisin
        </Link>
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">
          Poiminta epäonnistui: {draft.error_message ?? 'tuntematon virhe'}
        </div>
      </div>
    )
  }

  if (draft.status === 'approved') {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <p className="text-sm text-zinc-400 mb-4">Tämä draft on jo hyväksytty.</p>
        {draft.resulting_invoice_id && (
          <Link href={`/invoices/${draft.resulting_invoice_id}`} className="text-green-400 hover:underline text-sm">
            Avaa lasku →
          </Link>
        )}
      </div>
    )
  }

  if (draft.status === 'rejected') {
    return (
      <div className="max-w-2xl mx-auto text-center py-16 text-sm text-zinc-500">
        Tämä draft on hylätty.
      </div>
    )
  }

  const flags = draft.validation_flags
  const outOfPatternSet = new Set(flags?.out_of_pattern_lines ?? [])

  return (
    <div className="max-w-4xl mx-auto pb-24">
      <Link href="/invoices/drafts" className="text-zinc-400 hover:text-white text-sm flex items-center gap-2 mb-6">
        <ArrowLeft size={16} /> Takaisin
      </Link>

      <h1 className="text-xl font-semibold mb-4">Tarkista poimitut rivit</h1>

      {(flags?.new_customer || flags?.unusual_amount || flags?.duplicate_of_draft_id) && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 mb-4 space-y-1.5">
          {flags?.new_customer && (
            <p className="text-xs text-amber-400 flex items-center gap-2">
              <AlertTriangle size={13} /> Ehdotettu asiakas ei täsmää mihinkään olemassa olevaan — tarkista tai
              luo uusi asiakas ensin.
            </p>
          )}
          {flags?.unusual_amount && (
            <p className="text-xs text-amber-400 flex items-center gap-2">
              <AlertTriangle size={13} /> Summa poikkeaa selvästi aiempien laskujesi keskiarvosta.
            </p>
          )}
          {flags?.duplicate_of_draft_id && (
            <p className="text-xs text-amber-400 flex items-center gap-2">
              <AlertTriangle size={13} />
              Samansisältöinen kuva on ladattu aiemmin —{' '}
              <Link href={`/invoices/drafts/${flags.duplicate_of_draft_id}`} className="underline">
                katso aiempi draft
              </Link>
              . Ei estetty, tarkista onko tämä tahaton kaksoiskappale.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {imageUrl && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="Alkuperäinen kuva" className="w-full rounded-lg" />
          </div>
        )}

        <div className="space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Asiakas</label>
              <div className="flex gap-2">
                <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={INPUT}>
                  <option value="">Valitse asiakas...</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Link
                  href="/customers/new"
                  target="_blank"
                  className="shrink-0 flex items-center gap-1 text-xs text-zinc-400 hover:text-white border border-zinc-700 rounded-lg px-3"
                >
                  Uusi <ExternalLink size={12} />
                </Link>
              </div>
              {draft.extracted_data?.customer_suggestion && (
                <p className="text-xs text-zinc-500 mt-1">
                  Kuvasta luettu: {draft.extracted_data.customer_suggestion}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Tekijä</label>
              <input
                type="text"
                value={workerName}
                onChange={(e) => setWorkerName(e.target.value)}
                className={INPUT}
              />
            </div>
            {workerName.trim() !== org.name.trim() && (
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Miksi tekijä eroaa omasta nimestäsi?</label>
                <input
                  type="text"
                  value={workerNameNote}
                  onChange={(e) => setWorkerNameNote(e.target.value)}
                  className={INPUT}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Laskun päivä</label>
                <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={INPUT} />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Eräpäivä</label>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={INPUT} />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Työ alkoi</label>
                <input
                  type="date"
                  value={serviceDateStart}
                  onChange={(e) => setServiceDateStart(e.target.value)}
                  className={INPUT}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Työ päättyi</label>
                <input
                  type="date"
                  value={serviceDateEnd}
                  onChange={(e) => setServiceDateEnd(e.target.value)}
                  className={INPUT}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mt-6">
        <h2 className="text-sm font-semibold mb-3">Laskurivit</h2>
        <div className="space-y-3">
          {lines.map((line, i) => {
            const lowConfidence = line.confidence < LOW_CONFIDENCE_THRESHOLD
            const outOfPattern = outOfPatternSet.has(i)
            return (
              <div
                key={i}
                className={`border rounded-lg p-3 space-y-2 ${
                  lowConfidence || outOfPattern ? 'border-amber-500/40 bg-amber-500/5' : 'border-zinc-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className={`px-2 py-0.5 rounded-full font-medium ${
                        lowConfidence ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      Varmuus {line.confidence}%
                    </span>
                    {outOfPattern && (
                      <span className="px-2 py-0.5 rounded-full font-medium bg-amber-500/20 text-amber-400">
                        Poikkeava kuvaus
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => removeLine(i)}
                    className="text-zinc-500 hover:text-red-400"
                    type="button"
                    aria-label="Poista rivi"
                  >
                    <XIcon size={14} />
                  </button>
                </div>
                <input
                  type="text"
                  value={line.description}
                  onChange={(e) => updateLine(i, 'description', e.target.value)}
                  className={INPUT}
                  placeholder="Kuvaus"
                />
                <div className="grid grid-cols-4 gap-2">
                  <input
                    type="number"
                    step="0.01"
                    value={line.quantity}
                    onChange={(e) => updateLine(i, 'quantity', e.target.value)}
                    className={INPUT}
                    placeholder="Määrä"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={line.unit_price}
                    onChange={(e) => updateLine(i, 'unit_price', e.target.value)}
                    className={INPUT}
                    placeholder="À-hinta"
                  />
                  <input
                    type="number"
                    step="0.1"
                    value={line.vat_rate}
                    onChange={(e) => updateLine(i, 'vat_rate', e.target.value)}
                    className={INPUT}
                    placeholder="ALV %"
                  />
                  <input
                    type="date"
                    value={line.service_date ?? ''}
                    onChange={(e) => updateLine(i, 'service_date', e.target.value)}
                    className={INPUT}
                  />
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex justify-end mt-4 text-sm text-zinc-400 space-y-1">
          <div className="text-right">
            <p>Netto: {fmt(subtotal)} €</p>
            <p>ALV: {fmt(vatTotal)} €</p>
            <p className="text-white font-semibold">Yhteensä: {fmt(totalAmount)} €</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5 text-sm text-red-400 mt-4">
          {error}
        </div>
      )}

      <div className="flex gap-3 mt-6">
        <button
          onClick={handleApprove}
          disabled={approving || rejecting || lines.length === 0}
          className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
        >
          <Check size={16} /> {approving ? 'Hyväksytään...' : 'Hyväksy ja luo lasku'}
        </button>
        <button
          onClick={handleReject}
          disabled={approving || rejecting}
          className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
        >
          <XIcon size={16} /> {rejecting ? 'Hylätään...' : 'Hylkää'}
        </button>
      </div>
    </div>
  )
}
