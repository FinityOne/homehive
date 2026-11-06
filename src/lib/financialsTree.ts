/**
 * The money hierarchy, as a landlord actually holds it in their head.
 *
 *     property → lease → payment plan → payer → the lines they pay
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * The rest of the money area is organised around the **payment plan**, because
 * that is the row in the database. That is not how a landlord thinks, and it
 * produced the single worst piece of this product: a lease with three tenants
 * on separate plans appeared as three unrelated rows, each named after the
 * lease, each with a third of the rent, with nothing anywhere saying they were
 * the same tenancy. "Where is Aleeya's payment plan" had no answer you could
 * navigate to — you had to recognise it by its rent figure.
 *
 * So the plan stops being the top-level object. A **lease** is, keyed on
 * `lease_id`, and every plan written against that lease hangs underneath it.
 * The lease totals are the sum of its plans, the lease's payers are the union
 * of its plans' payers, and a plan is demoted to what it really is: the billing
 * arrangement a subset of the tenants pay under. One lease, however many
 * tenants, however many plans — one row.
 *
 * A plan with no `lease_id` (older rows, and anything written against a
 * property rather than a tenancy) becomes a lease node of its own, keyed
 * `plan-<id>`, so nothing is ever dropped for lacking a join.
 *
 * ── What the figures mean ──────────────────────────────────────────────────
 *
 * Every level carries the same three questions summed over the same set of
 * charges — billed, collected, outstanding — so the levels visibly add up and
 * a figure means the same thing at whatever altitude it is read. The window is
 * always the **whole contracted term**: a hierarchy is for understanding the
 * shape of a portfolio, and a shape that changes when a reporting period moves
 * is not a shape. Month-by-month questions live in the schedule view.
 *
 * Arrears and late fees are deliberately *not* windowed either — see
 * `src/lib/financialsMonth.ts` and `src/lib/lateFees.ts`, whose definitions
 * this module reuses rather than re-deriving. A debt computed twice is a debt
 * reported two different ways.
 *
 * Everything here is pure: plans in, numbers out.
 */

import {
  summarizeLease, sumTotals, groupByProperty, stageOf, billingToday,
  EMPTY_TOTALS, STAGE_LABEL,
  type Totals, type LeaseSummary, type LeaseStage, type PayerSummary,
} from '@/lib/financialsRollup'
import { allCharges, type Charge } from '@/lib/financialsMonth'
import { lateFeeLedger, ruleSentence, type LateFeeWaiver } from '@/lib/lateFees'
import type { PaymentPlan, PaymentPlanTenant, PaymentLineItem } from '@/lib/payments'

const round2 = (n: number) => Math.round(n * 100) / 100

// ─── PAYER ───────────────────────────────────────────────────────────────────

/** One line of a payer's monthly obligation — rent, or a utility share. */
export type PayerLine = {
  id: string
  label: string
  category: string
  amount: number
  /** True when this line is owned by a lease-level utility declaration. */
  isUtility: boolean
  notes: string | null
}

/**
 * One person who pays, with everything the landlord asks about them.
 *
 * `PayerSummary` from the rollup already carries their rent totals and share;
 * this adds what the hierarchy view needs and the rollup had no reason to
 * compute — the lines their monthly figure is made of, what they owe today,
 * and when they last paid.
 */
export type TreePayer = {
  id: string
  /** The plan they pay under. The whole point of the level above. */
  planId: string
  planName: string
  name: string
  email: string | null
  status: PaymentPlanTenant['status']
  /** Their own monthly total, as the plan bills it. */
  monthly: number
  /** What that monthly figure is made of. */
  lines: PayerLine[]
  /** Share of this lease's billed rent that is theirs, 0–100. */
  share: number | null
  /** Rent across the whole term. */
  rent: Totals
  /** Rent and charges owed and already past due, before fees. */
  shortfall: number
  /** Late fees assessed on their charges and not yet paid or waived. */
  lateFees: number
  /** shortfall + lateFees — the figure to put in front of them. */
  owed: number
  /** Worst lateness among their open charges, in days. */
  maxDaysLate: number
  nextDue: { date: string; amount: number } | null
  lastPaid: { date: string; amount: number } | null
  /** Deposits they have paid that have not been returned. */
  depositsHeld: number
}

