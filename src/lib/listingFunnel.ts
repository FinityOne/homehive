// The whole funnel, and which step of it is losing the lease.
//
// `listingPulse.ts` answers "how many people opened the listing page". That is
// one stage of six, and on its own it cannot tell a landlord which of these
// four very different problems they have:
//
//   1. nobody is searching for a home like this        → nothing to fix yet
//   2. they see the card and don't click it            → cover photo, price
//   3. they click and leave immediately                → the page's first screen
//   4. they read everything and don't write in         → price, or the ask
//
// Every one of those presents to the landlord as "no leads", and the fix for
// each is different enough that guessing is expensive. Impressions and the
// on-page events (`listing_events`) are what separate them.
//
// This file is pure: counted rows in, a diagnosis out. The route counts, the
// UI draws, `npm run verify:funnel` keeps all three honest.
//
// The hardest discipline here is refusing to speak. A funnel drawn over nine
// impressions is a shape, not a finding, and a landlord who re-shoots their
// photos because of it has been actively harmed. Every rate in this file is
// null until its denominator can carry it.

import { personKey } from './listingPulse'
import type { ListingEventKind } from './listingEvents'

// ── Inputs ───────────────────────────────────────────────────────────────────

export type FunnelEventRow = {
  id: string
  property_slug: string | null
  event_type: ListingEventKind
  anonymous_id: string | null
  session_id: string | null
  created_at: string
  surface: string | null
  position: number | null
}

/** A page view, reduced to what the funnel needs. */
export type FunnelViewRow = {
  id: string
  property_slug: string | null
  anonymous_id: string | null
  session_id: string | null
  created_at: string
}

// ── Floors ───────────────────────────────────────────────────────────────────

/**
 * Below this many impressions, click-through is not reported.
 *
 * 100 rather than the 25 that governs the view→inquiry rate, because
 * click-through is a ratio of two small numbers at the top of a funnel: at 20
 * impressions, one extra click moves the rate by five points, and a landlord
 * would re-shoot a cover photo over noise.
 */
export const MIN_IMPRESSIONS_TO_JUDGE = 100

/** Below this many people at a step, that step's rate is not reported. */
export const MIN_STEP_PEOPLE = 20

/** A step has to be this much worse than peers before it is called the bottleneck. */
export const BOTTLENECK_SHORTFALL = 0.6

// ── Stages ───────────────────────────────────────────────────────────────────

export type FunnelStageKey = 'impressions' | 'clicks' | 'views' | 'engaged' | 'inquiries' | 'tours'

export type FunnelStage = {
  key: FunnelStageKey
  label: string
  /** Distinct people who reached this stage. The honest number. */
  people: number
  /** Raw events, which can exceed `people` — four gallery opens is one person looking hard. */
  count: number
  /** Share of the PREVIOUS stage that reached this one, 0–100. Null below the floor. */
  stepPct: number | null
  /** What this stage means, in the landlord's words. */
  note: string
}

const STAGE_LABEL: Record<FunnelStageKey, string> = {
  impressions: 'Seen in search',
  clicks:      'Clicked the card',
  views:       'Opened the listing',
  engaged:     'Looked around',
  inquiries:   'Wrote to you',
  tours:       'Booked a tour',
}

const STAGE_NOTE: Record<FunnelStageKey, string> = {
  impressions: 'Your card scrolled onto a student’s screen in search results.',
  clicks:      'They chose your card over everything else on the page.',
  views:       'The listing page opened.',
  engaged:     'They opened photos, read the FAQ, saved it or started the form.',
  inquiries:   'They sent you a message.',
  tours:       'They booked a time to see it.',
}

/** Which events count as "looked around" — intent short of writing in. */
const ENGAGEMENT_EVENTS: ListingEventKind[] = [
  'gallery_open', 'faq_open', 'save', 'form_start', 'tour_click', 'share',
]

export type Engagement = {
  galleryOpens: number
  faqOpens: number
  saves: number
  tourClicks: number
  shares: number
  formStarts: number
  formAbandons: number
  /** Abandoned ÷ started, 0–100. Null below the floor. */
  abandonPct: number | null
  /** Distinct people who did any engagement event. */
  engagedPeople: number
}

export type FunnelBottleneck = {
  key: FunnelStageKey
  label: string
  /** The step's own rate, 0–100. */
  stepPct: number
  /** The peer median for the same step, when one exists. */
  peerPct: number | null
  title: string
  why: string
  fix: string
  href: string
}

