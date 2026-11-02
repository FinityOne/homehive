/**
 * The payments log: every attempt to move money, and what became of it.
 *
 * The rest of Financials answers "what am I owed". This answers the opposite
 * question, and it is the one a landlord asks when a tenant says *I paid you*:
 * what has actually arrived, when, by what route — and which attempts did not
 * make it. Until now the page could only answer two thirds of that, because an
 * ACH debit has three outcomes and the charge rows only record two:
 *
 *   • **Cleared** — the money is in the account. The charge says `paid`.
 *   • **Clearing** — sent, the bank has it, nothing has landed. `processing`.
 *   • **Failed** — it bounced. The charge was reset to `pending` and says
 *     nothing at all, so this comes from `rent_payment_attempts`, which exists
 *     for exactly this blind spot.
 *
 * Two sources, one row shape, because to a landlord they are one list. The
 * charge rows are authoritative for money — a figure here always matches the
 * ledger it came from — and the attempts table is authoritative for the
 * narrative: when it was sent, when it landed, what the bank said.
 *
 * Everything in this file is pure. It takes plans and attempt rows and returns
 * rows, totals and CSV, so the filtering behaviour can be verified without a
 * browser or a database (see `scripts/verify-payments-log.mjs`).
 */

import { type PaymentPlan } from './payments'
import { billingToday, daysPastDueOn } from './rentPayments'
import { METHOD_META } from './financialsRollup'
import { allCharges, type Charge } from './financialsMonth'

export type PayState = 'cleared' | 'clearing' | 'failed'

export const PAY_STATE_META: Record<PayState, {
  label: string
  tone: 'good' | 'info' | 'bad'
  hint: string
}> = {
  cleared:  {
    label: 'Cleared',
    tone: 'good',
    hint: 'The money has landed and is yours',
  },
  clearing: {
    label: 'Clearing',
    tone: 'info',
    hint: 'Sent by the tenant, still moving through the bank — ACH takes 3–5 business days',
  },
  failed:   {
    label: 'Failed',
    tone: 'bad',
    hint: 'The bank refused it. The charge went back to unpaid and the tenant still owes it',
  },
}

/** What a payment was for. Kept apart because a late fee is not rent. */
export type PayKind = 'rent' | 'charge' | 'late_fee'

export const KIND_LABEL: Record<PayKind, string> = {
  rent: 'Rent',
  charge: 'Charge',
  late_fee: 'Late fee',
}

/** One attempt to move money, as the log shows it. */
export type PaymentEntry = {
  /** Stable across reloads, so an open row stays open. */
  key: string
  state: PayState
  kind: PayKind
  planId: string
  propertyName: string
  leaseName: string
  /** The payer. Null on a charge raised against the lease rather than a person. */
  who: string | null
  label: string
  /** What it was due. Null only if the source row had no date. */
  dueDate: string | null
  /** Rent or charge money, in dollars. On a failed row: what was attempted. */
  amount: number
  /** Late-fee money inside this payment. */
  lateFee: number
  /** card / ach / manual_zelle / manual_other. */
  method: string | null
  /** When the tenant pressed pay. Null for rent recorded by hand. */
  submittedAt: string | null
  /** The instant it landed. Null while clearing, or when recorded by hand. */
  clearedAt: string | null
  /** The date the books use for it — a date, not an instant. */
  paidDate: string | null
  failedAt: string | null
  failureReason: string | null
  /** How many days the bank held it. Null unless we know both ends. */
  clearingDays: number | null
  /**
   * Days between the due date and the tenant sending it. Negative = early.
   * Measured on submission, never on settlement, for the same reason late fees
   * are: the clearing lag is the bank's fault, not the tenant's.
   */
  daysLate: number | null
  /** True when the landlord wrote it down rather than the tenant paying online. */
  byHand: boolean
  /** The Stripe payment, so rows paid in one press can be shown as one. */
  intentId: string | null
  /** The instant this row sorts and filters on. Always set. */
  at: string
}

/** A failed attempt, as `rent_payment_attempts` stores it. */
export type AttemptRow = {
  plan_id: string
  payment_intent_id: string
  method: string | null
  status: 'processing' | 'cleared' | 'failed'
  amount: number
  submitted_at: string | null
  cleared_at: string | null
  failed_at: string | null
  failure_code: string | null
  failure_message: string | null
  items: { kind: string; id: string; label: string; due_date: string | null; amount: number }[]
}

