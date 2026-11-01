/**
 * GET /api/cron/landlord-activation
 *
 * Emails landlords who signed up and never got listed, nudging them onto the
 * cheapest plan.
 *
 * ── The two audiences ─────────────────────────────────────────────────────
 *
 * Split, because they are not the same problem:
 *
 *   • `dormant_listing` — they have a property in the portal and no active
 *     plan, so `owner_plan_active` is false and the public site cannot show it.
 *     They did the work and nothing came of it, and most of them do not know
 *     why. This is the group worth writing to carefully.
 *   • `no_property` — signed up, added nothing. Sold on demand instead.
 *
 * ── What stops this becoming spam ─────────────────────────────────────────
 *
 * Four things, and all four matter:
 *
 *   1. `email_opt_outs` is checked before every send, and every email carries a
 *      one-click unsubscribe plus the `List-Unsubscribe` headers that let a
 *      mail client offer it natively.
 *   2. `landlord_activation_sends` has a unique (landlord, kind, step), so the
 *      claim is the database's job rather than this code's. A retry after a
 *      partial failure re-sends nothing.
 *   3. A fortnight between steps, and three steps total. After step 3 a
 *      landlord never hears about this again.
 *   4. A landlord who crosses over — adds a property, or starts a plan — stops
 *      qualifying immediately, because the segments are recomputed from current
 *      state on every run rather than from a list captured when the sequence
 *      began.
 *
 * Anyone with an active plan is excluded outright: they are a paying customer,
 * and selling them what they already bought is how you lose them.
 *
 * `?dry=1` reports exactly who would get what, and renders the mail, without
 * sending or claiming anything. It is the only safe way to point this at
 * production data, and it is worth doing before every copy change.
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextRequest } from 'next/server'
import { getSiteUrl } from '@/lib/siteUrl'
import { getPlatformStats } from '@/lib/platformStats'
import { planGrantsAccess } from '@/lib/landlordPlans'
import {
  renderActivationEmail,
  ACTIVATION_CATEGORY,
  STEP_GAP_DAYS,
  FINAL_STEP,
  type ActivationKind,
  type ActivationStep,
} from '@/lib/landlordActivationEmails'
import { unsubscribeUrl } from '@/lib/unsubscribeToken'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

const FROM = 'HomeHive <hello@homehive.live>'

/**
 * Don't pitch somebody who signed up an hour ago.
 *
 * They are quite possibly mid-way through adding a property in another tab, and
 * "you haven't listed anything" landing while they do it is the wrong message
 * from a product that should know better.
 */
const MIN_AGE_DAYS = 3

/** A cap per run, so a mistake in the segmentation cannot mail everyone at once. */
const MAX_PER_RUN = 50

type Candidate = {
  landlordId: string
  email: string
  firstName: string
  kind: ActivationKind
  step: ActivationStep
  propertyName: string | null
  hiddenCount: number
  ownLeads: number
}

const firstNameOf = (fullName: string | null, email: string): string => {
  const n = (fullName ?? '').trim()
  if (n) return n.split(/\s+/)[0]
  // Better than "there" when we have nothing: the local part is usually a name.
  const local = email.split('@')[0].replace(/[._\-+].*$/, '')
  return /^[a-z]+$/i.test(local) && local.length > 1
    ? local[0].toUpperCase() + local.slice(1).toLowerCase()
    : 'there'
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)

/**
 * Addresses that will hard-bounce, so we never send to them.
 *
 * Not validation — a syntax check passes everything here. These are the typo
 * domains people actually produce at signup (`gmail.con` is in this very
 * table), and at a list size of twenty a single hard bounce is a five percent
 * bounce rate, which is comfortably above the threshold where a provider starts
 * throttling or suspending a sending domain. Skipping one undeliverable address
 * protects the nineteen deliverable ones.
 *
 * Deliberately a small, certain list. Guessing at a correction and mailing the
 * guess would be worse than not mailing at all.
 */
