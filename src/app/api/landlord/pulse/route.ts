/**
 * GET /api/landlord/pulse?days=7|30[&slug=<listing>]
 *
 * Everything the landlord overview's traffic section shows: the day series,
 * the six-stage funnel, peer benchmarks, when students browse, leasing pace,
 * and a per-listing breakdown — all counted server-side.
 *
 * It has to be a route rather than a client query. `property_page_views` and
 * `listing_events` both grant SELECT to the service role only, which is the
 * right setting — the rows carry session ids, referrers and search positions —
 * so the counting happens here and only aggregates cross the wire.
 *
 * Scoping is by `owner_id` on the properties read, and every later read is
 * restricted to the slugs that came back from it. `slug` only narrows that
 * set, so passing somebody else's slug returns an empty pulse rather than
 * their traffic.
 *
 * The one deliberately cross-owner read is the peer pool, and it leaves here
 * as medians over a counted sample — never a row, a name or a slug. A landlord
 * cannot learn anything about an individual competitor from this endpoint,
 * only about the market they are both in.
 */
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import {
  buildPulse, PULSE_WINDOWS, DEFAULT_PULSE_WINDOW, phoenixDay, windowDayKeys,
} from '@/lib/listingPulse'
import type {
  Pulse, PulseWindow, PulseListing, PulseViewRow, PulseLeadRow, PulseTourRow,
} from '@/lib/listingPulse'
import { buildFunnel, buildBrowseClock, benchmark, MIN_PEER_LISTINGS } from '@/lib/listingFunnel'
import type { Benchmark, FunnelEventRow, FunnelViewRow } from '@/lib/listingFunnel'
import { buildPace } from '@/lib/leasingPace'
import type { PulsePayload } from '@/lib/pulsePayload'
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

