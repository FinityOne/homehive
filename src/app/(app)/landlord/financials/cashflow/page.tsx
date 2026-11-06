'use client'

/**
 * Cash flow — when the money actually arrives, and how reliably.
 *
 * ── Why these three things are one page ────────────────────────────────────
 *
 * They were three separate cards on the overview, and they are really one
 * argument read in order:
 *
 *   1. **The projection.** What should land, week by week, over a quarter.
 *   2. **The rate behind it.** Whether collection is holding month to month,
 *      which is the thing that makes the projection believable or not.
 *   3. **The people behind that.** Who pays on time, who is reliably late, and
 *      by how much — which is literally the input the projection is built
 *      from.
 *
 * Splitting them meant a landlord could read a forecast without ever seeing
 * the behaviour it rests on. Putting them together means the page can show its
 * working: the forecast is not a model this product invented, it is *your
 * tenants' own history* applied to *your own contracted charges*.
 *
 * ── The honesty rules, restated here because this is where they bite ──────
 *
 *   • **Arrears are never forecast.** Overdue money has no arrival date — that
 *     is the whole reason it is a problem. It is reported alongside, excluded
 *     from every week, and the chart says so in words.
 *   • **At risk is not expected.** A future charge owed by someone already
 *     behind is drawn in its week but kept out of the expected total.
 *   • **The rate compares completed months only.** A month still running has
 *     not finished collecting, and comparing it to a finished one invents a
 *     crisis every time a landlord looks before the rent is due.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { fmtCurrency } from '@/lib/payments'
import { useMoney } from '@/lib/useMoney'
import { buildDashboard } from '@/lib/financialsDashboard'
import { forecast } from '@/lib/financialsForecast'
import { reliability, type Reliability } from '@/lib/financialsSignals'
import { leaseHref, planHref } from '@/lib/financialsTree'
import { monthKeyOf } from '@/lib/financialsMonth'
import MoneyHub from '@/components/finance/MoneyHub'
import Glyph, { GLYPH_CSS } from '@/components/finance/Glyph'
import CommandPalette, { usePaletteShortcut } from '@/components/finance/CommandPalette'
import {
  ForecastBars, RateLine, AheadStrip, MethodMix, Meter, Sparkline, Delta, VIZ_CSS,
} from '@/components/finance/Charts'
import { FINANCE_THEME } from '@/lib/financeTheme'

/** How the payer table can be ordered. */
type SortKey = 'worst' | 'late' | 'name' | 'owed'

