/**
 * One property, both sides of the ledger.
 *
 * ── What this module is for ────────────────────────────────────────────────
 *
 * `financialsTree` can tell you a property's contracted rent, what it has
 * collected and what it is owed. `propertyExpenses` can tell you what it costs.
 * Neither can answer the question an owner actually asks — *is this building
 * worth owning* — because that needs both at once, month by month, against the
 * rent it is capable of earning.
 *
 * So this joins them, and adds the third thing neither holds: what the property
 * is *not* earning. A six-bedroom house with four tenants is not a success with
 * four rent cheques, it is a success with a $1,100 hole in it, and until now
 * nothing in this product has said so.
 *
 * ── The accrual convention, stated once ───────────────────────────────────
 *
 * Income here is bucketed by the month a charge *fell due*, which is what
 * `trend()` in financialsDashboard already does and therefore what every chart
 * in the money area already means. Expenses are bucketed by `incurred_on`.
 * Both are "this belongs to October", not "this moved on the 4th" — so the two
 * sides are comparable, which they would not be if one were cash-dated and the
 * other accrued.
 *
 * It is worth being plain about the consequence: October's rent paid in
 * November counts in October on this page. That is the accountant's reading and
 * the right one for judging a month, but it means this page and a bank
 * statement will differ in any month where rent arrived late. The Payments tab
 * is the cash-dated view and exists for exactly that reconciliation.
 *
 * Pure. Charges, expenses and a property row in; figures out.
 */

import { trend, type TrendPoint } from './financialsDashboard'
import { monthKeyOf, monthLabel, shiftMonth, type Charge, type MonthKey } from './financialsMonth'
import {
  EMPTY_EXPENSE_TOTALS, expensesByMonth, inYear, noi, totalExpenses,
  type Expense, type ExpenseTotals, type Noi,
} from './propertyExpenses'
import type { TreeProperty } from './financialsTree'

// ── The property row, as this module needs it ────────────────────────────────

/**
 * The listing facts that decide what a property *could* earn.
 *
 * Deliberately a narrow type rather than the whole `properties` row: this
 * module needs five fields and taking the lot would couple every reader to a
 * fifty-column table. Every field is nullable because every one of them is
 * optional on a listing, and the model's job is to degrade rather than to
 * demand the landlord fill a form before seeing their own figures.
 */
export type PropertyFacts = {
  id: string
  name: string
  slug: string | null
  address: string | null
  /** The asking rent on the listing — per room in a by-the-room letting. */
  price: number | null
  /** Lettable rooms, for a by-the-room property. */
  total_rooms: number | null
  beds: number | null
  baths: number | null
  security_deposit: number | null
  listing_status: string | null
  available_from: string | null
}

// ── Occupancy, and what the empty part costs ─────────────────────────────────

export type Occupancy = {
  /** Lettable rooms, when the listing says. Null when it does not. */
  rooms: number | null
  /** Payers currently on a live lease. */
  filled: number
  /** rooms − filled, floored at zero. Null without a room count. */
  empty: number | null
  /** filled ÷ rooms, 0–100. Null without a room count. */
  pct: number | null
  /**
   * What an empty room is costing per month, at the listing's own asking rent.
   *
   * Asking rent rather than the average of what sitting tenants pay, and the
   * distinction matters: a landlord with four tenants at $600 and an ask of
   * $700 is losing $700 a month on the empty room, not $600. The ask is the
   * price they have decided the room is worth.
   *
   * Null when the listing carries no price — in which case this says nothing
   * rather than guessing from the lease, because a per-room average derived
   * from a whole-house lease would be fiction.
   */
  monthlyLoss: number | null
  /** The basis, so the figure can be read sceptically. */
  lossBasis: string | null
}

export function occupancy(facts: PropertyFacts | null, prop: TreeProperty | null): Occupancy {
  const filled = prop
    ? prop.leases
        .filter(l => l.stage === 'active' || l.stage === 'ending')
        .reduce((n, l) => n + l.activePayers, 0)
    : 0
  const rooms = facts?.total_rooms && facts.total_rooms > 0 ? facts.total_rooms : null

  if (rooms === null) {
    return { rooms: null, filled, empty: null, pct: null, monthlyLoss: null, lossBasis: null }
  }

  // Floored at zero: more payers than rooms is a data quirk (a couple sharing,
  // a room let twice over a changeover) and must never read as negative loss.
  const empty = Math.max(0, rooms - filled)
  const ask = facts?.price && facts.price > 0 ? facts.price : null

  return {
    rooms,
    filled,
    empty,
    pct: Math.min(100, Math.round((filled / rooms) * 100)),
    monthlyLoss: ask === null ? null : empty * ask,
    lossBasis: ask === null
      ? null
      : `${empty} empty × $${ask.toLocaleString()} asking rent`,
  }
}

// ── The month series ─────────────────────────────────────────────────────────

export type MonthPnl = {
  key: MonthKey
  label: string
  longLabel: string
  position: 'past' | 'current' | 'future'
  /** Charges that fell due in the month. */
  billed: number
  /** Money received against them, late fees included. */
  received: number
  /** Still owed on them today. */
  stillDue: number
  expenses: ExpenseTotals
  /** received − operating cost. */
  noi: number
  /** noi − debt service. */
  cashFlow: number
}

