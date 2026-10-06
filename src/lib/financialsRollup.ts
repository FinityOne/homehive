import {
  SPECIAL_CATEGORIES,
  type PaymentPlan, type ScheduledPayment, type SpecialPayment,
} from '@/lib/payments'
import { lateFeeDue, lateFeeRuleRisk } from '@/lib/rentPayments'

export { lateFeeDue, lateFeeRuleRisk, lateFeeCappedByCharge } from '@/lib/rentPayments'
export type { LateFeeRuleLike } from '@/lib/rentPayments'

/**
 * The money model behind the landlord Financials tab.
 *
 * The page used to answer exactly one question — "how much of this month's rent
 * has landed" — and answered it as a flat list of plans. A property manager asks
 * a different question at every altitude: what is the portfolio worth, which
 * building is behind, how far through its term is this lease, who inside it still
 * owes. Those are all the same rows summed at different levels, so the summing
 * lives here, pure and testable, and the page only renders it.
 *
 * Three rules hold everywhere below:
 *
 *   • **Billed** is what was asked for within the window. **Collected** is what
 *     arrived against those same charges. Outstanding is the difference, never
 *     negative — an overpayment is not a credit against someone else's rent.
 *   • Voided rent and waived charges are not money. They are excluded from every
 *     total rather than counted as settled, so writing one off can neither
 *     flatter nor dent a collection rate.
 *   • A window is defined by *due date*, not payment date. "September" means the
 *     rent that was due in September, even if it arrived in October — that is the
 *     only reading under which a collection rate means anything.
 */

// ─── SCOPE ───────────────────────────────────────────────────────────────────

/** The time window every figure on the page is computed over. */
export type Scope = 'month' | 'ytd' | 'todate' | 'term'

export const SCOPES: { id: Scope; label: string; hint: string }[] = [
  { id: 'month',  label: 'This month',   hint: 'Rent and charges due this calendar month' },
  { id: 'ytd',    label: 'Year to date', hint: 'Everything due since January 1, through today' },
  { id: 'todate', label: 'Lease to date', hint: 'Everything billed since each lease began, through today' },
  { id: 'term',   label: 'Full term',    hint: 'The whole contracted life of every lease, including rent not yet due' },
]

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Inclusive due-date bounds for a scope. `null` on a side means unbounded. */
export function scopeRange(scope: Scope, now = new Date()): { from: string | null; to: string | null } {
  const today = iso(now)
  switch (scope) {
    case 'month': {
      const y = now.getFullYear(), m = now.getMonth()
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) }
    }
    case 'ytd':    return { from: `${now.getFullYear()}-01-01`, to: today }
    case 'todate': return { from: null, to: today }
    case 'term':   return { from: null, to: null }
  }
}

export type Range = { from: string | null; to: string | null }

const ALL_TIME: Range = { from: null, to: null }

const inRange = (date: string, r: Range) =>
  (r.from === null || date >= r.from) && (r.to === null || date <= r.to)

// ─── TOTALS ──────────────────────────────────────────────────────────────────

/** What a set of charges is worth, and how much of it actually arrived. */
export type Totals = {
  /** Charges asked for in the window (voided/waived excluded). */
  billed: number
  /** Money received against those charges. */
  collected: number
  /** Still owed. Never negative. */
  outstanding: number
  /** The slice of `outstanding` that is already past its due date. */
  overdue: number
  /** How many charges are past due. */
  overdueCount: number
  /** Charges in the window. */
  count: number
  /** Charges fully settled. */
  settledCount: number
  /**
   * Money the tenant has already sent that has not landed yet — an ACH debit
   * in `processing`. It is a slice of `outstanding`, not a separate bucket:
   * the landlord does not have it, so it cannot count as collected, but they
   * must not chase it either. Showing it is the whole point — otherwise an
   * ACH payment looks identical to a tenant who simply hasn't paid.
   */
  inFlight: number
  /** How many charges are clearing. */
  inFlightCount: number
  /**
   * Money that did arrive, but after its due date.
   *
   * `overdue` only ever describes what is *still* unpaid, so a tenant who pays
   * three weeks late vanishes from every figure the moment they pay — the page
   * forgets the whole problem. On this portfolio that is 31 of 68 settled
   * payments. Collecting late is a different fact from collecting on time, and
   * it is the one that predicts next month.
   */
  collectedLate: number
  /** How many settled charges arrived after their due date. */
  collectedLateCount: number
  /** The worst lateness among them, in days. */
  maxDaysLate: number
  /**
   * Surcharge the *tenant* paid on top (5% card / 2% ACH). Never deducted from
   * the landlord — it is tracked here only so the page can say so explicitly,
   * because "fees" is otherwise assumed to come out of rent.
   */
  tenantFees: number
  /** collected ÷ billed as 0–100. `null` when nothing was billed. */
  rate: number | null
}

