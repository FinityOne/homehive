/**
 * GET /api/landlord/pulse?days=7|30[&slug=<listing>]
 *
 * The traffic half of the landlord overview: views, unique visitors and
 * inquiries per day, with a previous-window comparison and a per-listing
 * breakdown.
 *
 * It has to be a route rather than a client query. `property_page_views` has
 * RLS that grants SELECT to the service role only, which is the right setting
 * — the rows carry session ids, referrers and IP-derived fields — so the
 * counting happens here and only aggregates cross the wire. The same reasoning
 * put /api/landlord/listing-performance here.
 *
 * Scoping is by `owner_id` on the properties read, and every later read is
 * restricted to the slugs that came back from it. `slug` only narrows that
 * set, so passing somebody else's slug returns an empty pulse rather than
 * their traffic.
 */
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import {
  buildPulse, PULSE_WINDOWS, DEFAULT_PULSE_WINDOW, phoenixDay, windowDayKeys,
} from '@/lib/listingPulse'
import type {
  Pulse, PulseWindow, PulseListing, PulseViewRow, PulseLeadRow, PulseTourRow,
} from '@/lib/listingPulse'
import { isMarketable, hasActivePlan } from '@/lib/listingStatus'
import type { ListingStatus } from '@/lib/listingStatus'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

function parseWindow(raw: string | null): PulseWindow {
  const n = Number(raw)
  return (PULSE_WINDOWS as readonly number[]).includes(n) ? (n as PulseWindow) : DEFAULT_PULSE_WINDOW
}

/**
 * The instant the oldest day of the *previous* window began, in UTC.
 *
 * Derived from the Phoenix day keys rather than by subtracting 2 × days ×
 * 86.4e6 from now: the engine buckets by Phoenix calendar day, and a naive
 * subtraction cuts the oldest day off part-way through, which silently shrinks
 * the baseline the deltas are measured against.
 */
function readFrom(now: Date, days: number): string {
  const oldest = windowDayKeys(now, days, days)[0]
  // Phoenix is UTC−7 year round (no DST), so its midnight is 07:00Z.
  return `${oldest}T07:00:00.000Z`
}

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const windowDays = parseWindow(req.nextUrl.searchParams.get('days'))
  const only = req.nextUrl.searchParams.get('slug')
  const now = new Date()
  const from = readFrom(now, windowDays)

  // ── The landlord's own listings ───────────────────────────────────────────
  const { data: own, error: ownErr } = await supabaseAdmin
    .from('properties')
    .select(`
      slug, name, listing_status, marketing_enabled, show_when_rented,
      admin_status, owner_plan_active
    `)
    .eq('owner_id', user.id)

  if (ownErr) {
    console.error('pulse: own listings failed', ownErr)
    return Response.json({ error: 'Could not load your listings.' }, { status: 500 })
  }

  const listings: PulseListing[] = (own ?? [])
    .filter(l => !!l.slug && (!only || l.slug === only))
    .map(l => {
      const status = ((l.listing_status as string) || 'active') as ListingStatus
      const fields = {
        listing_status: status,
        show_when_rented: !!l.show_when_rented,
        marketing_enabled: !!l.marketing_enabled,
        owner_plan_active: l.owner_plan_active == null ? undefined : !!l.owner_plan_active,
      }
      // "Live" needs all three axes to agree, the same way the stat cards
      // above it read: approved by HomeHive, switched on by the landlord, and
      // on a plan we are being paid for.
      const approved = l.admin_status === 'active'
      const onPlan = hasActivePlan(fields)
      return {
        slug: l.slug as string,
        name: (l.name as string) || 'Untitled listing',
        isLive: approved && isMarketable(fields) && onPlan,
        isUnpublished: !onPlan,
      }
    })

  if (!listings.length) {
    return Response.json({
      pulse: buildPulse({ windowDays, now, listings: [], views: [], leads: [], tours: [] }),
      asOf: phoenixDay(now),
    })
  }

  const slugs = listings.map(l => l.slug)

  // ── Counted activity, over twice the window so the deltas have a baseline ─
  const [viewRes, leadRes, tourRes] = await Promise.all([
    supabaseAdmin
      .from('property_page_views')
      .select('id, property_slug, anonymous_id, session_id, created_at, utm_source, referrer, device_type')
      .in('property_slug', slugs)
      .gte('created_at', from),
    supabaseAdmin
      .from('leads')
      .select('property, created_at, status')
      .in('property', slugs)
      .gte('created_at', from),
    supabaseAdmin
      .from('tours')
      .select('property_slug, created_at')
      .in('property_slug', slugs)
      .gte('created_at', from),
  ])

  // One failed read must not take the section down: a pulse missing its tour
  // count still answers the question the landlord came here with.
  for (const [label, res] of [['views', viewRes], ['leads', leadRes], ['tours', tourRes]] as const) {
    if (res.error) console.error(`pulse: ${label} read failed`, res.error)
  }

  const pulse: Pulse = buildPulse({
    windowDays,
    now,
    listings,
    views: (viewRes.data ?? []) as PulseViewRow[],
    leads: (leadRes.data ?? []) as PulseLeadRow[],
    tours: (tourRes.data ?? []) as PulseTourRow[],
  })

  return Response.json({ pulse, asOf: phoenixDay(now) })
}
