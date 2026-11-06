// The landlord overview's traffic pulse: who is looking, and what that means.
//
// The overview tab used to answer one question — "did anyone contact me?" —
// and a landlord whose answer was "no" learned nothing at all from it. "No
// leads" has two opposite causes:
//
//   • nobody is seeing the listing  → the fix is reach: publish it, share it,
//     widen it. Touching the rent here is throwing money at a listing no one
//     has read.
//   • everybody is seeing it and leaving → the fix is the listing itself:
//     price, photos, the first line of the description.
//
// Separating those two takes exactly one number the landlord never had: how
// many people opened the listing page. `property_page_views` has been
// recording it since May 2026 and nothing landlord-facing ever read it.
//
// This file is pure. It takes counted rows and returns the model the overview
// renders — day series, window totals with a previous-window comparison, a
// per-listing table, traffic sources and a ranked set of insights. It never
// touches the database, so the route, the UI and `npm run verify:pulse` all
// reason about one set of rules.
//
// Two numbers here are deliberately conservative:
//
//   • No verdict is offered below `MIN_VIEWS_TO_JUDGE` views (shared with the
//     performance page, so the two screens never disagree). A conversion rate
//     over nine views is noise wearing a percentage sign.
//   • A "unique visitor" is a person, counted distinctly over the *whole*
//     window — never the sum of the daily uniques, which counts the same
//     student once per day they came back. The gap between views and visitors
//     is itself the interesting number: it is repeat interest.

import { MIN_VIEWS_TO_JUDGE } from './listingPerformance'

export { MIN_VIEWS_TO_JUDGE }

// ── Windows ──────────────────────────────────────────────────────────────────

/**
 * The windows the overview offers.
 *
 * 7 days is the default: it is the horizon a decision actually lives on ("is
 * my listing working *this week*"), and it is short enough that yesterday
 * still shows up in it. 30 days sits beside it because a seven-day count in a
 * quiet week reads as a dead listing when it is just a Tuesday in October —
 * the performance page judges on 30 for exactly that reason, and the toggle
 * lets the landlord check one against the other.
 */
export const PULSE_WINDOWS = [7, 30] as const
export type PulseWindow = (typeof PULSE_WINDOWS)[number]
export const DEFAULT_PULSE_WINDOW: PulseWindow = 7

/**
 * Platform-wide view→inquiry rate, as a fraction.
 *
 * Roughly one in twenty views leaves a message. It is here so a landlord's own
 * rate can be read as "ahead of" or "behind" something rather than as a bare
 * percentage, which is unreadable alone — 4% sounds like failure and is in
 * fact normal.
 */
export const MARKET_INQUIRY_RATE = 0.05

/** A change this size is direction of travel; anything smaller is weather. */
export const MATERIAL_DELTA = 0.25

// ── Inputs ───────────────────────────────────────────────────────────────────

export type PulseViewRow = {
  id: string
  property_slug: string | null
  /** 1-year cookie id — the stable person. Null on rows written before it existed. */
  anonymous_id: string | null
  /** Per-tab id. The fallback identity, and all the old rows have. */
  session_id: string | null
  created_at: string
  utm_source: string | null
  referrer: string | null
  device_type: string | null
}

export type PulseLeadRow = {
  property: string | null
  created_at: string
  status: string | null
}

export type PulseTourRow = {
  property_slug: string | null
  created_at: string
}

/** The listing fields the pulse needs — enough to say whether silence is expected. */
export type PulseListing = {
  slug: string
  name: string
  /** Out there working: approved, switched on, and on a paid plan. */
  isLive: boolean
  /** Finished but invisible — a plan would publish it. */
  isUnpublished: boolean
}

// ── Output ───────────────────────────────────────────────────────────────────

export type PulseDay = {
  /** `YYYY-MM-DD` in America/Phoenix. */
  date: string
  /** "Mon 3" — short enough for a 7-point axis. */
  label: string
  /** "Monday, Nov 3" — the tooltip. */
  full: string
  views: number
  visitors: number
  inquiries: number
}

export type PulseMetric = {
  value: number
  prev: number
  /** Fractional change vs the previous equal window; null when prev was zero. */
  deltaPct: number | null
}

