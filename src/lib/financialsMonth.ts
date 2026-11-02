/**
 * The month-by-month half of Financials: which month am I looking at, what is
 * coming, and who hasn't paid.
 *
 * `financialsRollup.ts` answers "what is this portfolio worth over a window".
 * That is an accounting question, and it was the only question the page could
 * answer — so a landlord asking the operational one ("who owes me money and
 * when does the next rent land") had to infer it from totals. These two live
 * apart because they behave differently:
 *
 *   • A **window** total is bound to a period. Change the period and every
 *     figure changes, which is correct for reporting and useless for chasing.
 *   • **Arrears** are bound to nothing. Rent missed in August is still missed in
 *     November, and it does not stop being owed because the lease ended. So
 *     `arrears` deliberately ignores every window: it reads the whole tenancy.
 *
 * Everything here is pure. Give it plans and a date; it returns numbers. The
 * page renders them and owns no arithmetic of its own.
 */
import {
  type PaymentLineItem, type PaymentPlan, type ScheduledPayment, type SpecialPayment,
} from '@/lib/payments'
import {
  iso, inRange, liveRent, stageOf, daysBetweenDates,
  rentTotals, chargeTotals, sumTotals, lateFeeDue, lateFeeCappedByCharge, catLabel,
  billingToday,
  type Range, type Totals, type LeaseStage, type SettleMethod,
} from '@/lib/financialsRollup'

// ─── MONTHS AS ADDRESSES ─────────────────────────────────────────────────────

/**
 * A month a landlord can point at: `'2026-10'`.
 *
 * The page used to have exactly one month — "this month" — and said so in those
 * words. Two things were wrong with that. Reading a figure, you could not tell
 * which month it covered without doing calendar arithmetic in your head; and
 * there was no way to ask about a month that hasn't happened yet, which is
 * precisely the question rent provokes — *what is coming in?*
 *
 * So a month is a value now. Everything below turns one into a label, a date
 * range, or its neighbour.
 */
export type MonthKey = string

export const monthKeyOf = (d: Date): MonthKey =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/** The month a charge falls in. Due dates are already `YYYY-MM-DD`. */
export const monthKeyOfDate = (isoDate: string): MonthKey => isoDate.slice(0, 7)

function monthParts(key: MonthKey): { y: number; m: number } {
  const [y, m] = key.split('-').map(Number)
  return { y, m: m - 1 }
}

/** Inclusive first-to-last-day bounds of one month. */
export function monthRange(key: MonthKey): Range {
  const { y, m } = monthParts(key)
  return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) }
}

/** `'October 2026'` — the whole point. `short` gives `'Oct 2026'`. */
export function monthLabel(key: MonthKey, short = false): string {
  const { y, m } = monthParts(key)
  return new Date(y, m, 1).toLocaleDateString('en-US', {
    month: short ? 'short' : 'long',
    year: 'numeric',
  })
}

export function shiftMonth(key: MonthKey, delta: number): MonthKey {
  const { y, m } = monthParts(key)
  return monthKeyOf(new Date(y, m + delta, 1))
}

/** Whole months from `a` to `b`. Negative when `b` is earlier. */
export function monthsBetween(a: MonthKey, b: MonthKey): number {
  const pa = monthParts(a), pb = monthParts(b)
  return (pb.y - pa.y) * 12 + (pb.m - pa.m)
}

export type MonthPosition = 'past' | 'current' | 'future'

export const monthPosition = (key: MonthKey, now = new Date()): MonthPosition => {
  const here = monthKeyOf(now)
  return key === here ? 'current' : key < here ? 'past' : 'future'
}

// ─── WHICH LEASES ────────────────────────────────────────────────────────────

/**
 * Which tenancies the page is about.
 *
 * `current` is the default, and it is the single biggest reason the page becomes
 * readable: a landlord opening Financials is nearly always asking about rent
 * they can still collect, and every finished lease on screen is a row to look
 * past before reaching it. Ended leases are not deleted — they move behind a
 * toggle, and money still owed on them is surfaced anyway (see `arrears`), so
 * hiding a lease can never hide a debt.
 */
