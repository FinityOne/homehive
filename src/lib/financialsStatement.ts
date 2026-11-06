/**
 * The owner statement — one property, one month, on paper.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Every other surface in the money area is built for a landlord *working*:
 * dense, interactive, filterable. None of it is any use for the thing a
 * landlord has to do several times a year — hand a month's figures to somebody
 * else. An accountant at tax time, a lender underwriting a refinance, a
 * co-owner who wants to see where their share went, a lawyer who needs the
 * arrears documented. Those people want one page per property per month, with
 * the arithmetic shown.
 *
 * Screenshotting a dashboard is not that, and it is what landlords were left
 * doing.
 *
 * ── The one piece of real accounting in this product ──────────────────────
 *
 * A statement has to *balance*, which nothing else here has to:
 *
 *     opening arrears + billed in month − collected in month = closing arrears
 *
 * That identity is the whole value of the document — it is what makes it
 * checkable by someone who was not there. So this module computes both sides
 * and carries `balances`, and the page refuses to present a statement that does
 * not tie. A statement that silently does not add up is worse than no statement
 * at all: it will be forwarded to an accountant who trusts it.
 *
 * ── Deliberate omissions ───────────────────────────────────────────────────
 *
 *   • **No processing surcharges.** The tenant pays those to the processor.
 *     They are never the landlord's money and never appear on their statement.
 *   • **Deposits are not income.** A deposit is a liability — the landlord is
 *     holding somebody else's money — so it sits in its own section, outside
 *     the rent arithmetic entirely. Rolling deposits into collected rent is the
 *     most common error in small-landlord bookkeeping and this will not do it.
 *   • **Late fees are shown apart from rent**, assessed and received, so a
 *     collection rate on the page stays rent against rent.
 *
 * Pure: plans in, a statement out.
 */


import { billingToday } from '@/lib/financialsRollup'
import {
  allCharges, monthRange, monthLabel, monthKeyOf,
  type MonthKey, type Charge,
} from '@/lib/financialsMonth'
import type { PaymentPlan } from '@/lib/payments'

const round2 = (n: number) => Math.round(n * 100) / 100

/** One line on the statement: a charge, or a payment against one. */
export type StatementLine = {
  date: string
  /** 'Rent — November 2026' */
  label: string
  who: string | null
  leaseName: string
  /** What was asked for in the month. */
  billed: number
  /** What arrived against it, rent and charges only. */
  collected: number
  /** Late-fee money received on top. Never inside `collected`. */
  feesCollected: number
  /** Still owed on it at the close of the month. */
  outstanding: number
  kind: 'rent' | 'charge' | 'deposit'
  /** Days late when it settled; null if it has not. */
  daysLate: number | null
}

/** A tenant's column on the statement. */
export type StatementPayer = {
  name: string
  leaseName: string
  billed: number
  collected: number
  feesCollected: number
  outstanding: number
  /** Arrears carried in from before the month started. */
  opening: number
}

export type Statement = {
  propertyId: string
  propertyName: string
  month: MonthKey
  monthLabel: string
  from: string
  to: string
  /** The day the statement was produced — a statement without one is unusable. */
  producedOn: string

  // ── The rent arithmetic, in the order it has to be read ──
  /** Owed on this property before the month began. */
  openingArrears: number
  /** Rent, utilities and one-off charges that fell due in the month. */
  billed: number
  /** Rent and charges received against charges due in the month. */
  collected: number
  /** Money received in the month against charges from *earlier* months —
   *  arrears recovery, which is why opening and closing do not simply differ
   *  by the month's own shortfall. */
  recovered: number
  /** Owed at the close: opening + billed − collected − recovered. */
  closingArrears: number
  /** Whether the identity above actually holds. See the module note. */
  balances: boolean

  // ── Kept out of the rent arithmetic on purpose ──
  feesAssessed: number
  feesCollected: number
  depositsReceived: number
  depositsHeld: number

  /** collected ÷ billed, 0–100. Rent against rent. Null when nothing billed. */
  rate: number | null

  leases: { name: string; billed: number; collected: number; outstanding: number }[]
  payers: StatementPayer[]
  lines: StatementLine[]
  empty: boolean
}

