// Why a listing is or isn't leasing, and whether its rent is the reason.
//
// Every number a landlord needs to answer that already existed in this
// database and none of it was ever shown to them: `property_page_views` has
// recorded a row per listing page view since the tracking work, but the table
// is service-role only and the only screen that reads anything like it is
// /admin/visitors. So a landlord could watch a listing sit for six weeks with
// no way to tell the difference between "nobody is looking" and "everybody is
// looking and leaving" — two problems with opposite fixes. Dropping the rent on
// a listing nobody has seen is the single most expensive mistake available
// here, and it is the one a landlord with no data makes first.
//
// This file is pure. It takes counted facts and returns a diagnosis, a comp
// set and a price range; it never reads the database, so the route, the UI and
// `npm run verify:listing-perf` all reason about the same rules. The route's
// job is only to count honestly and to scope those counts to the caller's own
// properties.
//
// Two judgements are deliberately conservative:
//
//   • It refuses to diagnose a listing with too little traffic to diagnose
//     (`MIN_VIEWS_TO_JUDGE`). A verdict drawn from nine views is noise wearing
//     a confident sentence, and acting on it costs real rent.
//   • The comp set says how it was built. A median over four homes within a
//     mile is worth something; the same number over every listing in the city
//     is worth much less, and a landlord deciding on a $75 increase deserves
//     to know which one they are looking at.

import { isMarketable, isPublicStatus, hasActivePlan } from './listingStatus'
import type { ListingStatus } from './listingStatus'

// ── The window ───────────────────────────────────────────────────────────────

/**
 * The reporting window, in days.
 *
 * 30 days rather than 7: student housing moves in a seasonal rhythm, and a
 * seven-day count during a quiet week reads as a dead listing when it is just
 * a Tuesday in October. 30 days is also what makes the previous-window
 * comparison meaningful without reaching back past the last price change.
 */
export const WINDOW_DAYS = 30

/**
 * Below this many views in the window, no verdict is offered.
 *
 * Picked from what the funnel actually does: the platform-wide view→inquiry
 * rate runs around one in twenty, so at fifteen views "no inquiries yet" is
 * the *expected* outcome and means nothing at all. Judging it anyway would
 * send a landlord to cut a rent that was never the problem.
 */
export const MIN_VIEWS_TO_JUDGE = 25

/** A listing younger than this is still finding its audience. */
export const GRACE_DAYS = 7

/**
 * Per-bedroom prices outside this band are not comps, they are bad rows:
 * a $0 placeholder, a weekly rate typed as a monthly one, a deposit in the
 * rent field. Including them drags a median far enough to change advice.
 */
const SANE_PER_BED = { min: 200, max: 4000 }

// ── Inputs ───────────────────────────────────────────────────────────────────

/** The listing fields this engine reasons about. */
export type ListingFacts = {
  slug: string
  name: string
  /** When the listing row was created — the start of "days listed". */
  created_at: string
  /** Last status change, if any: a relist restarts the clock. */
  status_changed_at: string | null
  listing_status: ListingStatus
  marketing_enabled: boolean
  accepting_inquiries: boolean
  show_when_rented: boolean
  admin_status?: string
  archived_at?: string | null
  owner_plan_active?: boolean
  /** Advertised price: the whole-home rent, or the cheapest room when by_room. */
  price: number
  beds: number
  rental_mode: 'by_room' | 'whole_home' | null
  /** Distance to ASU in miles — the single strongest comp axis in this market. */
  asu_distance: number | null
  total_rooms: number
  available: number
  photoCount: number
  hasDescription: boolean
}

/** Counted activity for one listing over the window. */
export type ListingActivity = {
  viewsTotal: number
  views: number
  /** Distinct sessions in the window — the honest "how many people" number. */
  viewers: number
  /** The equal-length window before this one, for direction of travel. */
  viewsPrev: number
  inquiries: number
  inquiriesTotal: number
  tours: number
  questions: number
  /** One entry per day of the window, oldest first. Zero-filled by the route. */
  daily: Array<{ date: string; views: number }>
  sources: Array<{ source: string; views: number }>
  devices: Array<{ device: string; views: number }>
  lastViewAt: string | null
  lastInquiryAt: string | null
}

