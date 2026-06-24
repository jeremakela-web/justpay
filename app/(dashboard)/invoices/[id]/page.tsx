'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Invoice, InvoiceLine, Organization, Customer } from '@/types/database'
import { formatReferenceNumber } from '@/lib/utils/reference-number'
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

function formatDate(s: string) {
  return new Date(s).toLocaleDateString('fi-FI')
}

function formatCurrency(n: number, currency = 'EUR') {
  return new Intl.NumberFormat('fi-FI', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(n)
}

export default function InvoiceDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params?.id as string
  const supabase = createClient()

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [lines, setLines] = useState<InvoiceLine[]>([])
  const [org, setOrg] = useState<Organization | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendSuccess, setSendSuccess] = useState(false)

  useEffect(() => {
    const fetchAll = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const [{ data: orgData }, { data: invData }, { data: linesData }] =
        await Promise.all([
          supabase
            .from('jp_organizations')
            .select('*')
            .eq('owner_user_id', user.id)
            .maybeSingle(),
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

      setOrg(orgData)
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

      setLoading(false)
    }
    fetchAll()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateStatus = async (status: Invoice['status']) => {
    if (!invoice) return
    setUpdating(true)
    const { data, error } = await supabase
      .from('jp_invoices')
      .update({ status })
      .eq('id', invoice.id)
      .select()
      .single()
    if (!error && data) {
      setInvoice(data as Invoice)
    }
    setUpdating(false)
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
                onClick={() => updateStatus('paid')}
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
              onClick={() => updateStatus('paid')}
              disabled={updating}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-green-400 bg-green-500/10 hover:bg-green-500/20 rounded-lg transition-colors disabled:opacity-50"
            >
              <CheckCircle size={15} />
              Merkitse maksetuksi
            </button>
          )}
        </div>
      </div>

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

      {/* Invoice document */}
      <div className="bg-white text-gray-900 rounded-xl shadow-2xl overflow-hidden">
        {/* Invoice header */}
        <div className="bg-gray-950 text-white px-8 py-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="text-2xl font-bold tracking-tight">
              Just<span className="text-green-400">.</span>Pay
            </div>
            {org && (
              <div className="mt-2 text-sm text-gray-300 space-y-0.5">
                <p className="font-medium text-white">{org.name}</p>
                {org.business_id && <p>Y-tunnus: {org.business_id}</p>}
                <p>{org.country}</p>
              </div>
            )}
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
