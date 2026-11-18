/**
 * How one tenant is actually doing — the model behind the tenant detail page
 * and behind every late-rent warning the landlord sends.
 *
 * ── Why this is its own module ──────────────────────────────────────────────
 *
 * A landlord looking at a tenant asks three questions in this order: *are they
 * behind right now*, *have they always been like this*, and *what do I do about
 * it*. The app could answer the first (Financials) and never the second, because
 * nothing anywhere turned a lease's twelve rent rows into a track record. So
 * "she's always late" was a feeling, and a warning letter written on a feeling
 * is the kind a tenant successfully disputes.
 *
 * Everything here is pure: rows in, figures out. The page renders it, the
 * warning email is built from it, and `scripts/verify-tenant-record.mjs` checks
 * it without a browser or a database — which matters more than usual, because
 * the output of `warningBasis` is posted to a resident *and their co-signer*
 * under the landlord's name. A figure that is wrong there is not a glitch.
 *
 * ── The rules it inherits, and will not relitigate ──────────────────────────
 *
 * What a tenant owes is decided by `tenantCharges` and nothing else — it is the
 * one engine for that question (voided rent excluded, waived fees shown but not
 * payable, fees owed on settled rent, the whole due day allowed). This module
 * adds *history* and *escalation* on top of it and never recomputes a figure it
 * already answers. In particular:
 *
 *   • **Late means the whole due day has passed**, in the property's timezone
 *     (`isPastDue` / `billingToday`). Rent due today is owed and is not late,
 *     so it is never in a warning. This is the single most important line in
 *     the file: a first notice sent on the morning rent is due is indefensible.
 *   • **A payment is judged on when it was sent**, not when the bank released
 *     it (`submitted_at` before `paid_date`). An ACH debit submitted on the 1st
 *     and cleared on the 5th was on time, and the track record must say so.
 *   • **A late fee's figure comes from `explainLateFee`**, via `tenantCharges`,
 *     so the amount in the warning is the amount the portal would charge.
 */
import {
  billingToday, daysPastDueOn, isPastDue, rentIsSettled,
  type LateFeeRuleLike,
} from '@/lib/rentPayments'
import {
  tenantCharges,
  type TenantCharges, type TenantScheduledRow, type TenantSpecialRow,
} from '@/lib/tenantCharges'

const round2 = (n: number) => Math.round(n * 100) / 100

// ─── The timeline ────────────────────────────────────────────────────────────

/**
 * What became of one scheduled rent charge.
 *
 * Seven outcomes, not two, because "paid" and "unpaid" is the distinction that
 * loses the whole story: a tenant who has paid every month three days late is
 * not the same tenant as one who has never missed, and a progress bar that
 * draws them identically is worse than no progress bar.
 */
export type RentOutcome =
  | 'on_time'    // settled, and sent on or before the due day
  | 'late'       // settled, but sent after the due day
  | 'clearing'   // submitted, still moving through the bank
  | 'due'        // reached its due day, nothing sent, still inside it
  | 'overdue'    // the due day has passed
  | 'upcoming'   // scheduled, not yet due
  | 'voided'     // cancelled — an early termination, not a missed payment

export const OUTCOME_META: Record<RentOutcome, {
  label: string
  /** Maps onto the money theme's state colours — see src/lib/financeTheme.ts. */
  tone: 'good' | 'bad' | 'warn' | 'info' | 'quiet'
  hint: string
}> = {
  on_time:  { label: 'On time',   tone: 'good',  hint: 'Sent on or before the due date' },
  late:     { label: 'Late',      tone: 'warn',  hint: 'Paid in full, but sent after the due date' },
  clearing: { label: 'Clearing',  tone: 'info',  hint: 'Sent by the tenant, still moving through the bank' },
  due:      { label: 'Due today', tone: 'quiet', hint: 'Due today — the tenant has the whole day' },
  overdue:  { label: 'Overdue',   tone: 'bad',   hint: 'The due day has passed and nothing has arrived' },
  upcoming: { label: 'Upcoming',  tone: 'quiet', hint: 'Not due yet' },
  voided:   { label: 'Cancelled', tone: 'quiet', hint: 'Cancelled — nothing is owed on it' },
}

