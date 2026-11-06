/**
 * Financial health over time — the backward-looking half of the money area.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Every time-series figure in this product was locked to twelve months and
 * answered one question: how much was billed and how much came in. That is a
 * *throughput* chart. It is not a health chart, and the difference matters —
 * a portfolio can bill and collect roughly the same amount every month for a
 * year while quietly accumulating four months of unrecovered arrears, and
 * nothing anywhere would have shown it.
 *
 * So this module derives the three things that actually describe health over a
 * span of time:
 *
 *   1. **Where the money went inside each month.** Of what was billed, how
 *      much arrived on time, how much arrived late, and how much never
 *      arrived. Those three partition the month exactly, which is what makes a
 *      stacked bar honest rather than decorative.
 *   2. **Arrears at the end of every month**, reconstructed. The single most
 *      useful line in the product and the one that was missing.
 *   3. **The cumulative gap.** Billed-to-date against collected-to-date. If
 *      the two lines diverge, the portfolio is losing ground no matter how
 *      good any individual month looked.
 *
 * ── Reconstructing arrears, and why that is legitimate ────────────────────
 *
 * Nothing in this product snapshots a balance, and the rest of the money area
 * is careful never to pretend otherwise — there is deliberately no "arrears up
 * 8% this week" anywhere, because no such history is stored.
 *
 * A *month-end* balance is a different thing, and it is genuinely derivable.
 * Every charge carries a due date and, when it settled, the date it settled
 * on. So "what was outstanding on 31 October" is exactly:
 *
 *     every charge due on or before 31 Oct
 *     minus every payment against those charges received on or before 31 Oct
 *
 * That is arithmetic over data we hold, not a guess. The one approximation is
 * that a partial payment is treated as landing entirely on its recorded
 * settlement date, because a single date is all the schema keeps — stated here
 * so nobody later mistakes this for a stored ledger. It is accurate to the day
 * for the ordinary case of one payment per charge, which is almost all of them.
 *
 * Future months get `null` rather than a number: a month that has not happened
 * has billed charges and no payments, so computing it would draw a cliff of
 * imaginary arrears off the right-hand edge of every chart.
 *
 * Pure: charges in, months out.
 */

import {
  monthKeyOf, monthLabel, monthRange, shiftMonth, monthPosition,
  type MonthKey, type MonthPosition, type Charge,
} from '@/lib/financialsMonth'
import { billingToday } from '@/lib/financialsRollup'

const round2 = (n: number) => Math.round(n * 100) / 100

/** The windows a landlord actually asks for. */
export type RangeId = '6m' | '12m' | '24m' | 'all'

export const HISTORY_RANGES: { id: RangeId; label: string; months: number | null; hint: string }[] = [
  { id: '6m',  label: '6 months',  months: 6,    hint: 'The current season' },
  { id: '12m', label: '12 months', months: 12,   hint: 'A full year, so seasonality is visible' },
  { id: '24m', label: '2 years',   months: 24,   hint: 'Year against year' },
  { id: 'all', label: 'All time',  months: null, hint: 'Every month you have billed in' },
]

/**
 * One month of history.
 *
 * `onTime + late + unpaid === billed`, exactly. That identity is what lets the
 * composition be drawn as a stacked bar without the stack lying about what it
 * is a part of.
 */
export type HistoryMonth = {
  key: MonthKey
  /** 'Oct' — the axis. */
  label: string
  /** 'October 2026' — the readout. */
  longLabel: string
  year: number
  position: MonthPosition

  /** Charges that fell due in this month. */
  billed: number
  /** Rent and charges received against them, whenever it arrived. */
  collected: number
  /** Late-fee money received against them. Never inside `collected`. */
  feesCollected: number
  /** collected + feesCollected — money in. */
  received: number

  /** Of `billed`: arrived on or before the due date. */
  onTime: number
  /** Of `billed`: arrived after the due date. */
  late: number
  /** Of `billed`: never arrived. */
  unpaid: number
  onTimeCount: number
  lateCount: number
  unpaidCount: number
  count: number

  /** collected ÷ billed, 0–100. Null when nothing was billed. */
  rate: number | null
  /** onTime ÷ billed, 0–100. The share that behaved as agreed. */
  onTimeShare: number | null

  /**
   * Everything outstanding across the whole portfolio at this month's end,
   * reconstructed. Null for a month that has not finished.
   */
  arrearsAtEnd: number | null
  /**
   * That balance expressed as a multiple of this month's billing — "we are
   * carrying two and a half months of rent in arrears". Far more intuitive
   * than a bare figure, because it is already scaled to the size of the
   * portfolio. Null when nothing was billed, or for a future month.
   */
  monthsOutstanding: number | null

  /** Billed from the first month in the window up to and including this one. */
  cumBilled: number
  /** Collected over the same span. The gap between the two is the story. */
  cumCollected: number
}

