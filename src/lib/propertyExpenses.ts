/**
 * What a rental property costs — the model.
 *
 * ── Why the money area needed a second half ────────────────────────────────
 *
 * Everything else in `src/lib/financials*.ts` is about income: what was
 * billed, what arrived, who is behind, what is coming. Eight modules, and
 * between them they cannot say whether a property made money, because nothing
 * in this product has ever held a cost.
 *
 * That is not a reporting gap, it is the whole question. A landlord collecting
 * $2,400 against a $1,900 mortgage, $220 of tax and $140 of insurance is making
 * $140 a month, and a dashboard that leads with $2,400 is not informing them —
 * it is flattering them. The number that decides whether to keep a building,
 * refinance it, raise the rent or sell is net, and net needs this.
 *
 * ── The one judgement in here: capital is not an expense ──────────────────
 *
 * A new roof and a repaired roof are the same trade, the same invoice and
 * completely different money. The repair is deducted this year; the
 * replacement is an improvement to the asset and depreciated over decades.
 * Totalling them together overstates cost, understates the property's value,
 * and produces a tax figure an accountant will have to unpick.
 *
 * So `CATEGORY_META` carries `capital` per category and `operating()` excludes
 * it. This is the single place that decision is made — deliberately not a
 * column on the table, because a stored boolean beside a category can drift
 * from it, and this database already carries one corrupt column that drifted
 * exactly that way (`late_fees_applied`, see src/lib/lateFees.ts).
 *
 * ── Dates ──────────────────────────────────────────────────────────────────
 *
 * Every bucket reads `incurred_on` and nothing reads `created_at`. A premium
 * typed in January for last December belongs to December, and an evening spent
 * entering a year of costs must not pile that year into one evening. Same
 * discipline as `submitted_at` on the rent side.
 *
 * Pure above the `── Reads ──` line: expenses in, totals out.
 */

import { supabase } from '@/lib/supabase'

import { monthKeyOfDate, type MonthKey } from './financialsMonth'

// ── Categories ───────────────────────────────────────────────────────────────

export type ExpenseCategory =
  | 'mortgage_interest' | 'property_tax' | 'insurance' | 'hoa'
  | 'utilities' | 'repairs' | 'maintenance' | 'management' | 'leasing'
  | 'advertising' | 'legal_professional' | 'supplies' | 'travel'
  | 'capital_improvement' | 'other'

/**
 * How a category behaves, rather than merely what it is called.
 *
 * The four groups are the ones that change a landlord's decisions:
 *
 *   financing — the debt. Large, fixed, and the reason a profitable building
 *               can still have no cash in it.
 *   fixed     — tax, insurance, HOA. Owed whether or not anyone lives there,
 *               which is exactly what makes a vacancy expensive.
 *   operating — the running of it. The only group a landlord can actually
 *               manage month to month.
 *   capital   — improvements. Not deducted, not part of NOI, not a cost of
 *               this year at all.
 *
 * NOI uses `fixed + operating` and excludes `financing` and `capital`, which is
 * what makes it comparable between a property you own outright and one you
 * borrowed 80% against. See `noi()`.
 */
export type ExpenseGroup = 'financing' | 'fixed' | 'operating' | 'capital'

export const GROUP_META: Record<ExpenseGroup, { label: string; blurb: string }> = {
  financing: {
    label: 'Financing',
    blurb: 'The debt on the building. Excluded from NOI so two properties can be compared whatever their mortgages.',
  },
  fixed: {
    label: 'Fixed',
    blurb: 'Owed whether or not anyone is living there — which is what makes an empty month expensive.',
  },
  operating: {
    label: 'Operating',
    blurb: 'The running of it. The only group you can really manage month to month.',
  },
  capital: {
    label: 'Capital',
    blurb: 'Improvements, not costs of this year. Depreciated rather than deducted, and never in NOI.',
  },
}

