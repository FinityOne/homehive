// Turning payment rows into the platform's own P&L.
//
// The arithmetic lives here, apart from the route, for two reasons: it is the
// part worth testing, and it needs no database — hand it rows, get a report.
//
// Every dollar figure it returns is an integer in cents. Rent lives in
// `numeric` dollar columns, so the conversion happens once, at the edge below.

import { FEE_RATES } from './rentPayments'
import {
  STRIPE_RATES, economics, emptyEconomics, addEconomics,
  type Economics, type SettleMethod, type RevenueSource,
} from './platformFees'

/** List price of each thing a landlord can buy, in cents. */
const PLAN_PRICE_CENTS: Record<string, number> = {
  single_listing: 2999,
  two_listing:    4999,
  lifetime:       29900,
  per_lead:        199,
}

const dollarsToCents = (v: unknown) => Math.round(Number(v ?? 0) * 100)

/** A plan row we never charged for: an admin comped it. */
const isComped = (subId: string | null) => !subId || subId === 'admin_override'

// The service-role client is untyped, so the rows it hands back are shaped here
// once rather than spot-cast at every use. `numeric` columns arrive as strings.
export type Num = number | string | null
export type PaymentRow = {
  id: string
  plan_id: string | null
  plan_tenant_id: string | null
  due_date: string
  amount: Num
  paid_amount?: Num
  paid_date: string | null
  status: string
  payment_method: string | null
  processing_fee: Num
  recorded_by: string | null
  stripe_payment_intent_id: string | null
  updated_at: string | null
  category?: string | null
  label?: string | null
}
export type PropertyRef = { id: string; name: string | null }
export type PlanRow = {
  id: string; name: string | null; owner_id: string; property_id: string | null
  property: PropertyRef | PropertyRef[] | null
}
export type PayerRow = { id: string; plan_id: string; name: string | null; email: string | null }
export type SubRow = {
  id: string; landlord_id: string; plan_type: string; status: string
  stripe_subscription_id: string | null; created_at: string
  updated_at: string | null; current_period_end: string | null
}
export type UnlockRow = {
  id: string; landlord_id: string; unlock_type: string
  created_at: string; stripe_payment_intent_id: string | null
}
export type ProfileRow = { id: string; full_name: string | null; email: string | null }

export type Txn = {
  id: string
  kind: 'rent' | 'subscription' | 'lifetime' | 'per_lead'
  source: RevenueSource
  date: string
  month: string
  status: 'paid' | 'processing'
  method: SettleMethod
  /** False for Zelle/cash the landlord recorded: real rent, no Stripe, no fee. */
  onPlatform: boolean
  volumeCents: number
  passThroughCents: number
  feeCents: number
  costCents: number
  netCents: number
  items: string[]
  payer: string | null
  payerEmail: string | null
  propertyId: string | null
  propertyName: string | null
  landlordId: string | null
  landlordName: string | null
  intentId: string | null
}

const monthKey = (iso: string) => iso.slice(0, 7)

/** Last `n` months as YYYY-MM, oldest first, ending with the current one. */
function recentMonths(n: number, now = new Date()): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

export type FinancialsInput = {
  scheduled: PaymentRow[]
  specials: PaymentRow[]
  plans: PlanRow[]
  payers: PayerRow[]
  subs: SubRow[]
  unlocks: UnlockRow[]
  profiles: ProfileRow[]
  /** Injectable so a test can ask what the books looked like on a given day. */
  now?: Date
}

