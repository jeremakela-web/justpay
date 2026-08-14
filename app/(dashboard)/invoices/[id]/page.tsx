'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Invoice, InvoiceLine, Customer, Payment, ServiceFeeDocument } from '@/types/database'
import { formatReferenceNumber } from '@/lib/utils/reference-number'
import { formatDate, formatServiceDate, formatCurrency } from '@/lib/utils/invoice-format'
import { KANSALLISVARANTO } from '@/lib/kansallisvaranto'
import { ArrowLeft, Printer, CheckCircle, Send, XCircle, Copy, Check, FileDown, Mail } from 'lucide-react'

const STATUS_LABELS: Record<Invoice['status'], string> = {
  draft: 'Luonnos',
  sent: 'Lähetetty',
  paid: 'Maksettu',
  overdue: 'Erääntynyt',
  cancelled: 'Peruutettu',
}

const STATUS_COLORS: Record<Invoice['status'], string> = {
  draft: 'bg-zinc-700 text-zinc-200',
  sent: 'bg-blue-500/20 text-blue-300',
  paid: 'bg-green-500/20 text-green-300',
  overdue: 'bg-red-500/20 text-red-300',
  cancelled: 'bg-zinc-800 text-zinc-500',
}

export default function InvoiceDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params?.id as string
  const supabase = createClient()

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [lines, setLines] = useState<InvoiceLine[]>([])
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendSuccess, setSendSuccess] = useState(false)
  const [showPaidConfirm, setShowPaidConfirm] = useState(false)
  const [paidNote, setPaidNote] = useState('')
  const [payout, setPayout] = useState<Payment | null>(null)
  const [payoutError, setPayoutError] = useState<string | null>(null)
  const [serviceFeeDoc, setServiceFeeDoc] = useState<ServiceFeeDocument | null>(null)
  const [showSentConfirm, setShowSentConfirm] = useState(false)
  const [sentNote, setSentNote] = useState('')
  const [showConfirmedConfirm, setShowConfirmedConfirm] = useState(false)
  const [confirmedNote, setConfirmedNote] = useState('')

  useEffect(() => {
    const fetchAll = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const [{ data: invData }, { data: linesData }] =
        await Promise.all([
          supabase
            .from('jp_invoices')
            .select('*')
            .eq('id', id)
            .maybeSingle(),
          supabase
            .from('jp_invoice_lines')
            .select('*')
            .eq('invoice_id', id)
            .order('sort_order'),
        ])

      if (!invData) {
        router.push('/')
        return
      }

      setInvoice(invData as Invoice)
      setLines((linesData as InvoiceLine[]) || [])

      if (invData.customer_id) {
        const { data: custData } = await supabase
          .from('jp_customers')
          .select('*')
          .eq('id', invData.customer_id)
          .maybeSingle()
        setCustomer(custData as Customer)
      }

      const { data: payoutData } = await supabase
        .from('jp_payments')
        .select('*')
        .eq('invoice_id', id)
        .eq('type', 'worker_payout')
        .maybeSingle()
      setPayout((payoutData as Payment) || null)

      // Palvelumaksukuitti syntyy automaattisesti DB-triggerillä kun
      // payout vahvistetaan (ks. migration_008) — haetaan tässä jos
      // se jo on olemassa (esim. sivun uudelleenlataus vahvistuksen jälkeen).
      if (payoutData) {
        const { data: docData } = await supabase
          .from('jp_service_fee_documents')
          .select('*')
          .eq('payout_id', payoutData.id)
          .maybeSingle()
        setServiceFeeDoc((docData as ServiceFeeDocument) || null)
      }

      setLoading(false)
    }
    fetchAll()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Laskee ja luo tekijän maksurivin kun lasku merkitään maksetuksi.
  // Malli (vahvistettu): fee_amount = subtotal * org.fee_rate_percent;
  // fee_vat_amount = fee_amount * Suomen yleinen ALV-kanta (Kansallisvaranto
  // on aina suomalainen yhtiö, riippumatta tekijän organisaation maasta);
  // amount (nettosumma tekijälle) = subtotal - fee_amount - fee_vat_amount.
  // Ei tee mitään jos payout-rivi on jo olemassa tälle laskulle
  // (jp_payments_worker_payout_unique_idx varmistaa tämän myös DB-tasolla).
  const ensurePayout = async (inv: Invoice) => {
    setPayoutError(null)

    const { data: existing } = await supabase
      .from('jp_payments')
      .select('*')
      .eq('invoice_id', inv.id)
      .eq('type', 'worker_payout')
      .maybeSingle()
    if (existing) {
      setPayout(existing as Payment)
      return
    }

    const { data: orgData, error: orgErr } = await supabase
      .from('jp_organizations')
      .select('fee_rate_percent')
      .eq('id', inv.org_id)
      .maybeSingle()
    if (orgErr || !orgData) {
      setPayoutError('Maksun laskenta epäonnistui: organisaatiota ei löytynyt.')
      return
    }

    // Kansallisvarannon oman palkkion ALV — aina Suomen yleinen kanta,
    // koska Kansallisvaranto on suomalainen yhtiö riippumatta tekijän
    // organisaation maasta. Haetaan jp_vat_rules:sta (korkein voimassa
    // oleva FI-kanta) sen sijaan että kanta olisi kovakoodattu, jotta
    // laskenta pysyy oikeana jos Suomen ALV-kanta joskus muuttuu uudelleen.
    const { data: vatRuleData } = await supabase
      .from('jp_vat_rules')
      .select('rate')
      .eq('country', 'FI')
      .lte('valid_from', inv.issue_date)
      .or(`valid_until.is.null,valid_until.gte.${inv.issue_date}`)
      .order('rate', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!vatRuleData) {
      setPayoutError(
        'Maksun laskenta epäonnistui: Suomen ALV-kantaa ei löytynyt laskupäivälle. Palkkion ALV jää laskematta — ota yhteyttä ylläpitoon ennen maksun suorittamista.'
      )
      return
    }

    const feeRatePercent = orgData.fee_rate_percent
    const finlandVatRate = vatRuleData.rate

    const feeAmount = Math.round(inv.subtotal * (feeRatePercent / 100) * 100) / 100
    const feeVatAmount = Math.round(feeAmount * (finlandVatRate / 100) * 100) / 100
    const netAmount = Math.round((inv.subtotal - feeAmount - feeVatAmount) * 100) / 100

    const { data: created, error: insertErr } = await supabase
      .from('jp_payments')
      .insert({
        org_id: inv.org_id,
        invoice_id: inv.id,
        type: 'worker_payout',
        amount: netAmount,
        fee_amount: feeAmount,
        fee_vat_rate: finlandVatRate,
        fee_vat_amount: feeVatAmount,
        currency: inv.currency,
        status: 'pending',
      })
      .select()
      .single()

    if (insertErr) {
      setPayoutError('Maksurivin luonti epäonnistui: ' + insertErr.message)
      return
    }

    setPayout(created as Payment)
  }

  const updatePayoutStatus = async (
    status: Payment['status'],
    note: string
  ) => {
    if (!payout) return
    setUpdating(true)
    const patch: Record<string, unknown> = { status }
    if (status === 'sent') {
      patch.sent_at = new Date().toISOString()
      patch.sent_note = note
    } else if (status === 'confirmed') {
      patch.confirmed_at = new Date().toISOString()
      patch.confirmed_note = note
    }
    const { data, error } = await supabase
      .from('jp_payments')
      .update(patch)
      .eq('id', payout.id)
      .select()
      .single()
    if (!error && data) {
      setPayout(data as Payment)

      // DB-triggeri (ks. migration_008) luo palvelumaksukuitin samassa
      // transaktiossa kun status siirtyy 'confirmed':ksi — se on siis
      // jo olemassa tähän mennessä, haetaan se näytettäväksi.
      if (status === 'confirmed') {
        const { data: docData } = await supabase
          .from('jp_service_fee_documents')
          .select('*')
          .eq('payout_id', data.id)
          .maybeSingle()
        setServiceFeeDoc((docData as ServiceFeeDocument) || null)
      }
    }
    setUpdating(false)
  }

  const updateStatus = async (status: Invoice['status'], confirmationNote?: string) => {
    if (!invoice) return
    setUpdating(true)
    // updated_by/updated_at täyttyvät automaattisesti DB-triggerillä
    // (ks. migration_005) — sovelluskoodi ei aseta niitä itse.
    const { data, error } = await supabase
      .from('jp_invoices')
      .update({
        status,
        ...(confirmationNote ? { paid_confirmation_note: confirmationNote } : {}),
      })
      .eq('id', invoice.id)
      .select()
      .single()
    if (!error && data) {
      setInvoice(data as Invoice)
    }
    setUpdating(false)
  }

  const startPaidConfirm = () => {
    setPaidNote('')
    setShowPaidConfirm(true)
  }

  const confirmPaid = async () => {
    if (!paidNote.trim()) return
    await updateStatus('paid', paidNote.trim())
    setShowPaidConfirm(false)
    if (invoice) await ensurePayout(invoice)
  }

  const startSentConfirm = () => {
    setSentNote('')
    setShowSentConfirm(true)
  }

  const confirmSent = async () => {
    if (!sentNote.trim()) return
    await updatePayoutStatus('sent', sentNote.trim())
    setShowSentConfirm(false)
  }

  const startConfirmedConfirm = () => {
    setConfirmedNote('')
    setShowConfirmedConfirm(true)
  }

  const confirmConfirmed = async () => {
    if (!confirmedNote.trim()) return
    await updatePayoutStatus('confirmed', confirmedNote.trim())
    setShowConfirmedConfirm(false)
  }

  const handleSendEmail = async () => {
    if (!invoice) return
    setSending(true)
    setSendError(null)
    setSendSuccess(false)
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/send-email`, { method: 'POST' })
      const data = await res.json() as { success?: boolean; error?: string }
      if (!res.ok || data.error) {
        setSendError(data.error ?? 'Lähetys epäonnistui')
      } else {
        setSendSuccess(true)
        setInvoice((prev) => prev ? { ...prev, status: 'sent' } : prev)
      }
    } catch {
      setSendError('Lähetys epäonnistui')
    } finally {
      setSending(false)
    }
  }

  const copyRefNumber = async () => {
    if (!invoice) return
    await navigator.clipboard.writeText(invoice.reference_number)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!invoice) return null

  const formattedRef = formatReferenceNumber(invoice.reference_number)

  // Group VAT for display
  const vatGroups = lines.reduce<Record<number, number>>((acc, l) => {
    if (l.vat_rate > 0) {
      acc[l.vat_rate] = (acc[l.vat_rate] || 0) + l.vat_amount
    }
    return acc
  }, {})

  return (
    <div className="max-w-4xl mx-auto">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6 no-print">
        <div className="flex items-center gap-3 flex-1">
          <Link href="/" className="text-zinc-400 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-bold">Lasku {invoice.invoice_number}</h1>
          <span
            className={`px-2.5 py-1 rounded-md text-xs font-medium ${STATUS_COLORS[invoice.status]}`}
          >
            {STATUS_LABELS[invoice.status]}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
          >
            <Printer size={15} />
            Tulosta
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
          >
            <FileDown size={15} />
            Lataa PDF
          </button>

          {(invoice.status === 'draft' || invoice.status === 'sent') && (
            <button
              onClick={handleSendEmail}
              disabled={sending || !customer?.email}
              title={!customer?.email ? 'Asiakkaalla ei ole sähköpostiosoitetta' : undefined}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {sending ? (
                <>
                  <div className="w-3.5 h-3.5 border border-emerald-400 border-t-transparent rounded-full animate-spin" />
                  Lähetetään…
                </>
              ) : (
                <>
                  <Mail size={15} />
                  Lähetä sähköpostitse
                </>
              )}
            </button>
          )}

          {invoice.status === 'draft' && (
            <>
              <button
                onClick={() => updateStatus('sent')}
                disabled={updating}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg transition-colors disabled:opacity-50"
              >
                <Send size={15} />
                Merkitse lähetetyksi
              </button>
              <button
                onClick={() => updateStatus('cancelled')}
                disabled={updating}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors disabled:opacity-50"
              >
                <XCircle size={15} />
                Peruuta
              </button>
            </>
          )}

          {invoice.status === 'sent' && (
            <>
              <button
                onClick={startPaidConfirm}
                disabled={updating}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-green-400 bg-green-500/10 hover:bg-green-500/20 rounded-lg transition-colors disabled:opacity-50"
              >
                <CheckCircle size={15} />
                Merkitse maksetuksi
              </button>
              <button
                onClick={() => updateStatus('overdue')}
                disabled={updating}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors disabled:opacity-50"
              >
                <XCircle size={15} />
                Merkitse erääntyneeksi
              </button>
            </>
          )}

          {invoice.status === 'overdue' && (
            <button
              onClick={startPaidConfirm}
              disabled={updating}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-green-400 bg-green-500/10 hover:bg-green-500/20 rounded-lg transition-colors disabled:opacity-50"
            >
              <CheckCircle size={15} />
              Merkitse maksetuksi
            </button>
          )}
        </div>
      </div>

      {showPaidConfirm && (
        <div className="mb-4 px-4 py-4 bg-zinc-900 border border-green-500/30 rounded-xl no-print">
          <p className="text-sm font-medium text-white mb-1">Vahvista maksu</p>
          <p className="text-xs text-zinc-400 mb-3">
            Miten maksu vahvistettiin? (esim. Revolut-viite, pankkitiliote, päivämäärä)
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={paidNote}
              onChange={(e) => setPaidNote(e.target.value)}
              placeholder="esim. Revolut-siirto 14.8.2026, viite RV-4821"
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={confirmPaid}
                disabled={updating || !paidNote.trim()}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                <CheckCircle size={15} />
                Vahvista maksu
              </button>
              <button
                onClick={() => setShowPaidConfirm(false)}
                disabled={updating}
                className="px-3 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
              >
                Peruuta
              </button>
            </div>
          </div>
        </div>
      )}

      {sendSuccess && (
        <div className="mb-4 px-4 py-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-sm text-emerald-400 no-print">
          Lasku lähetetty sähköpostitse osoitteeseen {customer?.email}. Tila päivitetty → Lähetetty.
        </div>
      )}
      {sendError && (
        <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400 no-print">
          {sendError}
        </div>
      )}

      {(invoice.paid_confirmation_note || invoice.worker_name_note) && (
        <div className="mb-4 px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl no-print text-xs text-zinc-400 space-y-1">
          <p className="font-medium text-zinc-300 mb-1">Sisäiset huomiot (eivät näy asiakkaalle)</p>
          {invoice.paid_confirmation_note && (
            <p>Maksuvahvistus: {invoice.paid_confirmation_note}</p>
          )}
          {invoice.worker_name_note && (
            <p>Tekijän poikkeama: {invoice.worker_name_note}</p>
          )}
          <p className="text-zinc-500">
            Viimeksi päivitetty: {new Date(invoice.updated_at).toLocaleString('fi-FI')}
          </p>
        </div>
      )}

      {invoice.status === 'paid' && (
        <div className="mb-4 px-4 py-4 bg-zinc-900 border border-zinc-800 rounded-xl no-print">
          <p className="text-sm font-medium text-white mb-3">
            Tekijän maksu (Kansallisvaranto → tekijä)
          </p>

          {payoutError && (
            <div className="mb-3 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
              {payoutError}
            </div>
          )}

          {!payout && !payoutError && (
            <button
              onClick={() => ensurePayout(invoice)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-zinc-700 hover:bg-zinc-600 rounded-lg transition-colors"
            >
              Laske maksu
            </button>
          )}

          {payout && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <p className="text-zinc-500">Veroton summa</p>
                  <p className="text-white font-medium">{formatCurrency(invoice.subtotal, payout.currency)}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Palkkio (veroton)</p>
                  <p className="text-white font-medium">
                    {payout.fee_amount != null ? formatCurrency(payout.fee_amount, payout.currency) : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500">ALV palkkiosta</p>
                  <p className="text-white font-medium">
                    {payout.fee_vat_amount != null ? formatCurrency(payout.fee_vat_amount, payout.currency) : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500">Maksettava tekijälle</p>
                  <p className="text-green-400 font-semibold">
                    {formatCurrency(payout.amount, payout.currency)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-1 rounded-md text-xs font-medium ${
                    payout.status === 'confirmed'
                      ? 'bg-green-500/20 text-green-300'
                      : payout.status === 'sent'
                      ? 'bg-blue-500/20 text-blue-300'
                      : 'bg-zinc-700 text-zinc-200'
                  }`}
                >
                  {payout.status === 'confirmed'
                    ? 'Maksu vahvistettu'
                    : payout.status === 'sent'
                    ? 'Maksu lähetetty'
                    : 'Odottaa lähetystä'}
                </span>

                {payout.status === 'pending' && (
                  <button
                    onClick={startSentConfirm}
                    disabled={updating}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Send size={13} />
                    Merkitse lähetetyksi
                  </button>
                )}
                {payout.status === 'sent' && (
                  <button
                    onClick={startConfirmedConfirm}
                    disabled={updating}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-green-400 bg-green-500/10 hover:bg-green-500/20 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <CheckCircle size={13} />
                    Vahvista saapuneeksi
                  </button>
                )}
                {serviceFeeDoc && (
                  <Link
                    href={`/service-fee/${serviceFeeDoc.id}`}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 rounded-lg transition-colors"
                  >
                    Näytä palvelumaksukuitti {serviceFeeDoc.document_number}
                  </Link>
                )}
              </div>

              {payout.sent_note && (
                <p className="text-xs text-zinc-500">Lähetysviite: {payout.sent_note}</p>
              )}
              {payout.confirmed_note && (
                <p className="text-xs text-zinc-500">Vahvistus: {payout.confirmed_note}</p>
              )}

              {showSentConfirm && (
                <div className="pt-2 border-t border-zinc-800">
                  <p className="text-xs text-zinc-400 mb-2">
                    Miten/mihin maksu lähetettiin? (esim. Revolut-viite)
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={sentNote}
                      onChange={(e) => setSentNote(e.target.value)}
                      placeholder="esim. Revolut-siirto tekijän tilille, viite RV-9931"
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={confirmSent}
                        disabled={updating || !sentNote.trim()}
                        className="px-3 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
                      >
                        Vahvista
                      </button>
                      <button
                        onClick={() => setShowSentConfirm(false)}
                        disabled={updating}
                        className="px-3 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                      >
                        Peruuta
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {showConfirmedConfirm && (
                <div className="pt-2 border-t border-zinc-800">
                  <p className="text-xs text-zinc-400 mb-2">
                    Miten vahvistettiin että maksu saapui tekijälle?
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={confirmedNote}
                      onChange={(e) => setConfirmedNote(e.target.value)}
                      placeholder="esim. tekijä vahvisti saaneensa summan 15.8.2026"
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={confirmConfirmed}
                        disabled={updating || !confirmedNote.trim()}
                        className="px-3 py-2 text-sm text-white bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
                      >
                        Vahvista
                      </button>
                      <button
                        onClick={() => setShowConfirmedConfirm(false)}
                        disabled={updating}
                        className="px-3 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                      >
                        Peruuta
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Invoice document */}
      <div className="bg-white text-gray-900 rounded-xl shadow-2xl overflow-hidden">
        {/* Invoice header */}
        <div className="bg-gray-950 text-white px-8 py-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="text-2xl font-bold tracking-tight">
              Just<span className="text-green-400">.</span>Pay
            </div>
            <div className="mt-2 text-sm text-gray-300 space-y-0.5">
              <p className="font-medium text-white">{KANSALLISVARANTO.name}</p>
              <p>Y-tunnus: {KANSALLISVARANTO.businessId}</p>
              <p>{KANSALLISVARANTO.address}</p>
            </div>
          </div>

          <div className="text-right">
            <p className="text-3xl font-bold text-green-400">LASKU</p>
            <div className="mt-2 text-sm text-gray-300 space-y-0.5">
              <p>
                <span className="text-gray-400">Numero:</span>{' '}
                <span className="font-medium text-white">{invoice.invoice_number}</span>
              </p>
              <p>
                <span className="text-gray-400">Laskupäivä:</span>{' '}
                <span className="text-white">{formatDate(invoice.issue_date)}</span>
              </p>
              <p>
                <span className="text-gray-400">Eräpäivä:</span>{' '}
                <span className="font-semibold text-yellow-300">
                  {formatDate(invoice.due_date)}
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Recipient */}
        <div className="px-8 py-6 bg-gray-50 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Laskutetaan
          </p>
          {customer ? (
            <div className="text-sm space-y-0.5">
              <p className="font-semibold text-gray-900 text-base">{customer.name}</p>
              {customer.business_id && (
                <p className="text-gray-600">Y-tunnus: {customer.business_id}</p>
              )}
              {customer.vat_number && (
                <p className="text-gray-600">ALV: {customer.vat_number}</p>
              )}
              {customer.address && <p className="text-gray-600">{customer.address}</p>}
              {(customer.postal_code || customer.city) && (
                <p className="text-gray-600">
                  {customer.postal_code} {customer.city}
                </p>
              )}
              {customer.country && (
                <p className="text-gray-600">{customer.country}</p>
              )}
              {customer.email && (
                <p className="text-gray-500 text-xs mt-1">{customer.email}</p>
              )}
            </div>
          ) : (
            <p className="text-gray-400 text-sm">Asiakasta ei löydy</p>
          )}
        </div>

        {/* Työn tiedot: tekijä + ajankohta, erillään laskuttajasta */}
        <div className="px-8 py-6 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Työn tiedot
          </p>
          <div className="text-sm space-y-0.5">
            <p className="text-gray-800">
              <span className="text-gray-500">Työn suoritti:</span>{' '}
              <span className="font-medium text-gray-900">
                {invoice.worker_name || '—'}
              </span>
            </p>
            {formatServiceDate(invoice.service_date_start, invoice.service_date_end) && (
              <p className="text-gray-800">
                <span className="text-gray-500">Työn ajankohta:</span>{' '}
                <span className="font-medium text-gray-900">
                  {formatServiceDate(invoice.service_date_start, invoice.service_date_end)}
                </span>
              </p>
            )}
          </div>
        </div>

        {/* Line items */}
        <div className="px-8 py-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide pb-2">
                  Kuvaus
                </th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide pb-2 w-20">
                  Määrä
                </th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide pb-2 w-28">
                  Á-hinta
                </th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide pb-2 w-16">
                  ALV%
                </th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide pb-2 w-32">
                  Yhteensä
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="py-3 text-gray-800">{line.description}</td>
                  <td className="py-3 text-right text-gray-700">
                    {new Intl.NumberFormat('fi-FI').format(line.quantity)}
                  </td>
                  <td className="py-3 text-right text-gray-700">
                    {formatCurrency(line.unit_price, invoice.currency)}
                  </td>
                  <td className="py-3 text-right text-gray-500">{line.vat_rate}%</td>
                  <td className="py-3 text-right font-medium text-gray-900">
                    {formatCurrency(line.line_total, invoice.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex justify-end mt-6">
            <div className="w-64 space-y-2 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Veroton yhteensä</span>
                <span>{formatCurrency(invoice.subtotal, invoice.currency)}</span>
              </div>
              {Object.entries(vatGroups).map(([rate, amount]) => (
                <div key={rate} className="flex justify-between text-gray-600">
                  <span>ALV {rate}%</span>
                  <span>{formatCurrency(amount, invoice.currency)}</span>
                </div>
              ))}
              <div className="flex justify-between font-bold text-gray-900 text-base pt-2 border-t-2 border-gray-300">
                <span>Yhteensä</span>
                <span>{formatCurrency(invoice.total_amount, invoice.currency)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Payment info */}
        <div className="px-8 py-6 bg-gray-50 border-t border-gray-100">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Maksutiedot
              </p>
              <div className="space-y-1 text-gray-700">
                <div className="flex gap-2">
                  <span className="text-gray-400 w-24 shrink-0">Viitenumero</span>
                  <span className="font-mono font-semibold">{formattedRef}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-gray-400 w-24 shrink-0">Eräpäivä</span>
                  <span className="font-medium">{formatDate(invoice.due_date)}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-gray-400 w-24 shrink-0">Summa</span>
                  <span className="font-semibold text-gray-900">
                    {formatCurrency(invoice.total_amount, invoice.currency)}
                  </span>
                </div>
              </div>
            </div>

            {invoice.notes && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Lisätiedot
                </p>
                <p className="text-gray-700 whitespace-pre-line text-sm">
                  {invoice.notes}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-3 bg-gray-900 text-center text-xs text-gray-500">
          Laskutettu Just.Pay-palvelulla · just.pay
        </div>
      </div>

      {/* Reference number quick copy (outside print area) */}
      <div className="mt-4 no-print">
        <button
          onClick={copyRefNumber}
          className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
        >
          {copied ? (
            <Check size={14} className="text-green-400" />
          ) : (
            <Copy size={14} />
          )}
          {copied ? 'Kopioitu!' : `Kopioi viitenumero: ${formattedRef}`}
        </button>
      </div>
    </div>
  )
}
