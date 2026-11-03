/**
 * Renewal offers: send one, or withdraw one.
 *
 *   POST  /api/renewals   — send an offer to the tenant
 *   PATCH /api/renewals   — withdraw a live offer
 *
 * Sending runs on the server, and not only because the Resend key does. The
 * insert and the email are one action with two halves, and the half that
 * matters to the landlord is the one that leaves the building: a row saying
 * "offer sent" that the tenant never received is worse than no row at all,
 * because the landlord stops chasing. So if the email fails, the row is
 * removed and the caller is told the offer did not go out.
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextRequest } from 'next/server'
import { getSiteUrl } from '@/lib/siteUrl'
import { buildRenewalOfferEmail } from '@/lib/renewalEmails'
import { logEmail } from '@/lib/emailLog'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)
const resend = new Resend(process.env.RESEND_API_KEY!)

const DATE = /^\d{4}-\d{2}-\d{2}$/

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s === '' ? null : s
}

async function requireUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  return user ?? null
}

const LEASE_SELECT = `
  id, owner_id, property_id, start_date, end_date, rent_amount, unit_number, is_demo,
  property:properties ( id, name, slug ),
  tenants:lease_tenants ( id, name, email )
`

export async function POST(req: NextRequest) {
  const user = await requireUser(req)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const leaseId = str(body.lease_id)
  if (!leaseId) return Response.json({ error: 'Which lease?' }, { status: 400 })

  const rent = Number(body.new_rent)
  if (!Number.isFinite(rent) || rent < 0) {
    return Response.json({ error: 'Give the renewal a monthly rent.' }, { status: 400 })
  }
  const start = str(body.new_start_date)
  const end = str(body.new_end_date)
  const respondBy = str(body.respond_by)
  if (!start || !end || !respondBy || ![start, end, respondBy].every(d => DATE.test(d))) {
    return Response.json({ error: 'The new term needs a start date, an end date and a reply-by date.' }, { status: 400 })
  }
  if (end <= start) {
    return Response.json({ error: 'The new term has to end after it starts.' }, { status: 400 })
  }

  // The lease must be the caller's. Never trust a client-supplied id.
  const { data: lease } = await supabaseAdmin
    .from('leases').select(LEASE_SELECT).eq('id', leaseId).maybeSingle()

  if (!lease) return Response.json({ error: 'Lease not found.' }, { status: 404 })
  if (lease.owner_id !== user.id) return Response.json({ error: 'Unauthorized' }, { status: 403 })
  if (lease.is_demo) {
    // A demo lease is a rehearsal with no real tenant behind it. Sending from
    // one would mail a stranger a renewal for a tenancy that does not exist.
    return Response.json({ error: 'This is a demo lease — there is nobody to send an offer to.' }, { status: 400 })
  }

  const tenants = (lease.tenants ?? []) as Array<{ id: string; name: string | null; email: string | null }>
  // The offer goes to the first tenant with an address on file. One recipient,
  // not all of them: a shared house answering three times in three directions
  // is a contradiction the unique index would then reject at random.
  const recipient = tenants.find(t => !!t.email?.trim())
  if (!recipient) {
    return Response.json({
      error: 'This lease has no tenant email on file. Add one to the lease first.',
    }, { status: 400 })
  }

  const { data: renewal, error: insertErr } = await supabaseAdmin
    .from('lease_renewals')
    .insert({
      lease_id: lease.id,
      owner_id: user.id,
      property_id: lease.property_id,
      new_rent: Math.round(rent),
      new_start_date: start,
      new_end_date: end,
      respond_by: respondBy,
      message: str(body.message),
      tenant_name: recipient.name,
      tenant_email: recipient.email!.trim().toLowerCase(),
    })
    .select('*')
    .single()

  if (insertErr || !renewal) {
    // 23505 is the one-live-offer-per-lease index doing its job.
    if (insertErr?.code === '23505') {
      return Response.json({
        error: 'There is already an offer out on this lease. Withdraw it before sending another.',
      }, { status: 409 })
    }
    console.error('renewal insert failed', insertErr)
    return Response.json({ error: 'Could not save the offer.' }, { status: 500 })
  }

  // The hero photo, if there is one — a tenant recognises their own front door
  // before they read the name of the building.
  const { data: image } = await supabaseAdmin
    .from('property_images')
    .select('url')
    .eq('property_id', lease.property_id)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle()

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('email, full_name').eq('id', user.id).maybeSingle()

  const property = lease.property as { name?: string } | null
  let sentSubject = 'Your renewal offer'

  try {
    const { subject, html, text } = buildRenewalOfferEmail({
      renewal,
      currentRent: lease.rent_amount == null ? null : Number(lease.rent_amount),
      currentEndDate: lease.end_date as string,
      tenantName: recipient.name,
      propertyName: property?.name || 'your home',
      unitNumber: (lease.unit_number as string) ?? null,
      landlordName: profile?.full_name ?? null,
      respondUrl: `${getSiteUrl()}/renewal/${renewal.token}`,
      heroImage: (image?.url as string) ?? null,
    })
    const { error: sendErr } = await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: recipient.email!,
      replyTo: profile?.email || undefined,
      subject, html, text,
    })
    if (sendErr) throw sendErr
    sentSubject = subject
  } catch (e) {
    console.error('renewal offer email failed', e)
    // Undo the offer rather than leave a landlord believing they have asked.
    await supabaseAdmin.from('lease_renewals').delete().eq('id', renewal.id)
    return Response.json({
      error: `Could not email ${recipient.email}. Nothing was sent, so nothing was recorded — check the address and try again.`,
    }, { status: 502 })
  }

  // Logged after the send succeeded, and outside that try on purpose: a failed
  // log entry must never be mistaken for a failed send and roll back an offer
  // the tenant has already received.
  try {
    await logEmail(null, 'renewal_offer_tenant', sentSubject, recipient.email!, {
      lease_id: lease.id, renewal_id: renewal.id, new_rent: renewal.new_rent,
    })
  } catch (e) {
    console.error('renewal offer log failed', e)
  }

  return Response.json({ renewal, sentTo: recipient.email })
}

/**
 * Withdraw a live offer.
 *
 * No email to the tenant. A landlord withdraws almost exclusively to re-send
 * on different terms, and "your offer has been withdrawn" landing a minute
 * before "your renewal offer" reads as chaos rather than as diligence. The
 * withdrawn row stays as history either way.
 */
export async function PATCH(req: NextRequest) {
  const user = await requireUser(req)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const id = str(body.id)
  if (!id) return Response.json({ error: 'Which offer?' }, { status: 400 })

  const { data: renewal } = await supabaseAdmin
    .from('lease_renewals').select('id, owner_id, status').eq('id', id).maybeSingle()

  if (!renewal) return Response.json({ error: 'Offer not found.' }, { status: 404 })
  if (renewal.owner_id !== user.id) return Response.json({ error: 'Unauthorized' }, { status: 403 })
  if (renewal.status !== 'sent') {
    return Response.json({ error: `This offer was already ${renewal.status}.` }, { status: 409 })
  }

  const { data, error } = await supabaseAdmin
    .from('lease_renewals')
    .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'sent')   // lose the race rather than overwrite an answer
    .select('*')
    .single()

  if (error || !data) {
    return Response.json({ error: 'Could not withdraw the offer — it may have just been answered.' }, { status: 409 })
  }
  return Response.json({ renewal: data })
}