/** A candidate comp: any public listing, including the landlord's own. */
export type CompCandidate = {
  slug: string
  name: string
  price: number
  beds: number
  rental_mode: 'by_room' | 'whole_home' | null
  asu_distance: number | null
  /** Own listings are kept in the pool for display but never priced against. */
  isOwn: boolean
}

// ── Price normalisation ──────────────────────────────────────────────────────

/**
 * One comparable number across both rental modes: dollars per bedroom.
 *
 * A six-bedroom house at $3,600 and a room at $600 are the same price, and a
 * landlord comparing the headline figures would conclude the opposite. By-room
 * listings already advertise a per-room figure, so `price` passes through;
 * whole-home listings divide by bedrooms.
 *
 * Returns null rather than a guess when the listing has no price or no bed
 * count — an unpriced listing is a comp of nothing.
 */
export function perBedPrice(
  p: Pick<ListingFacts, 'price' | 'beds' | 'rental_mode'>
): number | null {
  if (!p.price || p.price <= 0) return null
  if (p.rental_mode === 'by_room') return Math.round(p.price)
  const beds = p.beds > 0 ? p.beds : 0
  if (!beds) return null
  return Math.round(p.price / beds)
}

function sanePerBed(n: number | null): boolean {
  return n != null && n >= SANE_PER_BED.min && n <= SANE_PER_BED.max
}

export function median(ns: number[]): number | null {
  if (!ns.length) return null
  const s = [...ns].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

function quantile(ns: number[], q: number): number | null {
  if (!ns.length) return null
  const s = [...ns].sort((a, b) => a - b)
  const i = (s.length - 1) * q
  const lo = Math.floor(i), hi = Math.ceil(i)
  return Math.round(lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo))
}

// ── Comps ────────────────────────────────────────────────────────────────────

/**
 * How the comp set was assembled. Shown to the landlord verbatim, because the
 * weight they should give the median depends entirely on this.
 */
export type CompBand = 'tight' | 'wide' | 'market'

export const COMP_BAND_LABEL: Record<CompBand, string> = {
  tight:  'Within 1 mile and ±1 bedroom',
  wide:   'Within 2.5 miles and ±2 bedrooms',
  market: 'All live listings near ASU',
}

const BANDS: Array<{ band: CompBand; miles: number; beds: number }> = [
  { band: 'tight',  miles: 1,    beds: 1 },
  { band: 'wide',   miles: 2.5,  beds: 2 },
  { band: 'market', miles: Infinity, beds: Infinity },
]

/** Fewer than this and a median is one opinion, so the band widens. */
const MIN_COMPS = 4

export type Comp = {
  slug: string
  name: string
  perBed: number
  beds: number
  distance: number | null
  isOwn: boolean
}

export type CompSet = {
  band: CompBand
  /** True when even the widest band could not find enough listings. */
  thin: boolean
  count: number
  yourPerBed: number | null
  median: number | null
  p25: number | null
  p75: number | null
  /** Where your price sits in the comp set, 0 = cheapest, 100 = dearest. */
  percentile: number | null
  /** Your price against the median, in percent. Positive = you are dearer. */
  deltaPct: number | null
  /** Nearest comps first, for the table. */
  comps: Comp[]
}

/**
 * Build the comp set for one listing.
 *
 * Widens the band until it has `MIN_COMPS`, and reports the band it stopped
 * at. Own listings are excluded from the maths — pricing a room against your
 * own other room is a mirror, not a market — but a landlord with several homes
 * in one area still sees them in the table for context.
 */
