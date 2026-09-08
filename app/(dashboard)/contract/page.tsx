'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function ContractPage() {
  const router = useRouter()
  const supabase = createClient()

  const [pic, setPic] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [checkingStatus, setCheckingStatus] = useState(true)

  // Jos sopimus tulee allekirjoitetuksi taustalla (webhook) sillä
  // aikaa kun tämä sivu on auki, tarkista tila uudelleen kun ikkuna
  // saa fokuksen — käyttäjän ei tarvitse osata itse päivittää sivua.
  useEffect(() => {
    const checkSigned = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const { data: org } = await supabase
        .from('jp_organizations')
        .select('contract_signed_at')
        .eq('owner_user_id', user.id)
        .maybeSingle()
      if (org?.contract_signed_at) {
        router.push('/')
        router.refresh()
        return
      }
      setCheckingStatus(false)
    }
    checkSigned()
    window.addEventListener('focus', checkSigned)
    return () => window.removeEventListener('focus', checkSigned)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/contract/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pic: pic.trim() }),
      })
      const data = (await res.json()) as {
        success?: boolean
        alreadySigned?: boolean
        resent?: boolean
        error?: string
        debug?: string
      }

      if (!res.ok || data.error) {
        // TEMPORARY — data.debug is only ever present during the live
        // sandbox test (see the matching TEMPORARY comment in
        // app/api/contract/start/route.ts). REVERT both together.
        setError(
          data.debug ? `${data.error} [DEBUG: ${data.debug}]` : data.error ?? 'Allekirjoitusprosessin käynnistys epäonnistui.'
        )
        setSubmitting(false)
        return
      }

      if (data.alreadySigned) {
        router.push('/')
        router.refresh()
        return
      }

      setSent(true)
    } catch {
      setError('Allekirjoitusprosessin käynnistys epäonnistui. Yritä uudelleen.')
    } finally {
      setSubmitting(false)
    }
  }

  if (checkingStatus) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">
            Just<span className="text-green-500">.</span>Pay
          </h1>
          <p className="mt-3 text-zinc-400">
            Yksi asia vielä ennen kuin pääset alkuun.
          </p>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
          {sent ? (
            <div className="text-center space-y-3">
              <h2 className="text-lg font-semibold">Tarkista sähköpostisi</h2>
              <p className="text-sm text-zinc-400">
                Lähetimme sinulle sähköpostitse linkin toimeksianto-/
                laskutuspalvelusopimuksen allekirjoittamiseen vahvalla
                tunnistautumisella. Kun olet allekirjoittanut, pääset
                jatkamaan tänne palatessasi.
              </p>
              <button
                onClick={() => {
                  setSent(false)
                  setCheckingStatus(true)
                  window.location.reload()
                }}
                className="text-sm text-green-500 hover:underline mt-2"
              >
                Lähetä uudelleen / tarkista tila
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold mb-2">
                Toimeksianto-/laskutuspalvelusopimus
              </h2>
              <p className="text-sm text-zinc-400 mb-6">
                Just.Pay-palvelun käyttö edellyttää allekirjoitettua
                toimeksianto-/laskutuspalvelusopimusta Kansallisvaranto
                Oy:n kanssa. Allekirjoitus tehdään vahvalla
                tunnistautumisella (pankkitunnukset tai
                mobiilivarmenne).
              </p>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm text-zinc-400 mb-1.5">
                    Henkilötunnus <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={pic}
                    onChange={(e) => setPic(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500"
                    placeholder="DDMMYY-NNNC"
                  />
                  <p className="mt-1.5 text-xs text-zinc-500">
                    Tarvitaan vahvaa tunnistautumista varten. Emme
                    tallenna henkilötunnustasi — se välitetään suoraan
                    tunnistautumispalveluun.
                  </p>
                </div>

                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5 text-sm text-red-400">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !pic.trim()}
                  className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
                >
                  {submitting ? 'Käynnistetään...' : 'Aloita allekirjoitus →'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
