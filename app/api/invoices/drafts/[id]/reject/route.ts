import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: draftId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Ei oikeuksia' }, { status: 401 })
  }

  const { data: org } = await supabase
    .from('jp_organizations')
    .select('id')
    .eq('owner_user_id', user.id)
    .maybeSingle()

  if (!org) {
    return NextResponse.json({ error: 'Organisaatiota ei löydy.' }, { status: 400 })
  }

  const { data: draft, error: draftErr } = await supabase
    .from('jp_invoice_drafts')
    .select('id, status')
    .eq('id', draftId)
    .eq('org_id', org.id)
    .maybeSingle()

  if (draftErr || !draft) {
    return NextResponse.json({ error: 'Draftia ei löydy.' }, { status: 404 })
  }

  if (draft.status === 'approved') {
    return NextResponse.json(
      { error: 'Hyväksyttyä draftia ei voi enää hylätä.' },
      { status: 400 }
    )
  }

  const { error: updateErr } = await supabase
    .from('jp_invoice_drafts')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .eq('id', draftId)

  if (updateErr) {
    return NextResponse.json({ error: 'Hylkäys epäonnistui. Yritä uudelleen.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
