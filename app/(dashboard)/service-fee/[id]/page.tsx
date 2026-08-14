'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { ServiceFeeDocument, Organization, Invoice } from '@/types/database'
import { formatDate, formatCurrency } from '@/lib/utils/invoice-format'
import { KANSALLISVARANTO } from '@/lib/kansallisvaranto'
import { ArrowLeft, Printer, FileDown, Mail, Check } from 'lucide-react'

export default function ServiceFeeDocumentPage() {
  const router = useRouter()
  const params = useParams()
  const id = params?.id as string
  const supabase = createClient()

  const [doc, setDoc] = useState<ServiceFeeDocument | null>(null)
  const [org, setOrg] = useState<Organization | null>(null)
  const [sourceInvoice, setSourceInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendSuccess, setSendSuccess] = useState(false)

  useEffect(() => {
    const fetchAll = async () => {
      const { data: docData } = await supabase
        .from('jp_service_fee_documents')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (!docData) {
        router.push('/')
        return
      }
      setDoc(docData as ServiceFeeDocument)

      const [{ data: orgData }, { data: invData }] = await Promise.all([
        supabase
          .from('jp_organizations')
          .select('*')
          .eq('id', docData.org_id)
          .maybeSingle(),
        supabase
          .from('jp_invoices')
          .select('*')
          .eq('id', docData.source_invoice_id)
          .maybeSingle(),
      ])
      setOrg((orgData as Organization) || null)
      setSourceInvoice((invData as Invoice) || null)

      setLoading(false)
    }
    fetchAll()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSendEmail = async () => {
    if (!doc) return
    setSending(true)
    setSendError(null)
    setSendSuccess(false)
    try {
      const res = await fetch(`/api/service-fee/${doc.id}/send-email`, { method: 'POST' })
      const data = await res.json() as { success?: boolean; error?: string }
      if (!res.ok || data.error) {
        setSendError(data.error ?? 'Lähetys epäonnistui')
      } else {
        setSendSuccess(true)
      }
    } catch {
      setSendError('Lähetys epäonnistui')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!doc) return null

  return (
    <div className="max-w-4xl mx-auto">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6 no-print">
        <div className="flex items-center gap-3 flex-1">
          <Link href="/" className="text-zinc-400 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-bold">Palvelumaksukuitti {doc.document_number}</h1>
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
          <button
            onClick={handleSendEmail}
            disabled={sending}
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
                Lähetä sähköpostitse omaan osoitteeseeni
              </>
            )}
          </button>
        </div>
      </div>

      {sendSuccess && (
        <div className="mb-4 px-4 py-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-sm text-emerald-400 no-print flex items-center gap-2">
          <Check size={15} />
          Kuitti lähetetty sähköpostiisi.
        </div>
      )}
      {sendError && (
        <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400 no-print">
          {sendError}
        </div>
      )}

      {/* Document */}
      <div className="bg-white text-gray-900 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
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
            <p className="text-3xl font-bold text-green-400">PALVELUMAKSUKUITTI</p>
            <div className="mt-2 text-sm text-gray-300 space-y-0.5">
              <p>
                <span className="text-gray-400">Numero:</span>{' '}
                <span className="font-medium text-white">{doc.document_number}</span>
              </p>
              <p>
                <span className="text-gray-400">Päivämäärä:</span>{' '}
                <span className="text-white">{formatDate(doc.issue_date)}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Recipient */}
        <div className="px-8 py-6 bg-gray-50 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Vastaanottaja
          </p>
          {org ? (
            <div className="text-sm space-y-0.5">
              <p className="font-semibold text-gray-900 text-base">{org.name}</p>
              {org.business_id && <p className="text-gray-600">Y-tunnus: {org.business_id}</p>}
            </div>
          ) : (
            <p className="text-gray-400 text-sm">Organisaatiota ei löydy</p>
          )}
        </div>

        {/* Reference to source invoice */}
        <div className="px-8 py-4 border-b border-gray-100">
          <p className="text-sm text-gray-700">
            <span className="text-gray-500">Viittaus laskuun:</span>{' '}
            <span className="font-medium text-gray-900">
              {sourceInvoice ? sourceInvoice.invoice_number : doc.source_invoice_id}
            </span>
          </p>
        </div>

        {/* Line item */}
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
            <tbody>
              <tr>
                <td className="py-3 text-gray-800">
                  Laskutuspalvelun palkkio
                  {sourceInvoice ? ` — lasku ${sourceInvoice.invoice_number}` : ''}
                </td>
                <td className="py-3 text-right text-gray-700">1</td>
                <td className="py-3 text-right text-gray-700">
                  {formatCurrency(doc.fee_amount, doc.currency)}
                </td>
                <td className="py-3 text-right text-gray-500">{doc.fee_vat_rate}%</td>
                <td className="py-3 text-right font-medium text-gray-900">
                  {formatCurrency(doc.fee_amount, doc.currency)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex justify-end mt-6">
            <div className="w-64 space-y-2 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Veroton yhteensä</span>
                <span>{formatCurrency(doc.fee_amount, doc.currency)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>ALV {doc.fee_vat_rate}%</span>
                <span>{formatCurrency(doc.fee_vat_amount, doc.currency)}</span>
              </div>
              <div className="flex justify-between font-bold text-gray-900 text-base pt-2 border-t-2 border-gray-300">
                <span>Yhteensä</span>
                <span>{formatCurrency(doc.total_amount, doc.currency)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Note */}
        <div className="px-8 py-6 bg-gray-50 border-t border-gray-100">
          <p className="text-xs text-gray-500">
            Tämä kuitti koskee Kansallisvaranto Oy:n perimää laskutuspalvelun
            palkkiota laskusta {sourceInvoice ? sourceInvoice.invoice_number : ''}, ei
            itse suoritettua työtä. Säilytä tämä kuitti kirjanpitoasi/verotustasi varten.
          </p>
        </div>

        {/* Footer */}
        <div className="px-8 py-3 bg-gray-900 text-center text-xs text-gray-500">
          Kansallisvaranto Oy · just.pay
        </div>
      </div>
    </div>
  )
}
