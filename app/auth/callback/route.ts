import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Organisaation luonti tapahtuu /onboarding-sivulla, ei täällä.
      // Aiemmin tämä reitti loi jp_organizations-rivin suoraan
      // signup-lomakkeen user_metadata.company_name:n perusteella,
      // mikä ohitti /onboarding:n kokonaan — käyttäjä ei koskaan
      // päässyt valitsemaan toimialaa/maata/valuuttaa, ja Y-tunnuk-
      // settomat kevytyrittäjät joutuivat kirjoittamaan oman nimensä
      // "Yrityksen nimi" -kenttään signup-vaiheessa. (dashboard)/
      // layout.tsx ohjaa jo automaattisesti /onboarding-sivulle kun
      // organisaatiota ei löydy, joten pelkkä uudelleenohjaus tänne
      // riittää — /onboarding hoitaa loput.
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_error`)
}