export const CATEGORY_META: Record<ExpenseCategory, {
  label: string
  blurb: string
  group: ExpenseGroup
  /** True only for improvements. Decides NOI, net income and the tax summary. */
  capital: boolean
  /** The Schedule E line an accountant will ask for it by. */
  taxLine: string | null
  color: string
  bg: string
}> = {
  mortgage_interest: {
    label: 'Mortgage interest',
    blurb: 'Interest only — the principal part of a payment is not an expense, it buys you the building',
    group: 'financing', capital: false, taxLine: 'Line 12',
    color: '#6d28d9', bg: '#f5f3ff',
  },
  property_tax: {
    label: 'Property tax',
    blurb: 'County and municipal tax on the property itself',
    group: 'fixed', capital: false, taxLine: 'Line 16',
    color: '#9f1239', bg: '#fff1f2',
  },
  insurance: {
    label: 'Insurance',
    blurb: 'Landlord, hazard, liability or umbrella premiums',
    group: 'fixed', capital: false, taxLine: 'Line 9',
    color: '#1d4ed8', bg: '#eff6ff',
  },
  hoa: {
    label: 'HOA dues',
    blurb: 'Association or condo fees',
    group: 'fixed', capital: false, taxLine: 'Line 19',
    color: '#0e7490', bg: '#ecfeff',
  },
  utilities: {
    label: 'Utilities (owner-paid)',
    blurb: 'Only what you pay. Anything you bill a tenant for is income, not a cost',
    group: 'operating', capital: false, taxLine: 'Line 17',
    color: '#047857', bg: '#ecfdf5',
  },
  repairs: {
    label: 'Repairs',
    blurb: 'Putting something back as it was — a fixed leak, a mended fence',
    group: 'operating', capital: false, taxLine: 'Line 14',
    color: '#b45309', bg: '#fffbeb',
  },
  maintenance: {
    label: 'Cleaning & maintenance',
    blurb: 'Routine upkeep, turnover cleans, landscaping, pest control',
    group: 'operating', capital: false, taxLine: 'Line 7',
    color: '#0f766e', bg: '#f0fdfa',
  },
  management: {
    label: 'Management fees',
    blurb: 'What a manager or agent takes to run it',
    group: 'operating', capital: false, taxLine: 'Line 11',
    color: '#4338ca', bg: '#eef2ff',
  },
  leasing: {
    label: 'Letting & placement',
    blurb: 'Fees to find and sign a tenant — the cost a vacancy really carries',
    group: 'operating', capital: false, taxLine: 'Line 11',
    color: '#7c2d12', bg: '#fff7ed',
  },
  advertising: {
    label: 'Advertising',
    blurb: 'Listing fees, photography, signage, paid promotion',
    group: 'operating', capital: false, taxLine: 'Line 5',
    color: '#be185d', bg: '#fdf2f8',
  },
  legal_professional: {
    label: 'Legal & professional',
    blurb: 'Attorney, accountant, eviction filing, bookkeeping',
    group: 'operating', capital: false, taxLine: 'Line 10',
    color: '#475569', bg: '#f8fafc',
  },
  supplies: {
    label: 'Supplies',
    blurb: 'Filters, bulbs, locks, paint, small tools',
    group: 'operating', capital: false, taxLine: 'Line 15',
    color: '#65a30d', bg: '#f7fee7',
  },
  travel: {
    label: 'Auto & travel',
    blurb: 'Mileage and trips made to run the property',
    group: 'operating', capital: false, taxLine: 'Line 6',
    color: '#0369a1', bg: '#f0f9ff',
  },
  capital_improvement: {
    label: 'Capital improvement',
    blurb: 'A new roof, a remodel, an addition — depreciated over years rather than deducted now',
    group: 'capital', capital: true, taxLine: 'Depreciated — not an expense line',
    color: '#92400e', bg: '#fef3c7',
  },
  other: {
    label: 'Other',
    blurb: 'Anything genuinely else. Worth a memo so next April it still means something',
    group: 'operating', capital: false, taxLine: 'Line 19',
    color: '#64748b', bg: '#f1f5f9',
  },
}