export type RentStop = {
  id: string
  dueDate: string
  /** 'November 2026' — how both parties refer to a month's rent. */
  month: string
  amount: number
  paid: number
  outcome: RentOutcome
  /**
   * Days between the due date and the day the money was sent, or today for rent
   * that has not been sent. Zero all the way through the due day.
   */
  daysLate: number
  /** The outstanding fee on this month, from `tenantCharges`. */
  lateFee: number
  /** The day the money was sent (or recorded), for a stop that has settled. */
  settledOn: string | null
}

/** The calendar day an instant falls on where the rent is due. */
const dayOf = (iso: string | null | undefined): string | null =>
  iso ? billingToday(new Date(iso)) : null

const monthOf = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

/**
 * The day a charge was *sent*, which is the only fair day to judge it on.
 *
 * `submitted_at` is when the tenant pressed pay; `paid_date` is a landlord's
 * note about money that arrived off-platform. Reading `paid_date` on a
 * platform payment charges the tenant for the bank's clearing window — the
 * mistake `lateFeeAsOf` exists to prevent, made here in the track record
 * instead of in the fee.
 */
function sentOn(r: TenantScheduledRow): string | null {
  return dayOf(r.submitted_at) ?? (rentIsSettled(r) ? r.paid_date : null)
}

function outcomeOf(r: TenantScheduledRow, today: string): RentOutcome {
  if (r.status === 'voided') return 'voided'
  if (r.status === 'processing') return 'clearing'
  if (rentIsSettled(r)) return 'late'  // refined by the caller, which knows the day
  if (r.due_date > today) return 'upcoming'
  return r.due_date === today ? 'due' : 'overdue'
}

/**
 * Every rent charge on the tenancy, oldest first, with what became of it.
 *
 * Ordered by due date and not by payment date on purpose: this is a calendar of
 * obligations, and the gap where nothing arrived is the thing worth seeing.
 */
export function rentTimeline(
  scheduled: TenantScheduledRow[],
  rule: LateFeeRuleLike | null | undefined,
  now: Date = new Date(),
): RentStop[] {
  const today = billingToday(now)
  const charges = tenantCharges(scheduled, [], rule, now)
  // The fee engine's own figure per month — never recomputed here.
  const feeById = new Map(charges.lateFees.map(f => [f.id, f.lateFee]))

  return [...scheduled]
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .map(r => {
      const settled = sentOn(r)
      let outcome = outcomeOf(r, today)
      // A settled charge splits on *when it was sent*. With no date at all we
      // cannot claim it was late, so it reads as on time: an unprovable
      // accusation is the one thing a track record must not make.
      if (outcome === 'late' && (!settled || settled <= r.due_date)) outcome = 'on_time'

      const daysLate = settled
        ? daysPastDueOn(r.due_date, settled)
        : (outcome === 'overdue' ? daysPastDueOn(r.due_date, today) : 0)

      return {
        id: r.id,
        dueDate: r.due_date,
        month: monthOf(r.due_date),
        amount: round2(Number(r.amount)),
        paid: round2(Number(r.paid_amount ?? 0)),
        outcome,
        daysLate,
        lateFee: feeById.get(r.id) ?? 0,
        settledOn: settled,
      }
    })
}

// ─── The track record ────────────────────────────────────────────────────────

/** Where this tenant stands, in one word the landlord can act on. */
export type Standing =
  | 'new'       // nothing has come due yet
  | 'current'   // nothing past due, no fee outstanding
  | 'fees_only' // rent is current; a late fee was never collected
  | 'behind'    // something is past due
  | 'serious'   // badly or repeatedly past due — see `standingOf`

export const STANDING_META: Record<Standing, {
  label: string
  tone: 'good' | 'bad' | 'warn' | 'info' | 'quiet'
  line: string
}> = {
  new:       { label: 'Nothing due yet',  tone: 'quiet', line: 'No rent has come due on this tenancy yet.' },
  current:   { label: 'Up to date',       tone: 'good',  line: 'Nothing is past due and no fees are outstanding.' },
  fees_only: { label: 'Fee outstanding',  tone: 'warn',  line: 'Rent is up to date. A late fee from an earlier month was never collected.' },
  behind:    { label: 'Behind',           tone: 'bad',   line: 'Rent is past due.' },
  serious:   { label: 'Seriously behind', tone: 'bad',   line: 'Rent has been past due for some time, or across more than one month.' },
}

/** A month is "seriously" behind past this. Roughly: a second month has begun. */
export const SERIOUS_DAYS = 21

