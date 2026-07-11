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
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        const { data: existingOrg } = await supabase
          .from('jp_organizations')
          .select('id')
          .eq('owner_user_id', user.id)
          .maybeSingle()

        if (!existingOrg && user.user_metadata?.company_name) {
          await supabase.from('jp_organizations').insert({
            owner_user_id: user.id,
            name: user.user_metadata.company_name as string,
            business_id: (user.user_metadata.business_id as string) || null,
            country: 'FI',
            currency: 'EUR',
          })
        }
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_error`)
}
