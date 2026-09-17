import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createSigningDocument, sendForSigning, getDocument } from '@/lib/bink'

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

  // TEMPORARY DIAGNOSTIC — ?force=true skips the resend branch below
  // and always quick-creates a brand-new Bink document instead. Added
  // specifically because an earlier signingMethod:'strong' attempt got
  // stuck as an existing jp_contract_signatures row whose Bink document
  // needs strong-tier credits (account balance: 0) to resend — without
  // this, every retry keeps hitting that same stuck document forever,
  // even while testing the light/email tier, which has free credits.
  //
  // Deliberately gated on Netlify's own CONTEXT rather than NODE_ENV:
  // `next build` always sets NODE_ENV=production, including on
  // deploy previews, so a NODE_ENV check would have disabled this
  // exactly where it's needed right now. CONTEXT correctly
  // distinguishes 'production' from 'deploy-preview'/'branch-deploy'/
  // 'dev' (https://docs.netlify.com/configure-builds/environment-variables/#build-metadata).
  //
  // TODO: remove this whole `force` block (or lock it behind an
  // explicit admin-only check) before migration_010 runs and before
  // real production use — every forced call burns a real Bink
  // document, and on the strong tier a real paid credit. Left
  // unguarded, a repeated/scripted call to this endpoint could run up
  // a real bill.
  const force = request.nextUrl.searchParams.get('force') === 'true'
  if (force && process.env.CONTEXT === 'production') {
    return NextResponse.json(
      { error: 'force ei ole sallittu tuotannossa.' },
      { status: 403 }
    )
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

  // Our own status column only ever gets updated by the webhook, which
  // depends on Bink successfully delivering the event AND our handler
  // processing it — either can silently fail (delivery never arrives,
  // signature check fails, a bug in the handler, etc.), leaving this
  // row stuck at 'in_process' even though Bink itself considers the
  // document fully signed. Left unchecked, that stuck row makes every
  // subsequent visit try to resend a document Bink now refuses to
  // touch (it 500s with "Failed to prepare document for signing"
  // instead of the normal resend response), which is confusing to a
  // user who already finished signing. Ask Bink directly before
  // deciding what to do, and self-heal if it disagrees with us.
  if (existing && existing.status !== 'signed' && !force) {
    try {
      const liveDoc = await getDocument(existing.provider_document_id)
      const liveStatus =
        (liveDoc as { status?: unknown }).status ??
        (liveDoc as { document?: { status?: unknown } }).document?.status
      if (liveStatus === 'signed') {
        const nowIso = new Date().toISOString()
        const { error: reconcileErr } = await supabase
          .from('jp_contract_signatures')
          .update({ status: 'signed', updated_at: nowIso })
          .eq('id', existing.id)
        if (reconcileErr) {
          console.error('Failed to reconcile signature row to signed (self-heal):', reconcileErr)
        }
        const { error: orgReconcileErr } = await supabase
          .from('jp_organizations')
          .update({ contract_signed_at: nowIso })
          .eq('id', org.id)
        if (orgReconcileErr) {
          console.error('Failed to reconcile jp_organizations.contract_signed_at (self-heal):', orgReconcileErr)
        }
        return NextResponse.json({ success: true, alreadySigned: true })
      }
    } catch (err) {
      // Fail open — if we can't reach Bink to check, fall through to
      // the existing resend behavior rather than blocking the user on
      // a diagnostic check that isn't the primary flow.
      console.error('Bink getDocument status check (pre-resend) failed:', err)
    }

    try {
      await sendForSigning(existing.provider_document_id)
    } catch (err) {
      console.error('Bink resend send-for-signing failed:', err)
      // TEMPORARY — same debug surfacing as the fresh-creation path
      // below, added here too since this is a genuinely separate code
      // branch (resend an existing jp_contract_signatures row instead
      // of quick-create-ing a new one) that was missing it. REVERT
      // together with the other debug surfacing once no longer needed.
      const debugDetail = err instanceof Error ? err.message : String(err)
      return NextResponse.json(
        {
          error: 'Allekirjoituskutsun uudelleenlähetys epäonnistui. Yritä myöhemmin uudelleen.',
          debug: debugDetail,
        },
        { status: 502 }
      )
    }
    return NextResponse.json({ success: true, resent: true })
  }

  if (existing && existing.status !== 'signed' && force) {
    // Mark the stale row as superseded rather than leaving it an
    // orphan with no record of why it stopped being the active
    // attempt. Repurposes the 'draft' status value: it's part of the
    // CHECK constraint (migration_009) but never actually set by the
    // normal flow (which goes straight to 'in_process'), so reusing it
    // here as "no longer current" doesn't collide with anything and
    // avoids a schema migration while migration_010 stays frozen and
    // DB changes are being kept to a minimum.
    const { error: supersedeErr } = await supabase
      .from('jp_contract_signatures')
      .update({ status: 'draft', updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (supersedeErr) {
      console.error('Failed to mark stale jp_contract_signatures row as superseded:', supersedeErr)
    }
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
      // TEMPORARY — 'light' while lib/bink.ts is temporarily sending
      // Bink signingMethod:'email' for the credit-balance test. Must
      // flip back to 'strong' together with that revert, or this row
      // would falsely record a light-tier document as strong.
      method: 'light',
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
    // TEMPORARY — surfacing the real error to the client for the live
    // sandbox test, since Netlify function logs aren't reachable from
    // here. err.message only ever contains Bink's HTTP status + response
    // body or a missing-env-var message — never the henkilötunnus itself
    // (createSigningDocument/sendForSigning never echo `pic` back into
    // their own thrown Error). REVERT after this test is done.
    const debugDetail = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      {
        error: 'Allekirjoitusprosessin käynnistys epäonnistui. Yritä myöhemmin uudelleen.',
        debug: debugDetail,
      },
      { status: 502 }
    )
  }
}