export type LeaseFilter = 'current' | 'upcoming' | 'past' | 'all'

export const LEASE_FILTERS: { id: LeaseFilter; label: string; hint: string }[] = [
  { id: 'current',  label: 'Active',   hint: 'Leases running right now — the rent you can still collect' },
  { id: 'upcoming', label: 'Starting', hint: 'Leases that have not begun yet' },
  { id: 'past',     label: 'Ended',    hint: 'Finished tenancies, including anything still owed on them' },
  { id: 'all',      label: 'All',      hint: 'Every lease, whatever stage it is at' },
]

/** A lease inside its term, including its final two months. */
export const isLiveStage = (s: LeaseStage) => s === 'active' || s === 'ending'

export function planStage(plan: PaymentPlan, now = new Date()): LeaseStage {
  return stageOf(plan.lease?.start_date ?? null, plan.lease?.end_date ?? null, billingToday(now))
}

export function stageMatchesFilter(stage: LeaseStage, filter: LeaseFilter): boolean {
  switch (filter) {
    case 'all':      return true
    case 'current':  return isLiveStage(stage)
    case 'upcoming': return stage === 'upcoming'
    // A lease with no term recorded has no life to be past — but it is not
    // current either, so it sits with the ended ones rather than vanishing.
    case 'past':     return stage === 'ended' || stage === 'unknown'
  }
}

export function filterPlans(plans: PaymentPlan[], filter: LeaseFilter, now = new Date()): PaymentPlan[] {
  return plans.filter(p => stageMatchesFilter(planStage(p, now), filter))
}

/** How many leases sit behind each toggle, so the control can say so. */
export function stageCounts(plans: PaymentPlan[], now = new Date()): Record<LeaseFilter, number> {
  const stages = plans.map(p => planStage(p, now))
  return {
    current:  stages.filter(isLiveStage).length,
    upcoming: stages.filter(s => s === 'upcoming').length,
    past:     stages.filter(s => s === 'ended' || s === 'unknown').length,
    all:      stages.length,
  }
}

// ─── ONE CHARGE, AS A LANDLORD READS IT ──────────────────────────────────────

/**
 * What has happened to a single charge.
 *
 * `scheduled_payments.status` cannot answer this on its own: it says `pending`
 * both for rent due in eight months and for rent missed in August, which are
 * opposite situations. The state below is derived from the money and the
 * calendar together, which is the only way "overdue" and "scheduled" come out
 * as different things.
 */
export type ChargeState =
  | 'paid'       // settled in full
  | 'part'       // some money arrived, a shortfall remains, not yet late
  | 'clearing'   // ACH in flight — paid by the tenant, not yet landed
  | 'overdue'    // past its due date with money still owed
  | 'due'        // due today
  | 'scheduled'  // not due yet

export const CHARGE_STATE_META: Record<ChargeState, { label: string; tone: 'good' | 'bad' | 'warn' | 'info' | 'quiet' }> = {
  paid:      { label: 'Paid',      tone: 'good' },
  part:      { label: 'Part paid', tone: 'warn' },
  clearing:  { label: 'Clearing',  tone: 'info' },
  overdue:   { label: 'Overdue',   tone: 'bad' },
  due:       { label: 'Due today', tone: 'warn' },
  scheduled: { label: 'Scheduled', tone: 'quiet' },
}

/**
 * One line of what a charge is made of.
 *
 * A rent charge is almost never just rent: it is rent plus the utilities riding
 * on the payer's line items. Summing them into one figure is what made the old
 * page impossible to argue with a tenant about — "$1,450" answers nothing when
 * the tenant asks which part is the water bill.
 */
export type ChargeLine = {
  label: string
  amount: number
  kind: 'rent' | 'utility' | 'fee' | 'other'
}