/** The order the UI offers them in: what a landlord spends most on, first. */
export const CATEGORY_ORDER: ExpenseCategory[] = [
  'mortgage_interest', 'property_tax', 'insurance', 'hoa',
  'repairs', 'maintenance', 'utilities', 'management', 'leasing',
  'advertising', 'legal_professional', 'supplies', 'travel',
  'capital_improvement', 'other',
]

export const GROUP_ORDER: ExpenseGroup[] = ['financing', 'fixed', 'operating', 'capital']

// ── The row ──────────────────────────────────────────────────────────────────

export type Expense = {
  id: string
  owner_id: string
  property_id: string
  lease_id: string | null
  category: ExpenseCategory
  amount: number
  /** The date the cost belongs to. The only date anything here reads. */
  incurred_on: string
  vendor: string | null
  memo: string | null
  receipt_url: string | null
  work_item_id: string | null
  created_at: string
  updated_at: string
  property?: { id: string; name: string; slug: string } | null
}

export const isCapital = (e: Expense) => CATEGORY_META[e.category].capital
export const groupOf = (e: Expense) => CATEGORY_META[e.category].group
export const expenseMonth = (e: Expense): MonthKey => monthKeyOfDate(e.incurred_on)
export const expenseYear = (e: Expense): string => e.incurred_on.slice(0, 4)

// ── Totals ───────────────────────────────────────────────────────────────────

/**
 * Money in cents throughout the arithmetic.
 *
 * Expenses are the first place in this product that holds cents — rent is
 * integer dollars because leases are written that way, but an insurance
 * premium is $142.67. Summing a year of those as floats drifts, so every total
 * here adds integers and divides once at the end. The same rule the rollup
 * already follows for split rent.
 */
const cents = (n: number) => Math.round(n * 100)

export type CategoryTotal = {
  category: ExpenseCategory
  label: string
  group: ExpenseGroup
  amount: number
  count: number
  /** Share of total spend, 0–100. Of *all* spend, capital included. */
  share: number
}

export type ExpenseTotals = {
  /** Everything, capital included. What actually left the bank. */
  all: number
  /** Deductible cost of running it this period — excludes capital. */
  deductible: number
  /** What NOI subtracts: fixed + operating. No debt, no capital. */
  operating: number
  /** The debt service recorded. Excluded from NOI by design. */
  financing: number
  /** Improvements. Not a cost of this period at all. */
  capital: number
  count: number
  byCategory: CategoryTotal[]
  byGroup: Record<ExpenseGroup, number>
}

export const EMPTY_EXPENSE_TOTALS: ExpenseTotals = {
  all: 0, deductible: 0, operating: 0, financing: 0, capital: 0, count: 0,
  byCategory: [], byGroup: { financing: 0, fixed: 0, operating: 0, capital: 0 },
}

