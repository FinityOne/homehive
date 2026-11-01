// Shared rules for tenant-facing rent payments.
//
// The fee maths lives here so the amount quoted in the UI and the amount
// charged by the server come from one function. The server always recomputes —
// the client's number is a preview, never an instruction.

export type PayMethod = 'card' | 'ach'
export type SettledMethod = PayMethod | 'manual_zelle' | 'manual_other'

/** Surcharge passed to the tenant, as a fraction of the amount owed. */
export const FEE_RATES: Record<PayMethod, number> = {
  card: 0.05, // 5%
  ach: 0.02,  // 2%
}

export const METHOD_META: Record<SettledMethod, { label: string; short: string; color: string; bg: string }> = {
  card:         { label: 'Card',            short: 'Card',   color: '#6d28d9', bg: '#f5f3ff' },
  ach:          { label: 'Bank transfer',   short: 'ACH',    color: '#1d4ed8', bg: '#eff6ff' },
  manual_zelle: { label: 'Zelle (confirmed by landlord)', short: 'Zelle', color: '#0e7490', bg: '#ecfeff' },
  manual_other: { label: 'Recorded by landlord',          short: 'Manual', color: '#64748b', bg: '#f1f5f9' },
}

const toCents = (n: number) => Math.round(n * 100)

export type FeeBreakdown = {
  baseCents: number
  feeCents: number
  totalCents: number
  base: number
  fee: number
  total: number
  ratePct: number
}

/**
 * Work in integer cents throughout. The fee rounds half-up on the cent, and the
 * total is base + fee — so what the tenant is told matches what Stripe captures
 * to the penny.
 */
export function computeFee(baseAmount: number, method: PayMethod): FeeBreakdown {
  const baseCents = toCents(baseAmount)
  const feeCents = Math.round(baseCents * FEE_RATES[method])
  const totalCents = baseCents + feeCents
  return {
    baseCents,
    feeCents,
    totalCents,
    base: baseCents / 100,
    fee: feeCents / 100,
    total: totalCents / 100,
    ratePct: FEE_RATES[method] * 100,
  }
}

export function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

/** Outstanding balance on a payment row, never below zero. */
export function amountDue(p: { amount: number; paid_amount?: number | null }): number {
  return Math.max(0, Math.round(((p.amount ?? 0) - (p.paid_amount ?? 0)) * 100) / 100
  )
}

/** Stripe's smallest chargeable amount is 50 cents. */
export const MIN_CHARGE_CENTS = 50

// ─── LATE FEES ───────────────────────────────────────────────────────────────
//
// Lives here rather than in financialsRollup because both the browser and the
// payment API need it, and the rollup reaches `@/lib/payments`, which builds a
// browser Supabase client — importing that into a route handler would create a
// client on the server for no reason. This file has no imports at all.

/** Just the fields a late fee is computed from. */
export type LateFeeChargeLike = {
  status: string
  due_date: string
  paid_date: string | null
  amount: number
  paid_amount: number
}

/**
 * Has this charge stopped accruing a late fee?
 *
 * Not the same question as "is it paid in full". A landlord who marks a row
 * `paid` has closed it, and on this database four rows carry `status='paid'`
 * with `paid_amount` short of `amount` — two of them at exactly $0.00, settled
 * by hand against money taken outside the platform. Keying only on the figures
 * leaves those rows looking perpetually unpaid, so the fee recomputes against
 * *today* every time anyone loads the page and grows without end: one of them
 * reached $825 on $741.96 of rent that the landlord considers closed.
 *
 * So the landlord's own verdict settles it, and the amounts are the fallback
 * for rows nobody has ruled on. `processing` is excluded deliberately — an ACH
 * debit in flight has not landed, and if it bounces the fee is owed after all.
 */
export function rentIsSettled(sp: Pick<LateFeeChargeLike, 'status' | 'amount' | 'paid_amount'>): boolean {
  return sp.status === 'paid' || sp.paid_amount >= sp.amount
}

/** The date a late fee is measured to: when it stopped, or today. */
export function lateFeeAsOf(sp: LateFeeChargeLike, now = new Date()): string {
  return sp.paid_date && rentIsSettled(sp) ? sp.paid_date : isoDate(now)
}

export type LateFeeRuleLike = {
  grace_period_days: number
  fee_amount: number
  frequency_days: number
  max_total_fees: number | null
}

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return isoDate(d)
}