export const EMPTY_TOTALS: Totals = {
  billed: 0, collected: 0, outstanding: 0, overdue: 0,
  overdueCount: 0, count: 0, settledCount: 0, inFlight: 0, inFlightCount: 0,
  collectedLate: 0, collectedLateCount: 0, maxDaysLate: 0, tenantFees: 0, rate: null,
}

function finish(t: Omit<Totals, 'outstanding' | 'rate'>): Totals {
  return {
    ...t,
    outstanding: Math.max(0, t.billed - t.collected),
    rate: t.billed > 0 ? Math.round((t.collected / t.billed) * 100) : null,
  }
}

export function sumTotals(parts: Totals[]): Totals {
  if (parts.length === 0) return EMPTY_TOTALS
  return finish(parts.reduce((a, b) => ({
    billed:        a.billed + b.billed,
    collected:     a.collected + b.collected,
    overdue:       a.overdue + b.overdue,
    overdueCount:  a.overdueCount + b.overdueCount,
    count:         a.count + b.count,
    settledCount:  a.settledCount + b.settledCount,
    inFlight:      a.inFlight + b.inFlight,
    inFlightCount: a.inFlightCount + b.inFlightCount,
    collectedLate: a.collectedLate + b.collectedLate,
    collectedLateCount: a.collectedLateCount + b.collectedLateCount,
    maxDaysLate:   Math.max(a.maxDaysLate, b.maxDaysLate),
    tenantFees:    a.tenantFees + b.tenantFees,
  }), { billed: 0, collected: 0, overdue: 0, overdueCount: 0, count: 0, settledCount: 0, inFlight: 0, inFlightCount: 0, collectedLate: 0, collectedLateCount: 0, maxDaysLate: 0, tenantFees: 0 }))
}