/** One payment that actually arrived against a charge. */
export type ChargeSettlement = {
  /** Rent (or charge) credited to the landlord. */
  net: number
  /** Late-fee money received on top. */
  lateFee: number
  paidDate: string | null
  settledAt: string | null
  /**
   * When the tenant *sent* it — the Stripe intent's own creation time.
   *
   * Distinct from `settledAt` by days on every ACH debit, which is the whole
   * reason a late fee is judged on this and not on the date the money landed
   * (see `lateFeeAsOf`). The payments log shows both, because the gap between
   * them is the bank's, not the tenant's.
   */
  submittedAt: string | null
  method: SettleMethod | null
  /** Days between the due date and the money landing. Negative = paid early. */
  daysLate: number | null
  recordedBy: 'tenant' | 'landlord' | null
  /**
   * The Stripe payment this money arrived on, when it arrived online.
   *
   * Carried so a log can say "these three months were one payment" — a tenant
   * who clears an arrears in a single press should not read as three unrelated
   * events the landlord has to reconcile by eye.
   */
  intentId: string | null
}

/** Chases sent about a charge — rent and its late fee counted separately. */
export type ChargeChases = {
  count: number
  lastAt: string | null
  feeCount: number
  feeLastAt: string | null
}

/** One rent charge or one-off charge, flattened with everything needed to show it. */
export type Charge = {
  id: string
  kind: 'rent' | 'charge'
  planId: string
  leaseId: string | null
  propertyName: string
  leaseName: string
  stage: LeaseStage
  /** The payer. Null on a charge raised against the lease rather than a person. */
  who: string | null
  whoEmail: string | null
  payerId: string | null
  label: string
  dueDate: string
  /** What was asked for. */
  amount: number
  /** What arrived against it. */
  paid: number
  /** Still owed on it. Never negative — overpaying one charge is not a credit. */
  outstanding: number
  state: ChargeState
  /** Days past due, for a charge still owed. 0 for anything settled or future. */
  daysLate: number
  /** Late fee this charge has genuinely accrued and not yet paid off. */
  lateFee: number
  /** Late-fee money that genuinely arrived against this charge. */
  lateFeePaid: number
  /**
   * What is actually owed on this charge today: the shortfall **plus** the late
   * fee it has accrued.
   *
   * The page used to show `outstanding` and mention fees separately, which
   * meant no figure anywhere was the number a landlord would put in front of a
   * tenant. A fee the rule has assessed is money owed, so it belongs in the
   * total — and every "due" figure above a charge sums this, not `outstanding`.
   */
  totalDue: number
  /** What the charge is made of. Empty when we only know the single amount. */
  lines: ChargeLine[]
  /** The late-fee rule in words, so the fee can be explained, not just shown. */
  feeRule: string | null
  /** True when an uncapped rule was held down to the size of the charge. */
  feeCapped: boolean
  /** The money that arrived, if any. */
  settlement: ChargeSettlement | null
  chases: ChargeChases
  /** Category, for a one-off charge. Null on rent. */
  categoryLabel: string | null
  notes: string | null
}

function rentState(sp: ScheduledPayment, todayStr: string): ChargeState {
  if (sp.status === 'processing') return 'clearing'
  const short = sp.amount - sp.paid_amount
  if (short <= 0) return 'paid'
  if (sp.due_date < todayStr) return 'overdue'
  if (sp.due_date === todayStr) return 'due'
  return sp.paid_amount > 0 ? 'part' : 'scheduled'
}

function chargeState(sp: SpecialPayment, todayStr: string): ChargeState {
  if (sp.status === 'paid') return 'paid'
  if (sp.status === 'processing') return 'clearing'
  if (sp.due_date < todayStr) return 'overdue'
  if (sp.due_date === todayStr) return 'due'
  return 'scheduled'
}

/**
 * Every live charge on these plans, flattened.
 *
 * Voided rent and waived charges are dropped here rather than filtered by each
 * caller: they were cancelled, so they are not money, and a single omission
 * downstream would quietly inflate what a tenant appears to owe.
 */
/** The late-fee rule in one sentence, so a fee on screen can be explained. */
function feeRuleText(rule: PaymentPlan['late_fee_rule']): string | null {
  if (!rule || rule.fee_amount <= 0) return null
  const every = rule.frequency_days === 1 ? 'day' : `${rule.frequency_days} days`
  const grace = rule.grace_period_days > 0
    ? `${rule.grace_period_days} day${rule.grace_period_days !== 1 ? 's' : ''} after the due date`
    : 'the due date'
  const cap = rule.max_total_fees != null
    ? `, up to ${money(rule.max_total_fees)}`
    : ', capped at the size of the charge'
  return `${money(rule.fee_amount)} every ${every} from ${grace}${cap}`
}