const DEAD_DOMAINS = new Set([
  'gmail.con', 'gmail.cm', 'gmail.co', 'gmail.comm', 'gmail.cmo',
  'hotmail.con', 'hotmail.cmo', 'yahoo.con', 'yahoo.cmo',
  'icloud.con', 'outlook.con', 'gmai.com', 'gmial.com', 'gmaill.com',
])

const looksUndeliverable = (email: string): boolean => {
  const at = email.lastIndexOf('@')
  if (at < 1 || at === email.length - 1) return true
  const domain = email.slice(at + 1)
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return true
  return DEAD_DOMAINS.has(domain)
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

  const site = getSiteUrl()

  // ── Who are the landlords, and what state are they in? ──────────────────
  const { data: profiles, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('id, email, full_name, created_at')
    .eq('role', 'landlord')
    .lte('created_at', daysAgo(MIN_AGE_DAYS).toISOString())

  if (profErr) {
    console.error('[landlord-activation] profile lookup failed', profErr.message)
    return Response.json({ error: 'Lookup failed' }, { status: 500 })
  }

  const landlords = (profiles ?? []).filter(p => !!p.email)
  if (landlords.length === 0) {
    return Response.json({ ok: true, considered: 0, sent: 0, note: 'no landlords old enough' })
  }

  const ids = landlords.map(p => p.id)

  const [{ data: plans }, { data: props }, { data: sends }, { data: optOuts }, stats] =
    await Promise.all([
      supabaseAdmin.from('landlord_plans').select('landlord_id, plan_type, status').in('landlord_id', ids),
      supabaseAdmin
        .from('properties')
        .select('id, name, slug, owner_id, owner_plan_active, archived_at')
        .in('owner_id', ids)
        .is('archived_at', null),
      supabaseAdmin
        .from('landlord_activation_sends')
        .select('landlord_id, kind, step, sent_at')
        .in('landlord_id', ids),
      supabaseAdmin
        .from('email_opt_outs')
        .select('email')
        .eq('category', ACTIVATION_CATEGORY),
      getPlatformStats(supabaseAdmin),
    ])

  const planByLandlord = new Map((plans ?? []).map(p => [p.landlord_id, p]))
  const optedOut = new Set((optOuts ?? []).map(o => (o.email ?? '').toLowerCase()))

  const propsByOwner = new Map<string, { id: string; name: string | null; slug: string | null }[]>()
  for (const p of props ?? []) {
    const list = propsByOwner.get(p.owner_id) ?? []
    list.push({ id: p.id, name: p.name, slug: p.slug })
    propsByOwner.set(p.owner_id, list)
  }

  // Their own inquiry counts, so the hot segment can be told what is waiting.
  //
  // `leads.property` holds the property *slug* as text — there is no
  // `property_id` on that table — so the join is by slug, lowercased, which is
  // the same match the dashboard makes. Only queried when somebody actually
  // owns something.
  const slugs = (props ?? []).map(p => p.slug).filter((s): s is string => !!s)
  const leadsBySlug = new Map<string, number>()
  if (slugs.length > 0) {
    const { data: leads } = await supabaseAdmin
      .from('leads')
      .select('property')
      .in('property', slugs)
    for (const l of leads ?? []) {
      const key = (l.property ?? '').toLowerCase()
      if (!key) continue
      leadsBySlug.set(key, (leadsBySlug.get(key) ?? 0) + 1)
    }
  }

  type SendRow = { kind: string; step: number; sent_at: string }
  const sentByLandlord = new Map<string, SendRow[]>()
  for (const s of sends ?? []) {
    const list = sentByLandlord.get(s.landlord_id) ?? []
    list.push({ kind: s.kind, step: s.step, sent_at: s.sent_at })
    sentByLandlord.set(s.landlord_id, list)
  }

  const candidates: Candidate[] = []
  const skipped: Record<string, number> = {}
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1 }

  for (const p of landlords) {
    const email = (p.email as string).toLowerCase()

    if (optedOut.has(email)) { skip('opted out'); continue }

    if (looksUndeliverable(email)) {
      console.warn('[landlord-activation] skipping undeliverable address', email)
      skip('undeliverable address')
      continue
    }

    // A paying landlord is not a prospect.
    const plan = planByLandlord.get(p.id)
    if (planGrantsAccess(plan?.plan_type, plan?.status)) { skip('has an active plan'); continue }

    const owned = propsByOwner.get(p.id) ?? []
    const kind: ActivationKind = owned.length > 0 ? 'dormant_listing' : 'no_property'

    // Where are they in this sequence? Only this kind counts — somebody who got
    // the "no property" mails and has since added one starts the other
    // conversation at step 1, because it is genuinely a different message.
    const prior = (sentByLandlord.get(p.id) ?? []).filter(s => s.kind === kind)
    const lastStep = prior.reduce((m, s) => Math.max(m, s.step), 0)

    if (lastStep >= FINAL_STEP) { skip('sequence finished'); continue }

    // Space the steps out.
    const lastSentAt = prior.reduce<string | null>(
      (latest, s) => (!latest || s.sent_at > latest ? s.sent_at : latest),
      null,
    )
    if (lastSentAt && new Date(lastSentAt) > daysAgo(STEP_GAP_DAYS)) {
      skip('waiting for the step gap')
      continue
    }

    const ownLeads = owned.reduce(
      (sum, o) => sum + (o.slug ? leadsBySlug.get(o.slug.toLowerCase()) ?? 0 : 0),
      0,
    )

    candidates.push({
      landlordId: p.id,
      email,
      firstName: firstNameOf(p.full_name as string | null, email),
      kind,
      step: (lastStep + 1) as ActivationStep,
      propertyName: owned[0]?.name ?? null,
      hiddenCount: owned.length,
      ownLeads,
    })
  }

  const batch = candidates.slice(0, MAX_PER_RUN)

  if (dryRun) {
    return Response.json({
      ok: true,
      dryRun: true,
      stats,
      considered: landlords.length,
      skipped,
      wouldSend: batch.length,
      heldBack: candidates.length - batch.length,
      preview: batch.map(c => {
        const { subject, html } = renderActivationEmail({ ...c, to: c.email, site, stats })
        return {
          email: c.email,
          firstName: c.firstName,
          kind: c.kind,
          step: c.step,
          propertyName: c.propertyName,
          ownLeads: c.ownLeads,
          subject,
          // The full body is what needs reviewing, but it is 6 KB a head and
          // unreadable in a terminal. `?full=1` asks for it anyway.
          html: params.get('full') === '1' ? html : `${html.slice(0, 400)}…`,
        }
      }),
    })
  }

  const resend = new Resend(process.env.RESEND_API_KEY!)
  let sent = 0
  const failures: string[] = []

  for (const c of batch) {
    const { subject, html } = renderActivationEmail({ ...c, to: c.email, site, stats })

    // Claim first, send second. The other order re-sends on any crash between
    // the two, and a duplicate pitch is worse than a missed one — the unique
    // constraint means a loser in a race simply skips.
    const { error: claimErr } = await supabaseAdmin
      .from('landlord_activation_sends')
      .insert({
        landlord_id: c.landlordId,
        kind: c.kind,
        step: c.step,
        email: c.email,
        subject,
      })

    if (claimErr) {
      // 23505 = unique violation: another run already has this one.
      if (claimErr.code !== '23505') {
        console.error('[landlord-activation] claim failed', c.email, claimErr.message)
        failures.push(c.email)
      }
      continue
    }

    try {
      const unsub = unsubscribeUrl(site, c.email, ACTIVATION_CATEGORY)
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
      console.log('[landlord-activation] sent', c.kind, 'step', c.step, 'to', c.email)
    } catch (err) {
      // The claim stays. A landlord who misses one step because Resend was down
      // picks up at the next one rather than getting this step twice.
      console.error('[landlord-activation] send failed', c.email, err)
      failures.push(c.email)
    }
  }

  return Response.json({
    ok: true,
    considered: landlords.length,
    skipped,
    sent,
    failed: failures.length,
    heldBack: candidates.length - batch.length,
  })
}
