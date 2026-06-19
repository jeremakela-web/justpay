'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Invoice } from '@/types/database'
import { Plus, FileText, ChevronRight } from 'lucide-react'

type StatusFilter = 'all' | Invoice['status']

const STATUS_LABELS: Record<Invoice['status'], string> = {
  draft: 'Luonnos',
  sent: 'Lähetetty',
  paid: 'Maksettu',
  overdue: 'Erääntynyt',
  cancelled: 'Peruutettu',
}

const STATUS_COLORS: Record<Invoice['status'], string> = {
  draft: 'bg-zinc-700 text-zinc-300',
  sent: 'bg-blue-500/20 text-blue-400',
  paid: 'bg-green-500/20 text-green-400',
  overdue: 'bg-red-500/20 text-red-400',
  cancelled: 'bg-zinc-800 text-zinc-500',
}

const filterTabs: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Kaikki' },
  { value: 'draft', label: 'Luonnos' },
  { value: 'sent', label: 'Lähetetty' },
  { value: 'paid', label: 'Maksettu' },
  { value: 'overdue', label: 'Erääntynyt' },
  { value: 'cancelled', label: 'Peruutettu' },
]

function formatCurrency(amount: number, currency = 'EUR') {
  return new Intl.NumberFormat('fi-FI', {
    style: 'currency',
    currency,
  }).format(amount)
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('fi-FI')
}

export default function InvoiceListPage() {
  const router = useRouter()
  const supabase = createClient()

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [loading, setLoading] = useState(true)
  const [orgId, setOrgId] = useState<string | null>(null)

  const fetchInvoices = useCallback(
    async (currentOrgId: string) => {
      let query = supabase
        .from('jp_invoices')
        .select('*, jp_customers(name)')
        .eq('org_id', currentOrgId)
        .order('created_at', { ascending: false })

      if (filter !== 'all') {
        query = query.eq('status', filter)
      }

      const { data } = await query
      setInvoices((data as Invoice[]) || [])
      setLoading(false)
    },
    [filter, supabase]
  )

  useEffect(() => {
    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const { data: org } = await supabase
        .from('jp_organizations')
        .select('id')
        .eq('owner_user_id', user.id)
        .maybeSingle()

      if (!org) {
        router.push('/onboarding')
        return
      }

      setOrgId(org.id)
      fetchInvoices(org.id)
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (orgId) {
      setLoading(true)
      fetchInvoices(orgId)
    }
  }, [filter, orgId, fetchInvoices])

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Laskut</h1>
        <Link
          href="/invoices/new"
          className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} />
          Uusi lasku
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {filterTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
              filter === tab.value
                ? 'bg-zinc-700 text-white'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Invoice list */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <div className="w-12 h-12 bg-zinc-800 rounded-full flex items-center justify-center mb-4">
              <FileText size={22} className="text-zinc-500" />
            </div>
            <p className="text-zinc-400 text-sm">
              {filter === 'all'
                ? 'Ei vielä laskuja. Luo ensimmäinen lasku!'
                : `Ei ${filterTabs.find((t) => t.value === filter)?.label.toLowerCase()}-laskuja.`}
            </p>
            {filter === 'all' && (
              <Link
                href="/invoices/new"
                className="mt-4 bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Luo lasku
              </Link>
            )}
          </div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {/* Header */}
            <div className="hidden sm:grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-4 px-5 py-3 text-xs text-zinc-500 font-medium uppercase tracking-wide">
              <span>Numero</span>
              <span>Asiakas</span>
              <span>Päivämäärä</span>
              <span>Eräpäivä</span>
              <span className="text-right">Summa</span>
              <span className="text-right">Tila</span>
            </div>

            {invoices.map((invoice) => (
              <Link
                key={invoice.id}
                href={`/invoices/${invoice.id}`}
                className="flex sm:grid sm:grid-cols-[auto_1fr_auto_auto_auto_auto] gap-4 items-center px-5 py-4 hover:bg-zinc-800/50 transition-colors group"
              >
                <span className="text-sm font-mono text-zinc-300 shrink-0">
                  {invoice.invoice_number}
                </span>
                <span className="text-sm text-white truncate">
                  {(invoice.jp_customers as any)?.name ?? '—'}
                </span>
                <span className="hidden sm:block text-sm text-zinc-400">
                  {formatDate(invoice.issue_date)}
                </span>
                <span className="hidden sm:block text-sm text-zinc-400">
                  {formatDate(invoice.due_date)}
                </span>
                <span className="hidden sm:block text-sm font-medium text-right">
                  {formatCurrency(invoice.total_amount, invoice.currency)}
                </span>
                <div className="flex items-center justify-end gap-2 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_COLORS[invoice.status]}`}
                  >
                    {STATUS_LABELS[invoice.status]}
                  </span>
                  <ChevronRight
                    size={14}
                    className="text-zinc-600 group-hover:text-zinc-400 transition-colors"
                  />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
