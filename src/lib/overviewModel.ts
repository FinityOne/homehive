/**
 * Everything the landlord Overview shows, derived once, in one place.
 *
 * ── Why this is not in the page ────────────────────────────────────────────
 *
 * The overview used to compute its own figures inline, which is how it drifted
 * away from the rest of the app on the two questions that are easy to get
 * wrong and expensive to get wrong:
 *
 *   • **What counts as late.** It compared a due date against the reader's own
 *     midnight, so a landlord reading this from London saw a different arrears
 *     figure here than on Financials. Overdue now means what `rentState` in
 *     `financialsMonth.ts` means by it: the whole due day has passed on the
 *     *billing* calendar, money is still owed, and the charge is not in
 *     flight. A part-paid row weeks past due is late; a clearing ACH debit is
 *     not.
 *   • **What counts as money.** It summed voided rows and demo leases into
 *     revenue. A voided charge was cancelled, so voiding one used to make the
 *     overdue figure go *up*; a demo lease is a rehearsal, and the database
 *     already refuses to put a payment plan on one.
 *
 * Both stay fixed because the derivation lives here rather than being retyped
 * the next time the screen is restyled, and because `npm run verify:overview`
 * fails if either regresses.
 *
 * ── On comparisons ─────────────────────────────────────────────────────────
 *
 * The money area refuses to render a change without naming what the change is
 * against, and this follows it. The only honest month-over-month figure a
 * landlord's portfolio supports is *collected so far this month against the
 * same elapsed portion of last month* — six days against six days. Comparing a
 * running month against a finished one is how a dashboard tells a landlord
 * their collections collapsed on the 3rd of every month. Where no fair basis
 * exists, the model returns `null` and the card shows a count instead.
 */

import type { Property } from '@/lib/properties'
import type { Lead } from '@/lib/leads'
import { getLeaseStatus, type Lease } from '@/lib/leases'
import type { PaymentPlan, ScheduledPayment } from '@/lib/payments'
import { billingToday, daysPastDue } from '@/lib/rentPayments'
import type { Signal } from '@/lib/financialsSignals'

/** A lease ending inside this window is worth putting on the landing screen. */
export const EXPIRY_WINDOW_DAYS = 60

/** Months of collection history the chart can draw. */
const HISTORY_MONTHS = 12

// ─── SHAPES ──────────────────────────────────────────────────────────────────

export type MonthPoint = {
  /** 'YYYY-MM'. */
  key: string
  label: string
  longLabel: string
  collected: number
  billed: number
  /** Collected as a share of billed, or null when nothing was billed. */
  rate: number | null
}

export type PropertyRow = {
  id: string
  slug: string
  name: string
  image: string | null
  price: number
  totalRooms: number
  vacantRooms: number
  occupancyPct: number | null
  /** Contracted rent from the leases running on it right now. */
  monthly: number
  activeLeases: number
  leads: number
  owed: number
  /** Live, or the reason it is not. */
  state: 'live' | 'unpaid' | 'rented' | 'inactive' | 'pending' | 'rejected'
}

export type Pace = {
  /** Collected so far this month. */
  toDate: number
  /** Collected by the same day of last month, or null when there is no history. */
  lastToSame: number | null
  deltaPct: number | null
  basis: string
  comparable: boolean
}

export type Overview = {
  /** Nothing has been set up yet — the screen shows a way in, not zeroes. */
  empty: boolean

  // Portfolio
  properties: PropertyRow[]
  liveCount: number
  unpublished: Property[]
  totalRooms: number
  occupiedRooms: number
  vacantRooms: number
  occupancyPct: number | null

  // Leases
  currentLeases: Lease[]
  upcomingLeases: Lease[]
  expiring: { lease: Lease; days: number }[]
  monthlyRevenue: number
  annualRevenue: number

  // Money
  monthLabel: string
  monthBilled: number
  monthPaid: number
  monthPending: number
  collectionRate: number | null
  pace: Pace
  owed: number
  owedCount: number
  worstDaysLate: number
  /** Overdue grouped by plan, worst first. */
  arrears: { planId: string; propertyName: string; who: string; owed: number; count: number }[]
  history: MonthPoint[]

  // Leads
  leads: Lead[]
  activeLeads: number
  newLeads: number
  qualifiedLeads: number
  /** New leads in the last 30 days, against the 30 before that. */
  leadDelta: { pct: number | null; basis: string; recent: number }
  funnel: { stage: LeadStage; label: string; count: number }[]
  statusMix: { label: string; color: string; count: number }[]
}

