import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/landlordPlanServer'
import type { ActivityEvent } from '@/lib/landlordActivity'

/**
 * The feed, and the one place it is marked read.
 *
 * Every activity surface in the portal reads this endpoint: the bell in the
 * top bar, the sidebar badge, the full Activity page, and the small embedded
 * feeds on a property or a lease. They differ only by query string, which is
 * what guarantees the bell's count and the page's list can never disagree.
 *
 * Service-role for the read, with `landlord_id` pinned to the session user.
 * `landlord_activity` has an owner-only RLS policy as a second line, but the
 * sync below writes across landlords and must not run as the caller.
 */

/** How far back the on-read sync looks. */
const SYNC_WINDOW_DAYS = 10

/**
 * Why sync on read rather than from triggers or a cron.
 *
 * Triggers on nine source tables is nine places to forget one. A cron makes
 * the feed as stale as its interval, and "a payment failed four minutes ago"
 * is the one event where that interval is the whole value of the feature.
 *
 * So the feed syncs itself when someone looks at it, over a short trailing
 * window — bounded by time, not by table size, so it costs the same next year
 * as it does today. It is skipped for paginated and embedded reads: those are
 * always preceded by an unscoped first page that has just done it, and paying
 * for the sync again on every scroll and every property page would be the
 * whole latency budget spent on an answer we already have.
 */
async function syncFeed(admin: ReturnType<typeof supabaseAdmin>) {
  const since = new Date(Date.now() - SYNC_WINDOW_DAYS * 86400_000).toISOString()
  const { error } = await admin.rpc('sync_landlord_feed', { p_since: since })
  // A failed sync is not a failed read. The landlord still gets every event
  // recorded up to now, which is strictly better than an error page.
  if (error) console.error('[activity] sync failed:', error.message)
}

const SELECT =
  'id, kind, occurred_at, title, detail, href, actor_name, actor_email, ' +
  'property_id, plan_id, amount, meta'

export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200)
  const before = url.searchParams.get('before')
  const propertyId = url.searchParams.get('property')
  const planId = url.searchParams.get('plan')
  const email = url.searchParams.get('email')
  const scoped = !!(propertyId || planId || email)

  const admin = supabaseAdmin()
  if (!before && !scoped) await syncFeed(admin)

  // The watermark. A landlord with no row has never been given one, which only
  // happens for an account created after the backfill — so everything they
  // have is new to them, and `null` is read that way downstream.
  const { data: readRow } = await admin
    .from('landlord_activity_reads')
    .select('last_read_at')
    .eq('landlord_id', user.id)
    .maybeSingle()
  const lastReadAt: string | null = readRow?.last_read_at ?? null

  let q = admin
    .from('landlord_activity')
    .select(SELECT)
    .eq('landlord_id', user.id)
    .order('occurred_at', { ascending: false })
    // One past the page, so "load more" can be offered without a second query.
    .limit(limit + 1)

  if (before) q = q.lt('occurred_at', before)
  if (propertyId) q = q.eq('property_id', propertyId)
  if (planId) q = q.eq('plan_id', planId)
  // Lowercased on the way in by the sync, so an exact match is safe and uses
  // the index rather than falling back to a scan the way `ilike` would.
  if (email) q = q.eq('actor_email', email.trim().toLowerCase())

  const { data, error } = await q
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as unknown as ActivityEvent[]
  const hasMore = rows.length > limit
  const events = hasMore ? rows.slice(0, limit) : rows

  // Counted in the database, not from the page above.
  //
  // The badge must be the truth about the whole feed, not about the fifty rows
  // that happened to be fetched — a count that is really "unread among the
  // first page" is the dishonest badge every notification write-up names: the
  // number stops matching the list and people stop trusting both.
  let unread = 0
  if (!scoped) {
    let c = admin
      .from('landlord_activity')
      .select('id', { count: 'exact', head: true })
      .eq('landlord_id', user.id)
    if (lastReadAt) c = c.gt('occurred_at', lastReadAt)
    const { count } = await c
    unread = count ?? 0
  }

  return Response.json({
    events,
    lastReadAt,
    unreadCount: unread,
    hasMore,
    // The cursor for the next page, so the client never has to know that the
    // feed is ordered by `occurred_at`.
    nextBefore: hasMore ? events[events.length - 1]?.occurred_at ?? null : null,
  })
}

/**
 * Mark read.
 *
 * `{ action: 'mark_all_read' }` moves the watermark to now — one row written,
 * whatever the size of the history behind it.
 *
 * `{ action: 'mark_all_read', until: <iso> }` exists for the bell panel, which
 * shows a page and then marks it: moving the mark to *now* would silently
 * clear events the landlord was never shown, which is the one way a
 * notification centre can lose something for good. So the panel marks up to
 * the newest row it actually rendered.
 *
 * The watermark never moves backwards. A slow request that arrives after a
 * newer one must not resurrect events as unread.
 */
export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { action?: string; until?: string }
  if (body.action !== 'mark_all_read') {
    return Response.json({ error: 'Unknown action' }, { status: 400 })
  }

  const until = body.until && !Number.isNaN(Date.parse(body.until))
    ? new Date(body.until)
    : new Date()
  // Never into the future: a clock-skewed client must not blank out events
  // that have not happened yet.
  const now = new Date()
  const target = (until > now ? now : until).toISOString()

  const admin = supabaseAdmin()
  const { data: existing } = await admin
    .from('landlord_activity_reads')
    .select('last_read_at')
    .eq('landlord_id', user.id)
    .maybeSingle()

  if (existing?.last_read_at && new Date(existing.last_read_at) >= new Date(target)) {
    return Response.json({ lastReadAt: existing.last_read_at, unreadCount: null })
  }

  const { error } = await admin
    .from('landlord_activity_reads')
    .upsert(
      { landlord_id: user.id, last_read_at: target, updated_at: now.toISOString() },
      { onConflict: 'landlord_id' },
    )
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const { count } = await admin
    .from('landlord_activity')
    .select('id', { count: 'exact', head: true })
    .eq('landlord_id', user.id)
    .gt('occurred_at', target)

  return Response.json({ lastReadAt: target, unreadCount: count ?? 0 })
}