const money = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

/** What a rent charge is made of, from the payer's line items.
 *
 *  Rent is billed as the payer's whole monthly obligation, so the utilities
 *  riding on it are invisible in the charge amount. Line items are the only
 *  record of the split, so they are carried onto the charge — and only when
 *  they actually add up to it, because a stale line item set would otherwise
 *  present a breakdown that contradicts the figure above it. */
function rentLines(items: PaymentLineItem[], amount: number): ChargeLine[] {
  if (items.length === 0) return []
  const sum = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100
  if (Math.abs(sum - amount) > 0.01) return []
  return items.map(i => ({
    label: i.label || i.category,
    amount: i.amount,
    kind: i.category === 'rent' ? 'rent' : i.utility_id ? 'utility' : 'other',
  }))
}

const settleMethod = (m: string | null): SettleMethod | null =>
  m === 'card' || m === 'ach' || m === 'manual_zelle' || m === 'manual_other' ? m : null

export function allCharges(plans: PaymentPlan[], now = new Date()): Charge[] {
  const todayStr = billingToday(now)
  const out: Charge[] = []

  for (const plan of plans) {
    const propertyName = plan.property?.name ?? plan.name
    const stage = planStage(plan, now)
    const rule = plan.late_fee_rule ?? null
    const payers = new Map(plan.tenants.map(t => [t.id, t]))

    for (const sp of plan.scheduled_payments ?? []) {
      if (!liveRent(sp)) continue
      const payer = payers.get(sp.plan_tenant_id)
      const state = rentState(sp, todayStr)
      const outstanding = Math.max(0, sp.amount - sp.paid_amount)
      // Derived from the rule, never read from `late_fees_applied` — that
      // column is corrupt and has held fees on rent that was paid early. Fee
      // money that already arrived is netted off: `lateFeeDue` reports what
      // the rule *assessed*, and a tenant who has paid part of their fee does
      // not still owe that part.
      const lateFee = Math.max(
        0, Math.round((lateFeeDue(rule, sp, now) - (sp.late_fee_paid ?? 0)) * 100) / 100,
      )
      out.push({
        id: sp.id,
        kind: 'rent',
        planId: plan.id,
        leaseId: plan.lease_id ?? null,
        propertyName,
        leaseName: plan.name,
        stage,
        who: payer?.name ?? null,
        whoEmail: payer?.email ?? null,
        payerId: sp.plan_tenant_id ?? null,
        label: `${monthLabel(monthKeyOfDate(sp.due_date))} rent`,
        dueDate: sp.due_date,
        amount: sp.amount,
        paid: sp.paid_amount,
        outstanding,
        state,
        daysLate: state === 'overdue' ? Math.max(0, daysBetweenDates(sp.due_date, todayStr)) : 0,
        lateFee,
        lateFeePaid: sp.late_fee_paid ?? 0,
        totalDue: Math.round((outstanding + lateFee) * 100) / 100,
        lines: rentLines(payer?.line_items ?? [], sp.amount),
        feeRule: feeRuleText(rule),
        feeCapped: lateFeeCappedByCharge(rule, sp, now),
        settlement: sp.paid_amount > 0 || sp.status === 'processing' ? {
          net: sp.paid_amount,
          lateFee: sp.late_fee_paid ?? 0,
          paidDate: sp.paid_date,
          settledAt: sp.settled_at,
          submittedAt: sp.submitted_at ?? null,
          method: settleMethod(sp.payment_method),
          daysLate: sp.paid_date ? daysBetweenDates(sp.due_date, sp.paid_date) : null,
          recordedBy: sp.recorded_by,
          intentId: sp.stripe_payment_intent_id ?? null,
        } : null,
        chases: {
          count: sp.reminder_count ?? 0,
          lastAt: sp.reminder_sent_at,
          feeCount: sp.late_fee_reminder_count ?? 0,
          feeLastAt: sp.late_fee_reminder_sent_at,
        },
        categoryLabel: null,
        notes: sp.notes,
      })
    }

    for (const sp of plan.special_payments ?? []) {
      if (sp.status === 'waived') continue
      const state = chargeState(sp, todayStr)
      out.push({
        id: sp.id,
        kind: 'charge',
        planId: plan.id,
        leaseId: plan.lease_id ?? null,
        propertyName,
        leaseName: plan.name,
        stage,
        who: sp.tenant?.name ?? null,
        whoEmail: null,
        payerId: sp.plan_tenant_id ?? null,
        label: `${sp.label} · ${catLabel(sp.category)}`,
        dueDate: sp.due_date,
        amount: sp.amount,
        paid: sp.status === 'paid' ? sp.amount : 0,
        outstanding: sp.status === 'paid' ? 0 : sp.amount,
        state,
        daysLate: state === 'overdue' ? Math.max(0, daysBetweenDates(sp.due_date, todayStr)) : 0,
        // A late-fee rule is written against rent, not against a one-off.
        lateFee: 0,
        lateFeePaid: 0,
        totalDue: sp.status === 'paid' ? 0 : sp.amount,
        lines: [],
        feeRule: null,
        feeCapped: false,
        settlement: sp.status === 'paid' || sp.status === 'processing' ? {
          net: sp.status === 'paid' ? sp.amount : 0,
          lateFee: 0,
          paidDate: sp.paid_date,
          settledAt: sp.settled_at,
          submittedAt: sp.submitted_at ?? null,
          method: settleMethod(sp.payment_method),
          daysLate: sp.paid_date ? daysBetweenDates(sp.due_date, sp.paid_date) : null,
          recordedBy: null,
          intentId: sp.stripe_payment_intent_id ?? null,
        } : null,
        chases: {
          count: sp.reminder_count ?? 0,
          lastAt: sp.reminder_sent_at,
          feeCount: 0,
          feeLastAt: null,
        },
        categoryLabel: catLabel(sp.category),
        notes: sp.notes,
      })
    }
  }

  return out
}