/**
 * Income and cost side by side, oldest first.
 *
 * The series is retrospective: it ends at the current month and never reaches
 * past it, because `trend()` builds its keys backwards from today. That is the
 * right shape for a P&L — what falls due *ahead* is the Schedule tab's job, and
 * a cost that has not been incurred has no amount, so a forward row here would
 * show contracted income against zero cost and read as a profit forecast.
 *
 * The last point is therefore the month in progress, flagged `current`. It is
 * real money and belongs in every total, but it is a *partial* month, which is
 * why `periodPnl` keeps it out of the per-month average.
 */
export function monthlyPnl(
  charges: Charge[],
  expenses: Expense[],
  months = 12,
  now = new Date(),
): MonthPnl[] {
  const points = trend(charges, months, now)
  const spend = expensesByMonth(expenses)
  return points.map(p => fromTrendPoint(p, spend.get(p.key) ?? EMPTY_EXPENSE_TOTALS))
}

function fromTrendPoint(p: TrendPoint, e: ExpenseTotals): MonthPnl {
  const n = p.received - e.operating
  return {
    key: p.key,
    label: p.label,
    longLabel: p.longLabel,
    position: p.position,
    billed: p.billed,
    received: p.received,
    stillDue: p.stillDue,
    expenses: e,
    noi: n,
    cashFlow: n - e.financing,
  }
}

// ── A period, totalled ───────────────────────────────────────────────────────

export type PeriodPnl = {
  label: string
  /** Months in the window with money in them, the running month included. */
  months: number
  /** Finished months only — the divisor for anything averaged. */
  completedMonths: number
  billed: number
  received: number
  stillDue: number
  expenses: ExpenseTotals
  pnl: Noi
  /**
   * Average monthly cash flow over the *finished* months. Null with none.
   *
   * Deliberately not `cashFlow / months`. On the 5th of the month the running
   * month has a few days of rent in it and none of its bills, and dividing by a
   * month count that includes it understates the average every single time a
   * landlord looks early — which is most of the time.
   */
  perMonth: number | null
}

/**
 * Total a set of months.
 *
 * Totals include the running month, because that money genuinely arrived.
 * Averages do not, because it is a partial month: see `perMonth`.
 */
export function periodPnl(series: MonthPnl[], label: string): PeriodPnl {
  // `monthlyPnl` cannot produce a future month; the filter is kept as a guard
  // so a caller that builds a series some other way cannot quietly fold
  // contracted-but-uncollected income into a result.
  const real = series.filter(m => m.position !== 'future')
  const done = real.filter(m => m.position === 'past')
  const sum = (f: (m: MonthPnl) => number) => round2(real.reduce((n, m) => n + f(m), 0))

  const expenses: ExpenseTotals = {
    all: sum(m => m.expenses.all),
    deductible: sum(m => m.expenses.deductible),
    operating: sum(m => m.expenses.operating),
    financing: sum(m => m.expenses.financing),
    capital: sum(m => m.expenses.capital),
    count: real.reduce((n, m) => n + m.expenses.count, 0),
    byCategory: [],
    byGroup: {
      financing: sum(m => m.expenses.byGroup.financing),
      fixed: sum(m => m.expenses.byGroup.fixed),
      operating: sum(m => m.expenses.byGroup.operating),
      capital: sum(m => m.expenses.byGroup.capital),
    },
  }

  const received = sum(m => m.received)
  const pnl = noi(received, expenses)
  return {
    label,
    months: real.length,
    completedMonths: done.length,
    billed: sum(m => m.billed),
    received,
    stillDue: sum(m => m.stillDue),
    expenses,
    pnl,
    perMonth: done.length > 0
      ? round2(done.reduce((n, m) => n + m.cashFlow, 0) / done.length)
      : null,
  }
}

// ── A year ───────────────────────────────────────────────────────────────────

export type YearPnl = {
  year: string
  billed: number
  received: number
  expenses: ExpenseTotals
  pnl: Noi
  /** True while the year is still running, so nothing calls it a final figure. */
  running: boolean
}

/**
 * One calendar year, both sides.
 *
 * `running` exists so no surface can print a part-year total as though the year
 * were closed. A landlord shown "2026: $4,100" in March will read it as the
 * year's result, and the page has to be able to say otherwise.
 */
export function yearPnl(
  charges: Charge[],
  expenses: Expense[],
  year: string,
  now = new Date(),
): YearPnl {
  const yearCharges = charges.filter(c => c.dueDate.slice(0, 4) === year)
  const billed = round2(yearCharges.reduce((n, c) => n + c.amount, 0))
  const received = round2(yearCharges.reduce((n, c) => n + c.paid + c.lateFeePaid, 0))
  const totals = totalExpenses(inYear(expenses, year))
  return {
    year,
    billed,
    received,
    expenses: totals,
    pnl: noi(received, totals),
    running: Number(year) >= now.getFullYear(),
  }
}

