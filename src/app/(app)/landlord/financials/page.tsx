'use client'

/**
 * Financials — the overview, as an admin dashboard.
 *
 * ── The shape ──────────────────────────────────────────────────────────────
 *
 * Four bands, read top to bottom, and nothing else:
 *
 *   1. **Three stat cards.** Collected this month (filled — the one figure
 *      the screen is about), overdue, and what is coming. Each carries a
 *      change pill and a way in.
 *   2. **Two panels.** Properties as a grid of peers on the left; collection
 *      month by month as a chart on the right.
 *   3. **What needs attention.** The worst three signals, compact.
 *   4. **Recent payments.** The familiar admin table — who, what, when, how
 *      much, and a status dot.
 *
 * Everything heavier lives behind a tab or a destination link: the full signal
 * list, the cash projection, the trends instrument, the collections work
 * surface. This screen's job is to be read from a few feet away and tell a
 * landlord whether to sit down.
 *
 * ── On the change pills ────────────────────────────────────────────────────
 *
 * A dashboard of this shape wants a percentage on every card, and this product
 * has refused to fake one throughout — nothing snapshots a portfolio, so
 * "arrears up 8% this week" is not a number we hold.
 *
 * Two of the three are honest and now computed properly:
 *
 *   • **Collected** compares this month *to date* against the same elapsed
 *     portion of last month — six days against six days. That is the
 *     comparison a landlord makes in their head, and it is fair in a way that
 *     a running month against a finished one never is.
 *   • **Overdue** compares today's balance against the reconstructed balance
 *     at the last month end, which the trends model already derives from due
 *     dates and settlement dates.
 *
 * The third has no honest basis, so it carries a count instead of a pill.
 * `TrendPill` cannot render a comparison without being told what it is
 * against, which is the guard that keeps this true as the page changes.
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { fmtCurrency } from '@/lib/payments'
import { useMoney } from '@/lib/useMoney'
import { buildDashboard } from '@/lib/financialsDashboard'
import { signals, pulse } from '@/lib/financialsSignals'
import { forecast } from '@/lib/financialsForecast'
import { pace, arrearsMove } from '@/lib/financialsHistory'
import { leaseHref, planHref } from '@/lib/financialsTree'
import { monthLabel, type Charge } from '@/lib/financialsMonth'
import { METHOD_META } from '@/lib/financialsRollup'
import MoneyHub from '@/components/finance/MoneyHub'
import Signals from '@/components/finance/Signals'
import Glyph, { GLYPH_CSS, type GlyphName } from '@/components/finance/Glyph'
import CommandPalette, { usePaletteShortcut } from '@/components/finance/CommandPalette'
import { VIZ_CSS } from '@/components/finance/Charts'
import ChargeSheet, { settledLabel } from '@/components/finance/ChargeSheet'
import {
  StatCard, MiniCard, TrendPill, StatusDot, GradientBars, SectionBand, PeriodSelect,
  TableTools, PANEL_CSS, type BarPoint,
} from '@/components/finance/Panels'
import { FINANCE_THEME } from '@/lib/financeTheme'

/** How many signals the landing screen shows before deferring to Insights. */
const SIGNALS_SHOWN = 3
/** Rows in the activity table at a glance. One screenful, not a log. */
const ACTIVITY_ROWS = 7
/** Rows once the landlord is actually searching — then it is a log. */
const ACTIVITY_ROWS_SEARCHING = 25

/**
 * The window the collected figure is read over.
 *
 * Only the collected card takes a window: "overdue" and "expected" name their
 * own ("right now", "next 90 days") and are not quantities a period can scope
 * — there is no such thing as the arrears of last March, because nothing
 * snapshots a portfolio. So the chip scopes the one card it honestly can,
 * and the other two keep their own windows in their titles.
 */
type PeriodId = 'this' | 'last' | '3m' | '12m'

const PERIODS: { id: PeriodId; label: string; months: number; endsLastMonth?: boolean }[] = [
  { id: 'this', label: 'This month',   months: 1 },
  { id: 'last', label: 'Last month',   months: 1, endsLastMonth: true },
  { id: '3m',   label: 'Last 3 months', months: 3 },
  { id: '12m',  label: 'Last 12 months', months: 12 },
]