export type History = {
  months: HistoryMonth[]
  /** The months that have actually finished or are running. */
  settledMonths: HistoryMonth[]
  range: RangeId
  /** Totals over the window. */
  billed: number
  collected: number
  received: number
  rate: number | null
  /** Share of billed money that arrived on time across the window. */
  onTimeShare: number | null
  /** Arrears at the end of the most recent complete month. */
  arrearsNow: number | null
  /** The same figure a year earlier, when the window reaches that far. */
  arrearsThen: number | null
  /** arrearsNow − arrearsThen. Positive means ground lost. */
  arrearsChange: number | null
  /** The worst month-end arrears in the window, for a reference line. */
  arrearsPeak: number | null
  /** Best and worst collection months in the window, for the readout. */
  best: HistoryMonth | null
  worst: HistoryMonth | null
  empty: boolean
}

export const EMPTY_HISTORY: History = {
  months: [], settledMonths: [], range: '12m',
  billed: 0, collected: 0, received: 0, rate: null, onTimeShare: null,
  arrearsNow: null, arrearsThen: null, arrearsChange: null, arrearsPeak: null,
  best: null, worst: null, empty: true,
}

/** The earliest month anything was billed in. */
function firstMonth(charges: Charge[]): MonthKey | null {
  let min: string | null = null
  for (const c of charges) {
    const k = c.dueDate.slice(0, 7)
    if (min === null || k < min) min = k
  }
  return min
}

/**
 * How much of a charge had been paid by a given date.
 *
 * The approximation named in the module header lives here and nowhere else: a
 * settlement is treated as landing in full on its recorded date, because one
 * date is all the schema keeps.
 */
const paidBy = (c: Charge, date: string): number => {
  const st = c.settlement
  if (!st || !st.paidDate) return 0
  return st.paidDate <= date ? c.paid : 0
}

