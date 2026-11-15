'use client'

/**
 * Expenses — what the properties cost, and therefore what they actually earn.
 *
 * ── The gap this tab closes ────────────────────────────────────────────────
 *
 * Every other screen in this area is about income. Between them they can say
 * what was billed, what arrived, who is behind, what is coming and what
 * bounced — and not one of them can say whether a property is worth owning,
 * because until this tab existed the product held no costs at all.
 *
 * That is not a missing report. It is the missing half of the only question a
 * rental owner has. A landlord collecting $2,400 a month against a $1,900
 * mortgage, $220 of tax and $140 of insurance is making $140, and a dashboard
 * that leads with $2,400 is flattering them rather than informing them.
 *
 * ── Why the axis is a year ─────────────────────────────────────────────────
 *
 * Income screens here are scoped by month, because rent is a monthly event.
 * Costs are not: insurance is annual, tax is semi-annual, a roof is once. A
 * month of expenses is a meaningless slice — read month by month, this ledger
 * would show eleven quiet months and one catastrophic January.
 *
 * So the window is a calendar year, which is also the window the person this
 * data eventually goes to works in. The month-by-month panel is still here,
 * underneath, for seeing *when* the money went.
 *
 * ── Three figures, not one ─────────────────────────────────────────────────
 *
 * The page refuses to reduce this to a single "profit" number, because the
 * three honest ones answer different questions:
 *
 *   NOI        — income minus running costs, mortgage excluded. A fact about
 *                the *building*. The only figure that compares two properties
 *                or survives a refinance. What a lender and an appraiser mean.
 *   Cash flow  — NOI minus the debt. A fact about the *owner*. The figure that
 *                decides whether this month hurts.
 *   Capital    — improvements, reported beside both and inside neither,
 *                because a new roof is not a cost of this year.
 *
 * ── The honesty problem this page has, and how it handles it ───────────────
 *
 * A landlord who has recorded no costs sees an NOI identical to their rent,
 * which is the most misleading number this product could print. So coverage is
 * stated: how many properties have costs on them, and a plain banner where
 * none do. The figures are never dressed up as complete when they are not.
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { fmtCurrency, fmtDate } from '@/lib/payments'
import { useMoney } from '@/lib/useMoney'
import { useExpenses } from '@/lib/useExpenses'
import { allCharges, arrears } from '@/lib/financialsMonth'
import { buildTree, propertyHref } from '@/lib/financialsTree'
import {
  CATEGORY_META, GROUP_META, GROUP_ORDER, downloadCsv, expensesCsv,
  inYear, taxSummary, totalExpenses, type ExpenseGroup,
} from '@/lib/propertyExpenses'
import { monthlyPnl, pnlYears, yearPnl } from '@/lib/propertyMoney'
import { getWorkItems, type WorkItem } from '@/lib/maintenance'
import { getCurrentUser } from '@/lib/supabase'
import MoneyHub from '@/components/finance/MoneyHub'
import ExpenseSheet, { EXPENSE_SHEET_CSS, type ExpenseDraft } from '@/components/finance/ExpenseSheet'
import { FINANCE_THEME } from '@/lib/financeTheme'
import { PANEL_CSS } from '@/components/finance/Panels'

/** Which slice of the ledger the table shows. */
type GroupFilter = 'all' | ExpenseGroup

