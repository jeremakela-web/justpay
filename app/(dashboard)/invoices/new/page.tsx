'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Customer, VatRule, Organization } from '@/types/database'
import { generateInvoiceNumber } from '@/lib/utils/invoice-number'
import { generateFinnishReferenceNumber } from '@/lib/utils/reference-number'
import { Plus, Trash2, ArrowLeft, Camera, X, ExternalLink, Sparkles } from 'lucide-react'
import type { ExtractedLine } from '@/app/api/invoices/extract/route'
import type { AddonSuggestion } from '@/app/api/addon-suggestions/route'

interface LineItem {
  id: string
  description: string
  quantity: string
  unit_price: string
  vat_category: string
  vat_rate: number
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function futureDateStr(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

const INPUT =
  'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500'

export default function NewInvoicePage() {
  const router = useRouter()
  const supabase = createClient()

  const [org, setOrg] = useState<Organization | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [vatRules, setVatRules] = useState<VatRule[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageBase64, setImageBase64] = useState<string | null>(null)
  const [imageMediaType, setImageMediaType] = useState<string>('image/jpeg')
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [showAddons, setShowAddons] = useState(false)
  const [addonSuggestions, setAddonSuggestions] = useState<AddonSuggestion[]>([])
  const [addonLoading, setAddonLoading] = useState(false)
  const [addonError, setAddonError] = useState<string | null>(null)

  const [customerId, setCustomerId] = useState('')
  const [issueDate, setIssueDate] = useState(todayStr())
  const [dueDate, setDueDate] = useState(futureDateStr(14))
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineItem[]>([
    { id: '1', description: '', quantity: '1', unit_price: '', vat_category: '', vat_rate: 0 },
  ])

  // Load org + customers
  useEffect(() => {
    const init = async () => {
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

      const { data: custData } = await supabase
        .from('jp_customers')
        .select('*')
        .eq('org_id', orgData.id)
        .order('name')

      setCustomers(custData || [])
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load VAT rules when org or issueDate changes
  const fetchVatRules = useCallback(async () => {
    if (!org) return
    const { data } = await supabase
      .from('jp_vat_rules')
      .select('*')
      .eq('country', org.country)
      .lte('valid_from', issueDate)
      .or(`valid_until.is.null,valid_until.gte.${issueDate}`)
      .order('rate', { ascending: false })

    const rules: VatRule[] = data || []
    setVatRules(rules)

    // Apply default VAT to new lines that have no category set
    if (rules.length > 0) {
      setLines((prev) =>
        prev.map((l) =>
          !l.vat_category
            ? { ...l, vat_category: rules[0].category, vat_rate: rules[0].rate }
            : l
        )
      )
    }
  }, [org, issueDate, supabase])

  useEffect(() => {
    fetchVatRules()
  }, [fetchVatRules])

  // Computed values
  const computed = lines.map((l) => {
    const qty = parseFloat(l.quantity) || 0
    const price = parseFloat(l.unit_price) || 0
    const lineTotal = qty * price
    const vatAmount = lineTotal * (l.vat_rate / 100)
    return { ...l, qty, price, lineTotal, vatAmount }
  })

  const subtotal = computed.reduce((s, l) => s + l.lineTotal, 0)
  const vatTotal = computed.reduce((s, l) => s + l.vatAmount, 0)
  const totalAmount = subtotal + vatTotal

  const fmt = (n: number) =>
    new Intl.NumberFormat('fi-FI', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n)

  const addLine = () => {
    const defaultRule = vatRules[0]
    setLines((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        description: '',
        quantity: '1',
        unit_price: '',
        vat_category: defaultRule?.category ?? '',
        vat_rate: defaultRule?.rate ?? 0,
      },
    ])
  }

  const removeLine = (id: string) => {
    if (lines.length === 1) return
    setLines((prev) => prev.filter((l) => l.id !== id))
  }

  const updateLine = (id: string, field: keyof LineItem, value: string) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l
        if (field === 'vat_category') {
          const rule = vatRules.find((r) => r.category === value)
          return { ...l, vat_category: value, vat_rate: rule?.rate ?? 0 }
        }
        return { ...l, [field]: value }
      })
    )
  }