export function history(
  charges: Charge[],
  range: RangeId = '12m',
  now = new Date(),
): History {
  if (charges.length === 0) return { ...EMPTY_HISTORY, range }

  const todayStr = billingToday(now)
  const thisKey = monthKeyOf(now)
  const spec = HISTORY_RANGES.find(r => r.id === range) ?? HISTORY_RANGES[1]

  // 'All time' starts at the first month anything was billed in — but never
  // more than five years back, because a chart with eighty columns is not a
  // chart a landlord reads.
  const keys: MonthKey[] = (() => {
    if (spec.months !== null) {
      return Array.from({ length: spec.months }, (_, i) => shiftMonth(thisKey, i - (spec.months! - 1)))
    }
    const first = firstMonth(charges) ?? thisKey
    const floor = shiftMonth(thisKey, -59)
    const start = first < floor ? floor : first
    const out: MonthKey[] = []
    for (let k = start; k <= thisKey; k = shiftMonth(k, 1)) out.push(k)
    return out.length > 0 ? out : [thisKey]
  })()

  const byMonth = new Map<MonthKey, Charge[]>()
  for (const c of charges) {
    const k = c.dueDate.slice(0, 7)
    const arr = byMonth.get(k)
    if (arr) arr.push(c)
    else byMonth.set(k, [c])
  }

  let cumBilled = 0
  let cumCollected = 0

  const months: HistoryMonth[] = keys.map(key => {
    const mine = byMonth.get(key) ?? []
    const position = monthPosition(key, now)
    const end = monthRange(key).to!

    const billed = round2(mine.reduce((n, c) => n + c.amount, 0))
    const collected = round2(mine.reduce((n, c) => n + c.paid, 0))
    const feesCollected = round2(mine.reduce((n, c) => n + c.lateFeePaid, 0))

    // The exact three-way partition of what was billed.
    let onTime = 0, late = 0
    let onTimeCount = 0, lateCount = 0
    for (const c of mine) {
      if (c.paid <= 0) continue
      const days = c.settlement?.daysLate ?? null
      if (days !== null && days > 0) { late += c.paid; lateCount += 1 }
      else { onTime += c.paid; onTimeCount += 1 }
    }
    onTime = round2(onTime)
    late = round2(late)
    const unpaid = round2(Math.max(0, billed - onTime - late))

    cumBilled = round2(cumBilled + billed)
    cumCollected = round2(cumCollected + collected)

    // Reconstructed month-end balance — see the module header for why this is
    // derivable where a weekly arrears history is not.
    const arrearsAtEnd = position === 'future'
      ? null
      : round2(charges
          .filter(c => c.dueDate <= (end < todayStr ? end : todayStr))
          .reduce((n, c) => n + Math.max(0, c.amount - paidBy(c, end < todayStr ? end : todayStr)), 0))

    return {
      key,
      label: monthLabel(key, true).split(' ')[0],
      longLabel: monthLabel(key),
      year: Number(key.slice(0, 4)),
      position,
      billed,
      collected,
      feesCollected,
      received: round2(collected + feesCollected),
      onTime,
      late,
      unpaid,
      onTimeCount,
      lateCount,
      unpaidCount: mine.filter(c => c.paid <= 0).length,
      count: mine.length,
      rate: billed > 0 ? Math.round((collected / billed) * 100) : null,
      onTimeShare: billed > 0 ? Math.round((onTime / billed) * 100) : null,
      arrearsAtEnd,
      monthsOutstanding: arrearsAtEnd !== null && billed > 0
        ? Math.round((arrearsAtEnd / billed) * 10) / 10
        : null,
      cumBilled,
      cumCollected,
    }
  })

  const settledMonths = months.filter(m => m.position !== 'future')
  const rated = settledMonths.filter(m => m.rate !== null)
  const withArrears = settledMonths.filter(m => m.arrearsAtEnd !== null)

  const billed = round2(settledMonths.reduce((n, m) => n + m.billed, 0))
  const collected = round2(settledMonths.reduce((n, m) => n + m.collected, 0))
  const onTimeTotal = round2(settledMonths.reduce((n, m) => n + m.onTime, 0))

  // Compared against the same month a year earlier when the window reaches
  // back that far, and against its own first month otherwise — a comparison is
  // only offered when there is something real to compare with.
  const last = withArrears.length > 0 ? withArrears[withArrears.length - 1] : null
  const yearBack = last ? withArrears.find(m => m.key === shiftMonth(last.key, -12)) : undefined
  const then = yearBack ?? (withArrears.length >= 4 ? withArrears[0] : undefined)

  return {
    months,
    settledMonths,
    range,
    billed,
    collected,
    received: round2(settledMonths.reduce((n, m) => n + m.received, 0)),
    rate: billed > 0 ? Math.round((collected / billed) * 100) : null,
    onTimeShare: billed > 0 ? Math.round((onTimeTotal / billed) * 100) : null,
    arrearsNow: last?.arrearsAtEnd ?? null,
    arrearsThen: then?.arrearsAtEnd ?? null,
    arrearsChange: last?.arrearsAtEnd != null && then?.arrearsAtEnd != null
      ? round2(last.arrearsAtEnd - then.arrearsAtEnd)
      : null,
    arrearsPeak: withArrears.length > 0
      ? Math.max(...withArrears.map(m => m.arrearsAtEnd!))
      : null,
    best: rated.length > 0
      ? rated.reduce((b, m) => (m.rate! > b.rate! ? m : b), rated[0])
      : null,
    worst: rated.length > 0
      ? rated.reduce((w, m) => (m.rate! < w.rate! ? m : w), rated[0])
      : null,
    empty: billed === 0 && collected === 0,
  }
}

// ─── PACE ────────────────────────────────────────────────────────────────────

