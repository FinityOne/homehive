/**
 * What one tenant owes, and which bucket each charge belongs in.
 *
 * ── Why this is its own module ──────────────────────────────────────────────
 *
 * Two surfaces answer "what do I owe": the lease page's list and the
 * dashboard's balance tile. Both read the same `/api/tenant/lease` payload, and
 * both used to work it out themselves — which is exactly as reliable as it
 * sounds. They disagreed in two ways a tenant could see side by side:
 *
 *   • The tile took today from `new Date().toISOString()`. That is midnight in
 *     UTC, which in Tempe arrives at 5pm the afternoon *before*, so from 5pm on
 *     the 31st the tile counted the 1st's rent as already owed while the list,
 *     which used `billingToday`, correctly did not.
 *   • Neither passed `submitted_at` into the fee arithmetic, although the API
 *     ships it. That is the field the deadline is actually about: a debit
 *     submitted on the due date and still clearing has no `paid_date`, so the
 *     fee was measured to *today* and grew every day the bank took, on rent the
 *     tenant had already sent. The payment API does pass it — so the portal
 *     quoted a fee larger than the one the card would be charged.
 *
 * So the classification lives here, once, pure, and both surfaces call it. Every
 * figure it produces comes from `explainLateFee`, which is the same function
 * `POST /api/tenant/pay` prices with: what the tenant is shown and what their
 * card is charged cannot drift apart, because there is only one calculation.
 *
 * ── The rules, stated plainly ───────────────────────────────────────────────
 *
 *   1. **Late starts after the due day ends.** Rent due 1 November is on time
 *      at 11:59pm on 1 November and late from 12:00am on 2 November, judged in
 *      the property's timezone (`billingToday`, America/Phoenix). Nothing may
 *      read as late, or carry a fee, before that moment.
 *   2. **A fee is owed even once the rent is settled.** It froze when the money
 *      landed; it did not stop being owed. Keying visibility on `status` is
 *      what made every outstanding fee on this platform invisible to the person
 *      who owed it.
 *   3. **Voided rent charges nothing.** It was cancelled by an early
 *      termination; there is no tenancy left to bill.
 *   4. **A waived fee is shown as waived, not hidden.** It is owed nothing, so
 *      it leaves every payable list — but it stays visible as something that
 *      happened, because a charge a tenant was chased about that silently
 *      vanishes reads as a bug rather than as goodwill.
 *   5. **Only what has reached its due date is owed.** A lease schedules every
 *      month up front. Paying ahead is allowed, but only by deliberate choice.
 */
import {
  amountDue, billingToday, explainLateFee,
  type LateFeeExplanation, type LateFeeRuleLike,
} from '@/lib/rentPayments'

/** Just the fields of a scheduled rent row these rules read. */
export type TenantScheduledRow = {
  id: string
  due_date: string
  amount: number
  status: string
  paid_amount: number
  paid_date: string | null
  /** The date the fee is judged against. See rule 1 above. */
  submitted_at?: string | null
  late_fee_paid: number
  late_fee_waived: number
  late_fee_waiver?: { amount: number; waivedOn: string; note: string | null } | null
}

export type TenantSpecialRow = {
  id: string
  label: string
  amount: number
  status: string
  due_date: string | null
}

/** A charge the tenant can select and pay. Mirrors `Payable` in PayRentModal. */
export type TenantCharge = {
  kind: 'scheduled' | 'special' | 'late_fee'
  id: string
  label: string
  /** Rent or one-off owed. Always zero on a `late_fee` row. */
  amount: number
  lateFee: number
  daysLate: number
  /** `late_fee` only: the rent it sits on has already been paid. */
  rentSettled?: boolean
}

/** A fee the landlord forgave. Not payable, and that is the point. */
export type TenantWaivedFee = {
  id: string
  label: string
  amount: number
  waivedOn: string
  note: string | null
}