  const handleImageFile = (file: File) => {
    setExtractError(null)
    setImageMediaType(file.type || 'image/jpeg')
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      setImagePreview(dataUrl)
      // Strip the "data:<type>;base64," prefix to get raw base64
      setImageBase64(dataUrl.split(',')[1] ?? null)
    }
    reader.readAsDataURL(file)
  }

  const handleExtract = async () => {
    if (!imageBase64) return
    setExtracting(true)
    setExtractError(null)
    try {
      const res = await fetch('/api/invoices/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: imageBase64, media_type: imageMediaType }),
      })
      const data = await res.json() as { lines: ExtractedLine[]; error?: string }
      if (data.lines && data.lines.length > 0) {
        const defaultRule = vatRules[0]
        setLines(
          data.lines.map((l, i) => {
            const matchedRule = vatRules.find((r) => r.rate === l.vat_rate)
            return {
              id: `extracted-${i}-${Date.now()}`,
              description: l.description,
              quantity: String(l.quantity),
              unit_price: String(l.unit_price),
              vat_category: matchedRule?.category ?? defaultRule?.category ?? '',
              vat_rate: matchedRule?.rate ?? l.vat_rate,
            }
          })
        )
        // Clear image after successful extraction
        setImagePreview(null)
        setImageBase64(null)
      }
      if (data.error) setExtractError(data.error)
    } catch {
      setExtractError('tarkista rivit manuaalisesti')
    } finally {
      setExtracting(false)
    }
  }

  const fetchAddonSuggestions = useCallback(async () => {
    if (!customerId || totalAmount <= 0) return
    const customer = customers.find((c) => c.id === customerId)
    setAddonLoading(true)
    setAddonError(null)
    setAddonSuggestions([])
    try {
      const res = await fetch('/api/addon-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          total_amount: Math.round(totalAmount * 100) / 100,
          due_date: dueDate,
          customer_type: customer?.type ?? 'company',
        }),
      })
      const data = await res.json()
      if (data.error && (!data.recommendations || data.recommendations.length === 0)) {
        setAddonError(data.error)
      } else {
        setAddonSuggestions(data.recommendations ?? [])
      }
    } catch {
      setAddonError('Suositusten haku epäonnistui')
    } finally {
      setAddonLoading(false)
    }
  }, [customerId, totalAmount, dueDate, customers])

  useEffect(() => {
    if (showAddons && customerId && totalAmount > 0) {
      fetchAddonSuggestions()
    }
  }, [showAddons]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!customerId) {
      setError('Valitse asiakas.')
      return
    }
    const validLines = computed.filter(
      (l) => l.description.trim() && l.price > 0 && l.qty > 0
    )
    if (validLines.length === 0) {
      setError('Lisää vähintään yksi laskurivi kuvauksen ja hinnan kera.')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const invNumber = await generateInvoiceNumber(supabase, org!.id)
      const refNumber = generateFinnishReferenceNumber(invNumber.replace('-', ''))

      const sub = Math.round(subtotal * 100) / 100
      const vat = Math.round(vatTotal * 100) / 100
      const total = Math.round(totalAmount * 100) / 100

      const { data: invoice, error: invErr } = await supabase
        .from('jp_invoices')
        .insert({
          org_id: org!.id,
          customer_id: customerId,
          invoice_number: invNumber,
          reference_number: refNumber,
          issue_date: issueDate,
          due_date: dueDate,
          status: 'draft',
          subtotal: sub,
          vat_total: vat,
          total_amount: total,
          currency: org!.currency,
          notes: notes.trim() || null,
        })
        .select()
        .single()

      if (invErr) throw invErr

      const { error: linesErr } = await supabase
        .from('jp_invoice_lines')
        .insert(
          validLines.map((l, i) => ({
            invoice_id: invoice.id,
            description: l.description.trim(),
            quantity: l.qty,
            unit_price: l.price,
            vat_rate: l.vat_rate,
            vat_amount: Math.round(l.vatAmount * 100) / 100,
            line_total: Math.round(l.lineTotal * 100) / 100,
            sort_order: i,
          }))
        )

      if (linesErr) throw linesErr

      router.push(`/invoices/${invoice.id}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Tallennusvirhe.')
      setSaving(false)
    }
  }

  if (!org) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-zinc-400 hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-bold">Uusi lasku</h1>
      </div>

      <div className="space-y-4">
        {/* Header section */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-sm font-medium text-zinc-400 mb-4">Laskun tiedot</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <label className="block text-sm text-zinc-400 mb-1.5">
                Asiakas <span className="text-red-400">*</span>
              </label>
              {customers.length === 0 ? (
                <div className="text-sm text-zinc-500 py-2.5 px-3 bg-zinc-800 border border-zinc-700 rounded-lg">
                  <Link href="/customers/new" className="text-green-500 hover:underline">
                    Lisää ensin asiakas →
                  </Link>
                </div>
              ) : (
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className={INPUT}
                  required
                >
                  <option value="">Valitse asiakas...</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">Laskupäivä</label>
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className={INPUT}
              />
            </div>

            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">Eräpäivä</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={INPUT}
              />
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-zinc-400">Laskurivit</h2>
            <label className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-green-400 cursor-pointer transition-colors">
              <Camera size={14} />
              Poimi kuvasta
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleImageFile(file)
                  e.target.value = ''
                }}
              />
            </label>
          </div>

          {/* Image preview + extract */}
          {imagePreview && (
            <div className="mb-4 flex items-start gap-3 p-3 bg-zinc-800 border border-zinc-700 rounded-lg">
              <img
                src={imagePreview}
                alt="Valittu kuva"
                className="w-16 h-16 object-cover rounded-md shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-400 mb-2">Kuva valittu. Poimitaanko laskurivit AI:lla?</p>
                {extractError && (
                  <p className="text-xs text-amber-400 mb-2">{extractError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleExtract}
                    disabled={extracting}
                    className="flex items-center gap-1.5 text-xs bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {extracting ? (
                      <>
                        <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                        Poimitaan…
                      </>
                    ) : (
                      'Poimi laskurivit AI:lla'
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setImagePreview(null); setImageBase64(null); setExtractError(null) }}
                    className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white px-2 py-1.5 transition-colors"
                  >
                    <X size={12} />
                    Poista
                  </button>
                </div>
              </div>
            </div>
          )}
          {extractError && !imagePreview && (
            <p className="text-xs text-amber-400 mb-3">{extractError} — tarkista rivit manuaalisesti</p>
          )}

          <div className="space-y-3">
            {/* Header row */}
            <div className="hidden sm:grid grid-cols-[1fr_80px_110px_120px_100px_36px] gap-2 text-xs text-zinc-500 px-1">
              <span>Kuvaus</span>
              <span>Määrä</span>
              <span>Á-hinta (€)</span>
              <span>ALV</span>
              <span className="text-right">Yhteensä</span>
              <span />
            </div>

            {lines.map((line, idx) => {
              const c = computed[idx]
              return (
                <div
                  key={line.id}
                  className="grid grid-cols-1 sm:grid-cols-[1fr_80px_110px_120px_100px_36px] gap-2 items-center"
                >
                  <input
                    type="text"
                    value={line.description}
                    onChange={(e) => updateLine(line.id, 'description', e.target.value)}
                    placeholder="Kuvaus"
                    className={INPUT}
                  />
                  <input
                    type="number"
                    value={line.quantity}
                    onChange={(e) => updateLine(line.id, 'quantity', e.target.value)}
                    min="0"
                    step="0.01"
                    placeholder="1"
                    className={INPUT}
                  />
                  <input
                    type="number"
                    value={line.unit_price}
                    onChange={(e) => updateLine(line.id, 'unit_price', e.target.value)}
                    min="0"
                    step="0.01"
                    placeholder="0,00"
                    className={INPUT}
                  />
                  <select
                    value={line.vat_category}
                    onChange={(e) => updateLine(line.id, 'vat_category', e.target.value)}
                    className={INPUT}
                  >
                    {vatRules.length === 0 ? (
                      <option value="">—</option>
                    ) : (
                      vatRules.map((r) => (
                        <option key={r.id} value={r.category}>
                          {r.category} ({r.rate}%)
                        </option>
                      ))
                    )}
                  </select>
                  <div className="text-right text-sm font-medium text-white pr-1">
                    {fmt(c.lineTotal)} {org.currency}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(line.id)}
                    disabled={lines.length === 1}
                    className="flex items-center justify-center w-9 h-9 text-zinc-500 hover:text-red-400 disabled:opacity-20 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            })}
          </div>

          <button
            type="button"
            onClick={addLine}
            className="mt-4 flex items-center gap-1.5 text-sm text-zinc-400 hover:text-green-400 transition-colors"
          >
            <Plus size={15} />
            Lisää rivi
          </button>

          {/* Totals */}
          <div className="mt-6 pt-4 border-t border-zinc-800 flex justify-end">
            <div className="w-64 space-y-1.5 text-sm">
              <div className="flex justify-between text-zinc-400">
                <span>Veroton yhteensä</span>
                <span>{fmt(subtotal)} {org.currency}</span>
              </div>
              {/* Group VAT by rate */}
              {Object.entries(
                computed.reduce<Record<number, number>>((acc, l) => {
                  if (l.vat_rate > 0) {
                    acc[l.vat_rate] = (acc[l.vat_rate] || 0) + l.vatAmount
                  }
                  return acc
                }, {})
              ).map(([rate, amount]) => (
                <div key={rate} className="flex justify-between text-zinc-400">
                  <span>ALV {rate}%</span>
                  <span>{fmt(amount)} {org.currency}</span>
                </div>
              ))}
              <div className="flex justify-between font-semibold text-white pt-1.5 border-t border-zinc-700 text-base">
                <span>Yhteensä</span>
                <span>{fmt(totalAmount)} {org.currency}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <label className="block text-sm text-zinc-400 mb-1.5">
            Lisätiedot / huomautukset
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Valinnainen viesti asiakkaalle..."
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500 resize-none"
          />
        </div>

        {/* Addon suggestions */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showAddons}
              onChange={(e) => setShowAddons(e.target.checked)}
              className="w-4 h-4 rounded accent-green-500"
            />
            <span className="text-sm text-zinc-300 flex items-center gap-1.5">
              <Sparkles size={14} className="text-green-400" />
              Näytä lisäpalveluvaihtoehdot tälle laskulle
            </span>
          </label>

          {showAddons && (
            <div className="mt-4">
              {!customerId || totalAmount <= 0 ? (
                <p className="text-sm text-zinc-500">
                  Valitse asiakas ja lisää laskurivit ensin.
                </p>
              ) : addonLoading ? (
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                  Haetaan AI-suosituksia…
                </div>
              ) : addonError ? (
                <p className="text-sm text-zinc-500">{addonError}</p>
              ) : addonSuggestions.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  Ei sopivia lisäpalveluita juuri nyt.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {addonSuggestions.map((s, i) => (
                    <div
                      key={i}
                      className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 flex flex-col gap-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium text-white leading-snug">
                          {s.provider_name}
                        </span>
                        <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-400 capitalize">
                          {s.category === 'insurance'
                            ? 'Vakuutus'
                            : s.category === 'collection'
                            ? 'Perintä'
                            : 'Rahoitus'}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed flex-1">
                        {s.reasoning}
                      </p>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors mt-auto"
                      >
                        Lue lisää
                        <ExternalLink size={11} />
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <Link
            href="/"
            className="flex-1 text-center bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium py-2.5 rounded-lg text-sm transition-colors"
          >
            Peruuta
          </Link>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !customerId}
            className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
          >
            {saving ? 'Tallennetaan...' : 'Tallenna luonnoksena'}
          </button>
        </div>
      </div>
    </div>
  )
}
