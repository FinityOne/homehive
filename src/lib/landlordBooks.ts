// The admin's books, read one landlord at a time.
//
// `financials.ts` answers "what did the platform keep this month?" — a single
// P&L across every payment. That is the right shape for a headline and the
// wrong shape for the question an operator asks next: *which landlord* is this
// coming from, is their rent arriving on time, and what are we actually earning
// on them? Answering that means re-grouping the same payments by owner, then by
// property, then by lease, and carrying the collection facts (what is owed,
// what is overdue, what settled late) alongside the revenue facts.
//
// Two conventions inherited from the rest of the money code, both load-bearing:
//
//   • Every figure out of here is an integer in cents. Rent lives in `numeric`
//     dollar columns, so the conversion happens once, at the edge.
//   • Late fees are *derived* from the late-fee rule via `lateFeeDue`, never
//     read from `scheduled_payments.late_fees_applied`. That column is corrupt
//     on this database — it carries the same figure for every row sharing a due
//     date, including rows that were paid early.

import { lateFeeDue, lateFeeRuleRisk, type LateFeeRuleLike } from './rentPayments'
import {
  emptyEconomics, addEconomics, stripeCostCents,
  type Economics, type SettleMethod,
} from './platformFees'
import type {
  Txn, PaymentRow, PlanRow, ProfileRow, SubRow, PropertyRef,
} from './financials'

export type LateFeeRuleRow = {
  plan_id: string
  grace_period_days: number | null
  fee_amount: number | null
  frequency_days: number | null
  max_total_fees: number | null
}

/** How rent moved, or failed to, inside one scope. */
export type Collection = {
  /** Rent and one-off charges that actually landed. Pass-through, not revenue. */
  collectedCents: number
  /** ACH still settling. Real money, but it can still bounce. */
  inFlightCents: number
  /** Billed and not yet paid, whether or not it is late yet. */
  outstandingCents: number
  /** The subset of `outstandingCents` already past its grace period. */
  overdueCents: number
  /** Everything billed in the scope: collected + outstanding. */
  billedCents: number
}

/** Whether the money showed up when it was supposed to. */
export type Punctuality = {
  paidOnTimeCount: number
  /** Settled, but after the grace period had expired. */
  paidLateCount: number
  /** Still unpaid and already past grace. */
  openLateCount: number
  /** Days late, summed over every charge that settled late. */
  lateDaysTotal: number
  /** The worst single charge, in days past grace. */
  worstLateDays: number
  /** Derived from the rule — see the note at the top of this file. */
  lateFeesDueCents: number
  /** What the corrupt column claims, kept only so the UI can call it out. */
  lateFeesRecordedCents: number
  /** Set when the late-fee rule would accrue without limit. */
  lateFeeRisk: string | null
  /** Share of settled rent charges that arrived on time, or null if none have. */
  onTimeRate: number | null
}

/** Gross revenue, processor cost and what survives — split by where it came from. */
export type Earnings = Economics & {
  /** Surcharges on rent (5% card / 2% ACH). */
  rentFeeCents: number
  /** Plans, lifetime deals and lead unlocks. */
  saasFeeCents: number
  /** Stripe's cut of card charges — 2.9% + 30¢ of the whole charge. */
  cardCostCents: number
  /** Stripe's cut of ACH debits — 0.8% capped at $5. */
  achCostCents: number
  /** Rent settled off Stripe (Zelle, cash). Earns nothing, costs nothing. */
  offPlatformVolumeCents: number
  paymentCount: number
}

export type Books = {
  collection: Collection
  punctuality: Punctuality
  earnings: Earnings
}

export type LeaseBooks = Books & {
  id: string
  name: string
  propertyId: string | null
  propertyName: string | null
  graceDays: number
  /** Late fee per period under this lease's rule, in cents. 0 when there is none. */
  lateFeeAmountCents: number
}

export type PropertyBooks = Books & {
  id: string
  name: string
  leases: LeaseBooks[]
}

export type LandlordBooks = Books & {
  id: string
  name: string
  email: string | null
  /** The landlord's current HomeHive plan, as a label. */
  plan: string | null
  planStatus: string | null
  /** True when an admin comped the plan — we bill them nothing. */
  comped: boolean
  propertyCount: number
  leaseCount: number
  properties: PropertyBooks[]
  firstPaymentDate: string | null
  lastPaymentDate: string | null
}

