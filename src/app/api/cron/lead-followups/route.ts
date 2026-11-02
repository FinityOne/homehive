/**
 * GET /api/cron/lead-followups
 *
 * Emails a renter two days after they inquired, once, about the one thing they
 * can still do themselves. FIN-17.
 *
 * ── What this route is and isn't responsible for ──────────────────────────
 *
 * Every rule about *whether* a given lead should hear from us lives in
 * `chooseFollowup` in `src/lib/leadFollowupEmails.ts`, which is pure. This file
 * gathers the facts that function needs, mails the ones it approves, and claims
 * each send. That split is the only reason the policy — a two-day floor, a
 * seven-day ceiling, don't chase a verdict the landlord already reached, never
 * offer a tour nobody invited them to — can be checked without a database
 * (`npm run verify:lead-followups`).
 *
 * ── The four things that stop this becoming spam ──────────────────────────
 *
 *   1. `email_opt_outs` is checked before every send and every email carries a
 *      one-click unsubscribe plus the `List-Unsubscribe` headers. Same list the
 *      landlord nudges use, so one click stops all of it.
 *   2. `lead_followup_sends` has a unique (lead_id, kind). The claim is written
 *      *before* the send, so a crash between the two costs one email rather
 *      than sending it twice on the retry.
 *   3. A one-per-address-per-week cooldown on top of the per-lead claim,
 *      because leads are per listing and a serious shopper inquires about four
 *      places in an evening.
 *   4. `MAX_PER_RUN`, so a mistake in the segmentation cannot mail everybody at
 *      once. Anything over the cap is simply left for tomorrow's run.
 *
 * ── Read this before pointing it at production ────────────────────────────
 *
 * `?dry=1` reports exactly who would get what, with the reason for every skip,
 * and renders the mail without sending or claiming anything. Worth doing before
 * every copy change — and note that on the day this ships a dry run should
 * report **zero** sends, because every lead currently in the database is months
 * old and therefore outside the window. That is the ceiling working, not a bug.
 * `?full=1` alongside it returns whole email bodies instead of a prefix.
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextRequest } from 'next/server'
import { getSiteUrl } from '@/lib/siteUrl'
import { logEmail } from '@/lib/emailLog'
import { canReceiveLeads, hasActivePlan, type ListingStatus } from '@/lib/listingStatus'
import { firstNameFrom } from '@/lib/names'
import {
  chooseFollowup,
  renderFollowupEmail,
  FOLLOWUP_CATEGORY,
  MIN_AGE_DAYS,
  MAX_AGE_DAYS,
  ADDRESS_COOLDOWN_DAYS,
  type FollowupKind,
} from '@/lib/leadFollowupEmails'
import { unsubscribeUrl } from '@/lib/unsubscribeToken'
import type { Lead } from '@/lib/leads'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

const FROM = 'HomeHive <hello@homehive.live>'

/** A cap per run. The window is a week wide, so anything held back gets another chance. */
const MAX_PER_RUN = 50

/** How far ahead `/book-tour` looks for slots. Must match `tour-slots`, or we promise times that page won't show. */
const TOUR_SLOT_HORIZON_DAYS = 7

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)
const dateOnly = (d: Date) => d.toISOString().split('T')[0]

/**
 * Addresses that will hard-bounce, so we never send to them.
 *
 * The same list the landlord activation cron keeps, and for the same reason: a
 * single hard bounce in a small batch is a percentage point of bounce rate, and
 * providers throttle a sending domain long before they explain why. These are
 * the typo domains people actually produce at signup, not a validation attempt
 * — a syntax check passes every one of them.
 */
const DEAD_DOMAINS = new Set([
  'gmail.con', 'gmail.cm', 'gmail.co', 'gmail.comm', 'gmail.cmo',
  'hotmail.con', 'hotmail.cmo', 'yahoo.con', 'yahoo.cmo',
  'icloud.con', 'outlook.con', 'gmai.com', 'gmial.com', 'gmaill.com',
])

const isDeliverable = (email: string): boolean => {
  const at = email.lastIndexOf('@')
  if (at < 1 || at === email.length - 1) return false
  const domain = email.slice(at + 1)
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return false
  return !DEAD_DOMAINS.has(domain)
}