const cents = (n: number) => Math.round(n * 100) / 100

/** Whole days from one date to another, both `YYYY-MM-DD`. */
function daysBetween(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00').getTime()
  const b = new Date(to + 'T00:00:00').getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

/**
 * The calendar date of an instant, where the rent is due.
 *
 * Not `toISOString()`. A tenant who pays at 6pm in Tempe on the day rent is
 * due has already crossed into tomorrow in UTC, so a UTC date would print
 * their on-time payment as a day late — and the whole point of this log is
 * that the clearing lag and the clock are never charged to the tenant.
 */
const dayOf = (iso: string) => billingToday(new Date(iso))

/**
 * Every settled or in-flight payment on these plans.
 *
 * Read off the charges rather than recomputed, so a figure in the log and the
 * same figure in a lease ledger cannot disagree — they are the same object.
 */
function fromCharges(charges: Charge[]): PaymentEntry[] {
  const out: PaymentEntry[] = []

  for (const c of charges) {
    const st = c.settlement
    if (!st) continue
    // A charge with a settlement but no money is an ACH debit still clearing;
    // anything else with nothing on it is not a payment at all.
    const clearing = c.state === 'clearing'
    const money = clearing ? c.amount : st.net
    if (!clearing && st.net <= 0 && st.lateFee <= 0) continue

    const byHand = st.method === 'manual_zelle' || st.method === 'manual_other'
      || st.recordedBy === 'landlord'
    const submitted = st.submittedAt
    const cleared = clearing ? null : st.settledAt
    // The lag the bank introduced, which is the thing ACH has to explain for
    // itself. Only meaningful when both ends are known instants.
    const clearingDays = submitted && cleared
      ? Math.max(0, daysBetween(dayOf(submitted), dayOf(cleared)))
      : null
    // Judged on when the tenant sent it. For a manual entry there is no
    // submission, so the landlord's own paid date is the best fact available.
    const sentOn = submitted ? dayOf(submitted) : st.paidDate
    // Zero all the way through the due day: rent due on the 1st sent at any
    // hour of the 1st is on time. `daysPastDueOn` is the one definition.
    const daysLate = sentOn && c.dueDate ? daysPastDueOn(c.dueDate, sentOn) : null

    out.push({
      key: `${c.kind}-${c.id}`,
      state: clearing ? 'clearing' : 'cleared',
      kind: c.kind === 'rent' ? 'rent' : 'charge',
      planId: c.planId,
      propertyName: c.propertyName,
      leaseName: c.leaseName,
      who: c.who,
      label: c.label,
      dueDate: c.dueDate,
      amount: cents(money),
      lateFee: cents(st.lateFee),
      method: st.method,
      submittedAt: submitted,
      clearedAt: cleared,
      paidDate: st.paidDate,
      failedAt: null,
      failureReason: null,
      clearingDays,
      daysLate,
      byHand,
      intentId: st.intentId,
      // Sorting prefers the moment the money moved for the landlord — it
      // landed, or it was sent and is on its way.
      at: cleared ?? submitted ?? (st.paidDate ? `${st.paidDate}T12:00:00.000Z` : c.dueDate + 'T12:00:00.000Z'),
    })
  }

  return out
}

/**
 * The failures, which only this table remembers.
 *
 * One row per thing the payment covered, so a bounced debit that was paying
 * three months of rent reads as three unpaid months — which is what the
 * landlord now has to chase.
 */
function fromAttempts(attempts: AttemptRow[], plans: PaymentPlan[]): PaymentEntry[] {
  const byPlan = new Map(plans.map(p => [p.id, p]))
  const out: PaymentEntry[] = []

  for (const a of attempts) {
    if (a.status !== 'failed') continue
    const plan = byPlan.get(a.plan_id)
    // An attempt on a lease this landlord no longer has in view is not theirs
    // to read about. RLS already scoped the fetch; this scopes it to the
    // filter in force.
    if (!plan) continue

    const items = Array.isArray(a.items) && a.items.length > 0
      ? a.items
      : [{ kind: 'rent', id: a.payment_intent_id, label: 'Payment', due_date: null, amount: a.amount }]

    items.forEach(item => {
      const kind: PayKind = item.kind === 'late_fee' ? 'late_fee'
        : item.kind === 'charge' ? 'charge' : 'rent'
      const sentOn = a.submitted_at ? dayOf(a.submitted_at) : null
      out.push({
        key: `failed-${a.payment_intent_id}-${item.id}`,
        state: 'failed',
        kind,
        planId: a.plan_id,
        propertyName: plan.property?.name ?? 'Property',
        leaseName: plan.name,
        // A failed attempt kept no payer: it is keyed on the intent, and the
        // charges it touched were reset. The lease is the honest answer.
        who: null,
        label: item.label,
        dueDate: item.due_date,
        amount: kind === 'late_fee' ? 0 : cents(Number(item.amount) || 0),
        lateFee: kind === 'late_fee' ? cents(Number(item.amount) || 0) : 0,
        method: a.method,
        submittedAt: a.submitted_at,
        clearedAt: null,
        paidDate: null,
        failedAt: a.failed_at,
        failureReason: a.failure_message ?? a.failure_code ?? null,
        clearingDays: a.submitted_at && a.failed_at
          ? Math.max(0, daysBetween(dayOf(a.submitted_at), dayOf(a.failed_at)))
          : null,
        daysLate: sentOn && item.due_date ? daysPastDueOn(item.due_date, sentOn) : null,
        byHand: false,
        intentId: a.payment_intent_id,
        at: a.failed_at ?? a.submitted_at ?? new Date(0).toISOString(),
      })
    })
  }

  return out
}

/** Every payment on these leases, newest first. */
export function paymentLog(plans: PaymentPlan[], attempts: AttemptRow[] = []): PaymentEntry[] {
  return [...fromCharges(allCharges(plans)), ...fromAttempts(attempts, plans)]
    .sort((a, b) => b.at.localeCompare(a.at))
}

// ─── FILTERS ─────────────────────────────────────────────────────────────────

export type StateFilter = 'all' | PayState
export type MethodFilter = 'all' | 'card' | 'ach' | 'manual'
/** A window, in days back from today. `all` is every payment ever taken. */
export type RangeFilter = 'all' | '30' | '90' | '365'

export const STATE_FILTERS: { id: StateFilter; label: string; hint: string }[] = [
  { id: 'all',      label: 'All',      hint: 'Every payment, whatever happened to it' },
  { id: 'cleared',  label: 'Cleared',  hint: PAY_STATE_META.cleared.hint },
  { id: 'clearing', label: 'Clearing', hint: PAY_STATE_META.clearing.hint },
  { id: 'failed',   label: 'Failed',   hint: PAY_STATE_META.failed.hint },
]

export const METHOD_FILTERS: { id: MethodFilter; label: string }[] = [
  { id: 'all',    label: 'Any method' },
  { id: 'card',   label: 'Card' },
  { id: 'ach',    label: 'Bank transfer' },
  { id: 'manual', label: 'Recorded by hand' },
]

export const RANGE_FILTERS: { id: RangeFilter; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: '30',  label: 'Last 30 days' },
  { id: '90',  label: 'Last 90 days' },
  { id: '365', label: 'Last 12 months' },
]