// ─── PLAN ────────────────────────────────────────────────────────────────────

/** A lease-level utility declaration, as the lease view reads it. */
export type TreeUtility = {
  id: string
  label: string
  category: string
  amount: number
  cadence: 'monthly' | 'one_time'
  split: 'even' | 'per_payer'
  /** What the whole house pays each month under this declaration. */
  houseMonthly: number
}

/**
 * One billing arrangement on a lease.
 *
 * Demoted from the top of the hierarchy to a child of the lease, which is why
 * it carries its payers and its own subtotal but no longer pretends to be the
 * tenancy.
 */
export type TreePlan = {
  planId: string
  name: string
  dueDay: number
  payers: TreePayer[]
  activePayers: number
  /** Monthly obligation of the active payers on this plan. */
  monthly: number
  /** Rent and charges across the whole term. */
  totals: Totals
  shortfall: number
  lateFees: number
  owed: number
  depositsHeld: number
  utilities: TreeUtility[]
  utilitiesMonthly: number
  /** The late-fee rule in words, so a fee can be explained and not just shown. */
  feeRule: string | null
  /** Set when the rule accrues without a ceiling. */
  feeRisk: string | null
  nextDue: { date: string; amount: number } | null
  /** The rollup's own summary, for the vitals strip and the ledger header. */
  summary: LeaseSummary
}

// ─── LEASE ───────────────────────────────────────────────────────────────────

export type LeaseHealth = 'overdue' | 'due' | 'current' | 'idle'

/**
 * One tenancy — the level a landlord navigates by.
 *
 * `key` is the route segment: the real `lease_id` when there is one, otherwise
 * `plan-<planId>`. It is stable across reloads, so a lease page can be linked.
 */
export type TreeLease = {
  key: string
  leaseId: string | null
  /** The tenancy's name — the shared plan name, or the property's. */
  label: string
  propertyId: string
  propertyName: string
  propertySlug: string | null
  termStart: string | null
  termEnd: string | null
  stage: LeaseStage
  stageLabel: string
  /** How far through the contracted term we are, 0–100. Null without dates. */
  termProgress: number | null
  /** Days until the term ends. Negative once it has. Null without dates. */
  daysLeft: number | null

  plans: TreePlan[]
  /** Every payer on the tenancy, across all its plans. */
  payers: TreePayer[]
  activePayers: number
  /** True when the rent is split across more than one plan — the case this
   *  whole module exists to make legible. */
  splitBilling: boolean

  /** Which day of the month rent falls, one entry per distinct plan due day. */
  dueDays: number[]
  monthly: number
  utilities: TreeUtility[]
  utilitiesMonthly: number

  totals: Totals
  /** Rent over the full contracted term. */
  contractValue: number
  contractCollected: number
  /** 0–100 of the contract collected. Null when nothing is contracted. */
  contractProgress: number | null
  shortfall: number
  lateFees: number
  owed: number
  depositsHeld: number

  nextDue: { date: string; amount: number } | null
  lastPaid: { date: string; amount: number } | null
  health: LeaseHealth
  urgency: number
}

// ─── PROPERTY ────────────────────────────────────────────────────────────────

export type TreeProperty = {
  propertyId: string
  propertyName: string
  propertySlug: string | null
  leases: TreeLease[]
  activeLeases: number
  payerCount: number
  monthly: number
  utilitiesMonthly: number
  totals: Totals
  shortfall: number
  lateFees: number
  owed: number
  depositsHeld: number
  /** collected ÷ billed over the term, 0–100. Null when nothing was billed. */
  rate: number | null
  nextDue: { date: string; amount: number } | null
  health: LeaseHealth
  urgency: number
}

