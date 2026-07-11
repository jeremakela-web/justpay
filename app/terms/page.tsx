import Link from 'next/link'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <div className="mb-8">
          <Link
            href="/login"
            className="text-sm text-zinc-400 hover:text-white transition-colors"
          >
            ← Takaisin
          </Link>
        </div>

        <h1 className="text-3xl font-bold mb-2">
          Just<span className="text-green-400">.</span>Pay — Käyttöehdot
        </h1>
        <p className="text-zinc-500 text-sm mb-10">Päivitetty 1.7.2026</p>

        <div className="space-y-8 text-zinc-300 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">1. Palvelun kuvaus</h2>
            <p>
              Just.Pay on laskutusalusta, joka mahdollistaa laskujen luomisen, lähettämisen ja
              hallinnan. Palvelu on tarkoitettu yrityksille ja itsenäisille ammatinharjoittajille.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">2. Käyttöoikeus</h2>
            <p>
              Rekisteröitymällä saat henkilökohtaisen, ei-siirrettävän oikeuden käyttää
              palvelua. Olet vastuussa tilisi turvallisuudesta ja kaikesta tilisi kautta
              tapahtuvasta toiminnasta.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">3. Tietosuoja</h2>
            <p>
              Käsittelemme henkilötietoja EU:n yleisen tietosuoja-asetuksen (GDPR) mukaisesti.
              Tallennettuja tietoja käytetään ainoastaan palvelun tarjoamiseen. Tietoja ei
              luovuteta kolmansille osapuolille ilman suostumustasi.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">4. Vastuunrajoitus</h2>
            <p>
              Palvelu tarjotaan &quot;sellaisena kuin se on&quot;. Emme vastaa palvelun
              käytöstä mahdollisesti aiheutuvista välillisistä vahingoista.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">5. Muutokset ehtoihin</h2>
            <p>
              Pidätämme oikeuden muuttaa näitä ehtoja. Olennaisista muutoksista ilmoitetaan
              sähköpostitse vähintään 14 päivää ennen voimaantuloa.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">6. Yhteystiedot</h2>
            <p>
              Kysymykset käyttöehtoihin liittyen:{' '}
              <a
                href="mailto:info@justpay.fi"
                className="text-green-400 hover:text-green-300"
              >
                info@justpay.fi
              </a>
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-zinc-800">
          <Link
            href="/login"
            className="inline-block bg-green-600 hover:bg-green-500 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
          >
            Palaa rekisteröitymään
          </Link>
        </div>
      </div>
    </div>
  )
}
