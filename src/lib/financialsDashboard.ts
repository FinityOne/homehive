/**
 * The dashboard model — every figure and every series the Financials overview
 * draws, derived in one pure place.
 *
 * ── Why the overview changed shape ─────────────────────────────────────────
 *
 * Financials used to *be* the detail. One scrolling page carried five sections,
 * each a dense nested table: standing figures, missed payments by payer, the
 * late-fee ledger, a look-ahead strip, a named month lease-by-lease-by-payer,
 * and a payments log. Every one of those is worth having. Stacked on the screen
 * a landlord lands on, they are a wall — the page opened with four tiles and
 * then asked its reader to scan roughly two hundred rows to find out whether
 * anything was wrong.
 *
 * So the overview's job is now strictly triage, in the order a professional
 * manager actually triages:
 *
 *   1. **Am I being paid?** — this month's collection against what was billed,
 *      and the twelve months behind it. One number and one chart.
 *   2. **What is wrong right now?** — money overdue, aged into buckets, and
 *      the specific things to act on today.
 *   3. **What is coming?** — the next thirty days, and the months after.
 *   4. **Where is it coming from?** — which properties are carrying the
 *      portfolio and which are dragging it.
 *
 * Nothing on the overview is a table you work in. Every card is a door into a
 * page that *is* one, and those pages carry the filters, the sorting and the
 * export. That is the whole trade: the landing screen answers "is anything
 * wrong", and a detail page answers "what exactly, and what do I do".
 *
 * ── Rules the figures obey ─────────────────────────────────────────────────
 *
 *   • A **standing** figure (owed, held, contracted, clearing) is bound to no
 *     window, because the thing it describes isn't. A debt does not expire
 *     when a reporting period rolls over.
 *   • A **period** figure says which period, by name, in the label. "October
 *     2026", never "this month".
 *   • A collection **rate** is rent against rent. Late fees never enter the
 *     numerator — fold them in and a tenant who pays a fee pushes the rate
 *     past 100%.
 *   • Money owed always means shortfall **plus** the fee assessed on it, which
 *     is the figure a tenant would be quoted.
 *
 * Everything is pure, and everything reuses the definitions in
 * `financialsMonth`, `financialsRollup`, `lateFees` and `financialsTree`
 * rather than re-deriving them. A number computed twice is a number that will
 * eventually be reported two ways.
 */

import {
  methodMix, sumMethodMix, ALL_TIME, billingToday,
  type MethodSlice,
} from '@/lib/financialsRollup'
import {
  allCharges, arrears, standing, monthView, upcomingMonths,
  monthKeyOf, monthLabel, shiftMonth,
  type Charge, type MonthKey, type UpcomingMonth, type Arrears,
} from '@/lib/financialsMonth'
import { lateFeeLedger, type LateFeeLedger, type LateFeeWaiver } from '@/lib/lateFees'
import { buildTree, type MoneyTree, type TreeLease, type TreeProperty } from '@/lib/financialsTree'
import type { PaymentPlan } from '@/lib/payments'

const round2 = (n: number) => Math.round(n * 100) / 100

/** How many months of history the trend chart carries. A year is the shortest
 *  window in which seasonality in student housing is visible at all. */
export const TREND_MONTHS = 12

/** How far ahead the look-ahead reaches. Rent is contracted, so this is known. */
export const AHEAD_MONTHS = 6

/** A lease inside its last two months is one a manager is already working. */
const ENDING_SOON_DAYS = 60

// ─── AGING ───────────────────────────────────────────────────────────────────

/**
 * Arrears split by how old they are.
 *
 * The single "owed to you" figure is the one a landlord acts on, but it is not
 * the one that tells them *how much trouble they are in*. $4,000 that went
 * overdue yesterday is an email; $4,000 that has been overdue for ten weeks is
 * a legal question. Collapsing both into one number is why the old page could
 * show a large, stable arrears figure for months without anything escalating.
 *
 * The boundaries are the ones the industry uses — 1–15, 16–30, 31–60, 60+ —
 * because a landlord comparing this against their accountant's aging report
 * should see the same buckets.
 */
export type AgingBucket = {
  id: 'fresh' | 'month' | 'twoMonths' | 'severe'
  label: string
  /** What this age actually means for the landlord's next move. */
  hint: string
  from: number
  to: number | null
  amount: number
  count: number
  payerCount: number
  tone: 'warn' | 'bad' | 'severe'
}