/** Every year this property has either billed in or spent in, newest first. */
export function pnlYears(charges: Charge[], expenses: Expense[], now = new Date()): string[] {
  const years = new Set<string>()
  for (const c of charges) years.add(c.dueDate.slice(0, 4))
  for (const e of expenses) years.add(e.incurred_on.slice(0, 4))
  // Always offer this year, so a landlord with no history can still start
  // entering costs against a year the picker admits exists.
  years.add(String(now.getFullYear()))
  return [...years].sort().reverse()
}

// ── Windows ──────────────────────────────────────────────────────────────────

export type PnlWindow = '3m' | '6m' | '12m' | '24m'

export const PNL_WINDOWS: { id: PnlWindow; label: string; months: number }[] = [
  { id: '3m', label: 'Last 3 months', months: 3 },
  { id: '6m', label: 'Last 6 months', months: 6 },
  { id: '12m', label: 'Last 12 months', months: 12 },
  { id: '24m', label: 'Last 2 years', months: 24 },
]

export const windowMonths = (w: PnlWindow) =>
  PNL_WINDOWS.find(x => x.id === w)?.months ?? 12

/** The window's own months, for a caller that needs the keys rather than the data. */
export function windowKeys(w: PnlWindow, now = new Date()): MonthKey[] {
  const months = windowMonths(w)
  const thisKey = monthKeyOf(now)
  return Array.from({ length: months }, (_, i) => shiftMonth(thisKey, i - (months - 1)))
}

export const windowLabel = (w: PnlWindow) =>
  PNL_WINDOWS.find(x => x.id === w)?.label ?? 'Last 12 months'

// ── Rent against the market ──────────────────────────────────────────────────

export type AskGap = {
  /** What sitting tenants actually pay per month, in total. */
  contracted: number
  /** What the listing asks, scaled to the whole property. */
  asking: number | null
  /** asking − contracted. Positive means the property is under-let. */
  gap: number | null
  /** The gap as a share of asking, 0–100. */
  gapPct: number | null
  basis: string | null
}

/**
 * Contracted rent against what the listing asks for the same space.
 *
 * The honest use of this is narrow, and the type carries `basis` so a page has
 * to say which it is. On a by-the-room property it is a genuine comparison:
 * rooms × ask is what the house would bring fully let at today's price. On a
 * whole-unit letting it compares one number to one number and is really just
 * "is the listing price still the rent".
 *
 * It reports nothing at all without a price, rather than inferring one. This
 * product has refused to invent a market figure throughout — the comps pool is
 * still too small to advise on (see the listing performance work) — and a
 * fabricated "you are under market by $300" would be the most damaging number
 * on the page.
 */
export function askGap(facts: PropertyFacts | null, prop: TreeProperty | null): AskGap {
  const contracted = prop?.monthly ?? 0
  const ask = facts?.price && facts.price > 0 ? facts.price : null
  if (ask === null) {
    return { contracted, asking: null, gap: null, gapPct: null, basis: null }
  }
  const rooms = facts?.total_rooms && facts.total_rooms > 1 ? facts.total_rooms : null
  const asking = rooms ? rooms * ask : ask
  const gap = round2(asking - contracted)
  return {
    contracted,
    asking,
    gap,
    gapPct: asking > 0 ? Math.round((gap / asking) * 100) : null,
    basis: rooms
      ? `${rooms} rooms × $${ask.toLocaleString()} asking`
      : `$${ask.toLocaleString()} asking for the whole unit`,
  }
}

// ── Portfolio roll-up ────────────────────────────────────────────────────────

export type PropertyLine = {
  propertyId: string
  propertyName: string
  /** Rent collected against the window's charges. */
  received: number
  expenses: ExpenseTotals
  pnl: Noi
  owed: number
  monthly: number
  /** True when no cost has ever been recorded against it. */
  noCosts: boolean
}

/**
 * Every property's P&L over one window — the rows of the portfolio comparison.
 *
 * `noCosts` is the field that keeps this table honest. A property with no
 * expenses recorded shows a cash flow identical to its rent, which looks like
 * the best-performing building in the portfolio and is really the one nobody
 * has done the bookkeeping for. A page that sorts by cash flow without saying
 * so would rank the least-documented property first, every time.
 */
export function propertyLines(
  tree: { properties: TreeProperty[] },
  chargesFor: (propertyId: string) => Charge[],
  expenses: Expense[],
  months: number,
  now = new Date(),
): PropertyLine[] {
  return tree.properties.map(prop => {
    const mine = expenses.filter(e => e.property_id === prop.propertyId)
    const series = monthlyPnl(chargesFor(prop.propertyId), mine, months, now)
    const period = periodPnl(series, '')
    return {
      propertyId: prop.propertyId,
      propertyName: prop.propertyName,
      received: period.received,
      expenses: period.expenses,
      pnl: period.pnl,
      owed: prop.owed,
      monthly: prop.monthly,
      noCosts: mine.length === 0,
    }
  })
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100

/** 'Oct 2026' for a month key, where a chart wants the year too. */
export const monthWithYear = (key: MonthKey) => monthLabel(key, true)