export type MoneyTree = {
  properties: TreeProperty[]
  leases: TreeLease[]
  plans: TreePlan[]
  payers: TreePayer[]
  totals: Totals
  monthly: number
  owed: number
  depositsHeld: number
  propertyCount: number
  leaseCount: number
  activeLeaseCount: number
  /** Leases whose rent is split across more than one payment plan. */
  splitLeaseCount: number
}

export const EMPTY_TREE: MoneyTree = {
  properties: [], leases: [], plans: [], payers: [],
  totals: EMPTY_TOTALS, monthly: 0, owed: 0, depositsHeld: 0,
  propertyCount: 0, leaseCount: 0, activeLeaseCount: 0, splitLeaseCount: 0,
}

// ─── BUILD ───────────────────────────────────────────────────────────────────

const DAY = 86_400_000

/** What the whole house pays monthly under one utility declaration. */
function utilityHouseMonthly(
  u: { amount: number; cadence: string; split: string },
  activePayers: number,
): number {
  if (u.cadence !== 'monthly') return 0
  // 'per_payer' means each payer owes the full amount; 'even' means they split
  // one bill between them. Either way the house figure is what leaves the
  // building each month.
  return u.split === 'per_payer' ? round2(u.amount * Math.max(1, activePayers)) : u.amount
}

function payerLines(items: PaymentLineItem[]): PayerLine[] {
  return items
    .slice()
    .sort((a, b) => b.amount - a.amount)
    .map(i => ({
      id: i.id,
      label: i.label || i.category,
      category: i.category,
      amount: Number(i.amount),
      isUtility: i.utility_id !== null,
      notes: i.notes,
    }))
}

/**
 * One plan, with its payers.
 *
 * Arrears and fees come from the shared definitions rather than being re-derived
 * here: `arrearsBy`/`feesBy` are lookups the caller built once over the whole
 * portfolio, so a payer's debt on this page is the same arithmetic as their
 * debt on the collections page.
 */
