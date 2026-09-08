import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature, getDocument, type BinkWebhookPayload } from '@/lib/bink'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Bink.fi webhook receiver — document.status_changed events.
 *
 * This route has no user session (Bink calls it server-to-server), so
 * it's the one place in the app that uses the service-role Supabase
 * client. Everything here is deliberately narrow: verify signature →
 * dedupe → look up the signature row by provider_document_id → if
 * newStatus is 'signed', fetch verification details and write
 * jp_contract_signatures + jp_organizations.contract_signed_at. No
 * other tables are touched from this route.
 *
 * Response codes follow Bink's documented contract exactly:
 *   invalid signature      -> 401, no retry
 *   malformed/unknown event -> 400, no retry
 *   duplicate event id      -> 200, silently ignored
 *   processing error        -> non-2xx, triggers their retry (max 3, 5s timeout)
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const secret = process.env.BINK_WEBHOOK_SECRET

  if (!secret) {
    // Fails closed: if we don't have a secret configured, we cannot
    // verify anything, so we must not trust the request.
    console.error('BINK_WEBHOOK_SECRET is not set — rejecting webhook')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 401 })
  }

  const signatureHeader = request.headers.get('x-bink-signature')
  const webhookId = request.headers.get('x-bink-webhook-id')
  const eventType = request.headers.get('x-bink-webhook-event')

  if (!verifyWebhookSignature(rawBody, signatureHeader, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  if (!webhookId) {
    return NextResponse.json({ error: 'Missing x-bink-webhook-id' }, { status: 400 })
  }

  let payload: BinkWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 })
  }

  if (payload.type !== 'document.status_changed' || !payload.data?.documentId) {
    return NextResponse.json({ error: 'Unrecognized event' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Dedupe on the webhook's own event id — but only skip if a PRIOR
  // attempt actually completed (succeeded_at set). A row with
  // succeeded_at still NULL means an earlier delivery started but
  // never finished, so this retry should be allowed through rather
  // than swallowed. See migration_009's comment on this table for why
  // that distinction matters for Bink's retry model.
  const { data: existingDedupe } = await supabase
    .from('jp_webhook_dedupe')
    .select('succeeded_at')
    .eq('event_id', webhookId)
    .maybeSingle()

  if (existingDedupe?.succeeded_at) {
    return NextResponse.json({ received: true, duplicate: true }, { status: 200 })
  }

  if (!existingDedupe) {
    const { error: dedupeInsertErr } = await supabase
      .from('jp_webhook_dedupe')
      .insert({ event_id: webhookId, provider: 'bink' })
    // A conflict here means a concurrent delivery of the same event
    // won the race to insert first — treat it the same as "already
    // being handled" and let this request retry later rather than
    // double-process concurrently.
    if (dedupeInsertErr) {
      if (dedupeInsertErr.code === '23505') {
        return NextResponse.json({ received: true, duplicate: true }, { status: 200 })
      }
      console.error('Webhook dedupe insert failed:', dedupeInsertErr, { eventType })
      return NextResponse.json({ error: 'Dedupe write failed' }, { status: 500 })
    }
  }

  const { documentId, newStatus, changedAt } = payload.data

  try {
    const { data: signatureRow, error: findErr } = await supabase
      .from('jp_contract_signatures')
      .select('id, org_id')
      .eq('provider', 'bink')
      .eq('provider_document_id', documentId)
      .maybeSingle()

    if (findErr) throw findErr

    if (!signatureRow) {
      // A status change for a document we have no record of starting.
      // Not our webhook secret's fault, not a signature problem — ack
      // it (nothing to retry into existence) but log loudly, since
      // this shouldn't normally happen.
      console.error('Bink webhook: no jp_contract_signatures row for document', documentId)
      return NextResponse.json({ received: true, unmatched: true }, { status: 200 })
    }

    if (newStatus === 'signed') {
      // The webhook payload itself carries no identity data — fetch
      // the full document to get whatever verification details Bink
      // returns. Response shape here is NOT confirmed against a real
      // sandbox response, so treat it as opaque and store it whole.
      let documentDetails: Record<string, unknown> | null = null
      try {
        documentDetails = await getDocument(documentId)
      } catch (err) {
        console.error('Bink getDocument failed after signed webhook:', err)
        // Don't fail the whole webhook over this — the signature IS
        // confirmed signed per the webhook itself; missing the extra
        // verification detail is a lesser problem than not unlocking
        // the org at all. Proceed without documentDetails.
      }

      const verifiedName = extractVerifiedName(documentDetails)

      const { error: sigUpdateErr } = await supabase
        .from('jp_contract_signatures')
        .update({
          status: 'signed',
          signed_at: changedAt,
          verified_identity: documentDetails,
          verified_name: verifiedName,
          updated_at: new Date().toISOString(),
        })
        .eq('id', signatureRow.id)

      if (sigUpdateErr) throw sigUpdateErr

      const { error: orgUpdateErr } = await supabase
        .from('jp_organizations')
        .update({ contract_signed_at: changedAt })
        .eq('id', signatureRow.org_id)

      if (orgUpdateErr) throw orgUpdateErr
    } else if (newStatus === 'draft' || newStatus === 'in_process') {
      // Keep our tracking row in sync with Bink's own lifecycle so the
      // gate page's "waiting for signature" state stays accurate.
      const { error: statusUpdateErr } = await supabase
        .from('jp_contract_signatures')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', signatureRow.id)

      if (statusUpdateErr) throw statusUpdateErr
    }

    // Only now — after everything succeeded — mark this event id as
    // genuinely done, so a same-id retry (if Bink sends one anyway,
    // e.g. it didn't receive our 200 in time) is correctly skipped.
    await supabase
      .from('jp_webhook_dedupe')
      .update({ succeeded_at: new Date().toISOString() })
      .eq('event_id', webhookId)

    return NextResponse.json({ received: true }, { status: 200 })
  } catch (err) {
    console.error('Bink webhook processing error:', err)
    // succeeded_at deliberately left unset — non-2xx tells Bink to
    // retry (up to 3x), and the dedupe check above will let a retry
    // of this same event id through to reprocess, since it never
    // completed.
    return NextResponse.json({ error: 'Processing error' }, { status: 500 })
  }
}

function extractVerifiedName(doc: Record<string, unknown> | null): string | null {
  if (!doc) return null
  // Best-effort — field paths are guesses pending a real sandbox
  // response. verified_identity stores the full raw object regardless,
  // so nothing is lost even if none of these match.
  const signees = doc.signees as Array<Record<string, unknown>> | undefined
  const first = signees?.[0]
  const candidate =
    (first?.verifiedName as string | undefined) ??
    (first?.legalName as string | undefined) ??
    (first?.name as string | undefined)
  return typeof candidate === 'string' ? candidate : null
}
