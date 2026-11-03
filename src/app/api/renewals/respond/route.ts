/**
 * POST /api/renewals/respond
 *
 * The tenant's answer. No authentication, by design: the bearer is the token
 * in the link, exactly as the move-out report at /checkout-report/[token]
 * works. Tenants on this platform frequently have no HomeHive account at all —
 * `lease_tenants` carries a name and an email and often no `tenant_id` — and
 * putting a password reset between a landlord and a signed renewal is how
 * renewals get lost.
 *
 * Three things the token alone must not be allowed to do:
 *   • answer twice. The update is conditional on the row still being `sent`,
 *     so a double-tap or a re-opened email loses the race instead of flipping
 *     a decision the landlord has already acted on.
 *   • answer late. An offer past its `respond_by` is refused with the real
 *     reason, so a tenant who finds the email in November is told plainly
 *     rather than quietly recorded as renewing.
 *   • reveal anything. A bad token gets 404 and nothing else.
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextRequest } from 'next/server'
import { getSiteUrl } from '@/lib/siteUrl'
import { buildRenewalResponseEmail } from '@/lib/renewalEmails'
import { logEmail } from '@/lib/emailLog'
import { daysUntil } from '@/lib/renewals'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)
const resend = new Resend(process.env.RESEND_API_KEY!)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A note the tenant typed. Trimmed and capped — it is going into an email. */
function note(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().slice(0, 2000)
  return s === '' ? null : s
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  const decision = body.decision

  if (!UUID.test(token)) return Response.json({ error: 'Not found.' }, { status: 404 })
  if (decision !== 'accept' && decision !== 'decline') {
    return Response.json({ error: 'Choose to accept or decline.' }, { status: 400 })
  }

  const { data: renewal } = await supabaseAdmin
    .from('lease_renewals')
    .select('*, lease:leases ( id, end_date, rent_amount, unit_number, property:properties ( name ) )')
    .eq('token', token)
    .maybeSingle()

  if (!renewal) return Response.json({ error: 'Not found.' }, { status: 404 })

  if (renewal.status !== 'sent') {
    return Response.json({
      error: renewal.status === 'withdrawn'
        ? 'This offer was withdrawn by your landlord.'
        : `You already ${renewal.status} this offer.`,
      status: renewal.status,
    }, { status: 409 })
  }
  if (daysUntil(renewal.respond_by as string) < 0) {
    return Response.json({
      error: 'The reply-by date on this offer has passed. Contact your landlord and they can send a new one.',
      status: 'expired',
    }, { status: 409 })
  }

  const accepted = decision === 'accept'

  const { data: updated, error } = await supabaseAdmin
    .from('lease_renewals')
    .update({
      status: accepted ? 'accepted' : 'declined',
      responded_at: new Date().toISOString(),
      response_note: note(body.note),
      updated_at: new Date().toISOString(),
    })
    .eq('id', renewal.id)
    .eq('status', 'sent')   // the guard against a second answer
    .select('*')
    .single()

  if (error || !updated) {
    return Response.json({ error: 'That answer was already recorded.' }, { status: 409 })
  }

  // Tell the landlord. Best-effort: the answer is saved either way, and it is
  // also sitting at the top of their Renewals page, so a bounced email costs
  // them promptness rather than the decision itself.
  try {
    const lease = renewal.lease as {
      end_date?: string; rent_amount?: number | null; unit_number?: string | null
      property?: { name?: string } | null
    } | null

    const { data: owner } = await supabaseAdmin
      .from('profiles').select('email, full_name').eq('id', renewal.owner_id).maybeSingle()

    if (owner?.email) {
      const { subject, html, text } = buildRenewalResponseEmail({
        accepted,
        renewal: updated,
        currentRent: lease?.rent_amount == null ? null : Number(lease.rent_amount),
        tenantName: (updated.tenant_name as string) ?? null,
        propertyName: lease?.property?.name || 'your property',
        unitNumber: lease?.unit_number ?? null,
        pipelineUrl: `${getSiteUrl()}/landlord/renewals`,
        daysToTurnover: lease?.end_date ? daysUntil(lease.end_date) : 0,
      })
      await resend.emails.send({
        from: 'HomeHive <hello@homehive.live>',
        to: owner.email,
        subject, html, text,
      })
      await logEmail(null, 'renewal_response_landlord', subject, owner.email, {
        renewal_id: updated.id, decision: updated.status,
      })
    }
  } catch (e) {
    console.error('renewal response email failed', e)
  }

  return Response.json({ ok: true, status: updated.status })
}
