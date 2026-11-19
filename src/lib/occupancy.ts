/**
 * Is the property full? One engine, one answer, everywhere.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * The portal used to answer this question three different ways and so gave
 * three different answers for the same building on the same day:
 *
 *   • **`properties.available`** — a *marketing* number the landlord types into
 *     the listing editor ("I am advertising 6 rooms"). The Overview, the
 *     Listings list, Performance and the traffic Pulse all read it as though it
 *     meant "rooms standing empty". It does not. Nothing writes it when a lease
 *     is signed, so a landlord who filled every room through HomeHive — signed
 *     the lease here, built the payment plan here, collected the rent here —
 *     was still told `0 of 6 rooms filled`. That is the bug this file closes.
 *   • **`property_rooms.is_available`** — the same marketing flag, per room,
 *     and just as stale. It is what the public listing shows, and it is never
 *     occupancy.
 *   • **Counting payers on a payment plan** (`rentRoll`, `propertyMoney`) —
 *     right in spirit and wrong at the edge: a signed lease that has no plan
 *     built on it yet counts nobody, so a brand-new tenancy reads as a vacancy.
 *
 * A room is filled when somebody has a *lease* on it. That is the only fact in
 * the database that means occupancy, so it is the only fact this file reads.
 * Marketing flags describe what is being advertised and are left to do that.
 *
 * ── How a lease is turned into rooms ───────────────────────────────────────
 *
 * `roomsHeld` below. The short version:
 *
 *   • A **whole-home** letting is indivisible — one live lease takes the
 *     building, whatever the room count says.
 *   • A **by-the-room** lease that names its room (`unit_number`) holds exactly
 *     that one room, however many people sleep in it. A couple sharing a master
 *     is one room let, not two.
 *   • A by-the-room lease that names *no* room is the whole-house group lease
 *     students actually sign: it holds one room per person on it.
 *
 * ── On "filled" versus "spoken for" ────────────────────────────────────────
 *
 * Two different questions, and conflating them is how a dashboard tells a
 * landlord to go market a room they let last week:
 *
 *   • `occupied` — somebody is living there *today*. This is the occupancy
 *     percentage, and it is what a rent roll means.
 *   • `committed` — occupied, plus rooms held by a lease that has been signed
 *     and starts later. `open` is what is left over, and `open` is the only
 *     figure that should ever drive a "go fill this" nudge.
 *
 * ── Dates ──────────────────────────────────────────────────────────────────
 *
 * Every comparison is a 'YYYY-MM-DD' string compare against `billingToday()`,
 * the same Phoenix calendar the money area bills on. Never `new Date(start) >
 * new Date()`: that parses the date as UTC midnight and compares it to the
 * reader's local midnight, so a landlord in London is told a lease starting
 * today has not started, and the same building reads differently depending on
 * who opened the page.
 */

import { billingToday } from '@/lib/rentPayments'

// ─── INPUTS ──────────────────────────────────────────────────────────────────

/**
 * The least a lease has to say for this engine to place it.
 *
 * Deliberately structural rather than `Lease`: the Overview, the money tree and
 * the Pulse route each load leases in their own shape, and all three have to
 * get the same answer out of this file.
 */
export type OccupancyLease = {
  start_date: string | null
  end_date: string | null
  /** A rehearsal. Charges nothing, houses nobody, counts for nothing here. */
  is_demo?: boolean | null
  /** Names the single room let, in a by-the-room letting. */
  unit_number?: string | null
  /** People on the tenancy. See `tenantCountOf`. */
  tenantCount: number
}

export type OccupancyProperty = {
  /** Lettable rooms, as the listing declares. 0/null means "not configured". */
  total_rooms?: number | null
  rental_mode?: 'whole_home' | 'by_room' | string | null
}

/** Where a lease sits against the billing calendar today. */
export type LeasePhase = 'current' | 'upcoming' | 'past'

export type PropertyOccupancy = {
  /** Lettable rooms. Null when the listing has never said. */
  totalRooms: number | null
  /** Does the listing declare a room count? Everything below is guesswork without one. */
  known: boolean
  /** Rooms lived in today. */
  occupied: number
  /** Rooms held by a signed lease that starts later. */
  upcoming: number
  /** `occupied + upcoming`, capped at the room count. */
  committed: number
  /** `totalRooms − occupied`. What a rent roll calls a vacancy. */
  vacant: number
  /**
   * `totalRooms − committed`. Rooms with nobody signed for them at all — the
   * only figure that should drive "go market this".
   */
  open: number
  /** `occupied ÷ totalRooms`, 0–100. Null without a room count. */
  pct: number | null
  /** True when every room is lived in today. */
  full: boolean
  /** Live leases counted, for the "why does it say that" line. */
  activeLeases: number
}

// ─── THE RULE ────────────────────────────────────────────────────────────────

/** Where a lease sits today, on the billing calendar. */
export function leasePhase(
  lease: Pick<OccupancyLease, 'start_date' | 'end_date'>,
  today: string = billingToday(),
): LeasePhase {
  const start = lease.start_date ?? ''
  const end = lease.end_date ?? ''
  if (start && start > today) return 'upcoming'
  // An open-ended tenancy (month-to-month, no end date recorded) is running.
  if (end && end < today) return 'past'
  return 'current'
}

/** Is this lease one that houses somebody — now or on a signed future date? */
export const housesSomeone = (l: OccupancyLease, today?: string) =>
  !l.is_demo && leasePhase(l, today) !== 'past'