/** Whole days from one ISO date to another. */
function daysBetweenDates(from: string, to: string): number {
  return Math.round(
    (new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 86_400_000
  )
}

/** Rent that is still live money — a voided row was cancelled, not collected. */
const liveRent = (sp: ScheduledPayment) => sp.status !== 'voided'

/**
 * Past its due date with money still owed.
 *
 * Deliberately *not* `isOverdue` from payments.ts. That helper treats any
 * non-pending status as already resolved, so a charge that was part-paid and
 * then left alone for a month reports as not overdue — the arrears disappear
 * from the figure the moment a tenant pays anything at all. At portfolio level
 * that is the difference between a page you can trust and one you can't, so
 * here the money decides: a shortfall past its due date is overdue, whatever
 * the row happens to be labelled.
 *
 * `processing` is the one exception — ACH already in flight is money on its
 * way, and chasing it would be chasing a payment the tenant has made.
 */
function pastDue(sp: ScheduledPayment, todayStr: string): boolean {
  if (sp.status === 'voided' || sp.status === 'processing') return false
  return sp.due_date < todayStr && sp.amount - sp.paid_amount > 0
}

export function rentTotals(sps: ScheduledPayment[], range: Range, now = new Date()): Totals {
  const todayStr = iso(now)
  let billed = 0, collected = 0, overdue = 0, overdueCount = 0, count = 0, settledCount = 0
  let inFlight = 0, inFlightCount = 0
  let collectedLate = 0, collectedLateCount = 0, maxDaysLate = 0, tenantFees = 0
  for (const sp of sps) {
    if (!liveRent(sp) || !inRange(sp.due_date, range)) continue
    count++
    billed += sp.amount
    collected += sp.paid_amount
    tenantFees += sp.processing_fee ?? 0
    if (sp.paid_amount >= sp.amount) settledCount++
    if (sp.status === 'processing') {
      inFlight += Math.max(0, sp.amount - sp.paid_amount)
      inFlightCount++
    }
    // Arrived, but after the due date. Measured from paid_date because that is
    // when the money actually came in, not from today.
    if (sp.paid_amount > 0 && sp.paid_date && sp.paid_date > sp.due_date) {
      collectedLate += sp.paid_amount
      collectedLateCount++
      maxDaysLate = Math.max(maxDaysLate, daysBetweenDates(sp.due_date, sp.paid_date))
    }
    if (pastDue(sp, todayStr)) {
      overdue += sp.amount - sp.paid_amount
      overdueCount++
    }
  }
  return finish({ billed, collected, overdue, overdueCount, count, settledCount, inFlight, inFlightCount, collectedLate, collectedLateCount, maxDaysLate, tenantFees })
}

/** A one-off charge has no partial state on `special_payments` — paid means the
 *  whole amount landed. A waived charge is written off and leaves the ledger.
 *  `processing` is an ACH debit still clearing: not collected, but not overdue
 *  either, so it must be carved out before the past-due test or a tenant who
 *  paid by bank transfer gets chased for money already on its way. */
export function chargeTotals(specials: SpecialPayment[], range: Range, now = new Date()): Totals {
  const todayStr = iso(now)
  let billed = 0, collected = 0, overdue = 0, overdueCount = 0, count = 0, settledCount = 0
  let inFlight = 0, inFlightCount = 0
  let collectedLate = 0, collectedLateCount = 0, maxDaysLate = 0, tenantFees = 0
  for (const sp of specials) {
    if (sp.status === 'waived' || !inRange(sp.due_date, range)) continue
    count++
    billed += sp.amount
    tenantFees += sp.processing_fee ?? 0
    if (sp.status === 'paid') { collected += sp.amount; settledCount++ }
    else if (sp.status === 'processing') { inFlight += sp.amount; inFlightCount++ }
    else if (sp.due_date < todayStr) { overdue += sp.amount; overdueCount++ }
    if (sp.status === 'paid' && sp.paid_date && sp.paid_date > sp.due_date) {
      collectedLate += sp.amount
      collectedLateCount++
      maxDaysLate = Math.max(maxDaysLate, daysBetweenDates(sp.due_date, sp.paid_date))
    }
  }
  return finish({ billed, collected, overdue, overdueCount, count, settledCount, inFlight, inFlightCount, collectedLate, collectedLateCount, maxDaysLate, tenantFees })
}

// ─── HOW MONEY ARRIVED ───────────────────────────────────────────────────────

/** The ways a settled payment can have reached the landlord. */
export type SettleMethod = 'card' | 'ach' | 'manual_zelle' | 'manual_other'

export const METHOD_META: Record<SettleMethod, { label: string; short: string; color: string; bg: string }> = {
  card:         { label: 'Card',          short: 'Card',   color: '#6d28d9', bg: '#f5f3ff' },
  ach:          { label: 'Bank transfer', short: 'ACH',    color: '#1d4ed8', bg: '#eff6ff' },
  manual_zelle: { label: 'Zelle',         short: 'Zelle',  color: '#0e7490', bg: '#ecfeff' },
  manual_other: { label: 'Recorded by hand', short: 'Manual', color: '#64748b', bg: '#f1f5f9' },
}

export type MethodSlice = { method: SettleMethod; amount: number; count: number; clearing: number }

/**
 * How the collected money actually arrived, biggest first.
 *
 * Only money that moved counts — a row with no `payment_method` was never
 * settled, so it belongs in outstanding, not in a method bucket. `clearing`
 * is the ACH subset still in flight, which is why this is reported per method
 * rather than as one number: "pending" means something different on a card
 * (it doesn't happen) than on a bank debit (it takes days).
 */
export function methodMix(
  sps: ScheduledPayment[],
  specials: SpecialPayment[],
  range: Range,
): MethodSlice[] {
  const acc = new Map<SettleMethod, MethodSlice>()
  const add = (m: string | null, amount: number, clearing: boolean) => {
    if (!m || !(m in METHOD_META) || amount <= 0) return
    const key = m as SettleMethod
    const cur = acc.get(key) ?? { method: key, amount: 0, count: 0, clearing: 0 }
    cur.amount += amount
    cur.count += 1
    if (clearing) cur.clearing += amount
    acc.set(key, cur)
  }

  for (const sp of sps) {
    if (!liveRent(sp) || !inRange(sp.due_date, range)) continue
    if (sp.status === 'processing') add(sp.payment_method, sp.amount - sp.paid_amount, true)
    else add(sp.payment_method, sp.paid_amount, false)
  }
  for (const sp of specials) {
    if (sp.status === 'waived' || !inRange(sp.due_date, range)) continue
    if (sp.status === 'processing') add(sp.payment_method, sp.amount, true)
    else if (sp.status === 'paid') add(sp.payment_method, sp.amount, false)
  }

  return [...acc.values()].sort((a, b) => b.amount - a.amount)
}

export function sumMethodMix(parts: MethodSlice[][]): MethodSlice[] {
  const acc = new Map<SettleMethod, MethodSlice>()
  for (const slices of parts) {
    for (const s of slices) {
      const cur = acc.get(s.method) ?? { method: s.method, amount: 0, count: 0, clearing: 0 }
      cur.amount += s.amount
      cur.count += s.count
      cur.clearing += s.clearing
      acc.set(s.method, cur)
    }
  }
  return [...acc.values()].sort((a, b) => b.amount - a.amount)
}

// ─── LEASE ───────────────────────────────────────────────────────────────────

/** Where a lease sits in its own life — the context every figure needs. */
export type LeaseStage = 'upcoming' | 'active' | 'ending' | 'ended' | 'unknown'

export const STAGE_LABEL: Record<LeaseStage, string> = {
  upcoming: 'Starts soon',
  active:   'Active',
  ending:   'Ending soon',
  ended:    'Ended',
  unknown:  'No term set',
}

export type PayerSummary = {
  id: string
  name: string
  email: string | null
  status: 'active' | 'terminated' | 'completed'
  monthly: number
  rent: Totals
  /** Share of this lease's billed rent that is theirs, 0–100. */
  share: number | null
}

/**
 * One payment that actually arrived, as a landlord needs to read it.
 *
 * Carries both halves of the "how much did I really get" question: what the
 * tenant was charged, the surcharge they paid on top, and the net credited to
 * the landlord. The surcharge is *not* subtracted — the tenant pays it over and
 * above rent — and saying so on every row is the only way to stop the figure
 * being read as a deduction.
 */
export type SettledPayment = {
  id: string
  kind: 'rent' | 'charge'
  label: string
  who: string | null
  dueDate: string
  /** Date the money arrived. Always known for a settled row. */
  paidDate: string
  /** Exact instant, when one was recorded. Null for rows entered by hand. */
  settledAt: string | null
  daysLate: number
  /** Rent (or charge) credited to the landlord. */
  net: number
  /** Surcharge the tenant paid on top, to the processor — not a deduction. */
  tenantFee: number
  /** What left the tenant's account: net + tenantFee. */
  chargedToTenant: number
  /** Late fee this row genuinely accrued, derived from the rule. */
  lateFee: number
  method: SettleMethod | null
}

export type OpenCharge = {
  id: string
  label: string
  category: string
  categoryLabel: string
  amount: number
  dueDate: string
  overdue: boolean
  who: string | null
}

export type LeaseSummary = {
  planId: string
  leaseId: string | null
  /** The payment plan's own name — usually the lease's shorthand. */
  name: string
  propertyId: string
  propertyName: string
  propertySlug: string | null
  termStart: string | null
  termEnd: string | null
  stage: LeaseStage
  /** How far through the contracted term we are, 0–100. `null` without dates. */
  termProgress: number | null
  dueDay: number
  /** Combined monthly obligation of the active payers. */
  monthly: number
  payers: PayerSummary[]
  activePayers: number

  /** Rent within the selected scope. */
  rent: Totals
  /** Deposits and one-off charges within the selected scope. */
  charges: Totals
  /** Rent + charges — the line a landlord reads first. */
  total: Totals
  /** How the money that did arrive was paid, within the scope. */
  methods: MethodSlice[]

  /** Every scheduled rent payment across the whole term, ignoring scope. */
  contractValue: number
  /** Collected against the whole term — how much of this lease has been paid. */
  contractCollected: number
  /** Security deposits received and not yet returned. */
  depositsHeld: number
  /**
   * Late fees genuinely accrued across the lease, derived from the rule — see
   * `lateFeeDue`. Not the `late_fees_applied` column, which is corrupt.
   */
  lateFeesDue: number
  /** What the database currently *claims*, for comparison only. */
  lateFeesRecorded: number
  /** Set when the late-fee rule would accrue without limit. */
  lateFeeRisk: string | null
  /** Every payment that arrived, newest first — with net, fee and timestamp. */
  settled: SettledPayment[]
  /** The subset that arrived after its due date. */
  settledLate: SettledPayment[]
  /** Open deposits and one-off charges — these do not expire with the scope. */
  openCharges: OpenCharge[]

  nextDue: { date: string; amount: number } | null
  lastPaid: { date: string; amount: number } | null
  /** How hard this lease is asking to be looked at. Higher sorts first. */
  urgency: number
  health: 'overdue' | 'due' | 'current' | 'idle'
}

/** A lease is "ending" once it is inside its last two months — the window where
 *  a manager starts chasing renewal, deposit return and a move-out inspection. */
const ENDING_SOON_DAYS = 60

function stageOf(start: string | null, end: string | null, today: string): LeaseStage {
  if (!start || !end) return 'unknown'
  if (today < start) return 'upcoming'
  if (today > end) return 'ended'
  const left = (new Date(end + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86_400_000
  return left <= ENDING_SOON_DAYS ? 'ending' : 'active'
}

export const catLabel = (c: string) =>
  SPECIAL_CATEGORIES.find(s => s.value === c)?.label ?? 'Charge'

export function summarizeLease(plan: PaymentPlan, scope: Scope, now = new Date()): LeaseSummary {
  const range = scopeRange(scope, now)
  const todayStr = iso(now)
  const sps = plan.scheduled_payments ?? []
  const specials = plan.special_payments ?? []

  const rent = rentTotals(sps, range, now)
  const charges = chargeTotals(specials, range, now)
  const total = sumTotals([rent, charges])
  const methods = methodMix(sps, specials, range)
  const contract = rentTotals(sps, ALL_TIME, now)

  const termStart = plan.lease?.start_date ?? null
  const termEnd = plan.lease?.end_date ?? null
  let termProgress: number | null = null
  if (termStart && termEnd) {
    const a = new Date(termStart + 'T00:00:00').getTime()
    const b = new Date(termEnd + 'T00:00:00').getTime()
    const t = new Date(todayStr + 'T00:00:00').getTime()
    termProgress = b > a ? Math.max(0, Math.min(100, Math.round(((t - a) / (b - a)) * 100))) : null
  }

  // Per-payer rent, so a shared lease can be read person by person without
  // opening it. Share is of *billed* rent, not of the monthly figure: someone
  // who joined halfway through owes less of the window than their rent implies.
  const payers: PayerSummary[] = plan.tenants.map(t => {
    const mine = rentTotals(sps.filter(sp => sp.plan_tenant_id === t.id), range, now)
    return {
      id: t.id,
      name: t.name,
      email: t.email ?? null,
      status: t.status,
      monthly: t.monthly_total,
      rent: mine,
      share: rent.billed > 0 ? Math.round((mine.billed / rent.billed) * 100) : null,
    }
  }).sort((a, b) =>
    b.rent.overdue - a.rent.overdue ||
    Number(a.status !== 'active') - Number(b.status !== 'active') ||
    b.monthly - a.monthly
  )

  const depositsHeld = specials
    .filter(sp => sp.category === 'security_deposit' && sp.status === 'paid')
    .reduce((s, sp) => s + sp.amount, 0)

  const rule = plan.late_fee_rule ?? null
  // Derived from the rule, never read from the corrupt column — see lateFeeDue.
  const lateFeesDue = sps.reduce((s, sp) => s + lateFeeDue(rule, sp, now), 0)
  const lateFeesRecorded = sps.reduce((s, sp) => s + (sp.late_fees_applied ?? 0), 0)

  // Everything that actually arrived, newest first, with the net/fee split and
  // whatever timestamp precision the row has.
  const rentByTenant = new Map(plan.tenants.map(t => [t.id, t.name]))
  const settled: SettledPayment[] = [
    ...sps
      .filter(sp => liveRent(sp) && sp.paid_amount > 0 && sp.paid_date)
      .map((sp): SettledPayment => {
        const fee = sp.processing_fee ?? 0
        return {
          id: sp.id, kind: 'rent',
          label: new Date(sp.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) + ' rent',
          who: rentByTenant.get(sp.plan_tenant_id) ?? null,
          dueDate: sp.due_date,
          paidDate: sp.paid_date as string,
          settledAt: sp.settled_at ?? null,
          daysLate: Math.max(0, daysBetweenDates(sp.due_date, sp.paid_date as string)),
          net: sp.paid_amount,
          tenantFee: fee,
          chargedToTenant: Math.round((sp.paid_amount + fee) * 100) / 100,
          lateFee: lateFeeDue(rule, sp, now),
          method: (sp.payment_method as SettleMethod | null) ?? null,
        }
      }),
    ...specials
      .filter(sp => sp.status === 'paid' && sp.paid_date)
      .map((sp): SettledPayment => {
        const fee = sp.processing_fee ?? 0
        return {
          id: sp.id, kind: 'charge',
          label: sp.label,
          who: sp.tenant?.name ?? null,
          dueDate: sp.due_date,
          paidDate: sp.paid_date as string,
          settledAt: sp.settled_at ?? null,
          daysLate: Math.max(0, daysBetweenDates(sp.due_date, sp.paid_date as string)),
          net: sp.amount,
          tenantFee: fee,
          chargedToTenant: Math.round((sp.amount + fee) * 100) / 100,
          lateFee: 0,
          method: (sp.payment_method as SettleMethod | null) ?? null,
        }
      }),
  ].sort((a, b) => b.paidDate.localeCompare(a.paidDate) || b.daysLate - a.daysLate)
  const settledLate = settled.filter(p => p.daysLate > 0)

  const openCharges: OpenCharge[] = specials
    .filter(sp => sp.status === 'pending')
    .map(sp => ({
      id: sp.id,
      label: sp.label,
      category: sp.category,
      categoryLabel: catLabel(sp.category),
      amount: sp.amount,
      dueDate: sp.due_date,
      overdue: sp.due_date < todayStr,
      who: sp.tenant?.name ?? null,
    }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))

  // The next thing that will be asked for, and everything landing with it.
  const upcoming = sps
    .filter(sp => liveRent(sp) && sp.due_date >= todayStr && sp.paid_amount < sp.amount)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
  const nextDue = upcoming.length > 0
    ? {
        date: upcoming[0].due_date,
        amount: upcoming
          .filter(sp => sp.due_date === upcoming[0].due_date)
          .reduce((s, sp) => s + (sp.amount - sp.paid_amount), 0),
      }
    : null

  const paidRows = sps
    .filter(sp => sp.paid_date && sp.paid_amount > 0)
    .sort((a, b) => (b.paid_date ?? '').localeCompare(a.paid_date ?? ''))
  const lastPaid = paidRows.length > 0
    ? { date: paidRows[0].paid_date as string, amount: paidRows[0].paid_amount }
    : null

  const health: LeaseSummary['health'] =
    total.overdue > 0 ? 'overdue'
    : total.outstanding > 0 ? 'due'
    : total.billed > 0 ? 'current'
    : 'idle'

  // Money overdue dominates; the count of late charges and the remaining
  // balance break ties, so two leases owing the same are ranked by how many
  // separate conversations that debt represents.
  const urgency = total.overdue * 1000 + total.overdueCount * 100 + total.outstanding

  return {
    planId: plan.id,
    leaseId: plan.lease_id ?? null,
    name: plan.name,
    propertyId: plan.property?.id ?? plan.property_id,
    propertyName: plan.property?.name ?? plan.name,
    propertySlug: plan.property?.slug ?? null,
    termStart, termEnd,
    stage: stageOf(termStart, termEnd, todayStr),
    termProgress,
    dueDay: plan.due_day,
    monthly: plan.tenants.filter(t => t.status === 'active').reduce((s, t) => s + t.monthly_total, 0),
    payers,
    activePayers: plan.tenants.filter(t => t.status === 'active').length,
    rent, charges, total, methods,
    contractValue: contract.billed,
    contractCollected: contract.collected,
    depositsHeld,
    lateFeesDue,
    lateFeesRecorded,
    lateFeeRisk: lateFeeRuleRisk(rule),
    settled,
    settledLate,
    openCharges,
    nextDue, lastPaid,
    urgency,
    health,
  }
}

// ─── PROPERTY ────────────────────────────────────────────────────────────────

/** One building and every lease running against it. This is the level the page
 *  groups on: a landlord thinks in addresses, not in payment plans. */
export type PropertyGroup = {
  propertyId: string
  propertyName: string
  propertySlug: string | null
  leases: LeaseSummary[]
  rent: Totals
  charges: Totals
  total: Totals
  methods: MethodSlice[]
  monthly: number
  depositsHeld: number
  activeLeases: number
  urgency: number
}

export function groupByProperty(leases: LeaseSummary[]): PropertyGroup[] {
  const map = new Map<string, LeaseSummary[]>()
  for (const l of leases) {
    const arr = map.get(l.propertyId)
    if (arr) arr.push(l)
    else map.set(l.propertyId, [l])
  }

  const groups: PropertyGroup[] = []
  for (const [propertyId, ls] of map) {
    // Inside a property: whatever needs chasing first, then live leases before
    // finished ones, then most recent term first.
    const sorted = ls.slice().sort((a, b) =>
      b.urgency - a.urgency ||
      Number(a.stage === 'ended') - Number(b.stage === 'ended') ||
      (b.termStart ?? '').localeCompare(a.termStart ?? '')
    )
    groups.push({
      propertyId,
      propertyName: sorted[0].propertyName,
      propertySlug: sorted[0].propertySlug,
      leases: sorted,
      rent:    sumTotals(sorted.map(l => l.rent)),
      charges: sumTotals(sorted.map(l => l.charges)),
      total:   sumTotals(sorted.map(l => l.total)),
      methods: sumMethodMix(sorted.map(l => l.methods)),
      monthly: sorted.reduce((s, l) => s + l.monthly, 0),
      depositsHeld: sorted.reduce((s, l) => s + l.depositsHeld, 0),
      activeLeases: sorted.filter(l => l.stage === 'active' || l.stage === 'ending').length,
      urgency: sorted.reduce((s, l) => s + l.urgency, 0),
    })
  }

  return groups.sort((a, b) =>
    b.urgency - a.urgency ||
    b.total.billed - a.total.billed ||
    a.propertyName.localeCompare(b.propertyName)
  )
}

// ─── PORTFOLIO ───────────────────────────────────────────────────────────────

export type Portfolio = {
  scope: Scope
  groups: PropertyGroup[]
  leases: LeaseSummary[]
  rent: Totals
  charges: Totals
  total: Totals
  /** How the collected money arrived, across the whole portfolio. */
  methods: MethodSlice[]
  /** Rent contracted every month across every active lease. */
  monthly: number
  depositsHeld: number
  lateFeesDue: number
  propertyCount: number
  leaseCount: number
  activeLeaseCount: number
}

export function buildPortfolio(plans: PaymentPlan[], scope: Scope, now = new Date()): Portfolio {
  const leases = plans.map(p => summarizeLease(p, scope, now))
  const groups = groupByProperty(leases)
  return {
    scope,
    groups,
    leases,
    rent:    sumTotals(leases.map(l => l.rent)),
    charges: sumTotals(leases.map(l => l.charges)),
    total:   sumTotals(leases.map(l => l.total)),
    methods: sumMethodMix(leases.map(l => l.methods)),
    monthly: leases.reduce((s, l) => s + l.monthly, 0),
    depositsHeld: leases.reduce((s, l) => s + l.depositsHeld, 0),
    lateFeesDue: leases.reduce((s, l) => s + l.lateFeesDue, 0),
    propertyCount: groups.length,
    leaseCount: leases.length,
    activeLeaseCount: leases.filter(l => l.stage === 'active' || l.stage === 'ending').length,
  }
}

// ─── TREND ───────────────────────────────────────────────────────────────────

export type MonthPoint = {
  key: string
  label: string
  year: number
  billed: number
  collected: number
  rate: number | null
}

/** Collected-vs-billed by month, oldest first — the line that says whether
 *  things are slipping. Pass a filtered `plans` to scope it to one property. */
export function monthlyTrend(plans: PaymentPlan[], months: number, now = new Date()): MonthPoint[] {
  const sps = plans.flatMap(p => (p.scheduled_payments ?? []).filter(liveRent))
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    let billed = 0, collected = 0
    for (const sp of sps) {
      if (sp.due_date.slice(0, 7) !== key) continue
      billed += sp.amount
      collected += sp.paid_amount
    }
    return {
      key,
      label: d.toLocaleDateString('en-US', { month: 'short' }),
      year: d.getFullYear(),
      billed, collected,
      rate: billed > 0 ? Math.round((collected / billed) * 100) : null,
    }
  })
}

// ─── ACTION QUEUE ────────────────────────────────────────────────────────────

/** One thing a landlord should act on, anywhere in the portfolio. Ordered by
 *  how late it is and then by money, because that is the order they get chased. */
export type ActionItem = {
  id: string
  planId: string
  leaseId: string | null
  kind: 'rent' | 'charge'
  severity: 'overdue' | 'due'
  title: string
  propertyName: string
  leaseName: string
  who: string | null
  amount: number
  dueDate: string
  daysLate: number
}

export function actionQueue(plans: PaymentPlan[], now = new Date()): ActionItem[] {
  const todayStr = iso(now)
  const todayMs = new Date(todayStr + 'T00:00:00').getTime()
  const lateBy = (due: string) =>
    Math.max(0, Math.floor((todayMs - new Date(due + 'T00:00:00').getTime()) / 86_400_000))
  const items: ActionItem[] = []

  for (const plan of plans) {
    const propertyName = plan.property?.name ?? plan.name
    const byTenant = new Map(plan.tenants.map(t => [t.id, t.name]))

    for (const sp of plan.scheduled_payments ?? []) {
      // `processing` is ACH in flight — the money is coming, chasing it is noise.
      if (!liveRent(sp) || sp.status === 'processing') continue
      const short = sp.amount - sp.paid_amount
      // Rent not yet due is not an action; only what is owed today or missed.
      if (short <= 0 || sp.due_date > todayStr) continue
      items.push({
        id: sp.id, planId: plan.id, leaseId: plan.lease_id ?? null, kind: 'rent',
        severity: sp.due_date < todayStr ? 'overdue' : 'due',
        title: `${new Date(sp.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long' })} rent`,
        propertyName, leaseName: plan.name,
        who: byTenant.get(sp.plan_tenant_id) ?? null,
        amount: short, dueDate: sp.due_date, daysLate: lateBy(sp.due_date),
      })
    }

    for (const sp of plan.special_payments ?? []) {
      if (sp.status !== 'pending' || sp.due_date > todayStr) continue
      items.push({
        id: sp.id, planId: plan.id, leaseId: plan.lease_id ?? null, kind: 'charge',
        severity: sp.due_date < todayStr ? 'overdue' : 'due',
        title: sp.label,
        propertyName, leaseName: plan.name,
        who: sp.tenant?.name ?? null,
        amount: sp.amount, dueDate: sp.due_date, daysLate: lateBy(sp.due_date),
      })
    }
  }

  return items.sort((a, b) =>
    Number(b.severity === 'overdue') - Number(a.severity === 'overdue') ||
    b.daysLate - a.daysLate ||
    b.amount - a.amount
  )
}