const BUCKETS: Omit<AgingBucket, 'amount' | 'count' | 'payerCount'>[] = [
  { id: 'fresh',      label: '1–15 days',  hint: 'A reminder usually settles this.',               from: 1,  to: 15,   tone: 'warn' },
  { id: 'month',      label: '16–30 days', hint: 'Needs a call, not another email.',               from: 16, to: 30,   tone: 'bad' },
  { id: 'twoMonths',  label: '31–60 days', hint: 'A second month is about to come due on top.',    from: 31, to: 60,   tone: 'bad' },
  { id: 'severe',     label: '60+ days',   hint: 'Rarely collected without a formal notice.',      from: 61, to: null, tone: 'severe' },
]

export function agingBuckets(a: Arrears): AgingBucket[] {
  return BUCKETS.map(b => {
    const charges = a.payers.flatMap(p =>
      p.charges.filter(c => c.daysLate >= b.from && (b.to === null || c.daysLate <= b.to)),
    )
    const payers = new Set(
      a.payers
        .filter(p => p.charges.some(c => c.daysLate >= b.from && (b.to === null || c.daysLate <= b.to)))
        .map(p => p.key),
    )
    return {
      ...b,
      amount: round2(charges.reduce((n, c) => n + c.totalDue, 0)),
      count: charges.length,
      payerCount: payers.size,
    }
  })
}

// ─── TREND ───────────────────────────────────────────────────────────────────

/**
 * One month on the trend chart.
 *
 * Billed and collected are kept apart from fees for the reason the whole module
 * repeats: `rate` has to stay rent-against-rent to be comparable month over
 * month. `received` is the money-in line, fees included, for anyone reading the
 * chart as cash flow.
 */
export type TrendPoint = {
  key: MonthKey
  /** 'Oct' — the axis label. */
  label: string
  /** 'October 2026' — what a tooltip says. */
  longLabel: string
  year: number
  billed: number
  collected: number
  /** Late-fee money that arrived against this month's charges. */
  feesCollected: number
  /** collected + feesCollected. */
  received: number
  /** Still owed on this month's charges, fees included. */
  stillDue: number
  /** collected ÷ billed, 0–100. Null when nothing was billed. */
  rate: number | null
  /** Settled charges that arrived on or before the due date. */
  onTime: number
  /** Settled charges that arrived after it. */
  arrivedLate: number
  /** Whether this month is behind us, now, or ahead. */
  position: 'past' | 'current' | 'future'
}

/**
 * Collected against billed, month by month, oldest first.
 *
 * Built from `allCharges` rather than from the raw rent rows, so one-off
 * charges and deposits are in it and every month agrees with the month view a
 * click away.
 */
export function trend(
  charges: Charge[],
  months = TREND_MONTHS,
  now = new Date(),
): TrendPoint[] {
  const thisKey = monthKeyOf(now)
  const keys = Array.from({ length: months }, (_, i) => shiftMonth(thisKey, i - (months - 1)))

  const byMonth = new Map<MonthKey, Charge[]>()
  for (const c of charges) {
    const k = c.dueDate.slice(0, 7)
    const arr = byMonth.get(k)
    if (arr) arr.push(c)
    else byMonth.set(k, [c])
  }

  return keys.map(key => {
    const mine = byMonth.get(key) ?? []
    const billed = round2(mine.reduce((n, c) => n + c.amount, 0))
    const collected = round2(mine.reduce((n, c) => n + c.paid, 0))
    const feesCollected = round2(mine.reduce((n, c) => n + c.lateFeePaid, 0))
    const settled = mine.filter(c => c.settlement !== null && c.settlement.daysLate !== null)
    return {
      key,
      label: monthLabel(key, true).split(' ')[0],
      longLabel: monthLabel(key),
      year: Number(key.slice(0, 4)),
      billed,
      collected,
      feesCollected,
      received: round2(collected + feesCollected),
      stillDue: round2(mine.reduce((n, c) => n + c.totalDue, 0)),
      rate: billed > 0 ? Math.round((collected / billed) * 100) : null,
      onTime: settled.filter(c => (c.settlement!.daysLate ?? 0) <= 0).length,
      arrivedLate: settled.filter(c => (c.settlement!.daysLate ?? 0) > 0).length,
      position: key === thisKey ? 'current' : key < thisKey ? 'past' : 'future',
    }
  })
}

// ─── PAYMENT BEHAVIOUR ───────────────────────────────────────────────────────

/**
 * How reliably this portfolio's tenants pay — the one metric that predicts next
 * month rather than describing last one.
 *
 * `overdue` only ever describes what is *still* unpaid, so a tenant who settles
 * three weeks late disappears from every arrears figure the moment the money
 * lands and the landlord forgets the problem ever existed. Collecting late is a
 * different fact from collecting on time, and it is the one that says whether a
 * tenancy should be renewed.
 */
