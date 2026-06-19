'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft } from 'lucide-react'

const COUNTRIES = [
  { code: 'FI', name: 'Suomi' },
  { code: 'SE', name: 'Ruotsi' },
  { code: 'NO', name: 'Norja' },
  { code: 'DK', name: 'Tanska' },
  { code: 'DE', name: 'Saksa' },
  { code: 'EE', name: 'Viro' },
  { code: 'LV', name: 'Latvia' },
  { code: 'LT', name: 'Liettua' },
  { code: 'GB', name: 'Iso-Britannia' },
  { code: 'US', name: 'Yhdysvallat' },
  { code: 'OTHER', name: 'Muu' },
]

export default function NewCustomerPage() {
  const router = useRouter()
  const supabase = createClient()

  const [name, setName] = useState('')
  const [type, setType] = useState<'company' | 'individual'>('company')
  const [country, setCountry] = useState('FI')
  const [businessId, setBusinessId] = useState('')
  const [vatNumber, setVatNumber] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [postalCode, setPostalCode] = useState('')
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
    if (!user) return

    const { data: org } = await supabase
      .from('jp_organizations')
      .select('id')
      .eq('owner_user_id', user.id)
      .maybeSingle()

    if (!org) {
      setError('Organisaatiota ei löydy.')
      setSaving(false)
      return
    }

    const { error } = await supabase.from('jp_customers').insert({
      org_id: org.id,
      name: name.trim(),
      type,
      country,
      business_id: businessId.trim() || null,
      vat_number: vatNumber.trim() || null,
      email: email.trim() || null,
      address: address.trim() || null,
      city: city.trim() || null,
      postal_code: postalCode.trim() || null,
    })

    if (error) {
      setError(error.message)
      setSaving(false)
      return
    }

    router.push('/customers')
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/customers"
          className="text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-bold">Uusi asiakas</h1>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Type toggle */}
          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Tyyppi</label>
            <div className="flex bg-zinc-800 rounded-lg p-1 w-fit">
              <button
                type="button"
                onClick={() => setType('company')}
                className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                  type === 'company'
                    ? 'bg-zinc-700 text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Yritys
              </button>
              <button
                type="button"
                onClick={() => setType('individual')}
                className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                  type === 'individual'
                    ? 'bg-zinc-700 text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Yksityishenkilö
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">
              {type === 'company' ? 'Yrityksen nimi' : 'Nimi'}{' '}
              <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500"
              placeholder={type === 'company' ? 'Asiakas Oy' : 'Matti Meikäläinen'}
            />
          </div>

          {type === 'company' && (
            <div className="grid grid-cols-2 gap-4">
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
              <div>
                <label className="block text-sm text-zinc-400 mb-1.5">
                  ALV-tunnus
                </label>
                <input
                  type="text"
                  value={vatNumber}
                  onChange={(e) => setVatNumber(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500"
                  placeholder="FI12345678"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">Maa</label>
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
                Sähköposti
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500"
                placeholder="laskut@asiakas.fi"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">
              Katuosoite
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500"
              placeholder="Esimerkkikatu 1"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">
                Postinumero
              </label>
              <input
                type="text"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500"
                placeholder="00100"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">
                Kaupunki
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500"
                placeholder="Helsinki"
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Link
              href="/customers"
              className="flex-1 text-center bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium py-2.5 rounded-lg text-sm transition-colors"
            >
              Peruuta
            </Link>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
            >
              {saving ? 'Tallennetaan...' : 'Tallenna asiakas'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