export type TenantRecord = {
  /** The billing day every judgement below was made on. */
  today: string
  standing: Standing
  /** Rent charges that have come due, settled or not. The denominator. */
  monthsDue: number
  onTime: number
  paidLate: number
  /** Past due right now. */
  open: number
  /** 0–100, of the months that have come due. Null until at least one has. */
  onTimeRate: number | null
  /** Mean days late across the months that were paid late. 0 if none were. */
  avgDaysLate: number
  worstDaysLate: number
  /** Consecutive on-time months, up to the most recent settled one. */
  streak: number
  /** Rent and one-offs owed now, from `tenantCharges`. */
  rentOwed: number
  lateFeeOwed: number
  totalOwed: number
  /** Fees the landlord wrote off. Goodwill is part of the record. */
  waived: number
  /** Rent money collected on this tenancy. */
  collected: number
  /** Everything billed that has come due. */
  billed: number
  /** The oldest unpaid due date, and how late it is. */
  oldestOverdue: { dueDate: string; daysLate: number } | null
  /** The next charge the tenant has to think about. */
  nextDue: { dueDate: string; amount: number } | null
  lastPayment: { date: string; amount: number } | null
  charges: TenantCharges
  timeline: RentStop[]
}

function standingOf(
  charges: TenantCharges,
  oldestOverdue: { dueDate: string; daysLate: number } | null,
  overdueCount: number,
  monthsDue: number,
): Standing {
  if (oldestOverdue) {
    return oldestOverdue.daysLate > SERIOUS_DAYS || overdueCount > 1 ? 'serious' : 'behind'
  }
  // A one-off charge (a deposit, a utility true-up) past its date is being
  // behind too, even with every month of rent paid.
  if (charges.owed.length > 0) return 'behind'
  if (charges.lateFeeTotal > 0) return 'fees_only'
  return monthsDue === 0 ? 'new' : 'current'
}

export function tenantRecord(
  scheduled: TenantScheduledRow[],
  specials: TenantSpecialRow[],
  rule: LateFeeRuleLike | null | undefined,
  now: Date = new Date(),
): TenantRecord {
  const today = billingToday(now)
  const charges = tenantCharges(scheduled, specials, rule, now)
  const timeline = rentTimeline(scheduled, rule, now)

  // Cancelled months are not part of anyone's record — there was no obligation.
  const real = timeline.filter(s => s.outcome !== 'voided')
  const due = real.filter(s => s.dueDate <= today)
  const settled = due.filter(s => s.outcome === 'on_time' || s.outcome === 'late' || s.outcome === 'clearing')
  const lateOnes = due.filter(s => s.outcome === 'late')
  const overdue = due.filter(s => s.outcome === 'overdue')

  // Counted forwards over the settled months, so what survives is the run that
  // reaches the most recent payment — the only one a landlord means by "lately".
  let streak = 0
  for (const s of settled) {
    if (s.outcome === 'late') streak = 0
    else streak += 1
  }

  const oldest = overdue[0] ?? null
  const nextStop = real.find(s => s.dueDate > today) ?? null
  const lastSettled = [...settled].filter(s => s.settledOn)
    .sort((a, b) => (a.settledOn ?? '').localeCompare(b.settledOn ?? '')).pop() ?? null

  // On time counts a clearing debit: it was sent, and the bank's lag is not the
  // tenant's doing. Whether it was sent *late* is already in its outcome.
  const onTime = settled.length - lateOnes.length

  return {
    today,
    standing: standingOf(
      charges,
      oldest ? { dueDate: oldest.dueDate, daysLate: oldest.daysLate } : null,
      overdue.length,
      due.length,
    ),
    monthsDue: due.length,
    onTime,
    paidLate: lateOnes.length,
    open: overdue.length,
    onTimeRate: due.length > 0 ? Math.round((onTime / due.length) * 100) : null,
    avgDaysLate: lateOnes.length > 0
      ? Math.round(lateOnes.reduce((s, r) => s + r.daysLate, 0) / lateOnes.length)
      : 0,
    worstDaysLate: due.reduce((m, r) => Math.max(m, r.daysLate), 0),
    streak,
    rentOwed: round2(charges.owed.reduce((s, r) => s + r.amount, 0)),
    lateFeeOwed: charges.lateFeeTotal,
    totalOwed: charges.totalOwed,
    waived: round2(charges.waived.reduce((s, w) => s + w.amount, 0)),
    collected: round2(due.reduce((s, r) => s + r.paid, 0)),
    billed: round2(due.reduce((s, r) => s + r.amount, 0)),
    oldestOverdue: oldest ? { dueDate: oldest.dueDate, daysLate: oldest.daysLate } : null,
    nextDue: nextStop ? { dueDate: nextStop.dueDate, amount: nextStop.amount } : null,
    lastPayment: lastSettled?.settledOn
      ? { date: lastSettled.settledOn, amount: lastSettled.paid }
      : null,
    timeline,
    charges,
  }
}

