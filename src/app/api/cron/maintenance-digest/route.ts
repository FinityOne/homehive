/**
 * GET /api/cron/maintenance-digest
 *
 * The Friday maintenance summary. One email per landlord: what is overdue,
 * what lands in the next seven days, what has stalled, and what got finished.
 *
 * ── Who gets it ───────────────────────────────────────────────────────────
 *
 * A landlord with an active plan and something on their list. Both halves
 * matter:
 *
 *   • Maintenance is a paid section (`landlordAccess.ts`), so a free landlord
 *     cannot open the page this mail links to. Mailing them a summary of work
 *     behind a paywall is a worse pitch than not mailing them at all.
 *   • `worthSending` is false when the list holds no open work and nothing was
 *     finished this week. A weekly "you have 0 items" is the mail that teaches
 *     a landlord to filter the whole sender.
 *
 * ── What stops it becoming spam ───────────────────────────────────────────
 *
 *   1. `email_opt_outs` is checked before every send, every mail carries a
 *      one-click unsubscribe and the `List-Unsubscribe` headers, and the
 *      category is scoped (`maintenance_digest`) so opting out of this never
 *      silences a rent receipt or a lease document.
 *   2. `maintenance_digest_sends` has a unique (landlord, week) for scheduled
 *      runs, claimed *before* the send. A retry after a partial failure
 *      re-sends nothing.
 *   3. It is genuinely weekly, and it is genuinely about their own data. There
 *      is no pitch in it.
 *
 * ── Params ────────────────────────────────────────────────────────────────
 *
 *   ?dry=1      compute and render everything, send and claim nothing. The
 *               only safe way to point this at production data.
 *   ?full=1     with `dry`, include the whole rendered HTML rather than a head.
 *   ?manual=1   send now, outside the weekly claim — the on-demand send. Logged
 *               as `kind = 'manual'` so the Friday run still fires normally.
 *   ?to=a@b.com restrict to one address, for a live test of the real thing.
 *   ?limit=N    cap the batch below `MAX_PER_RUN`.
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextRequest } from 'next/server'
import { getSiteUrl } from '@/lib/siteUrl'
import { planGrantsAccess } from '@/lib/landlordPlans'
import { unsubscribeUrl } from '@/lib/unsubscribeToken'
import {
  buildMaintenanceDigest,
  MAINTENANCE_DIGEST_CATEGORY,
  type MaintenanceDigest,
} from '@/lib/maintenanceDigest'
import { buildMaintenanceDigestEmail } from '@/lib/maintenanceDigestEmail'
import type { WorkItem } from '@/lib/maintenance'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

const FROM = 'HomeHive <hello@homehive.live>'

/** A cap per run, so a segmentation mistake cannot mail the whole table. */
const MAX_PER_RUN = 100

type Candidate = {
  landlordId: string
  email: string
  fullName: string | null
  digest: MaintenanceDigest
  /** Named in the subject when they have exactly one property with work on it. */
  subjectLabel: string | null
}