export default function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; year?: string }>
}) {
  const sp = use(searchParams)
  const { plans, bounced, loading: moneyLoading } = useMoney()
  const { items: expenses, loading: expLoading, reload } = useExpenses()

  /** Only what the landlord explicitly chose. The fallback is derived below —
   *  a state-setting effect would render the page once on a year it has no
   *  data for, which is the same reason the statement page derives its
   *  property rather than storing it. */
  const [chosenYear, setChosenYear] = useState<string>(
    /^\d{4}$/.test(sp.year ?? '') ? sp.year! : String(new Date().getFullYear()),
  )
  // The property page links straight in here scoped to itself, so the filter
  // honours the link rather than silently opening on the whole portfolio.
  const [propertyId, setPropertyId] = useState(sp.property ?? '')
  const [group, setGroup] = useState<GroupFilter>('all')
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState<ExpenseDraft | null>(null)
  /** Completed maintenance jobs, so a job with a real cost can be posted here
   *  rather than retyped. Loaded lazily — it is a prompt, not the page. */
  const [work, setWork] = useState<WorkItem[]>([])

  useEffect(() => { document.title = 'Expenses — Financials | HomeHive' }, [])

  useEffect(() => {
    ;(async () => {
      const user = await getCurrentUser()
      if (user) setWork(await getWorkItems(user.id))
    })()
  }, [])

  const tree = useMemo(() => buildTree(plans, []), [plans])

  /** Plans for the chosen property, so income is scoped the same way cost is. */
  const scopedPlans = useMemo(
    () => (propertyId
      ? plans.filter(p => (p.property?.id ?? p.property_id) === propertyId)
      : plans),
    [plans, propertyId],
  )
  const charges = useMemo(() => allCharges(scopedPlans), [scopedPlans])
  const scopedExpenses = useMemo(
    () => (propertyId ? expenses.filter(e => e.property_id === propertyId) : expenses),
    [expenses, propertyId],
  )

  const years = useMemo(() => pnlYears(charges, expenses), [charges, expenses])
  /** The chosen year if the current scope still has it, otherwise the most
   *  recent one it does — so changing the property filter can never leave the
   *  page reading a window with nothing in it. */
  const year = years.includes(chosenYear) ? chosenYear : years[0] ?? chosenYear
  const setYear = setChosenYear

  const pnl = useMemo(() => yearPnl(charges, scopedExpenses, year), [charges, scopedExpenses, year])
  const series = useMemo(() => monthlyPnl(charges, scopedExpenses, 12), [charges, scopedExpenses])
  const yearRows = useMemo(() => inYear(scopedExpenses, year), [scopedExpenses, year])
  const tax = useMemo(() => taxSummary(scopedExpenses, year, pnl.received), [scopedExpenses, year, pnl.received])
  const behind = useMemo(() => arrears(plans).payerCount, [plans])

  /**
   * How much of the portfolio has any cost recorded against it.
   *
   * The single most important number on this page for judging every other
   * number on it. Shown as a sentence rather than a figure, because "2 of 5"
   * is a coverage statistic a landlord reads as a score.
   */
  const coverage = useMemo(() => {
    const withCosts = new Set(expenses.map(e => e.property_id))
    const total = tree.properties.length
    const covered = tree.properties.filter(p => withCosts.has(p.propertyId)).length
    return { total, covered, missing: total - covered }
  }, [expenses, tree.properties])

  /** Completed jobs that cost something and have not been posted as a cost. */
  const postable = useMemo(() => {
    const posted = new Set(expenses.map(e => e.work_item_id).filter(Boolean))
    return work
      .filter(w => w.status === 'completed' && w.actual_cost != null && w.actual_cost > 0)
      .filter(w => !posted.has(w.id))
      .filter(w => !propertyId || w.property_id === propertyId)
  }, [work, expenses, propertyId])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return yearRows
      .filter(e => group === 'all' || CATEGORY_META[e.category].group === group)
      .filter(e => {
        if (!needle) return true
        return [e.vendor, e.memo, e.property?.name, CATEGORY_META[e.category].label]
          .some(v => v?.toLowerCase().includes(needle))
      })
      .sort((a, b) => b.incurred_on.localeCompare(a.incurred_on))
  }, [yearRows, group, q])

  const shown = useMemo(() => totalExpenses(rows), [rows])
  const filtered = group !== 'all' || q.trim() !== ''

  const properties = useMemo(
    () => tree.properties.map(p => ({ id: p.propertyId, name: p.propertyName })),
    [tree.properties],
  )
  const leases = useMemo(
    () => tree.leases
      .filter(l => l.leaseId)
      .map(l => ({
        id: l.leaseId!,
        label: `${l.label}${l.termStart ? ` · from ${fmtDate(l.termStart)}` : ''}`,
        propertyId: l.propertyId,
      })),
    [tree.leases],
  )

  const onSaved = useCallback(async () => { await reload() }, [reload])

  const exportLedger = () => downloadCsv(
    `expenses-${year}${propertyId ? '-property' : ''}.csv`,
    expensesCsv(rows),
  )

  const loading = moneyLoading || expLoading
  const propName = propertyId
    ? tree.properties.find(p => p.propertyId === propertyId)?.propertyName
    : null

  /** The biggest month of spend in the series, for the bars' scale. */
  const peak = Math.max(1, ...series.map(m => Math.max(m.received, m.expenses.all)))

  return (
    <>
      <style>{FINANCE_THEME}{PANEL_CSS}{EXPENSE_SHEET_CSS}{CSS}</style>
      <div className="fin fin-wrap">
        <MoneyHub
          tab="expenses"
          title="Expenses"
          sub={
            coverage.total === 0
              ? 'Record what a property costs and this becomes the net picture.'
              : coverage.covered === 0
                ? 'No costs recorded yet — so every “net” figure in the product is still just your rent.'
                : `What your ${propName ?? 'portfolio'} costs to run, and what it earns after that.`
          }
          action={{ label: 'Record a cost', onClick: () => setDraft({ propertyId: propertyId || undefined }) }}
          secondary={rows.length > 0 ? { label: 'Export CSV', onClick: exportLedger } : undefined}
          alarmCount={bounced}
          dueCount={behind}
          filters={
            <div className="filters">
              <select
                className="fsel on"
                value={year}
                onChange={e => setYear(e.target.value)}
                aria-label="Tax year"
              >
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              {tree.properties.length > 1 && (
                <select
                  className={`fsel${propertyId ? ' on' : ''}`}
                  value={propertyId}
                  onChange={e => setPropertyId(e.target.value)}
                  aria-label="Which property"
                >
                  <option value="">Whole portfolio</option>
                  {tree.properties.map(p => (
                    <option key={p.propertyId} value={p.propertyId}>{p.propertyName}</option>
                  ))}
                </select>
              )}
              {propertyId && (
                <Link className="btn-quiet sm" href={propertyHref(propertyId)}>
                  Open this property →
                </Link>
              )}
              <span className="fcount">
                {pnl.running ? `${year} so far` : year}
                {' · '}{yearRows.length} cost{yearRows.length !== 1 ? 's' : ''} recorded
              </span>
            </div>
          }
        />

        {/* ══ THE FOUR FIGURES ══ */}
        <section className="kpis" aria-label={`${year} summary`}>
          <div className="kpi hero">
            <div className="kpi-label">Rent collected</div>
            <div className="kpi-value fig-in">{fmtCurrency(pnl.received)}</div>
            <div className="kpi-meta">
              {pnl.billed > 0
                ? <>of {fmtCurrency(pnl.billed)} billed in {year}</>
                : <>nothing billed in {year}</>}
            </div>
          </div>

          <div className="kpi">
            <div className="kpi-label">Running cost</div>
            <div className={`kpi-value${pnl.expenses.operating > 0 ? ' fig-fee' : ''}`}>
              {pnl.expenses.operating > 0 ? fmtCurrency(pnl.expenses.operating) : '—'}
            </div>
            <div className="kpi-meta">
              {pnl.expenses.operating > 0
                ? <>fixed and operating · mortgage excluded</>
                : <>nothing recorded for {year}</>}
            </div>
          </div>

          <div className="kpi">
            <div className="kpi-label">NOI</div>
            <div className={`kpi-value${pnl.pnl.noi < 0 ? ' fig-late' : ''}`}>
              {fmtCurrency(pnl.pnl.noi)}
            </div>
            <div className="kpi-meta">
              {pnl.expenses.operating === 0
                ? <>no costs recorded — this is just your rent</>
                : pnl.pnl.margin !== null
                  ? <>{pnl.pnl.margin}% of what you collected</>
                  : <>what the building earns, debt aside</>}
            </div>
          </div>

          <div className={`kpi${pnl.pnl.cashFlow < 0 ? ' hot' : ''}`}>
            <div className="kpi-label">Cash flow</div>
            <div className={`kpi-value${pnl.pnl.cashFlow < 0 ? ' fig-late' : ''}`}>
              {fmtCurrency(pnl.pnl.cashFlow)}
            </div>
            <div className="kpi-meta">
              {pnl.expenses.financing > 0
                ? <>after {fmtCurrency(pnl.expenses.financing)} of debt service</>
                : <>no mortgage recorded, so this equals NOI</>}
            </div>
          </div>
        </section>

        {/* The one thing that would make every figure above a lie. */}
        {!loading && coverage.total > 0 && coverage.covered < coverage.total && (
          <div className="note-bar">
            <span>
              <strong>
                {coverage.covered === 0
                  ? `No costs recorded on any of your ${coverage.total} properties.`
                  : `${coverage.missing} of your ${coverage.total} properties have no costs recorded.`}
              </strong>{' '}
              Until they do, their NOI and cash flow are the same as their rent — which
              is not a result, it is just the bookkeeping not being done yet. Mortgage
              interest, tax and insurance are usually the three that matter most.
            </span>
            <button className="btn-secondary sm" onClick={() => setDraft({ propertyId: propertyId || undefined })}>
              Record a cost
            </button>
          </div>
        )}

        {pnl.expenses.capital > 0 && (
          <div className="note-bar quiet">
            <span>
              <strong>{fmtCurrency(pnl.expenses.capital)} of capital improvements in {year}</strong>{' '}
              is deliberately not in any figure above. An improvement is depreciated over
              years rather than deducted now, so counting it as a cost of {year} would
              overstate what the property costs and understate what it is worth.
            </span>
          </div>
        )}

        {/* ══ JOBS WAITING TO BE POSTED ══ */}
        {postable.length > 0 && (
          <section className="card">
            <div className="card-hd top">
              <div>
                <h2 className="card-title">Finished work with a cost on it</h2>
                <p className="card-sub">
                  {postable.length} completed job{postable.length !== 1 ? 's' : ''} from your
                  maintenance list that {postable.length !== 1 ? 'have' : 'has'} never been
                  posted as a cost here — so {postable.length !== 1 ? 'they are' : 'it is'} not
                  in any figure on this page.
                </p>
              </div>
              <Link className="btn-quiet sm" href="/landlord/maintenance">
                Maintenance list →
              </Link>
            </div>
            <div className="postable">
              {postable.slice(0, 6).map(w => (
                <div key={w.id} className="post-row">
                  <span className="post-main">
                    <span className="post-title">{w.title}</span>
                    <span className="post-sub">
                      {w.property?.name ?? 'Property'}
                      {w.completed_at && <> · finished {fmtDate(w.completed_at.slice(0, 10))}</>}
                      {w.vendor_name && <> · {w.vendor_name}</>}
                    </span>
                  </span>
                  <span className="post-amt num">{fmtCurrency(w.actual_cost ?? 0)}</span>
                  <button
                    className="btn-secondary sm"
                    onClick={() => setDraft({
                      propertyId: w.property_id,
                      category: w.kind === 'upgrade' ? 'capital_improvement'
                        : w.kind === 'turnover' ? 'maintenance'
                        : w.kind === 'preventive' ? 'maintenance'
                        : 'repairs',
                      workItem: {
                        id: w.id,
                        title: w.title,
                        cost: w.actual_cost,
                        date: w.completed_at,
                      },
                    })}
                  >
                    Post as cost
                  </button>
                </div>
              ))}
            </div>
            {postable.length > 6 && (
              <p className="card-more">and {postable.length - 6} more on the maintenance list.</p>
            )}
          </section>
        )}

        <div className="grid-2">
          {/* ══ WHERE THE MONEY GOES ══ */}
          <section className="card">
            <div className="card-hd top">
              <div>
                <h2 className="card-title">Where it goes</h2>
                <p className="card-sub">
                  {yearRows.length > 0
                    ? <>{fmtCurrency(pnl.expenses.all)} across {pnl.expenses.byCategory.length}{' '}
                       categor{pnl.expenses.byCategory.length !== 1 ? 'ies' : 'y'} in {year}</>
                    : <>Nothing recorded for {year} yet</>}
                </p>
              </div>
            </div>

            {yearRows.length === 0 ? (
              <p className="muted card-prose">
                Record a cost and it appears here, grouped so you can see at a glance which
                part of the bill is the debt, which is unavoidable, and which you could
                actually do something about.
              </p>
            ) : (
              <div className="cats">
                {GROUP_ORDER.filter(g => pnl.expenses.byGroup[g] > 0).map(g => (
                  <div key={g} className="cat-group">
                    <div className="cat-ghd">
                      <span className="cat-gname">{GROUP_META[g].label}</span>
                      <span className="cat-gamt num">{fmtCurrency(pnl.expenses.byGroup[g])}</span>
                    </div>
                    <p className="cat-gblurb">{GROUP_META[g].blurb}</p>
                    {pnl.expenses.byCategory.filter(c => c.group === g).map(c => (
                      <button
                        key={c.category}
                        className="cat-row"
                        onClick={() => { setGroup(g); setQ(CATEGORY_META[c.category].label) }}
                        title={`Show the ${CATEGORY_META[c.category].label.toLowerCase()} entries`}
                      >
                        <span className="cat-name">{c.label}</span>
                        <span className="cat-bar" aria-hidden="true">
                          <span
                            className="cat-fill"
                            style={{
                              width: `${Math.max(2, c.share)}%`,
                              background: CATEGORY_META[c.category].color,
                            }}
                          />
                        </span>
                        <span className="cat-amt num">{fmtCurrency(c.amount)}</span>
                        <span className="cat-share">{c.share}%</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ══ MONTH BY MONTH ══ */}
          <section className="card">
            <div className="card-hd top">
              <div>
                <h2 className="card-title">Month by month</h2>
                <p className="card-sub">
                  Collected against cost over the last 12 months — where the lumpy bills landed
                </p>
              </div>
            </div>

            <div className="mbars">
              {series.map(m => (
                <div key={m.key} className={`mbar${m.position === 'future' ? ' ahead' : ''}`}>
                  <span className="mbar-cols" aria-hidden="true">
                    <span
                      className="mbar-in"
                      style={{ height: `${(m.received / peak) * 100}%` }}
                    />
                    <span
                      className="mbar-out"
                      style={{ height: `${(m.expenses.all / peak) * 100}%` }}
                    />
                  </span>
                  <span className="mbar-lbl">{m.label}</span>
                  <span className="mbar-tip" role="note">
                    <strong>{m.longLabel}</strong>
                    <span>Collected {fmtCurrency(m.received)}</span>
                    <span>Cost {fmtCurrency(m.expenses.all)}</span>
                    <span className={m.cashFlow < 0 ? 'tip-bad' : 'tip-good'}>
                      Cash flow {fmtCurrency(m.cashFlow)}
                    </span>
                  </span>
                </div>
              ))}
            </div>

            <div className="card-ft">
              <span className="mkey">
                <span className="mkey-dot in" /> Collected
                <span className="mkey-dot out" /> Cost
              </span>
              <span className="muted sm">
                Both read by the month the money belongs to, not the day it moved.
              </span>
            </div>
          </section>
        </div>

        {/* ══ THE TAX SUMMARY ══ */}
        <section className="card">
          <div className="card-hd top">
            <div>
              <h2 className="card-title">{year} for your accountant</h2>
              <p className="card-sub">
                Arranged by the Schedule E line each cost belongs on
                {pnl.running && <> · {year} is still running, so this is a part-year figure</>}
              </p>
            </div>
            {rows.length > 0 && (
              <button className="btn-secondary sm" onClick={exportLedger}>
                Export the ledger
              </button>
            )}
          </div>

          {tax.lines.length === 0 ? (
            <p className="muted card-prose">
              Nothing deductible recorded for {year}. Once costs are in, this becomes the
              list to hand over — every entry already sorted onto the line it belongs on,
              with the ledger behind it as a CSV.
            </p>
          ) : (
            <div className="tbl-scroll">
              <table className="tbl roomy">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>What it covers</th>
                    <th className="num">{year}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="tax-income">
                    <td>Line 3</td>
                    <td>Rents received</td>
                    <td className="num fig-in">{fmtCurrency(tax.income)}</td>
                  </tr>
                  {tax.lines.map(l => (
                    <tr key={l.line}>
                      <td>{l.line}</td>
                      <td>{l.label}</td>
                      <td className="num">({fmtCurrency(l.amount)})</td>
                    </tr>
                  ))}
                  <tr className="tax-total">
                    <td />
                    <td>Total expenses</td>
                    <td className="num">({fmtCurrency(tax.deductible)})</td>
                  </tr>
                  <tr className="tax-total strong">
                    <td />
                    <td>Income before depreciation</td>
                    <td className={`num${tax.taxableBeforeDepreciation < 0 ? ' fig-late' : ''}`}>
                      {fmtCurrency(tax.taxableBeforeDepreciation)}
                    </td>
                  </tr>
                  {tax.capital > 0 && (
                    <tr className="tax-note">
                      <td />
                      <td>
                        Capital improvements — depreciated, not deducted
                      </td>
                      <td className="num muted">{fmtCurrency(tax.capital)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <p className="card-note">
            It stops at income before depreciation, and deliberately does not go further.
            Depreciation needs the building’s cost basis, the date it went into service and
            a method — none of which this product holds, and none of which it should guess
            at. This is the arithmetic on the costs you have entered, not tax advice.
          </p>
        </section>

        {/* ══ THE LEDGER ══ */}
        <section className="card flush">
          <div className="card-hd top">
            <div>
              <h2 className="card-title">The ledger</h2>
              <p className="card-sub">
                {filtered
                  ? <>{rows.length} of {yearRows.length} entries · {fmtCurrency(shown.all)}</>
                  : <>Every cost recorded in {year}</>}
              </p>
            </div>
            <div className="pickers">
              <select
                className={`fsel${group !== 'all' ? ' on' : ''}`}
                value={group}
                onChange={e => setGroup(e.target.value as GroupFilter)}
                aria-label="Which kind of cost"
              >
                <option value="all">Every kind</option>
                {GROUP_ORDER.map(g => (
                  <option key={g} value={g}>{GROUP_META[g].label}</option>
                ))}
              </select>
              <input
                className="fsearch"
                type="search"
                value={q}
                placeholder="Search a vendor, note or category"
                onChange={e => setQ(e.target.value)}
                aria-label="Search costs"
              />
              {filtered && (
                <button className="btn-quiet sm" onClick={() => { setGroup('all'); setQ('') }}>
                  Clear
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="skeleton" style={{ height: 180 }} />
          ) : rows.length === 0 ? (
            <div className="empty">
              <div className="empty-title">
                {yearRows.length === 0
                  ? `Nothing recorded for ${year}`
                  : 'Nothing matches that'}
              </div>
              <p className="empty-sub">
                {yearRows.length === 0 ? (
                  <>
                    A rental’s numbers only mean something next to what it costs. Start with the
                    three that dominate every rental: mortgage interest, property tax and
                    insurance. A cost can be posted across a run of months, so a mortgage is one
                    entry rather than twelve.
                  </>
                ) : (
                  <>Try a vendor, a note, or clear the filter.</>
                )}
              </p>
              {yearRows.length === 0 && (
                <button
                  className="btn-primary"
                  onClick={() => setDraft({ propertyId: propertyId || undefined })}
                >
                  Record your first cost
                </button>
              )}
            </div>
          ) : (
            <div className="tbl-scroll">
              <table className="tbl roomy">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Property</th>
                    <th>Paid to / note</th>
                    <th className="num">Amount</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(e => {
                    const m = CATEGORY_META[e.category]
                    return (
                      <tr key={e.id} className="click" onClick={() => setDraft({ expense: e })}>
                        <td className="nowrap">{fmtDate(e.incurred_on)}</td>
                        <td>
                          <span className="xchip" style={{ background: m.bg, color: m.color }}>
                            {m.label}
                          </span>
                        </td>
                        <td>
                          {e.property?.name ?? '—'}
                          {e.lease_id && <span className="pill plain">tenancy</span>}
                        </td>
                        <td>
                          <span className="cell-main">
                            {e.vendor && <span className="xvendor">{e.vendor}</span>}
                            {e.memo && <span className="xmemo">{e.memo}</span>}
                            {!e.vendor && !e.memo && <span className="muted">—</span>}
                          </span>
                        </td>
                        <td className="num">{fmtCurrency(e.amount)}</td>
                        <td className="xacts">
                          {e.receipt_url && (
                            <a
                              className="lnk"
                              href={e.receipt_url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={ev => ev.stopPropagation()}
                              title="Open the receipt"
                            >
                              receipt
                            </a>
                          )}
                          <span aria-hidden="true">⋮</span>
                        </td>
                      </tr>
                    )
                  })}
                  <tr className="tbl-total">
                    <td colSpan={4}>
                      {filtered ? 'These entries' : `All of ${year}`}
                    </td>
                    <td className="num">{fmtCurrency(shown.all)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {draft && (
        <ExpenseSheet
          draft={draft}
          properties={properties}
          leases={leases}
          onClose={() => setDraft(null)}
          onSaved={onSaved}
        />
      )}
    </>
  )
}

const CSS = `
  .fin .grid-2 {
    display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px; margin-bottom: 18px;
  }

  /* A statement of fact about the data, not an alarm. Quieter than
     \`.alarm-bar\`, which is reserved for money actively going wrong. */
  .fin .note-bar {
    display: flex; align-items: center; gap: 14px; justify-content: space-between;
    background: var(--fee-bg); border: 1px solid var(--fee-line); border-radius: 14px;
    padding: 13px 16px; margin-bottom: 18px; font-size: 12.5px; line-height: 1.5;
    color: var(--ink);
  }
  .fin .note-bar.quiet {
    background: var(--surface-2); border-color: var(--line); color: var(--ink-2);
  }
  .fin .note-bar strong { color: var(--ink); }

  /* ── Posting finished work ──────────────────────────────────────────────── */
  .fin .postable { display: grid; gap: 1px; background: var(--line-2); }
  .fin .post-row {
    display: flex; align-items: center; gap: 14px;
    padding: 11px 16px; background: var(--surface);
  }
  .fin .post-main { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .fin .post-title { font-size: 13px; font-weight: 500; }
  .fin .post-sub { font-size: 11.5px; color: var(--ink-2); }
  .fin .post-amt { font-size: 13.5px; font-weight: 600; }

  /* ── Category breakdown ─────────────────────────────────────────────────── */
  .fin .cats { display: grid; gap: 18px; padding: 4px 0 2px; }
  .fin .cat-group { display: grid; gap: 2px; }
  .fin .cat-ghd {
    display: flex; align-items: baseline; justify-content: space-between;
    border-bottom: 1px solid var(--line); padding-bottom: 5px;
  }
  .fin .cat-gname { font-size: 12px; font-weight: 600; letter-spacing: -0.005em; }
  .fin .cat-gamt { font-size: 13px; font-weight: 600; }
  .fin .cat-gblurb {
    margin: 4px 0 6px; font-size: 11px; color: var(--ink-2); line-height: 1.45;
  }
  .fin .cat-row {
    display: grid; grid-template-columns: minmax(84px, 1.1fr) minmax(40px, 1fr) auto 32px;
    align-items: center; gap: 10px; width: 100%;
    background: none; border: 0; padding: 5px 0; font: inherit; cursor: pointer;
    text-align: left; color: inherit; border-radius: 6px;
  }
  .fin .cat-row:hover { background: var(--surface-2); }
  .fin .cat-name { font-size: 12px; color: var(--ink-2); }
  .fin .cat-bar {
    height: 7px; border-radius: 980px; background: var(--line-2); overflow: hidden;
  }
  .fin .cat-fill { display: block; height: 100%; border-radius: 980px; }
  .fin .cat-amt { font-size: 12.5px; font-weight: 500; }
  .fin .cat-share {
    font-size: 11px; color: var(--ink-3); text-align: right;
    font-variant-numeric: tabular-nums;
  }

  /* ── Income against cost, by month ──────────────────────────────────────── */
  .fin .mbars {
    display: grid; grid-auto-flow: column; grid-auto-columns: 1fr;
    gap: 6px; align-items: end; height: 190px; padding: 10px 2px 0;
  }
  .fin .mbar { position: relative; display: grid; gap: 6px; height: 100%; }
  .fin .mbar-cols {
    display: flex; align-items: flex-end; justify-content: center; gap: 3px;
    height: 100%; min-height: 0;
  }
  .fin .mbar-in, .fin .mbar-out {
    width: 9px; border-radius: 3px 3px 0 0; min-height: 2px;
    transition: height 0.2s var(--ease);
  }
  .fin .mbar-in  { background: var(--in); }
  .fin .mbar-out { background: var(--fee); }
  .fin .mbar.ahead .mbar-in { background: var(--line-2); }
  .fin .mbar-lbl {
    font-size: 10px; color: var(--ink-3); text-align: center;
    white-space: nowrap; overflow: hidden;
  }
  .fin .mbar-tip {
    position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
    display: none; gap: 1px; z-index: 5; min-width: 150px;
    background: var(--ink); color: #fff; border-radius: 10px;
    padding: 8px 10px; font-size: 11px; line-height: 1.5; box-shadow: var(--lift-2);
  }
  .fin .mbar:hover .mbar-tip, .fin .mbar:focus-within .mbar-tip { display: grid; }
  .fin .mbar-tip strong { font-size: 11.5px; }
  .fin .mbar-tip .tip-good { color: #86efac; }
  .fin .mbar-tip .tip-bad  { color: #fca5a5; }
  .fin .mkey {
    display: inline-flex; align-items: center; gap: 7px;
    font-size: 11.5px; color: var(--ink-2);
  }
  .fin .mkey-dot {
    width: 8px; height: 8px; border-radius: 3px; display: inline-block;
  }
  .fin .mkey-dot.in  { background: var(--in); }
  .fin .mkey-dot.out { background: var(--fee); margin-left: 8px; }

  /* ── The tax table ──────────────────────────────────────────────────────── */
  .fin .tbl tr.tax-income td { font-weight: 500; }
  .fin .tbl tr.tax-total td {
    border-top: 1px solid var(--line); font-weight: 500;
  }
  .fin .tbl tr.tax-total.strong td { font-weight: 600; }
  .fin .tbl tr.tax-note td { font-size: 11.5px; color: var(--ink-2); }
  .fin .tbl tr.tbl-total td {
    border-top: 1px solid var(--line); font-weight: 600; background: var(--surface-2);
  }

  /* ── The ledger ─────────────────────────────────────────────────────────── */
  .fin .xchip {
    display: inline-block; padding: 3px 9px; border-radius: 980px;
    font-size: 11px; font-weight: 500; white-space: nowrap;
  }
  .fin .xvendor { display: block; font-size: 12.5px; }
  .fin .xmemo { display: block; font-size: 11.5px; color: var(--ink-2); }
  .fin .xacts {
    display: flex; align-items: center; gap: 10px; justify-content: flex-end;
    color: var(--ink-3);
  }
  .fin .nowrap { white-space: nowrap; }
  .fin .pickers { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

  @media (max-width: 1000px) {
    .fin .grid-2 { grid-template-columns: 1fr; }
  }
  @media (max-width: 700px) {
    .fin .note-bar { flex-direction: column; align-items: flex-start; }
    .fin .post-row { flex-wrap: wrap; }
  }
`
