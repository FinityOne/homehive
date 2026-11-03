/**
 * GET /api/cron/renewal-windows  (weekly, Mondays)
 *
 * Tells a landlord that a lease has entered its renewal window with nobody
 * having asked the tenant anything.
 *
 * This is the half of the renewals feature that works on landlords who do not
 * log in. The page is where the work happens, but a page nobody opens in April
 * cannot save an August vacancy, and the landlords least likely to open it are
 * exactly the ones most likely to lose a tenant to silence.
 *
 * Weekly rather than daily, deliberately. The window is 75 days wide and each
 * lease is only ever nudged about twice, so a daily run would spend six days
 * out of seven finding nothing and the seventh doing what a Monday run does.
 *
 * ── What stops it becoming noise ──────────────────────────────────────────
 *
 *   1. `lease_renewal_nudges` has a unique (lease_id, kind), and the claim is
 *      written *before* the send. A crash between the two costs one email
 *      rather than sending it twice on the retry, and two overlapping runs
 *      cannot both mail the same lease.
 *   2. At most two emails per lease, ever: one when the window opens at 120
 *      days, one at 45 days if there is still no answer. There is no third.
 *   3. One email per landlord per run, listing every lease that qualifies.
 *      Three leases ending in the same week is one email about three leases,
 *      which is also how the landlord thinks about it.
 *   4. `MAX_LANDLORDS_PER_RUN`, so a mistake in the selection cannot mail
 *      everybody at once. Anything over the cap waits for the next run —
 *      the window is 75 days wide, so nothing is lost by waiting a week.
 *
 * A lease is skipped once *any* offer exists on it, whatever its state. A
 * landlord who has asked and been declined does not need to be told the window
 * is open; the Renewals page already has them relisting.
 *
 * `?dry=1` reports who would get what, and renders the mail, without sending
 * or claiming anything.
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextRequest } from 'next/server'
import { getSiteUrl } from '@/lib/siteUrl'
import { logEmail } from '@/lib/emailLog'
import { buildRenewalWindowEmail } from '@/lib/renewalEmails'
import {
  daysUntil, stageFor, WINDOW_OPENS_DAYS, URGENT_DAYS,
} from '@/lib/renewals'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)
const resend = new Resend(process.env.RESEND_API_KEY!)

const FROM = 'HomeHive <hello@homehive.live>'
const MAX_LANDLORDS_PER_RUN = 40

type NudgeKind = 'window_open' | 'urgent'

type Candidate = {
  leaseId: string
  ownerId: string
  kind: NudgeKind
  propertyName: string
  unitNumber: string | null
  tenantName: string | null
  endDate: string
  daysLeft: number
  rent: number | null
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const params = new URL(req.url).searchParams
  const cronSecret = process.env.CRON_SECRET
  // Vercel's cron config puts the secret in the query string for some routes in
  // this app, so accept either — but never accept neither.
  const authorised =
    !cronSecret || authHeader === `Bearer ${cronSecret}` || params.get('secret') === cronSecret
  if (!authorised) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const dryRun = params.get('dry') === '1'
  if (!dryRun && !process.env.RESEND_API_KEY) {
    return Response.json({ error: 'Email is not configured' }, { status: 500 })
  }

  const skipped: Array<{ lease: string; reason: string }> = []

  // Leases ending inside the window. The ceiling is the window; the floor is
  // today, because a lease that has already ended is a turnover and not a
  // renewal, and telling a landlord to renew it would be nonsense.
  const today = new Date()
  const horizon = new Date(today.getTime() + WINDOW_OPENS_DAYS * 86_400_000)
  const { data: leases, error } = await supabaseAdmin
    .from('leases')
    .select(`
      id, owner_id, end_date, rent_amount, unit_number, is_demo,
      property:properties ( name ),
      tenants:lease_tenants ( name, email )
    `)
    .gte('end_date', today.toISOString().slice(0, 10))
    .lte('end_date', horizon.toISOString().slice(0, 10))
    .order('end_date', { ascending: true })

  if (error) {
    console.error('renewal-windows: lease read failed', error)
    return Response.json({ error: 'Could not read leases.' }, { status: 500 })
  }
  if (!leases?.length) {
    return Response.json({ ok: true, sent: 0, note: 'No leases inside the renewal window.' })
  }

  const leaseIds = leases.map(l => l.id as string)

  // Any offer at all disqualifies the lease — see the note at the top.
  const [{ data: offers }, { data: nudges }] = await Promise.all([
    supabaseAdmin.from('lease_renewals').select('lease_id').in('lease_id', leaseIds),
    supabaseAdmin.from('lease_renewal_nudges').select('lease_id, kind').in('lease_id', leaseIds),
  ])

  const asked = new Set((offers ?? []).map(o => o.lease_id as string))
  const alreadyNudged = new Set((nudges ?? []).map(n => `${n.lease_id}:${n.kind}`))

  const candidates: Candidate[] = []
  for (const l of leases) {
    const id = l.id as string
    const endDate = l.end_date as string
    const label = `${(l.property as { name?: string } | null)?.name ?? 'lease'} (${endDate})`

    if (l.is_demo) { skipped.push({ lease: label, reason: 'demo lease' }); continue }
    if (asked.has(id)) { skipped.push({ lease: label, reason: 'an offer already exists' }); continue }

    const stage = stageFor(endDate, today)
    // `early` cannot happen given the query's horizon, and `ended` cannot given
    // its floor — but both are checked rather than assumed, because the day the
    // query and the stage thresholds disagree is the day this mails nonsense.
    const kind: NudgeKind | null =
      stage === 'critical' || stage === 'urgent' ? 'urgent'
      : stage === 'open' ? 'window_open'
      : null
    if (!kind) { skipped.push({ lease: label, reason: `stage ${stage}` }); continue }

    if (alreadyNudged.has(`${id}:${kind}`)) {
      skipped.push({ lease: label, reason: `already nudged (${kind})` })
      continue
    }

    const tenants = (l.tenants ?? []) as Array<{ name: string | null; email: string | null }>
    candidates.push({
      leaseId: id,
      ownerId: l.owner_id as string,
      kind,
      propertyName: (l.property as { name?: string } | null)?.name ?? 'Your property',
      unitNumber: (l.unit_number as string) ?? null,
      tenantName: tenants.find(t => t.name)?.name ?? null,
      endDate,
      daysLeft: daysUntil(endDate, today),
      rent: l.rent_amount == null ? null : Number(l.rent_amount),
    })
  }

  if (!candidates.length) {
    return Response.json({ ok: true, sent: 0, skipped, note: 'Nothing new to nudge about.' })
  }

  // One email per landlord, however many of their leases qualify.
  const byOwner = new Map<string, Candidate[]>()
  for (const c of candidates) {
    const list = byOwner.get(c.ownerId) ?? []
    list.push(c)
    byOwner.set(c.ownerId, list)
  }

  const owners = [...byOwner.keys()].slice(0, MAX_LANDLORDS_PER_RUN)
  const held = byOwner.size - owners.length

  // `profiles` has no `first_name` column. Selecting one nulls the whole row
  // under PostgREST and has silently killed a whole class of landlord email in
  // this codebase before — email and full_name only.
  const { data: profiles } = await supabaseAdmin
    .from('profiles').select('id, email, full_name').in('id', owners)
  const profileById = new Map((profiles ?? []).map(p => [p.id as string, p]))

  const site = getSiteUrl()
  const results: Array<Record<string, unknown>> = []
  let sent = 0

  for (const ownerId of owners) {
    const leasesForOwner = (byOwner.get(ownerId) ?? [])
      .sort((a, b) => a.daysLeft - b.daysLeft)
    const profile = profileById.get(ownerId)
    const to = profile?.email as string | undefined

    if (!to) {
      skipped.push({ lease: `owner ${ownerId}`, reason: 'no email on the profile' })
      continue
    }

    const { subject, html, text } = buildRenewalWindowEmail({
      landlordName: (profile?.full_name as string) ?? null,
      leases: leasesForOwner.map(c => ({
        propertyName: c.propertyName,
        unitNumber: c.unitNumber,
        tenantName: c.tenantName,
        endDate: c.endDate,
        daysLeft: c.daysLeft,
        rent: c.rent,
      })),
      pipelineUrl: `${site}/landlord/renewals`,
    })

    if (dryRun) {
      results.push({
        to, subject,
        leases: leasesForOwner.map(c => `${c.propertyName} ${c.endDate} (${c.kind}, ${c.daysLeft}d)`),
        preview: text.slice(0, 400),
      })
      continue
    }

    // Claim first. A crash after this costs one email; a crash after the send
    // with the claim still unwritten would mail them again tomorrow.
    const { error: claimErr } = await supabaseAdmin
      .from('lease_renewal_nudges')
      .insert(leasesForOwner.map(c => ({
        lease_id: c.leaseId,
        owner_id: ownerId,
        kind: c.kind,
        email: to.toLowerCase(),
        subject,
      })))

    if (claimErr) {
      // 23505 means another run got there first. That is the claim working.
      if (claimErr.code !== '23505') console.error('renewal-windows: claim failed', claimErr)
      skipped.push({ lease: `owner ${ownerId}`, reason: `claim rejected (${claimErr.code})` })
      continue
    }

    try {
      const { error: sendErr } = await resend.emails.send({ from: FROM, to, subject, html, text })
      if (sendErr) throw sendErr
      sent++
      await logEmail(null, 'renewal_window_landlord', subject, to, {
        leases: leasesForOwner.map(c => ({ id: c.leaseId, kind: c.kind, daysLeft: c.daysLeft })),
      })
      results.push({ to, subject, leases: leasesForOwner.length })
    } catch (e) {
      console.error('renewal-windows: send failed', e)
      // The claim stays. Re-sending next week to an address that just bounced
      // buys nothing, and the leases are on their Renewals page regardless.
      results.push({ to, subject, error: String(e) })
    }
  }

  return Response.json({
    ok: true,
    dryRun,
    sent,
    landlords: owners.length,
    heldForNextRun: held,
    windowDays: WINDOW_OPENS_DAYS,
    urgentDays: URGENT_DAYS,
    results,
    skipped,
  })
}