// ─── LEAD VOCABULARY ─────────────────────────────────────────────────────────

/**
 * The funnel, in the order a lead moves through it.
 *
 * `tour_scheduled` is not a stage of its own here. It is a legacy status kept
 * for rows written before `toured` existed, and it means the same thing as
 * qualified — splitting it out gave the funnel a sixth column that was always
 * either empty or a duplicate of the fifth.
 */
export const LEAD_STAGES = ['new', 'contacted', 'engaged', 'qualified', 'closed'] as const
export type LeadStage = (typeof LEAD_STAGES)[number]

const STAGE_LABEL: Record<LeadStage, string> = {
  new: 'New', contacted: 'Contacted', engaged: 'Engaged',
  qualified: 'Qualified', closed: 'Closed',
}

/** Which funnel column a raw status falls into. */
function stageOf(status: Lead['status']): LeadStage | null {
  switch (status) {
    case 'new': return 'new'
    case 'contacted':
    case 'follow_up': return 'contacted'
    case 'engaged':
    case 'matching': return 'engaged'
    case 'qualified':
    case 'tour_scheduled': return 'qualified'
    case 'closed': return 'closed'
    case 'cold': return null
    default: return null
  }
}

/**
 * The status mix, as its own vocabulary.
 *
 * Deliberately finer than the funnel: the funnel answers "where does the
 * pipeline narrow", the mix answers "what is actually in there", and cold
 * leads belong in the second answer even though they are nowhere in the first.
 * Hues are the money area's, so a stage never changes colour between screens.
 */
const MIX: Record<string, { label: string; color: string }> = {
  new:            { label: 'New',            color: '#0f7a43' },
  contacted:      { label: 'Contacted',      color: '#1a9c5c' },
  follow_up:      { label: 'Follow-up',      color: '#b25000' },
  engaged:        { label: 'Engaged',        color: '#d98324' },
  qualified:      { label: 'Qualified',      color: '#0b6336' },
  tour_scheduled: { label: 'Qualified',      color: '#0b6336' },
  matching:       { label: 'Roommate match', color: '#6b46c1' },
  cold:           { label: 'Cold',           color: '#b6b6bb' },
  closed:         { label: 'Closed',         color: '#8e8e93' },
}

// ─── DATE HELPERS ────────────────────────────────────────────────────────────

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr + 'T00:00:00')
  return Math.round((d.getTime() - today.getTime()) / 86_400_000)
}

/** A 'YYYY-MM-DD' date's month key, read as a plain calendar date. */
const keyOfDate = (dateStr: string) => dateStr.slice(0, 7)

/**
 * Has the whole of the due day passed where the rent is owed?
 *
 * Never `new Date()` against a parsed due date: that asks the question in the
 * reader's timezone, and a landlord reading this from London would see rent
 * due today in Phoenix reported as late.
 */
const isPastDueDay = (dueDate: string) => dueDate < billingToday()

// ─── THE MODEL ───────────────────────────────────────────────────────────────