/** The current window's start — what the funnel, clock and benchmarks use. */
function windowFrom(now: Date, days: number): string {
  return `${windowDayKeys(now, days)[0]}T07:00:00.000Z`
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
  const curFrom = windowFrom(now, windowDays)

  // ── The landlord's own listings ───────────────────────────────────────────
  const { data: own, error: ownErr } = await supabaseAdmin
    .from('properties')
    .select(`
      id, slug, name, listing_status, marketing_enabled, show_when_rented,
      admin_status, owner_plan_active, available, total_rooms, available_from
    `)
    .eq('owner_id', user.id)

  if (ownErr) {
    console.error('pulse: own listings failed', ownErr)
    return Response.json({ error: 'Could not load your listings.' }, { status: 500 })
  }

  const rows = (own ?? []).filter(l => !!l.slug && (!only || l.slug === only))

  const listings: PulseListing[] = rows.map(l => {
    const status = ((l.listing_status as string) || 'active') as ListingStatus
    const fields = {
      listing_status: status,
      show_when_rented: !!l.show_when_rented,
      marketing_enabled: !!l.marketing_enabled,
      owner_plan_active: l.owner_plan_active == null ? undefined : !!l.owner_plan_active,
    }
    // "Live" needs all three axes to agree, the same way the stat cards above
    // it read: approved by HomeHive, switched on by the landlord, and on a
    // plan we are being paid for.
    const approved = l.admin_status === 'active'
    const onPlan = hasActivePlan(fields)
    return {
      slug: l.slug as string,
      name: (l.name as string) || 'Untitled listing',
      isLive: approved && isMarketable(fields) && onPlan,
      isUnpublished: !onPlan,
    }
  })

  const emptyPayload = (): PulsePayload => ({
    pulse: buildPulse({ windowDays, now, listings: [], views: [], leads: [], tours: [] }),
    funnel: buildFunnel({ events: [], views: [], inquiries: 0, tours: 0 }),
    benchmarks: [],
    clock: buildBrowseClock([]),
    pace: buildPace({ now, roomsOpen: 0, inquiries: 0, windowDays }),
    detail: {},
    asOf: phoenixDay(now),
  })

  if (!listings.length) return Response.json(emptyPayload())

  const slugs = listings.map(l => l.slug)

  // ── Counted activity, over twice the window so the deltas have a baseline ─
  const [viewRes, leadRes, tourRes, eventRes, leaseRes, peerRes] = await Promise.all([
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
    supabaseAdmin
      .from('listing_events')
      .select('id, property_slug, event_type, anonymous_id, session_id, created_at, surface, position')
      .in('property_slug', slugs)
      .gte('created_at', curFrom),
    // History for the inquiries-per-signed-room ratio: the landlord's own
    // conversion beats the platform's assumption whenever it exists.
    supabaseAdmin
      .from('leases')
      .select('id, property_id, created_at')
      .in('property_id', rows.map(r => r.id))
      .gte('created_at', new Date(now.getTime() - 365 * 86_400_000).toISOString()),
    // The peer pool: every live listing on the platform, so the medians move
    // with the season instead of against a number baked in last spring.
    supabaseAdmin
      .from('properties')
      .select('slug, owner_id')
      .eq('is_active', true)
      .eq('admin_status', 'active')
      .eq('is_test', false)
      .is('archived_at', null),
  ])

  // One failed read must not take the section down: a pulse missing its tour
  // count still answers the question the landlord came here with.
  for (const [label, res] of [
    ['views', viewRes], ['leads', leadRes], ['tours', tourRes],
    ['events', eventRes], ['leases', leaseRes], ['peers', peerRes],
  ] as const) {
    if (res.error) console.error(`pulse: ${label} read failed`, res.error)
  }

  const views = (viewRes.data ?? []) as PulseViewRow[]
  const leads = (leadRes.data ?? []) as PulseLeadRow[]
  const tours = (tourRes.data ?? []) as PulseTourRow[]
  const events = (eventRes.data ?? []) as FunnelEventRow[]

  const pulse: Pulse = buildPulse({ windowDays, now, listings, views, leads, tours })

  // ── Current-window slices for the funnel ─────────────────────────────────
  const inWindow = <T extends { created_at: string }>(xs: T[]) =>
    xs.filter(x => x.created_at >= curFrom)

  const curViews = inWindow(views) as unknown as FunnelViewRow[]
  const curLeads = inWindow(leads)
  const curTours = inWindow(tours)

  // ── Peer benchmarks ──────────────────────────────────────────────────────
  const peerSlugs = (peerRes.data ?? [])
    .filter(p => p.owner_id !== user.id && !!p.slug)
    .map(p => p.slug as string)

  let peerViewsPerListing: number[] = []
  let peerRates: { ctrPct: number | null; engagedPct: number | null; inquiryPct: number | null } = {
    ctrPct: null, engagedPct: null, inquiryPct: null,
  }

  if (peerSlugs.length >= MIN_PEER_LISTINGS) {
    const [pv, pe, pl] = await Promise.all([
      supabaseAdmin.from('property_page_views')
        .select('property_slug, anonymous_id, session_id, id')
        .in('property_slug', peerSlugs).gte('created_at', curFrom),
      supabaseAdmin.from('listing_events')
        .select('property_slug, event_type')
        .in('property_slug', peerSlugs).gte('created_at', curFrom),
      supabaseAdmin.from('leads')
        .select('property')
        .in('property', peerSlugs).gte('created_at', curFrom),
    ])

    // Views per peer listing, for "is 12 views a week good?".
    const byListing = new Map<string, number>()
    for (const s of peerSlugs) byListing.set(s, 0)
    for (const r of pv.data ?? []) {
      const s = r.property_slug as string
      byListing.set(s, (byListing.get(s) ?? 0) + 1)
    }
    peerViewsPerListing = [...byListing.values()]

    // Pool-wide step rates. A pooled rate rather than a median of per-listing
    // rates: most individual listings have too little traffic for their own
    // rate to be anything, and a median of noise is noise.
    let imp = 0, clk = 0, eng = 0
    for (const e of pe.data ?? []) {
      if (e.event_type === 'impression') imp++
      else if (e.event_type === 'card_click') clk++
      else eng++
    }
    const pViews = (pv.data ?? []).length
    const pLeads = (pl.data ?? []).length
    const pct = (a: number, b: number, floor: number) =>
      b >= floor ? Math.round((a / b) * 1000) / 10 : null

    peerRates = {
      ctrPct: pct(clk, imp, 100),
      engagedPct: pct(eng, pViews, 50),
      inquiryPct: pct(pLeads, eng, 20),
    }
  }

  const funnel = buildFunnel({
    events,
    views: curViews,
    inquiries: curLeads.length,
    tours: curTours.length,
    peers: peerRates,
  })

  const clock = buildBrowseClock(curViews)

  // ── Leasing pace ─────────────────────────────────────────────────────────
  const roomsOpen = rows.reduce((s, r) => s + (Number(r.available) || 0), 0)
  // The soonest real move-in date across the open listings: the first deadline
  // that bites is the one worth counting down to.
  const today = phoenixDay(now)
  const futureDates = rows
    .map(r => (r.available_from as string | null) ?? null)
    .filter((d): d is string => !!d && d >= today)
    .sort()

  const historyInquiries = leads.length
  const roomsSigned = (leaseRes.data ?? []).length
  const pace = buildPace({
    now,
    roomsOpen,
    availableFrom: futureDates[0] ?? null,
    inquiries: curLeads.length,
    windowDays,
    history: roomsSigned > 0 ? { inquiries: historyInquiries, roomsSigned } : undefined,
  })

  const benchmarks: Benchmark[] = [
    benchmark(
      'views', `Views per listing (${windowDays}d)`,
      listings.length ? Math.round((pulse.views.value / listings.length) * 10) / 10 : null,
      peerViewsPerListing, 'count',
    ),
    benchmark('ctr', 'Search click-through', funnel.ctrPct, peerRates.ctrPct == null ? [] : [peerRates.ctrPct], '%'),
    benchmark('engaged', 'Visitors who looked around', funnel.engagedPct, peerRates.engagedPct == null ? [] : [peerRates.engagedPct], '%'),
  ]

  // ── Per-listing depth for the drill-down ─────────────────────────────────
  const detail: PulsePayload['detail'] = {}
  for (const l of listings) {
    const lViews = curViews.filter(v => v.property_slug === l.slug)
    const lEvents = events.filter(e => e.property_slug === l.slug)
    const lLeads = curLeads.filter(x => x.property === l.slug)
    const lTours = curTours.filter(x => x.property_slug === l.slug)
    const row = rows.find(r => r.slug === l.slug)
    detail[l.slug] = {
      funnel: buildFunnel({
        events: lEvents, views: lViews,
        inquiries: lLeads.length, tours: lTours.length, peers: peerRates,
      }),
      pace: buildPace({
        now,
        roomsOpen: Number(row?.available) || 0,
        availableFrom: (row?.available_from as string | null) ?? null,
        inquiries: lLeads.length,
        windowDays,
        history: roomsSigned > 0 ? { inquiries: historyInquiries, roomsSigned } : undefined,
      }),
      views: lViews.length,
      visitors: new Set(lViews.map(v => v.anonymous_id ?? v.session_id ?? v.id)).size,
    }
  }

  const payload: PulsePayload = {
    pulse, funnel, benchmarks, clock, pace, detail, asOf: phoenixDay(now),
  }
  return Response.json(payload)
}