export function buildCompSet(listing: ListingFacts, candidates: CompCandidate[]): CompSet {
  const yourPerBed = perBedPrice(listing)
  const dist = listing.asu_distance

  const priced = candidates
    .map(c => ({ c, perBed: perBedPrice(c) }))
    .filter((x): x is { c: CompCandidate; perBed: number } => sanePerBed(x.perBed))
    .filter(x => x.c.slug !== listing.slug)

  let chosen: Array<{ c: CompCandidate; perBed: number }> = []
  let band: CompBand = 'market'

  for (const b of BANDS) {
    band = b.band
    chosen = priced.filter(({ c }) => {
      const bedsOk = b.beds === Infinity || Math.abs((c.beds || 0) - (listing.beds || 0)) <= b.beds
      if (!bedsOk) return false
      if (b.miles === Infinity) return true
      // A listing with no distance on file can't be placed in a radius. It
      // still counts in the market-wide band, where radius isn't claimed.
      if (dist == null || c.asu_distance == null) return false
      return Math.abs(c.asu_distance - dist) <= b.miles
    })
    if (chosen.filter(x => !x.c.isOwn).length >= MIN_COMPS) break
  }

  const forMaths = chosen.filter(x => !x.c.isOwn).map(x => x.perBed)
  const med = median(forMaths)

  const percentile = yourPerBed != null && forMaths.length
    ? Math.round((forMaths.filter(p => p < yourPerBed).length / forMaths.length) * 100)
    : null

  const comps: Comp[] = chosen
    .map(({ c, perBed }) => ({
      slug: c.slug, name: c.name, perBed, beds: c.beds,
      distance: c.asu_distance, isOwn: c.isOwn,
    }))
    .sort((a, b) => {
      if (dist == null) return a.perBed - b.perBed
      const da = a.distance == null ? Infinity : Math.abs(a.distance - dist)
      const db = b.distance == null ? Infinity : Math.abs(b.distance - dist)
      return da - db || a.perBed - b.perBed
    })

  return {
    band,
    thin: forMaths.length < MIN_COMPS,
    count: forMaths.length,
    yourPerBed,
    median: med,
    p25: quantile(forMaths, 0.25),
    p75: quantile(forMaths, 0.75),
    percentile,
    deltaPct: yourPerBed != null && med ? Math.round(((yourPerBed - med) / med) * 100) : null,
    comps,
  }
}

// ── Derived facts ────────────────────────────────────────────────────────────