export type Funnel = {
  stages: FunnelStage[]
  /** Clicks ÷ impressions, 0–100. Null until MIN_IMPRESSIONS_TO_JUDGE. */
  ctrPct: number | null
  /** Views → any engagement, 0–100. */
  engagedPct: number | null
  /** Engaged → inquiry, 0–100. */
  inquiryPct: number | null
  engagement: Engagement
  bottleneck: FunnelBottleneck | null
  /** False until impressions exist — the funnel then starts at "opened the listing". */
  hasSearchData: boolean
  /** The median rank this listing holds in search results, when it has impressions. */
  medianPosition: number | null
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rate(top: number, bottom: number, floor: number): number | null {
  if (bottom < floor || bottom <= 0) return null
  return Math.round((top / bottom) * 1000) / 10
}

export function median(ns: number[]): number | null {
  if (!ns.length) return null
  const s = [...ns].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// ── Build ────────────────────────────────────────────────────────────────────

export type FunnelInput = {
  events: FunnelEventRow[]
  views: FunnelViewRow[]
  /** Inquiries in the same window, already scoped to these listings. */
  inquiries: number
  inquiryPeople?: number
  tours: number
  /** Peer step rates, when the pool is big enough to have them. */
  peers?: { ctrPct: number | null; engagedPct: number | null; inquiryPct: number | null }
}

export function buildFunnel(input: FunnelInput): Funnel {
  const { events, views, inquiries, tours, peers } = input

  const peopleBy = new Map<FunnelStageKey, Set<string>>()
  const countBy = new Map<FunnelStageKey, number>()
  const add = (key: FunnelStageKey, person: string | null, n = 1) => {
    countBy.set(key, (countBy.get(key) ?? 0) + n)
    if (person) {
      if (!peopleBy.has(key)) peopleBy.set(key, new Set())
      peopleBy.get(key)!.add(person)
    }
  }

  const eventCounts: Record<string, number> = {}
  const engagedPeople = new Set<string>()
  const positions: number[] = []

  for (const e of events) {
    if (!e.property_slug) continue
    const person = personKey(e)
    eventCounts[e.event_type] = (eventCounts[e.event_type] ?? 0) + 1

    if (e.event_type === 'impression') {
      add('impressions', person)
      if (e.position != null) positions.push(e.position)
      continue
    }
    if (e.event_type === 'card_click') { add('clicks', person); continue }
    if (ENGAGEMENT_EVENTS.includes(e.event_type)) {
      engagedPeople.add(person)
      add('engaged', person)
    }
  }

  for (const v of views) {
    if (!v.property_slug) continue
    add('views', personKey(v))
  }

  countBy.set('inquiries', inquiries)
  countBy.set('tours', tours)

  const peopleAt = (k: FunnelStageKey): number => {
    if (k === 'inquiries') return input.inquiryPeople ?? inquiries
    if (k === 'tours') return tours
    return peopleBy.get(k)?.size ?? 0
  }

  const impressions = peopleAt('impressions')
  const clicks = peopleAt('clicks')
  const viewers = peopleAt('views')
  const engaged = peopleAt('engaged')
  const hasSearchData = (countBy.get('impressions') ?? 0) > 0

  // The stage list starts at the first stage we can actually measure. A funnel
  // that opens on "0 seen in search" for a listing whose impressions simply
  // predate this tracking reads as a catastrophe rather than a blank.
  const order: FunnelStageKey[] = hasSearchData
    ? ['impressions', 'clicks', 'views', 'engaged', 'inquiries', 'tours']
    : ['views', 'engaged', 'inquiries', 'tours']

  const stages: FunnelStage[] = order.map((key, i) => {
    const people = peopleAt(key)
    const prev = i === 0 ? null : peopleAt(order[i - 1])
    const floor = key === 'clicks' ? MIN_IMPRESSIONS_TO_JUDGE : MIN_STEP_PEOPLE
    return {
      key,
      label: STAGE_LABEL[key],
      people,
      count: countBy.get(key) ?? 0,
      stepPct: prev == null ? null : rate(people, prev, floor),
      note: STAGE_NOTE[key],
    }
  })

  const formStarts = eventCounts.form_start ?? 0
  const formAbandons = eventCounts.form_abandon ?? 0

  const engagement: Engagement = {
    galleryOpens: eventCounts.gallery_open ?? 0,
    faqOpens: eventCounts.faq_open ?? 0,
    saves: eventCounts.save ?? 0,
    tourClicks: eventCounts.tour_click ?? 0,
    shares: eventCounts.share ?? 0,
    formStarts,
    formAbandons,
    abandonPct: rate(formAbandons, formStarts, 5),
    engagedPeople: engagedPeople.size,
  }

  const ctrPct = rate(clicks, impressions, MIN_IMPRESSIONS_TO_JUDGE)
  const engagedPct = rate(engaged, viewers, MIN_STEP_PEOPLE)
  const inquiryPct = rate(input.inquiryPeople ?? inquiries, engaged, MIN_STEP_PEOPLE)

  return {
    stages,
    ctrPct,
    engagedPct,
    inquiryPct,
    engagement,
    hasSearchData,
    medianPosition: positions.length >= 10 ? Math.round(median(positions)!) : null,
    bottleneck: findBottleneck({ ctrPct, engagedPct, inquiryPct, engagement, peers }),
  }
}

/**
 * The one step to fix, or nothing.
 *
 * Ordered by where in the funnel the loss happens, not by how bad it looks: a
 * click-through problem makes every stage below it smaller, so fixing the
 * conversion of a listing nobody clicks is rearranging the furniture. The
 * first step that is materially worse than its peers wins.
 *
 * With no peer data, only an absolute collapse is called out — the thresholds
 * are deliberately low enough that normal listings are left alone.
 */
function findBottleneck(args: {
  ctrPct: number | null
  engagedPct: number | null
  inquiryPct: number | null
  engagement: Engagement
  peers?: { ctrPct: number | null; engagedPct: number | null; inquiryPct: number | null }
}): FunnelBottleneck | null {
  const { ctrPct, engagedPct, inquiryPct, engagement, peers } = args

  const behind = (mine: number | null, peer: number | null, absoluteFloor: number) => {
    if (mine == null) return false
    if (peer != null && peer > 0) return mine < peer * BOTTLENECK_SHORTFALL
    return mine < absoluteFloor
  }

  if (behind(ctrPct, peers?.ctrPct ?? null, 3)) {
    return {
      key: 'clicks',
      label: STAGE_LABEL.clicks,
      stepPct: ctrPct!,
      peerPct: peers?.ctrPct ?? null,
      title: 'Students are scrolling past your card',
      why: `Only ${ctrPct}% of the people who saw your listing in search clicked it${peers?.ctrPct ? `, against ${peers.ctrPct}% for comparable homes` : ''}. Everything below this stage is smaller than it should be purely because of it.`,
      fix: 'A card is three things: the cover photo, the price and the headline. The cover photo decides most of it — a bright, wide shot of the actual living space beats a bedroom corner or a floor plan.',
      href: '/landlord/listings',
    }
  }

  if (behind(engagedPct, peers?.engagedPct ?? null, 25)) {
    return {
      key: 'engaged',
      label: STAGE_LABEL.engaged,
      stepPct: engagedPct!,
      peerPct: peers?.engagedPct ?? null,
      title: 'They open the page and leave it',
      why: `${engagedPct}% of visitors did anything at all after the page loaded${peers?.engagedPct ? ` — comparable homes get ${peers.engagedPct}%` : ''}. That is a first-screen problem: the price, the photos and the opening line are all a student reads before deciding.`,
      fix: 'Lead with what is unusual about the home in the first sentence, and make sure the first three photos are the ones you would show a friend.',
      href: '/landlord/performance',
    }
  }

  // Form abandonment is reported wherever it is bad, because it is the single
  // most recoverable loss here: these people had already decided to write.
  if (engagement.abandonPct != null && engagement.abandonPct >= 60 && engagement.formStarts >= 5) {
    return {
      key: 'inquiries',
      label: STAGE_LABEL.inquiries,
      stepPct: 100 - engagement.abandonPct,
      peerPct: null,
      title: `${engagement.formAbandons} people started writing to you and stopped`,
      why: `${engagement.abandonPct}% of started inquiry forms were never sent. These are not browsers — they had decided to contact you and something in the form itself lost them.`,
      fix: 'Usually the move-in date or the phone field. Check the listing is accepting inquiries and that your available-from date is not in the past, which makes the date picker look broken.',
      href: '/landlord/listings',
    }
  }

  if (behind(inquiryPct, peers?.inquiryPct ?? null, 8)) {
    return {
      key: 'inquiries',
      label: STAGE_LABEL.inquiries,
      stepPct: inquiryPct!,
      peerPct: peers?.inquiryPct ?? null,
      title: 'Interested students are not writing in',
      why: `They open photos and read the FAQ, then leave: only ${inquiryPct}% of engaged visitors sent a message${peers?.inquiryPct ? ` versus ${peers.inquiryPct}% elsewhere` : ''}. At this point in the funnel the listing has done its job and the price or the terms are the open question.`,
      fix: 'Compare your per-bedroom rent against the comp set, and answer the three questions students ask most in the FAQ — utilities, parking and the lease length.',
      href: '/landlord/performance',
    }
  }

  return null
}

// ── Peer benchmarks ──────────────────────────────────────────────────────────

/**
 * How this landlord compares to everyone else on the platform right now.
 *
 * Comparisons are against *live listings owned by other people* over the same
 * window, because a number without a comparison is unreadable: "12 views this
 * week" is either good or a disaster, and a landlord cannot tell which. The
 * comparison also moves with the season, which a fixed benchmark never would —
 * every listing is quiet in November and busy in March.
 */
export type Benchmark = {
  key: string
  label: string
  you: number | null
  peer: number | null
  /** How many other listings the peer figure was drawn from. */
  sample: number
  unit: '%' | 'count'
  verdict: 'ahead' | 'behind' | 'typical' | 'unknown'
  /** Plain reading of the comparison. */
  note: string
}

/** Below this many peer listings, no comparison is offered. */
export const MIN_PEER_LISTINGS = 5

/** Inside this band of the peer median, you are simply typical. */
const TYPICAL_BAND = 0.15

export function benchmark(
  key: string, label: string, you: number | null, peerValues: number[], unit: '%' | 'count'
): Benchmark {
  const sample = peerValues.length
  const peer = sample >= MIN_PEER_LISTINGS ? median(peerValues) : null
  const peerRounded = peer == null ? null : Math.round(peer * 10) / 10

  if (you == null || peerRounded == null) {
    return {
      key, label, you, peer: peerRounded, sample, unit, verdict: 'unknown',
      note: you == null
        ? 'Not enough of your own traffic yet to compare.'
        : `Only ${sample} comparable listing${sample === 1 ? '' : 's'} live right now — too few to compare against.`,
    }
  }

  const ratio = peerRounded > 0 ? you / peerRounded : 1
  const verdict: Benchmark['verdict'] =
    Math.abs(ratio - 1) <= TYPICAL_BAND ? 'typical' : ratio > 1 ? 'ahead' : 'behind'

  const fmt = (n: number) => (unit === '%' ? `${n}%` : `${n}`)
  const note =
    verdict === 'typical' ? `About the same as the ${sample} comparable listings live now (${fmt(peerRounded)}).`
    : verdict === 'ahead'  ? `${Math.round((ratio - 1) * 100)}% ahead of comparable listings (${fmt(peerRounded)}).`
    :                        `${Math.round((1 - ratio) * 100)}% behind comparable listings (${fmt(peerRounded)}).`

  return { key, label, you, peer: peerRounded, sample, unit, verdict, note }
}

// ── When students are actually looking ───────────────────────────────────────

export type HeatCell = { dow: number; hour: number; views: number }

export type BrowseClock = {
  /** One cell per day-of-week × 3-hour block that had traffic. */
  cells: HeatCell[]
  /** The busiest block, named. */
  peakLabel: string | null
  peakViews: number
  /** Share of views between 6pm and midnight, Phoenix time. */
  eveningPct: number
  /** Share of views on Saturday or Sunday. */
  weekendPct: number
  total: number
  /** True when there is enough traffic for the shape to mean anything. */
  readable: boolean
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Below this, the clock is a scatter of ones and is not shown. */
export const MIN_VIEWS_FOR_CLOCK = 40

/** Phoenix day-of-week (0=Sun) and hour for an instant. UTC−7 all year, no DST. */
export function phoenixParts(iso: string): { dow: number; hour: number } {
  const d = new Date(iso)
  const shifted = new Date(d.getTime() - 7 * 3_600_000)
  return { dow: shifted.getUTCDay(), hour: shifted.getUTCHours() }
}

const BLOCK_LABEL = ['midnight–3am', '3–6am', '6–9am', '9am–noon', 'noon–3pm', '3–6pm', '6–9pm', '9pm–midnight']

export function buildBrowseClock(views: Array<{ created_at: string }>): BrowseClock {
  const cells = new Map<string, HeatCell>()
  let evening = 0
  let weekend = 0

  for (const v of views) {
    const { dow, hour } = phoenixParts(v.created_at)
    const block = Math.floor(hour / 3)
    const k = `${dow}:${block}`
    const cell = cells.get(k) ?? { dow, hour: block * 3, views: 0 }
    cell.views++
    cells.set(k, cell)
    if (hour >= 18) evening++
    if (dow === 0 || dow === 6) weekend++
  }

  const list = [...cells.values()].sort((a, b) => b.views - a.views)
  const total = views.length
  const peak = list[0] ?? null

  return {
    cells: list,
    peakLabel: peak ? `${DOW[peak.dow]} ${BLOCK_LABEL[Math.floor(peak.hour / 3)]}` : null,
    peakViews: peak?.views ?? 0,
    eveningPct: total ? Math.round((evening / total) * 100) : 0,
    weekendPct: total ? Math.round((weekend / total) * 100) : 0,
    total,
    readable: total >= MIN_VIEWS_FOR_CLOCK,
  }
}
