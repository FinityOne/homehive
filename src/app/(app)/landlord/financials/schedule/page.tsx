'use client'

/**
 * Schedule — what falls due, month by month.
 *
 * ── What this answers ──────────────────────────────────────────────────────
 *
 * Rent is contracted a year in advance, which makes "what is coming in" a
 * knowable fact rather than a forecast — and the product used to simply never
 * state it. This page is that: one **named** month, with every month either
 * side reachable, and the six ahead as a strip above it.
 *
 * The month is in the heading — "October 2026", not "this month". That is not
 * pedantry. A page that says "this month" cannot be linked, cannot be
 * screenshotted into a conversation, and reads differently depending on when
 * the tab was opened. A future month renders through exactly the same code as a
 * past one; only the charge states differ, so there is no second code path to
 * disagree with the first.
 *
 * ── The hierarchy, again ───────────────────────────────────────────────────
 *
 * Inside a month: lease → payer → charge. Not plan → charge. A lease billed
 * through three plans is one block here, with all its payers under it, for the
 * same reason it is one row in the portfolio — it is one tenancy, and a
 * landlord reading October wants to know whether *the flat* paid, not whether
 * plan 2 of 3 did.
 *
 * ── Every charge is a button ────────────────────────────────────────────────
 *
 * The month tells you *that* $1,450 is owed. One click tells you what it is
 * made of, the fee the rule assessed and why, and who has been chased — the
 * same sheet that opens from every other payment line in the product.
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { fmtCurrency, fmtDate } from '@/lib/payments'
import { useMoney } from '@/lib/useMoney'
import { buildTree, leaseHref, planHref } from '@/lib/financialsTree'
import {
  filterPlans, monthView, upcomingMonths, monthKeyOf, monthLabel, shiftMonth, monthsBetween,
  LEASE_FILTERS,
  type LeaseFilter, type MonthKey, type MonthLease, type Charge,
} from '@/lib/financialsMonth'
import { AHEAD_MONTHS } from '@/lib/financialsDashboard'
import MoneyHub from '@/components/finance/MoneyHub'
import CommandPalette, { usePaletteShortcut } from '@/components/finance/CommandPalette'
import { GLYPH_CSS } from '@/components/finance/Glyph'
import { AheadStrip, Meter, VIZ_CSS } from '@/components/finance/Charts'
import ChargeSheet, { StatePill, dayOrdinal } from '@/components/finance/ChargeSheet'
import { FINANCE_THEME } from '@/lib/financeTheme'

/** What a month can be narrowed to. These are questions, not a list of states. */
type StateFilter = 'all' | 'owed' | 'overdue' | 'paid'

const STATE_FILTERS: { id: StateFilter; label: string; match: (c: Charge) => boolean }[] = [
  { id: 'all',     label: 'Everything',  match: () => true },
  { id: 'owed',    label: 'Still owed',  match: c => c.totalDue > 0 },
  { id: 'overdue', label: 'Overdue',     match: c => c.state === 'overdue' },
  { id: 'paid',    label: 'Settled',     match: c => c.state === 'paid' },
]

