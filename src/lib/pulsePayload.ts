// The shape /api/landlord/pulse answers with.
//
// Its own module because a Next route file may only export HTTP handlers, and
// because the route and the overview must not be allowed to drift: the one
// place this type lives is the contract between them.

import type { Pulse } from './listingPulse'
import type { Funnel, Benchmark, BrowseClock } from './listingFunnel'
import type { LeasingPace } from './leasingPace'

/** One listing's own depth, for the drill-down. */
export type ListingDetail = {
  funnel: Funnel
  pace: LeasingPace
  views: number
  visitors: number
}

export type PulsePayload = {
  pulse: Pulse
  funnel: Funnel
  benchmarks: Benchmark[]
  clock: BrowseClock
  pace: LeasingPace
  /** Keyed by slug. */
  detail: Record<string, ListingDetail>
  /** The Phoenix day the window ends on. */
  asOf: string
}