export type PulseListingRow = {
  slug: string
  name: string
  views: number
  visitors: number
  inquiries: number
  tours: number
  /** Inquiries ÷ visitors, as a percentage. Null below the judging floor. */
  conversionPct: number | null
  lastViewAt: string | null
  isLive: boolean
  isUnpublished: boolean
  /** Share of the window's total views, 0–100 — the bar in the leaderboard. */
  sharePct: number
}

export type PulseSource = { source: string; views: number; visitors: number; pct: number }
export type PulseDevice = { device: string; views: number; pct: number }

export type PulseTone = 'good' | 'warn' | 'bad' | 'info'

export type PulseInsight = {
  key: string
  tone: PulseTone
  title: string
  detail: string
  href?: string
  cta?: string
}

export type Pulse = {
  windowDays: PulseWindow
  days: PulseDay[]
  views: PulseMetric
  visitors: PulseMetric
  inquiries: PulseMetric
  tours: PulseMetric
  /** Inquiries ÷ visitors over the window, as a percentage. Null below the floor. */
  conversionPct: number | null
  /** The same rate over the previous window, for the same floor. */
  prevConversionPct: number | null
  /** Visitors who came back — opened the page more than once in the window. */
  returningVisitors: number
  /** Views ÷ visitors, 1 decimal. How hard the average person is looking. */
  viewsPerVisitor: number | null
  busiestDay: PulseDay | null
  listings: PulseListingRow[]
  /** Live listings that nobody opened in the window. */
  silentListings: PulseListingRow[]
  sources: PulseSource[]
  devices: PulseDevice[]
  /** Leads still sitting at `new`, and how old the oldest one is, in hours. */
  unanswered: number
  oldestUnansweredHours: number | null
  /** Ranked; the first is the headline. */
  insights: PulseInsight[]
  /** True when there is not enough traffic for any rate to mean anything. */
  tooQuietToJudge: boolean
}

// ── Day keys ─────────────────────────────────────────────────────────────────

/**
 * `YYYY-MM-DD` in America/Phoenix — the same day boundary rent and late fees
 * use. Bucketing by UTC would file a 6pm Phoenix view under tomorrow, which on
 * a 7-day chart moves a fifth of the evening traffic into the wrong column.
 */
export function phoenixDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

const DAY_MS = 86_400_000

/** The window's day keys, oldest first, ending on `now`'s Phoenix day. */
export function windowDayKeys(now: Date, days: number, offset = 0): string[] {
  return Array.from({ length: days }, (_, i) =>
    phoenixDay(new Date(now.getTime() - (days - 1 - i + offset) * DAY_MS))
  )
}

function dayLabels(key: string): { label: string; full: string } {
  // Noon UTC with a UTC format: the date cannot shift under whatever timezone
  // the landlord's browser is in.
  const d = new Date(`${key}T12:00:00Z`)
  // Composed rather than asked for as one pattern: `weekday + day` alone comes
  // back from Intl as "26 Mon", which reads as a date nobody writes.
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  const day = d.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'UTC' })
  return {
    label: `${weekday} ${day}`,
    full: d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }),
  }
}

// ── Identity ─────────────────────────────────────────────────────────────────

/**
 * The key that makes two view rows "the same person".
 *
 * `anonymous_id` first: it is the 1-year cookie, so it survives closing the
 * tab and is the only one of the three that means a person. `session_id` is
 * the fallback for rows written before that column existed — it resets per
 * tab, so historic uniques are over-counted and converge on the truth as the
 * window rolls past the migration. Over-counting is the safe direction: it can
 * make a busy listing look busier, never make a busy one look dead.
 *
 * A row with neither id counts as its own person, which is the honest reading
 * of "we have no idea who this was".
 */
export function personKey(row: { id: string; anonymous_id: string | null; session_id: string | null }): string {
  if (row.anonymous_id) return `a:${row.anonymous_id}`
  if (row.session_id) return `s:${row.session_id}`
  return `r:${row.id}`
}

/**
 * The same rule for a page view. Kept as its own name because the funnel in
 * `listingFunnel.ts` applies `personKey` to event rows, and the two must never
 * drift: a person's impression, click, view and inquiry only stitch into one
 * journey while both sides agree on what "one person" is.
 */
export function visitorKey(row: PulseViewRow): string {
  return personKey(row)
}

/**
 * Where a view came from, in the landlord's terms: the campaign tag if the
 * link carried one, otherwise the referring host with `www.` stripped so
 * Google does not arrive as two separate channels, otherwise "Direct".
 */
