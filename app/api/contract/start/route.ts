import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createSigningDocument, sendForSigning } from '@/lib/bink'

// Very loose Finnish henkilötunnus format check (DDMMYY + century
// separator + 3 digits + checksum char) — catches obvious typos
// before wasting a Bink API call/signature credit. Does NOT validate
// the actual mod-31 checksum, so a well-formed but wrong pic can still
// get through this check — Bink's own verification during the
// pankkitunnukset/mobiilivarmenne step is the real check.
const PIC_FORMAT = /^\d{6}[+\-A]\d{3}[0-9A-Z]$/

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !user.email) {
    return NextResponse.json({ error: 'Ei oikeuksia' }, { status: 401 })
  }

  let body: { pic?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Virheellinen pyyntö' }, { status: 400 })
  }

  const pic = body.pic?.trim().toUpperCase()
  if (!pic || !PIC_FORMAT.test(pic)) {
    return NextResponse.json(
      { error: 'Henkilötunnus puuttuu tai on väärässä muodossa.' },
      { status: 400 }
    )
  }

  const { data: org, error: orgErr } = await supabase
    .from('jp_organizations')
    .select('id, name, contract_signed_at')
    .eq('owner_user_id', user.id)
    .maybeSingle()

  if (orgErr || !org) {
    return NextResponse.json(
      { error: 'Organisaatiota ei löydy. Täytä ensin yrityksesi tiedot.' },
      { status: 400 }
    )
  }

  if (org.contract_signed_at) {
    return NextResponse.json({ success: true, alreadySigned: true })
  }

  // If a signing attempt is already in progress for this org, resend
  // the invite instead of creating a second Bink document (and
  // burning a second signature credit) for a repeated click.
  const { data: existing } = await supabase
    .from('jp_contract_signatures')
    .select('id, provider_document_id, status')
    .eq('org_id', org.id)
    .eq('provider', 'bink')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing && existing.status !== 'signed') {
    try {
      await sendForSigning(existing.provider_document_id)
    } catch (err) {
      console.error('Bink resend send-for-signing failed:', err)
      return NextResponse.json(
        { error: 'Allekirjoituskutsun uudelleenlähetys epäonnistui. Yritä myöhemmin uudelleen.' },
        { status: 502 }
      )
    }
    return NextResponse.json({ success: true, resent: true })
  }

  const { data: template, error: templateErr } = await supabase
    .from('jp_contract_templates')
    .select('*')
    .eq('is_active', true)
    .maybeSingle()

  if (templateErr || !template) {
    console.error('No active jp_contract_templates row:', templateErr)
    return NextResponse.json(
      { error: 'Sopimuspohjaa ei ole vielä määritetty. Ota yhteyttä ylläpitoon.' },
      { status: 503 }
    )
  }

  const { data: fileBlob, error: downloadErr } = await supabase.storage
    .from('contract-templates')
    .download(template.storage_path)

  if (downloadErr || !fileBlob) {
    console.error('Contract template download failed:', downloadErr)
    return NextResponse.json(
      { error: 'Sopimuspohjan lataus epäonnistui. Ota yhteyttä ylläpitoon.' },
      { status: 503 }
    )
  }

  const fileBuffer = Buffer.from(await fileBlob.arrayBuffer())

  try {
    const created = await createSigningDocument({
      fileBuffer,
      fileName: `${template.storage_path.split('/').pop() ?? 'sopimus'}`,
      title: `Toimeksianto-/laskutuspalvelusopimus – ${org.name}`,
      signingMessage:
        'Allekirjoita Just.Pay-toimeksianto-/laskutuspalvelusopimus vahvalla tunnistautumisella.',
      emailLanguage: 'fi',
      signee: {
        email: user.email,
        name: org.name,
        pic,
      },
    })

    const { error: insertErr } = await supabase.from('jp_contract_signatures').insert({
      org_id: org.id,
      contract_version: template.version,
      provider: 'bink',
      method: 'strong',
      provider_document_id: created.document.id,
      status: 'in_process',
    })

    if (insertErr) throw insertErr

    const sendResult = await sendForSigning(created.document.id, 'fi')
    if (sendResult.credit) {
      // Surfaced per the go-live-audit note: worth knowing before we
      // actually run out of strong-signature credits, not after.
      console.log('Bink signature credit balance:', sendResult.credit)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Bink signing flow failed:', err)
    return NextResponse.json(
      { error: 'Allekirjoitusprosessin käynnistys epäonnistui. Yritä myöhemmin uudelleen.' },
      { status: 502 }
    )
  }
}
