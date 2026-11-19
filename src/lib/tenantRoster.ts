/**
 * The tenant list, as a roster of tenancies rather than a table of contacts.
 *
 * ── The problem this solves ─────────────────────────────────────────────────
 *
 * The Tenants page used to be an address book. It showed a name, an email, a
 * phone number, a status the landlord typed in by hand, and five stars. None
 * of that is what a landlord opens the page to find out, and worse, the one
 * field that looked authoritative — `tenants.status` — is a free-standing
 * label nothing maintains. A tenant whose lease ended in May still reads
 * "Active" until somebody remembers to change it, and a tenant signed last
 * week reads "Pending" for the same reason.
 *
 * So this module stops asking the column and works it out: a tenant is active
 * because a lease with their name on it is running *today*, and what they owe
 * is what the rent rows on their payment plan say. The typed status survives
 * only as a filter on the conventional list, where it is honest about being a
 * label.
 *
 * ── The join, stated plainly ────────────────────────────────────────────────
 *
 * There is no foreign key from a `tenants` row to the money. Three hops:
 *
 *   1. **tenant → lease.** `lease_tenants.tenant_id` when it is set (the only
 *      real reference), else email case-insensitively, else the full name.
 *      Which one was used is reported in `linkage`, so the UI can say "matched
 *      by name" rather than implying a certainty it does not have.
 *   2. **tenant → payer.** A payer on a payment plan is `payment_plan_tenants`,
 *      which has no `tenant_id` either. Email, case-insensitively, anywhere in
 *      the portfolio; the **name** is only tried on plans sitting on a lease
 *      the tenant is already on. This is deliberately the same rule as
 *      `tenantDossierServer.ts` — the list and the tenant's own page must not
 *      disagree about whose rent is whose.
 *   3. **payer → money.** Only ever through the money engine: `rentTotals`,
 *      `chargeTotals` and `lateFeeDue` from `financialsRollup`, the same calls
 *      Financials makes. Nothing here adds up a charge itself, and nothing
 *      here reads `late_fees_applied` (it is corrupt — see `lateFeeDue`).
 *
 * ── What "active" means ─────────────────────────────────────────────────────
 *
 * A tenancy is live when its lease is running or starts within the next 30
 * days, and the payer has not been terminated off the plan. A tenant with no
 * lease at all is not active, however their status column reads — they are
 * listed separately as unplaced, because a contact with no tenancy is a real
 * thing (a lead who has agreed terms) and hiding them would lose them.
 *
 * Demo leases are rehearsals and are left out of the roster entirely, exactly
 * as Financials leaves them out of money.
 */

import type { Tenant } from '@/lib/tenants'
import type { Lease } from '@/lib/leases'
import type { PaymentPlan, PaymentPlanTenant, ScheduledPayment } from '@/lib/payments'
import {
  rentTotals, chargeTotals, sumTotals, EMPTY_TOTALS, ALL_TIME, scopeRange,
  stageOf, lateFeeDue, billingToday, daysBetweenDates,
  type Totals, type LeaseStage,
} from '@/lib/financialsRollup'

// ─── SHAPES ──────────────────────────────────────────────────────────────────

/** How a tenant record was tied to a lease. `none` = no lease found. */
export type Linkage = 'reference' | 'email' | 'name' | 'none'

export const LINKAGE_NOTE: Record<Linkage, string | null> = {
  reference: null,
  email: 'Matched to this lease by email address',
  name: 'Matched to this lease by name — add their email to the lease to be sure',
  none: null,
}

/** The money half of a tenancy: this one payer on this one plan. */
export type RosterMoney = {
  planId: string
  planTenantId: string
  planName: string
  dueDay: number
  /** What they owe each month, as the plan has it. */
  monthly: number
  /** What that figure is made of. */
  lineItems: { label: string; category: string; amount: number }[]
  payerStatus: PaymentPlanTenant['status']
  /**
   * Their rent **up to today** — every charge that has actually been asked
   * for, and none that has not.
   *
   * Deliberately not the whole term. A twelve-month schedule has eleven
   * unpaid rows in it on day one, so a whole-term `outstanding` is the rest of
   * the contract, not a balance; printing it as one told a landlord their
   * best tenant owed $9,900. What is owed is what has come due.
   */
  toDate: Totals
  /** The whole term, for the contract figures only — never for a balance. */
  term: Totals
  /** Deposits and one-off charges asked for up to today. */
  charges: Totals
  /** Late fees genuinely accrued on their rent, derived from the rule. */
  lateFeesDue: number
  nextDue: { date: string; amount: number } | null
  lastPaid: { date: string; amount: number } | null
  /** How this payer was matched to the tenant record. */
  matchedBy: 'email' | 'name'
}

