import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

// TEMPORARY — one-shot diagnostic for the force=true investigation.
// Gated on a secret we already have configured for this app
// (BINK_WEBHOOK_SECRET) plus the same CONTEXT !== 'production' guard
// used by the force flag in app/api/contract/start/route.ts, so this
// never becomes a real endpoint. DELETE after the investigation.
export async function GET(request: NextRequest) {
  if (process.env.CONTEXT === 'production') {
    return NextResponse.json({ error: 'not available in production' }, { status: 403 })
  }

  const key = request.nextUrl.searchParams.get('key')
  if (!key || key !== process.env.BINK_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const supabase = createServiceClient()

  const { data: signatures, error: sigErr } = await supabase
    .from('jp_contract_signatures')
    .select('id, org_id, contract_version, provider, method, status, provider_document_id, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(10)

  const { data: orgs, error: orgErr } = await supabase
    .from('jp_organizations')
    .select('id, name, owner_user_id, contract_signed_at')
    .order('id')

  return NextResponse.json({
    context: process.env.CONTEXT,
    signatures,
    sigErr: sigErr?.message ?? null,
    orgs,
    orgErr: orgErr?.message ?? null,
  })
}
