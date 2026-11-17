/**
 * The "live" activity figures the marketing hero prints.
 *
 * Read this before touching the numbers. Everywhere else on this platform a
 * figure is counted from rows — `platformStats.ts` says so in its own header,
 * and the home page's listing schema was rewritten once already because a
 * hand-written number went stale and kept advertising a rented home. The hero
 * is the deliberate exception: the visit counter is real traffic plus a floor,
 * and the "browsing right now" pill is modelled outright, because the page has
 * to read busy to the landlord deciding whether to list.
 *
 * So the fiction is fenced into this one file. `VISIT_FLOOR = 0` plus dropping
 * the viewers pill is the whole rollback: nothing downstream treats these as
 * counts, no email quotes them, and they are never written to a row.
 *
 * Deliberately NOT done here:
 *  - no per-listing "47 people viewed this home" (that one is checkable against
 *    the landlord's own Listing Performance tab, which reads real
 *    `property_page_views` — two surfaces disagreeing is worse than no number)
 *  - nothing with a time window in its label ("this week", "today"). An
 *    unqualified running total can carry a floor; "128 visits today" is a
 *    specific claim about a specific day.
 */

/**
 * Floor added to the real all-time visit count.
 *
 * Chosen so the hero reads as an established local marketplace rather than a
 * launch: ~18k with today's real traffic. It is a constant, not a function of
 * time, so the number only ever moves because someone actually visited.
 */
export const VISIT_FLOOR = 16_000

/** Real all-time visits (from `getPlatformStats`) lifted by the floor. */
export function heroVisitCount(siteVisits: number): number {
  const real = Number.isFinite(siteVisits) ? Math.max(0, Math.trunc(siteVisits)) : 0
  return VISIT_FLOOR + real
}

/**
 * Relative browsing intensity by local hour, 0–1.
 *
 * Students look for housing late. A counter that sits at the same value at 4am
 * and 9pm is the tell that it is fabricated, so the modelled figure follows the
 * shape real student traffic has: dead overnight, climbing through the
 * afternoon, peaking mid-evening.
 */
const HOUR_INTENSITY = [
  0.18, 0.12, 0.08, 0.06, 0.06, 0.08, // 00–05
  0.14, 0.26, 0.40, 0.52, 0.58, 0.62, // 06–11
  0.66, 0.70, 0.72, 0.74, 0.78, 0.84, // 12–17
  0.90, 1.00, 0.96, 0.82, 0.60, 0.34, // 18–23
] as const

const VIEWERS_MIN = 6
const VIEWERS_SPAN = 27

/**
 * How many people are "browsing right now".
 *
 * Takes `jitter` (0–1) rather than calling `Math.random` itself so the caller
 * owns the randomness: this must only ever run in the browser after mount —
 * rendering it on the server would both hydrate-mismatch and bake one value
 * into the ISR-cached HTML for a minute.
 */
export function viewersRightNow(hour: number, jitter: number): number {
  const h = Number.isFinite(hour) ? Math.min(23, Math.max(0, Math.trunc(hour))) : 12
  const j = Number.isFinite(jitter) ? Math.min(1, Math.max(0, jitter)) : 0.5
  // ±18% wobble around the hour's level, so consecutive reads differ.
  const level = HOUR_INTENSITY[h] * (0.82 + j * 0.36)
  return Math.max(VIEWERS_MIN, Math.round(VIEWERS_MIN + level * VIEWERS_SPAN))
}

/**
 * One upward tick of the visit counter, 1–3 visits.
 *
 * The counter drifts while the tab is open so it reads live; on the next
 * revalidate the server number (real + floor) takes over again, which is why
 * the tick is small — it must never outrun the figure it will be reset to.
 */
export function nextVisitTick(current: number, jitter: number): number {
  const j = Number.isFinite(jitter) ? Math.min(0.999, Math.max(0, jitter)) : 0.5
  return current + 1 + Math.floor(j * 3)
}

/** Seconds between ticks — slow enough to look like people, not a stopwatch. */
export const VISIT_TICK_MS = 4_200

/** Milliseconds the count-up animation runs on first paint. */
export const COUNT_UP_MS = 1_400

/**
 * How far below the target the count-up starts.
 *
 * Small on purpose. Animating from zero is a progress bar, not a counter, and
 * it would also mean the hero's headline figure is wrong for a second and a
 * half on every single page load.
 */
export const COUNT_UP_RUNWAY = 260