export type TenantCharges = {
  /** Rent and one-offs that have reached their due date. */
  owed: TenantCharge[]
  /** Future months, payable only by explicit choice. */
  upcoming: TenantCharge[]
  /** Outstanding late fees, oldest month first. */
  lateFees: TenantCharge[]
  waived: TenantWaivedFee[]
  /** The full working behind each fee, keyed by the rent row it sits on. */
  explanations: Map<string, LateFeeExplanation>
  /** Rent + fees due now. What "bring my account up to date" costs. */
  totalOwed: number
  /** Just the fee part of `totalOwed`. */
  lateFeeTotal: number
  /** The date every judgement above was made against. */
  today: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

const isSettledStatus = (s: string) => s === 'paid' || s === 'processing'
const isVoidedStatus = (s: string) => s === 'voided'

const fmtDate = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** "June 2026" — how a tenant refers to a month's rent. */
const fmtMonthYear = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

const daysSince = (from: string, to: string) =>
  Math.max(0, Math.round(
    (new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 86_400_000,
  ))

export function tenantCharges(
  scheduled: TenantScheduledRow[],
  specials: TenantSpecialRow[],
  rule: LateFeeRuleLike | null | undefined,
  now: Date = new Date(),
): TenantCharges {
  const owed: TenantCharge[] = []
  const upcoming: TenantCharge[] = []
  const lateFees: TenantCharge[] = []
  const waived: TenantWaivedFee[] = []
  const explanations = new Map<string, LateFeeExplanation>()

  // Rule 1: the day where the rent is due, never the reader's and never UTC's.
  const today = billingToday(now)

  for (const s of scheduled) {
    // Rule 3.
    if (isVoidedStatus(s.status)) continue

    // Rule 4 — collected *before* the `outstanding > 0` test below, because a
    // fully waived fee is owed nothing and would otherwise disappear entirely.
    if (s.late_fee_waiver && s.late_fee_waiver.amount > 0) {
      waived.push({
        id: s.id,
        label: `${fmtMonthYear(s.due_date)} rent`,
        amount: s.late_fee_waiver.amount,
        waivedOn: s.late_fee_waiver.waivedOn,
        note: s.late_fee_waiver.note,
      })
    }

    // Rule 2 — computed for every row, settled or not.
    const x = explainLateFee(
      rule,
      {
        status: s.status,
        due_date: s.due_date,
        paid_date: s.paid_date,
        submitted_at: s.submitted_at ?? null,
        amount: s.amount,
        paid_amount: s.paid_amount,
        late_fee_paid: s.late_fee_paid,
      },
      s.late_fee_waived,
      now,
    )
    if (x.outstanding > 0) {
      lateFees.push({
        kind: 'late_fee',
        id: s.id,
        label: `${fmtMonthYear(s.due_date)} rent`,
        amount: 0,
        lateFee: x.outstanding,
        daysLate: x.daysPastDue,
        rentSettled: x.rentSettled,
      })
      explanations.set(s.id, x)
    }

    // The rent itself.
    if (isSettledStatus(s.status)) continue
    const due = amountDue(s)
    if (due <= 0) continue
    const row: TenantCharge = {
      kind: 'scheduled',
      id: s.id,
      label: `Rent — ${fmtDate(s.due_date)}`,
      amount: due,
      lateFee: 0,
      // Zero all the way through the due day — rule 1 again, on the label this
      // time. "1 day late" on the morning rent is due is its own small lie.
      daysLate: today > s.due_date ? daysSince(s.due_date, today) : 0,
    }
    // Rule 5.
    ;(s.due_date <= today ? owed : upcoming).push(row)
  }

  for (const s of specials) {
    if (s.status !== 'pending' || s.amount <= 0) continue
    const row: TenantCharge = {
      kind: 'special', id: s.id, label: s.label, amount: s.amount, lateFee: 0, daysLate: 0,
    }
    ;(!s.due_date || s.due_date <= today ? owed : upcoming).push(row)
  }

  // Most recently forgiven first — the one they were just emailed about.
  waived.sort((a, b) => b.waivedOn.localeCompare(a.waivedOn))
  // Chronological: a backlog reads as a story, and "which months was I behind"
  // is answered by scanning down the list in order.
  lateFees.sort((a, b) =>
    (explanations.get(a.id)?.dueDate ?? '').localeCompare(explanations.get(b.id)?.dueDate ?? ''))

  const lateFeeTotal = round2(lateFees.reduce((s, r) => s + r.lateFee, 0))

  return {
    owed,
    upcoming,
    lateFees,
    waived,
    explanations,
    lateFeeTotal,
    totalOwed: round2(owed.reduce((s, r) => s + r.amount, 0) + lateFeeTotal),
    today,
  }
}