export default function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; leases?: string; property?: string; state?: string }>
}) {
  const sp = use(searchParams)
  const { plans, waivers, bounced, loading } = useMoney()
  const [find, setFind] = useState(false)
  usePaletteShortcut(useCallback(() => setFind(true), []))

  const thisMonth = monthKeyOf(new Date())
  const [month, setMonth] = useState<MonthKey>(
    /^\d{4}-\d{2}$/.test(sp.month ?? '') ? (sp.month as MonthKey) : thisMonth,
  )
  const [leaseFilter, setLeaseFilter] = useState<LeaseFilter>(
    LEASE_FILTERS.some(f => f.id === sp.leases) ? (sp.leases as LeaseFilter) : 'current',
  )
  const [property, setProperty] = useState(sp.property ?? '')
  const [state, setState] = useState<StateFilter>(
    STATE_FILTERS.some(f => f.id === sp.state) ? (sp.state as StateFilter) : 'all',
  )
  const [detail, setDetail] = useState<Charge | null>(null)

  useEffect(() => {
    document.title = `${monthLabel(month)} — Financials | HomeHive`
  }, [month])

  /** The month, the lease filter and the property ride in the URL, so any view
   *  of the schedule can be linked or refreshed exactly as it was read.
   *  Replaced rather than pushed: flicking between months should not fill the
   *  back stack with places the landlord never meant to go. */
  useEffect(() => {
    const q = new URLSearchParams()
    if (month !== thisMonth) q.set('month', month)
    if (leaseFilter !== 'current') q.set('leases', leaseFilter)
    if (property) q.set('property', property)
    if (state !== 'all') q.set('state', state)
    const qs = q.toString()
    window.history.replaceState(
      null, '', qs ? `/landlord/financials/schedule?${qs}` : '/landlord/financials/schedule',
    )
  }, [month, leaseFilter, property, state, thisMonth])

  const scoped = useMemo(() => filterPlans(plans, leaseFilter), [plans, leaseFilter])
  const tree = useMemo(() => buildTree(scoped, waivers), [scoped, waivers])
  const view = useMemo(() => monthView(scoped, month), [scoped, month])
  const ahead = useMemo(() => upcomingMonths(scoped, thisMonth, AHEAD_MONTHS), [scoped, thisMonth])

  const properties = useMemo(
    () => [...new Set(view.leases.map(l => l.propertyName))].sort((a, b) => a.localeCompare(b)),
    [view],
  )

  /** The leases shown, with their payers' charges narrowed to the state filter.
   *  A lease whose every charge is filtered out drops away entirely rather than
   *  appearing as an empty block. */
  const shown = useMemo(() => {
    const match = STATE_FILTERS.find(f => f.id === state)!.match
    return view.leases
      .filter(l => !property || l.propertyName === property)
      .map(l => ({
        ...l,
        payers: l.payers
          .map(p => ({ ...p, charges: p.charges.filter(match) }))
          .filter(p => p.charges.length > 0),
      }))
      .filter(l => l.payers.length > 0)
  }, [view, property, state])

  const leaseKeyOfPlan = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of tree.leases) for (const p of l.plans) m.set(p.planId, l.key)
    return m
  }, [tree])

  const filtered = property !== '' || state !== 'all' || leaseFilter !== 'current'
  const offset = monthsBetween(thisMonth, month)
  const when =
    view.position === 'current' ? 'This month'
    : offset === 1 ? 'Next month'
    : offset === -1 ? 'Last month'
    : offset > 0 ? `${offset} months ahead`
    : `${Math.abs(offset)} months back`

  return (
    <>
      <style>{FINANCE_THEME}{GLYPH_CSS}{VIZ_CSS}{CSS}</style>
      <div className="fin fin-wrap">
        <MoneyHub
          tab="schedule"
          title="Schedule"
          sub="What falls due, month by month — past months and future ones read identically."
          action={{ label: 'New payment plan', href: '/landlord/financials/new' }}
          onFind={() => setFind(true)}
          alarmCount={bounced}
          dueCount={tree.leases.filter(l => l.owed > 0).length}
          filters={
            <div className="filters">
              <select
                className={`fsel${leaseFilter !== 'current' ? ' on' : ''}`}
                value={leaseFilter}
                onChange={e => setLeaseFilter(e.target.value as LeaseFilter)}
                aria-label="Which leases"
              >
                {LEASE_FILTERS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <select
                className={`fsel${property ? ' on' : ''}`}
                value={property}
                onChange={e => setProperty(e.target.value)}
                aria-label="Which property"
              >
                <option value="">Every property</option>
                {properties.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <div className="seg" role="tablist" aria-label="Which charges">
                {STATE_FILTERS.map(f => {
                  const n = view.rows.filter(c => f.match(c)).length
                  if (n === 0 && f.id !== 'all') return null
                  return (
                    <button
                      key={f.id}
                      role="tab"
                      aria-selected={state === f.id}
                      className={`seg-btn${state === f.id ? ' on' : ''}${
                        f.id === 'overdue' && n > 0 ? ' hot' : ''}`}
                      onClick={() => setState(f.id)}
                    >
                      {f.label}
                      <span className="seg-badge">{n}</span>
                    </button>
                  )
                })}
              </div>
              {filtered && (
                <button
                  className="btn-quiet sm"
                  onClick={() => { setProperty(''); setState('all'); setLeaseFilter('current') }}
                >
                  Reset
                </button>
              )}
            </div>
          }
        />

        {loading ? (
          <div className="skeleton-hero" />
        ) : plans.length === 0 ? (
          <div className="empty">
            <div className="empty-title">Nothing scheduled</div>
            <p className="empty-sub">
              A payment plan is what puts rent on a calendar. Create one and every month of the
              lease — past and future — appears here.
            </p>
            <Link href="/landlord/financials/new" className="btn-primary">Create a payment plan</Link>
          </div>
        ) : (
          <>
            {/* ══ THE MONTHS AHEAD ══ */}
            <section className="card">
              <div className="card-hd">
                <div>
                  <h2 className="card-title">The next {ahead.length} months</h2>
                  <p className="muted sm">
                    {fmtCurrency(ahead.reduce((n, m) => n + m.expected, 0))} still to come.
                    Rent is contracted, so this is known rather than forecast.
                  </p>
                </div>
                <span className="card-note">click a month to open it below</span>
              </div>
              <AheadStrip
                months={ahead}
                selected={month}
                thisMonth={thisMonth}
                onSelect={setMonth}
              />
            </section>

            {/* ══ ONE NAMED MONTH ══ */}
            <section className="panel month">
              <div className="month-hd">
                <div className="month-nav">
                  <button
                    className="mn-btn"
                    onClick={() => setMonth(shiftMonth(month, -1))}
                    aria-label={`Go to ${monthLabel(shiftMonth(month, -1))}`}
                  >&lsaquo;</button>
                  <div className="month-title">
                    <h2 className="month-name">{view.label}</h2>
                    <span className="month-when">{when}</span>
                  </div>
                  <button
                    className="mn-btn"
                    onClick={() => setMonth(shiftMonth(month, 1))}
                    aria-label={`Go to ${monthLabel(shiftMonth(month, 1))}`}
                  >&rsaquo;</button>
                </div>
                {view.position !== 'current' && (
                  <button className="btn-quiet sm" onClick={() => setMonth(thisMonth)}>
                    Back to {monthLabel(thisMonth, true)}
                  </button>
                )}
              </div>

              <div className="month-figs">
                <MonthFig
                  label="Due in the month"
                  value={fmtCurrency(view.totals.billed)}
                  meta={`${view.totals.count} charge${view.totals.count !== 1 ? 's' : ''}`}
                />
                <MonthFig
                  label={view.position === 'future' ? 'Paid early' : 'Collected'}
                  value={fmtCurrency(view.totals.collected)}
                  // The rate stays rent-against-rent: fold fees into the
                  // numerator and a tenant who pays late pushes it past 100%.
                  meta={view.totals.lateFeesCollected > 0
                    ? `incl. ${fmtCurrency(view.totals.lateFeesCollected)} late fees`
                    : view.totals.rate !== null ? `${view.totals.rate}% of the month` : 'nothing billed'}
                  tone={view.totals.rate !== null && view.totals.rate >= 100 ? 'good' : undefined}
                  meter={view.totals.rate}
                />
                <MonthFig
                  // Rent still owed *plus* the fees the rule has assessed on it
                  // — the figure a landlord would actually quote.
                  label="Still due"
                  value={fmtCurrency(view.totalDue)}
                  meta={view.feesDue > 0
                    ? `incl. ${fmtCurrency(view.feesDue)} late fees`
                    : view.totals.inFlight > 0
                      ? `${fmtCurrency(view.totals.inFlight)} clearing`
                      : `${view.totals.count - view.totals.settledCount} unsettled`}
                  tone={view.totalDue > 0 ? 'warn' : 'good'}
                />
                <MonthFig
                  label="Overdue in this month"
                  value={view.overdueDue > 0 ? fmtCurrency(view.overdueDue) : 'None'}
                  meta={view.position === 'future'
                    ? 'nothing can be late yet'
                    : `${view.totals.overdueCount} past due`}
                  tone={view.overdueDue > 0 ? 'bad' : 'good'}
                />
              </div>

              {/* A palette has to be teachable exactly once, and this is the
                  densest thing in the area — the place a landlord first wonders
                  what the colours mean. */}
              <div className="month-key">
                <span className="key">
                  <span className="key-item"><span className="key-dot in" />paid</span>
                  <span className="key-item"><span className="key-dot late" />overdue</span>
                  <span className="key-item"><span className="key-dot fee" />late fee</span>
                  <span className="key-item"><span className="key-dot flight" />clearing</span>
                  <span className="key-item"><span className="key-dot idle" />not due yet</span>
                </span>
              </div>

              <div className="panel-bd flush">
                {view.empty ? (
                  <p className="muted pad">
                    Nothing is scheduled for {view.label}.{' '}
                    {view.position === 'future'
                      ? 'No lease in view bills in that month.'
                      : 'No rent or charges fell due in that month.'}
                  </p>
                ) : shown.length === 0 ? (
                  <p className="muted pad">
                    {view.leases.length} lease{view.leases.length !== 1 ? 's' : ''} bill in{' '}
                    {view.label}, but nothing matches these filters.{' '}
                    <button className="btn-quiet sm" onClick={() => { setProperty(''); setState('all') }}>
                      Clear them
                    </button>
                  </p>
                ) : shown.map(l => (
                  <MonthLeaseBlock
                    key={l.planId}
                    lease={l}
                    leaseKey={leaseKeyOfPlan.get(l.planId) ?? `plan-${l.planId}`}
                    onInspect={setDetail}
                  />
                ))}
              </div>

              <div className="panel-ft">
                <span>
                  A future month works exactly like a past one — the same rows, the same
                  arithmetic. Only the states differ, because nothing can be late yet.
                </span>
                <Link className="btn-quiet sm" href="/landlord/financials/payments">
                  What actually arrived →
                </Link>
              </div>
            </section>
          </>
        )}
      </div>

      {detail && <ChargeSheet charge={detail} onClose={() => setDetail(null)} />}

      <CommandPalette tree={tree} open={find} onClose={() => setFind(false)} />
    </>
  )
}

function MonthFig({
  label, value, meta, tone, meter,
}: {
  label: string
  value: string
  meta: string
  tone?: 'good' | 'bad' | 'warn'
  meter?: number | null
}) {
  return (
    <div className={`mf${tone ? ' ' + tone : ''}`}>
      <div className="mf-label">{label}</div>
      <div className="mf-value">{value}</div>
      {meter !== undefined && <Meter pct={meter} />}
      <div className="mf-meta">{meta}</div>
    </div>
  )
}

/** One lease inside the selected month: its payers, and what each one owes. */
function MonthLeaseBlock({
  lease, leaseKey, onInspect,
}: {
  lease: MonthLease
  leaseKey: string
  onInspect: (c: Charge) => void
}) {
  return (
    <div className="ml">
      <div className="ml-hd">
        <div>
          <div className="ml-name">
            <Link href={leaseHref(leaseKey)} className="ml-link">{lease.propertyName}</Link>
            {lease.stage === 'ended' && <span className="pill plain">ended</span>}
            {lease.stage === 'ending' && <span className="pill warn">ending soon</span>}
          </div>
          <div className="ml-sub">
            {lease.leaseName} · rent due on the {dayOrdinal(lease.dueDay)}
          </div>
        </div>
        <div className="ml-figs">
          <span className="ml-fig"><b>{fmtCurrency(lease.paid)}</b> in</span>
          <span
            className={`ml-fig${lease.totalDue > 0 ? ' owed' : ''}`}
            title={lease.lateFees > 0
              ? `${fmtCurrency(lease.outstanding)} of rent and charges plus ${
                  fmtCurrency(lease.lateFees)} of late fees`
              : undefined}
          >
            <b>{fmtCurrency(lease.totalDue)}</b> due
          </span>
          <Link className="btn-secondary sm" href={planHref(lease.planId)}>
            Ledger
          </Link>
        </div>
      </div>

      <div className="ml-payers">
        {lease.payers.map(p => (
          <div key={p.payerId ?? p.name} className="mp">
            <span className="mp-who">{p.name}</span>
            <span className="mp-charges">
              {p.charges.map(c => (
                <button
                  key={`${c.kind}-${c.id}`}
                  className="mp-charge"
                  onClick={() => onInspect(c)}
                  title={`${c.label} — see the breakdown`}
                >
                  <StatePill state={c.state} />
                  <span className="mp-c-label">
                    {c.kind === 'charge' ? c.label : `due ${fmtDate(c.dueDate)}`}
                  </span>
                  {c.daysLate > 0 && <span className="mp-late">{c.daysLate}d late</span>}
                  {c.lateFee > 0 && <span className="mp-fee">+{fmtCurrency(c.lateFee)} fee</span>}
                </button>
              ))}
            </span>
            <span className="mp-fig">
              <span className={`mp-amt${p.totalDue > 0 ? ' owed' : ''}`}>
                {p.totalDue > 0 ? fmtCurrency(p.totalDue) : fmtCurrency(p.paid)}
              </span>
              <span className="mp-amt-lbl">
                {p.totalDue > 0
                  ? p.lateFees > 0 ? `due incl. ${fmtCurrency(p.lateFees)} fees`
                    : p.paid > 0 ? `due of ${fmtCurrency(p.billed)}` : 'due'
                  : 'paid'}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');

  /* ── The month header ── */
  .fin .month-hd {
    display: flex; align-items: center; justify-content: space-between; gap: 14px;
    flex-wrap: wrap; padding: 17px 22px 13px;
  }
  .fin .month-nav { display: flex; align-items: center; gap: 12px; }
  .fin .mn-btn {
    width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--line);
    background: var(--surface); color: var(--ink-2); font-size: 17px; line-height: 1;
    cursor: pointer; flex-shrink: 0;
  }
  .fin .mn-btn:hover { border-color: var(--accent); color: var(--accent); }
  .fin .month-title { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .fin .month-name { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; }
  .fin .month-when { font-size: 12px; color: var(--ink-3); }

  .fin .month-figs {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 0;
    padding: 4px 22px 16px;
  }
  .fin .mf { padding: 0 16px; border-left: 1px solid var(--line-2); min-width: 0; }
  .fin .mf:first-child { border-left: none; padding-left: 0; }
  .fin .mf-label { font-size: 11px; color: var(--ink-3); }
  .fin .mf-value {
    font-size: 20px; font-weight: 600; letter-spacing: -0.022em; margin-top: 3px;
    font-variant-numeric: tabular-nums;
  }
  .fin .mf.good .mf-value { color: var(--in); }
  .fin .mf.bad  .mf-value { color: var(--late); }
  .fin .mf.warn .mf-value { color: var(--fee); }
  .fin .mf-meta { font-size: 11px; color: var(--ink-3); margin-top: 4px; line-height: 1.45; }
  .fin .month-key { padding: 0 22px 14px; }

  /* ── One lease inside the month ── */
  .fin .ml { border-top: 1px solid var(--line-2); }
  .fin .ml-hd {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 14px;
    flex-wrap: wrap; padding: 14px 22px 10px;
  }
  .fin .ml-name {
    font-size: 14.5px; font-weight: 600; letter-spacing: -0.015em;
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  }
  .fin .ml-link { color: inherit; text-decoration: none; }
  .fin .ml-link:hover { color: var(--accent); text-decoration: underline; }
  .fin .ml-sub { font-size: 11.5px; color: var(--ink-2); margin-top: 2px; }
  .fin .ml-figs { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .fin .ml-fig { font-size: 12px; color: var(--ink-3); }
  .fin .ml-fig b { font-size: 14px; font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
  .fin .ml-fig.owed b { color: var(--late); }

  .fin .ml-payers { padding: 0 22px 14px; }
  .fin .mp {
    display: grid; grid-template-columns: 150px 1fr auto; gap: 14px; align-items: center;
    padding: 9px 0; border-top: 1px solid var(--line-2);
  }
  .fin .mp:first-child { border-top: none; }
  .fin .mp-who { font-size: 13px; font-weight: 500; min-width: 0; letter-spacing: -0.01em; }
  .fin .mp-charges { display: flex; gap: 7px; flex-wrap: wrap; min-width: 0; }
  .fin .mp-charge {
    display: inline-flex; align-items: center; gap: 7px; background: var(--surface-2);
    border: 1px solid var(--line-2); border-radius: 980px; padding: 3px 11px 3px 5px;
    font-family: inherit; font-size: 11.5px; color: var(--ink-2); cursor: pointer;
    letter-spacing: -0.005em;
  }
  .fin .mp-charge:hover { border-color: var(--accent); background: var(--accent-bg); }
  .fin .mp-c-label { white-space: nowrap; }
  .fin .mp-late { color: var(--late); }
  .fin .mp-fee { color: var(--fee); }
  .fin .mp-fig { text-align: right; flex-shrink: 0; }
  .fin .mp-amt { font-size: 13.5px; font-weight: 600; display: block; font-variant-numeric: tabular-nums; }
  .fin .mp-amt.owed { color: var(--late); }
  .fin .mp-amt-lbl { font-size: 10.5px; color: var(--ink-3); }

  @media (max-width: 860px) {
    .fin .month-figs { grid-template-columns: repeat(2, 1fr); gap: 16px 0; }
    .fin .mf:nth-child(odd) { border-left: none; padding-left: 0; }
  }
  @media (max-width: 700px) {
    .fin .mp { grid-template-columns: 1fr auto; }
    .fin .mp-charges { grid-column: 1 / -1; }
    .fin .month-hd, .fin .ml-hd { padding-left: 14px; padding-right: 14px; }
    .fin .month-figs, .fin .ml-payers, .fin .month-key { padding-left: 14px; padding-right: 14px; }
  }
`