export type Behaviour = {
  /** Charges settled in the window. */
  settled: number
  /** Settled on or before the due date. */
  onTime: number
  /** Settled after it. */
  late: number
  /** onTime ÷ settled, 0–100. Null when nothing settled. */
  rate: number | null
  /** Mean lateness across the late ones, in days. */
  avgDaysLate: number
  /** Worst lateness in the window, in days. */
  maxDaysLate: number
  /** How many months of history this is over. */
  months: number
}

export function behaviour(charges: Charge[], months = TREND_MONTHS, now = new Date()): Behaviour {
  const from = shiftMonth(monthKeyOf(now), -(months - 1)) + '-01'
  const settled = charges.filter(
    c => c.dueDate >= from && c.settlement !== null && c.settlement.daysLate !== null,
  )
  const late = settled.filter(c => (c.settlement!.daysLate ?? 0) > 0)
  const lateDays = late.map(c => c.settlement!.daysLate ?? 0)
  return {
    settled: settled.length,
    onTime: settled.length - late.length,
    late: late.length,
    rate: settled.length > 0
      ? Math.round(((settled.length - late.length) / settled.length) * 100)
      : null,
    avgDaysLate: late.length > 0 ? Math.round(lateDays.reduce((a, b) => a + b, 0) / late.length) : 0,
    maxDaysLate: lateDays.length > 0 ? Math.max(...lateDays) : 0,
    months,
  }
}

// ─── THE DASHBOARD ───────────────────────────────────────────────────────────

/** One named month's headline, for the "am I being paid" card. */
export type MonthHeadline = {
  key: MonthKey
  label: string
  billed: number
  collected: number
  /** Outstanding rent and charges plus the fees on them. */
  stillDue: number
  /** The overdue slice of that. */
  overdue: number
  rate: number | null
  /** Money the tenant has sent that has not landed yet. */
  clearing: number
  chargeCount: number
  settledCount: number
}

/**
 * One thing worth doing today, ranked.
 *
 * Deliberately a *person* and not a charge: a landlord chases a tenant, and
 * three missed months from one tenant is one phone call and one figure to
 * quote. A flat list of charges makes that take arithmetic, which is what the
 * old page asked of its reader.
 */
export type TodoItem = {
  key: string
  planId: string
  leaseKey: string
  name: string
  email: string | null
  propertyName: string
  leaseName: string
  /** shortfall + fees. */
  amount: number
  chargeCount: number
  maxDaysLate: number
  oldestDue: string
  /** Which aging bucket the worst charge falls in. */
  bucket: AgingBucket['id']
  /** Reminders already sent about these charges. */
  chased: number
  tone: 'warn' | 'bad' | 'severe'
}

export type Dashboard = {
  /** The hierarchy, so the overview and every detail page share one shape. */
  tree: MoneyTree

  // ── Standing: bound to no window ──
  /** Shortfall plus assessed fees, across the whole of every lease in view. */
  owed: number
  owedPayers: number
  owedCharges: number
  worstDaysLate: number
  /** Contracted rent per month across the active payers. */
  monthly: number
  /** What the declared utilities add to that each month. */
  utilitiesMonthly: number
  depositsHeld: number
  clearing: { amount: number; count: number }
  next30: { amount: number; count: number }

  // ── Periods, named ──
  thisMonth: MonthHeadline
  lastMonth: MonthHeadline
  /** Money that actually arrived over the trend window. */
  received12: number
  billed12: number
  rate12: number | null

  // ── Series ──
  trend: TrendPoint[]
  aging: AgingBucket[]
  methods: MethodSlice[]
  upcoming: UpcomingMonth[]
  behaviour: Behaviour

  // ── Lists, short by design ──
  todo: TodoItem[]
  /** Leases inside their last two months — renewal, deposit, inspection. */
  expiring: TreeLease[]
  /** Properties ranked by what needs attention, then by size. */
  properties: TreeProperty[]
  /** Leases whose rent is split across more than one payment plan. */
  splitLeases: TreeLease[]

  // ── The underlying ledgers, for the cards that quote them ──
  arrears: Arrears
  fees: LateFeeLedger

  /** Nothing is being tracked at all. */
  empty: boolean
}

function headline(view: ReturnType<typeof monthView>): MonthHeadline {
  const t = view.totals
  return {
    key: view.key,
    label: view.label,
    billed: t.billed,
    collected: t.collected,
    stillDue: view.totalDue,
    overdue: view.overdueDue,
    rate: t.rate,
    clearing: t.inFlight,
    chargeCount: t.count,
    settledCount: t.settledCount,
  }
}

const bucketOf = (days: number): AgingBucket['id'] =>
  days <= 15 ? 'fresh' : days <= 30 ? 'month' : days <= 60 ? 'twoMonths' : 'severe'

const TONE_OF: Record<AgingBucket['id'], TodoItem['tone']> = {
  fresh: 'warn', month: 'bad', twoMonths: 'bad', severe: 'severe',
}

