'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Customer } from '@/types/database'
import { Plus, Users } from 'lucide-react'

export default function CustomersPage() {
  const supabase = createClient()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchCustomers = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const { data: org } = await supabase
        .from('jp_organizations')
        .select('id')
        .eq('owner_user_id', user.id)
        .maybeSingle()

      if (!org) return

      const { data } = await supabase
        .from('jp_customers')
        .select('*')
        .eq('org_id', org.id)
        .order('name')

      setCustomers(data || [])
      setLoading(false)
    }
    fetchCustomers()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Asiakkaat</h1>
        <Link
          href="/customers/new"
          className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} />
          Uusi asiakas
        </Link>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : customers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <div className="w-12 h-12 bg-zinc-800 rounded-full flex items-center justify-center mb-4">
              <Users size={22} className="text-zinc-500" />
            </div>
            <p className="text-zinc-400 text-sm">
              Ei asiakkaita vielä. Lisää ensimmäinen asiakas!
            </p>
            <Link
              href="/customers/new"
              className="mt-4 bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Lisää asiakas
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800">
            <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto] gap-4 px-5 py-3 text-xs text-zinc-500 font-medium uppercase tracking-wide">
              <span>Nimi</span>
              <span>Tyyppi</span>
              <span>Maa</span>
              <span>Sähköposti</span>
            </div>
            {customers.map((customer) => (
              <div
                key={customer.id}
                className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-1 sm:gap-4 items-center px-5 py-4"
              >
                <div>
                  <p className="text-sm font-medium text-white">{customer.name}</p>
                  {customer.business_id && (
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {customer.business_id}
                    </p>
                  )}
                </div>
                <span className="text-sm text-zinc-400">
                  {customer.type === 'company' ? 'Yritys' : 'Yksityinen'}
                </span>
                <span className="text-sm text-zinc-400">{customer.country}</span>
                <span className="text-sm text-zinc-400">
                  {customer.email ?? '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