export function buildOverview(
  properties: Property[],
  leads: Lead[],
  leases: Lease[],
  plans: PaymentPlan[],
): Overview {
  const now = new Date()
  const thisKey = monthKey(now)
  const today = new Date(); today.setHours(0, 0, 0, 0)

  // ── Leases ────────────────────────────────────────────────────────────────
  // A demo lease is a rehearsal. It has no plan, charges nothing, and counting
  // its rent as revenue is the fastest way to make this screen untrustworthy.
  const real = leases.filter(l => !l.is_demo)
  const currentLeases  = real.filter(l => getLeaseStatus(l.start_date, l.end_date) === 'current')
  const upcomingLeases = real.filter(l => getLeaseStatus(l.start_date, l.end_date) === 'upcoming')
  const monthlyRevenue = currentLeases.reduce((s, l) => s + (l.rent_amount || 0), 0)

  const expiring = currentLeases
    .map(l => ({ lease: l, days: daysUntil(l.end_date) }))
    .filter(x => x.days >= 0 && x.days <= EXPIRY_WINDOW_DAYS)
    .sort((a, b) => a.days - b.days)

  // ── Rooms ─────────────────────────────────────────────────────────────────
  const totalRooms  = properties.reduce((s, p) => s + (p.total_rooms || 0), 0)
  const vacantRooms = properties.reduce((s, p) => s + (p.available || 0), 0)
  const occupiedRooms = Math.max(0, totalRooms - vacantRooms)
  const occupancyPct = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : null

  // ── Money ─────────────────────────────────────────────────────────────────
  // A charge is money only if it was not voided, so every sum below walks the
  // same filtered list rather than re-deciding row by row.
  const charges: (ScheduledPayment & { planId: string })[] = plans.flatMap(p =>
    (p.scheduled_payments ?? [])
      .filter(sp => sp.status !== 'voided')
      .map(sp => ({ ...sp, planId: p.id })),
  )

  const inMonth = charges.filter(sp => keyOfDate(sp.due_date) === thisKey)
  const monthBilled = inMonth.reduce((s, sp) => s + sp.amount, 0)
  const monthPaid   = inMonth.reduce((s, sp) => s + sp.paid_amount, 0)
  const collectionRate = monthBilled > 0 ? Math.round((monthPaid / monthBilled) * 100) : null

  // Overdue is decided exactly as the money area decides it (`rentState` in
  // `financialsMonth.ts`): the whole due day has passed on the billing
  // calendar, money is still owed, and the charge is not in flight.
  //
  // Two of those three are easy to drop and both are wrong in a way a
  // landlord notices. Using `isOverdue` from `payments.ts` looks right and is
  // not — it reads the row's *status*, so a part-paid row that is weeks past
  // due reports as `partial` rather than late and silently leaves its
  // shortfall out of arrears. And counting a `processing` ACH debit as
  // overdue chases a tenant for money that is already on its way.
  const overdue = charges.filter(sp =>
    sp.status !== 'processing'
    && sp.paid_amount < sp.amount
    && isPastDueDay(sp.due_date))
  const owed = overdue.reduce((s, sp) => s + (sp.amount - sp.paid_amount), 0)
  const worstDaysLate = overdue.reduce((n, sp) => Math.max(n, daysPastDue(sp.due_date)), 0)

  const byPlan = new Map<string, Overview['arrears'][number]>()
  for (const sp of overdue) {
    const plan = plans.find(p => p.id === sp.planId)
    if (!plan) continue
    const row = byPlan.get(sp.planId)
    const amount = sp.amount - sp.paid_amount
    if (row) { row.owed += amount; row.count++ }
    else byPlan.set(sp.planId, {
      planId: plan.id,
      propertyName: plan.property?.name || 'Unknown property',
      who: plan.tenants.map(t => t.name).filter(Boolean).join(', ') || plan.name,
      owed: amount,
      count: 1,
    })
  }
  const arrears = Array.from(byPlan.values()).sort((a, b) => b.owed - a.owed)

  // ── Collection history ────────────────────────────────────────────────────
  // Billed is keyed on the due date, collected on the date the money arrived.
  // Keying both on the due date would hide a month paid two months late, which
  // is precisely the month a landlord wants to see.
  const history: MonthPoint[] = []
  for (let i = HISTORY_MONTHS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = monthKey(d)
    const billed = charges
      .filter(sp => keyOfDate(sp.due_date) === key)
      .reduce((s, sp) => s + sp.amount, 0)
    const collected = charges
      .filter(sp => sp.paid_date && keyOfDate(sp.paid_date) === key)
      .reduce((s, sp) => s + sp.paid_amount, 0)
    history.push({
      key,
      label: d.toLocaleDateString('en-US', { month: 'short' }),
      longLabel: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      collected,
      billed,
      rate: billed > 0 ? Math.round((collected / billed) * 100) : null,
    })
  }

  const pace = collectionPace(charges, now)

  // ── Properties ────────────────────────────────────────────────────────────
  const owedBySlug = new Map<string, number>()
  for (const row of arrears) {
    const plan = plans.find(p => p.id === row.planId)
    const slug = plan?.property?.slug
    if (slug) owedBySlug.set(slug, (owedBySlug.get(slug) ?? 0) + row.owed)
  }

  const rows: PropertyRow[] = properties.map(p => {
    const vacant = p.available || 0
    const total  = p.total_rooms || 0
    const active = currentLeases.filter(l => l.property?.slug === p.slug)
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      image: p.images?.[0] ?? null,
      price: p.price ?? 0,
      totalRooms: total,
      vacantRooms: vacant,
      occupancyPct: total > 0 ? Math.round(((total - vacant) / total) * 100) : null,
      monthly: active.reduce((s, l) => s + (l.rent_amount || 0), 0),
      activeLeases: active.length,
      leads: leads.filter(l => l.property === p.slug && l.status !== 'closed').length,
      owed: owedBySlug.get(p.slug) ?? 0,
      state: propertyState(p),
    }
  })

  const liveCount   = rows.filter(r => r.state === 'live').length
  const unpublished = properties.filter(p => p.owner_plan_active === false)

  // ── Leads ─────────────────────────────────────────────────────────────────
  const activeLeads = leads.filter(l => l.status !== 'closed' && l.status !== 'cold')
  const newLeads    = leads.filter(l => l.status === 'new').length
  const qualified   = leads.filter(l => l.status === 'qualified' || l.status === 'tour_scheduled').length

  const funnel = LEAD_STAGES.map(stage => ({
    stage,
    label: STAGE_LABEL[stage],
    count: leads.filter(l => stageOf(l.status) === stage).length,
  }))

  const mix = new Map<string, { label: string; color: string; count: number }>()
  for (const l of leads) {
    const meta = MIX[l.status] ?? { label: l.status, color: '#b6b6bb' }
    const row = mix.get(meta.label)
    if (row) row.count++
    else mix.set(meta.label, { ...meta, count: 1 })
  }
  const statusMix = Array.from(mix.values()).sort((a, b) => b.count - a.count)

  return {
    empty: properties.length === 0,
    properties: rows,
    liveCount,
    unpublished,
    totalRooms,
    occupiedRooms,
    vacantRooms,
    occupancyPct,
    currentLeases,
    upcomingLeases,
    expiring,
    monthlyRevenue,
    annualRevenue: monthlyRevenue * 12,
    monthLabel: now.toLocaleDateString('en-US', { month: 'long' }),
    monthBilled,
    monthPaid,
    monthPending: Math.max(0, monthBilled - monthPaid),
    collectionRate,
    pace,
    owed,
    owedCount: overdue.length,
    worstDaysLate,
    arrears,
    history,
    leads,
    activeLeads: activeLeads.length,
    newLeads,
    qualifiedLeads: qualified,
    leadDelta: leadDelta(leads, today),
    funnel,
    statusMix,
  }
}

