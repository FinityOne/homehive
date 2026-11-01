/**
 * POST /api/webhooks/resend
 *
 * Turns "we called the email API" into "the tenant received it, and opened it".
 *
 * Every money email we send is already recorded in `payment_emails` with the
 * provider's message id. That record could only ever say the send was
 * *accepted* — which is the weakest claim in the whole chain, and the one a
 * landlord is most likely to misread. "I reminded them twice" means nothing if
 * both messages bounced off a dead address, and means a great deal if the log
 * can show the tenant opened the second one an hour after it landed.
 *
 * Resend reports the rest of the lifecycle here, keyed on that message id. The
 * states are stored as separate timestamps rather than one status, because they
 * are not alternatives: a mail is delivered *and* opened *and* clicked, and
 * each answers a different question.
 *
 * Fails closed. Without `RESEND_WEBHOOK_SECRET` configured, this endpoint
 * refuses every request rather than trusting whatever arrives — anyone can POST
 * here, and an unauthenticated writer could mark a bounced reminder as read.
 *
 * Configure in Resend: add an endpoint pointing at this path, subscribe to the
 * email.* events, and put its signing secret in `RESEND_WEBHOOK_SECRET`.
 */
import { createClient } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextRequest } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

/** How far out of date a signed payload may be, in minutes. Standard Svix
 *  tolerance: long enough for a retry, short enough that a captured request
 *  cannot be replayed indefinitely. */
const TOLERANCE_MINUTES = 5

/**
 * Verify a Svix-style signature, which is what Resend sends.
 *
 * The signed content is `id.timestamp.body` and the header may carry several
 * space-separated versioned signatures (`v1,<base64>`), because a secret can be
 * rotated with both live at once — so any one match is a pass.
 */
function verify(secret: string, headers: Headers, body: string): { ok: true } | { ok: false; why: string } {
  const id = headers.get('svix-id') ?? headers.get('webhook-id')
  const timestamp = headers.get('svix-timestamp') ?? headers.get('webhook-timestamp')
  const signature = headers.get('svix-signature') ?? headers.get('webhook-signature')
  if (!id || !timestamp || !signature) return { ok: false, why: 'missing signature headers' }

  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > TOLERANCE_MINUTES * 60) {
    return { ok: false, why: 'timestamp outside tolerance' }
  }

  // `whsec_` is a prefix on the printable form, not part of the key material.
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest()

  const offered = signature.split(' ')
    .map(part => part.split(','))
    .filter(([version]) => version === 'v1')
    .map(([, value]) => Buffer.from(value ?? '', 'base64'))

  // timingSafeEqual throws on a length mismatch, so the length check comes
  // first — and a wrong-length signature is a failure, not an exception.
  const match = offered.some(sig => sig.length === expected.length && timingSafeEqual(sig, expected))
  return match ? { ok: true } : { ok: false, why: 'signature mismatch' }
}

type Patch = Record<string, string | null>

/**
 * Which column an event writes, and what the log should say about it.
 *
 * `email.sent` is deliberately absent: we already recorded the send ourselves,
 * and the provider repeating it tells a landlord nothing new.
 */
function patchFor(type: string, at: string, data: Record<string, unknown>): { patch: Patch; detail: string } | null {
  const reason = typeof data.reason === 'string' ? data.reason : null
  const bounce = (data.bounce ?? null) as { message?: string; type?: string; subType?: string } | null
  const link = (data.click ?? null) as { link?: string } | null

  switch (type) {
    case 'email.delivered':
      return { patch: { delivered_at: at }, detail: 'Delivered to the recipient’s mail server' }
    case 'email.opened':
      // Delivery is implied by an open, and the two events can arrive out of
      // order. Stamping it here keeps the row from reading "opened but never
      // delivered", which is the kind of detail that makes a log untrustworthy.
      return { patch: { opened_at: at, delivered_at: at }, detail: 'Opened by the recipient' }
    case 'email.clicked':
      return {
        patch: { clicked_at: at, opened_at: at, delivered_at: at },
        detail: link?.link ? `Clicked a link: ${link.link}` : 'Clicked a link in the email',
      }
    case 'email.bounced':
      return {
        patch: { bounced_at: at },
        detail: bounce?.message || reason || `Bounced${bounce?.type ? ` (${bounce.type})` : ''}`,
      }
    case 'email.complained':
      return { patch: { complained_at: at }, detail: 'Recipient marked it as spam' }
    case 'email.delivery_delayed':
      return { patch: {}, detail: reason ? `Delivery delayed: ${reason}` : 'Delivery delayed by the recipient’s server' }
    case 'email.failed':
      return { patch: { bounced_at: at }, detail: reason ? `Provider could not send it: ${reason}` : 'Provider could not send it' }
    default:
      return null
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    console.error('[resend-webhook] RESEND_WEBHOOK_SECRET is not set — refusing the delivery report')
    return Response.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  // The raw body, byte for byte: the signature covers the text that was sent,
  // so it cannot be re-serialised from a parsed object.
  const body = await req.text()
  const check = verify(secret, req.headers, body)
  if (!check.ok) {
    console.warn('[resend-webhook] rejected:', check.why)
    return Response.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: { type?: string; created_at?: string; data?: Record<string, unknown> }
  try {
    event = JSON.parse(body)
  } catch {
    return Response.json({ error: 'Malformed payload' }, { status: 400 })
  }

  const type = event.type ?? ''
  const data = event.data ?? {}
  const messageId = (data.email_id ?? data.id) as string | undefined
  if (!messageId) return Response.json({ ok: true, ignored: 'no message id' })

  const mapped = patchFor(type, event.created_at ?? new Date().toISOString(), data)
  if (!mapped) return Response.json({ ok: true, ignored: type })

  const { data: rows, error: findErr } = await supabaseAdmin
    .from('payment_emails')
    .select('id, delivered_at, opened_at, clicked_at, bounced_at, complained_at')
    .eq('provider_id', messageId)
    .limit(1)

  if (findErr) {
    // 500 so the provider retries: losing a bounce is losing the one fact the
    // landlord most needs.
    console.error('[resend-webhook] lookup failed:', findErr.message)
    return Response.json({ error: 'Lookup failed' }, { status: 500 })
  }

  const row = rows?.[0]
  // Not every mail we send is a money mail — tour reminders, auth codes and
  // reference requests all come through Resend too, and they are not in this
  // table. An unknown id is ordinary, not an error.
  if (!row) return Response.json({ ok: true, ignored: 'not a payment email' })

  // Keep the first observation of each state. An open is reported every time
  // the image loads, and "first opened" is the useful fact; overwriting it
  // would turn the log into a record of the tenant's most recent re-read.
  const existing = row as Record<string, string | null>
  const patch: Patch = { delivery_detail: mapped.detail, delivery_updated_at: new Date().toISOString() }
  for (const [column, value] of Object.entries(mapped.patch)) {
    if (!existing[column]) patch[column] = value
  }

  const { error: updErr } = await supabaseAdmin
    .from('payment_emails')
    .update(patch)
    .eq('id', row.id)

  if (updErr) {
    console.error('[resend-webhook] update failed:', updErr.message)
    return Response.json({ error: 'Update failed' }, { status: 500 })
  }
  return Response.json({ ok: true, type, email: row.id })
}
