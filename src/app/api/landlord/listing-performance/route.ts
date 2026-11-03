/**
 * GET /api/landlord/listing-performance
 *
 * Everything the Performance page shows, counted server-side.
 *
 * It has to be a route rather than a client query, for two reasons that both
 * come down to RLS:
 *
 *   • `property_page_views` grants SELECT to the service role only. That is
 *     the right setting — view rows carry session ids and referrers — so the
 *     counting happens here and only aggregates cross the wire.
 *   • The comp set is deliberately cross-owner. A landlord must not be able to
 *     enumerate other people's listings through this endpoint, so the response
 *     carries comps as anonymous rows: a name, a distance and a per-bedroom
 *     price, which is exactly what the public listing pages already show, and
 *     nothing that is not already public.
 *
 * Scoping is by `owner_id` on every read. The client supplies no identifiers
 * at all beyond its bearer token.
 */
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import {
  buildReport, sortReports, summarise, perBedPrice,
  WINDOW_DAYS, MIN_VIEWS_TO_JUDGE,
} from '@/lib/listingPerformance'
import type {
  ListingFacts, ListingActivity, CompCandidate, ListingReport,
} from '@/lib/listingPerformance'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

/** `YYYY-MM-DD` in America/Phoenix — the same day boundary rent uses. */
function phoenixDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

const DAY_MS = 86_400_000

/** A zero-filled day series for the window, oldest first. */
function emptyDaily(now: Date): Array<{ date: string; views: number }> {
  return Array.from({ length: WINDOW_DAYS }, (_, i) => ({
    date: phoenixDay(new Date(now.getTime() - (WINDOW_DAYS - 1 - i) * DAY_MS)),
    views: 0,
  }))
}

/**
 * Where a view came from, in the landlord's terms.
 *
 * utm_source when the link was tagged, otherwise the referrer's host, and
 * "Direct" when there is neither. Hosts are stripped of `www.` so Google
 * arriving as two different strings does not read as two different channels.
 */
function sourceOf(row: { utm_source: string | null; referrer: string | null }): string {
  if (row.utm_source) return row.utm_source
  if (!row.referrer) return 'Direct'
  try {
    const host = new URL(row.referrer).hostname.replace(/^www\./, '')
    return host || 'Direct'
  } catch {
    return 'Direct'
  }
}

