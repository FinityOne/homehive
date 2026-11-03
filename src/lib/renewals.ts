// Renewals and turnover: the decision a student landlord makes once a year,
// and the one the portal used to leave them alone with.
//
// The Overview tile has always counted leases "expiring within 60 days". That
// count was the end of it — no way to ask the tenant, no record of having
// asked, no answer kept. Which means the single largest number in a student
// landlord's year, whether the same twelve rooms are full again in August, was
// managed in somebody's head.
//
// Everything here is pure and date-driven. Three ideas it is built on:
//
//   • **The window is early.** ASU renters decide in spring for an August
//     move, so asking a sitting tenant 30 days out is not a renewal
//     conversation, it is a goodbye. The stages below open the conversation at
//     four months and get loud at six weeks, because at six weeks every good
//     replacement renter in Tempe has already signed somewhere else.
//
//   • **Expiry is arithmetic, never a stored flag.** `renewalState` derives
//     "expired" from `respond_by` every time it is asked. The project has
//     already paid for the other approach once: `late_fees_applied` was a
//     stored boolean that drifted from the facts and every reader that trusted
//     it was wrong.
//
//   • **The vacancy is the real number.** A landlord holding out for $40 more
//     is risking a month at $900 to win $480 over a year, and almost nobody
//     does that arithmetic in their head — they feel the $40 and not the
//     month. `turnoverMath` does it for them and states the breakeven in days,
//     which is the only form of the answer that changes behaviour.

import { billingToday } from './rentPayments'

// ── Stages ───────────────────────────────────────────────────────────────────

/**
 * When the renewal conversation should open, in days before the lease ends.
 *
 * Four months. For a lease ending 31 July that is early April, which is when
 * ASU students actually decide where they are living in the fall — ask in June
 * and they signed a place in April.
 */
export const WINDOW_OPENS_DAYS = 120

/**
 * Below this, re-leasing to somebody new gets expensive and unlikely.
 *
 * Six weeks. The students who plan ahead are gone by now, so a decline here
 * means marketing into the leftovers, which in this market is where
 * concessions and short vacancies come from.
 */
export const URGENT_DAYS = 45

/** Below this, a decline is very likely a vacancy. */
export const CRITICAL_DAYS = 15

export type RenewalStage = 'early' | 'open' | 'urgent' | 'critical' | 'ended'

export const STAGE_META: Record<RenewalStage, {
  label: string
  blurb: string
  color: string
  bg: string
  border: string
  /** Sort weight: lower is more pressing. */
  rank: number
}> = {
  critical: {
    label: 'Critical',
    blurb: 'Under two weeks left. A decline now almost certainly means an empty room.',
    color: '#991b1b', bg: '#fef2f2', border: '#dc2626', rank: 0,
  },
  urgent: {
    label: 'Urgent',
    blurb: 'Under six weeks. The renters who plan ahead have already signed elsewhere.',
    color: '#92400e', bg: '#fffbeb', border: '#f59e0b', rank: 1,
  },
  open: {
    label: 'Ask now',
    blurb: 'The renewal window is open — this is when students decide.',
    color: '#1e40af', bg: '#eff6ff', border: '#3b82f6', rank: 2,
  },
  ended: {
    label: 'Ended',
    blurb: 'The lease is over. Renewing now is a new tenancy, not a renewal.',
    color: '#475569', bg: '#f8fafc', border: '#94a3b8', rank: 3,
  },
  early: {
    label: 'Not yet',
    blurb: 'Too far out to ask — a tenant cannot answer honestly this early.',
    color: '#64748b', bg: '#f8fafc', border: '#cbd5e1', rank: 4,
  },
}

/** A `YYYY-MM-DD` date as a UTC-midnight instant, for day arithmetic only. */
function dayMs(date: string): number {
  return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))
}

/** Whole days between two `YYYY-MM-DD` dates. Negative when `to` is earlier. */
export function daysBetweenDates(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / 86_400_000)
}

/**
 * Whole days from today to a `YYYY-MM-DD` date.
 *
 * "Today" is the Phoenix calendar day, not UTC. The project has been bitten by
 * this before: UTC rolls over at 5pm local, which marked things due tomorrow as
 * due today for a third of every afternoon. Same rule as rent — see
 * `billingToday`.
 */
export function daysUntil(date: string, now = new Date()): number {
  return daysBetweenDates(billingToday(now), date)
}