/**
 * This month against the same *elapsed portion* of last month.
 *
 * A dashboard stat card wants a delta pill, and the honest objection to one
 * has always been that a running month compared against a finished month
 * invents a crisis every time a landlord looks before the rent is due: on the
 * 3rd, "down 94%" is true and useless.
 *
 * Comparing like elapsed portions fixes exactly that. On the 6th of November
 * this compares everything collected 1–6 November against everything
 * collected 1–6 October. Both sides are six days of a month, so the
 * comparison is fair, and it is the one a landlord actually makes in their
 * head: *are we ahead of where we were by now last month?*
 *
 * Null when there is no last month to compare against, rather than a zero —
 * see the module header on never inventing a comparison.
 */
export type Pace = {
  /** Collected so far this month. */
  toDate: number
  /** Collected by the same day of last month. */
  lastToSame: number
  /** toDate − lastToSame. */
  delta: number
  /** The change as a percentage of last month's figure. Null when that was
   *  zero — a rise from nothing is not a percentage. */
  deltaPct: number | null
  /** How far through the month we are, for the caption. */
  dayOfMonth: number
  /** 'by the 6th of last month' */
  basis: string
  /** False when there is nothing to compare with. */
  comparable: boolean
}

export function pace(charges: Charge[], now = new Date()): Pace {
  const todayStr = billingToday(now)
  const day = Number(todayStr.slice(8, 10))
  const thisKey = monthKeyOf(now)
  const lastKey = shiftMonth(thisKey, -1)

  // The same day number in the previous month, clamped to its length so the
  // 31st of a long month compares against the last day of a short one rather
  // than falling off the end of it.
  const lastEnd = monthRange(lastKey).to!
  const lastDays = Number(lastEnd.slice(8, 10))
  const lastCut = `${lastKey}-${String(Math.min(day, lastDays)).padStart(2, '0')}`

  /** Money received in a month, counted only up to a cut-off date. */
  const upTo = (key: MonthKey, cut: string) => round2(charges.reduce((n, c) => {
    if (c.dueDate.slice(0, 7) !== key) return n
    const d = c.settlement?.paidDate
    return d && d <= cut ? n + c.paid : n
  }, 0))

  const toDate = upTo(thisKey, todayStr)
  const lastToSame = upTo(lastKey, lastCut)
  const anyLast = charges.some(c => c.dueDate.slice(0, 7) === lastKey)

  return {
    toDate,
    lastToSame,
    delta: round2(toDate - lastToSame),
    deltaPct: lastToSame > 0 ? Math.round(((toDate - lastToSame) / lastToSame) * 100) : null,
    dayOfMonth: day,
    basis: `the same point of ${monthLabel(lastKey)}`,
    comparable: anyLast,
  }
}

/**
 * How today's arrears compare with the last month end.
 *
 * Honest for the same reason the trends chart is: a month-end balance is
 * reconstructible from due dates and settlement dates, so this is arithmetic
 * rather than a stored snapshot we never took.
 */
export type ArrearsMove = {
  now: number
  atLastMonthEnd: number | null
  delta: number | null
  deltaPct: number | null
  basis: string
}

export function arrearsMove(charges: Charge[], now = new Date()): ArrearsMove {
  const todayStr = billingToday(now)
  const lastKey = shiftMonth(monthKeyOf(now), -1)
  const lastEnd = monthRange(lastKey).to!

  const owedAt = (cut: string) => round2(charges
    .filter(c => c.dueDate <= cut)
    .reduce((n, c) => n + Math.max(0, c.amount - paidBy(c, cut)), 0))

  const current = owedAt(todayStr)
  const anyBefore = charges.some(c => c.dueDate <= lastEnd)
  const before = anyBefore ? owedAt(lastEnd) : null

  return {
    now: current,
    atLastMonthEnd: before,
    delta: before !== null ? round2(current - before) : null,
    deltaPct: before !== null && before > 0
      ? Math.round(((current - before) / before) * 100)
      : null,
    basis: `the end of ${monthLabel(lastKey)}`,
  }
}

/** The window as a sentence, for a chart's caption. */
export function rangeLabel(h: History): string {
  const live = h.months.filter(m => m.position !== 'future')
  if (live.length === 0) return 'no history yet'
  return `${live[0].longLabel} to ${live[live.length - 1].longLabel}`
}