// ─── ONE MONTH ───────────────────────────────────────────────────────────────

/** What one payer owes, or has paid, inside one month. */
export type MonthPayer = {
  payerId: string | null
  name: string
  email: string | null
  charges: Charge[]
  billed: number
  paid: number
  outstanding: number
  /** Late fees accrued and unpaid on these charges. */
  lateFees: number
  /** outstanding + lateFees — what this person actually owes for the month. */
  totalDue: number
  /** The worst state among their charges — what the row should be coloured by. */
  state: ChargeState
}

/** One lease's slice of a month, so a month reads lease by lease. */
export type MonthLease = {
  planId: string
  leaseId: string | null
  leaseName: string
  propertyName: string
  stage: LeaseStage
  dueDay: number
  payers: MonthPayer[]
  charges: Charge[]
  billed: number
  paid: number
  outstanding: number
  lateFees: number
  /** outstanding + lateFees. */
  totalDue: number
}

export type MonthView = {
  key: MonthKey
  label: string
  position: MonthPosition
  /** Rent + charges due in this month. */
  totals: Totals
  rent: Totals
  charges: Totals
  /**
   * Late fees accrued and unpaid on this month's charges.
   *
   * `Totals` deliberately knows nothing about fees — a collection rate has to
   * stay rent against rent. But "still due" is a different question, and a fee
   * the rule has assessed is part of its answer, so it is carried alongside and
   * added into `totalDue` / `overdueDue` below.
   */
  feesDue: number
  /** Outstanding rent and charges **plus** the fees on them. */
  totalDue: number
  /** The overdue slice, fees included — the figure worth chasing. */
  overdueDue: number
  leases: MonthLease[]
  /** Everything due in the month, soonest first. */
  rows: Charge[]
  /** Nothing scheduled at all in this month. */
  empty: boolean
}

/** The worst of a set of states — a payer who paid two charges and missed one
 *  has missed one, and the row must say so rather than averaging to "fine". */
const round2 = (n: number) => Math.round(n * 100) / 100

