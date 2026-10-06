/**
 * The numbers HomeHive uses to sell a plan.
 *
 * Every figure here is counted from live data. That is the whole point: a
 * landlord deciding whether to pay is owed real demand, not a marketing
 * estimate, and a hardcoded "500+ students!" goes stale the moment someone
 * checks it. If the platform has a quiet month the pitch gets quieter with it
 * — which is the only version of this page we can defend.
 *
 * The headline is `topListingLeads`: the most inquiries a single listing has
 * taken. A landlord does not care about platform totals, they care what one
 * property like theirs can pull, and that number answers it directly.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type PlatformStats = {
  /** Most inquiries a single listing has received. The hero number. */
  topListingLeads: number
  /** Median inquiries across listings that have had any. Typical, not best-case. */
  medianListingLeads: number
  /** Total inquiries ever sent through the platform. */
  totalLeads: number
  /** Distinct renters who have inquired — the size of the demand pool. */
  distinctRenters: number
  /** Listing page views, all time. */
  siteVisits: number
  /** Tours actually booked through HomeHive. */
  tours: number
  /** Listings currently live and visible to students. */
  liveListings: number
}

/** Used when the counts cannot be read — all zeros, so the UI hides the stats. */
export const EMPTY_STATS: PlatformStats = {
  topListingLeads: 0,
  medianListingLeads: 0,
  totalLeads: 0,
  distinctRenters: 0,
  siteVisits: 0,
  tours: 0,
  liveListings: 0,
}

/** Postgres returns bigint/numeric as strings over PostgREST. */
const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return Number.isFinite(n) ? Math.trunc(n as number) : 0
}

/**
 * Count everything in one round trip.
 *
 * The aggregation lives in `homehive_platform_stats()` rather than in six
 * PostgREST `head: true` counts, because a median cannot be expressed as a
 * count and six sequential requests to render one hero line is not a trade
 * worth making.
 */
export async function getPlatformStats(db: SupabaseClient): Promise<PlatformStats> {
  const { data, error } = await db.rpc('homehive_platform_stats')

  if (error || !data) {
    console.error('[platformStats] could not read stats:', error)
    return EMPTY_STATS
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined
  if (!row) return EMPTY_STATS

  return {
    topListingLeads:    num(row.top_listing_leads),
    medianListingLeads: num(row.median_listing_leads),
    totalLeads:         num(row.total_leads),
    distinctRenters:    num(row.distinct_renters),
    siteVisits:         num(row.site_visits),
    tours:              num(row.tours),
    liveListings:       num(row.live_listings),
  }
}

/** "2,014" — thousands separators, because 2014 on its own reads as a year. */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * Round a count down to a confident floor: 198 → "190+", 2014 → "2,000+".
 *
 * Rounding *down* matters. An exact count invites argument and goes stale
 * between page loads; a floor stays true as the number grows.
 */
export function formatFloor(n: number): string {
  if (n < 10) return String(n)
  const step = n < 100 ? 10 : n < 1_000 ? 50 : 500
  return `${formatCount(Math.floor(n / step) * step)}+`
}