export function sourceOf(row: Pick<PulseViewRow, 'utm_source' | 'referrer'>): string {
  if (row.utm_source) return row.utm_source
  if (!row.referrer) return 'Direct'
  try {
    const host = new URL(row.referrer).hostname.replace(/^www\./, '')
    return host || 'Direct'
  } catch {
    return 'Direct'
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function metric(value: number, prev: number): PulseMetric {
  return { value, prev, deltaPct: prev > 0 ? (value - prev) / prev : null }
}

/** A rate only when the denominator can support one. */
function rate(numerator: number, denominator: number, floor: number): number | null {
  if (denominator < floor) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

const DEVICE_LABEL: Record<string, string> = {
  mobile: 'Phone',
  desktop: 'Laptop / desktop',
  tablet: 'Tablet',
}

// ── The build ────────────────────────────────────────────────────────────────

export type PulseInput = {
  windowDays: PulseWindow
  now: Date
  listings: PulseListing[]
  /** Views covering at least twice the window, any order. */
  views: PulseViewRow[]
  leads: PulseLeadRow[]
  tours: PulseTourRow[]
}

export function buildPulse(input: PulseInput): Pulse {
  const { windowDays: span, now, listings, views, leads, tours } = input

  const curKeys = windowDayKeys(now, span)
  const prevKeys = windowDayKeys(now, span, span)
  const cur = new Set(curKeys)
  const prev = new Set(prevKeys)
  const slugs = new Set(listings.map(l => l.slug))

  // ── Per-day and per-listing accumulation, one pass per source ────────────
  const dayViews = new Map<string, number>()
  const dayVisitors = new Map<string, Set<string>>()
  const dayInquiries = new Map<string, number>()

  const curVisitorViews = new Map<string, number>()   // visitor key → views in window
  let curViews = 0
  let prevViews = 0
  const prevVisitors = new Set<string>()

  const sourceViews = new Map<string, number>()
  const sourceVisitors = new Map<string, Set<string>>()
  const deviceViews = new Map<string, number>()

  type Acc = {
    views: number
    visitors: Set<string>
    inquiries: number
    tours: number
    lastViewAt: string | null
  }
  const byListing = new Map<string, Acc>()
  const accFor = (slug: string): Acc => {
    let a = byListing.get(slug)
    if (!a) {
      a = { views: 0, visitors: new Set(), inquiries: 0, tours: 0, lastViewAt: null }
      byListing.set(slug, a)
    }
    return a
  }
  // Every listing gets a row, including the ones with nothing to report — a
  // zero is the finding.
  for (const l of listings) accFor(l.slug)

  for (const v of views) {
    const slug = v.property_slug
    if (!slug || !slugs.has(slug)) continue
    const day = phoenixDay(new Date(v.created_at))
    const key = visitorKey(v)

    if (prev.has(day)) {
      prevViews++
      prevVisitors.add(key)
      continue
    }
    if (!cur.has(day)) continue

    curViews++
    curVisitorViews.set(key, (curVisitorViews.get(key) ?? 0) + 1)
    dayViews.set(day, (dayViews.get(day) ?? 0) + 1)
    if (!dayVisitors.has(day)) dayVisitors.set(day, new Set())
    dayVisitors.get(day)!.add(key)

    const src = sourceOf(v)
    sourceViews.set(src, (sourceViews.get(src) ?? 0) + 1)
    if (!sourceVisitors.has(src)) sourceVisitors.set(src, new Set())
    sourceVisitors.get(src)!.add(key)

    const dev = v.device_type ?? 'unknown'
    deviceViews.set(dev, (deviceViews.get(dev) ?? 0) + 1)

    const acc = accFor(slug)
    acc.views++
    acc.visitors.add(key)
    if (!acc.lastViewAt || v.created_at > acc.lastViewAt) acc.lastViewAt = v.created_at
  }

  let curInquiries = 0
  let prevInquiries = 0
  let unanswered = 0
  let oldestUnansweredAt: string | null = null

  for (const l of leads) {
    const slug = l.property
    if (!slug || !slugs.has(slug)) continue
    const day = phoenixDay(new Date(l.created_at))
    if (prev.has(day)) { prevInquiries++; continue }
    if (!cur.has(day)) continue
    curInquiries++
    dayInquiries.set(day, (dayInquiries.get(day) ?? 0) + 1)
    accFor(slug).inquiries++
    if (l.status === 'new') {
      unanswered++
      if (!oldestUnansweredAt || l.created_at < oldestUnansweredAt) oldestUnansweredAt = l.created_at
    }
  }

  let curTours = 0
  let prevTours = 0
  for (const t of tours) {
    const slug = t.property_slug
    if (!slug || !slugs.has(slug)) continue
    const day = phoenixDay(new Date(t.created_at))
    if (prev.has(day)) { prevTours++; continue }
    if (!cur.has(day)) continue
    curTours++
    accFor(slug).tours++
  }

  // ── Series ───────────────────────────────────────────────────────────────
  const days: PulseDay[] = curKeys.map(key => ({
    date: key,
    ...dayLabels(key),
    views: dayViews.get(key) ?? 0,
    visitors: dayVisitors.get(key)?.size ?? 0,
    inquiries: dayInquiries.get(key) ?? 0,
  }))

  const busiestDay = days.reduce<PulseDay | null>(
    (best, d) => (d.views > 0 && (!best || d.views > best.views) ? d : best), null
  )

  // Distinct over the whole window — never the sum of the daily counts.
  const curVisitors = curVisitorViews.size
  const returningVisitors = [...curVisitorViews.values()].filter(n => n > 1).length

  // ── Listing table ────────────────────────────────────────────────────────
  const meta = new Map(listings.map(l => [l.slug, l]))
  const rows: PulseListingRow[] = [...byListing.entries()]
    .map(([slug, a]) => {
      const m = meta.get(slug)
      return {
        slug,
        name: m?.name ?? slug,
        views: a.views,
        visitors: a.visitors.size,
        inquiries: a.inquiries,
        tours: a.tours,
        conversionPct: rate(a.inquiries, a.visitors.size, MIN_VIEWS_TO_JUDGE),
        lastViewAt: a.lastViewAt,
        isLive: m?.isLive ?? false,
        isUnpublished: m?.isUnpublished ?? false,
        sharePct: pct(a.views, curViews),
      }
    })
    .sort((a, b) =>
      b.views - a.views || b.inquiries - a.inquiries || a.name.localeCompare(b.name)
    )

  const silentListings = rows.filter(r => r.isLive && r.views === 0)

  // ── Channels ─────────────────────────────────────────────────────────────
  const sources: PulseSource[] = [...sourceViews.entries()]
    .map(([source, v]) => ({
      source,
      views: v,
      visitors: sourceVisitors.get(source)?.size ?? 0,
      pct: pct(v, curViews),
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 5)

  const devices: PulseDevice[] = [...deviceViews.entries()]
    .map(([device, v]) => ({
      device: DEVICE_LABEL[device] ?? 'Unknown device',
      views: v,
      pct: pct(v, curViews),
    }))
    .sort((a, b) => b.views - a.views)

  const pulse: Pulse = {
    windowDays: span,
    days,
    views: metric(curViews, prevViews),
    visitors: metric(curVisitors, prevVisitors.size),
    inquiries: metric(curInquiries, prevInquiries),
    tours: metric(curTours, prevTours),
    conversionPct: rate(curInquiries, curVisitors, MIN_VIEWS_TO_JUDGE),
    prevConversionPct: rate(prevInquiries, prevVisitors.size, MIN_VIEWS_TO_JUDGE),
    returningVisitors,
    viewsPerVisitor: curVisitors > 0 ? Math.round((curViews / curVisitors) * 10) / 10 : null,
    busiestDay,
    listings: rows,
    silentListings,
    sources,
    devices,
    unanswered,
    oldestUnansweredHours: oldestUnansweredAt
      ? Math.max(0, Math.round((now.getTime() - new Date(oldestUnansweredAt).getTime()) / 3_600_000))
      : null,
    insights: [],
    tooQuietToJudge: curViews < MIN_VIEWS_TO_JUDGE,
  }

  pulse.insights = buildInsights(pulse, listings)
  return pulse
}

// ── Social proof (the public listing page) ───────────────────────────────────

/**
 * Below this many people, the listing page says nothing about its traffic.
 *
 * "1 person viewed this home this week" is not social proof, it is a warning
 * label — it tells a renter they are the only one interested, which is exactly
 * the opposite of the effect, and it quietly tells them the home has been
 * passed over. Five is the point where the sentence starts reading as "other
 * people are looking at this" instead of "nobody is".
 *
 * The same floor keeps the number honest in the other direction: a brand-new
 * listing shows no claim at all rather than an inflated one.
 */
export const SOCIAL_PROOF_MIN_VIEWERS = 5

/** The trailing window the public page counts over. A week is the horizon a renter is deciding on. */
export const SOCIAL_PROOF_DAYS = 7

export type SocialProof = {
  /** The line itself, already written. */
  text: string
  /** Scarcity to pair it with, or null. Kept separate so the UI can style it. */
  urgency: string | null
  /** True when inquiries are what makes this urgent — competition, not supply. */
  competitive: boolean
}

/**
 * What the listing page tells a renter about everyone else looking at it.
 *
 * Returns null rather than a weak claim. Three rules, in order:
 *
 *   • Under `SOCIAL_PROOF_MIN_VIEWERS` people, say nothing.
 *   • Count *people*, not views. "48 views" is a number a renter can tell is
 *     padded by one person refreshing; "23 people" is a crowd, and it is also
 *     the true statement.
 *   • Inquiries outrank rooms for urgency. "3 have already inquired" is
 *     competition for the same bed and moves a renter to act; "2 rooms left"
 *     is scarcity they have heard on every listing site they have ever used.
 */
export function describeSocialProof(input: {
  viewers: number
  inquiries: number
  availableRooms: number
}): SocialProof | null {
  const { viewers, inquiries, availableRooms } = input
  if (viewers < SOCIAL_PROOF_MIN_VIEWERS) return null

  const text = `${viewers} people viewed this home this week`

  if (inquiries >= 2) {
    return {
      text,
      urgency: `${inquiries} already inquired`,
      competitive: true,
    }
  }
  if (availableRooms === 1) {
    return { text, urgency: 'one room left', competitive: false }
  }
  return { text, urgency: null, competitive: false }
}

// ── Insights ─────────────────────────────────────────────────────────────────

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)

/**
 * What the numbers mean, ranked by what it would cost the landlord to miss it.
 *
 * The order is the whole point. An unanswered inquiry outranks every traffic
 * observation, because a renter who messaged two days ago and heard nothing is
 * a lease already leaving — no amount of reading a chart recovers it. Nothing
 * published outranks traffic advice for the same reason: advice about a
 * listing's conversion is meaningless while the listing is invisible.
 *
 * Every insight either names a number the landlord can check or sends them
 * somewhere they can act. None of them says "engagement is down".
 */
export function buildInsights(p: Pulse, listings: PulseListing[]): PulseInsight[] {
  const out: PulseInsight[] = []
  const w = `${p.windowDays} days`

  // 1 — A person is waiting on a human. Always first.
  if (p.unanswered > 0) {
    const hrs = p.oldestUnansweredHours ?? 0
    const age = hrs >= 48 ? `${Math.floor(hrs / 24)} days` : hrs >= 1 ? `${hrs}h` : 'minutes'
    out.push({
      key: 'unanswered',
      tone: hrs >= 24 ? 'bad' : 'warn',
      title: `${p.unanswered} ${plural(p.unanswered, 'inquiry', 'inquiries')} waiting on you`,
      detail: `The oldest has been sitting ${age}. Students message four or five homes the same evening and sign with whoever answers first — a reply inside the hour is worth more than anything else on this page.`,
      href: '/landlord/leads',
      cta: 'Reply now',
    })
  }

  // 2 — Nothing is published, so no traffic number can be interpreted.
  const unpublished = listings.filter(l => l.isUnpublished)
  const live = listings.filter(l => l.isLive)
  if (!live.length && unpublished.length) {
    out.push({
      key: 'unpublished',
      tone: 'bad',
      title: `${unpublished.length} ${plural(unpublished.length, 'listing')} finished but invisible`,
      detail: `Students only see a listing while your plan is active, so nobody can find ${unpublished.length === 1 ? 'it' : 'them'} yet. There is no review queue — ${unpublished.length === 1 ? 'it goes' : 'they go'} live the moment you subscribe.`,
      href: '/landlord/subscribe',
      cta: 'Publish',
    })
    return out.slice(0, 3)
  }
  if (!live.length) {
    out.push({
      key: 'no-listings',
      tone: 'info',
      title: 'No live listings yet',
      detail: 'Traffic starts the day a listing goes live. Add one and this page fills in by itself.',
      href: '/landlord/listings',
      cta: 'Add a listing',
    })
    return out.slice(0, 3)
  }

  // 3 — The diagnosis the whole section exists for: seen vs not seen.
  if (p.views.value === 0) {
    out.push({
      key: 'no-traffic',
      tone: 'warn',
      title: `Nobody opened your ${plural(live.length, 'listing')} in ${w}`,
      detail: 'This is a reach problem, not a price problem — there is no evidence yet that anything about the listing is wrong. Share the link in ASU housing groups and to your own network; the first visitors almost always come from there.',
      href: '/landlord/listings',
      cta: 'Get the link',
    })
  } else if (p.inquiries.value === 0 && p.views.value >= MIN_VIEWS_TO_JUDGE) {
    out.push({
      key: 'traffic-no-leads',
      tone: 'warn',
      title: `${p.visitors.value} ${plural(p.visitors.value, 'person', 'people')} looked, none asked`,
      detail: `Your listing is being found — ${p.views.value} ${plural(p.views.value, 'view')} in ${w} — and losing people on the page itself. That points at the first three things a renter sees: the price, the cover photo and the opening line.`,
      href: '/landlord/performance',
      cta: 'See what to change',
    })
  } else if (p.inquiries.value === 0 && p.views.value > 0) {
    out.push({
      key: 'early-days',
      tone: 'info',
      title: `${p.views.value} ${plural(p.views.value, 'view')} so far, no inquiries yet`,
      detail: `Around one visitor in twenty writes in, so at this much traffic silence is the expected outcome and tells you nothing yet. Worth re-reading once you pass ${MIN_VIEWS_TO_JUDGE} views.`,
    })
  } else if (p.conversionPct != null) {
    const market = Math.round(MARKET_INQUIRY_RATE * 1000) / 10
    const ahead = p.conversionPct >= market
    out.push({
      key: 'conversion',
      tone: ahead ? 'good' : 'warn',
      title: `${p.conversionPct}% of visitors inquired`,
      detail: ahead
        ? `Ahead of the ${market}% typical on HomeHive — the listing is doing its job, so more leases now come from more traffic rather than more edits.`
        : `Below the ${market}% typical on HomeHive. The traffic is there; the page is where you are losing people.`,
      href: '/landlord/performance',
      cta: 'See why',
    })
  }

  // 4 — Direction of travel, but only when the baseline was real.
  if (p.views.deltaPct != null && p.views.prev >= 10 && Math.abs(p.views.deltaPct) >= MATERIAL_DELTA) {
    const up = p.views.deltaPct > 0
    const mag = Math.abs(Math.round(p.views.deltaPct * 100))
    out.push({
      key: 'trend',
      tone: up ? 'good' : 'warn',
      title: `Traffic ${up ? 'up' : 'down'} ${mag}% on the previous ${w}`,
      detail: up
        ? `${p.views.value} views against ${p.views.prev}. Whatever you changed or posted last week is working — this is the week to answer fast.`
        : `${p.views.value} views against ${p.views.prev}. Student search runs in seasons, so check the 30-day view before you touch anything.`,
    })
  }

  // 5 — Live listings nobody opened: the portfolio's dead weight.
  if (p.silentListings.length && p.views.value > 0) {
    const names = p.silentListings.slice(0, 2).map(l => l.name).join(', ')
    const one = p.silentListings.length === 1
    out.push({
      key: 'silent',
      tone: 'warn',
      title: `${p.silentListings.length} live ${plural(p.silentListings.length, 'listing')} got no views`,
      detail: `${names}${p.silentListings.length > 2 ? ` and ${p.silentListings.length - 2} more` : ''} ${one ? 'is' : 'are'} live but nobody opened ${one ? 'it' : 'them'} while your other homes drew ${p.views.value} views. Usually the photos or the distance-to-campus line.`,
      href: '/landlord/listings',
      cta: 'Review',
    })
  }

  // 6 — Repeat interest: the softest signal and one of the most actionable.
  if (p.returningVisitors >= 3) {
    out.push({
      key: 'returning',
      tone: 'good',
      title: `${p.returningVisitors} people came back for a second look`,
      detail: 'Returning visitors are the closest thing to intent this platform can see — they are comparing you against two or three others. Fresh photos or an answered FAQ lands hardest on exactly these people.',
      href: '/landlord/listings',
      cta: 'Freshen a listing',
    })
  }

  return out.slice(0, 3)
}