const WORST_FIRST: ChargeState[] = ['overdue', 'due', 'part', 'clearing', 'scheduled', 'paid']
const worstState = (states: ChargeState[]): ChargeState =>
  WORST_FIRST.find(s => states.includes(s)) ?? 'paid'

/**
 * Everything due in one named month, grouped lease → payer.
 *
 * Works identically for a month that has passed, the current one, and one eight
 * months out — which is what makes a future month readable at all. The states
 * simply come out different: a future month is all `scheduled`.
 */
export function monthView(plans: PaymentPlan[], key: MonthKey, now = new Date()): MonthView {
  const range = monthRange(key)
  const rows = allCharges(plans, now)
    .filter(c => inRange(c.dueDate, range))
    .sort((a, b) =>
      a.dueDate.localeCompare(b.dueDate) ||
      b.totalDue - a.totalDue ||
      (a.who ?? '').localeCompare(b.who ?? '')
    )

  const rent = rentTotals(
    plans.flatMap(p => p.scheduled_payments ?? []), range, now
  )
  const charges = chargeTotals(
    plans.flatMap(p => p.special_payments ?? []), range, now
  )

  // Group by lease, then by payer inside it.
  const byPlan = new Map<string, Charge[]>()
  for (const c of rows) {
    const arr = byPlan.get(c.planId)
    if (arr) arr.push(c)
    else byPlan.set(c.planId, [c])
  }

  const leases: MonthLease[] = []
  for (const [planId, cs] of byPlan) {
    const plan = plans.find(p => p.id === planId)
    const byPayer = new Map<string, Charge[]>()
    for (const c of cs) {
      const k = c.payerId ?? `lease:${planId}`
      const arr = byPayer.get(k)
      if (arr) arr.push(c)
      else byPayer.set(k, [c])
    }

    const payers: MonthPayer[] = [...byPayer.entries()].map(([k, pcs]) => ({
      payerId: k.startsWith('lease:') ? null : k,
      name: pcs[0].who ?? 'The lease',
      email: pcs[0].whoEmail,
      charges: pcs.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      billed: pcs.reduce((s, c) => s + c.amount, 0),
      paid: pcs.reduce((s, c) => s + c.paid, 0),
      outstanding: pcs.reduce((s, c) => s + c.outstanding, 0),
      lateFees: round2(pcs.reduce((s, c) => s + c.lateFee, 0)),
      totalDue: round2(pcs.reduce((s, c) => s + c.totalDue, 0)),
      state: worstState(pcs.map(c => c.state)),
    })).sort((a, b) =>
      b.totalDue - a.totalDue || a.name.localeCompare(b.name)
    )

    leases.push({
      planId,
      leaseId: cs[0].leaseId,
      leaseName: cs[0].leaseName,
      propertyName: cs[0].propertyName,
      stage: cs[0].stage,
      dueDay: plan?.due_day ?? 1,
      payers,
      charges: cs,
      billed: cs.reduce((s, c) => s + c.amount, 0),
      paid: cs.reduce((s, c) => s + c.paid, 0),
      outstanding: cs.reduce((s, c) => s + c.outstanding, 0),
      lateFees: round2(cs.reduce((s, c) => s + c.lateFee, 0)),
      totalDue: round2(cs.reduce((s, c) => s + c.totalDue, 0)),
    })
  }

  leases.sort((a, b) =>
    b.totalDue - a.totalDue ||
    a.propertyName.localeCompare(b.propertyName) ||
    a.leaseName.localeCompare(b.leaseName)
  )

  const totals = sumTotals([rent, charges])
  const feesDue = round2(rows.reduce((s, c) => s + c.lateFee, 0))
  const overdueFees = round2(
    rows.filter(c => c.state === 'overdue').reduce((s, c) => s + c.lateFee, 0),
  )

  return {
    key,
    label: monthLabel(key),
    position: monthPosition(key, now),
    totals,
    rent,
    charges,
    feesDue,
    totalDue: round2(totals.outstanding + feesDue),
    overdueDue: round2(totals.overdue + overdueFees),
    leases,
    rows,
    empty: rows.length === 0,
  }
}

// ─── WHAT IS COMING ──────────────────────────────────────────────────────────