type LeadRow = Pick<Lead, 'id' | 'created_at' | 'email' | 'first_name' | 'status' | 'property' | 'toured'> & {
  tour_invite_sent_at: string | null
}

/**
 * The listing facts this route needs, named rather than inferred.
 *
 * The `property_images(...)` embed makes PostgREST's inferred row a union with
 * its embed-error type, so every field access on it fails to compile. Declaring
 * the shape is both the fix and the better documentation of what is actually
 * read here.
 */
type PropRow = {
  id: string
  slug: string
  name: string | null
  address: string | null
  owner_id: string | null
  listing_status: string | null
  accepting_inquiries: boolean | null
  show_when_rented: boolean | null
  owner_plan_active: boolean | null
  archived_at: string | null
  property_images: { url: string; position: number }[] | null
}

type Candidate = {
  lead: LeadRow
  email: string
  kind: FollowupKind
  openTourSlots: number
  propertyName: string | null
  propertyAddress: string | null
  heroImage: string | null
  landlordFirstName: string | null
  hasFaqs: boolean
}

const LOG_TYPE = {
  prescreen: 'lead_followup_prescreen',
  tour_booking: 'lead_followup_tour',
} as const

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

  const site = getSiteUrl()

  // ── The window ───────────────────────────────────────────────────────────
  //
  // Bounded at both ends in the query itself, so even a bug further down cannot
  // reach a lead from last spring. Newest first: when one address has several
  // leads, the freshest inquiry is the one worth following up.
  const { data: leadRows, error: leadErr } = await supabaseAdmin
    .from('leads')
    .select('id, created_at, email, first_name, status, property, toured, tour_invite_sent_at')
    .lte('created_at', daysAgo(MIN_AGE_DAYS).toISOString())
    .gte('created_at', daysAgo(MAX_AGE_DAYS).toISOString())
    .order('created_at', { ascending: false })

  if (leadErr) {
    console.error('[lead-followups] lead lookup failed', leadErr.message)
    return Response.json({ error: 'Lookup failed' }, { status: 500 })
  }

  const leads = (leadRows ?? []) as LeadRow[]
  if (leads.length === 0) {
    return Response.json({
      ok: true,
      window: `${MIN_AGE_DAYS}-${MAX_AGE_DAYS} days`,
      considered: 0,
      sent: 0,
      note: 'no leads in the follow-up window',
    })
  }

  const leadIds = leads.map(l => l.id)
  const addresses = Array.from(
    new Set(leads.map(l => (l.email ?? '').trim().toLowerCase()).filter(Boolean))
  )
  const slugs = Array.from(new Set(leads.map(l => l.property).filter((s): s is string => !!s)))

  const [
    { data: prescreens },
    { data: tours },
    { data: claims },
    { data: optOuts },
    { data: recentSends },
    { data: propRows },
  ] = await Promise.all([
    supabaseAdmin.from('pre_screens').select('lead_id').in('lead_id', leadIds),
    // Anything not cancelled still stands, so it still counts as booked.
    supabaseAdmin.from('tours').select('lead_id, status').in('lead_id', leadIds).neq('status', 'cancelled'),
    supabaseAdmin.from('lead_followup_sends').select('lead_id, kind').in('lead_id', leadIds),
    supabaseAdmin.from('email_opt_outs').select('email').eq('category', FOLLOWUP_CATEGORY),
    addresses.length
      ? supabaseAdmin
          .from('lead_followup_sends')
          .select('email, sent_at')
          .in('email', addresses)
          .gte('sent_at', daysAgo(ADDRESS_COOLDOWN_DAYS).toISOString())
      : Promise.resolve({ data: [] as { email: string; sent_at: string }[] }),
    slugs.length
      ? supabaseAdmin
          .from('properties')
          .select(
            'id, slug, name, address, owner_id, listing_status, accepting_inquiries, ' +
            'show_when_rented, owner_plan_active, archived_at, property_images(url, position)'
          )
          .in('slug', slugs)
      : Promise.resolve({ data: [] as unknown[] }),
  ])

  const props = (propRows ?? []) as PropRow[]

  // Open slots per listing, over the same horizon `/book-tour` itself queries.
  const openSlotsBySlug = new Map<string, number>()
  if (slugs.length) {
    const today = new Date()
    const { data: slots } = await supabaseAdmin
      .from('tour_availabilities')
      .select('property_slug')
      .in('property_slug', slugs)
      .eq('is_booked', false)
      .gte('date', dateOnly(today))
      .lte('date', dateOnly(new Date(today.getTime() + TOUR_SLOT_HORIZON_DAYS * 86_400_000)))
    for (const s of slots ?? []) {
      const key = s.property_slug as string
      openSlotsBySlug.set(key, (openSlotsBySlug.get(key) ?? 0) + 1)
    }
  }

  // Which listings have an answered FAQ worth linking from the pre-screen nudge.
  const propertyIds = props.map(p => p.id)
  const faqPropertyIds = new Set<string>()
  if (propertyIds.length) {
    const { data: faqs } = await supabaseAdmin
      .from('property_faqs')
      .select('property_id')
      .in('property_id', propertyIds)
      .neq('answer', '')
    for (const f of faqs ?? []) faqPropertyIds.add(f.property_id as string)
  }

  // Landlord first names, for an email that can say who is waiting.
  const ownerIds = Array.from(
    new Set(props.map(p => p.owner_id).filter((id): id is string => !!id))
  )
  const ownerFirstNames = new Map<string, string>()
  if (ownerIds.length) {
    // Never select a column `profiles` doesn't have: a bad column nulls the
    // whole row rather than the field, which is how the landlord rent emails
    // once died silently. `full_name` and nothing else.
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name')
      .in('id', ownerIds)
    for (const p of profiles ?? []) {
      const first = firstNameFrom(p.full_name as string | null)
      if (first) ownerFirstNames.set(p.id as string, first)
    }
  }

  const hasPrescreen = new Set((prescreens ?? []).map(p => p.lead_id as string))
  const hasLiveTour = new Set((tours ?? []).map(t => t.lead_id as string))
  const optedOut = new Set((optOuts ?? []).map(o => (o.email ?? '').toLowerCase()))
  const mailedRecently = new Set((recentSends ?? []).map(s => (s.email ?? '').toLowerCase()))

  const claimsByLead = new Map<string, FollowupKind[]>()
  for (const c of claims ?? []) {
    const list = claimsByLead.get(c.lead_id as string) ?? []
    list.push(c.kind as FollowupKind)
    claimsByLead.set(c.lead_id as string, list)
  }

  const propBySlug = new Map(props.map(p => [p.slug, p]))

  const candidates: Candidate[] = []
  const skipped: Record<string, number> = {}
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1 }

  // Addresses already spoken for by this run. Without this, three inquiries
  // from one student on Monday become three emails on Wednesday.
  const claimedThisRun = new Set<string>()

  for (const lead of leads) {
    const email = (lead.email ?? '').trim().toLowerCase()
    const prop = lead.property ? propBySlug.get(lead.property) : undefined

    // A lead whose listing row has gone missing is not something to guess
    // about: the slug is all we have, and we will not mail about a listing we
    // cannot read the state of.
    if (lead.property && !prop) { skip('listing not found'); continue }

    const listingAcceptsLeads = !prop
      ? true
      : !prop.archived_at &&
        hasActivePlan({ owner_plan_active: prop.owner_plan_active ?? undefined }) &&
        canReceiveLeads({
          listing_status: (prop.listing_status ?? 'active') as ListingStatus,
          accepting_inquiries: prop.accepting_inquiries ?? true,
          show_when_rented: prop.show_when_rented ?? false,
        })

    const openTourSlots = lead.property ? openSlotsBySlug.get(lead.property) ?? 0 : 0
    const ageDays = lead.created_at
      ? (Date.now() - new Date(lead.created_at).getTime()) / 86_400_000
      : null

    const decision = chooseFollowup({
      ageDays,
      status: lead.status,
      email,
      deliverable: !!email && isDeliverable(email),
      optedOut: optedOut.has(email),
      hasPrescreen: hasPrescreen.has(lead.id),
      tourInvited: !!lead.tour_invite_sent_at,
      hasLiveTour: hasLiveTour.has(lead.id),
      toured: lead.toured === true,
      openTourSlots,
      listingAcceptsLeads,
      alreadySent: claimsByLead.get(lead.id) ?? [],
      addressMailedRecently: mailedRecently.has(email),
    })

    if (!decision.send) { skip(decision.reason); continue }

    if (claimedThisRun.has(email)) { skip('another lead for this address this run'); continue }
    claimedThisRun.add(email)

    const imgs = prop?.property_images ?? []
    const hero = [...imgs].sort((a, b) => a.position - b.position)[0]?.url ?? null

    candidates.push({
      lead,
      email,
      kind: decision.kind,
      openTourSlots,
      propertyName: prop?.name ?? null,
      propertyAddress: prop?.address ?? null,
      heroImage: hero,
      landlordFirstName: prop?.owner_id ? ownerFirstNames.get(prop.owner_id) ?? null : null,
      hasFaqs: prop?.id ? faqPropertyIds.has(prop.id) : false,
    })
  }

  const batch = candidates.slice(0, MAX_PER_RUN)

  const renderFor = (c: Candidate) =>
    renderFollowupEmail({
      kind: c.kind,
      to: c.email,
      firstName: c.lead.first_name ?? '',
      propertyName: c.propertyName,
      propertyAddress: c.propertyAddress,
      heroImage: c.heroImage,
      landlordFirstName: c.landlordFirstName,
      hasFaqs: c.hasFaqs,
      propertySlug: c.lead.property,
      leadId: c.lead.id,
      openTourSlots: c.openTourSlots,
      site,
    })

  if (dryRun) {
    return Response.json({
      ok: true,
      dryRun: true,
      window: `${MIN_AGE_DAYS}-${MAX_AGE_DAYS} days`,
      considered: leads.length,
      skipped,
      wouldSend: batch.length,
      heldBack: candidates.length - batch.length,
      preview: batch.map(c => {
        const { subject, html } = renderFor(c)
        return {
          leadId: c.lead.id,
          email: c.email,
          kind: c.kind,
          ageDays: c.lead.created_at
            ? Number(((Date.now() - new Date(c.lead.created_at).getTime()) / 86_400_000).toFixed(1))
            : null,
          propertyName: c.propertyName,
          openTourSlots: c.openTourSlots,
          subject,
          // The body is what needs reviewing and it is several KB a head.
          html: params.get('full') === '1' ? html : `${html.slice(0, 400)}…`,
        }
      }),
    })
  }

  const resend = new Resend(process.env.RESEND_API_KEY!)
  let sent = 0
  const failures: string[] = []

  for (const c of batch) {
    const { subject, html } = renderFor(c)

    // Claim first, send second. The other order re-sends on any crash between
    // the two, and a duplicate nudge is worse than a missed one — the unique
    // constraint means a loser in a race simply skips.
    const { error: claimErr } = await supabaseAdmin
      .from('lead_followup_sends')
      .insert({ lead_id: c.lead.id, kind: c.kind, email: c.email, subject })

    if (claimErr) {
      // 23505 = unique violation: another run already has this one.
      if (claimErr.code !== '23505') {
        console.error('[lead-followups] claim failed', c.lead.id, claimErr.message)
        failures.push(c.email)
      }
      continue
    }

    try {
      const unsub = unsubscribeUrl(site, c.email, FOLLOWUP_CATEGORY)
      await resend.emails.send({
        from: FROM,
        to: c.email,
        subject,
        html,
        headers: {
          // Lets Gmail and Outlook show their own unsubscribe button, which is
          // what a recipient reaches for before the spam button.
          'List-Unsubscribe': `<${unsub}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      })
      sent++
      await logEmail(c.lead.id, LOG_TYPE[c.kind], subject, c.email, {
        property: c.propertyName,
        kind: c.kind,
      })
      console.log('[lead-followups] sent', c.kind, 'to', c.email, 'for lead', c.lead.id)
    } catch (err) {
      // The claim stays. A lead who misses this because Resend was down does
      // not get it tomorrow instead — by then the email would be stale, and
      // "sent once, ever" is the promise that keeps this defensible.
      console.error('[lead-followups] send failed', c.email, err)
      failures.push(c.email)
    }
  }

  return Response.json({
    ok: true,
    window: `${MIN_AGE_DAYS}-${MAX_AGE_DAYS} days`,
    considered: leads.length,
    skipped,
    sent,
    failed: failures.length,
    heldBack: candidates.length - batch.length,
  })
}
