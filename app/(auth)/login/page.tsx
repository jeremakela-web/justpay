'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Mode = 'signin' | 'signup'

const INPUT =
  'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [businessId, setBusinessId] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
    setMessage(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError('Virheellinen sähköposti tai salasana.')
      } else {
        router.push('/')
        router.refresh()
      }
    } else {
      if (!companyName.trim()) {
        setError('Yrityksen nimi on pakollinen.')
        setLoading(false)
        return
      }
      if (!termsAccepted) {
        setError('Hyväksy käyttöehdot jatkaaksesi.')
        setLoading(false)
        return
      }

      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${location.origin}/auth/callback`,
          data: {
            company_name: companyName.trim(),
            business_id: businessId.trim() || null,
          },
        },
      })
      if (error) {
        setError(error.message)
      } else {
        setMessage(
          'Tarkista sähköpostisi ja vahvista rekisteröityminen. Löydät viestin myös roskapostista.'
        )
      }
    }

    setLoading(false)
  }

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          Just<span className="text-green-500">.</span>Pay
        </h1>
        <p className="mt-2 text-zinc-400 text-sm">Laskutusalusta</p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
        <div className="flex bg-zinc-800 rounded-lg p-1 mb-6">
          <button
            type="button"
            onClick={() => switchMode('signin')}
            className={`flex-1 py-1.5 text-sm rounded-md transition-colors ${
              mode === 'signin' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Kirjaudu
          </button>
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className={`flex-1 py-1.5 text-sm rounded-md transition-colors ${
              mode === 'signup' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Luo tili
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <>
              <div>
                <label className="block text-sm text-zinc-400 mb-1.5">
                  Yrityksen nimi <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className={INPUT}
                  placeholder="Oma Yritys Oy"
                />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-1.5">
                  Y-tunnus <span className="text-zinc-600 text-xs">(valinnainen)</span>
                </label>
                <input
                  type="text"
                  value={businessId}
                  onChange={(e) => setBusinessId(e.target.value)}
                  className={INPUT}
                  placeholder="1234567-8"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Sähköposti</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={INPUT}
              placeholder="sinä@yritys.fi"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Salasana</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT}
              placeholder="••••••••"
              minLength={6}
            />
          </div>

          {mode === 'signup' && (
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded accent-green-500 shrink-0"
              />
              <span className="text-xs text-zinc-400 leading-relaxed">
                Olen lukenut ja hyväksyn{' '}
                <Link
                  href="/terms"
                  target="_blank"
                  className="text-green-400 hover:text-green-300 underline underline-offset-2"
                >
                  käyttöehdot
                </Link>
              </span>
            </label>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5 text-sm text-red-400">
              {error}
            </div>
          )}

          {message && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2.5 text-sm text-green-400">
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
          >
            {loading
              ? 'Odota...'
              : mode === 'signin'
              ? 'Kirjaudu sisään'
              : 'Luo tili'}
          </button>
        </form>
      </div>
    </div>
  )
}