function daysBetweenDates(from: string, to: string): number {
  return Math.round(
    (new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 86_400_000
  )
}

/**
 * What a late fee on one rent row is actually worth.
 *
 * Derived, never read from `scheduled_payments.late_fees_applied`. That column
 * is not trustworthy: on this database it holds the same figure for every row
 * sharing a due date regardless of when each was paid, including rows paid
 * *early* — one row settled three days ahead of time carries a $4,050 fee. It
 * was evidently written once in bulk from `computeLateFees(rule, due_date)` as
 * of that run's date, which ignores `paid_date` entirely and keeps growing for
 * as long as nobody recomputes it.
 *
 * So the fee is recomputed from the rule and the facts on the row:
 *   • settled → how late it actually was, by `paid_date`
 *   • unpaid  → how late it is right now
 *   • neither → nothing is owed on money that already arrived on time
 *
 * This reads the rule, so it is only as sane as the rule. A rule with no
 * `max_total_fees` accrues without limit, which is worth surfacing rather than
 * quietly compounding — see `lateFeeRuleRisk`.
 */
export function lateFeeDue(
  rule: LateFeeRuleLike | null | undefined,
  sp: LateFeeChargeLike,
  now = new Date(),
): number {
  if (!rule || rule.fee_amount <= 0) return 0
  if (sp.status === 'voided') return 0
  const asOf = lateFeeAsOf(sp, now)
  const graceEnd = addDays(sp.due_date, rule.grace_period_days)
  if (asOf <= graceEnd) return 0
  const daysOver = daysBetweenDates(graceEnd, asOf)
  const periods = Math.floor(daysOver / Math.max(1, rule.frequency_days))
  const accrued = periods * rule.fee_amount

  // The rule's own ceiling wins when it has one.
  if (rule.max_total_fees != null) return Math.min(accrued, rule.max_total_fees)

  // No ceiling in the rule. An uncapped daily fee grows without bound, and on
  // this database that is not hypothetical: a forgotten $1.00 charge sat 66 days
  // past due under a $15/day rule, which accrues $990 — 990× the rent it is
  // attached to. Billing that to a tenant would be indefensible, so an uncapped
  // rule is held to the size of the charge itself. A landlord who genuinely
  // wants more sets `max_total_fees` and gets exactly what they asked for.
  const outstanding = Math.max(0, sp.amount - sp.paid_amount) || sp.amount
  return Math.min(accrued, outstanding)
}

/** Ceiling applied to an uncapped rule, so callers can explain the number. */
export function lateFeeCappedByCharge(
  rule: LateFeeRuleLike | null | undefined,
  sp: LateFeeChargeLike,
  now = new Date(),
): boolean {
  if (!rule || rule.max_total_fees != null || rule.fee_amount <= 0) return false
  const asOf = lateFeeAsOf(sp, now)
  const graceEnd = addDays(sp.due_date, rule.grace_period_days)
  if (asOf <= graceEnd) return false
  const periods = Math.floor(daysBetweenDates(graceEnd, asOf) / Math.max(1, rule.frequency_days))
  const outstanding = Math.max(0, sp.amount - sp.paid_amount) || sp.amount
  return periods * rule.fee_amount > outstanding
}



/**
 * Why a late-fee rule should not be trusted to charge tenants automatically.
 *
 * An uncapped daily fee is the dangerous shape: $15/day with no ceiling turns a
 * forgotten $800 rent into $450 of fees in a month and keeps going. Flagging it
 * is cheaper than discovering it on an invoice.
 */
export function lateFeeRuleRisk(rule: LateFeeRuleLike | null | undefined): string | null {
  if (!rule || rule.fee_amount <= 0) return null
  if (rule.max_total_fees == null) {
    const perMonth = Math.round((30 / Math.max(1, rule.frequency_days)) * rule.fee_amount)
    return `This rule has no maximum — it accrues about $${perMonth.toLocaleString('en-US')} a month and never stops.`
  }
  return null
}

/**
 * What a tenant still owes in late fees on one rent charge.
 *
 * `lateFeeDue` answers "what does the rule assess", which is not the same
 * question. The fee may have been paid already, and the landlord may have
 * written part of it off, and a tenant must never be billed for either. This is
 * the figure that is actually collectable:
 *
 *     assessed − already paid − waived
 *
 * It is deliberately the same arithmetic as `chargeBreakdown.lateFeeOutstanding`
 * in `lateFees.ts`, which is the landlord's view of the identical number. That
 * module reaches `@/lib/payments` and so cannot be imported into a route
 * handler; this file imports nothing, which is why the tenant portal and the
 * payment API share this copy. If you change one, change both.
 *
 * Works on a *settled* charge too, and that is the whole point. Every
 * outstanding fee on this platform sits on rent that was paid in full — the fee
 * froze on the day the money landed and was never asked for. Keying
 * collectability on `status` would make all of it permanently invisible.
 */
export type LateFeeExplanation = {
  /** The rent this fee sits on. */
  rentDue: number
  rentPaid: number
  rentSettled: boolean
  dueDate: string
  /** Last day the rent could arrive without a fee. Equals `dueDate` with no grace. */
  graceEndDate: string
  /** The date the fee is measured to: when the rent landed, or today. */
  asOfDate: string
  paidDate: string | null
  /** Whether the fee has stopped growing. */
  frozen: boolean

  /** The rule, in the pieces a sentence needs. */
  graceDays: number
  perPeriod: number
  frequencyDays: number
  ruleCap: number | null

  /** Days from the due date to `asOfDate`. What a tenant means by "how late". */
  daysPastDue: number
  /** Chargeable periods elapsed after the grace period. */
  periods: number
  /** periods x perPeriod, before any ceiling. */
  accrued: number
  /** Which ceiling bit, if either. `charge` is the uncapped-rule safeguard. */
  cappedBy: 'rule' | 'charge' | null
  /** The ceiling's value, when one applied. */
  capAmount: number | null
  /** What the rule assesses after any ceiling. */
  assessed: number

  /** Fee money recorded in `late_fee_paid`. */
  feePaid: number
  /**
   * Money paid on this charge *above* its rent.
   *
   * On this database two charges were overpaid by exactly one and four days'
   * worth of the daily fee — the tenant paid the fee and it was recorded as
   * rent. Anything above the rent on a charge cannot be rent, and the only
   * other thing owed on that row is its fee, so it is credited here. Without
   * this the tenant is billed a second time for money they already sent.
   */
  overpaymentCredit: number
  /** Fee the landlord has written off. */
  waived: number
  /** assessed - feePaid - overpaymentCredit - waived, never below zero. */
  outstanding: number
}

/**
 * The whole story of one late fee, in the pieces a person needs to accept it.
 *
 * A tenant asked for $1,506.96 across eleven months will not pay on the
 * strength of a total. They need to see which month, how late it actually was,
 * what the rule charges, the arithmetic that turns those into a number, and
 * what they have already paid towards it. Every figure the detail sheet shows
 * comes from here, so the explanation and the amount charged cannot drift
 * apart — `lateFeeOutstanding` is this function's `outstanding` field.
 */
export function explainLateFee(
  rule: LateFeeRuleLike | null | undefined,
  sp: LateFeeChargeLike & { late_fee_paid?: number | null },
  waived: number = 0,
  now = new Date(),
): LateFeeExplanation {
  const rentDue = Number(sp.amount)
  const rentPaid = Number(sp.paid_amount ?? 0)
  const settled = rentIsSettled(sp)
  const asOf = lateFeeAsOf(sp, now)
  const graceDays = rule?.grace_period_days ?? 0
  const perPeriod = Number(rule?.fee_amount ?? 0)
  const frequencyDays = Math.max(1, rule?.frequency_days ?? 1)
  const graceEnd = addDays(sp.due_date, graceDays)

  const voided = sp.status === 'voided'
  const overGrace = voided ? 0 : Math.max(0, daysBetweenDates(graceEnd, asOf))
  const periods = perPeriod > 0 ? Math.floor(overGrace / frequencyDays) : 0
  const accrued = round2(periods * perPeriod)

  // The same two ceilings `lateFeeDue` applies, reported rather than just used.
  let assessed = accrued
  let cappedBy: 'rule' | 'charge' | null = null
  let capAmount: number | null = null
  if (rule?.max_total_fees != null) {
    capAmount = Number(rule.max_total_fees)
    if (accrued > capAmount) { assessed = capAmount; cappedBy = 'rule' }
  } else {
    const chargeCap = Math.max(0, round2(rentDue - rentPaid)) || rentDue
    capAmount = chargeCap
    if (accrued > chargeCap) { assessed = chargeCap; cappedBy = 'charge' }
  }

  const feePaid = Math.max(0, Number(sp.late_fee_paid ?? 0))
  const overpaymentCredit = Math.max(0, round2(rentPaid - rentDue))
  const forgiven = Math.min(assessed, Math.max(0, Number(waived) || 0))
  const outstanding = Math.max(
    0,
    round2(assessed - feePaid - overpaymentCredit - forgiven),
  )

  return {
    rentDue, rentPaid, rentSettled: settled,
    dueDate: sp.due_date,
    graceEndDate: graceEnd,
    asOfDate: asOf,
    paidDate: sp.paid_date ?? null,
    frozen: settled,
    graceDays, perPeriod, frequencyDays,
    ruleCap: rule?.max_total_fees != null ? Number(rule.max_total_fees) : null,
    daysPastDue: voided ? 0 : Math.max(0, daysBetweenDates(sp.due_date, asOf)),
    periods, accrued, cappedBy, capAmount, assessed,
    feePaid, overpaymentCredit, waived: forgiven,
    outstanding,
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * What a tenant still owes in late fees on one rent charge.
 *
 * `lateFeeDue` answers "what does the rule assess", which is not the same
 * question. The fee may have been paid already — in `late_fee_paid`, or as an
 * overpayment on the rent — and the landlord may have written part of it off.
 * A tenant must never be billed for any of those. This is the collectable
 * figure, and it is `explainLateFee().outstanding` so the number charged is
 * always the number the detail sheet justified.
 *
 * Works on a *settled* charge, and that is the point: every outstanding fee
 * here sits on rent paid in full. Keying collectability on `status` is what
 * made all of it invisible.
 */
export function lateFeeOutstanding(
  rule: LateFeeRuleLike | null | undefined,
  sp: LateFeeChargeLike & { late_fee_paid?: number | null },
  waived: number = 0,
  now = new Date(),
): number {
  return explainLateFee(rule, sp, waived, now).outstanding
}