/**
 * One property's statement for one month.
 *
 * `plans` is the whole portfolio; the property filter happens here so that a
 * caller cannot accidentally hand in a pre-filtered set that has already lost
 * the charges needed for the opening balance.
 */
export function statement(
  plans: PaymentPlan[],
  propertyId: string,
  month: MonthKey,
  now = new Date(),
): Statement {
  const mine = plans.filter(p => (p.property?.id ?? p.property_id) === propertyId)
  const range = monthRange(month)
  const charges = allCharges(mine, now)

  const inMonth = charges.filter(c => c.dueDate >= range.from! && c.dueDate <= range.to!)
  const earlier = charges.filter(c => c.dueDate < range.from!)

  // ── Opening: what was owed on charges from before the month ──
  //
  // Reconstructed rather than snapshotted, because nothing in this product
  // snapshots a balance. For a charge due earlier, what was outstanding at the
  // start of the month is its shortfall today *plus* anything paid against it
  // during or after the month.
  const paidInOrAfterMonth = (c: Charge) =>
    c.settlement?.paidDate && c.settlement.paidDate >= range.from! ? c.settlement.net : 0

  const openingArrears = round2(
    earlier.reduce((n, c) => n + c.outstanding + paidInOrAfterMonth(c), 0),
  )

  // Money received during the month against those earlier charges.
  const recovered = round2(
    earlier.reduce((n, c) => {
      const d = c.settlement?.paidDate
      return d && d >= range.from! && d <= range.to! ? n + c.settlement!.net : n
    }, 0),
  )

  const deposits = inMonth.filter(c => c.kind === 'charge' && c.categoryLabel === 'Security Deposit')
  const rentish = inMonth.filter(c => !deposits.includes(c))

  const billed = round2(rentish.reduce((n, c) => n + c.amount, 0))
  const collected = round2(rentish.reduce((n, c) => n + c.paid, 0))
  const feesAssessed = round2(rentish.reduce((n, c) => n + c.lateFee + c.lateFeePaid, 0))
  const feesCollected = round2(rentish.reduce((n, c) => n + c.lateFeePaid, 0))

  // Closing is derived from the identity, then checked against the figure the
  // charges themselves report. If the two disagree the statement says so
  // instead of printing one of them.
  const derivedClosing = round2(openingArrears + billed - collected - recovered)
  const observedClosing = round2(
    earlier.reduce((n, c) => n + c.outstanding, 0) + rentish.reduce((n, c) => n + c.outstanding, 0),
  )
  const balances = Math.abs(derivedClosing - observedClosing) < 0.02

  const byLease = new Map<string, { billed: number; collected: number; outstanding: number }>()
  for (const c of rentish) {
    const cur = byLease.get(c.leaseName) ?? { billed: 0, collected: 0, outstanding: 0 }
    cur.billed = round2(cur.billed + c.amount)
    cur.collected = round2(cur.collected + c.paid)
    cur.outstanding = round2(cur.outstanding + c.outstanding)
    byLease.set(c.leaseName, cur)
  }

  const byPayer = new Map<string, StatementPayer>()
  for (const c of rentish) {
    const key = `${c.who ?? 'The lease'}|${c.leaseName}`
    const cur = byPayer.get(key) ?? {
      name: c.who ?? 'The lease',
      leaseName: c.leaseName,
      billed: 0, collected: 0, feesCollected: 0, outstanding: 0, opening: 0,
    }
    cur.billed = round2(cur.billed + c.amount)
    cur.collected = round2(cur.collected + c.paid)
    cur.feesCollected = round2(cur.feesCollected + c.lateFeePaid)
    cur.outstanding = round2(cur.outstanding + c.outstanding)
    byPayer.set(key, cur)
  }
  for (const c of earlier) {
    const key = `${c.who ?? 'The lease'}|${c.leaseName}`
    const cur = byPayer.get(key)
    const opening = c.outstanding + paidInOrAfterMonth(c)
    if (opening <= 0) continue
    if (cur) cur.opening = round2(cur.opening + opening)
    else byPayer.set(key, {
      name: c.who ?? 'The lease',
      leaseName: c.leaseName,
      billed: 0, collected: 0, feesCollected: 0, outstanding: 0, opening: round2(opening),
    })
  }

  const lines: StatementLine[] = inMonth
    .slice()
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.who ?? '').localeCompare(b.who ?? ''))
    .map(c => ({
      date: c.dueDate,
      label: c.label,
      who: c.who,
      leaseName: c.leaseName,
      billed: c.amount,
      collected: c.paid,
      feesCollected: c.lateFeePaid,
      outstanding: c.outstanding,
      kind: deposits.includes(c) ? 'deposit' : c.kind,
      daysLate: c.settlement?.daysLate ?? null,
    }))

  return {
    propertyId,
    propertyName: mine[0]?.property?.name ?? 'This property',
    month,
    monthLabel: monthLabel(month),
    from: range.from!,
    to: range.to!,
    producedOn: billingToday(now),

    openingArrears,
    billed,
    collected,
    recovered,
    closingArrears: derivedClosing,
    balances,

    feesAssessed,
    feesCollected,
    depositsReceived: round2(deposits.reduce((n, c) => n + c.paid, 0)),
    depositsHeld: round2(
      mine.reduce((n, p) => n + (p.special_payments ?? [])
        .filter(sp => sp.category === 'security_deposit' && sp.status === 'paid')
        .reduce((m, sp) => m + Number(sp.amount), 0), 0),
    ),

    rate: billed > 0 ? Math.round((collected / billed) * 100) : null,

    leases: [...byLease.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.billed - a.billed),
    payers: [...byPayer.values()].sort((a, b) => b.billed - a.billed || a.name.localeCompare(b.name)),
    lines,
    empty: inMonth.length === 0 && openingArrears === 0,
  }
}

