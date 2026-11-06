'use client'

/**
 * Trends — financial health over a span of time.
 *
 * ── The gap this fills ─────────────────────────────────────────────────────
 *
 * Every time-series figure in the money area was locked to twelve months and
 * answered one question: how much was billed, how much came in. That is
 * throughput. It is not health.
 *
 * A portfolio can bill and collect roughly the same amount every month for a
 * year while quietly accumulating four months of unrecovered arrears, and
 * nothing in this product would have shown it — because the one chart that
 * would have, *arrears over time*, did not exist. It does now, reconstructed
 * from each charge's due date and the date it settled (see
 * `src/lib/financialsHistory.ts` for why that is derivable where a weekly
 * arrears history is not).
 *
 * ── What makes it an instrument rather than a wall of charts ──────────────
 *
 *   • **One range control** over everything — 6 months, a year, two years, or
 *     every month you have ever billed in. The old charts had no control at
 *     all, so "has this got worse since last spring" was unanswerable.
 *   • **One property control.** "Which building is deteriorating" is the
 *     question a multi-property landlord actually has, and a portfolio-wide
 *     average is exactly the thing that hides the answer.
 *   • **One shared cursor.** Hover or tab any column and all three charts
 *     highlight that month while a single readout above them fills in. The
 *     charts stop being three separate acts of reading and start being one
 *     thing you can interrogate.
 *   • **Click to drill.** Any month opens in the schedule, lease by lease.
 *
 * It sits under the overview with a breadcrumb rather than taking a tab of its
 * own, for the same reason Insights and Cash flow do: they are drill-downs of
 * the landing screen, and eight tabs would reproduce the density problem one
 * level up in the navigation.
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { fmtCurrency } from '@/lib/payments'
import { useMoney } from '@/lib/useMoney'
import { buildTree } from '@/lib/financialsTree'
import { allCharges } from '@/lib/financialsMonth'
import { history, HISTORY_RANGES, rangeLabel, type RangeId } from '@/lib/financialsHistory'
import MoneyHub from '@/components/finance/MoneyHub'
import Glyph, { GLYPH_CSS } from '@/components/finance/Glyph'
import CommandPalette, { usePaletteShortcut } from '@/components/finance/CommandPalette'
import { Meter, VIZ_CSS } from '@/components/finance/Charts'
import TrendExplorer, { RangePicker, TIME_CSS } from '@/components/finance/TimeCharts'
import { FINANCE_THEME } from '@/lib/financeTheme'

export default function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; property?: string }>
}) {
  const sp = use(searchParams)
  const router = useRouter()
  const { plans, waivers, bounced, loading } = useMoney()
  const [find, setFind] = useState(false)
  usePaletteShortcut(useCallback(() => setFind(true), []))

  const [range, setRange] = useState<RangeId>(
    HISTORY_RANGES.some(r => r.id === sp.range) ? (sp.range as RangeId) : '12m',
  )
  const [property, setProperty] = useState(sp.property ?? '')

  useEffect(() => { document.title = 'Trends — Financials | HomeHive' }, [])

  useEffect(() => {
    const q = new URLSearchParams()
    if (range !== '12m') q.set('range', range)
    if (property) q.set('property', property)
    const qs = q.toString()
    window.history.replaceState(
      null, '', qs ? `/landlord/financials/trends?${qs}` : '/landlord/financials/trends',
    )
  }, [range, property])

  const tree = useMemo(() => buildTree(plans, waivers), [plans, waivers])

  // Every lease, including finished ones: this page is about history, and
  // dropping ended tenancies would quietly delete the months they billed in.
  const scoped = useMemo(
    () => (property
      ? plans.filter(p => (p.property?.id ?? p.property_id) === property)
      : plans),
    [plans, property],
  )
  const charges = useMemo(() => allCharges(scoped), [scoped])
  const h = useMemo(() => history(charges, range), [charges, range])

  const propName = property
    ? tree.properties.find(p => p.propertyId === property)?.propertyName ?? 'this property'
    : null

  return (
    <>
      <style>{FINANCE_THEME}{GLYPH_CSS}{VIZ_CSS}{TIME_CSS}{CSS}</style>
      <div className="fin fin-wrap">
        <MoneyHub
          tab="overview"
          crumbs={[
            { label: 'Financials', href: '/landlord/financials' },
            { label: 'Trends' },
          ]}
          title="Trends"
          sub="Collection, arrears and the cumulative gap over whatever span you choose."
          onFind={() => setFind(true)}
          alarmCount={bounced}
          dueCount={tree.leases.filter(l => l.owed > 0).length}
          filters={
            <div className="filters">
              <RangePicker value={range} onChange={setRange} />
              {tree.properties.length > 1 && (
                <select
                  className={`fsel${property ? ' on' : ''}`}
                  value={property}
                  onChange={e => setProperty(e.target.value)}
                  aria-label="Which property"
                >
                  <option value="">Whole portfolio</option>
                  {tree.properties.map(p => (
                    <option key={p.propertyId} value={p.propertyId}>{p.propertyName}</option>
                  ))}
                </select>
              )}
              <span className="fcount">{rangeLabel(h)}</span>
            </div>
          }
        />

        {loading ? (
          <div className="skeleton-hero" />
        ) : h.empty ? (
          <div className="empty">
            <div className="empty-title">
              {property ? `Nothing billed on ${propName} yet` : 'No history yet'}
            </div>
            <p className="empty-sub">
              Trends are built from charges that have come due. Once a month of rent has been
              billed, this page starts showing how much arrived, how much arrived late, and whether
              arrears are building.
            </p>
            {property
              ? <button className="btn-primary" onClick={() => setProperty('')}>Show the whole portfolio</button>
              : <Link href="/landlord/financials/new" className="btn-primary">Create a payment plan</Link>}
          </div>
        ) : (
          <>
            {/* ── The window in four figures ── */}
            <div className="kpis">
              <div className="kpi lead">
                <div className="kpi-label">
                  Collected over {HISTORY_RANGES.find(r => r.id === range)!.label.toLowerCase()}
                </div>
                <div className="kpi-value">{fmtCurrency(h.collected)}</div>
                <div className="kpi-meta">
                  {h.rate !== null
                    ? `${h.rate}% of ${fmtCurrency(h.billed)} billed${
                        propName ? ` at ${propName}` : ''}`
                    : 'nothing billed in this window'}
                </div>
                <Meter pct={h.rate} />
                {h.received > h.collected && (
                  <div className="kpi-foot">
                    {fmtCurrency(h.received)} in total with late fees included
                  </div>
                )}
              </div>

              <div className="kpi">
                <div className="kpi-label">Arrived on time</div>
                <div className={`kpi-value ${
                  (h.onTimeShare ?? 0) >= 90 ? 'good'
                  : (h.onTimeShare ?? 0) >= 70 ? 'warn' : 'bad'}`}>
                  {h.onTimeShare !== null ? `${h.onTimeShare}%` : '—'}
                </div>
                <Meter pct={h.onTimeShare} target={90} />
                <div className="kpi-meta">of every dollar billed in the window</div>
              </div>

              <div className={`kpi${(h.arrearsNow ?? 0) > 0 ? ' hot' : ''}`}>
                <div className="kpi-label">Arrears carried now</div>
                <div className={`kpi-value ${(h.arrearsNow ?? 0) > 0 ? 'bad' : 'good'}`}>
                  {h.arrearsNow !== null
                    ? (h.arrearsNow > 0 ? fmtCurrency(h.arrearsNow) : 'None')
                    : '—'}
                </div>
                <div className="kpi-meta">
                  {h.arrearsChange === null
                    ? 'at the end of the latest complete month'
                    : h.arrearsChange > 0
                      ? `up ${fmtCurrency(h.arrearsChange)} across the window`
                      : h.arrearsChange < 0
                        ? `down ${fmtCurrency(Math.abs(h.arrearsChange))} across the window`
                        : 'level across the window'}
                </div>
                {h.arrearsPeak !== null && h.arrearsPeak > (h.arrearsNow ?? 0) && (
                  <div className="kpi-foot">peaked at {fmtCurrency(h.arrearsPeak)}</div>
                )}
              </div>

              <div className="kpi">
                <div className="kpi-label">Best and worst month</div>
                <div className="kpi-value sm">
                  {h.best?.rate ?? '—'}<small>%</small>
                  {' / '}
                  {h.worst?.rate ?? '—'}<small>%</small>
                </div>
                <div className="kpi-meta">
                  {h.best && h.worst
                    ? `${h.best.longLabel} best · ${h.worst.longLabel} worst`
                    : 'not enough months yet'}
                </div>
              </div>
            </div>

            {/* ── The instrument ── */}
            <section className="card">
              <div className="card-hd">
                <div>
                  <h2 className="card-title">
                    <Glyph name="trend-up" size={15} />
                    {propName ?? 'Portfolio'} health over time
                  </h2>
                  <p className="muted sm">
                    One cursor across three charts — hover or tab a column to read that month
                    everywhere at once, click it to open the month.
                  </p>
                </div>
                <span className="card-note">{rangeLabel(h)}</span>
              </div>

              <TrendExplorer
                h={h}
                onSelectMonth={key => router.push(`/landlord/financials/schedule?month=${key}`)}
              />
            </section>

            {/* ── Where to go with what you just found ── */}
            <div className="cards three">
              <Link className="card lnk-card" href="/landlord/financials/collections">
                <span className="gl-plate critical"><Glyph name="alert" size={15} /></span>
                <span className="lc-main">
                  <b>Collections</b>
                  <em>
                    The arrears line above, broken into who owes it and how old each debt is.
                  </em>
                </span>
              </Link>
              <Link className="card lnk-card" href="/landlord/financials/cashflow">
                <span className="gl-plate"><Glyph name="wallet" size={15} /></span>
                <span className="lc-main">
                  <b>Cash flow</b>
                  <em>
                    The same behaviour pointed forwards — when money should land over the next
                    quarter.
                  </em>
                </span>
              </Link>
              <Link className="card lnk-card" href="/landlord/financials/statement">
                <span className="gl-plate"><Glyph name="mail" size={15} /></span>
                <span className="lc-main">
                  <b>Statement</b>
                  <em>
                    Any single month of this, on paper, with the arithmetic shown for an accountant.
                  </em>
                </span>
              </Link>
            </div>
          </>
        )}
      </div>

      <CommandPalette tree={tree} open={find} onClose={() => setFind(false)} />
    </>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');

  .fin .card-title { display: flex; align-items: center; gap: 8px; }
  .fin .card-title .gl { color: var(--ink-3); }
  .fin .kpi-value.sm { font-size: 23px; }
  .fin .kpi-value small { font-size: 0.55em; font-weight: 500; color: var(--ink-3); }

  /* A card that is entirely a link — used for the three follow-ons. */
  .fin .lnk-card {
    display: flex; align-items: flex-start; gap: 12px; text-decoration: none; color: inherit;
    transition: border-color 0.15s var(--ease), box-shadow 0.15s var(--ease);
  }
  .fin .lnk-card:hover { border-color: #d9d9de; box-shadow: var(--lift-1); }
  .fin .lc-main { min-width: 0; }
  .fin .lc-main b { display: block; font-size: 14px; font-weight: 600; letter-spacing: -0.014em; }
  .fin .lc-main em {
    display: block; font-style: normal; font-size: 12px; color: var(--ink-2);
    line-height: 1.55; margin-top: 4px;
  }
`
