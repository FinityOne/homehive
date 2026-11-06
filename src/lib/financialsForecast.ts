/**
 * When the money will actually arrive.
 *
 * ── Why a schedule is not a forecast ───────────────────────────────────────
 *
 * The schedule says rent is due on the 1st. That is a contract, not a
 * prediction, and a landlord who plans around it is planning around a number
 * their own history says is wrong: on this product a third of settled charges
 * arrive after their due date, and the tenants who do that do it *every month*.
 *
 * So this shifts each unsettled charge by the median lateness of the person who
 * owes it. A tenant who has always paid on the day is forecast on the day; one
 * who is reliably eight days late is forecast eight days late; one with no
 * history at all is forecast on time, because inventing pessimism about a new
 * tenant is as wrong as inventing optimism.
 *
 * ── What it refuses to do ──────────────────────────────────────────────────
 *
 *   • **It never forecasts the recovery of existing arrears.** Money already
 *     overdue has no arrival date — the whole reason it is a problem is that
 *     nobody knows when or whether it is coming. It is reported alongside as a
 *     separate, un-forecast figure. A projection that quietly assumes last
 *     month's debt lands next week is the single most dangerous number a
 *     product like this could print.
 *   • **It never claims confidence it does not have.** Each week is split into
 *     what is contractually due, what history says will slip, and what is owed
 *     by someone who is already behind — which is at risk, not expected.
 *   • **It is labelled a projection everywhere it is shown**, and the basis is
 *     stated: your own tenants' settled history, nothing else.
 *
 * Pure: charges in, weeks out.
 */

import { billingToday } from '@/lib/financialsRollup'
import type { Charge } from '@/lib/financialsMonth'

const round2 = (n: number) => Math.round(n * 100) / 100
const DAY = 86_400_000

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const s = xs.slice().sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

/** How far ahead to project. A quarter is as far as a payment history can
 *  honestly support, and as far as a landlord plans cash. */
export const FORECAST_WEEKS = 13

/** One week of projected cash. */
export type ForecastWeek = {
  /** Monday-agnostic: the first day of the week-long bucket. */
  start: string
  end: string
  /** 'Nov 9' — the axis label. */
  label: string
  /** 'Nov 9 – Nov 15' — what a tooltip says. */
  longLabel: string
  /** Money the tenant has already sent, clearing through the bank. Certain. */
  clearing: number
  /** Due in this week, from payers whose history says they pay on time. */
  onTime: number
  /** Due earlier, but projected to land in this week because the payer is
   *  reliably late. The slip, made visible. */
  slipping: number
  /** Owed by someone who is already in arrears. Not expected — at risk. */
  atRisk: number
  /** clearing + onTime + slipping. What to plan around. */
  expected: number
  /** Every charge touching the week, for a tooltip's count. */
  count: number
}

export type Forecast = {
  weeks: ForecastWeek[]
  /** Total expected over the window. */
  expected: number
  /** What the contract says would arrive if everyone paid on the day. */
  contracted: number
  /** contracted − expected: the gap history says to plan for. Never negative. */
  slippage: number
  /** Already overdue, deliberately not projected into any week. */
  overdueUnscheduled: number
  /** At-risk money inside the window, from payers already behind. */
  atRisk: number
  /** How many payers had enough history to shift. For the caveat line. */
  modelledPayers: number
  /** How many had none and were taken at their contracted date. */
  assumedOnTime: number
  empty: boolean
}

export const EMPTY_FORECAST: Forecast = {
  weeks: [], expected: 0, contracted: 0, slippage: 0,
  overdueUnscheduled: 0, atRisk: 0, modelledPayers: 0, assumedOnTime: 0, empty: true,
}

/** Settled history is only predictive once there is some. */
const MIN_HISTORY = 2

/**
 * Projected arrivals, week by week.
 *
 * `charges` must be every charge on the leases in view — the same flattened
 * list every other money surface reads — so the forecast and the schedule
 * cannot disagree about what is due.
 */