/** The statement as a spreadsheet, for an accountant who wants the rows. */
export function statementCsv(s: Statement): string {
  const esc = (v: string | number) => {
    const t = String(v ?? '')
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const rows: (string | number)[][] = [
    [`Owner statement — ${s.propertyName}`],
    [`${s.monthLabel} (${s.from} to ${s.to})`],
    [`Produced ${s.producedOn}`],
    [],
    ['Summary'],
    ['Opening arrears', s.openingArrears.toFixed(2)],
    ['Billed in month', s.billed.toFixed(2)],
    ['Collected against the month', s.collected.toFixed(2)],
    ['Recovered from earlier months', s.recovered.toFixed(2)],
    ['Closing arrears', s.closingArrears.toFixed(2)],
    ['Collection rate', s.rate !== null ? `${s.rate}%` : 'n/a'],
    [],
    ['Outside the rent arithmetic'],
    ['Late fees assessed', s.feesAssessed.toFixed(2)],
    ['Late fees received', s.feesCollected.toFixed(2)],
    ['Deposits received in month', s.depositsReceived.toFixed(2)],
    ['Deposits held (liability)', s.depositsHeld.toFixed(2)],
    [],
    ['Date', 'Charge', 'Tenant', 'Lease', 'Type', 'Billed', 'Collected', 'Late fee in', 'Outstanding', 'Days late'],
    ...s.lines.map(l => [
      l.date, l.label, l.who ?? '', l.leaseName, l.kind,
      l.billed.toFixed(2), l.collected.toFixed(2), l.feesCollected.toFixed(2),
      l.outstanding.toFixed(2), l.daysLate ?? '',
    ]),
  ]
  return rows.map(r => r.map(esc).join(',')).join('\n')
}

/** The months a property has any activity in, newest first — for the picker. */
export function statementMonths(plans: PaymentPlan[], propertyId: string, now = new Date()): MonthKey[] {
  const mine = plans.filter(p => (p.property?.id ?? p.property_id) === propertyId)
  const keys = new Set<MonthKey>()
  for (const p of mine) {
    for (const sp of p.scheduled_payments ?? []) keys.add(sp.due_date.slice(0, 7))
    for (const sp of p.special_payments ?? []) keys.add(sp.due_date.slice(0, 7))
  }
  // The current month always offers itself, even on a property that bills on
  // the 1st and has nothing yet.
  keys.add(monthKeyOf(now))
  return [...keys].sort((a, b) => b.localeCompare(a))
}