/** One month in the look-ahead strip. */
export type UpcomingMonth = {
  key: MonthKey
  label: string
  shortLabel: string
  position: MonthPosition
  billed: number
  paid: number
  /**
   * Still to come in for that month, **including** late fees accrued on it.
   *
   * A landlord reading the strip is asking how much money is still outstanding
   * against that month; a fee the rule has assessed is part of that, and
   * leaving it out made the strip disagree with every other figure on the page.
   */
  expected: number
  /** The fee slice of `expected`, so it can be named rather than buried. */
  feesDue: number
  count: number
  /** How many of those charges are already past their due date. */
  overdueCount: number
}

/**
 * The next `count` months starting at `from`, as a strip the landlord can scan
 * and click.
 *
 * Rent is contracted months in advance, so this is knowable and the old page
 * simply never said it. Note `expected` is not "billed": a tenant who pays
 * November early makes November's expectation smaller, and that is exactly what
 * a landlord wants to see.
 */
export function upcomingMonths(
  plans: PaymentPlan[],
  from: MonthKey,
  count: number,
  now = new Date(),
): UpcomingMonth[] {
  const charges = allCharges(plans, now)
  return Array.from({ length: count }, (_, i) => {
    const key = shiftMonth(from, i)
    const range = monthRange(key)
    const mine = charges.filter(c => inRange(c.dueDate, range))
    return {
      key,
      label: monthLabel(key),
      shortLabel: monthLabel(key, true),
      position: monthPosition(key, now),
      billed: mine.reduce((s, c) => s + c.amount, 0),
      paid: mine.reduce((s, c) => s + c.paid, 0),
      expected: round2(mine.reduce((s, c) => s + c.totalDue, 0)),
      feesDue: round2(mine.reduce((s, c) => s + c.lateFee, 0)),
      count: mine.length,
      overdueCount: mine.filter(c => c.state === 'overdue').length,
    }
  })
}

/** Rent landing in the next `days` days — the "what's about to arrive" figure. */
export function dueWithin(plans: PaymentPlan[], days: number, now = new Date()): { amount: number; count: number } {
  const todayStr = billingToday(now)
  const until = iso(new Date(now.getTime() + days * 86_400_000))
  const rows = allCharges(plans, now).filter(c =>
    c.outstanding > 0 && c.dueDate >= todayStr && c.dueDate <= until
  )
  return {
    // Charges in this window are not yet due, so no fee can have accrued —
    // `totalDue` is used anyway so the figure stays the same shape as every
    // other "due" figure on the page, whatever the rule does later.
    amount: round2(rows.reduce((s, c) => s + c.totalDue, 0)),
    count: rows.length,
  }
}

// ─── WHO OWES, ACROSS THE WHOLE LEASE ────────────────────────────────────────

/**
 * Arrears: everything still owed, by person, over the entire tenancy.
 *
 * This is the part of the page that must not be bound to a month. Rent missed
 * in August is still missed in November; asking "who owes me money" through a
 * one-month window answers a different question and answers it misleadingly —
 * the old page's overdue figure moved every time the landlord changed the
 * reporting period, as though a debt could expire.
 *
 * ACH in flight is excluded on purpose: the tenant has paid and the transfer is
 * clearing, so chasing them would be chasing their own money. It appears as
 * `clearing` in the month view instead.
 */
export type ArrearsPayer = {
  key: string
  payerId: string | null
  name: string
  email: string | null
  payerStatus: 'active' | 'terminated' | 'completed' | null
  planId: string
  leaseId: string | null
  propertyName: string
  leaseName: string
  stage: LeaseStage
  charges: Charge[]
  /** Rent and charges owed, before late fees. */
  shortfall: number
  /** Late fees genuinely accrued on those charges. */
  lateFees: number
  /** shortfall + lateFees — what to put in front of the tenant. */
  total: number
  oldestDue: string
  maxDaysLate: number
}

export type Arrears = {
  payers: ArrearsPayer[]
  shortfall: number
  lateFees: number
  total: number
  /** How many separate charges are behind. */
  chargeCount: number
  payerCount: number
  /** Worst lateness anywhere in the set, in days. */
  maxDaysLate: number
}

