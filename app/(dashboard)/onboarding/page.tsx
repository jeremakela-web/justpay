'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const COUNTRIES = [
  { code: 'FI', name: 'Suomi' },
  { code: 'SE', name: 'Ruotsi' },
  { code: 'NO', name: 'Norja' },
  { code: 'DK', name: 'Tanska' },
  { code: 'DE', name: 'Saksa' },
  { code: 'EE', name: 'Viro' },
]

const CURRENCIES = [
  { code: 'EUR', name: 'Euro (€)' },
  { code: 'SEK', name: 'Ruotsin kruunu (kr)' },
  { code: 'NOK', name: 'Norjan kruunu (kr)' },
  { code: 'DKK', name: 'Tanskan kruunu (kr)' },
]

export default function OnboardingPage() {
  const router = useRouter()
  const supabase = createClient()

  const [name, setName] = useState('')
  const [businessId, setBusinessId] = useState('')
  const [country, setCountry] = useState('FI')
  const [currency, setCurrency] = useState('EUR')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setSaving(true)
    setError(null)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      router.push('/login')
      return
    }

    const { error } = await supabase.from('jp_organizations').insert({
      owner_user_id: user.id,
      name: name.trim(),
      business_id: businessId.trim() || null,
      country,
      currency,
    })

    if (error) {
      setError(error.message)
      setSaving(false)
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">
            Just<span className="text-green-500">.</span>Pay
          </h1>
          <p className="mt-3 text-zinc-400">
            Tervetuloa! Kerro ensin yrityksestäsi.
          </p>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
          <h2 className="text-lg font-semibold mb-6">Yrityksen tiedot</h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">
                Yrityksen nimi <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500"
                placeholder="Yritys Oy"
              />
            </div>

            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">
                Y-tunnus
              </label>
              <input
                type="text"
                value={businessId}
                onChange={(e) => setBusinessId(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500"
                placeholder="1234567-8"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-zinc-400 mb-1.5">
                  Maa <span className="text-red-400">*</span>
                </label>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500"
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-zinc-400 mb-1.5">
                  Valuutta <span className="text-red-400">*</span>
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5 text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg text-sm transition-colors mt-2"
            >
              {saving ? 'Tallennetaan...' : 'Aloita →'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