export function stageFor(endDate: string, now = new Date()): RenewalStage {
  const d = daysUntil(endDate, now)
  if (d < 0) return 'ended'
  if (d <= CRITICAL_DAYS) return 'critical'
  if (d <= URGENT_DAYS) return 'urgent'
  if (d <= WINDOW_OPENS_DAYS) return 'open'
  return 'early'
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export type RenewalStatus = 'sent' | 'accepted' | 'declined' | 'withdrawn'

export type Renewal = {
  id: string
  lease_id: string
  owner_id: string
  property_id: string | null
  new_rent: number
  new_start_date: string
  new_end_date: string
  respond_by: string
  message: string | null
  status: RenewalStatus
  tenant_name: string | null
  tenant_email: string
  token: string
  sent_at: string
  responded_at: string | null
  response_note: string | null
  renewal_lease_id: string | null
  created_at: string
  updated_at: string
}

/** The lease fields a renewal reasons about. */
export type RenewalLease = {
  id: string
  property_id: string
  start_date: string
  end_date: string
  rent_amount: number | null
  unit_number: string | null
  is_demo: boolean
  property?: { id: string; name: string; slug: string } | null
  tenants: Array<{ id: string; name: string | null; email: string | null }>
}

/**
 * What is true of this lease's renewal right now.
 *
 * `expired` is computed here and nowhere else. `converted` outranks `accepted`
 * because once the new lease exists the offer is finished business — leaving it
 * in the "needs converting" pile would have a landlord sign the same tenant
 * twice.
 */
export type RenewalState =
  | 'none' | 'awaiting' | 'expired' | 'accepted' | 'converted' | 'declined' | 'withdrawn'

export function renewalState(r: Renewal | null | undefined, now = new Date()): RenewalState {
  if (!r) return 'none'
  if (r.status === 'accepted') return r.renewal_lease_id ? 'converted' : 'accepted'
  if (r.status === 'declined') return 'declined'
  if (r.status === 'withdrawn') return 'withdrawn'
  return daysUntil(r.respond_by, now) < 0 ? 'expired' : 'awaiting'
}

export const STATE_META: Record<RenewalState, { label: string; color: string; bg: string }> = {
  none:      { label: 'Not asked',      color: '#64748b', bg: '#f1f5f9' },
  awaiting:  { label: 'Awaiting reply', color: '#1e40af', bg: '#eff6ff' },
  expired:   { label: 'Offer expired',  color: '#92400e', bg: '#fffbeb' },
  accepted:  { label: 'Accepted',       color: '#065f46', bg: '#ecfdf5' },
  converted: { label: 'Renewed',        color: '#065f46', bg: '#d1fae5' },
  declined:  { label: 'Declined',       color: '#991b1b', bg: '#fef2f2' },
  withdrawn: { label: 'Withdrawn',      color: '#475569', bg: '#f8fafc' },
}

// ── The money ────────────────────────────────────────────────────────────────

/** Average days in a month. Used to turn a monthly rent into a daily one. */
const DAYS_PER_MONTH = 30.44

export type TurnoverMath = {
  currentRent: number
  proposedRent: number
  /** Months in the proposed term, rounded. */
  termMonths: number
  /** Extra rent the increase earns over the whole proposed term. */
  termGain: number
  /** What one empty month costs, at the rent you would be re-letting at. */
  monthlyVacancyCost: number
  /**
   * Days of vacancy that wipe out `termGain` entirely.
   *
   * Null when the offer asks for no more than the tenant pays now — there is
   * nothing to lose, so there is no breakeven to state.
   */
  breakevenVacancyDays: number | null
  /** One sentence a landlord can act on. */
  verdict: string
}

/**
 * The trade the landlord is actually making.
 *
 * Deliberately stated in days of vacancy rather than in dollars. "$480 a year
 * against $900 a month" is two numbers a landlord has to relate themselves;
 * "this increase is wiped out by 16 days empty" is the decision.
 */
export function turnoverMath(args: {
  currentRent: number
  proposedRent: number
  termStart: string
  termEnd: string
  /** What you would re-let at if they leave. Falls back to the current rent. */
  marketRent?: number | null
}): TurnoverMath {
  const { currentRent, proposedRent } = args
  // Straight date-to-date arithmetic: the term's length has nothing to do with
  // what day it is today, so it must not go anywhere near a timezone.
  const months = Math.max(1, Math.round(daysBetweenDates(args.termStart, args.termEnd) / DAYS_PER_MONTH))
  const termGain = Math.round((proposedRent - currentRent) * months)
  const relet = args.marketRent && args.marketRent > 0 ? args.marketRent : currentRent
  const daily = relet / DAYS_PER_MONTH
  const breakeven = termGain > 0 && daily > 0 ? Math.round(termGain / daily) : null

  let verdict: string
  if (termGain <= 0) {
    verdict = proposedRent === currentRent
      ? `Same rent for another ${months} months, with no vacancy, no make-ready and no marketing. For a tenant who pays on time this is usually the best outcome available.`
      : `A $${Math.abs(proposedRent - currentRent).toLocaleString()}/mo reduction, worth $${Math.abs(termGain).toLocaleString()} over the term — worth it only if you believe they would otherwise leave and the room would sit.`
  } else if (breakeven != null && breakeven <= 14) {
    verdict = `The increase earns $${termGain.toLocaleString()} over ${months} months and ${breakeven} days empty erases all of it. At that margin you are gambling the whole gain on them not walking.`
  } else if (breakeven != null && breakeven <= 45) {
    verdict = `The increase earns $${termGain.toLocaleString()} over ${months} months; it breaks even against ${breakeven} days of vacancy. Reasonable if you would genuinely re-let quickly, and this is a market where August is easy and November is not.`
  } else {
    verdict = `The increase earns $${termGain.toLocaleString()} over ${months} months and would survive ${breakeven} days of vacancy. The rent is not what is at risk here.`
  }

  return {
    currentRent, proposedRent,
    termMonths: months,
    termGain,
    monthlyVacancyCost: Math.round(relet),
    breakevenVacancyDays: breakeven,
    verdict,
  }
}

/**
 * The largest rise worth putting in front of a sitting tenant, in percent.
 *
 * 5%. Not a market view — a behavioural one. A renewal is the only lease a
 * landlord gets with no vacancy, no make-ready and no marketing, and a rise
 * big enough to make the tenant shop around puts all three back on the table
 * to win a few hundred dollars. Pushing further is a decision a landlord can
 * still make; this is only what gets suggested.
 */
export const SUGGESTED_INCREASE_CAP_PCT = 5

export type RentSuggestion = {
  rent: number
  /** Percent change against the current rent, rounded. */
  changePct: number
  reasoning: string
}

/**
 * What to ask for, given the market.
 *
 * `marketRent` is the comparable monthly rent for this unit — the Performance
 * page's comp median, converted back to an asked price. Null when there are
 * not enough comps, and in that case this holds the rent rather than inventing
 * a rise: a number with nothing behind it is worse than no suggestion, because
 * the landlord will believe it.
 */
export function suggestRenewalRent(
  currentRent: number,
  marketRent: number | null | undefined
): RentSuggestion {
  if (!currentRent || currentRent <= 0) {
    return { rent: marketRent ?? 0, changePct: 0, reasoning: 'This lease has no rent on file, so there is nothing to compare against.' }
  }
  const hold = (reasoning: string): RentSuggestion => ({ rent: currentRent, changePct: 0, reasoning })

  if (!marketRent || marketRent <= 0) {
    return hold('Not enough comparable live listings to price this against, so the suggestion is to hold. Renewing at the same rent still beats a vacancy by a wide margin.')
  }

  const cap = Math.round(currentRent * (1 + SUGGESTED_INCREASE_CAP_PCT / 100))

  // Below market: move part of the way, never past market, never past the cap.
  if (marketRent > currentRent) {
    const rent = Math.min(cap, marketRent, Math.round((currentRent + marketRent) / 2))
    if (rent <= currentRent) return hold('You are already at the market rent for this kind of unit.')
    const pct = Math.round(((rent - currentRent) / currentRent) * 100)
    return {
      rent,
      changePct: pct,
      reasoning: `Comparable listings go for about $${marketRent.toLocaleString()}, so you are $${(marketRent - currentRent).toLocaleString()} under. ` +
        (rent === cap
          ? `This stops at ${SUGGESTED_INCREASE_CAP_PCT}% rather than closing the whole gap: a jump large enough to make a settled tenant start looking costs more than it collects.`
          : `This closes about half the gap, which keeps the renewal an easy yes.`),
    }
  }

  // Well above market: a sitting tenant will notice, and so will the vacancy.
  if (marketRent < currentRent * 0.9) {
    return {
      rent: Math.round((currentRent + marketRent) / 2),
      changePct: Math.round((((currentRent + marketRent) / 2 - currentRent) / currentRent) * 100),
      reasoning: `Comparable listings are around $${marketRent.toLocaleString()} — more than 10% below what this tenant pays. They can see that too. Meeting them part way is cheaper than losing them and re-letting at the market rate anyway.`,
    }
  }

  return hold(`Comparable listings are around $${marketRent.toLocaleString()}, so this rent is already at or slightly above market. Holding it is the easy yes.`)
}

// ── Default terms ────────────────────────────────────────────────────────────

/** `YYYY-MM-DD` plus n days. */
export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` plus n whole months, clamped to the end of the target month. */
export function addMonths(date: string, n: number): string {
  const y = +date.slice(0, 4), m = +date.slice(5, 7), day = +date.slice(8, 10)
  const target = new Date(Date.UTC(y, m - 1 + n, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return target.toISOString().slice(0, 10)
}

export type DefaultTerms = {
  start: string
  end: string
  respondBy: string
}

/**
 * The offer filled in before the landlord touches it.
 *
 * The new term starts the day after the old one ends — a renewal with a gap is
 * a vacancy somebody typed by accident — and runs twelve months, which is what
 * the academic year wants.
 *
 * `respond_by` is three weeks out, or sooner if the lease ends first. Three
 * weeks is long enough for a student to talk to their parents and their
 * roommates, and short enough that the answer still leaves time to re-let.
 */
export function defaultTerms(lease: Pick<RenewalLease, 'end_date'>, now = new Date()): DefaultTerms {
  const start = addDays(lease.end_date, 1)
  const end = addDays(addMonths(start, 12), -1)
  const today = billingToday(now)
  const threeWeeks = addDays(today, 21)
  // Never ask for an answer after the lease it renews has already ended.
  const respondBy = daysUntil(lease.end_date, now) > 0 && threeWeeks > lease.end_date
    ? lease.end_date
    : threeWeeks
  return { start, end, respondBy }
}

// ── The pipeline row ─────────────────────────────────────────────────────────

export type NextAction = {
  /** The button, in the imperative. */
  label: string
  /** Why it is the next thing, in one line. */
  why: string
  kind: 'send' | 'convert' | 'relist' | 'chase' | 'resend' | 'wait' | 'none'
  urgent: boolean
}

export type RenewalRow = {
  lease: RenewalLease
  renewal: Renewal | null
  stage: RenewalStage
  state: RenewalState
  daysLeft: number
  /** Days until the offer's deadline. Null when there is no live offer. */
  daysToRespond: number | null
  /** Rent at risk per month if this tenancy is not renewed. */
  rentAtRisk: number
  action: NextAction
}

/**
 * The one thing to do about this lease, and why.
 *
 * Ordered by what is irreversible. An accepted renewal that has not been
 * turned into a lease is the top of the list — the tenant has said yes and is
 * waiting, and that is the easiest money in the portal to drop. A decline
 * comes next, because the clock on re-letting started the moment it arrived.
 */
export function nextAction(
  lease: RenewalLease,
  renewal: Renewal | null,
  now = new Date()
): NextAction {
  const state = renewalState(renewal, now)
  const stage = stageFor(lease.end_date, now)
  const days = daysUntil(lease.end_date, now)

  if (state === 'accepted') {
    return {
      kind: 'convert', urgent: true,
      label: 'Create the renewed lease',
      why: 'They said yes. Nothing is signed until the new lease exists.',
    }
  }
  if (state === 'converted') {
    return { kind: 'none', urgent: false, label: 'Renewed', why: `Signed on to ${renewal?.new_end_date ?? 'the new term'}.` }
  }
  if (state === 'declined') {
    return {
      kind: 'relist', urgent: stage === 'urgent' || stage === 'critical',
      label: 'Put it back on the market',
      why: days >= 0
        ? `They are leaving and you have ${days} day${days === 1 ? '' : 's'} to fill it.`
        : 'They are gone — this room is earning nothing.',
    }
  }
  if (state === 'awaiting') {
    const left = renewal ? daysUntil(renewal.respond_by, now) : 0
    return {
      kind: left <= 3 ? 'chase' : 'wait',
      urgent: left <= 3,
      label: left <= 3 ? 'Chase the answer' : 'Awaiting their answer',
      why: left <= 0
        ? 'The deadline is today.'
        : `${left} day${left === 1 ? '' : 's'} left to reply.`,
    }
  }
  if (state === 'expired' || state === 'withdrawn') {
    return {
      kind: 'resend', urgent: stage === 'urgent' || stage === 'critical',
      label: 'Send a new offer',
      why: state === 'expired'
        ? 'The last offer lapsed with no answer. Silence is not a no.'
        : 'You pulled the last offer. Nothing is in front of them now.',
    }
  }

  // Never asked.
  if (stage === 'ended') {
    return { kind: 'none', urgent: false, label: 'Lease has ended', why: 'Too late to renew — this would be a new tenancy.' }
  }
  if (stage === 'early') {
    return {
      kind: 'none', urgent: false,
      label: 'Nothing to do yet',
      why: `${days} days out. Asking this early gets a shrug, not an answer.`,
    }
  }
  return {
    kind: 'send',
    urgent: stage === 'urgent' || stage === 'critical',
    label: 'Send a renewal offer',
    why: stage === 'critical'
      ? `${days} day${days === 1 ? '' : 's'} left. Ask today or plan for an empty room.`
      : stage === 'urgent'
        ? `${days} days left and nobody has asked them.`
        : 'The window is open — this is when students decide.',
  }
}

const STATE_RANK: Record<RenewalState, number> = {
  accepted: 0, declined: 1, expired: 2, withdrawn: 3, none: 4, awaiting: 5, converted: 6,
}

/**
 * Build the pipeline.
 *
 * Demo leases are dropped outright. A rehearsal tenancy has no tenant to email
 * and would otherwise sit at the top of a landlord's renewal list forever.
 */
export function buildPipeline(
  leases: RenewalLease[],
  renewals: Renewal[],
  now = new Date()
): RenewalRow[] {
  // Most recent offer per lease wins — earlier ones are history.
  const latest = new Map<string, Renewal>()
  for (const r of [...renewals].sort((a, b) => (a.sent_at < b.sent_at ? -1 : 1))) {
    latest.set(r.lease_id, r)
  }

  return leases
    .filter(l => !l.is_demo)
    .map(lease => {
      const renewal = latest.get(lease.id) ?? null
      const state = renewalState(renewal, now)
      return {
        lease,
        renewal,
        stage: stageFor(lease.end_date, now),
        state,
        daysLeft: daysUntil(lease.end_date, now),
        daysToRespond: renewal && state === 'awaiting' ? daysUntil(renewal.respond_by, now) : null,
        rentAtRisk: lease.rent_amount ?? 0,
        action: nextAction(lease, renewal, now),
      }
    })
    .sort((a, b) =>
      // An action waiting on the landlord beats everything, then the clock.
      Number(b.action.urgent) - Number(a.action.urgent) ||
      STATE_RANK[a.state] - STATE_RANK[b.state] ||
      STAGE_META[a.stage].rank - STAGE_META[b.stage].rank ||
      a.daysLeft - b.daysLeft
    )
}

export type PipelineSummary = {
  /** Leases inside the renewal window, however they are progressing. */
  inWindow: number
  awaiting: number
  accepted: number
  /** Accepted but not yet turned into a lease — money sitting on the table. */
  toConvert: number
  declined: number
  notAsked: number
  /** Monthly rent in leases inside the window with no answer yet. */
  rentAtRisk: number
  /** Monthly rent in leases the tenant has said they are leaving. */
  rentLeaving: number
  /** Monthly rent secured by renewals the tenant has accepted. */
  rentSecured: number
}

export function summarisePipeline(rows: RenewalRow[]): PipelineSummary {
  const inWindow = rows.filter(r => r.stage !== 'early' && r.stage !== 'ended')
  const unanswered = inWindow.filter(r => r.state === 'none' || r.state === 'awaiting' || r.state === 'expired' || r.state === 'withdrawn')
  const accepted = rows.filter(r => r.state === 'accepted' || r.state === 'converted')
  const declined = rows.filter(r => r.state === 'declined')
  return {
    inWindow: inWindow.length,
    awaiting: rows.filter(r => r.state === 'awaiting').length,
    accepted: accepted.length,
    toConvert: rows.filter(r => r.state === 'accepted').length,
    declined: declined.length,
    notAsked: inWindow.filter(r => r.state === 'none').length,
    rentAtRisk: unanswered.reduce((s, r) => s + r.rentAtRisk, 0),
    rentLeaving: declined.reduce((s, r) => s + r.rentAtRisk, 0),
    rentSecured: accepted.reduce((s, r) => s + (r.renewal?.new_rent ?? r.rentAtRisk), 0),
  }
}

/** Dates as a landlord writes them. */
export function fmtDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtRent(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}