/** Initials for a table avatar or a mini-card badge. */
const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '—'

export default function FinancialsOverview({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; lease?: string }>
}) {
  const { plan: planParam, lease: leaseParam } = use(searchParams)
  const router = useRouter()
  const { plans, waivers, bounced, loading } = useMoney()
  const [find, setFind] = useState(false)
  const [detail, setDetail] = useState<Charge | null>(null)
  /** The chart's window. Matches the reference's Monthly/Yearly control. */
  const [span, setSpan] = useState<'6m' | '12m'>('12m')
  /** The window the collected card is read over. */
  const [period, setPeriod] = useState<PeriodId>('this')
  /** The activity table's own search and status filter. */
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | 'ontime' | 'late'>('all')
  usePaletteShortcut(useCallback(() => setFind(true), []))

  useEffect(() => { document.title = 'Financials — Landlord | HomeHive' }, [])

  /**
   * The ledger used to open *inside* this page at `?plan=<id>`, and that link
   * is in sent email, in the dashboard, on the lease page and in two redirect
   * stubs. It is a route of its own now, so those links are forwarded rather
   * than broken.
   */
  useEffect(() => {
    if (planParam) router.replace(planHref(planParam))
    else if (leaseParam) router.replace(leaseHref(leaseParam))
  }, [planParam, leaseParam, router])

  const d = useMemo(() => buildDashboard(plans, waivers), [plans, waivers])
  const sigs = useMemo(() => signals(d), [d])
  const p = useMemo(() => pulse(d, sigs), [d, sigs])
  const cash = useMemo(() => forecast(d.charges), [d.charges])
  const pc = useMemo(() => pace(d.charges), [d.charges])
  const am = useMemo(() => arrearsMove(d.charges), [d.charges])

  /** The chart: collected per month, over the chosen span. */
  const bars = useMemo<BarPoint[]>(() => {
    const months = d.trend.filter(t => t.position !== 'future')
    const take = span === '6m' ? 6 : 12
    return months.slice(-take).map(t => ({
      key: t.key,
      label: t.label,
      longLabel: t.longLabel,
      value: t.collected,
      rows: [
        { label: 'Collected', value: fmtCurrency(t.collected) },
        { label: 'Billed', value: fmtCurrency(t.billed) },
        ...(t.stillDue > 0 ? [{ label: 'Still due', value: fmtCurrency(t.stillDue) }] : []),
        ...(t.rate !== null ? [{ label: 'Rate', value: `${t.rate}%` }] : []),
      ],
    }))
  }, [d.trend, span])

  const chartTotal = bars.reduce((n, b) => n + b.value, 0)

  /**
   * Collected over the chosen window, and what to say under it.
   *
   * This month keeps the pace comparison, which is the honest one — this month
   * to date against the same elapsed portion of last month. A finished window
   * has no such counterpart we hold, so it carries its collection rate instead
   * of a pill, under the rule that runs through this area: never a percentage
   * whose basis we cannot name.
   */
  const collected = useMemo(() => {
    const spec = PERIODS.find(x => x.id === period)!
    const past = d.trend.filter(t => t.position !== 'future')
    const window = spec.endsLastMonth
      ? past.filter(t => t.position === 'past').slice(-spec.months)
      : past.slice(-spec.months)
    const sum = (f: (t: (typeof past)[number]) => number) =>
      window.reduce((n, t) => n + f(t), 0)
    const got = sum(t => t.collected)
    const billed = sum(t => t.billed)
    const one = window.length === 1 ? window[0] : null
    return {
      isThisMonth: period === 'this',
      title: one ? `Collected in ${one.longLabel.split(' ')[0]}` : `Collected · ${spec.label.toLowerCase()}`,
      value: period === 'this' ? pc.toDate : got,
      billed,
      rate: billed > 0 ? Math.round((got / billed) * 100) : null,
      href: one
        ? `/landlord/financials/schedule?month=${one.key}`
        : '/landlord/financials/schedule',
    }
  }, [d.trend, period, pc.toDate])

  /**
   * Recent payments, newest first — the activity table.
   *
   * Searching widens it as well as filtering it: seven rows is the right
   * glance, but a landlord who has typed a tenant's name is no longer
   * glancing, and a search that can only look at the last seven payments
   * would answer "no" to questions whose answer is yes.
   */
  const searching = q.trim() !== '' || status !== 'all'
  const activity = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return d.charges
      .filter(c => c.settlement?.paidDate && (c.settlement.net > 0 || c.settlement.lateFee > 0))
      .filter(c => {
        const late = (c.settlement!.daysLate ?? 0) > 0
        if (status === 'late' && !late) return false
        if (status === 'ontime' && late) return false
        if (!needle) return true
        return [c.who, c.propertyName, c.label]
          .some(v => v?.toLowerCase().includes(needle))
      })
      .sort((a, b) => (b.settlement!.paidDate ?? '').localeCompare(a.settlement!.paidDate ?? ''))
      .slice(0, searching ? ACTIVITY_ROWS_SEARCHING : ACTIVITY_ROWS)
  }, [d.charges, q, status, searching])

  if (planParam || leaseParam) {
    return (
      <>
        <style>{FINANCE_THEME}</style>
        <div className="fin fin-wrap"><div className="skeleton-hero" /></div>
      </>
    )
  }

  return (
    <>
      <style>{FINANCE_THEME}{GLYPH_CSS}{VIZ_CSS}{PANEL_CSS}{CSS}</style>
      <div className="fin fin-wrap">
        <MoneyHub
          tab="overview"
          title="Financials"
          // The pulse is the subtitle. It keeps the one sentence that matters
          // without spending a whole band of the page on it.
          sub={loading
            ? 'Loading your portfolio…'
            : d.empty
              ? 'Set up a payment plan to start tracking rent.'
              : `${p.headline} — ${p.line}`}
          action={{ label: 'New payment plan', href: '/landlord/financials/new' }}
          secondary={d.empty ? undefined : { label: 'Statement', href: '/landlord/financials/statement' }}
          onFind={d.empty ? undefined : () => setFind(true)}
          alarmCount={bounced}
          dueCount={d.owedPayers}
        />

        {loading ? (
          <>
            <div className="stats">
              {[0, 1, 2].map(i => (
                <div key={i} className="statc"><div className="skeleton" style={{ height: 128 }} /></div>
              ))}
            </div>
            <div className="skeleton-hero" />
          </>
        ) : d.empty ? (
          <div className="empty">
            <div className="empty-title">No rent being tracked yet</div>
            <p className="empty-sub">
              Set up a payment plan against a lease to schedule rent, split it between tenants, and
              track who has paid. Everything on this page — collection, arrears, what is coming —
              is built from those plans.
            </p>
            <Link href="/landlord/financials/new" className="btn-primary">Create your first plan</Link>
          </div>
        ) : (
          <>
            {/* ══ 1. THE BAND, THEN THREE STAT CARDS ══ */}
            <SectionBand
              title="Overview"
              sub="Collection, arrears and what is coming — your whole portfolio."
            >
              <PeriodSelect
                label="Window for the collected figure"
                value={period}
                options={PERIODS.map(x => ({ id: x.id, label: x.label }))}
                onChange={setPeriod}
              />
            </SectionBand>

            <div className="stats">
              <StatCard
                primary
                icon="wallet"
                title={collected.title}
                sub={collected.isThisMonth
                  ? 'Rent and charges received so far'
                  : 'Rent and charges received'}
                value={fmtCurrency(collected.value)}
                pill={collected.isThisMonth && pc.comparable
                  ? <TrendPill pct={pc.deltaPct} basis={pc.basis} goodWhen="up" onDark />
                  : undefined}
                foot={collected.isThisMonth && pc.comparable
                  ? `${fmtCurrency(pc.lastToSame)} by the same point of last month`
                  : `${collected.rate ?? 0}% of ${fmtCurrency(collected.billed)} billed`}
                href={collected.href}
                footLabel="See details"
              />

              <StatCard
                icon="alert"
                tone={d.owed > 0 ? 'bad' : undefined}
                title="Overdue right now"
                sub={d.owed > 0
                  ? `${d.owedPayers} ${d.owedPayers === 1 ? 'person' : 'people'} · worst ${d.worstDaysLate} days late`
                  : 'Everyone is up to date'}
                value={d.owed > 0 ? fmtCurrency(d.owed) : 'All clear'}
                // Against the reconstructed balance at the last month end —
                // down is good here, so the pill inverts.
                pill={<TrendPill pct={am.deltaPct} basis={am.basis} goodWhen="down" />}
                foot={am.atLastMonthEnd !== null
                  ? `${fmtCurrency(am.atLastMonthEnd)} at the end of last month`
                  : undefined}
                href="/landlord/financials/collections"
                footLabel="Work collections"
              />

              <StatCard
                icon="calendar"
                title="Expected next 90 days"
                sub="Projected from how each payer actually pays"
                value={fmtCurrency(cash.expected)}
                // No honest basis for a percentage here, so it carries a count.
                foot={cash.atRisk > 0
                  ? `${fmtCurrency(cash.atRisk)} of it is owed by someone already behind`
                  : `${d.next30.count} charge${d.next30.count !== 1 ? 's' : ''} fall due in the next 30 days`}
                href="/landlord/financials/cashflow"
                footLabel="View cash flow"
              />
            </div>

            {bounced > 0 && (
              <Link className="alarm-bar" href="/landlord/reminders?state=problem">
                <span>
                  <strong>{bounced} email{bounced !== 1 ? 's' : ''} to tenants never arrived.</strong>{' '}
                  Bounced, refused, or marked as spam — so nobody read them.
                </span>
                <span className="go">Check them →</span>
              </Link>
            )}

            {/* ══ 2. PROPERTIES + THE CHART ══ */}
            <div className="grid-2">
              <section className="gpanel">
                <div className="gpanel-hd">
                  <div>
                    <h2 className="gpanel-title">Your properties</h2>
                    <p className="gpanel-sub">
                      {d.tree.propertyCount} propert{d.tree.propertyCount !== 1 ? 'ies' : 'y'} ·
                      {' '}{fmtCurrency(d.monthly)}/mo contracted
                    </p>
                  </div>
                  <Link className="btn-secondary sm" href="/landlord/financials/portfolio">
                    View all
                  </Link>
                </div>

                <div className="minis">
                  {d.properties.slice(0, 4).map(prop => (
                    <MiniCard
                      key={prop.propertyId}
                      badge={initials(prop.propertyName)}
                      label={prop.propertyName}
                      value={fmtCurrency(prop.monthly)}
                      caption={`${prop.leases.length} lease${prop.leases.length !== 1 ? 's' : ''} · ${
                        prop.payerCount} payer${prop.payerCount !== 1 ? 's' : ''}`}
                      status={prop.owed > 0
                        ? `${fmtCurrency(prop.owed)} overdue`
                        : prop.activeLeases === 0 ? 'No live lease' : 'Up to date'}
                      statusTone={prop.owed > 0 ? 'bad' : prop.activeLeases === 0 ? 'idle' : 'good'}
                      href={`/landlord/financials/portfolio#p-${prop.propertyId}`}
                    />
                  ))}
                </div>

                {d.properties.length > 4 && (
                  <p className="gpanel-more">
                    and {d.properties.length - 4} more —{' '}
                    <Link className="lnk" href="/landlord/financials/portfolio">open the portfolio</Link>
                  </p>
                )}
              </section>

              <section className="gpanel">
                <div className="gpanel-hd">
                  <div>
                    <h2 className="gpanel-title">Collection</h2>
                    <div className="gpanel-big">{fmtCurrency(chartTotal)}</div>
                    <p className="gpanel-sub">
                      received over the last {bars.length} months
                    </p>
                  </div>
                  <div className="seg sm pill" role="tablist" aria-label="Span">
                    <button
                      role="tab" aria-selected={span === '6m'}
                      className={`seg-btn${span === '6m' ? ' on' : ''}`}
                      onClick={() => setSpan('6m')}
                    >6 months</button>
                    <button
                      role="tab" aria-selected={span === '12m'}
                      className={`seg-btn${span === '12m' ? ' on' : ''}`}
                      onClick={() => setSpan('12m')}
                    >12 months</button>
                  </div>
                </div>

                <GradientBars
                  points={bars}
                  onSelect={key => router.push(`/landlord/financials/schedule?month=${key}`)}
                />

                <div className="gpanel-ft">
                  <span>Hover a month for the detail; click to open it.</span>
                  <Link className="btn-quiet sm" href="/landlord/financials/trends">
                    Health over time →
                  </Link>
                </div>
              </section>
            </div>

            {/* ══ 3. WHAT NEEDS ATTENTION ══ */}
            <Signals
              signals={sigs}
              limit={SIGNALS_SHOWN}
              moreHref="/landlord/financials/insights"
              title="Needs your attention"
            />

            {/* ══ 4. RECENT ACTIVITY ══ */}
            <section className="gpanel flush">
              <div className="gpanel-hd pad">
                <div>
                  <h2 className="gpanel-title">Recent payments</h2>
                  <p className="gpanel-sub">
                    {searching
                      ? `${activity.length} match${activity.length === 1 ? '' : 'es'}`
                      : `The last ${activity.length} that arrived`}
                  </p>
                </div>
                <div className="ptools">
                  <TableTools
                    query={q}
                    onQuery={setQ}
                    placeholder="Search tenant or property"
                    filter={status}
                    filters={[
                      { id: 'all' as const, label: 'All payments' },
                      { id: 'ontime' as const, label: 'On time' },
                      { id: 'late' as const, label: 'Late' },
                    ]}
                    onFilter={setStatus}
                  />
                  <Link className="btn-secondary sm" href="/landlord/financials/payments">
                    All payments
                  </Link>
                </div>
              </div>

              {activity.length === 0 ? (
                <p className="muted pad-b">
                  {searching
                    ? 'No payment matches that. Try a tenant’s name, a property, or clear the filter.'
                    : 'Nothing has been paid on these leases yet. Money a tenant pays online lands here '
                      + 'the moment it settles, and anything you record by hand appears too.'}
                </p>
              ) : (
                <div className="tbl-scroll">
                  <table className="atable">
                    <thead>
                      <tr>
                        <th>Tenant</th>
                        <th>Charge</th>
                        <th>Paid</th>
                        <th>Method</th>
                        <th className="num">Amount</th>
                        <th>Status</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {activity.map(c => {
                        const st = c.settlement!
                        const when = st.paidDate
                          ? settledLabel({ paidDate: st.paidDate, settledAt: st.settledAt })
                          : null
                        const method = st.method ? METHOD_META[st.method] : null
                        const late = (st.daysLate ?? 0) > 0
                        return (
                          <tr key={`${c.kind}-${c.id}`} onClick={() => setDetail(c)}>
                            <td>
                              <span className="at-who">
                                <span className="at-avatar">{initials(c.who ?? 'The lease')}</span>
                                <span>
                                  <span className="at-name">{c.who ?? 'The lease'}</span>
                                  <span className="at-sub">{c.propertyName}</span>
                                </span>
                              </span>
                            </td>
                            <td>{c.label}</td>
                            <td>{when ? when.date : '—'}</td>
                            <td>
                              {method
                                ? <span className="mchip sm" style={{ background: method.bg, color: method.color }}>
                                    {method.short}
                                  </span>
                                : <span className="muted sm">—</span>}
                            </td>
                            <td className="num">{fmtCurrency(st.net + st.lateFee)}</td>
                            <td>
                              <StatusDot tone={late ? 'warn' : 'good'}>
                                {late ? `${st.daysLate}d late` : 'On time'}
                              </StatusDot>
                            </td>
                            <td className="at-more" aria-hidden="true">⋮</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ══ WHERE ELSE TO GO ══ */}
            <div className="dests">
              <Dest icon="building" title="Portfolio"
                stat={`${d.tree.propertyCount} / ${d.tree.leaseCount}`}
                line="Property → lease → plan → tenant"
                href="/landlord/financials/portfolio" />
              <Dest icon="trend-up" title="Trends"
                stat={d.rate12 !== null ? `${d.rate12}%` : '—'}
                line="Arrears carried, on-time share, any span"
                href="/landlord/financials/trends" />
              <Dest icon="bolt" title="Insights"
                stat={`${sigs.length}`}
                line="Everything the figures add up to"
                href="/landlord/financials/insights" />
              <Dest icon="calendar" title="Schedule"
                stat={d.upcoming[1] ? fmtCurrency(d.upcoming[1].expected) : fmtCurrency(d.next30.amount)}
                line={d.upcoming[1] ? `${monthLabel(d.upcoming[1].key, true)} next` : 'Month by month'}
                href="/landlord/financials/schedule" />
            </div>
          </>
        )}
      </div>

      {detail && <ChargeSheet charge={detail} onClose={() => setDetail(null)} />}
      <CommandPalette tree={d.tree} open={find} onClose={() => setFind(false)} />
    </>
  )
}

function Dest({
  icon, title, stat, line, href,
}: {
  icon: GlyphName
  title: string
  stat: string
  line: string
  href: string
}) {
  return (
    <Link className="dest" href={href}>
      <span className="gl-plate"><Glyph name={icon} size={15} /></span>
      <span className="dest-main">
        <span className="dest-title">{title}</span>
        <span className="dest-stat">{stat}</span>
        <span className="dest-line">{line}</span>
      </span>
      <span className="row-chev" aria-hidden="true" />
    </Link>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');

  /* The two-up band. 44/56 rather than even: the chart earns the extra room,
     and a pair of exactly equal panels reads as indecision. */
  .fin .grid-2 {
    display: grid; grid-template-columns: minmax(0, 0.84fr) minmax(0, 1.16fr);
    gap: 16px; margin-bottom: 18px;
  }
  .fin .gpanel.flush { padding: 18px 0 4px; }
  .fin .gpanel-hd.pad { padding: 0 20px; }
  .fin .pad-b { padding: 0 20px 18px; }
  .fin .gpanel-more { font-size: 12px; color: var(--ink-3); margin-top: 12px; }
  .fin .gpanel-ft {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    flex-wrap: wrap; margin-top: 14px; padding-top: 13px;
    border-top: 1px solid var(--line-2); font-size: 12px; color: var(--ink-3);
  }
  .fin .statc + .statc { }

  /* ── Destinations, now a quiet footer row rather than a section ──────── */
  .fin .dests {
    display: grid; gap: 12px; margin-bottom: 20px;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  }
  .fin .dest {
    display: flex; align-items: flex-start; gap: 12px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
    padding: 15px 16px; text-decoration: none; color: inherit; min-width: 0;
    transition: border-color 0.15s var(--ease), box-shadow 0.15s var(--ease);
  }
  .fin .dest:hover { border-color: #d9d9de; box-shadow: var(--lift-1); }
  .fin .dest .row-chev { margin-top: 9px; }
  .fin .dest-main { flex: 1; min-width: 0; }
  .fin .dest-title {
    display: block; font-size: 11.5px; font-weight: 500; text-transform: uppercase;
    letter-spacing: 0.045em; color: var(--ink-3);
  }
  .fin .dest-stat {
    display: block; font-size: 19px; font-weight: 600; letter-spacing: -0.022em;
    margin-top: 4px; font-variant-numeric: tabular-nums; line-height: 1.15;
  }
  .fin .dest-line {
    display: block; font-size: 11.5px; color: var(--ink-2); line-height: 1.45; margin-top: 4px;
  }

  @media (max-width: 1100px) {
    .fin .grid-2 { grid-template-columns: 1fr; }
  }
  @media (max-width: 700px) {
    .fin .alarm-bar { flex-direction: column; align-items: flex-start; gap: 8px; }
    .fin .sig-body { padding-left: 14px; }
  }
`