// ─── Arithmetic helpers ──────────────────────────────────────────────────────

const dollarsToCents = (v: unknown) => Math.round(Number(v ?? 0) * 100)

const emptyCollection = (): Collection => ({
  collectedCents: 0, inFlightCents: 0, outstandingCents: 0, overdueCents: 0, billedCents: 0,
})

const emptyPunctuality = (): Punctuality => ({
  paidOnTimeCount: 0, paidLateCount: 0, openLateCount: 0,
  lateDaysTotal: 0, worstLateDays: 0,
  lateFeesDueCents: 0, lateFeesRecordedCents: 0, lateFeeRisk: null, onTimeRate: null,
})

const emptyEarnings = (): Earnings => ({
  ...emptyEconomics(),
  rentFeeCents: 0, saasFeeCents: 0, cardCostCents: 0, achCostCents: 0,
  offPlatformVolumeCents: 0, paymentCount: 0,
})

const emptyBooks = (): Books => ({
  collection: emptyCollection(),
  punctuality: emptyPunctuality(),
  earnings: emptyEarnings(),
})

function addCollection(a: Collection, b: Collection): Collection {
  return {
    collectedCents:   a.collectedCents + b.collectedCents,
    inFlightCents:    a.inFlightCents + b.inFlightCents,
    outstandingCents: a.outstandingCents + b.outstandingCents,
    overdueCents:     a.overdueCents + b.overdueCents,
    billedCents:      a.billedCents + b.billedCents,
  }
}

function addPunctuality(a: Punctuality, b: Punctuality): Punctuality {
  const paidOnTimeCount = a.paidOnTimeCount + b.paidOnTimeCount
  const paidLateCount = a.paidLateCount + b.paidLateCount
  const settled = paidOnTimeCount + paidLateCount
  return {
    paidOnTimeCount, paidLateCount,
    openLateCount:  a.openLateCount + b.openLateCount,
    lateDaysTotal:  a.lateDaysTotal + b.lateDaysTotal,
    worstLateDays:  Math.max(a.worstLateDays, b.worstLateDays),
    lateFeesDueCents:      a.lateFeesDueCents + b.lateFeesDueCents,
    lateFeesRecordedCents: a.lateFeesRecordedCents + b.lateFeesRecordedCents,
    // The riskiest rule in the scope is the one worth showing.
    lateFeeRisk: a.lateFeeRisk ?? b.lateFeeRisk,
    onTimeRate: settled > 0 ? paidOnTimeCount / settled : null,
  }
}

function addEarnings(a: Earnings, b: Earnings): Earnings {
  return {
    ...addEconomics(a, b),
    rentFeeCents:           a.rentFeeCents + b.rentFeeCents,
    saasFeeCents:           a.saasFeeCents + b.saasFeeCents,
    cardCostCents:          a.cardCostCents + b.cardCostCents,
    achCostCents:           a.achCostCents + b.achCostCents,
    offPlatformVolumeCents: a.offPlatformVolumeCents + b.offPlatformVolumeCents,
    paymentCount:           a.paymentCount + b.paymentCount,
  }
}

export function addBooks(a: Books, b: Books): Books {
  return {
    collection:   addCollection(a.collection, b.collection),
    punctuality:  addPunctuality(a.punctuality, b.punctuality),
    earnings:     addEarnings(a.earnings, b.earnings),
  }
}

/** Share of processed volume kept after Stripe. */
export const takeRateOf = (e: Earnings) =>
  e.volumeCents > 0 ? e.netCents / e.volumeCents : 0

/** Share of gross fees that survives Stripe. Card ≈ 0.4, ACH ≈ 0.85. */
export const marginOf = (e: Earnings) =>
  e.feeCents > 0 ? e.netCents / e.feeCents : 0

// ─── Dates ───────────────────────────────────────────────────────────────────

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const addDays = (date: string, days: number) => {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return isoDate(d)
}

const daysBetween = (from: string, to: string) =>
  Math.round((new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 86_400_000)

// ─── Plan labels ─────────────────────────────────────────────────────────────

const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter', growth: 'Growth', unlimited: 'Unlimited',
  single_listing: 'Legacy — 1 listing', two_listing: 'Legacy — 2 listings',
  lifetime: 'Lifetime', per_lead: 'Pay per lead', free: 'Free', legacy_free: 'Grandfathered',
}