// ─── What a warning may say ──────────────────────────────────────────────────

/** One line a warning is allowed to chase. */
export type WarningLine = {
  kind: 'rent' | 'charge' | 'late_fee'
  /** The row it came from: `scheduled_payments.id`, or `special_payments.id`. */
  id: string
  label: string
  dueDate: string
  amount: number
  daysLate: number
  /** `late_fee` only: the rent underneath has already been settled. */
  rentSettled?: boolean
}

export type WarningBasis = {
  asOf: string
  rent: WarningLine[]
  charges: WarningLine[]
  fees: WarningLine[]
  rentTotal: number
  chargeTotal: number
  feeTotal: number
  total: number
  /** How late the oldest line is. The number the notice leads with. */
  oldestDaysLate: number
  /**
   * False when nothing is past due — and the send route refuses on it.
   *
   * There is no such thing as a warning about rent that is not late. Rent due
   * today is owed and is not late (the tenant has the whole day), so a landlord
   * who opens this page on the 1st must not be able to post a first notice
   * about that morning's rent.
   */
  sendable: boolean
}

/**
 * Exactly what a late-rent warning is entitled to chase, and nothing else.
 *
 * Built from `tenantCharges` so the figures are the portal's figures, then
 * filtered down to what has genuinely gone past its due day. Both the preview
 * and the send call this, so what the landlord approves is what is posted.
 */
export function warningBasis(
  scheduled: TenantScheduledRow[],
  specials: TenantSpecialRow[],
  rule: LateFeeRuleLike | null | undefined,
  now: Date = new Date(),
): WarningBasis {
  const today = billingToday(now)
  const charges = tenantCharges(scheduled, specials, rule, now)
  const dueDates = new Map<string, string>([
    ...scheduled.map(r => [r.id, r.due_date] as [string, string]),
    ...specials.flatMap(r => (r.due_date ? [[r.id, r.due_date] as [string, string]] : [])),
  ])

  const rent: WarningLine[] = []
  const chargeLines: WarningLine[] = []

  for (const c of charges.owed) {
    const dueDate = dueDates.get(c.id)
    // A one-off with no date at all has no deadline to have missed.
    if (!dueDate || !isPastDue(dueDate, now)) continue
    const line: WarningLine = {
      kind: c.kind === 'special' ? 'charge' : 'rent',
      id: c.id,
      label: c.kind === 'special' ? c.label : `${monthOf(dueDate)} rent`,
      dueDate,
      amount: c.amount,
      daysLate: daysPastDueOn(dueDate, today),
    }
    ;(line.kind === 'rent' ? rent : chargeLines).push(line)
  }

  const fees: WarningLine[] = charges.lateFees.map(f => ({
    kind: 'late_fee' as const,
    id: f.id,
    label: `Late fee — ${f.label}`,
    dueDate: dueDates.get(f.id) ?? today,
    amount: f.lateFee,
    daysLate: f.daysLate,
    rentSettled: f.rentSettled,
  }))

  const sum = (rows: WarningLine[]) => round2(rows.reduce((s, r) => s + r.amount, 0))
  const rentTotal = sum(rent)
  const chargeTotal = sum(chargeLines)
  const feeTotal = sum(fees)

  return {
    asOf: today,
    rent, charges: chargeLines, fees,
    rentTotal, chargeTotal, feeTotal,
    total: round2(rentTotal + chargeTotal + feeTotal),
    oldestDaysLate: Math.max(0, ...rent.map(r => r.daysLate), ...chargeLines.map(r => r.daysLate)),
    // A fee on rent that has already settled is a real debt, but it is not a
    // *late rent* warning: the rent arrived. On its own it belongs in the late
    // fee reminder, which explains the arithmetic. So a notice needs something
    // actually unpaid behind it.
    sendable: rent.length > 0 || chargeLines.length > 0,
  }
}