/** How many people the overview's action list names before deferring to the
 *  collections page. Five is a glance; a sixth makes it a table. */
const TODO_SHOWN = 5

export function buildDashboard(
  plans: PaymentPlan[],
  waivers: LateFeeWaiver[] = [],
  now = new Date(),
): Dashboard {
  const tree = buildTree(plans, waivers, now)
  const charges = allCharges(plans, now)
  const a = arrears(plans, now)
  const fees = lateFeeLedger(plans, waivers, now)
  const nowStanding = standing(plans, now)
  const thisKey = monthKeyOf(now)
  const series = trend(charges, TREND_MONTHS, now)
  const todayStr = billingToday(now)

  // Keyed by plan so a tenancy's route can be reached from an arrears row,
  // which only knows the plan it came from.
  const leaseKeyOfPlan = new Map<string, string>()
  for (const l of tree.leases) for (const p of l.plans) leaseKeyOfPlan.set(p.planId, l.key)

  const todo: TodoItem[] = a.payers.map(p => {
    const worst = p.maxDaysLate
    const id = bucketOf(worst)
    return {
      key: p.key,
      planId: p.planId,
      leaseKey: leaseKeyOfPlan.get(p.planId) ?? `plan-${p.planId}`,
      name: p.name,
      email: p.email,
      propertyName: p.propertyName,
      leaseName: p.leaseName,
      amount: p.total,
      chargeCount: p.charges.length,
      maxDaysLate: worst,
      oldestDue: p.oldestDue,
      bucket: id,
      chased: p.charges.reduce((n, c) => Math.max(n, c.chases.count), 0),
      tone: TONE_OF[id],
    }
  })

  const past = series.filter(p => p.position !== 'future')

  return {
    tree,

    owed: a.total,
    owedPayers: a.payerCount,
    owedCharges: a.chargeCount,
    worstDaysLate: a.maxDaysLate,
    monthly: nowStanding.monthly,
    utilitiesMonthly: round2(tree.leases.reduce((n, l) => n + l.utilitiesMonthly, 0)),
    depositsHeld: nowStanding.depositsHeld,
    clearing: nowStanding.clearing,
    next30: nowStanding.next30,

    thisMonth: headline(monthView(plans, thisKey, now)),
    lastMonth: headline(monthView(plans, shiftMonth(thisKey, -1), now)),
    received12: round2(past.reduce((n, p) => n + p.received, 0)),
    billed12: round2(past.reduce((n, p) => n + p.billed, 0)),
    rate12: (() => {
      const billed = past.reduce((n, p) => n + p.billed, 0)
      const collected = past.reduce((n, p) => n + p.collected, 0)
      return billed > 0 ? Math.round((collected / billed) * 100) : null
    })(),

    trend: series,
    aging: agingBuckets(a),
    methods: sumMethodMix(
      plans.map(p => methodMix(p.scheduled_payments ?? [], p.special_payments ?? [], ALL_TIME)),
    ),
    upcoming: upcomingMonths(plans, thisKey, AHEAD_MONTHS, now),
    behaviour: behaviour(charges, TREND_MONTHS, now),

    todo: todo.slice(0, TODO_SHOWN),
    expiring: tree.leases
      .filter(l =>
        l.daysLeft !== null && l.daysLeft >= 0 && l.daysLeft <= ENDING_SOON_DAYS &&
        (l.termStart === null || l.termStart <= todayStr),
      )
      .sort((x, y) => (x.daysLeft ?? 0) - (y.daysLeft ?? 0)),
    properties: tree.properties,
    splitLeases: tree.leases.filter(l => l.splitBilling),

    arrears: a,
    fees,

    empty: plans.length === 0,
  }
}

/** The full action list, for the page that is allowed to be a table. */
export function allTodo(a: Arrears, tree: MoneyTree): TodoItem[] {
  const leaseKeyOfPlan = new Map<string, string>()
  for (const l of tree.leases) for (const p of l.plans) leaseKeyOfPlan.set(p.planId, l.key)
  return a.payers.map(p => {
    const id = bucketOf(p.maxDaysLate)
    return {
      key: p.key,
      planId: p.planId,
      leaseKey: leaseKeyOfPlan.get(p.planId) ?? `plan-${p.planId}`,
      name: p.name,
      email: p.email,
      propertyName: p.propertyName,
      leaseName: p.leaseName,
      amount: p.total,
      chargeCount: p.charges.length,
      maxDaysLate: p.maxDaysLate,
      oldestDue: p.oldestDue,
      bucket: id,
      chased: p.charges.reduce((n, c) => Math.max(n, c.chases.count), 0),
      tone: TONE_OF[id],
    }
  })
}

export { bucketOf }