/** Live needs all three axes to agree: approved, switched on, and paid for. */
function propertyState(p: Property): PropertyRow['state'] {
  if (p.owner_plan_active === false) return 'unpaid'
  if (p.admin_status === 'pending')  return 'pending'
  if (p.admin_status === 'rejected') return 'rejected'
  if (p.admin_status !== 'active')   return 'inactive'
  const listing = p.listing_status ?? 'active'
  if (listing === 'rented')   return 'rented'
  if (listing !== 'active')   return 'inactive'
  return 'live'
}

/**
 * This month to date against the same elapsed portion of last month.
 *
 * Not comparable until there is something to compare against: a first month
 * has no prior, and a prior month that collected nothing makes a percentage
 * meaningless rather than infinite.
 */
function collectionPace(charges: ScheduledPayment[], now: Date): Pace {
  const day = now.getDate()
  const thisKey = monthKey(now)
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevKey = monthKey(prev)

  const paidIn = (key: string, upToDay: number | null) => charges
    .filter(sp => {
      if (!sp.paid_date || keyOfDate(sp.paid_date) !== key) return false
      return upToDay === null || Number(sp.paid_date.slice(8, 10)) <= upToDay
    })
    .reduce((s, sp) => s + sp.paid_amount, 0)

  const toDate = paidIn(thisKey, null)
  const lastToSame = paidIn(prevKey, day)
  const anyLastMonth = paidIn(prevKey, null) > 0
  const comparable = anyLastMonth && lastToSame > 0

  return {
    toDate,
    lastToSame: anyLastMonth ? lastToSame : null,
    deltaPct: comparable ? Math.round(((toDate - lastToSame) / lastToSame) * 100) : null,
    basis: `the first ${day} day${day !== 1 ? 's' : ''} of last month`,
    comparable,
  }
}

/**
 * How many leads below which a percentage change is noise.
 *
 * One lead last month and eleven this month is a true "1000% up", and it is
 * also a meaningless thing to print on a dashboard: the figure is a property
 * of the tiny denominator, not of the business. Small portfolios live at these
 * numbers all the time, so the floor is not an edge case — it is most of them.
 */
const MIN_LEADS_TO_COMPARE = 4

/** New leads in the last 30 days against the 30 before that. */
function leadDelta(leads: Lead[], today: Date): Overview['leadDelta'] {
  const at = (back: number) => {
    const d = new Date(today); d.setDate(d.getDate() - back); return d.getTime()
  }
  const count = (from: number, to: number) => leads.filter(l => {
    if (!l.created_at) return false
    const t = new Date(l.created_at).getTime()
    return t >= from && t < to
  }).length

  const recent = count(at(30), Date.now())
  const prior  = count(at(60), at(30))
  return {
    recent,
    // Too few in the prior window means no comparison — not a 100% rise.
    pct: prior >= MIN_LEADS_TO_COMPARE
      ? Math.round(((recent - prior) / prior) * 100)
      : null,
    basis: 'the 30 days before that',
  }
}

