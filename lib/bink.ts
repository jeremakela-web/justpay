import crypto from 'crypto'

// Bink.fi API client — built to the endpoint/payload shapes confirmed
// directly against their public developer docs (not this sandbox's own
// verification — network egress to bink.fi is blocked here, so this
// has not been exercised against a live sandbox response yet).
//
// Required env vars (server-only):
//   BINK_API_KEY        — x-api-key header value
//   BINK_TENANT_ID       — Kansallisvaranto's own tenant id in Bink's system
//   BINK_WEBHOOK_SECRET  — for HMAC verification of incoming webhooks
//   BINK_ENV              — 'sandbox' (default) | 'production'

const BASE_URLS = {
  sandbox: 'https://sandbox-api.bink.fi',
  production: 'https://api.bink.fi',
} as const

function baseUrl(): string {
  const env = process.env.BINK_ENV === 'production' ? 'production' : 'sandbox'
  return BASE_URLS[env]
}

function apiKey(): string {
  const key = process.env.BINK_API_KEY
  if (!key) throw new Error('BINK_API_KEY is not set')
  return key
}

function tenantId(): string {
  const id = process.env.BINK_TENANT_ID
  if (!id) throw new Error('BINK_TENANT_ID is not set')
  return id
}

export interface BinkSignee {
  email: string
  name: string
  pic: string // Finnish henkilötunnus — required for signingMethod 'strong'
}

export interface BinkDocument {
  id: string
  name: string
  status: 'draft' | 'in_process' | 'signed'
  downloadUrl: string
  emailLanguage: string
}

export interface BinkQuickCreateResponse {
  message: string
  document: BinkDocument
  signees: BinkSignee[]
  contentType: string
}

/**
 * Creates a document to be signed and uploads it in one call.
 * signingMethod is hardcoded to 'strong' — this app only uses strong
 * tunnistautuminen (pankkitunnukset/mobiilivarmenne), per the decision
 * to go with the strong tier from pilot launch, not the light tier.
 */
export async function createSigningDocument(params: {
  fileBuffer: Buffer
  fileName: string
  title: string
  signingMessage?: string
  emailLanguage?: string
  signee: BinkSignee
}): Promise<BinkQuickCreateResponse> {
  const form = new FormData()
  form.append('file', new Blob([Uint8Array.from(params.fileBuffer)]), params.fileName)
  form.append('title', params.title)
  form.append('tenantId', tenantId())
  // TEMPORARY DIAGNOSTIC — switched from 'strong' to isolate the 403 on
  // quick-create: if 'email' succeeds where 'strong' didn't, the account
  // is provisioned for document creation at all and the 403 is specific
  // to the strong-tunnistautuminen tier/permission, not a tenant/key
  // problem. MUST REVERT to 'strong' after this one test regardless of
  // outcome — this app only ever uses strong signing for real.
  form.append('signingMethod', 'email')
  if (params.signingMessage) form.append('signingMessage', params.signingMessage)
  if (params.emailLanguage) form.append('emailLanguage', params.emailLanguage)
  form.append('signees', JSON.stringify([params.signee]))

  const res = await fetch(`${baseUrl()}/api/documents/quick-create`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey() },
    body: form,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Bink quick-create failed: ${res.status} ${body}`)
  }

  return res.json() as Promise<BinkQuickCreateResponse>
}

export interface BinkSendForSigningResponse {
  credit?: { tenantId: string; email: number; strong: number }
  [key: string]: unknown
}

/**
 * Triggers Bink to send the signing invite(s) — an email-based flow
 * (not a live redirect-and-return), per their "sends signing invites"
 * description. Surfaces the returned signature-credit balance so a
 * caller can log/alert on it — worth watching so we notice before we
 * run out of strong-signature credits, not after.
 */
export async function sendForSigning(
  documentId: string,
  emailLanguage?: string
): Promise<BinkSendForSigningResponse> {
  const res = await fetch(`${baseUrl()}/api/documents/${documentId}/send-for-signing`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(emailLanguage ? { emailLanguage } : {}),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Bink send-for-signing failed: ${res.status} ${body}`)
  }

  return res.json() as Promise<BinkSendForSigningResponse>
}

/**
 * Fetches full document status/details. The webhook payload itself
 * only carries {documentId, oldStatus, newStatus, changedAt} — no
 * identity attributes — so this is called after a 'signed' webhook to
 * get whatever verification data Bink actually returns. The exact
 * response shape for signee verification details is NOT confirmed
 * (wasn't in what was verified from their docs), so callers should
 * treat the result as opaque JSON rather than assume specific fields
 * beyond what's typed here, until checked against a real sandbox
 * response.
 */
export async function getDocument(documentId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl()}/api/documents/${documentId}`, {
    headers: { 'x-api-key': apiKey() },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Bink get-document failed: ${res.status} ${body}`)
  }

  return res.json() as Promise<Record<string, unknown>>
}

export interface BinkWebhookPayload {
  id: string
  type: string
  occurredAt: string
  tenantId: string
  data: {
    documentId: string
    oldStatus: string
    newStatus: string
    changedAt: string
  }
}

/**
 * Verifies a Bink webhook's HMAC-SHA256 signature, exactly per their
 * reference implementation: signed payload = `${t}.${rawBody}` (raw
 * bytes, not re-serialized JSON — parsing and re-stringifying would
 * change whitespace/key order and break the signature), HMAC with the
 * webhook secret, hex digest, timing-safe comparison against the v1
 * value. `rawBody` MUST be the exact bytes as received — read via
 * request.text() before any JSON.parse, never the parsed object.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader) return false

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((kv) => {
      const [k, v] = kv.split('=')
      return [k, v]
    })
  )
  const t = parts.t
  const v1 = parts.v1
  if (!t || !v1) return false

  const signedPayload = `${t}.${rawBody}`
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex')

  const expectedBuf = Buffer.from(expected, 'hex')
  const actualBuf = Buffer.from(v1, 'hex')
  if (expectedBuf.length !== actualBuf.length) return false

  return crypto.timingSafeEqual(expectedBuf, actualBuf)
}