/** One lease this tenant is on, with the money that rides on it. */
export type RosterTenancy = {
  leaseId: string
  propertyId: string
  propertyName: string
  propertySlug: string | null
  unitNumber: string | null
  startDate: string
  endDate: string
  stage: LeaseStage
  /** How far through the term we are, 0–100. */
  termProgress: number
  /** Whole days until the lease ends. Negative once it has. */
  daysLeft: number
  /** Whole days until it starts. Negative once it has. */
  startsInDays: number
  /** The lease's own contracted rent, which is not always the plan's figure. */
  rentAmount: number | null
  /** The other names on the same lease — who they actually live with. */
  housemates: string[]
  documentCount: number
  linkage: Linkage
  /** Null when no payment plan has been built for this lease yet. */
  money: RosterMoney | null
}

/**
 * Where a tenant stands, in one word.
 *
 * Ordered by what a landlord must act on first. `clearing` is money the tenant
 * has already sent that has not landed — it must never read as unpaid, or the
 * page invites a landlord to chase a payment that has been made.
 */
export type Standing = 'overdue' | 'due' | 'clearing' | 'current' | 'no_plan' | 'unplaced' | 'ended'

export const STANDING_META: Record<Standing, {
  label: string
  tone: 'good' | 'bad' | 'warn' | 'idle' | 'info'
  hint: string
}> = {
  overdue:  { label: 'Past due',   tone: 'bad',  hint: 'Rent or a charge is past its due date' },
  due:      { label: 'Owing',      tone: 'warn', hint: 'Something is billed and not yet paid' },
  clearing: { label: 'Clearing',   tone: 'info', hint: 'Paid by bank transfer, still settling' },
  current:  { label: 'Paid up',    tone: 'good', hint: 'Everything that has come due is settled' },
  no_plan:  { label: 'No plan',    tone: 'warn', hint: 'On a lease with no payment plan behind it' },
  unplaced: { label: 'No lease',   tone: 'idle', hint: 'No tenancy on file yet' },
  ended:    { label: 'Moved out',  tone: 'idle', hint: 'Every lease on file has ended' },
}

export type RosterEntry = {
  tenant: Tenant
  /** Every tenancy found, current first, then upcoming, then most recent past. */
  tenancies: RosterTenancy[]
  /** The one the card speaks for — the live tenancy, or the latest that was. */
  lead: RosterTenancy | null
  /** A lease running now, or starting inside 30 days. */
  live: boolean
  standing: Standing
  /** Combined across live tenancies: this is what the card's figures show. */
  monthly: number
  outstanding: number
  overdue: number
  inFlight: number
  lateFeesDue: number
  /** Everything owed right now — rent shortfall plus accrued fees. */
  totalDue: number
  nextDue: { date: string; amount: number } | null
  lastPaid: { date: string; amount: number } | null
  /** Of the rent that has come due, how much arrived. 0–100, null if none. */
  payRate: number | null
  /** Settled payments that arrived after their due date, and the worst of them. */
  lateCount: number
  worstDaysLate: number
  /** How loudly this row is asking to be looked at. Higher sorts first. */
  urgency: number
}