export const EMPTY_ARREARS: Arrears = {
  payers: [], shortfall: 0, lateFees: 0, total: 0,
  chargeCount: 0, payerCount: 0, maxDaysLate: 0,
}

export function arrears(plans: PaymentPlan[], now = new Date()): Arrears {
  const late = allCharges(plans, now).filter(c => c.state === 'overdue')
  if (late.length === 0) return EMPTY_ARREARS

  // Payer status is only on the plan, so look it up once per plan.
  const statusOf = new Map<string, 'active' | 'terminated' | 'completed'>()
  for (const p of plans) for (const t of p.tenants) statusOf.set(t.id, t.status)

  const byPayer = new Map<string, Charge[]>()
  for (const c of late) {
    // Keyed per plan as well as per person: the same name on two leases is two
    // conversations, and merging them would hide which tenancy is behind.
    const k = `${c.planId}:${c.payerId ?? 'lease'}`
    const arr = byPayer.get(k)
    if (arr) arr.push(c)
    else byPayer.set(k, [c])
  }

  const payers: ArrearsPayer[] = [...byPayer.entries()].map(([key, cs]) => {
    const shortfall = cs.reduce((s, c) => s + c.outstanding, 0)
    const lateFees = cs.reduce((s, c) => s + c.lateFee, 0)
    return {
      key,
      payerId: cs[0].payerId,
      name: cs[0].who ?? 'The lease',
      email: cs[0].whoEmail,
      payerStatus: cs[0].payerId ? statusOf.get(cs[0].payerId) ?? null : null,
      planId: cs[0].planId,
      leaseId: cs[0].leaseId,
      propertyName: cs[0].propertyName,
      leaseName: cs[0].leaseName,
      stage: cs[0].stage,
      charges: cs.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      shortfall,
      lateFees,
      total: Math.round((shortfall + lateFees) * 100) / 100,
      oldestDue: cs.reduce((min, c) => (c.dueDate < min ? c.dueDate : min), cs[0].dueDate),
      maxDaysLate: cs.reduce((max, c) => Math.max(max, c.daysLate), 0),
    }
  }).sort((a, b) => b.total - a.total || b.maxDaysLate - a.maxDaysLate)

  return {
    payers,
    shortfall: payers.reduce((s, p) => s + p.shortfall, 0),
    lateFees: payers.reduce((s, p) => s + p.lateFees, 0),
    total: Math.round(payers.reduce((s, p) => s + p.total, 0) * 100) / 100,
    chargeCount: late.length,
    payerCount: payers.length,
    maxDaysLate: payers.reduce((s, p) => Math.max(s, p.maxDaysLate), 0),
  }
}

/**
 * What a landlord can see right now, independent of any window.
 *
 * Four figures that do not move when the reporting period changes, because the
 * things they describe do not: money already missed, money about to land, the
 * contracted monthly rent, and deposits being held.
 */
export type Standing = {
  arrears: Arrears
  /** Owed and already late. Same as `arrears.total`, named for the tile. */
  owedNow: number
  next30: { amount: number; count: number }
  /** Combined monthly rent of active payers on the leases in view. */
  monthly: number
  depositsHeld: number
  /** ACH debits still clearing — paid by the tenant, not yet landed. */
  clearing: { amount: number; count: number }
}

export function standing(plans: PaymentPlan[], now = new Date()): Standing {
  const a = arrears(plans, now)
  const charges = allCharges(plans, now)
  const clearingRows = charges.filter(c => c.state === 'clearing')

  return {
    arrears: a,
    owedNow: a.total,
    next30: dueWithin(plans, 30, now),
    monthly: plans.reduce(
      (s, p) => s + p.tenants.filter(t => t.status === 'active').reduce((n, t) => n + t.monthly_total, 0),
      0,
    ),
    depositsHeld: plans.reduce(
      (s, p) => s + (p.special_payments ?? [])
        .filter(sp => sp.category === 'security_deposit' && sp.status === 'paid')
        .reduce((n, sp) => n + sp.amount, 0),
      0,
    ),
    clearing: {
      amount: clearingRows.reduce((s, c) => s + c.outstanding, 0),
      count: clearingRows.length,
    },
  }
}