// ─── SIGNALS ─────────────────────────────────────────────────────────────────

/**
 * What needs doing, worst first, in the money area's own `Signal` shape so the
 * landing screen can render it with the same component Financials uses.
 *
 * Every signal carries its evidence. A claim a landlord cannot check is a
 * claim they will stop reading after the first one that turns out to be wrong.
 */
export function overviewSignals(o: Overview): Signal[] {
  const out: Signal[] = []

  if (o.unpublished.length > 0) {
    const n = o.unpublished.length
    out.push({
      id: 'unpublished',
      severity: 'critical',
      title: n === 1
        ? 'A finished listing is invisible to students'
        : `${n} finished listings are invisible to students`,
      detail:
        'Students only see a listing while your plan is active. There is no review queue — ' +
        `${n === 1 ? 'it goes' : 'they go'} live the moment you subscribe.`,
      evidence: o.unpublished.slice(0, 4).map(p => p.name),
      action: { label: 'Choose a plan', href: '/landlord/subscribe' },
      icon: 'shield',
    })
  }

  if (o.owed > 0) {
    out.push({
      id: 'arrears',
      severity: o.worstDaysLate >= 14 ? 'critical' : 'warning',
      title: `${money(o.owed)} is past due`,
      detail: `${o.owedCount} charge${o.owedCount !== 1 ? 's' : ''} have gone by unpaid` +
        (o.worstDaysLate > 0 ? `, the oldest ${o.worstDaysLate} days ago.` : '.'),
      evidence: o.arrears.slice(0, 4).map(a => `${a.who} · ${a.propertyName} · ${money(a.owed)}`),
      action: { label: 'Work collections', href: '/landlord/financials/collections' },
      amount: o.owed,
      icon: 'alert',
    })
  }

  if (o.expiring.length > 0) {
    const soonest = o.expiring[0]
    out.push({
      id: 'expiring',
      severity: soonest.days <= 30 ? 'warning' : 'watch',
      title: `${o.expiring.length} lease${o.expiring.length !== 1 ? 's' : ''} end within ${EXPIRY_WINDOW_DAYS} days`,
      detail:
        'A renewal offer sent early is answered; one sent in the last fortnight competes with ' +
        'every other listing the tenant has already started looking at.',
      evidence: o.expiring.slice(0, 4).map(x =>
        `${x.lease.tenants.map(t => t.name).filter(Boolean).join(', ') || 'No tenant'} · ` +
        `${x.lease.property?.name ?? 'Unknown'} · ${x.days} days`),
      action: { label: 'Send renewals', href: '/landlord/renewals' },
      icon: 'calendar',
    })
  }

  if (o.newLeads > 0) {
    out.push({
      id: 'new-leads',
      severity: o.newLeads >= 5 ? 'warning' : 'watch',
      title: `${o.newLeads} lead${o.newLeads !== 1 ? 's have' : ' has'} not been contacted`,
      detail:
        'A renter who enquires is comparing several places the same evening. The first reply ' +
        'usually gets the tour.',
      evidence: o.leads.filter(l => l.status === 'new').slice(0, 4).map(l =>
        [l.first_name, l.last_name].filter(Boolean).join(' ') || l.email),
      action: { label: 'Open the pipeline', href: '/landlord/leads/list' },
      icon: 'users',
    })
  }

  if (o.vacantRooms > 0 && o.liveCount > 0) {
    out.push({
      id: 'vacancy',
      severity: 'watch',
      title: `${o.vacantRooms} room${o.vacantRooms !== 1 ? 's are' : ' is'} empty`,
      detail: o.occupancyPct !== null
        ? `You are ${o.occupancyPct}% occupied across ${o.totalRooms} rooms. Every empty week is rent that cannot be earned back.`
        : 'Every empty week is rent that cannot be earned back.',
      evidence: o.properties
        .filter(p => p.vacantRooms > 0)
        .slice(0, 4)
        .map(p => `${p.name} · ${p.vacantRooms} of ${p.totalRooms} empty`),
      action: { label: 'See listing performance', href: '/landlord/performance' },
      icon: 'trend-down',
    })
  }

  const RANK = { critical: 3, warning: 2, watch: 1, good: 0 } as const
  return out.sort((a, b) =>
    RANK[b.severity] - RANK[a.severity] || (b.amount ?? 0) - (a.amount ?? 0))
}

const money = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)