/** Whole days between two instants, floored at 0. */
function daysBetween(fromISO: string, now: Date): number {
  const ms = now.getTime() - new Date(fromISO).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

/**
 * How long this listing has been on the market.
 *
 * Measured from the last status change when there is one, so a listing taken
 * off-market and relisted in August is not reported as 400 days stale — the
 * audience that passed on it in January is gone, and so is the relevance of
 * that number.
 */
export function daysListed(l: ListingFacts, now = new Date()): number {
  return daysBetween(l.status_changed_at || l.created_at, now)
}

export type Funnel = {
  views: number
  viewers: number
  inquiries: number
  tours: number
  /** Inquiries per 100 viewers. Null when there is not enough traffic to divide. */
  inquiryRate: number | null
  /** Tours per 100 inquiries. */
  tourRate: number | null
  /** Views per day over the window. */
  viewsPerDay: number
  /** Change in views against the previous window, in percent. */
  trendPct: number | null
}

export function buildFunnel(a: ListingActivity): Funnel {
  const base = a.viewers || a.views
  return {
    views: a.views,
    viewers: a.viewers,
    inquiries: a.inquiries,
    tours: a.tours,
    inquiryRate: base >= MIN_VIEWS_TO_JUDGE ? Math.round((a.inquiries / base) * 1000) / 10 : null,
    tourRate: a.inquiries > 0 ? Math.round((a.tours / a.inquiries) * 1000) / 10 : null,
    viewsPerDay: Math.round((a.views / WINDOW_DAYS) * 10) / 10,
    trendPct: a.viewsPrev > 0
      ? Math.round(((a.views - a.viewsPrev) / a.viewsPrev) * 100)
      : a.views > 0 ? null : 0,
  }
}

// ── The diagnosis ────────────────────────────────────────────────────────────

export type DiagnosisCode =
  | 'not_public'
  | 'not_promoted'
  | 'inquiries_closed'
  | 'too_new'
  | 'too_quiet'
  | 'no_views'
  | 'views_no_inquiries_price'
  | 'views_no_inquiries_listing'
  | 'inquiries_no_tours'
  | 'tours_no_lease'
  | 'healthy'
  | 'full'

export type Severity = 'critical' | 'warn' | 'ok' | 'info'

export type Action = { label: string; href?: string }

export type Diagnosis = {
  code: DiagnosisCode
  severity: Severity
  /** The finding, in one sentence a landlord would say out loud. */
  headline: string
  /** Why we think so, naming the numbers it rests on. */
  detail: string
  actions: Action[]
}

/**
 * What is wrong with this listing, in priority order.
 *
 * The order is the whole point. A listing that nobody can see has exactly one
 * problem, and telling its owner about their view→inquiry rate first would
 * bury it. So the checks run outside-in: can it be seen, is it being pushed,
 * is it taking inquiries, has it had time, has it had traffic — and only then
 * do the funnel and the price get an opinion.
 */
export function diagnose(
  l: ListingFacts,
  a: ListingActivity,
  comps: CompSet,
  opts: { marketInquiryRate?: number | null; now?: Date } = {}
): Diagnosis {
  const now = opts.now ?? new Date()
  const edit = `/landlord/listings/${l.slug}`
  const days = daysListed(l, now)
  const funnel = buildFunnel(a)
  const base = a.viewers || a.views

  // 1. Invisible. Nothing else matters until this is fixed.
  if (!hasActivePlan(l)) {
    return {
      code: 'not_public', severity: 'critical',
      headline: 'Students cannot see this listing — your plan is not active',
      detail: 'The listing is built and ready. It publishes the moment a plan is active; until then it is hidden from the homepage, from search and from its own link.',
      actions: [{ label: 'Start a plan', href: '/landlord/subscribe' }],
    }
  }
  if (l.archived_at) {
    return {
      code: 'not_public', severity: 'critical',
      headline: 'This listing was archived for inactivity',
      detail: `Archived listings are hidden from students. Nothing was deleted — re-activating restores it with its ${a.viewsTotal.toLocaleString()} views and ${a.inquiriesTotal} inquiries intact.`,
      actions: [{ label: 'Re-activate the listing', href: edit }],
    }
  }
  if (l.admin_status && l.admin_status !== 'active') {
    return {
      code: 'not_public', severity: 'warn',
      headline: 'This listing is not approved yet',
      detail: 'HomeHive reviews new listings before they go out to students. It will not collect views until that clears.',
      actions: [{ label: 'Review the listing', href: edit }],
    }
  }
  if (!isPublicStatus(l)) {
    return {
      code: 'not_public', severity: 'critical',
      headline: l.listing_status === 'rented'
        ? 'Marked Rented and pulled from search'
        : 'This listing is off-market',
      detail: l.listing_status === 'rented'
        ? 'Rented listings stop collecting inquiries. Turn on the waitlist to keep the page live and gather interest for your next opening — students who ask early are the cheapest leads you will ever get.'
        : 'Inactive listings are hidden from the homepage, from search and from their direct link, so they generate nothing.',
      actions: [{ label: 'Change the status', href: edit }],
    }
  }

  // 2. Visible, but not pushed.
  if (!isMarketable(l)) {
    return {
      code: 'not_promoted', severity: 'warn',
      headline: 'Promotion is off — students have to find this one on their own',
      detail: 'The listing is reachable but kept out of the homepage feed and featured slots, which is where most first views come from.',
      actions: [{ label: 'Turn promotion on', href: edit }],
    }
  }
  if (!l.accepting_inquiries) {
    return {
      code: 'inquiries_closed', severity: 'warn',
      headline: 'The inquiry form is turned off',
      detail: `Students can read the page — ${a.views} views in the last ${WINDOW_DAYS} days — but they have no way to contact you from it.`,
      actions: [{ label: 'Accept inquiries again', href: edit }],
    }
  }

  // 3. Nothing left to sell.
  if (l.total_rooms > 0 && l.available === 0) {
    return {
      code: 'full', severity: 'info',
      headline: 'Every room is filled',
      detail: `Still drawing ${a.views} views a month. Worth keeping live as a waitlist for your next opening rather than hiding it.`,
      actions: [{ label: 'Set up next year’s availability', href: edit }],
    }
  }

  // 4. Too early to say anything useful.
  if (days < GRACE_DAYS) {
    return {
      code: 'too_new', severity: 'info',
      headline: `Live for ${days === 0 ? 'less than a day' : `${days} day${days === 1 ? '' : 's'}`} — still finding its audience`,
      detail: `${a.views} views so far. Give it a week before reading anything into the numbers; ${WINDOW_DAYS}-day rates on a new listing mostly measure luck.`,
      actions: [],
    }
  }

  // 5. Visible and old enough, but no traffic. The fix is reach, not price —
  //    and this is exactly the case where a landlord cuts the rent for nothing.
  if (a.views === 0) {
    return {
      code: 'no_views', severity: 'critical',
      headline: `No views in ${WINDOW_DAYS} days`,
      detail: 'Live, promoted and seen by nobody. That is a reach problem, not a price problem — cutting the rent on a listing nobody has opened buys you nothing.',
      actions: [
        ...(l.photoCount < 6 ? [{ label: `Add photos (${l.photoCount} now)`, href: `${edit}/edit/media` }] : []),
        { label: 'Check the location and distance', href: `${edit}/edit/location` },
      ],
    }
  }
  if (base < MIN_VIEWS_TO_JUDGE) {
    return {
      code: 'too_quiet', severity: 'info',
      headline: `Only ${base} viewer${base === 1 ? '' : 's'} in ${WINDOW_DAYS} days — too few to judge`,
      detail: `No inquiries from ${base} viewers is the expected outcome, not a signal. The thing to work on is traffic: more photos, promotion on, and a price in the band students filter by.`,
      actions: [
        ...(l.photoCount < 6 ? [{ label: `Add photos (${l.photoCount} now)`, href: `${edit}/edit/media` }] : []),
        ...(!l.hasDescription ? [{ label: 'Write a description', href: `${edit}/edit/basics` }] : []),
      ],
    }
  }

  // 6. Real traffic, no inquiries. Price or presentation — tell them which.
  if (a.inquiries === 0) {
    const dear = comps.percentile != null && comps.percentile >= 65 && !comps.thin
    if (dear) {
      const target = comps.median
      return {
        code: 'views_no_inquiries_price', severity: 'critical',
        headline: `${base} people looked, none inquired — and you are priced above the comps`,
        detail: `At $${comps.yourPerBed?.toLocaleString()} per bedroom you sit ${comps.deltaPct}% above the $${target?.toLocaleString()} median of ${comps.count} comparable listings (${COMP_BAND_LABEL[comps.band].toLowerCase()}). Interest without inquiries is what being priced out of a shortlist looks like.`,
        actions: [
          { label: 'Review the price', href: `${edit}/edit/basics` },
          { label: 'Add an incentive instead of a cut', href: edit },
        ],
      }
    }
    return {
      code: 'views_no_inquiries_listing', severity: 'warn',
      headline: `${base} people looked, none inquired`,
      detail: comps.thin
        ? 'Your price is in line with what little we can compare it to, so the page itself is the next place to look: photos first, then the description, then what the listing does not answer.'
        : `Your price is fair — ${comps.percentile}th percentile of ${comps.count} comps — so the page is the problem, not the rent. Photos first, then the description, then anything the listing leaves unanswered.`,
      actions: [
        ...(l.photoCount < 8 ? [{ label: `Add photos (${l.photoCount} now)`, href: `${edit}/edit/media` }] : []),
        ...(!l.hasDescription ? [{ label: 'Write a description', href: `${edit}/edit/basics` }] : []),
        { label: 'Answer the common questions', href: edit },
      ],
    }
  }

  // 7. Inquiries arriving and dying. This one is on the landlord, not the ad.
  if (a.tours === 0 && a.inquiries > 0) {
    return {
      code: 'inquiries_no_tours', severity: 'warn',
      headline: `${a.inquiries} inquir${a.inquiries === 1 ? 'y' : 'ies'}, no tours booked`,
      detail: 'The listing is doing its job and the hand-off is losing them. Students shortlist four or five places in an evening and sign with whoever answers first; a free slot on your calendar closes that gap without you writing a word.',
      actions: [
        { label: 'Open the leads', href: '/landlord/leads' },
        { label: 'Publish tour slots', href: `/landlord/listings/${l.slug}/calendar` },
      ],
    }
  }

  // 8. Tours happening, nothing signed.
  if (a.tours > 0 && l.available > 0) {
    return {
      code: 'tours_no_lease', severity: 'warn',
      headline: `${a.tours} tour${a.tours === 1 ? '' : 's'} and still ${l.available} room${l.available === 1 ? '' : 's'} open`,
      detail: 'People are coming to see it, so the listing and the price are both working. What is left is the close: screening turned around quickly, and an offer that does not wait on email.',
      actions: [
        { label: 'See who toured', href: '/landlord/leads/pipeline' },
        { label: 'Start screening', href: '/landlord/background-checks' },
      ],
    }
  }

  // 9. Working.
  const vsMarket = opts.marketInquiryRate != null && funnel.inquiryRate != null
    ? funnel.inquiryRate - opts.marketInquiryRate
    : null
  return {
    code: 'healthy', severity: 'ok',
    headline: 'This listing is converting',
    detail: `${base} viewers, ${a.inquiries} inquir${a.inquiries === 1 ? 'y' : 'ies'} and ${a.tours} tour${a.tours === 1 ? '' : 's'} in ${WINDOW_DAYS} days` +
      (vsMarket != null
        ? ` — a ${funnel.inquiryRate}% inquiry rate, ${vsMarket >= 0 ? 'ahead of' : 'behind'} the ${opts.marketInquiryRate}% platform average.`
        : `, a ${funnel.inquiryRate}% inquiry rate.`),
    actions: [{ label: 'Keep the pipeline moving', href: '/landlord/leads' }],
  }
}

// ── Price advice ─────────────────────────────────────────────────────────────

export type PriceAdvice = {
  direction: 'lower' | 'hold' | 'raise'
  /** Suggested per-bedroom range. Same units as `CompSet.yourPerBed`. */
  lowPerBed: number
  highPerBed: number
  /** The same range as an advertised price, in the listing's own mode. */
  lowAsked: number
  highAsked: number
  /** Monthly difference at the midpoint, across every open room. Signed. */
  monthlyDelta: number
  headline: string
  reasoning: string
}

/** Turn a per-bedroom figure back into the number the listing advertises. */
export function askedFromPerBed(l: Pick<ListingFacts, 'rental_mode' | 'beds'>, perBed: number): number {
  if (l.rental_mode === 'by_room') return Math.round(perBed)
  return Math.round(perBed * Math.max(1, l.beds || 1))
}

/**
 * A price range, or null when we have no business suggesting one.
 *
 * Null is the common case and that is correct: with a thin comp set, no
 * traffic, or a listing that is already leasing, a suggested number would be
 * invented. The only two situations that earn advice are a listing that is
 * demonstrably being passed over while priced high, and one that is being
 * devoured while priced low.
 */
export function priceAdvice(
  l: ListingFacts,
  a: ListingActivity,
  comps: CompSet,
  d: Diagnosis
): PriceAdvice | null {
  if (comps.thin || comps.median == null || comps.yourPerBed == null) return null
  const openRooms = Math.max(1, l.rental_mode === 'by_room' ? l.available || 1 : 1)
  const mid = (lo: number, hi: number) => Math.round((lo + hi) / 2)

  // Priced high and visibly being skipped: come back to the middle of the band.
  if (d.code === 'views_no_inquiries_price') {
    const lowPerBed = comps.median
    const highPerBed = Math.max(comps.median, comps.p75 ?? comps.median)
    const delta = (mid(lowPerBed, highPerBed) - comps.yourPerBed) * openRooms
    return {
      direction: 'lower',
      lowPerBed, highPerBed,
      lowAsked: askedFromPerBed(l, lowPerBed),
      highAsked: askedFromPerBed(l, highPerBed),
      monthlyDelta: delta,
      headline: `Try $${askedFromPerBed(l, highPerBed).toLocaleString()}–$${askedFromPerBed(l, lowPerBed).toLocaleString()}`,
      reasoning: `Giving up $${Math.abs(delta).toLocaleString()} a month gets you into the band ${comps.count} comparable listings sit in. One month empty costs $${(askedFromPerBed(l, comps.yourPerBed) * openRooms).toLocaleString()}, so holding out for the higher rent pays only if it costs you less than ${Math.max(1, Math.round(Math.abs((askedFromPerBed(l, comps.yourPerBed) * openRooms) / Math.max(1, Math.abs(delta)))))} month${Math.round(Math.abs((askedFromPerBed(l, comps.yourPerBed) * openRooms) / Math.max(1, Math.abs(delta)))) === 1 ? '' : 's'} of vacancy.`,
    }
  }

  // Cheap and in demand: the market is telling you there is room.
  const cheap = comps.percentile != null && comps.percentile <= 25
  const hot = a.inquiries >= 3 && (a.viewers || a.views) >= MIN_VIEWS_TO_JUDGE
  if (cheap && hot && l.available > 0) {
    const lowPerBed = Math.round((comps.yourPerBed + (comps.median ?? comps.yourPerBed)) / 2)
    const highPerBed = comps.median
    const delta = (mid(lowPerBed, highPerBed) - comps.yourPerBed) * openRooms
    return {
      direction: 'raise',
      lowPerBed, highPerBed,
      lowAsked: askedFromPerBed(l, lowPerBed),
      highAsked: askedFromPerBed(l, highPerBed),
      monthlyDelta: delta,
      headline: `You have room: $${askedFromPerBed(l, lowPerBed).toLocaleString()}–$${askedFromPerBed(l, highPerBed).toLocaleString()}`,
      reasoning: `${a.inquiries} inquiries in ${WINDOW_DAYS} days at the ${comps.percentile}th percentile of ${comps.count} comps. Demand at this price is strong enough to test $${Math.abs(delta).toLocaleString()} a month more — worth $${(Math.abs(delta) * 12).toLocaleString()} over a year's lease.`,
    }
  }

  return {
    direction: 'hold',
    lowPerBed: comps.p25 ?? comps.median,
    highPerBed: comps.p75 ?? comps.median,
    lowAsked: askedFromPerBed(l, comps.p25 ?? comps.median),
    highAsked: askedFromPerBed(l, comps.p75 ?? comps.median),
    monthlyDelta: 0,
    headline: 'Hold the price',
    reasoning: comps.percentile != null
      ? `At the ${comps.percentile}th percentile of ${comps.count} comps, the rent is not what is holding this listing back.`
      : `In line with ${comps.count} comparable listings.`,
  }
}

// ── The row the UI renders ───────────────────────────────────────────────────

export type ListingReport = {
  listing: ListingFacts
  activity: ListingActivity
  funnel: Funnel
  comps: CompSet
  diagnosis: Diagnosis
  advice: PriceAdvice | null
  daysListed: number
}

export function buildReport(
  listing: ListingFacts,
  activity: ListingActivity,
  candidates: CompCandidate[],
  opts: { marketInquiryRate?: number | null; now?: Date } = {}
): ListingReport {
  const comps = buildCompSet(listing, candidates)
  const diagnosis = diagnose(listing, activity, comps, opts)
  return {
    listing,
    activity,
    funnel: buildFunnel(activity),
    comps,
    diagnosis,
    advice: priceAdvice(listing, activity, comps, diagnosis),
    daysListed: daysListed(listing, opts.now ?? new Date()),
  }
}

/**
 * Worst first.
 *
 * A portfolio screen is only useful if the listing costing the landlord money
 * is at the top, so severity leads, and within a severity the one with the
 * most wasted attention — views that went nowhere — comes first.
 */
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2, ok: 3 }