const firstProperty = (p: PlanRow): PropertyRef | null =>
  Array.isArray(p.property) ? p.property[0] ?? null : p.property

// ─── The build ───────────────────────────────────────────────────────────────

export type LandlordBooksInput = {
  /** Already-grouped payments from `buildFinancials`. One per Stripe intent. */
  txns: Txn[]
  scheduled: PaymentRow[]
  specials: PaymentRow[]
  plans: PlanRow[]
  profiles: ProfileRow[]
  subs: SubRow[]
  rules: LateFeeRuleRow[]
  now?: Date
}

/**
 * Re-group the platform's payments into one set of books per landlord.
 *
 * Collection facts come from the raw charge rows, because "what is still owed"
 * only exists on rows that never became a payment. Revenue facts come from the
 * `txns` list, because Stripe bills per *intent* and one intent can settle
 * several months of rent at once — summing rows would overstate the per-charge
 * 30¢ by a factor of however many rows shared the charge.
 */
export function buildLandlordBooks(input: LandlordBooksInput): {
  landlords: LandlordBooks[]
  totals: Books
} {
  const now = input.now ?? new Date()
  const today = isoDate(now)

  const planById = new Map(input.plans.map(p => [p.id, p]))
  const profileById = new Map(input.profiles.map(p => [p.id, p]))
  const ruleByPlan = new Map(input.rules.map(r => [r.plan_id, r]))

  // ── Per-lease accumulators, keyed by payment_plan id ──────────────────────
  //
  // A lease with no activity at all still deserves a row: "this landlord has
  // three leases and two of them have never collected anything" is exactly the
  // sort of thing an operator is looking for.
  const leases = new Map<string, LeaseBooks>()

  const leaseFor = (planId: string): LeaseBooks | null => {
    const existing = leases.get(planId)
    if (existing) return existing
    const plan = planById.get(planId)
    if (!plan) return null
    const property = firstProperty(plan)
    const rule = normaliseRule(ruleByPlan.get(planId))
    const fresh: LeaseBooks = {
      id: plan.id,
      name: plan.name || property?.name || 'Unnamed lease',
      propertyId: property?.id ?? null,
      propertyName: property?.name ?? null,
      graceDays: rule?.grace_period_days ?? 0,
      lateFeeAmountCents: dollarsToCents(rule?.fee_amount ?? 0),
      ...emptyBooks(),
      punctuality: { ...emptyPunctuality(), lateFeeRisk: lateFeeRuleRisk(rule) },
    }
    leases.set(planId, fresh)
    return fresh
  }

  for (const plan of input.plans) leaseFor(plan.id)

  // ── Collection and punctuality, from the raw charge rows ──────────────────
  const OPEN = new Set(['pending', 'late', 'missed', 'partial'])

  const absorbCharge = (r: PaymentRow, isRent: boolean) => {
    if (!r.plan_id) return
    const lease = leaseFor(r.plan_id)
    if (!lease) return
    if (r.status === 'voided') return

    const amountCents = dollarsToCents(r.amount)
    const paidCents = dollarsToCents(r.paid_amount)
    const rule = normaliseRule(ruleByPlan.get(r.plan_id))
    const graceEnd = addDays(r.due_date, rule?.grace_period_days ?? 0)
    const c = lease.collection

    if (r.status === 'paid') {
      // What landed, not what was billed: a settled row can be short.
      c.collectedCents += paidCents > 0 ? paidCents : amountCents
      c.billedCents += amountCents
    } else if (r.status === 'processing') {
      c.inFlightCents += amountCents
      c.billedCents += amountCents
    } else if (OPEN.has(r.status)) {
      const owed = Math.max(0, amountCents - paidCents)
      c.collectedCents += paidCents
      c.outstandingCents += owed
      c.billedCents += amountCents
      if (today > graceEnd && owed > 0) c.overdueCents += owed
    }

    // Punctuality is a question about rent, which has a schedule. A one-off
    // charge has a due date but no cadence, so counting it as "late rent"
    // would make a deposit invoiced yesterday look like a delinquency.
    if (!isRent) return
    const p = lease.punctuality

    if (r.status === 'paid') {
      const settled = r.paid_date ?? (r.updated_at ? String(r.updated_at).slice(0, 10) : r.due_date)
      if (settled > graceEnd) {
        p.paidLateCount++
        const days = daysBetween(graceEnd, settled)
        p.lateDaysTotal += days
        p.worstLateDays = Math.max(p.worstLateDays, days)
      } else {
        p.paidOnTimeCount++
      }
    } else if (OPEN.has(r.status) && today > graceEnd && amountCents > paidCents) {
      p.openLateCount++
      p.worstLateDays = Math.max(p.worstLateDays, daysBetween(graceEnd, today))
    }

    p.lateFeesDueCents += dollarsToCents(lateFeeDue(rule, {
      due_date: r.due_date,
      status: r.status,
      paid_date: r.paid_date,
      amount: Number(r.amount ?? 0),
      paid_amount: Number(r.paid_amount ?? 0),
    }, now))

    const settledCount = p.paidOnTimeCount + p.paidLateCount
    p.onTimeRate = settledCount > 0 ? p.paidOnTimeCount / settledCount : null
  }

  for (const r of input.scheduled) absorbCharge(r, true)
  for (const r of input.specials) absorbCharge(r, false)

  // What the corrupt column claims, so the UI can show the gap rather than
  // pretend the column does not exist.
  for (const r of input.scheduled) {
    if (!r.plan_id) continue
    const lease = leases.get(r.plan_id)
    if (!lease) continue
    const claimed = (r as PaymentRow & { late_fees_applied?: number | string | null }).late_fees_applied
    lease.punctuality.lateFeesRecordedCents += dollarsToCents(claimed)
  }

  // ── Earnings, from the grouped payments ───────────────────────────────────
  //
  // Rent attaches to a lease. Subscriptions and unlocks belong to the landlord
  // and to no property, so they are held aside and folded in at that level.
  const saasByLandlord = new Map<string, Earnings>()

  const earningsOf = (t: Txn): Earnings => ({
    volumeCents: t.volumeCents,
    passThroughCents: t.passThroughCents,
    feeCents: t.feeCents,
    costCents: t.costCents,
    netCents: t.netCents,
    rentFeeCents: t.kind === 'rent' ? t.feeCents : 0,
    saasFeeCents: t.kind === 'rent' ? 0 : t.feeCents,
    cardCostCents: t.method === 'card' ? t.costCents : 0,
    achCostCents: t.method === 'ach' ? t.costCents : 0,
    offPlatformVolumeCents: t.onPlatform ? 0 : t.volumeCents,
    paymentCount: 1,
  })

  const span = new Map<string, { first: string; last: string }>()
  const noteDate = (landlordId: string, date: string) => {
    const cur = span.get(landlordId)
    if (!cur) span.set(landlordId, { first: date, last: date })
    else {
      if (date < cur.first) cur.first = date
      if (date > cur.last) cur.last = date
    }
  }

  for (const t of input.txns) {
    const e = earningsOf(t)
    if (t.landlordId) noteDate(t.landlordId, t.date)

    if (t.kind === 'rent' && t.planId) {
      const lease = leaseFor(t.planId)
      if (lease) { lease.earnings = addEarnings(lease.earnings, e); continue }
    }
    if (!t.landlordId) continue
    saasByLandlord.set(t.landlordId, addEarnings(saasByLandlord.get(t.landlordId) ?? emptyEarnings(), e))
  }

  // ── Lease → property → landlord ───────────────────────────────────────────
  const byLandlord = new Map<string, LandlordBooks>()

  const landlordFor = (id: string): LandlordBooks => {
    const existing = byLandlord.get(id)
    if (existing) return existing
    const profile = profileById.get(id)
    const fresh: LandlordBooks = {
      id,
      name: profile?.full_name || profile?.email || 'Unknown landlord',
      email: profile?.email ?? null,
      plan: null, planStatus: null, comped: false,
      propertyCount: 0, leaseCount: 0, properties: [],
      firstPaymentDate: null, lastPaymentDate: null,
      ...emptyBooks(),
    }
    byLandlord.set(id, fresh)
    return fresh
  }

  // Properties are keyed per landlord: a lease with no property row still has
  // to live somewhere, so it lands under a single "unassigned" bucket rather
  // than being dropped from the landlord's totals.
  const propsByLandlord = new Map<string, Map<string, PropertyBooks>>()

  for (const lease of leases.values()) {
    const plan = planById.get(lease.id)
    if (!plan?.owner_id) continue
    const landlord = landlordFor(plan.owner_id)
    const bucket = propsByLandlord.get(landlord.id) ?? new Map<string, PropertyBooks>()
    propsByLandlord.set(landlord.id, bucket)

    const key = lease.propertyId ?? '__unassigned__'
    const property = bucket.get(key) ?? {
      id: key,
      name: lease.propertyName ?? 'No property linked',
      leases: [],
      ...emptyBooks(),
    }
    property.leases.push(lease)
    bucket.set(key, property)
  }

  for (const [landlordId, bucket] of propsByLandlord) {
    const landlord = landlordFor(landlordId)
    for (const property of bucket.values()) {
      // Biggest collections first — that is the order an operator scans in.
      property.leases.sort((a, b) =>
        b.collection.collectedCents - a.collection.collectedCents || a.name.localeCompare(b.name))
      for (const lease of property.leases) {
        const rolled = addBooks(property, lease)
        property.collection = rolled.collection
        property.punctuality = rolled.punctuality
        property.earnings = rolled.earnings
      }
      landlord.properties.push(property)
    }
    landlord.properties.sort((a, b) =>
      b.earnings.netCents - a.earnings.netCents ||
      b.collection.collectedCents - a.collection.collectedCents ||
      a.name.localeCompare(b.name))
    landlord.propertyCount = landlord.properties.filter(p => p.id !== '__unassigned__').length
    landlord.leaseCount = landlord.properties.reduce((n, p) => n + p.leases.length, 0)
    for (const property of landlord.properties) {
      const rolled = addBooks(landlord, property)
      landlord.collection = rolled.collection
      landlord.punctuality = rolled.punctuality
      landlord.earnings = rolled.earnings
    }
  }

  // Subscription revenue, and landlords who pay us but collect no rent here.
  for (const [landlordId, e] of saasByLandlord) {
    const landlord = landlordFor(landlordId)
    landlord.earnings = addEarnings(landlord.earnings, e)
  }

  // Current plan: the live one if there is one, else the most recent.
  const subsByLandlord = new Map<string, SubRow[]>()
  for (const s of input.subs) {
    const list = subsByLandlord.get(s.landlord_id) ?? []
    list.push(s)
    subsByLandlord.set(s.landlord_id, list)
  }
  for (const [landlordId, list] of subsByLandlord) {
    // A landlord on a plan with no payments at all is still worth listing —
    // they are paying us and collecting nothing, which is a churn signal.
    const landlord = landlordFor(landlordId)
    const sorted = [...list].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    const current = sorted.find(s => s.status === 'active') ?? sorted[0]
    if (!current) continue
    landlord.plan = PLAN_LABELS[current.plan_type] ?? current.plan_type
    landlord.planStatus = current.status
    landlord.comped = !current.stripe_subscription_id || current.stripe_subscription_id === 'admin_override'
  }

  for (const [landlordId, s] of span) {
    const landlord = byLandlord.get(landlordId)
    if (!landlord) continue
    landlord.firstPaymentDate = s.first
    landlord.lastPaymentDate = s.last
  }

  const landlords = [...byLandlord.values()].sort((a, b) =>
    b.earnings.netCents - a.earnings.netCents ||
    b.collection.collectedCents - a.collection.collectedCents ||
    a.name.localeCompare(b.name))

  const totals = landlords.reduce<Books>((acc, l) => addBooks(acc, l), emptyBooks())

  return { landlords, totals }
}

/** The rule as `lateFeeDue` wants it, with the database's nulls defaulted. */
function normaliseRule(r: LateFeeRuleRow | undefined): LateFeeRuleLike | null {
  if (!r || !r.fee_amount || r.fee_amount <= 0) return null
  return {
    grace_period_days: r.grace_period_days ?? 0,
    fee_amount: r.fee_amount,
    frequency_days: r.frequency_days ?? 30,
    max_total_fees: r.max_total_fees,
  }
}

/**
 * What one charge of this size costs us at Stripe's published rate.
 *
 * Exported so the UI can show the 2.9% + 30¢ arithmetic on a real number
 * rather than asserting a percentage and hoping the reader trusts it.
 */
export function stripeCostFor(grossCents: number, method: SettleMethod = 'card') {
  return stripeCostCents(grossCents, method)
}
