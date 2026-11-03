/**
 * POST /api/lease-amendments/remind — nudge a tenant who hasn't signed.
 *
 * A separate route from the send, and a separate email, because a reminder is
 * not a resend. Repeating the original word for word trains the tenant to
 * ignore both, and it hides the one fact that is new — that the document has
 * been sitting unsigned for a week. See `buildAmendmentReminderEmail`.
 *
 * Landlord-triggered, not a cron. A lease amendment is a thing two people are
 * mid-conversation about; the landlord knows whether they have already spoken
 * to the tenant in person today, and an automatic chaser does not. The send log
 * is what keeps it honest either way — every nudge is recorded, so the portal
 * can show "reminded twice" rather than leaving the count in the landlord's
 * head, which is how a tenant ends up nagged daily or forgotten entirely.
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextRequest } from 'next/server'
import { getSiteUrl } from '@/lib/siteUrl'
import { buildAmendmentReminderEmail } from '@/lib/amendmentEmails'
import { logEmail } from '@/lib/emailLog'
import {
  amendmentPath, signingToday,
  type AmendmentDocument,
} from '@/lib/leaseAmendments'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)
const resend = new Resend(process.env.RESEND_API_KEY!)

/**
 * The floor on how often one tenant can be chased about one document.
 *
 * Not a nicety. A tenant who gets three emails in a day about a pet addendum
 * filters the sender, and that filter also eats their rent reminders and their
 * payment receipts — the two emails this product genuinely cannot afford to
 * lose. So the limit protects the important mail, not the tenant's patience.
 */
const MIN_HOURS_BETWEEN_REMINDERS = 20

export async function POST(req: NextRequest) {
  const authToken = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!authToken) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user } } = await supabaseAdmin.auth.getUser(authToken)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) return Response.json({ error: 'Which amendment?' }, { status: 400 })

  const { data: amendment } = await supabaseAdmin
    .from('lease_amendments').select('*').eq('id', id).maybeSingle()

  if (!amendment) return Response.json({ error: 'Amendment not found.' }, { status: 404 })
  if (amendment.owner_id !== user.id) return Response.json({ error: 'Unauthorized' }, { status: 403 })
  if (amendment.status !== 'sent') {
    return Response.json({
      error: amendment.status === 'signed'
        ? 'This has already been signed — there is nothing to remind them about.'
        : `This amendment was ${amendment.status}. Send a new one instead.`,
    }, { status: 409 })
  }

  // The most recent email about this document, whatever kind it was. The
  // original request counts: reminding somebody an hour after sending them the
  // document is the same mistake as reminding them twice.
  const { data: last } = await supabaseAdmin
    .from('lease_amendment_sends')
    .select('sent_at')
    .eq('amendment_id', id)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (last?.sent_at) {
    const hours = (Date.now() - new Date(last.sent_at).getTime()) / 3_600_000
    if (hours < MIN_HOURS_BETWEEN_REMINDERS) {
      const wait = Math.max(1, Math.ceil(MIN_HOURS_BETWEEN_REMINDERS - hours))
      return Response.json({
        error: `They were last emailed about this ${hours < 1 ? 'less than an hour' : `${Math.floor(hours)} hours`} ` +
          `ago. You can send another reminder in ${wait} hour${wait === 1 ? '' : 's'}.`,
      }, { status: 429 })
    }
  }

  const doc = amendment.document as AmendmentDocument
  const { data: profile } = await supabaseAdmin
    .from('profiles').select('email, full_name').eq('id', user.id).maybeSingle()

  // Whole days since the original request, in Phoenix — the figure the email
  // leads with, so it must not be the one that rolls over at 5pm local.
  const sentDay = String(amendment.sent_at).slice(0, 10)
  const today = signingToday()
  const daysWaiting = Math.max(
    0,
    Math.round(
      (Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)) -
       Date.UTC(+sentDay.slice(0, 4), +sentDay.slice(5, 7) - 1, +sentDay.slice(8, 10))) / 86_400_000
    )
  )

  const built = buildAmendmentReminderEmail({
    doc,
    tenantName: amendment.tenant_name,
    landlordName: profile?.full_name ?? null,
    signUrl: `${getSiteUrl()}${amendmentPath(amendment.token)}`,
    daysWaiting,
  })

  try {
    const { error: sendErr } = await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: amendment.tenant_email,
      replyTo: profile?.email || undefined,
      subject: built.subject,
      html: built.html,
      text: built.text,
    })
    if (sendErr) throw sendErr
  } catch (e) {
    console.error('amendment reminder email failed', e)
    return Response.json({
      error: `Could not email ${amendment.tenant_email}. Nothing was sent.`,
    }, { status: 502 })
  }

  // Nothing is rolled back on a logging failure here: unlike the original
  // send, a reminder that went out but wasn't logged costs an over-count, not a
  // contract. Deleting the row would be the worse of the two errors.
  try {
    await supabaseAdmin.from('lease_amendment_sends').insert({
      amendment_id: amendment.id,
      owner_id: user.id,
      kind: 'reminder',
      recipient: amendment.tenant_email,
      subject: built.subject,
    })
    await logEmail(null, 'amendment_reminder_tenant', built.subject, amendment.tenant_email, {
      lease_id: amendment.lease_id, amendment_id: amendment.id, days_waiting: daysWaiting,
    })
  } catch (e) {
    console.error('amendment reminder log failed', e)
  }

  return Response.json({ sentTo: amendment.tenant_email, daysWaiting })
}
