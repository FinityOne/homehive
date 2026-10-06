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
  const asOf = sp.paid_date && sp.paid_amount >= sp.amount ? sp.paid_date : isoDate(now)
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
  const asOf = sp.paid_date && sp.paid_amount >= sp.amount ? sp.paid_date : isoDate(now)
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