export type TenantRoster = {
  /** The default view: a live tenancy, sorted by who needs attention. */
  active: RosterEntry[]
  /** Contacts with no tenancy on file — shown, never hidden. */
  unplaced: RosterEntry[]
  /** Everybody whose leases have all ended. */
  past: RosterEntry[]
  /** Every entry, for the conventional list. */
  all: RosterEntry[]
  totals: {
    tenants: number
    active: number
    monthly: number
    outstanding: number
    overdue: number
    overdueTenants: number
    /** Live tenancies inside their last 60 days. */
    endingSoon: number
    /** Live tenancies with no payment plan behind them. */
    withoutPlan: number
    unplaced: number
    /** Rent collected against rent billed across every live tenancy, 0–100. */
    collectionRate: number | null
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

const fullName = (t: Pick<Tenant, 'first_name' | 'last_name'>) =>
  [t.first_name, t.last_name].filter(Boolean).join(' ').trim()

/** A lease is "ending" inside its last two months — the renewal window. */
const ENDING_SOON_DAYS = 60
/** A lease starting inside a month is a tenancy you are already managing. */
const STARTING_SOON_DAYS = 30

const money = (n: number) => Math.round(n * 100) / 100

/** Rent rows belonging to one payer. */
const rowsOf = (plan: PaymentPlan, planTenantId: string): ScheduledPayment[] =>
  (plan.scheduled_payments ?? []).filter(sp => sp.plan_tenant_id === planTenantId)

// ─── THE ROSTER ──────────────────────────────────────────────────────────────

export function buildTenantRoster(
  tenants: Tenant[],
  leases: Lease[],
  plans: PaymentPlan[],
  now = new Date(),
): TenantRoster {
  const today = billingToday(now)
  // Everything asked for so far, and nothing that has not been. See
  // `RosterMoney.toDate`.
  const toDateRange = scopeRange('todate', now)

  // A rehearsal is not a tenancy. The database forbids a plan on a demo lease,
  // so this is the lease that got flagged after the fact.
  const realLeases = leases.filter(l => !l.is_demo)
  const plansByLease = new Map<string, PaymentPlan[]>()
  for (const p of plans) {
    if (!p.lease_id) continue
    const list = plansByLease.get(p.lease_id)
    if (list) list.push(p)
    else plansByLease.set(p.lease_id, [p])
  }

  const entries = tenants.map(tenant =>
    entryFor(tenant, realLeases, plans, plansByLease, today, toDateRange, now),
  )

  const active = entries
    .filter(e => e.live)
    .sort((a, b) => b.urgency - a.urgency || (a.lead?.daysLeft ?? 0) - (b.lead?.daysLeft ?? 0))
  const unplaced = entries
    .filter(e => !e.live && e.tenancies.length === 0)
    .sort((a, b) => (b.tenant.created_at ?? '').localeCompare(a.tenant.created_at ?? ''))
  const past = entries
    .filter(e => !e.live && e.tenancies.length > 0)
    .sort((a, b) => (b.lead?.endDate ?? '').localeCompare(a.lead?.endDate ?? ''))

  const liveBilled = active.reduce((s, e) => s + liveRentTotals(e).billed, 0)
  const liveCollected = active.reduce((s, e) => s + liveRentTotals(e).collected, 0)

  return {
    active, unplaced, past,
    all: [...active, ...unplaced, ...past],
    totals: {
      tenants: entries.length,
      active: active.length,
      monthly: money(active.reduce((s, e) => s + e.monthly, 0)),
      outstanding: money(active.reduce((s, e) => s + e.outstanding, 0)),
      overdue: money(active.reduce((s, e) => s + e.overdue, 0)),
      overdueTenants: active.filter(e => e.overdue > 0).length,
      endingSoon: active.filter(e =>
        e.lead !== null && e.lead.daysLeft >= 0 && e.lead.daysLeft <= ENDING_SOON_DAYS).length,
      withoutPlan: active.filter(e => e.lead !== null && e.lead.money === null).length,
      unplaced: unplaced.length,
      collectionRate: liveBilled > 0 ? Math.round((liveCollected / liveBilled) * 100) : null,
    },
  }
}

/** Term rent across a tenant's live tenancies — the basis of the pay rate. */
function liveRentTotals(e: RosterEntry): Totals {
  const parts = e.tenancies
    .filter(t => t.money !== null && isLive(t))
    .map(t => (t.money as RosterMoney).toDate)
  return parts.length > 0 ? sumTotals(parts) : EMPTY_TOTALS
}

// ─── ONE TENANT ──────────────────────────────────────────────────────────────

function entryFor(
  tenant: Tenant,
  leases: Lease[],
  plans: PaymentPlan[],
  plansByLease: Map<string, PaymentPlan[]>,
  today: string,
  toDateRange: { from: string | null; to: string | null },
  now: Date,
): RosterEntry {
  const email = lower(tenant.email)
  const name = lower(fullName(tenant))

  // ── 1. The leases with this person on them ────────────────────────────────
  const mine: { lease: Lease; linkage: Linkage }[] = []
  for (const lease of leases) {
    let linkage: Linkage = 'none'
    for (const lt of lease.tenants ?? []) {
      if (lt.tenant_id && lt.tenant_id === tenant.id) { linkage = 'reference'; break }
      if (email && lower(lt.email) === email) { linkage = 'email'; continue }
      if (linkage === 'none' && name && lower(lt.name) === name) linkage = 'name'
    }
    if (linkage !== 'none') mine.push({ lease, linkage })
  }
  const myLeaseIds = new Set(mine.map(m => m.lease.id))

  // ── 2. The payer rows that are theirs ─────────────────────────────────────
  // Email anywhere; name only on a plan sitting on one of their own leases.
  // Same rule as the dossier — see the file note.
  const payerOn = (plan: PaymentPlan): { payer: PaymentPlanTenant; matchedBy: 'email' | 'name' } | null => {
    if (email) {
      const byEmail = plan.tenants.find(t => lower(t.email) === email)
      if (byEmail) return { payer: byEmail, matchedBy: 'email' }
    }
    if (name && myLeaseIds.has(plan.lease_id)) {
      const byName = plan.tenants.find(t => lower(t.name) === name)
      if (byName) return { payer: byName, matchedBy: 'name' }
    }
    return null
  }

  // ── 3. A tenancy per lease ────────────────────────────────────────────────
  const tenancies: RosterTenancy[] = mine.map(({ lease, linkage }) => {
    const stage = stageOf(lease.start_date, lease.end_date, today)
    const daysLeft = daysBetweenDates(today, lease.end_date)
    const startsIn = daysBetweenDates(today, lease.start_date)
    const a = new Date(lease.start_date + 'T00:00:00').getTime()
    const b = new Date(lease.end_date + 'T00:00:00').getTime()
    const t = new Date(today + 'T00:00:00').getTime()
    const termProgress = b > a ? Math.max(0, Math.min(100, Math.round(((t - a) / (b - a)) * 100))) : 0

    let found: RosterMoney | null = null
    for (const plan of plansByLease.get(lease.id) ?? []) {
      const hit = payerOn(plan)
      if (!hit) continue
      found = moneyFor(plan, hit.payer, hit.matchedBy, toDateRange, today, now)
      break
    }

    return {
      leaseId: lease.id,
      propertyId: lease.property_id,
      propertyName: lease.property?.name ?? 'Unnamed property',
      propertySlug: lease.property?.slug ?? null,
      unitNumber: lease.unit_number,
      startDate: lease.start_date,
      endDate: lease.end_date,
      stage,
      termProgress,
      daysLeft,
      startsInDays: startsIn,
      rentAmount: lease.rent_amount,
      housemates: (lease.tenants ?? [])
        .filter(lt => !(lt.tenant_id === tenant.id || lower(lt.email) === email || lower(lt.name) === name))
        .map(lt => lt.name || lt.email || '')
        .filter(Boolean),
      documentCount: (lease.documents ?? []).length,
      linkage,
      money: found,
    }
  })

  // A tenant with no lease may still be a payer somewhere — a plan built
  // before the lease was recorded. Carrying their money on a pseudo-tenancy
  // would be inventing a tenancy, so it is left to the detail page; here they
  // simply read as unplaced.

  // Current first, then the soonest to start, then the most recently ended.
  const rank = (t: RosterTenancy) =>
    t.stage === 'ended' ? 2 : t.stage === 'upcoming' ? 1 : 0
  tenancies.sort((x, y) =>
    rank(x) - rank(y) ||
    (rank(x) === 2
      ? y.endDate.localeCompare(x.endDate)
      : x.startDate.localeCompare(y.startDate)))

  const liveOnes = tenancies.filter(t => isLive(t))
  const live = liveOnes.length > 0
  const lead = (live ? liveOnes[0] : tenancies[0]) ?? null

  const payable = liveOnes.length > 0 ? liveOnes : []
  const monthly = money(payable.reduce((s, t) => s + (t.money?.monthly ?? 0), 0))
  const owedParts = payable.flatMap(t => t.money ? [t.money.toDate, t.money.charges] : [])
  const combined = owedParts.length > 0 ? sumTotals(owedParts) : EMPTY_TOTALS
  const lateFeesDue = money(payable.reduce((s, t) => s + (t.money?.lateFeesDue ?? 0), 0))

  const nextDue = payable
    .map(t => t.money?.nextDue)
    .filter((n): n is { date: string; amount: number } => !!n)
    .sort((x, y) => x.date.localeCompare(y.date))[0] ?? null
  const lastPaid = payable
    .map(t => t.money?.lastPaid)
    .filter((n): n is { date: string; amount: number } => !!n)
    .sort((x, y) => y.date.localeCompare(x.date))[0] ?? null

  const standing = standingOf({
    live,
    hasLease: tenancies.length > 0,
    hasPlan: payable.some(t => t.money !== null),
    totals: combined,
    lateFeesDue,
  })

  return {
    tenant,
    tenancies,
    lead,
    live,
    standing,
    monthly,
    outstanding: combined.outstanding,
    overdue: combined.overdue,
    inFlight: combined.inFlight,
    lateFeesDue,
    totalDue: money(combined.outstanding + lateFeesDue),
    nextDue,
    lastPaid,
    payRate: combined.rate,
    lateCount: combined.collectedLateCount,
    worstDaysLate: combined.maxDaysLate,
    // Money past due dominates; the number of separate late charges and the
    // remaining balance break ties — the same ranking Financials uses, so a
    // landlord reading both screens sees the same person at the top.
    urgency: combined.overdue * 1000 + combined.overdueCount * 100 + combined.outstanding
      + (live && payable.every(t => t.money === null) ? 50 : 0),
  }
}

/** Running now, or starting inside a month, and not terminated off the plan. */
function isLive(t: RosterTenancy): boolean {
  if (t.money && t.money.payerStatus === 'terminated') return false
  if (t.stage === 'ended') return false
  if (t.stage === 'upcoming') return t.startsInDays <= STARTING_SOON_DAYS
  return true
}

function standingOf({
  live, hasLease, hasPlan, totals, lateFeesDue,
}: {
  live: boolean
  hasLease: boolean
  hasPlan: boolean
  totals: Totals
  lateFeesDue: number
}): Standing {
  if (!hasLease) return 'unplaced'
  if (!live) return 'ended'
  if (!hasPlan) return 'no_plan'
  if (totals.overdue > 0 || lateFeesDue > 0) return 'overdue'
  if (totals.inFlight > 0) return 'clearing'
  if (totals.outstanding > 0) return 'due'
  return 'current'
}

// ─── ONE PAYER'S MONEY ───────────────────────────────────────────────────────

function moneyFor(
  plan: PaymentPlan,
  payer: PaymentPlanTenant,
  matchedBy: 'email' | 'name',
  toDateRange: { from: string | null; to: string | null },
  today: string,
  now: Date,
): RosterMoney {
  const rows = rowsOf(plan, payer.id)
  const specials = (plan.special_payments ?? []).filter(sp => sp.plan_tenant_id === payer.id)
  const rule = plan.late_fee_rule ?? null

  const upcoming = rows
    .filter(sp => sp.status !== 'voided' && sp.due_date >= today && sp.paid_amount < sp.amount)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
  const nextDue = upcoming.length > 0
    ? {
        date: upcoming[0].due_date,
        amount: money(upcoming
          .filter(sp => sp.due_date === upcoming[0].due_date)
          .reduce((s, sp) => s + (sp.amount - sp.paid_amount), 0)),
      }
    : null

  const paid = rows
    .filter(sp => sp.paid_date && sp.paid_amount > 0)
    .sort((a, b) => (b.paid_date ?? '').localeCompare(a.paid_date ?? ''))

  return {
    planId: plan.id,
    planTenantId: payer.id,
    planName: plan.name,
    dueDay: plan.due_day,
    monthly: payer.monthly_total,
    lineItems: (payer.line_items ?? []).map(li => ({
      label: li.label, category: li.category, amount: li.amount,
    })),
    payerStatus: payer.status,
    toDate: rentTotals(rows, toDateRange, now),
    term: rentTotals(rows, ALL_TIME, now),
    charges: chargeTotals(specials, toDateRange, now),
    // Derived from the rule, never read from the corrupt column.
    lateFeesDue: money(rows.reduce((s, sp) => s + lateFeeDue(rule, sp, now), 0)),
    nextDue,
    lastPaid: paid.length > 0
      ? { date: paid[0].paid_date as string, amount: paid[0].paid_amount }
      : null,
    matchedBy,
  }
}

// ─── SEARCH / FILTER, shared by both views ───────────────────────────────────

export type RosterFilter = 'all' | 'arrears' | 'ending' | 'no_plan'

export const FILTERS: { id: RosterFilter; label: string }[] = [
  { id: 'all',     label: 'Everyone' },
  { id: 'arrears', label: 'Owing' },
  { id: 'ending',  label: 'Ending soon' },
  { id: 'no_plan', label: 'No plan' },
]

export function applyFilter(entries: RosterEntry[], filter: RosterFilter): RosterEntry[] {
  switch (filter) {
    case 'arrears': return entries.filter(e => e.totalDue > 0)
    case 'ending':  return entries.filter(e =>
      e.lead !== null && e.lead.daysLeft >= 0 && e.lead.daysLeft <= ENDING_SOON_DAYS)
    case 'no_plan': return entries.filter(e => e.lead !== null && e.lead.money === null)
    default:        return entries
  }
}

/** Name, email, phone, property and unit — whatever a landlord would type. */
export function matchesQuery(e: RosterEntry, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const hay = [
    fullName(e.tenant),
    e.tenant.email,
    e.tenant.phone ?? '',
    ...e.tenancies.map(t => t.propertyName),
    ...e.tenancies.map(t => t.unitNumber ?? ''),
    ...e.tenancies.flatMap(t => t.housemates),
  ].join(' ').toLowerCase()
  return hay.includes(needle)
}

export { fullName as tenantFullName, ENDING_SOON_DAYS }
