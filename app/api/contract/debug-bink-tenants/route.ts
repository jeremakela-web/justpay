import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// TEMPORARY DIAGNOSTIC — not part of the feature, added to pin down the
// identical 403 Forbidden on quick-create reproduced across two
// completely independent, freshly-created Bink accounts/tenants. Calls
// Bink's own GET /api/tenants and GET /api/tenants/{tenantId} directly
// with whatever BINK_API_KEY/BINK_TENANT_ID are actually configured in
// this deploy context right now — this asks Bink the same question we
// keep asking ourselves, instead of inferring it from a dashboard that
// doesn't expose it. Gated behind a logged-in session so it isn't a
// public unauthenticated endpoint even temporarily. REMOVE once the 403
// is understood — this is not meant to ship.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Ei oikeuksia' }, { status: 401 })
  }

  const apiKey = process.env.BINK_API_KEY
  const tenantId = process.env.BINK_TENANT_ID
  const env = process.env.BINK_ENV === 'production' ? 'production' : 'sandbox'
  const baseUrl = env === 'production' ? 'https://api.bink.fi' : 'https://sandbox-api.bink.fi'

  if (!apiKey || !tenantId) {
    return NextResponse.json({ error: 'BINK_API_KEY tai BINK_TENANT_ID ei ole asetettu' }, { status: 500 })
  }

  const headers = { 'x-api-key': apiKey }

  const [listRes, membershipRes] = await Promise.all([
    fetch(`${baseUrl}/api/tenants`, { headers }),
    fetch(`${baseUrl}/api/tenants/${tenantId}`, { headers }),
  ])

  const [listBody, membershipBody] = await Promise.all([
    listRes.text(),
    membershipRes.text(),
  ])

  return NextResponse.json({
    base_url: baseUrl,
    configured_tenant_id_prefix: tenantId.slice(0, 8),
    list_tenants: { status: listRes.status, body: safeJson(listBody) },
    tenant_membership: { status: membershipRes.status, body: safeJson(membershipBody) },
  })
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
