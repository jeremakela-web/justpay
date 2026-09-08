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
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmationSent, setConfirmationSent] = useState(false)
  const [resending, setResending] = useState(false)

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
    setMessage(null)
    setConfirmationSent(false)
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
      if (!termsAccepted) {
        setError('Hyväksy käyttöehdot jatkaaksesi.')
        setLoading(false)
        return
      }

      // Yritys-/henkilötiedot (nimi, Y-tunnus, toimiala, maa, valuutta)
      // kysytään /onboarding-sivulla sähköpostivahvistuksen jälkeen —
      // ei täällä. Aiemmin tämä lomake keräsi "Yrityksen nimen" jo
      // tässä vaiheessa ja /auth/callback loi organisaation suoraan
      // sen perusteella, mikä ohitti /onboarding-sivun kokonaan eikä
      // koskaan kysynyt toimialaa/maata/valuuttaa — ja pakotti myös
      // Y-tunnuksettomat kevytyrittäjät kirjoittamaan oman nimensä
      // "Yrityksen nimi" -kenttään. Yksi lomake, oikeat kentät,
      // molemmille kohderyhmille (ks. onboarding-sivun kenttien
      // haarautus tili tyypin mukaan).
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${location.origin}/auth/callback`,
        },
      })
      if (error) {
        setError(error.message)
      } else if (data.session) {
        // Projektin Auth-asetuksissa "Confirm email" on pois päältä
        // (autoconfirm) — signUp() palauttaa silloin jo voimassa
        // olevan sessionin eikä mitään vahvistusviestiä koskaan
        // lähetetä. Aiemmin tämä haara ei tarkistanut sitä lainkaan
        // ja näytti "tarkista sähköpostisi" -viestin joka tapauksessa,
        // jolloin käyttäjä jäi odottamaan sähköpostia jota ei koskaan
        // tule eikä koskaan päässyt /onboarding-sivulle asti, vaikka
        // oli jo kirjautuneena sisään. (dashboard)/layout.tsx ohjaa jo
        // /onboarding-sivulle kun organisaatiota ei löydy.
        router.push('/')
        router.refresh()
      } else {
        setMessage(
          'Tarkista sähköpostisi ja vahvista rekisteröityminen. Löydät viestin myös roskapostista.'
        )
        setConfirmationSent(true)
      }
    }

    setLoading(false)
  }

  // Vahvistusviesti kulkee Supabase Authin oman postituksen kautta
  // (ei Resendin), ja Supabasen oletuslähetys voi olla hidas tai
  // rajoitettu — uudelleenlähetys auttaa jos viestiä ei kuulu.
  const handleResendConfirmation = async () => {
    if (!email.trim()) return
    setResending(true)
    setError(null)
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    if (error) {
      setError(error.message)
    } else {
      setMessage('Vahvistusviesti lähetetty uudelleen. Tarkista sähköpostisi ja roskaposti.')
    }
    setResending(false)
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
          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Sähköposti</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={INPUT}
              placeholder="sinä@esimerkki.fi"
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
            <>
              <p className="text-xs text-zinc-500 -mt-1">
                Kysymme nimesi (tai yrityksesi nimen) ja muut tiedot heti kun
                olet vahvistanut sähköpostisi.
              </p>
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
            </>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5 text-sm text-red-400">
              {error}
            </div>
          )}

          {message && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2.5 text-sm text-green-400 space-y-2">
              <p>{message}</p>
              {confirmationSent && (
                <button
                  type="button"
                  onClick={handleResendConfirmation}
                  disabled={resending}
                  className="text-xs text-green-300 hover:underline disabled:opacity-50"
                >
                  {resending ? 'Lähetetään uudelleen...' : 'Eikö viesti tullut? Lähetä uudelleen'}
                </button>
              )}
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