/** Same numeric coercion the rest of the app applies to these columns. */
function toWorkItem(row: any): WorkItem {
  return {
    ...row,
    estimated_cost: row.estimated_cost == null ? null : Number(row.estimated_cost),
    actual_cost: row.actual_cost == null ? null : Number(row.actual_cost),
  }
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
  const manual = params.get('manual') === '1'
  const onlyTo = (params.get('to') ?? '').trim().toLowerCase() || null
  const limit = Math.min(Number(params.get('limit')) || MAX_PER_RUN, MAX_PER_RUN)

  if (!dryRun && !process.env.RESEND_API_KEY) {
    return Response.json({ error: 'Email is not configured' }, { status: 500 })
  }

  const site = getSiteUrl()
  const listUrl = `${site}/landlord/maintenance`
  const now = new Date()

  // ── Who is paying? ───────────────────────────────────────────────────────
  //
  // The audience starts from the plan, not from `profiles.role`. Owning
  // property and being flagged a landlord are not the same thing in this
  // table — the account that holds this app's only active plan carries
  // `role = 'admin'`, owns every work item, and a role filter silently
  // excluded it. The plan is the fact that matters here: it is what unlocks
  // the maintenance page this mail links to.
  const skipped: Record<string, number> = {}
  const skip = (why: string, n = 1) => { skipped[why] = (skipped[why] ?? 0) + n }

  const { data: plans, error: planErr } = await supabaseAdmin
    .from('landlord_plans')
    .select('landlord_id, plan_type, status')

  if (planErr) {
    console.error('[maintenance-digest] plan lookup failed', planErr.message)
    return Response.json({ error: 'Lookup failed' }, { status: 500 })
  }

  const payingIds = (plans ?? [])
    .filter(p => planGrantsAccess(p.plan_type, p.status))
    .map(p => p.landlord_id)
  skip('no active plan', (plans ?? []).length - payingIds.length)

  if (payingIds.length === 0) {
    return Response.json({ ok: true, considered: (plans ?? []).length, skipped, sent: 0 })
  }

  const [{ data: profiles, error: profErr }, { data: optOuts }] = await Promise.all([
    supabaseAdmin.from('profiles').select('id, email, full_name').in('id', payingIds),
    supabaseAdmin.from('email_opt_outs').select('email').eq('category', MAINTENANCE_DIGEST_CATEGORY),
  ])

  if (profErr) {
    console.error('[maintenance-digest] profile lookup failed', profErr.message)
    return Response.json({ error: 'Lookup failed' }, { status: 500 })
  }

  const optedOut = new Set((optOuts ?? []).map(o => (o.email ?? '').toLowerCase()))

  const paying = (profiles ?? []).filter(p => !!p.email)
  skip('no email on profile', (profiles ?? []).length - paying.length)

  if (paying.length === 0) {
    return Response.json({ ok: true, considered: payingIds.length, skipped, sent: 0 })
  }

  // ── Their work, in one query ─────────────────────────────────────────────
  // Everything, not just the open rows: the digest reports on work finished
  // this week too, and `computeTotals` needs the closed items to say anything
  // about cost.
  const { data: itemRows, error: itemErr } = await supabaseAdmin
    .from('property_work_items')
    .select('*, property:properties ( id, name, slug )')
    .in('owner_id', paying.map(p => p.id))

  if (itemErr) {
    console.error('[maintenance-digest] work item lookup failed', itemErr.message)
    return Response.json({ error: 'Lookup failed' }, { status: 500 })
  }

  const itemsByOwner = new Map<string, WorkItem[]>()
  for (const row of itemRows ?? []) {
    const list = itemsByOwner.get(row.owner_id) ?? []
    list.push(toWorkItem(row))
    itemsByOwner.set(row.owner_id, list)
  }

  // ── Who has already had this week's? ─────────────────────────────────────
  // Only relevant to the scheduled run; a manual send is outside the claim.
  const weekKey = buildMaintenanceDigest([], now).asOf
  const alreadySent = new Set<string>()
  if (!manual) {
    const { data: sends } = await supabaseAdmin
      .from('maintenance_digest_sends')
      .select('landlord_id')
      .eq('kind', 'weekly')
      .eq('week_start', weekKey)
    for (const s of sends ?? []) alreadySent.add(s.landlord_id)
  }

  const candidates: Candidate[] = []

  for (const p of paying) {
    const email = (p.email as string).toLowerCase()

    if (onlyTo && email !== onlyTo) { skip('not the requested address'); continue }
    if (optedOut.has(email)) { skip('opted out'); continue }
    if (alreadySent.has(p.id)) { skip('already had this week'); continue }

    const items = itemsByOwner.get(p.id) ?? []
    if (items.length === 0) { skip('no maintenance items'); continue }

    const digest = buildMaintenanceDigest(items, now)
    if (!digest.worthSending) { skip('nothing worth sending'); continue }

    // One property on the list reads better named than counted; several would
    // make the subject line longer than the phone shows.
    const names = new Set(
      items.filter(i => i.status !== 'cancelled').map(i => i.property?.name).filter(Boolean)
    )
    candidates.push({
      landlordId: p.id,
      email,
      fullName: (p.full_name as string | null) ?? null,
      digest,
      subjectLabel: names.size === 1 ? [...names][0]! : null,
    })
  }

  const batch = candidates.slice(0, limit)

  const renderFor = (c: Candidate) =>
    buildMaintenanceDigestEmail({
      digest: c.digest,
      landlordName: c.fullName,
      subjectLabel: c.subjectLabel,
      listUrl,
      unsubscribeUrl: unsubscribeUrl(site, c.email, MAINTENANCE_DIGEST_CATEGORY),
    })

  if (dryRun) {
    return Response.json({
      ok: true,
      dryRun: true,
      week: weekKey,
      considered: (plans ?? []).length,
      paying: paying.length,
      skipped,
      wouldSend: batch.length,
      heldBack: candidates.length - batch.length,
      preview: batch.map(c => {
        const { subject, html, text } = renderFor(c)
        return {
          email: c.email,
          name: c.fullName,
          subject,
          open: c.digest.totals.open,
          overdue: c.digest.overdue.length,
          dueSoon: c.digest.dueSoon.length,
          stalled: c.digest.stalled.length,
          completedThisWeek: c.digest.completed.length,
          undated: c.digest.undatedCount,
          properties: c.digest.propertyCount,
          text,
          html: params.get('full') === '1' ? html : `${html.slice(0, 300)}…`,
        }
      }),
    })
  }

  const resend = new Resend(process.env.RESEND_API_KEY!)
  const kind = manual ? 'manual' : 'weekly'
  let sent = 0
  const failures: string[] = []

  for (const c of batch) {
    const { subject, html, text } = renderFor(c)

    // Claim first, send second. The other order re-sends on any crash between
    // the two, and a duplicate digest is worse than a late one — the unique
    // index means a loser in a race simply skips.
    const { error: claimErr } = await supabaseAdmin
      .from('maintenance_digest_sends')
      .insert({
        landlord_id: c.landlordId,
        week_start: weekKey,
        kind,
        email: c.email,
        subject,
        open_count: c.digest.totals.open,
        overdue_count: c.digest.overdue.length,
      })

    if (claimErr) {
      // 23505 = unique violation: another run already has this landlord's week.
      if (claimErr.code !== '23505') {
        console.error('[maintenance-digest] claim failed', c.email, claimErr.message)
        failures.push(c.email)
      }
      continue
    }

    try {
      const unsub = unsubscribeUrl(site, c.email, MAINTENANCE_DIGEST_CATEGORY)
      await resend.emails.send({
        from: FROM,
        to: c.email,
        subject,
        html,
        text,
        headers: {
          // Lets Gmail and Outlook show their own unsubscribe button, which is
          // what a recipient reaches for before the spam button.
          'List-Unsubscribe': `<${unsub}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      })
      sent++
      console.log('[maintenance-digest] sent', kind, 'to', c.email, `(${c.digest.totals.open} open)`)
    } catch (err) {
      // The claim stays for a weekly run: a landlord who misses one week
      // because Resend was down gets next week's rather than two at once.
      console.error('[maintenance-digest] send failed', c.email, err)
      failures.push(c.email)
    }
  }

  return Response.json({
    ok: true,
    kind,
    week: weekKey,
    considered: (plans ?? []).length,
    paying: paying.length,
    skipped,
    sent,
    failed: failures.length,
    failures,
    heldBack: candidates.length - batch.length,
  })
}