function buildPlan(
  plan: PaymentPlan,
  /** This plan's charges only — grouped once by the caller rather than
   *  re-scanned per plan, which on a large portfolio is the difference between
   *  one pass and one pass per lease. */
  planCharges: Charge[],
  feeByPayer: Map<string, { amount: number; days: number }>,
  now: Date,
): TreePlan {
  const summary = summarizeLease(plan, 'term', now)
  const todayStr = billingToday(now)
  const activePayers = plan.tenants.filter(t => t.status === 'active').length

  const utilities: TreeUtility[] = (plan.utilities ?? []).map(u => ({
    id: u.id,
    label: u.label,
    category: u.category,
    amount: Number(u.amount),
    cadence: u.cadence,
    split: u.split,
    houseMonthly: utilityHouseMonthly(u, activePayers),
  }))

  const byPayer = new Map<string, PayerSummary>(summary.payers.map(p => [p.id, p]))
  const chargesByPayer = new Map<string, Charge[]>()
  for (const c of planCharges) {
    const k = c.payerId ?? 'lease'
    const arr = chargesByPayer.get(k)
    if (arr) arr.push(c)
    else chargesByPayer.set(k, [c])
  }

  const payers: TreePayer[] = plan.tenants.map(t => {
    const s = byPayer.get(t.id)
    const mine = chargesByPayer.get(t.id) ?? []
    const open = mine.filter(c => c.state === 'overdue')
    const shortfall = round2(open.reduce((n, c) => n + c.outstanding, 0))
    const fee = feeByPayer.get(`${plan.id}:${t.id}`) ?? { amount: 0, days: 0 }

    const upcoming = mine
      .filter(c => c.outstanding > 0 && c.dueDate >= todayStr)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
    const settled = mine
      .filter(c => c.settlement?.paidDate)
      .sort((a, b) => (b.settlement!.paidDate ?? '').localeCompare(a.settlement!.paidDate ?? ''))[0]

    return {
      id: t.id,
      planId: plan.id,
      planName: plan.name,
      name: t.name,
      email: t.email,
      status: t.status,
      monthly: Number(t.monthly_total),
      lines: payerLines(t.line_items ?? []),
      share: s?.share ?? null,
      rent: s?.rent ?? EMPTY_TOTALS,
      shortfall,
      lateFees: fee.amount,
      owed: round2(shortfall + fee.amount),
      maxDaysLate: Math.max(fee.days, ...open.map(c => c.daysLate), 0),
      nextDue: upcoming ? { date: upcoming.dueDate, amount: upcoming.outstanding } : null,
      lastPaid: settled
        ? { date: settled.settlement!.paidDate!, amount: settled.settlement!.net + settled.settlement!.lateFee }
        : null,
      depositsHeld: round2(
        (plan.special_payments ?? [])
          .filter(sp => sp.plan_tenant_id === t.id && sp.category === 'security_deposit' && sp.status === 'paid')
          .reduce((n, sp) => n + Number(sp.amount), 0),
      ),
    }
  })
  // Active payers first, then by what they owe, then alphabetically — the order
  // a landlord reads a tenancy in.
  payers.sort((a, b) =>
    Number(a.status !== 'active') - Number(b.status !== 'active') ||
    b.owed - a.owed ||
    a.name.localeCompare(b.name)
  )

  const shortfall = round2(payers.reduce((n, p) => n + p.shortfall, 0))
  // Charges raised against the lease rather than a person belong to the plan's
  // debt but to nobody's row, so they are added at this level.
  const leaseLevel = round2(
    (chargesByPayer.get('lease') ?? [])
      .filter(c => c.state === 'overdue')
      .reduce((n, c) => n + c.outstanding, 0),
  )
  const lateFees = round2(payers.reduce((n, p) => n + p.lateFees, 0))

  return {
    planId: plan.id,
    name: plan.name,
    dueDay: plan.due_day,
    payers,
    activePayers,
    monthly: summary.monthly,
    totals: summary.total,
    shortfall: round2(shortfall + leaseLevel),
    lateFees,
    owed: round2(shortfall + leaseLevel + lateFees),
    depositsHeld: summary.depositsHeld,
    utilities,
    utilitiesMonthly: round2(utilities.reduce((n, u) => n + u.houseMonthly, 0)),
    feeRule: plan.late_fee_rule ? ruleSentence(plan.late_fee_rule) : null,
    feeRisk: summary.lateFeeRisk,
    nextDue: summary.nextDue,
    summary,
  }
}

const HEALTH_RANK: Record<LeaseHealth, number> = { overdue: 3, due: 2, current: 1, idle: 0 }
const worstHealth = (hs: LeaseHealth[]): LeaseHealth =>
  hs.reduce<LeaseHealth>((worst, h) => (HEALTH_RANK[h] > HEALTH_RANK[worst] ? h : worst), 'idle')