export function totalExpenses(items: Expense[]): ExpenseTotals {
  if (items.length === 0) return EMPTY_EXPENSE_TOTALS

  const byCat = new Map<ExpenseCategory, { amount: number; count: number }>()
  const byGroup: Record<ExpenseGroup, number> = { financing: 0, fixed: 0, operating: 0, capital: 0 }
  let all = 0

  for (const e of items) {
    const c = cents(e.amount)
    all += c
    byGroup[groupOf(e)] += c
    const prev = byCat.get(e.category) ?? { amount: 0, count: 0 }
    byCat.set(e.category, { amount: prev.amount + c, count: prev.count + 1 })
  }

  const byCategory: CategoryTotal[] = [...byCat.entries()]
    .map(([category, v]) => ({
      category,
      label: CATEGORY_META[category].label,
      group: CATEGORY_META[category].group,
      amount: v.amount / 100,
      count: v.count,
      share: all > 0 ? Math.round((v.amount / all) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount)

  return {
    all: all / 100,
    deductible: (all - byGroup.capital) / 100,
    operating: (byGroup.fixed + byGroup.operating) / 100,
    financing: byGroup.financing / 100,
    capital: byGroup.capital / 100,
    count: items.length,
    byCategory,
    byGroup: {
      financing: byGroup.financing / 100,
      fixed: byGroup.fixed / 100,
      operating: byGroup.operating / 100,
      capital: byGroup.capital / 100,
    },
  }
}

/** Spend per month, for charting against collection. Keyed by month. */
export function expensesByMonth(items: Expense[]): Map<MonthKey, ExpenseTotals> {
  const groups = new Map<MonthKey, Expense[]>()
  for (const e of items) {
    const k = expenseMonth(e)
    const list = groups.get(k)
    if (list) list.push(e)
    else groups.set(k, [e])
  }
  const out = new Map<MonthKey, ExpenseTotals>()
  for (const [k, list] of groups) out.set(k, totalExpenses(list))
  return out
}

/** Every year that has a cost in it, newest first. The year picker's options. */
export function expenseYears(items: Expense[]): string[] {
  return [...new Set(items.map(expenseYear))].sort().reverse()
}

export const inYear = (items: Expense[], year: string) =>
  items.filter(e => expenseYear(e) === year)

export const forProperty = (items: Expense[], propertyId: string) =>
  items.filter(e => e.property_id === propertyId)

// ── Net operating income ─────────────────────────────────────────────────────

export type Noi = {
  /** Rent and charges actually collected over the period. */
  income: number
  /** Fixed + operating cost. Never debt, never capital. */
  operating: number
  /** income − operating. The property's earning power, debt aside. */
  noi: number
  /** NOI as a share of income, 0–100. Null when nothing was collected. */
  margin: number | null
  /** Debt service recorded over the period. */
  financing: number
  /** noi − financing. What actually stayed in the bank, before improvements. */
  cashFlow: number
  /** Improvements over the period, reported beside rather than inside. */
  capital: number
}

/**
 * The property's earning power, and then its cash.
 *
 * Two figures, deliberately, because they answer different questions and
 * conflating them is the most common error in small-landlord analysis:
 *
 *   • **NOI** excludes the mortgage. It is a fact about the *building* — what
 *     it earns being a rental — and it is the only figure that compares two
 *     properties, or this property against buying it with different debt. An
 *     appraiser and a lender both mean this.
 *   • **Cash flow** subtracts the debt. It is a fact about the *owner* — what
 *     is left — and it is the figure that decides whether this month hurts.
 *
 * Both are reported on income *collected*, not billed. Billed income the
 * tenant never paid is not available to cover a mortgage, and an NOI built on
 * billings is a figure that says a property is fine while its owner cannot pay
 * the debt on it.
 */
export function noi(income: number, totals: ExpenseTotals): Noi {
  const n = income - totals.operating
  return {
    income,
    operating: totals.operating,
    noi: n,
    margin: income > 0 ? Math.round((n / income) * 100) : null,
    financing: totals.financing,
    cashFlow: n - totals.financing,
    capital: totals.capital,
  }
}

// ── Tax summary ──────────────────────────────────────────────────────────────

export type TaxLine = {
  line: string
  label: string
  amount: number
  categories: ExpenseCategory[]
}

export type TaxSummary = {
  year: string
  /** Rent and charges collected in the year. The income side of Schedule E. */
  income: number
  lines: TaxLine[]
  /** Everything on a deductible line. */
  deductible: number
  /** Improvements, reported apart because they are not deducted. */
  capital: number
  /** income − deductible. Not advice; the arithmetic. */
  taxableBeforeDepreciation: number
}

/**
 * A year, arranged the way the form is.
 *
 * Several categories share a Schedule E line — management fees and letting
 * fees are both line 11, HOA and "other" are both 19 — so this folds them and
 * names which categories went into each, because an accountant's first
 * question about a total is what is in it.
 *
 * It stops at "taxable before depreciation" and does not go further. Depreciation
 * needs the building's basis, its in-service date and a method, none of which
 * this product holds and none of which it should guess at. Saying so is more
 * useful than a confident wrong number.
 */
export function taxSummary(items: Expense[], year: string, income: number): TaxSummary {
  const yearly = inYear(items, year)
  const byLine = new Map<string, { label: string; amount: number; cats: Set<ExpenseCategory> }>()
  let capital = 0

  for (const e of yearly) {
    const meta = CATEGORY_META[e.category]
    if (meta.capital) { capital += cents(e.amount); continue }
    const key = meta.taxLine ?? 'Line 19'
    const prev = byLine.get(key) ?? { label: '', amount: 0, cats: new Set<ExpenseCategory>() }
    prev.amount += cents(e.amount)
    prev.cats.add(e.category)
    byLine.set(key, prev)
  }

  const lines: TaxLine[] = [...byLine.entries()]
    .map(([line, v]) => {
      const cats = [...v.cats].sort(
        (a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b),
      )
      return {
        line,
        label: cats.map(c => CATEGORY_META[c].label).join(' + '),
        amount: v.amount / 100,
        categories: cats,
      }
    })
    // By line number, so the page reads down the form rather than by size.
    .sort((a, b) => {
      const n = (s: string) => Number(s.replace(/\D/g, '')) || 999
      return n(a.line) - n(b.line)
    })

  const deductible = lines.reduce((s, l) => s + cents(l.amount), 0) / 100
  return {
    year,
    income,
    lines,
    deductible,
    capital: capital / 100,
    taxableBeforeDepreciation: income - deductible,
  }
}

// ── CSV ──────────────────────────────────────────────────────────────────────

const q = (v: string | number | null) => {
  const s = v === null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * The ledger as a spreadsheet.
 *
 * Carries the tax line and the capital flag as their own columns, because the
 * person this file is for is sorting by exactly those. A CSV that makes an
 * accountant re-derive the classification has not saved anyone the work.
 */
export function expensesCsv(items: Expense[]): string {
  const head = [
    'Date', 'Property', 'Category', 'Group', 'Tax line', 'Capital',
    'Amount', 'Vendor', 'Memo', 'Receipt',
  ]
  const rows = [...items]
    .sort((a, b) => a.incurred_on.localeCompare(b.incurred_on))
    .map(e => {
      const m = CATEGORY_META[e.category]
      return [
        e.incurred_on,
        e.property?.name ?? '',
        m.label,
        GROUP_META[m.group].label,
        m.capital ? '' : (m.taxLine ?? ''),
        m.capital ? 'yes' : 'no',
        e.amount.toFixed(2),
        e.vendor ?? '',
        e.memo ?? '',
        e.receipt_url ?? '',
      ].map(q).join(',')
    })
  return [head.join(','), ...rows].join('\n')
}

/** Hand the browser a file. Shared by every export control in the area. */
export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Reads ────────────────────────────────────────────────────────────────────

const SELECT = `*, property:properties ( id, name, slug )`

/**
 * A row as PostgREST hands it over.
 *
 * `numeric` arrives as a *string* from the Data API, which is the whole reason
 * this mapper exists: `amount` typed as a number on the way in would make
 * `a.amount + b.amount` a string concatenation, and a year of costs would
 * total to something like "1200150300".
 */
type ExpenseRow = Omit<Expense, 'amount'> & { amount: number | string }

/** Every read goes through this. */
function map(row: ExpenseRow): Expense {
  return { ...row, amount: Number(row.amount) }
}

export async function getExpenses(ownerId: string): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('property_expenses')
    .select(SELECT)
    .eq('owner_id', ownerId)
    .order('incurred_on', { ascending: false })
  if (error || !data) return []
  return (data as ExpenseRow[]).map(map)
}

export async function getExpensesForProperty(propertyId: string): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('property_expenses')
    .select(SELECT)
    .eq('property_id', propertyId)
    .order('incurred_on', { ascending: false })
  if (error || !data) return []
  return (data as ExpenseRow[]).map(map)
}

// ── Writes ───────────────────────────────────────────────────────────────────

export type ExpenseInput = {
  property_id: string
  category: ExpenseCategory
  amount: number
  incurred_on: string
  lease_id?: string | null
  vendor?: string | null
  memo?: string | null
  receipt_url?: string | null
  work_item_id?: string | null
}

/**
 * Written straight from the client, unlike nearly every other write here.
 *
 * The service-role routes in this product exist to stop a write and its side
 * effect coming apart — an offer no tenant was told about, a payment with no
 * receipt. Recording a cost has no side effect: no email, no charge, no money
 * moving, nobody outside this landlord's account learning anything. So a route
 * would be a second place for the ownership check to be wrong, and RLS already
 * makes `owner_id = auth.uid()` the database's decision rather than ours.
 */
export async function createExpense(
  input: ExpenseInput,
): Promise<{ expense: Expense | null; error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { expense: null, error: 'You are signed out. Sign in and try again.' }

  const { data, error } = await supabase
    .from('property_expenses')
    .insert({ ...input, owner_id: user.id })
    .select(SELECT)
    .single()

  if (error) return { expense: null, error: humanError(error) }
  return { expense: map(data as ExpenseRow), error: null }
}

/**
 * The same cost, once for every month of a range.
 *
 * This is how a recurring expense is handled, and the reason there is no
 * recurrence column on the table. A mortgage payment is monthly, but a flag
 * saying so needs something running to turn it into rows and is wrong in
 * between — the trap `lease_renewals.status` documents and the one
 * `late_fees_applied` fell into. Writing the twelve real rows now leaves a
 * ledger that is correct whether or not anything is running, and each month can
 * then be edited or deleted on its own when the premium changes.
 *
 * The day of month comes from `from`; a 31st clamps to the month's own last day
 * rather than rolling into the next month, which would file February's cost in
 * March.
 */
export async function createExpenseSeries(
  input: ExpenseInput,
  months: number,
): Promise<{ created: number; error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { created: 0, error: 'You are signed out. Sign in and try again.' }

  const [y, m, d] = input.incurred_on.split('-').map(Number)
  const rows = Array.from({ length: Math.max(1, months) }, (_, i) => {
    const month = m - 1 + i
    const year = y + Math.floor(month / 12)
    const mo = ((month % 12) + 12) % 12
    // The last day of that month, so a 31st never rolls forward into the next.
    const last = new Date(Date.UTC(year, mo + 1, 0)).getUTCDate()
    const day = Math.min(d, last)
    const date = `${year}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return { ...input, incurred_on: date, owner_id: user.id, work_item_id: null }
  })

  const { data, error } = await supabase.from('property_expenses').insert(rows).select('id')
  if (error) return { created: 0, error: humanError(error) }
  return { created: data?.length ?? 0, error: null }
}

export async function updateExpense(
  id: string,
  patch: Partial<ExpenseInput>,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('property_expenses')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  return { error: error ? humanError(error) : null }
}

export async function deleteExpense(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('property_expenses').delete().eq('id', id)
  return { error: error ? humanError(error) : null }
}

/**
 * A Postgres error a landlord can act on.
 *
 * The two that can genuinely happen here both have a plain cause, and the raw
 * text names a constraint rather than the mistake.
 */
function humanError(error: { code?: string; message?: string }): string {
  if (error.code === '23514' && error.message?.includes('amount')) {
    return 'An amount has to be zero or more. To record a refund, reduce the original cost instead.'
  }
  if (error.code === '23505' || error.code === '23P01') {
    return 'That maintenance job has already been posted as a cost.'
  }
  if (error.code === '42501') {
    return 'You do not have access to that property.'
  }
  return error.message || 'Could not save that cost.'
}