export default function CashflowPage() {
  const { plans, waivers, bounced, loading } = useMoney()
  const router = useRouter()
  const [find, setFind] = useState(false)
  const [sort, setSort] = useState<SortKey>('worst')
  usePaletteShortcut(useCallback(() => setFind(true), []))

  useEffect(() => { document.title = 'Cash flow — Financials | HomeHive' }, [])

  const d = useMemo(() => buildDashboard(plans, waivers), [plans, waivers])
  const cash = useMemo(() => forecast(d.charges), [d.charges])
  const rel = useMemo(() => reliability(d.charges), [d.charges])
  const thisMonth = monthKeyOf(new Date())

  const leaseOfPlan = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of d.tree.leases) for (const p of l.plans) m.set(p.planId, l.key)
    return m
  }, [d.tree])

  // Only payers with something to say. A tenancy that has never billed has no
  // behaviour to report and would pad the table with "no pattern yet" rows.
  const payers = useMemo(() => {
    const live = rel.filter(r => r.settled > 0 || r.owed > 0)
    const by: Record<SortKey, (a: Reliability, b: Reliability) => number> = {
      worst: (a, b) => a.score - b.score || b.owed - a.owed,
      late:  (a, b) => b.medianDaysLate - a.medianDaysLate || (b.lateRate ?? 0) - (a.lateRate ?? 0),
      name:  (a, b) => a.name.localeCompare(b.name),
      owed:  (a, b) => b.owed - a.owed,
    }
    return live.slice().sort(by[sort])
  }, [rel, sort])

  const done = useMemo(() => d.trend.filter(t => t.position === 'past'), [d.trend])
  const chronic = rel.filter(r => r.band === 'chronic').length

  return (
    <>
      <style>{FINANCE_THEME}{GLYPH_CSS}{VIZ_CSS}{CSS}</style>
      <div className="fin fin-wrap">
        <MoneyHub
          tab="overview"
          crumbs={[
            { label: 'Financials', href: '/landlord/financials' },
            { label: 'Cash flow' },
          ]}
          title="Cash flow"
          sub="When the money should arrive, whether collection is holding, and who the projection is built on."
          onFind={() => setFind(true)}
          alarmCount={bounced}
          dueCount={d.owedPayers}
        />

        {loading ? (
          <div className="skeleton-hero" />
        ) : d.empty ? (
          <div className="empty">
            <div className="empty-title">Nothing to project yet</div>
            <p className="empty-sub">
              A projection needs contracted charges and some settled history to learn from. Create
              a payment plan and this page fills in as rent starts arriving.
            </p>
            <Link href="/landlord/financials/new" className="btn-primary">Create a payment plan</Link>
          </div>
        ) : (
          <>
            {/* ── The headline figures for this page only ── */}
            <div className="kpis">
              <div className="kpi lead">
                <div className="kpi-label">Expected over {cash.weeks.length} weeks</div>
                <div className="kpi-value">{fmtCurrency(cash.expected)}</div>
                <div className="kpi-meta">
                  {cash.contracted > 0
                    ? `of ${fmtCurrency(cash.contracted)} contracted in that window`
                    : 'nothing contracted in that window'}
                </div>
                {cash.slippage > 0 && (
                  <div className="kpi-foot">
                    {fmtCurrency(cash.slippage)} projected to land after the window, on the
                    evidence of how late those payers usually are
                  </div>
                )}
              </div>

              <div className={`kpi${cash.atRisk > 0 ? ' hot' : ''}`}>
                <div className="kpi-label">At risk</div>
                <div className={`kpi-value ${cash.atRisk > 0 ? 'bad' : 'good'}`}>
                  {cash.atRisk > 0 ? fmtCurrency(cash.atRisk) : 'None'}
                </div>
                <div className="kpi-meta">
                  {cash.atRisk > 0
                    ? 'owed by someone already behind — in the chart, out of the total'
                    : 'nobody with a future charge is currently behind'}
                </div>
              </div>

              <Link href="/landlord/financials/collections" className={`kpi${cash.overdueUnscheduled > 0 ? ' hot' : ''}`}>
                <div className="kpi-label">Already overdue</div>
                <div className={`kpi-value ${cash.overdueUnscheduled > 0 ? 'bad' : 'good'}`}>
                  {cash.overdueUnscheduled > 0 ? fmtCurrency(cash.overdueUnscheduled) : 'None'}
                </div>
                <div className="kpi-meta">
                  deliberately not forecast — overdue money has no arrival date
                </div>
                {cash.overdueUnscheduled > 0 && (
                  <span className="kpi-go">Work the collections list →</span>
                )}
              </Link>

              <div className="kpi">
                <div className="kpi-label">Paid on time</div>
                <div className={`kpi-value ${
                  (d.behaviour.rate ?? 0) >= 90 ? 'good'
                  : (d.behaviour.rate ?? 0) >= 70 ? 'warn' : 'bad'}`}>
                  {d.behaviour.rate !== null ? `${d.behaviour.rate}%` : '—'}
                </div>
                <Meter pct={d.behaviour.rate} target={90} />
                <div className="kpi-meta">
                  {d.behaviour.settled > 0
                    ? `${d.behaviour.onTime} of ${d.behaviour.settled} settled charges, last ${d.behaviour.months} months`
                    : 'nothing settled yet'}
                </div>
              </div>
            </div>

            {/* ── 1. THE PROJECTION ── */}
            {!cash.empty && (
              <section className="card">
                <div className="card-hd">
                  <div>
                    <h2 className="card-title">
                      <Glyph name="wallet" size={15} />
                      Projected arrivals
                    </h2>
                    <p className="muted sm">
                      Each unsettled charge shifted by the median lateness of whoever owes it.
                    </p>
                  </div>
                  <span className="card-note">
                    {cash.modelledPayers > 0
                      ? `${cash.modelledPayers} payer${cash.modelledPayers !== 1 ? 's' : ''} shifted · ${cash.assumedOnTime} taken at the due date`
                      : 'everyone taken at their due date'}
                  </span>
                </div>
                <ForecastBars weeks={cash.weeks} overdueUnscheduled={cash.overdueUnscheduled} />
              </section>
            )}

            {/* ── 2. IS COLLECTION HOLDING ── */}
            <section className="card">
              <div className="card-hd">
                <div>
                  <h2 className="card-title">
                    <Glyph name="trend-up" size={15} />
                    Collection rate
                  </h2>
                  <p className="muted sm">
                    Rent against rent, month by month. The dashed line is full collection.
                  </p>
                </div>
                {d.lastCompleted?.rate != null && (
                  <span className="card-note cmp">
                    {d.lastCompleted.longLabel} collected <b>{d.lastCompleted.rate}%</b>
                    <Delta
                      value={d.rateDelta}
                      unit="pts"
                      basis={`on your usual ${d.rateTypical}% across completed months`}
                      goodWhen="up"
                    />
                  </span>
                )}
              </div>
              <RateLine points={d.trend} />
              <div className="card-ft">
                <span>
                  Only completed months are compared. A month still running has not finished
                  collecting, so holding it against a finished one would report a crisis every time
                  you looked before the rent came in.
                </span>
                <Link className="btn-quiet sm" href="/landlord/financials/schedule">
                  Open the schedule →
                </Link>
              </div>
            </section>

            <div className="cards two">
              {/* ── WHAT IS CONTRACTED AHEAD ── */}
              <section className="card">
                <div className="card-hd">
                  <div>
                    <h2 className="card-title">
                      <Glyph name="calendar" size={15} />
                      The months ahead
                    </h2>
                    <p className="muted sm">
                      What the leases say is due — contracted, not forecast.
                    </p>
                  </div>
                </div>
                <AheadStrip
                  months={d.upcoming}
                  thisMonth={thisMonth}
                  onSelect={key => router.push(`/landlord/financials/schedule?month=${key}`)}
                />
              </section>

              {/* ── HOW THE MONEY ARRIVES ── */}
              <section className="card">
                <div className="card-hd">
                  <div>
                    <h2 className="card-title">
                      <Glyph name="bolt" size={15} />
                      How the money arrives
                    </h2>
                    <p className="muted sm">
                      Bank transfers spend days in flight — the lag is the bank&rsquo;s, not the
                      tenant&rsquo;s.
                    </p>
                  </div>
                </div>
                {d.methods.length === 0 ? (
                  <p className="muted">Nothing has been paid yet, so there is no mix to show.</p>
                ) : (
                  <MethodMix slices={d.methods} />
                )}
                {done.length >= 3 && (
                  <>
                    <div className="sec-hd tight">
                      <h3 className="sec-title sm">Collected by month</h3>
                    </div>
                    <Sparkline values={done.map(t => t.collected)} tone="good" height={40} />
                  </>
                )}
              </section>
            </div>

            {/* ── 3. THE PEOPLE THE PROJECTION IS BUILT ON ── */}
            <section className="panel">
              <div className="panel-hd">
                <h2 className="panel-title">
                  Who the projection is built on
                  {chronic > 0 && <span className="panel-count">{chronic}</span>}
                </h2>
                <span className="panel-note">
                  {payers.length} payer{payers.length !== 1 ? 's' : ''} with a record
                </span>
              </div>

              <div className="chg-filters">
                <div className="seg" role="tablist" aria-label="Order">
                  {([
                    { id: 'worst', label: 'Worst record' },
                    { id: 'late', label: 'Most days late' },
                    { id: 'owed', label: 'Owes most' },
                    { id: 'name', label: 'Name' },
                  ] as { id: SortKey; label: string }[]).map(s => (
                    <button
                      key={s.id}
                      role="tab"
                      aria-selected={sort === s.id}
                      className={`seg-btn${sort === s.id ? ' on' : ''}`}
                      onClick={() => setSort(s.id)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="tbl-scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Tenant</th>
                      <th>Record</th>
                      <th className="num">On time</th>
                      <th className="num">Typically late by</th>
                      <th className="num">Worst</th>
                      <th className="num">Owes now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payers.length === 0 ? (
                      <tr><td colSpan={6} className="muted" style={{ padding: '22px 12px' }}>
                        Nothing has settled yet, so there is no behaviour to read.
                      </td></tr>
                    ) : payers.map(r => {
                      const key = leaseOfPlan.get(r.planId)
                      return (
                        <tr
                          key={r.key}
                          className="click"
                          onClick={() => router.push(key ? leaseHref(key) : planHref(r.planId))}
                        >
                          <td className="cell-main">
                            <b>{r.name}</b>
                            <em>{r.propertyName} · {r.leaseName}</em>
                          </td>
                          <td>
                            <span className={`band ${r.band}`}>{r.bandLabel}</span>
                          </td>
                          <td className="num">
                            {r.settled > 0 ? `${r.onTime}/${r.settled}` : '—'}
                            {r.lateRate !== null && r.lateRate > 0 && (
                              <em className="cell-note">{r.lateRate}% late</em>
                            )}
                          </td>
                          <td className="num">
                            {r.medianDaysLate > 0 ? `${r.medianDaysLate}d` : '—'}
                          </td>
                          <td className="num">
                            {r.worstDaysLate > 0 ? `${r.worstDaysLate}d` : '—'}
                          </td>
                          <td className={`num${r.owed > 0 ? ' owed' : ''}`}>
                            {r.owed > 0 ? fmtCurrency(r.owed) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="panel-ft">
                <span>
                  <strong>Typically late by</strong> is the median, not the average — one disastrous
                  month should not describe a tenant who is usually two days off. It is the exact
                  figure the projection above shifts each charge by.
                </span>
                <Link className="btn-quiet sm" href="/landlord/financials/payments">
                  Every payment →
                </Link>
              </div>
            </section>
          </>
        )}
      </div>

      <CommandPalette tree={d.tree} open={find} onClose={() => setFind(false)} />
    </>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');

  .fin .card-title { display: flex; align-items: center; gap: 8px; }
  .fin .card-title .gl { color: var(--ink-3); }
  .fin .card-note.cmp { display: inline-flex; align-items: center; gap: 7px; }
  .fin .card-note.cmp b { color: var(--ink); font-weight: 600; }
  .fin .sec-title.sm { font-size: 13px; }
  .fin .sec-hd.tight { margin: 20px 0 6px; }
  .fin .chg-filters {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 0 22px 14px;
  }
  .fin .cell-note {
    font-style: normal; display: block; font-size: 10.5px; color: var(--ink-3); margin-top: 1px;
  }
  .fin .tbl td.owed { color: var(--late); font-weight: 600; }
`