/** Fold a lease's plans into the tenancy they describe. */
function buildLease(key: string, plans: TreePlan[], raw: PaymentPlan[], now: Date): TreeLease {
  const todayStr = billingToday(now)
  const lease = raw.find(p => p.lease)?.lease ?? null
  const termStart = lease?.start_date ?? null
  const termEnd = lease?.end_date ?? null
  const stage = stageOf(termStart, termEnd, todayStr)

  const termProgress = (() => {
    if (!termStart || !termEnd) return null
    const a = new Date(termStart + 'T00:00:00').getTime()
    const b = new Date(termEnd + 'T00:00:00').getTime()
    const t = new Date(todayStr + 'T00:00:00').getTime()
    if (b <= a) return null
    return Math.max(0, Math.min(100, Math.round(((t - a) / (b - a)) * 100)))
  })()

  const payers = plans.flatMap(p => p.payers)
  const totals = sumTotals(plans.map(p => p.totals))
  const contractValue = round2(plans.reduce((n, p) => n + p.summary.contractValue, 0))
  const contractCollected = round2(plans.reduce((n, p) => n + p.summary.contractCollected, 0))
  const shortfall = round2(plans.reduce((n, p) => n + p.shortfall, 0))
  const lateFees = round2(plans.reduce((n, p) => n + p.lateFees, 0))

  const nextDue = plans
    .map(p => p.nextDue)
    .filter((d): d is { date: string; amount: number } => d !== null)
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
  const lastPaid = plans
    .map(p => p.summary.lastPaid)
    .filter((d): d is { date: string; amount: number } => d != null)
    .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null

  const first = plans[0]
  // The tenancy's name: the plan name when every plan agrees on it (the usual
  // case, since they were all written against the same lease), otherwise the
  // property, because three disagreeing plan names is not a name.
  const names = new Set(plans.map(p => p.name))
  const label = names.size === 1 ? first.name : first.summary.propertyName

  return {
    key,
    leaseId: lease?.id ?? null,
    label,
    propertyId: first.summary.propertyId,
    propertyName: first.summary.propertyName,
    propertySlug: first.summary.propertySlug,
    termStart,
    termEnd,
    stage,
    stageLabel: STAGE_LABEL[stage],
    termProgress,
    daysLeft: termEnd
      ? Math.round((new Date(termEnd + 'T00:00:00').getTime() - new Date(todayStr + 'T00:00:00').getTime()) / DAY)
      : null,

    plans,
    payers,
    activePayers: payers.filter(p => p.status === 'active').length,
    splitBilling: plans.length > 1,

    dueDays: [...new Set(plans.map(p => p.dueDay))].sort((a, b) => a - b),
    monthly: round2(plans.reduce((n, p) => n + p.monthly, 0)),
    // A utility is declared once per plan, so a lease billed through two plans
    // genuinely declares it twice — these are summed, not de-duplicated.
    utilities: plans.flatMap(p => p.utilities),
    utilitiesMonthly: round2(plans.reduce((n, p) => n + p.utilitiesMonthly, 0)),

    totals,
    contractValue,
    contractCollected,
    contractProgress: contractValue > 0
      ? Math.max(0, Math.min(100, Math.round((contractCollected / contractValue) * 100)))
      : null,
    shortfall,
    lateFees,
    owed: round2(shortfall + lateFees),
    depositsHeld: round2(plans.reduce((n, p) => n + p.depositsHeld, 0)),

    nextDue,
    lastPaid,
    health: worstHealth(plans.map(p => p.summary.health)),
    urgency: plans.reduce((n, p) => n + p.summary.urgency, 0),
  }
}

/**
 * The whole portfolio as a tree.
 *
 * Waivers are passed through to `lateFeeLedger` rather than ignored: a fee the
 * landlord has written off is not owed, and a hierarchy that still counts it
 * would disagree with the collections page about the same money.
 */