/** The whole Financials tab, computed. Pure: same rows in, same report out. */
export function buildFinancials(input: FinancialsInput) {
  const { scheduled, specials, plans, subs, unlocks } = input
  const now = input.now ?? new Date()

  const planById = new Map(plans.map(p => [p.id, p]))
  const payerById = new Map(input.payers.map(t => [t.id, t]))
  const profileById = new Map(input.profiles.map(p => [p.id, p]))

  const landlordName = (id: string | null) => {
    if (!id) return null
    const p = profileById.get(id)
    return p?.full_name || p?.email || null
  }

  // ── Rent: group the settled rows back into the charge that paid them ──────
  //
  // One Stripe intent can cover several months plus a one-off, and the
  // surcharge is recorded on only the first of those rows (see rentSettlement).
  // Summing rows would therefore say nothing useful about a *payment*; the
  // intent is the unit an admin recognises, and the unit Stripe billed us for.
  // Rows a landlord marked paid by hand have no intent, so each stands alone.

  type Group = {
    intentId: string | null
    rows: { label: string; amount: number }[]
    method: SettleMethod
    status: 'paid' | 'processing'
    planId: string | null
    payerId: string | null
    passThroughCents: number
    feeCents: number
    date: string
  }
  const groups = new Map<string, Group>()

  const settledDate = (r: PaymentRow): string =>
    r.paid_date ?? (r.updated_at ? String(r.updated_at).slice(0, 10) : r.due_date)

  const addRow = (r: PaymentRow, label: string) => {
    if (r.status !== 'paid' && r.status !== 'processing') return
    const method: SettleMethod =
      r.payment_method === 'card' || r.payment_method === 'ach' ||
      r.payment_method === 'manual_zelle' ? r.payment_method : 'manual_other'
    const key = r.stripe_payment_intent_id ?? `row:${r.id}`
    const charged = r.status === 'paid' && Number(r.paid_amount ?? 0) > 0
      ? dollarsToCents(r.paid_amount)
      : dollarsToCents(r.amount)

    const g: Group = groups.get(key) ?? {
      intentId: r.stripe_payment_intent_id ?? null,
      rows: [], method, status: r.status as 'paid' | 'processing',
      planId: r.plan_id, payerId: r.plan_tenant_id,
      passThroughCents: 0, feeCents: 0, date: settledDate(r),
    }
    g.rows.push({ label, amount: charged })
    g.passThroughCents += charged
    g.feeCents += dollarsToCents(r.processing_fee)
    // A paid row anywhere in the intent means the money landed.
    if (r.status === 'paid') g.status = 'paid'
    // Earliest settlement date in the group: the moment the charge cleared.
    if (settledDate(r) < g.date) g.date = settledDate(r)
    groups.set(key, g)
  }

  const rentMonth = (due: string) =>
    new Date(due + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

  for (const r of scheduled) addRow(r, `Rent — ${rentMonth(r.due_date)}`)
  for (const r of specials) addRow(r, r.label || r.category || 'One-off charge')

  const txns: Txn[] = []

  for (const [key, g] of groups) {
    const plan = g.planId ? planById.get(g.planId) ?? null : null
    const property = plan ? (Array.isArray(plan.property) ? plan.property[0] ?? null : plan.property) : null
    const payer = g.payerId ? payerById.get(g.payerId) ?? null : null
    const onPlatform = g.method === 'card' || g.method === 'ach'
    const e = economics({ passThroughCents: g.passThroughCents, feeCents: g.feeCents, method: g.method })

    txns.push({
      id: key,
      kind: 'rent',
      source: g.method === 'ach' ? 'rent_ach' : 'rent_card',
      date: g.date,
      month: monthKey(g.date),
      status: g.status,
      method: g.method,
      onPlatform,
      ...e,
      items: g.rows.map(r => r.label),
      payer: payer?.name ?? null,
      payerEmail: payer?.email ?? null,
      propertyId: property?.id ?? null,
      propertyName: property?.name ?? plan?.name ?? null,
      landlordId: plan?.owner_id ?? null,
      landlordName: landlordName(plan?.owner_id ?? null),
      intentId: g.intentId,
    })
  }

  // ── SaaS: subscriptions, lifetime deals, lead unlocks ─────────────────────
  //
  // A subscription bills every month it was live, so one row becomes one charge
  // per month between sign-up and cancellation — anything less would draw a
  // revenue chart that spikes on sign-up day and flatlines after. Comped plans
  // bill nothing and are counted nowhere.

  const nowMonth = monthKey(now.toISOString())

  for (const s of subs) {
    if (isComped(s.stripe_subscription_id)) continue
    const priceCents = PLAN_PRICE_CENTS[s.plan_type] ?? 0
    if (priceCents === 0 || !s.created_at) continue
    const start = String(s.created_at).slice(0, 10)

    if (s.plan_type === 'lifetime') {
      const e = economics({ passThroughCents: 0, feeCents: priceCents, method: 'card' })
      txns.push({
        id: `sub:${s.id}`, kind: 'lifetime', source: 'lifetime',
        date: start, month: monthKey(start), status: 'paid', method: 'card', onPlatform: true, ...e,
        items: ['Lifetime deal'], payer: landlordName(s.landlord_id), payerEmail: profileById.get(s.landlord_id)?.email ?? null,
        propertyId: null, propertyName: null,
        landlordId: s.landlord_id, landlordName: landlordName(s.landlord_id), intentId: null,
      })
      continue
    }

    // Recurring: one charge per month it was active.
    const endIso = s.status === 'active'
      ? now.toISOString()
      : String(s.current_period_end ?? s.updated_at ?? s.created_at)
    let cursor = new Date(start + 'T12:00:00')
    const endMonth = monthKey(endIso.slice(0, 10))
    let n = 0
    while (monthKey(cursor.toISOString().slice(0, 10)) <= endMonth && n < 120) {
      const iso = cursor.toISOString().slice(0, 10)
      const m = monthKey(iso)
      if (m > nowMonth) break
      const e = economics({ passThroughCents: 0, feeCents: priceCents, method: 'card' })
      txns.push({
        id: `sub:${s.id}:${m}`, kind: 'subscription', source: 'subscription',
        date: iso, month: m, status: 'paid', method: 'card', onPlatform: true, ...e,
        items: [s.plan_type === 'two_listing' ? 'Unlimited listings — monthly' : '1 listing — monthly'],
        payer: landlordName(s.landlord_id), payerEmail: profileById.get(s.landlord_id)?.email ?? null,
        propertyId: null, propertyName: null,
        landlordId: s.landlord_id, landlordName: landlordName(s.landlord_id), intentId: null,
      })
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate(), 12)
      n++
    }
  }

  for (const u of unlocks) {
    if (u.unlock_type !== 'per_lead' || !u.created_at) continue
    const date = String(u.created_at).slice(0, 10)
    const e = economics({ passThroughCents: 0, feeCents: PLAN_PRICE_CENTS.per_lead, method: 'card' })
    txns.push({
      id: `unlock:${u.id}`, kind: 'per_lead', source: 'per_lead',
      date, month: monthKey(date), status: 'paid', method: 'card', onPlatform: true, ...e,
      items: ['Lead unlock'], payer: landlordName(u.landlord_id),
      payerEmail: profileById.get(u.landlord_id)?.email ?? null,
      propertyId: null, propertyName: null,
      landlordId: u.landlord_id, landlordName: landlordName(u.landlord_id),
      intentId: u.stripe_payment_intent_id ?? null,
    })
  }

  txns.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  // ── Roll-ups ──────────────────────────────────────────────────────────────
  const sum = (list: Txn[]) => list.reduce<Economics>((acc, t) => addEconomics(acc, t), emptyEconomics())

  const months = recentMonths(12, now)
  const byMonth = months.map(m => {
    const inMonth = txns.filter(t => t.month === m)
    const e = sum(inMonth)
    return {
      month: m,
      ...e,
      count: inMonth.length,
      rentNetCents: sum(inMonth.filter(t => t.kind === 'rent')).netCents,
      saasNetCents: sum(inMonth.filter(t => t.kind !== 'rent')).netCents,
      offPlatformVolumeCents: sum(inMonth.filter(t => !t.onPlatform)).volumeCents,
    }
  })

  const today = now
  const thisMonth = monthKey(today.toISOString())
  const dayOfMonth = today.getDate()
  const prevDate = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`

  // Compare like with like: month-to-date against the same slice of last month,
  // otherwise every month looks like a collapse until the 28th.
  const upToSameDay = (t: Txn) => Number(t.date.slice(8, 10)) <= dayOfMonth
  const mtd = sum(txns.filter(t => t.month === thisMonth))
  const prevMtd = sum(txns.filter(t => t.month === prevMonth && upToSameDay(t)))
  const prevFull = sum(txns.filter(t => t.month === prevMonth))

  const METHODS: SettleMethod[] = ['card', 'ach', 'manual_zelle', 'manual_other']
  const byMethod = METHODS.map(m => {
    const list = txns.filter(t => t.kind === 'rent' && t.method === m)
    return { method: m, ...sum(list), count: list.length }
  })

  const SOURCES: RevenueSource[] = ['rent_card', 'rent_ach', 'subscription', 'lifetime', 'per_lead']
  const bySource = SOURCES.map(s => {
    const list = txns.filter(t => t.source === s && t.onPlatform)
    return { source: s, ...sum(list), count: list.length }
  })

  const groupBy = (key: 'landlordId' | 'propertyId', nameKey: 'landlordName' | 'propertyName') => {
    const acc = new Map<string, { id: string; name: string; e: Economics; count: number }>()
    for (const t of txns) {
      const id = t[key]
      if (!id) continue
      const cur = acc.get(id) ?? { id, name: t[nameKey] ?? '—', e: emptyEconomics(), count: 0 }
      cur.e = addEconomics(cur.e, t)
      cur.count++
      acc.set(id, cur)
    }
    return [...acc.values()]
      .sort((a, b) => b.e.netCents - a.e.netCents || b.e.volumeCents - a.e.volumeCents)
      .slice(0, 8)
      .map(r => ({ id: r.id, name: r.name, count: r.count, ...r.e }))
  }

  // ── What hasn't happened yet ──────────────────────────────────────────────
  //
  // Two forward-looking numbers an admin acts on: money in flight (an ACH debit
  // can still bounce) and rent still owed. The second doubles as the size of
  // the prize — at today's rates, what that rent would earn if it were paid
  // through us rather than by Zelle.
  const openRows = [
    ...scheduled.filter(r => ['pending', 'late', 'missed', 'partial'].includes(r.status)),
    ...specials.filter(r => r.status === 'pending'),
  ]
  const stillOwed = (r: PaymentRow) =>
    Math.max(0, dollarsToCents(r.amount) - dollarsToCents(r.paid_amount))
  const outstandingCents = openRows.reduce((s, r) => s + stillOwed(r), 0)
  const overdueCents = scheduled
    .filter(r => ['late', 'missed'].includes(r.status))
    .reduce((s, r) => s + stillOwed(r), 0)

  const inFlight = sum(txns.filter(t => t.status === 'processing'))
  const offPlatform = sum(txns.filter(t => t.kind === 'rent' && !t.onPlatform))

  // If off-platform rent had gone through us on ACH — the cheaper rail, and the
  // realistic one to pitch — this is what it would have netted.
  const achOpportunityCents = (() => {
    const fee = Math.round(offPlatform.volumeCents * FEE_RATES.ach)
    const cost = txns.filter(t => t.kind === 'rent' && !t.onPlatform).reduce((s, t) => {
      const f = Math.round(t.volumeCents * FEE_RATES.ach)
      return s + Math.min(STRIPE_RATES.ach.capCents ?? Infinity, Math.round((t.volumeCents + f) * STRIPE_RATES.ach.pct))
    }, 0)
    return fee - cost
  })()

  // ── Anything that needs a human ───────────────────────────────────────────
  const alerts: { level: 'warn' | 'info'; text: string }[] = []
  const negative = txns.filter(t => t.onPlatform && t.feeCents > 0 && t.netCents < 0)
  if (negative.length > 0)
    alerts.push({ level: 'warn', text: `${negative.length} charge${negative.length > 1 ? 's' : ''} cost more in Stripe fees than they earned.` })
  const feeless = txns.filter(t => t.onPlatform && t.kind === 'rent' && t.feeCents === 0)
  if (feeless.length > 0)
    alerts.push({ level: 'warn', text: `${feeless.length} Stripe rent payment${feeless.length > 1 ? 's have' : ' has'} no surcharge recorded — we paid the processing on that volume.` })
  if (inFlight.volumeCents > 0)
    alerts.push({ level: 'info', text: `${(inFlight.volumeCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} of ACH is still settling and can still bounce.` })

  return {
    generatedAt: now.toISOString(),
    rates: {
      surcharge: FEE_RATES,
      stripe: {
        card: { pct: STRIPE_RATES.card.pct, fixedCents: STRIPE_RATES.card.fixedCents },
        ach:  { pct: STRIPE_RATES.ach.pct, fixedCents: STRIPE_RATES.ach.fixedCents, capCents: STRIPE_RATES.ach.capCents },
      },
    },
    totals: {
      allTime: sum(txns),
      mtd, prevMtd, prevFull,
      thisMonth, prevMonth, dayOfMonth,
      inFlight, offPlatform,
      outstandingCents, overdueCents, achOpportunityCents,
      txCount: txns.length,
      onPlatformTxCount: txns.filter(t => t.onPlatform).length,
    },
    byMonth,
    byMethod,
    bySource,
    topLandlords: groupBy('landlordId', 'landlordName'),
    topProperties: groupBy('propertyId', 'propertyName'),
    transactions: txns.slice(0, 500),
    alerts,
  }
}