export function sortReports(rs: ListingReport[]): ListingReport[] {
  return [...rs].sort((a, b) =>
    SEVERITY_RANK[a.diagnosis.severity] - SEVERITY_RANK[b.diagnosis.severity] ||
    b.activity.views - a.activity.views ||
    a.listing.name.localeCompare(b.listing.name)
  )
}

/** Portfolio totals for the header strip. */
export type PortfolioSummary = {
  listings: number
  views: number
  viewers: number
  inquiries: number
  tours: number
  inquiryRate: number | null
  needsAttention: number
  openRooms: number
  /** Monthly rent sitting in unfilled rooms, at the asking price. */
  vacantRent: number
}

export function summarise(rs: ListingReport[]): PortfolioSummary {
  const views = rs.reduce((s, r) => s + r.activity.views, 0)
  const viewers = rs.reduce((s, r) => s + r.activity.viewers, 0)
  const inquiries = rs.reduce((s, r) => s + r.activity.inquiries, 0)
  const base = viewers || views
  return {
    listings: rs.length,
    views, viewers, inquiries,
    tours: rs.reduce((s, r) => s + r.activity.tours, 0),
    inquiryRate: base >= MIN_VIEWS_TO_JUDGE ? Math.round((inquiries / base) * 1000) / 10 : null,
    needsAttention: rs.filter(r => r.diagnosis.severity === 'critical' || r.diagnosis.severity === 'warn').length,
    openRooms: rs.reduce((s, r) => s + Math.max(0, r.listing.available || 0), 0),
    vacantRent: rs.reduce((s, r) => {
      const perBed = perBedPrice(r.listing)
      if (!perBed) return s
      return s + perBed * Math.max(0, r.listing.available || 0)
    }, 0),
  }
}