export function buildTree(
  plans: PaymentPlan[],
  waivers: LateFeeWaiver[] = [],
  now = new Date(),
): MoneyTree {
  if (plans.length === 0) return EMPTY_TREE

  // Derived once over the whole set and handed down, so that every level reads
  // the same arithmetic — see the module note.
  const charges = allCharges(plans, now)
  const ledger = lateFeeLedger(plans, waivers, now)
  const feeByPayer = new Map<string, { amount: number; days: number }>()
  for (const p of ledger.payers) {
    feeByPayer.set(`${p.planId}:${p.payerId ?? 'lease'}`, { amount: p.total, days: p.maxDaysLate })
  }

  const chargesByPlan = new Map<string, Charge[]>()
  for (const c of charges) {
    const arr = chargesByPlan.get(c.planId)
    if (arr) arr.push(c)
    else chargesByPlan.set(c.planId, [c])
  }

  const built = plans.map(p => ({
    raw: p,
    tree: buildPlan(p, chargesByPlan.get(p.id) ?? [], feeByPayer, now),
  }))

  // Group by the tenancy, not the plan. This is the whole point of the module.
  const byLease = new Map<string, typeof built>()
  for (const b of built) {
    const key = b.raw.lease_id ? b.raw.lease_id : `plan-${b.raw.id}`
    const arr = byLease.get(key)
    if (arr) arr.push(b)
    else byLease.set(key, [b])
  }

  const leases = [...byLease.entries()].map(([key, group]) =>
    buildLease(key, group.map(g => g.tree), group.map(g => g.raw), now),
  )

  // Properties come out of the same grouping the rollup already uses, so the
  // ordering a landlord sees here matches every other money surface.
  const order = groupByProperty(built.map(b => b.tree.summary))
  const properties: TreeProperty[] = order.map(g => {
    const mine = leases
      .filter(l => l.propertyId === g.propertyId)
      .sort((a, b) =>
        b.urgency - a.urgency ||
        Number(a.stage === 'ended') - Number(b.stage === 'ended') ||
        (b.termStart ?? '').localeCompare(a.termStart ?? '')
      )
    const totals = sumTotals(mine.map(l => l.totals))
    return {
      propertyId: g.propertyId,
      propertyName: g.propertyName,
      propertySlug: g.propertySlug,
      leases: mine,
      activeLeases: mine.filter(l => l.stage === 'active' || l.stage === 'ending').length,
      payerCount: mine.reduce((n, l) => n + l.activePayers, 0),
      monthly: round2(mine.reduce((n, l) => n + l.monthly, 0)),
      utilitiesMonthly: round2(mine.reduce((n, l) => n + l.utilitiesMonthly, 0)),
      totals,
      shortfall: round2(mine.reduce((n, l) => n + l.shortfall, 0)),
      lateFees: round2(mine.reduce((n, l) => n + l.lateFees, 0)),
      owed: round2(mine.reduce((n, l) => n + l.owed, 0)),
      depositsHeld: round2(mine.reduce((n, l) => n + l.depositsHeld, 0)),
      rate: totals.rate,
      nextDue: mine
        .map(l => l.nextDue)
        .filter((d): d is { date: string; amount: number } => d !== null)
        .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null,
      health: worstHealth(mine.map(l => l.health)),
      urgency: mine.reduce((n, l) => n + l.urgency, 0),
    }
  })

  const allPlans = built.map(b => b.tree)
  return {
    properties,
    leases,
    plans: allPlans,
    payers: allPlans.flatMap(p => p.payers),
    totals: sumTotals(allPlans.map(p => p.totals)),
    monthly: round2(allPlans.reduce((n, p) => n + p.monthly, 0)),
    owed: round2(leases.reduce((n, l) => n + l.owed, 0)),
    depositsHeld: round2(allPlans.reduce((n, p) => n + p.depositsHeld, 0)),
    propertyCount: properties.length,
    leaseCount: leases.length,
    activeLeaseCount: leases.filter(l => l.stage === 'active' || l.stage === 'ending').length,
    splitLeaseCount: leases.filter(l => l.splitBilling).length,
  }
}

/** Find one tenancy by the key the routes use. */
export function findLease(tree: MoneyTree, key: string): TreeLease | null {
  return tree.leases.find(l => l.key === key) ?? null
}

/**
 * The route for a tenancy.
 *
 * Every link into the money area goes through here, so that changing the shape
 * of the URL is one edit rather than a search for string concatenation.
 */
export const leaseHref = (key: string) => `/landlord/financials/lease/${key}`
export const planHref = (planId: string) => `/landlord/financials/plan/${planId}`