export function forecast(charges: Charge[], weeks = FORECAST_WEEKS, now = new Date()): Forecast {
  if (charges.length === 0) return EMPTY_FORECAST

  const todayStr = billingToday(now)
  const today = new Date(todayStr + 'T00:00:00')

  // ── Each payer's own lateness, from what has actually settled ──
  const settledBy = new Map<string, number[]>()
  const behind = new Set<string>()
  for (const c of charges) {
    const k = `${c.planId}:${c.payerId ?? 'lease'}`
    if (c.settlement !== null && c.settlement.daysLate !== null) {
      const arr = settledBy.get(k)
      if (arr) arr.push(Math.max(0, c.settlement.daysLate))
      else settledBy.set(k, [Math.max(0, c.settlement.daysLate)])
    }
    if (c.state === 'overdue') behind.add(k)
  }

  let modelledPayers = 0
  let assumedOnTime = 0
  const slipOf = new Map<string, number>()
  const payerKeys = new Set(charges.map(c => `${c.planId}:${c.payerId ?? 'lease'}`))
  for (const k of payerKeys) {
    const hist = settledBy.get(k) ?? []
    if (hist.length >= MIN_HISTORY) {
      // The median of *all* settled charges, not only the late ones: a tenant
      // who is late one month in six has a median of zero, which is the right
      // forecast for them.
      const m = median(hist)
      slipOf.set(k, m)
      if (m > 0) modelledPayers += 1
      else assumedOnTime += 1
    } else {
      slipOf.set(k, 0)
      assumedOnTime += 1
    }
  }

  // ── Buckets ──
  const buckets: ForecastWeek[] = Array.from({ length: weeks }, (_, i) => {
    const start = new Date(today.getTime() + i * 7 * DAY)
    const end = new Date(start.getTime() + 6 * DAY)
    return {
      start: iso(start),
      end: iso(end),
      label: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      longLabel: `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${
        end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      clearing: 0, onTime: 0, slipping: 0, atRisk: 0, expected: 0, count: 0,
    }
  })
  const lastDay = buckets[buckets.length - 1].end

  const indexOf = (date: string): number => {
    const d = new Date(date + 'T00:00:00').getTime()
    const i = Math.floor((d - today.getTime()) / (7 * DAY))
    return i >= 0 && i < buckets.length ? i : -1
  }

  let contracted = 0
  let overdueUnscheduled = 0
  let atRisk = 0

  for (const c of charges) {
    const k = `${c.planId}:${c.payerId ?? 'lease'}`

    // Already overdue: no arrival date exists, so it is never placed in a week.
    if (c.state === 'overdue') {
      overdueUnscheduled = round2(overdueUnscheduled + c.totalDue)
      continue
    }
    if (c.totalDue <= 0) continue

    // Money in flight is the one certainty here — the tenant has sent it.
    if (c.state === 'clearing') {
      // ACH on this platform settles within a few business days; the first
      // bucket is the honest place for it.
      const i = 0
      buckets[i].clearing = round2(buckets[i].clearing + c.outstanding)
      buckets[i].count += 1
      continue
    }

    if (c.dueDate > lastDay) continue
    contracted = round2(contracted + c.totalDue)

    const slip = slipOf.get(k) ?? 0
    const due = new Date(c.dueDate + 'T00:00:00')
    // Nothing is ever projected into the past: a charge due last week from a
    // payer who is not yet late lands as soon as this week, not retroactively.
    const projected = new Date(Math.max(today.getTime(), due.getTime() + slip * DAY))
    const i = indexOf(iso(projected))
    if (i < 0) continue

    buckets[i].count += 1
    if (behind.has(k)) {
      buckets[i].atRisk = round2(buckets[i].atRisk + c.totalDue)
      atRisk = round2(atRisk + c.totalDue)
    } else if (slip > 0) {
      buckets[i].slipping = round2(buckets[i].slipping + c.totalDue)
    } else {
      buckets[i].onTime = round2(buckets[i].onTime + c.totalDue)
    }
  }

  for (const b of buckets) {
    b.expected = round2(b.clearing + b.onTime + b.slipping)
  }

  const expected = round2(buckets.reduce((n, b) => n + b.expected, 0))
  // What actually got placed in a week, out of the contracted total. Clearing
  // money is excluded from `contracted` (it was never due in this window), so
  // the two sides compare like with like.
  const placed = round2(buckets.reduce((n, b) => n + b.onTime + b.slipping + b.atRisk, 0))

  return {
    weeks: buckets,
    expected,
    contracted,
    // Contracted money this window will not see: charges whose projected
    // arrival slipped past the last bucket. Never negative — a portfolio that
    // pays early does not have negative slippage, it has none.
    slippage: Math.max(0, round2(contracted - placed)),
    overdueUnscheduled,
    atRisk,
    modelledPayers,
    assumedOnTime,
    empty: expected === 0 && overdueUnscheduled === 0,
  }
}