export type PayFilter = {
  state: StateFilter
  method: MethodFilter
  range: RangeFilter
  /** A plan id, or '' for every lease. */
  planId: string
  /** Free text over payer, property, lease and label. */
  query: string
}

export const EMPTY_FILTER: PayFilter = {
  state: 'all', method: 'all', range: 'all', planId: '', query: '',
}

const isManual = (m: string | null) => m === 'manual_zelle' || m === 'manual_other'

export function filterPayments(
  rows: PaymentEntry[], f: PayFilter, now = new Date(),
): PaymentEntry[] {
  const cutoff = f.range === 'all'
    ? null
    : new Date(now.getTime() - Number(f.range) * 86_400_000).toISOString()
  const q = f.query.trim().toLowerCase()

  return rows.filter(r => {
    if (f.state !== 'all' && r.state !== f.state) return false
    if (f.planId && r.planId !== f.planId) return false
    if (f.method === 'manual' && !isManual(r.method)) return false
    if ((f.method === 'card' || f.method === 'ach') && r.method !== f.method) return false
    if (cutoff && r.at < cutoff) return false
    if (q) {
      const hay = `${r.who ?? ''} ${r.propertyName} ${r.leaseName} ${r.label}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

// ─── TOTALS ──────────────────────────────────────────────────────────────────

export type PayTotals = {
  /** Money that has landed: rent and charges plus late fees collected. */
  cleared: number
  clearedCount: number
  /** Sent and not yet landed. Money a landlord can expect, not money they have. */
  clearing: number
  clearingCount: number
  /** What bounced. Still owed by the tenant. */
  failed: number
  failedCount: number
  /** Late-fee money inside `cleared`. */
  lateFees: number
  /** Cleared payments the tenant sent after the due date. */
  lateCount: number
  /** Average days the bank held a cleared ACH debit. Null if none to average. */
  avgClearingDays: number | null
}

export function paymentTotals(rows: PaymentEntry[]): PayTotals {
  const t: PayTotals = {
    cleared: 0, clearedCount: 0, clearing: 0, clearingCount: 0,
    failed: 0, failedCount: 0, lateFees: 0, lateCount: 0,
    avgClearingDays: null,
  }
  let lagDays = 0
  let lagged = 0

  for (const r of rows) {
    if (r.state === 'cleared') {
      t.cleared += r.amount + r.lateFee
      t.clearedCount++
      t.lateFees += r.lateFee
      if ((r.daysLate ?? 0) > 0) t.lateCount++
      if (r.method === 'ach' && r.clearingDays !== null) { lagDays += r.clearingDays; lagged++ }
    } else if (r.state === 'clearing') {
      t.clearing += r.amount + r.lateFee
      t.clearingCount++
    } else {
      t.failed += r.amount + r.lateFee
      t.failedCount++
    }
  }

  t.cleared = cents(t.cleared)
  t.clearing = cents(t.clearing)
  t.failed = cents(t.failed)
  t.lateFees = cents(t.lateFees)
  t.avgClearingDays = lagged > 0 ? Math.round((lagDays / lagged) * 10) / 10 : null

  return t
}

/** How many rows sit in each state, for the filter badges. */
export function stateCounts(rows: PaymentEntry[]): Record<StateFilter, number> {
  const out: Record<StateFilter, number> = { all: rows.length, cleared: 0, clearing: 0, failed: 0 }
  for (const r of rows) out[r.state]++
  return out
}

/** The leases these payments belong to, for the lease picker. */
export function leaseOptions(rows: PaymentEntry[]): { id: string; label: string }[] {
  const seen = new Map<string, string>()
  for (const r of rows) {
    if (!seen.has(r.planId)) seen.set(r.planId, `${r.propertyName} — ${r.leaseName}`)
  }
  return [...seen.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

// ─── EXPORT ──────────────────────────────────────────────────────────────────

const csvCell = (v: string | number | null) => {
  const s = v === null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * The visible rows, as a spreadsheet.
 *
 * Exactly what is on screen, in the order it is on screen: a landlord who has
 * filtered to one property and the last 90 days means that, and an export that
 * quietly widened the question would be reconciled against the wrong total.
 */
export function paymentsCsv(rows: PaymentEntry[]): string {
  const head = [
    'Status', 'Kind', 'Property', 'Lease', 'Payer', 'What', 'Due date',
    'Amount', 'Late fee', 'Method',
    'Sent', 'Cleared', 'Failed', 'Days to clear', 'Days late', 'Reason', 'Stripe payment',
  ]
  const lines = [head.join(',')]

  for (const r of rows) {
    lines.push([
      PAY_STATE_META[r.state].label,
      KIND_LABEL[r.kind],
      r.propertyName,
      r.leaseName,
      r.who ?? '',
      r.label,
      r.dueDate ?? '',
      r.amount.toFixed(2),
      r.lateFee.toFixed(2),
      r.method ? (METHOD_META[r.method as keyof typeof METHOD_META]?.label ?? r.method) : '',
      r.submittedAt ?? '',
      r.clearedAt ?? (r.paidDate ?? ''),
      r.failedAt ?? '',
      r.clearingDays ?? '',
      r.daysLate ?? '',
      r.failureReason ?? '',
      r.intentId ?? '',
    ].map(csvCell).join(','))
  }

  return lines.join('\n')
}