function tally(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function topEntries(map: Map<string, number>, limit: number) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, v]) => ({ source: k, views: v }))
}

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const now = new Date()
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * DAY_MS)
  // The window before this one, so "up 40%" means something.
  const prevStart = new Date(now.getTime() - 2 * WINDOW_DAYS * DAY_MS)

  // ── The landlord's own listings ───────────────────────────────────────────
  const { data: own, error: ownErr } = await supabaseAdmin
    .from('properties')
    .select(`
      id, slug, name, created_at, status_changed_at,
      listing_status, marketing_enabled, accepting_inquiries, show_when_rented,
      admin_status, archived_at, owner_plan_active,
      price, beds, baths, sqft, rental_mode, asu_distance,
      total_rooms, available, description,
      images:property_images ( id )
    `)
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })

  if (ownErr) {
    console.error('listing performance: own listings failed', ownErr)
    return Response.json({ error: 'Could not load your listings.' }, { status: 500 })
  }

  const listings = own ?? []
  if (!listings.length) {
    return Response.json({ reports: [], summary: summarise([]), marketInquiryRate: null, windowDays: WINDOW_DAYS })
  }

  const slugs = listings.map(l => l.slug).filter(Boolean) as string[]

  // ── Activity, counted over twice the window so the trend has a baseline ──
  const [viewRes, leadRes, tourRes, commentRes] = await Promise.all([
    supabaseAdmin
      .from('property_page_views')
      .select('property_slug, session_id, created_at, utm_source, referrer, device_type')
      .in('property_slug', slugs)
      .gte('created_at', prevStart.toISOString()),
    supabaseAdmin
      .from('leads')
      .select('property, created_at')
      .in('property', slugs),
    supabaseAdmin
      .from('tours')
      .select('property_slug, created_at, status')
      .in('property_slug', slugs)
      .gte('created_at', prevStart.toISOString()),
    supabaseAdmin
      .from('listing_comments')
      .select('property_slug, created_at')
      .in('property_slug', slugs)
      .gte('created_at', windowStart.toISOString()),
  ])

  // A listing is reported on even when one of these reads fails: a broken
  // comment count must not take the whole page down with it.
  const views = viewRes.data ?? []
  const leads = leadRes.data ?? []
  const tours = tourRes.data ?? []
  const comments = commentRes.data ?? []
  for (const [label, res] of [
    ['views', viewRes], ['leads', leadRes], ['tours', tourRes], ['comments', commentRes],
  ] as const) {
    if (res.error) console.error(`listing performance: ${label} read failed`, res.error)
  }

  // ── Per-listing counting ─────────────────────────────────────────────────
  type Acc = {
    activity: ListingActivity
    sessions: Set<string>
    sources: Map<string, number>
    devices: Map<string, number>
    dayIndex: Map<string, number>
  }
  const acc = new Map<string, Acc>()
  for (const l of listings) {
    const daily = emptyDaily(now)
    acc.set(l.slug, {
      activity: {
        viewsTotal: 0, views: 0, viewers: 0, viewsPrev: 0,
        inquiries: 0, inquiriesTotal: 0, tours: 0, questions: 0,
        daily, sources: [], devices: [], lastViewAt: null, lastInquiryAt: null,
      },
      sessions: new Set(),
      sources: new Map(),
      devices: new Map(),
      dayIndex: new Map(daily.map((d, i) => [d.date, i])),
    })
  }

  const windowStartMs = windowStart.getTime()

  for (const v of views) {
    const a = acc.get(v.property_slug as string)
    if (!a) continue
    const t = new Date(v.created_at as string).getTime()
    a.activity.viewsTotal++
    if (t < windowStartMs) { a.activity.viewsPrev++; continue }

    a.activity.views++
    // session_id is nullable — a view with none counts as its own visitor
    // rather than collapsing every anonymous hit into one.
    a.sessions.add((v.session_id as string) || `anon:${v.created_at}`)
    tally(a.sources, sourceOf(v as { utm_source: string | null; referrer: string | null }))
    tally(a.devices, (v.device_type as string) || 'unknown')

    const day = phoenixDay(new Date(t))
    const i = a.dayIndex.get(day)
    if (i != null) a.activity.daily[i].views++

    if (!a.activity.lastViewAt || (v.created_at as string) > a.activity.lastViewAt) {
      a.activity.lastViewAt = v.created_at as string
    }
  }

  for (const l of leads) {
    const a = acc.get(l.property as string)
    if (!a) continue
    a.activity.inquiriesTotal++
    if (new Date(l.created_at as string).getTime() >= windowStartMs) {
      a.activity.inquiries++
      if (!a.activity.lastInquiryAt || (l.created_at as string) > a.activity.lastInquiryAt) {
        a.activity.lastInquiryAt = l.created_at as string
      }
    }
  }

  for (const t of tours) {
    const a = acc.get(t.property_slug as string)
    if (!a) continue
    // A cancelled tour was still a student committing to come, which is the
    // signal the funnel is measuring. Only the window is filtered.
    if (new Date(t.created_at as string).getTime() >= windowStartMs) a.activity.tours++
  }

  for (const c of comments) {
    const a = acc.get(c.property_slug as string)
    if (a) a.activity.questions++
  }

  for (const a of acc.values()) {
    a.activity.viewers = a.sessions.size
    a.activity.sources = topEntries(a.sources, 6)
    a.activity.devices = topEntries(a.devices, 4).map(d => ({ device: d.source, views: d.views }))
  }

  // ── Comp pool: every public listing on the platform ──────────────────────
  const { data: pool } = await supabaseAdmin
    .from('properties')
    .select('slug, name, price, beds, rental_mode, asu_distance, owner_id')
    .eq('is_active', true)
    .eq('admin_status', 'active')
    .eq('is_test', false)
    .eq('owner_plan_active', true)
    .is('archived_at', null)
    .or('listing_status.eq.active,and(listing_status.eq.rented,show_when_rented.is.true)')

  const candidates: CompCandidate[] = (pool ?? []).map(p => ({
    slug: p.slug as string,
    name: p.name as string,
    price: Number(p.price) || 0,
    beds: Number(p.beds) || 0,
    rental_mode: (p.rental_mode as 'by_room' | 'whole_home' | null) ?? null,
    asu_distance: p.asu_distance == null ? null : Number(p.asu_distance),
    isOwn: p.owner_id === user.id,
  }))

  // ── The platform-wide inquiry rate, for context on a healthy listing ─────
  // Counted over the same window across the whole comp pool, so a landlord
  // comparing against it is comparing against this market and this season.
  const poolSlugs = candidates.map(c => c.slug)
  let marketInquiryRate: number | null = null
  if (poolSlugs.length) {
    const [{ count: poolViews }, { count: poolLeads }] = await Promise.all([
      supabaseAdmin
        .from('property_page_views')
        .select('id', { count: 'exact', head: true })
        .in('property_slug', poolSlugs)
        .gte('created_at', windowStart.toISOString()),
      supabaseAdmin
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .in('property', poolSlugs)
        .gte('created_at', windowStart.toISOString()),
    ])
    if ((poolViews ?? 0) >= MIN_VIEWS_TO_JUDGE) {
      marketInquiryRate = Math.round(((poolLeads ?? 0) / (poolViews ?? 1)) * 1000) / 10
    }
  }

  // ── Assemble ─────────────────────────────────────────────────────────────
  const reports: ListingReport[] = listings.map(l => {
    const facts: ListingFacts = {
      slug: l.slug as string,
      name: (l.name as string) || 'Untitled listing',
      created_at: l.created_at as string,
      status_changed_at: (l.status_changed_at as string) ?? null,
      listing_status: ((l.listing_status as string) || 'active') as ListingFacts['listing_status'],
      marketing_enabled: !!l.marketing_enabled,
      accepting_inquiries: !!l.accepting_inquiries,
      show_when_rented: !!l.show_when_rented,
      admin_status: (l.admin_status as string) ?? undefined,
      archived_at: (l.archived_at as string) ?? null,
      owner_plan_active: l.owner_plan_active == null ? undefined : !!l.owner_plan_active,
      price: Number(l.price) || 0,
      beds: Number(l.beds) || 0,
      rental_mode: (l.rental_mode as 'by_room' | 'whole_home' | null) ?? null,
      asu_distance: l.asu_distance == null ? null : Number(l.asu_distance),
      total_rooms: Number(l.total_rooms) || 0,
      available: Number(l.available) || 0,
      photoCount: Array.isArray(l.images) ? l.images.length : 0,
      hasDescription: !!(l.description as string | null)?.trim(),
    }
    const activity = acc.get(facts.slug)!.activity
    return buildReport(facts, activity, candidates, { marketInquiryRate, now })
  })

  const sorted = sortReports(reports)

  return Response.json({
    reports: sorted,
    summary: summarise(sorted),
    marketInquiryRate,
    windowDays: WINDOW_DAYS,
    // The anonymous market snapshot, for the comp table's footnote.
    marketSize: candidates.filter(c => perBedPrice(c) != null).length,
  })
}