/**
 * How many rooms does this one lease take out of the building?
 *
 * Floored at 1: a lease with no tenants recorded yet is still a let room. A
 * signed tenancy whose tenant rows have not been entered must never read as a
 * vacancy — that is the failure mode that makes a landlord distrust the figure.
 */
export function roomsHeld(
  lease: OccupancyLease,
  property: OccupancyProperty,
  totalRooms: number | null,
): number {
  if (property.rental_mode !== 'by_room') {
    // Whole-home: the letting is the building. With no declared room count
    // there is one thing to let, and it is let.
    return totalRooms && totalRooms > 0 ? totalRooms : 1
  }
  if (lease.unit_number && lease.unit_number.trim()) return 1
  return Math.max(1, lease.tenantCount)
}

/**
 * The occupancy of one property.
 *
 * `leases` may be the property's whole history; ended and demo leases are
 * dropped here so no caller has to remember to.
 */
export function occupancyOf(
  property: OccupancyProperty,
  leases: OccupancyLease[],
  today: string = billingToday(),
): PropertyOccupancy {
  const declared = property.total_rooms ?? 0
  const totalRooms = declared > 0 ? declared : null

  const live = leases.filter(l => housesSomeone(l, today))
  const current = live.filter(l => leasePhase(l, today) === 'current')
  const future = live.filter(l => leasePhase(l, today) === 'upcoming')

  const rawOccupied = current.reduce((n, l) => n + roomsHeld(l, property, totalRooms), 0)
  const rawUpcoming = future.reduce((n, l) => n + roomsHeld(l, property, totalRooms), 0)

  if (totalRooms === null) {
    // No declared room count. The honest answer to "how full" is "no idea", but
    // "is anyone living here" is still answerable, so say that much.
    return {
      totalRooms: null,
      known: false,
      occupied: rawOccupied,
      upcoming: rawUpcoming,
      committed: rawOccupied + rawUpcoming,
      vacant: 0,
      open: 0,
      pct: null,
      full: rawOccupied > 0,
      activeLeases: current.length,
    }
  }

  // Capped, never negative. More rooms let than the listing declares is a data
  // quirk — a changeover counted twice, a room let to a couple, a stale room
  // count — and it must read as "full", never as 120% or as negative vacancy.
  const occupied = Math.min(totalRooms, rawOccupied)
  const committed = Math.min(totalRooms, occupied + rawUpcoming)

  return {
    totalRooms,
    known: true,
    occupied,
    upcoming: committed - occupied,
    committed,
    vacant: totalRooms - occupied,
    open: totalRooms - committed,
    pct: Math.round((occupied / totalRooms) * 100),
    full: occupied >= totalRooms,
    activeLeases: current.length,
  }
}

// ─── THE PORTFOLIO ───────────────────────────────────────────────────────────

export type PortfolioOccupancy = {
  /** Summed over properties that declare a room count. */
  totalRooms: number
  occupied: number
  upcoming: number
  committed: number
  vacant: number
  open: number
  /** Null until at least one property declares a room count. */
  pct: number | null
  /** Properties with no declared room count, left out of the ratio above. */
  unknown: number
}

/**
 * Roll per-property occupancy into one figure.
 *
 * Properties with no declared room count are *excluded* rather than treated as
 * empty. Counting them as zero-occupied would drag the portfolio figure towards
 * nothing because of a blank field on a listing editor, and a landlord cannot
 * tell that apart from a real vacancy.
 */
export function portfolioOccupancy(rows: PropertyOccupancy[]): PortfolioOccupancy {
  const known = rows.filter(r => r.known)
  const sum = (pick: (r: PropertyOccupancy) => number) =>
    known.reduce((n, r) => n + pick(r), 0)

  const totalRooms = sum(r => r.totalRooms ?? 0)
  const occupied = sum(r => r.occupied)

  return {
    totalRooms,
    occupied,
    upcoming: sum(r => r.upcoming),
    committed: sum(r => r.committed),
    vacant: sum(r => r.vacant),
    open: sum(r => r.open),
    pct: totalRooms > 0 ? Math.round((occupied / totalRooms) * 100) : null,
    unknown: rows.length - known.length,
  }
}

// ─── ADAPTERS ────────────────────────────────────────────────────────────────

/**
 * How many people are on a tenancy, from whichever record carries them.
 *
 * `lease_tenants` is the lease's own roster and is written when the lease is
 * created. The payment plan's tenants are written later, when the landlord
 * builds the rent schedule. Taking the larger of the two means a lease counts
 * from the moment it is signed and still counts correctly once a tenant is
 * added to the plan but not the roster.
 */
export const tenantCountOf = (
  leaseTenants?: { length: number } | null,
  planTenants?: { length: number } | null,
) => Math.max(leaseTenants?.length ?? 0, planTenants?.length ?? 0)

/** One sentence naming what the occupancy figure was derived from. */
export function occupancyBasis(o: PropertyOccupancy): string {
  if (!o.known) {
    return o.activeLeases > 0
      ? `${o.activeLeases} live lease${o.activeLeases !== 1 ? 's' : ''}. This listing does not say how many rooms it has, so it cannot be scored out of a total.`
      : 'This listing does not say how many rooms it has, so occupancy cannot be worked out.'
  }
  const base = `${o.occupied} of ${o.totalRooms} room${o.totalRooms !== 1 ? 's' : ''} let, from ${o.activeLeases} live lease${o.activeLeases !== 1 ? 's' : ''}.`
  return o.upcoming > 0
    ? `${base} ${o.upcoming} more ${o.upcoming === 1 ? 'is' : 'are'} signed for a later start.`
    : base
}
