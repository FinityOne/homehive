'use client'

/**
 * Financials — the overview.
 *
 * ── What this page used to be ──────────────────────────────────────────────
 *
 * One scrolling page that *was* the whole money area: four standing tiles, then
 * missed payments grouped by payer, then the late-fee ledger, then a six-month
 * look-ahead, then one named month broken down lease-by-lease-by-payer, then
 * the payments log. Every section earns its place somewhere. All of them on the
 * screen a landlord lands on meant the first question — *is anything wrong?* —
 * took about two hundred rows of scanning to answer.
 *
 * ── What it is now ─────────────────────────────────────────────────────────
 *
 * It reads top to bottom as an argument, not a report:
 *
 *   0. **The pulse.** One sentence on the state of the business and the single
 *      thing to press. A landlord who reads nothing else still leaves knowing
 *      where they stand.
 *   1. **What it means.** The judgement layer — ranked claims with the evidence
 *      folded underneath. This is the part the old page left entirely to the
 *      human: a 78% collection rate is not information until you know it was
 *      96% for six months and that two tenants at one address are all of the
 *      drop.
 *   2. **The figures**, with shape. Six tiles, each a door, several carrying a
 *      sparkline so a number says where you came from as well as where you are.
 *   3. **Am I being paid?** Billed against collected, then the rate as its own
 *      chart on the same months.
 *   4. **What is wrong, and how old?** Aging, because age decides the action.
 *   5. **When does the money actually arrive?** The cash projection — each
 *      charge shifted by how late that payer usually is.
 *   6. **Who, where, and what is about to end.**
 *
 * Nothing here is a table you work in. Every tile and card is a door into a
 * page that *is* one, and those pages carry the filters, the sorting and the
 * export. That is the trade: this screen answers "is anything wrong", and a
 * detail page answers "what exactly, and what do I do about it".
 *
 * ── Rules the figures obey ─────────────────────────────────────────────────
 *
 * A standing figure (owed, held, contracted, clearing) is bound to no window,
 * because the thing it describes isn't — a debt does not expire when a
 * reporting period rolls over. A period figure names its period in the label:
 * "October 2026", never "this month". A collection rate is rent against rent,
 * so a late fee never enters the numerator. "Owed" always means shortfall
 * **plus** the fee assessed on it. And a delta is only ever drawn between
 * *completed* months — nothing snapshots a portfolio, so "arrears up 8% this
 * week" is a number this product cannot honestly produce and therefore never
 * shows. All of that is enforced in `src/lib/financialsDashboard.ts` and
 * `src/lib/financialsSignals.ts`; this file only draws it.
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { fmtCurrency, fmtDate } from '@/lib/payments'
import { useMoney } from '@/lib/useMoney'
import { buildDashboard, type TodoItem } from '@/lib/financialsDashboard'
import { signals, pulse } from '@/lib/financialsSignals'
import { forecast } from '@/lib/financialsForecast'
import { leaseHref, planHref } from '@/lib/financialsTree'
import { monthKeyOf } from '@/lib/financialsMonth'
import MoneyHub from '@/components/finance/MoneyHub'
import Signals from '@/components/finance/Signals'
import Glyph, { GLYPH_CSS } from '@/components/finance/Glyph'
import CommandPalette, { usePaletteShortcut } from '@/components/finance/CommandPalette'
import {
  TrendBars, RateLine, AgingChart, MethodMix, AheadStrip, ForecastBars,
  Meter, Sparkline, Delta, VIZ_CSS,
} from '@/components/finance/Charts'
import { FINANCE_THEME } from '@/lib/financeTheme'

export default function FinancialsOverview({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; lease?: string }>
}) {
  const { plan: planParam, lease: leaseParam } = use(searchParams)
  const router = useRouter()
  const { plans, waivers, bounced, loading } = useMoney()
  const [find, setFind] = useState(false)
  usePaletteShortcut(useCallback(() => setFind(true), []))

  useEffect(() => { document.title = 'Financials — Landlord | HomeHive' }, [])

  /**
   * The ledger used to open *inside* this page at `?plan=<id>`, and that link
   * is in sent email, in the dashboard, on the lease page and in two redirect
   * stubs. It is a route of its own now, so those links are forwarded rather
   * than broken — a landlord clicking a six-month-old rent receipt still lands
   * on the right ledger.
   */
  useEffect(() => {
    if (planParam) router.replace(planHref(planParam))
    else if (leaseParam) router.replace(leaseHref(leaseParam))
  }, [planParam, leaseParam, router])

  const d = useMemo(() => buildDashboard(plans, waivers), [plans, waivers])
  const sigs = useMemo(() => signals(d), [d])
  const p = useMemo(() => pulse(d, sigs), [d, sigs])
  const cash = useMemo(() => forecast(d.charges), [d.charges])
  const thisMonth = monthKeyOf(new Date())

  // Shape for the tiles: the history behind each headline figure. Completed
  // months only — a month still running would draw a cliff at the right edge
  // every time a landlord looked before the rent came in.
  const done = useMemo(() => d.trend.filter(t => t.position === 'past'), [d.trend])

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
      <style>{FINANCE_THEME}{GLYPH_CSS}{VIZ_CSS}{CSS}</style>
      <div className="fin fin-wrap">
        <MoneyHub
          tab="overview"
          title="Financials"
          sub={loading
            ? 'Loading your portfolio…'
            : d.empty
              ? 'Set up a payment plan to start tracking rent.'
              : `${d.tree.activeLeaseCount} active lease${d.tree.activeLeaseCount !== 1 ? 's' : ''} across ${
                  d.tree.propertyCount} propert${d.tree.propertyCount !== 1 ? 'ies' : 'y'} · ${
                  fmtCurrency(d.monthly)}/mo contracted`}
          action={{ label: 'New payment plan', href: '/landlord/financials/new' }}
          secondary={d.empty ? undefined : { label: 'Statement', href: '/landlord/financials/statement' }}
          onFind={d.empty ? undefined : () => setFind(true)}
          alarmCount={bounced}
          dueCount={d.owedPayers}
        />

        {loading ? (
          <>
            <div className="skeleton" style={{ height: 112, marginBottom: 18 }} />
            <div className="kpis">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="kpi"><div className="skeleton" style={{ height: 62 }} /></div>
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
            {/* ══ 0. THE PULSE ══
                The page's thesis, before any figure. Tone is a left edge and a
                faint wash, never a saturated banner: one late tenant should
                not make a portfolio feel like an emergency. */}
            <section className={`pulse rise ${p.tone}`}>
              <div className="pulse-main">
                <div className="pulse-eyebrow">
                  <Glyph
                    name={p.tone === 'critical' ? 'alert' : p.tone === 'warning' ? 'clock' : 'check'}
                    size={13}
                  />
                  {d.thisMonth.label} · as it stands today
                </div>
                <h2 className="pulse-head">{p.headline}</h2>
                <p className="pulse-line">{p.line}</p>
              </div>
              {p.action && (
                <div className="pulse-act">
                  <Link className="btn-primary" href={p.action.href}>
                    {p.action.label}
                    <Glyph name="arrow-right" size={15} />
                  </Link>
                </div>
              )}
            </section>

            {/* ══ 1. WHAT IT MEANS ══ */}
            <Signals signals={sigs} />

            {/* ══ 2. THE FIGURES ══
                Arrears leads and is twice the width, because "what am I owed"
                is not one of six equal questions. */}
            <div className="kpis">
              <Link
                href="/landlord/financials/collections"
                className={`kpi lead${d.owed > 0 ? ' hot' : ''}`}
              >
                <div className="kpi-label">Overdue right now</div>
                <div className={`kpi-value ${d.owed > 0 ? 'bad' : 'good'}`}>
                  {d.owed > 0 ? fmtCurrency(d.owed) : 'All clear'}
                </div>
                <div className="kpi-meta">
                  {d.owed > 0
                    ? `${d.owedPayers} ${d.owedPayers === 1 ? 'person' : 'people'} · ${
                        d.owedCharges} charge${d.owedCharges !== 1 ? 's' : ''} missed · worst ${
                        d.worstDaysLate} day${d.worstDaysLate !== 1 ? 's' : ''} late`
                    : 'Every charge that has come due has been settled'}
                </div>
                {d.owed > 0 && d.arrears.lateFees > 0 && (
                  <div className="kpi-foot">
                    {fmtCurrency(d.arrears.shortfall)} of rent and charges
                    {' '}+ {fmtCurrency(d.arrears.lateFees)} of late fees
                  </div>
                )}
                <span className="kpi-go">Work the collections list →</span>
              </Link>

              <Link href={`/landlord/financials/schedule?month=${d.thisMonth.key}`} className="kpi">
                <div className="kpi-label">Collected in {d.thisMonth.label.split(' ')[0]}</div>
                <div className="kpi-value">{fmtCurrency(d.thisMonth.collected)}</div>
                <div className="kpi-meta">
                  {d.thisMonth.rate !== null
                    ? `${d.thisMonth.rate}% of ${fmtCurrency(d.thisMonth.billed)} billed`
                    : 'nothing billed this month'}
                </div>
                <Meter pct={d.thisMonth.rate} />
                {/* No delta here on purpose: the month is still running, and
                    comparing it to a finished one invents a crisis. */}
                <Sparkline values={done.map(t => t.collected)} tone="good" />
              </Link>

              <Link href="/landlord/financials/schedule" className="kpi">
                <div className="kpi-label">Landing in 30 days</div>
                <div className="kpi-value">
                  {d.next30.amount > 0 ? fmtCurrency(d.next30.amount) : 'Nothing'}
                </div>
                <div className="kpi-meta">
                  {d.next30.count > 0
                    ? `${d.next30.count} charge${d.next30.count !== 1 ? 's' : ''} coming due`
                    : 'nothing falls due in the next month'}
                </div>
                {d.clearing.amount > 0 && (
                  <div className="kpi-foot">
                    {fmtCurrency(d.clearing.amount)} already sent and clearing
                  </div>
                )}
              </Link>

              <Link href="/landlord/financials/portfolio" className="kpi">
                <div className="kpi-label">Contracted rent</div>
                <div className="kpi-value">{fmtCurrency(d.monthly)}<small>/mo</small></div>
                <div className="kpi-meta">
                  {d.tree.activeLeaseCount} active lease{d.tree.activeLeaseCount !== 1 ? 's' : ''} ·
                  {' '}{d.tree.payers.filter(x => x.status === 'active').length} payers
                </div>
                {d.utilitiesMonthly > 0 && (
                  <div className="kpi-foot">
                    includes {fmtCurrency(d.utilitiesMonthly)} of declared utilities
                  </div>
                )}
              </Link>

              <Link
                href="/landlord/financials/collections#fees"
                className={`kpi${d.fees.total > 0 ? ' warm' : ''}`}
              >
                <div className="kpi-label">Late fees owed</div>
                <div className={`kpi-value ${d.fees.total > 0 ? 'warn' : 'good'}`}>
                  {d.fees.total > 0 ? fmtCurrency(d.fees.total) : 'None'}
                </div>
                <div className="kpi-meta">
                  {d.fees.total > 0
                    ? `${d.fees.feeCount} fee${d.fees.feeCount !== 1 ? 's' : ''} across ${
                        d.fees.payerCount} ${d.fees.payerCount === 1 ? 'person' : 'people'}`
                    : 'nothing assessed and unpaid'}
                </div>
                {d.fees.accruing > 0 && (
                  <div className="kpi-foot">
                    {fmtCurrency(d.fees.accruing)} still growing
                    {d.fees.perDay > 0 && <> · {fmtCurrency(d.fees.perDay)}/day</>}
                  </div>
                )}
              </Link>

              <div className="kpi">
                <div className="kpi-label">Deposits held</div>
                <div className="kpi-value">{fmtCurrency(d.depositsHeld)}</div>
                <div className="kpi-meta">
                  {d.depositsHeld > 0 ? 'returnable at move-out' : 'none on file'}
                </div>
                {d.tree.splitLeaseCount > 0 && (
                  <div className="kpi-foot">
                    {d.tree.splitLeaseCount} lease{d.tree.splitLeaseCount !== 1 ? 's' : ''} bill
                    {d.tree.splitLeaseCount === 1 ? 's' : ''} through more than one plan
                  </div>
                )}
              </div>
            </div>

            {/* A reminder that bounced looks exactly like a tenant ignoring
                you, and the landlord is standing here, not in the email log. */}
            {bounced > 0 && (
              <Link className="alarm-bar" href="/landlord/reminders?state=problem">
                <span>
                  <strong>{bounced} email{bounced !== 1 ? 's' : ''} to tenants never arrived.</strong>{' '}
                  Bounced, refused, or marked as spam — so nobody read them.
                </span>
                <span className="go">Check them →</span>
              </Link>
            )}

            {/* ══ 3. AM I BEING PAID ══
                Money is bars; the rate is its own chart underneath on the same
                months. Two y-scales on one frame is the most misread chart
                there is — it lets the author choose where the lines cross. */}
            <section className="card">
              <div className="card-hd">
                <div>
                  <h2 className="card-title">
                    <Glyph name="trend-up" size={15} />
                    Billed against collected
                  </h2>
                  <p className="muted sm">
                    {d.rate12 !== null
                      ? <>Over the last year you collected <b>{fmtCurrency(d.received12)}</b> of{' '}
                         <b>{fmtCurrency(d.billed12)}</b> billed — {d.rate12}%.</>
                      : 'Nothing has been billed yet.'}
                  </p>
                </div>
                {/* The only honest comparison available: the last *finished*
                    month against the median of the finished months before it. */}
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
              <TrendBars
                points={d.trend}
                selected={thisMonth}
                onSelect={key => router.push(`/landlord/financials/schedule?month=${key}`)}
              />
              <div className="rate-wrap">
                <div className="sec-hd">
                  <h3 className="sec-title sm">Collection rate</h3>
                </div>
                <RateLine points={d.trend} />
              </div>
            </section>

            <div className="cards two">
              {/* ══ 4. WHAT IS WRONG, AND HOW OLD ══ */}
              <section className="card">
                <div className="card-hd">
                  <div>
                    <h2 className="card-title">
                      <Glyph name="alert" size={15} />
                      Arrears by age
                    </h2>
                    <p className="muted sm">
                      {d.owed > 0
                        ? 'How old a debt is decides what to do about it.'
                        : 'Nothing is overdue anywhere in the portfolio.'}
                    </p>
                  </div>
                  {d.owed > 0 && <span className="card-note">{fmtCurrency(d.owed)} total</span>}
                </div>
                {d.owed > 0 ? (
                  <>
                    <AgingChart
                      buckets={d.aging}
                      onSelect={id => router.push(`/landlord/financials/collections?age=${id}`)}
                    />
                    <div className="card-ft">
                      <span>
                        A debt past sixty days is rarely collected without a formal notice — which
                        is why it is worth seeing separately from one that is a week old.
                      </span>
                      <Link className="btn-quiet sm" href="/landlord/financials/collections">
                        Open collections →
                      </Link>
                    </div>
                  </>
                ) : (
                  <p className="muted">
                    Every charge that has come due has been paid. Rent that is not due yet is in
                    the look-ahead, not here.
                  </p>
                )}
              </section>

              {/* ══ DO THEY PAY ON TIME ══
                  The metric that predicts next month rather than describing
                  last one. A tenant who settles three weeks late vanishes from
                  every arrears figure the moment the money lands. */}
              <section className="card">
                <div className="card-hd">
                  <div>
                    <h2 className="card-title">
                      <Glyph name="clock" size={15} />
                      How your tenants pay
                    </h2>
                    <p className="muted sm">
                      Over the last {d.behaviour.months} months, across{' '}
                      {d.behaviour.settled} settled charge{d.behaviour.settled !== 1 ? 's' : ''}.
                    </p>
                  </div>
                </div>

                {d.behaviour.settled === 0 ? (
                  <p className="muted">Nothing has been paid yet, so there is no pattern to read.</p>
                ) : (
                  <>
                    <div className="beh">
                      <div className="beh-fig">
                        <div className="kpi-label">Paid on time</div>
                        <div className={`kpi-value ${
                          (d.behaviour.rate ?? 0) >= 90 ? 'good'
                          : (d.behaviour.rate ?? 0) >= 70 ? 'warn' : 'bad'}`}>
                          {d.behaviour.rate}%
                        </div>
                        <Meter pct={d.behaviour.rate} target={90} />
                        <div className="kpi-meta">
                          {d.behaviour.onTime} on time · {d.behaviour.late} late
                        </div>
                      </div>
                      <div className="beh-fig">
                        <div className="kpi-label">When they are late</div>
                        <div className="kpi-value">{d.behaviour.avgDaysLate}<small>d</small></div>
                        <div className="kpi-meta">
                          average · worst was {d.behaviour.maxDaysLate} day
                          {d.behaviour.maxDaysLate !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>

                    <div className="sec-hd tight">
                      <h3 className="sec-title sm">How the money arrives</h3>
                      <span className="sec-note">bank transfers spend days in flight</span>
                    </div>
                    <MethodMix slices={d.methods} />

                    <div className="card-ft">
                      <span>
                        A tenancy that pays three weeks late every month is not in arrears and is
                        still a problem — this is where you would see it.
                      </span>
                      <Link className="btn-quiet sm" href="/landlord/financials/payments">
                        Payment log →
                      </Link>
                    </div>
                  </>
                )}
              </section>
            </div>

            {/* ══ 5. WHEN THE MONEY ACTUALLY ARRIVES ══
                The schedule says rent is due on the 1st. That is a contract,
                not a prediction — and a third of settled charges on this
                product arrive after their due date, from tenants who do it
                every month. */}
            {!cash.empty && (
              <section className="card">
                <div className="card-hd">
                  <div>
                    <h2 className="card-title">
                      <Glyph name="wallet" size={15} />
                      When the money should arrive
                    </h2>
                    <p className="muted sm">
                      The next {cash.weeks.length} weeks, with each charge shifted by how late that
                      payer usually is. <b>{fmtCurrency(cash.expected)}</b> expected
                      {cash.slippage > 0 && <>, and {fmtCurrency(cash.slippage)} of contracted rent
                        projected to land after this window</>}.
                    </p>
                  </div>
                  <span className="card-note">
                    {cash.modelledPayers > 0
                      ? `${cash.modelledPayers} payer${cash.modelledPayers !== 1 ? 's' : ''} modelled from history`
                      : 'everyone taken at their due date'}
                  </span>
                </div>
                <ForecastBars weeks={cash.weeks} overdueUnscheduled={cash.overdueUnscheduled} />
              </section>
            )}

            {/* ══ 6. WHO TO CALL TODAY ══ */}
            {d.todo.length > 0 && (
              <section className="card">
                <div className="card-hd">
                  <div>
                    <h2 className="card-title">
                      <Glyph name="users" size={15} />
                      Needs you today
                      <span className="panel-count">{d.arrears.payerCount}</span>
                    </h2>
                    <p className="muted sm">
                      The people behind, worst first. A person, not a charge — three missed months
                      from one tenant is one phone call.
                    </p>
                  </div>
                  <span className="card-note">{fmtCurrency(d.owed)} owed</span>
                </div>
                <div className="todo">
                  {d.todo.map(t => <TodoRow key={t.key} item={t} />)}
                </div>
                {d.arrears.payerCount > d.todo.length && (
                  <div className="card-ft">
                    <span>
                      {d.arrears.payerCount - d.todo.length} more{' '}
                      {d.arrears.payerCount - d.todo.length === 1 ? 'person is' : 'people are'} behind.
                    </span>
                    <Link className="btn-secondary sm" href="/landlord/financials/collections">
                      See all {d.arrears.payerCount}
                    </Link>
                  </div>
                )}
              </section>
            )}

            {/* ══ 7. WHAT IS CONTRACTED AHEAD ══ */}
            <section className="card">
              <div className="card-hd">
                <div>
                  <h2 className="card-title">
                    <Glyph name="calendar" size={15} />
                    The months ahead
                  </h2>
                  <p className="muted sm">
                    What the leases say is due — contracted, so this is known rather than forecast.
                    A month a tenant has already paid into has a shorter bar.
                  </p>
                </div>
                <span className="card-note">click a month to open it</span>
              </div>
              <AheadStrip
                months={d.upcoming}
                thisMonth={thisMonth}
                onSelect={key => router.push(`/landlord/financials/schedule?month=${key}`)}
              />
            </section>

            <div className="cards two">
              {/* ══ 8. WHERE THE MONEY COMES FROM ══ */}
              <section className="card">
                <div className="card-hd">
                  <div>
                    <h2 className="card-title">
                      <Glyph name="building" size={15} />
                      By property
                    </h2>
                    <p className="muted sm">
                      Collection over each building&rsquo;s whole contracted term.
                    </p>
                  </div>
                  <span className="card-note">
                    {d.properties.length} propert{d.properties.length !== 1 ? 'ies' : 'y'}
                  </span>
                </div>
                <div className="plist">
                  {d.properties.slice(0, 6).map(x => (
                    <Link
                      key={x.propertyId}
                      className="prow"
                      href={`/landlord/financials/portfolio#p-${x.propertyId}`}
                    >
                      <span className="prow-main">
                        <b>{x.propertyName}</b>
                        <em>
                          {x.leases.length} lease{x.leases.length !== 1 ? 's' : ''} ·
                          {' '}{x.payerCount} payer{x.payerCount !== 1 ? 's' : ''} ·
                          {' '}{fmtCurrency(x.monthly)}/mo
                        </em>
                      </span>
                      <span className="prow-rate">
                        <b>{x.totals.rate !== null ? `${x.totals.rate}%` : '—'}</b>
                        <Meter pct={x.totals.rate} />
                      </span>
                      <span className="prow-owed">
                        <b className={x.owed > 0 ? 'owed' : ''}>
                          {x.owed > 0 ? fmtCurrency(x.owed) : '—'}
                        </b>
                        <em>{x.owed > 0 ? 'overdue' : 'clear'}</em>
                      </span>
                      <span className="row-chev" aria-hidden="true" />
                    </Link>
                  ))}
                </div>
                {d.properties.length > 6 && (
                  <div className="card-ft">
                    <span>{d.properties.length - 6} more.</span>
                    <Link className="btn-quiet sm" href="/landlord/financials/portfolio">
                      Open the portfolio →
                    </Link>
                  </div>
                )}
              </section>

              {/* ══ 9. WHAT IS ABOUT TO END ══
                  A lease inside its last two months is one a manager is already
                  working: renewal, deposit, move-out inspection. It belongs on
                  the money screen because all three are money. */}
              <section className="card">
                <div className="card-hd">
                  <div>
                    <h2 className="card-title">
                      <Glyph name="shield" size={15} />
                      Ending soon
                    </h2>
                    <p className="muted sm">
                      Leases inside their last two months — renewal, deposit return, move-out.
                    </p>
                  </div>
                  {d.expiring.length > 0 && (
                    <span className="card-note">
                      {d.expiring.length} lease{d.expiring.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {d.expiring.length === 0 ? (
                  <p className="muted">
                    Nothing ends in the next sixty days. Terms and renewals live on the{' '}
                    <Link className="lnk" href="/landlord/renewals">renewals</Link> page.
                  </p>
                ) : (
                  <>
                    <div className="plist">
                      {d.expiring.slice(0, 5).map(l => (
                        <Link key={l.key} className="prow" href={leaseHref(l.key)}>
                          <span className="prow-main">
                            <b>
                              {l.propertyName}
                              {l.daysLeft !== null && l.daysLeft <= 14 && (
                                <span className="pill warn">{l.daysLeft}d left</span>
                              )}
                              {l.owed > 0 && (
                                <span
                                  className="pill bad"
                                  title="Settle this before the deposit goes back — afterwards there is usually no way to collect it"
                                >
                                  {fmtCurrency(l.owed)} owed
                                </span>
                              )}
                            </b>
                            <em>
                              {l.label} · ends {fmtDate(l.termEnd ?? '')} ·
                              {' '}{l.activePayers} tenant{l.activePayers !== 1 ? 's' : ''}
                            </em>
                          </span>
                          <span className="prow-owed">
                            <b>{fmtCurrency(l.depositsHeld)}</b>
                            <em>deposit held</em>
                          </span>
                          <span className="row-chev" aria-hidden="true" />
                        </Link>
                      ))}
                    </div>
                    <div className="card-ft">
                      <span>
                        Settle arrears before a deposit goes back — it is the last leverage you have.
                      </span>
                      <Link className="btn-quiet sm" href="/landlord/renewals">Renewals →</Link>
                    </div>
                  </>
                )}
              </section>
            </div>

            {/* The one structural fact worth saying out loud on the overview:
                it is the thing landlords could not previously see at all. */}
            {d.tree.splitLeaseCount > 0 && (
              <Link className="note-bar" href="/landlord/financials/portfolio">
                <span>
                  <strong>
                    {d.tree.splitLeaseCount} lease{d.tree.splitLeaseCount !== 1 ? 's' : ''} bill
                    {d.tree.splitLeaseCount === 1 ? 's' : ''} rent through more than one payment plan.
                  </strong>{' '}
                  The portfolio view shows them as one tenancy with its plans underneath, rather
                  than as unrelated rows.
                </span>
                <span className="go">See the structure →</span>
              </Link>
            )}
          </>
        )}
      </div>

      <CommandPalette tree={d.tree} open={find} onClose={() => setFind(false)} />
    </>
  )
}

/** One person who is behind, as the overview shows them. */
function TodoRow({ item: t }: { item: TodoItem }) {
  return (
    <Link className={`todo-row tone-${t.tone}`} href={`${leaseHref(t.leaseKey)}?payer=${t.key.split(':')[1]}`}>
      <span className="todo-main">
        <b>
          {t.name}
          <span className={`pill ${t.tone === 'severe' ? 'bad' : t.tone}`}>{t.maxDaysLate}d late</span>
          {t.chased > 0
            ? <span className="pill plain">chased {t.chased}×</span>
            : <span className="pill warn" title="No reminder has been sent about these charges">never asked</span>}
        </b>
        <em>
          {t.propertyName} · {t.chargeCount} charge{t.chargeCount !== 1 ? 's' : ''} ·
          {' '}oldest {fmtDate(t.oldestDue)}
          {t.email && <> · {t.email}</>}
        </em>
      </span>
      <span className="todo-fig">
        <b>{fmtCurrency(t.amount)}</b>
        <em>owed</em>
      </span>
      <span className="row-chev" aria-hidden="true" />
    </Link>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');

  .fin .kpi-value small { font-size: 0.5em; font-weight: 500; color: var(--ink-3); margin-left: 2px; }
  .fin .sec-title.sm { font-size: 13px; }
  .fin .sec-hd.tight { margin: 20px 0 12px; }
  .fin .rate-wrap { margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--line-2); }
  /* A section heading carries its glyph on the baseline of the words. */
  .fin .card-title { display: flex; align-items: center; gap: 8px; }
  .fin .card-title .gl { color: var(--ink-3); }
  .fin .card-note.cmp { display: inline-flex; align-items: center; gap: 7px; }
  .fin .card-note.cmp b { color: var(--ink); font-weight: 600; }

  /* ── Payment behaviour ── */
  .fin .beh { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  .fin .beh-fig { min-width: 0; }

  /* ── The action list ── */
  .fin .todo { display: flex; flex-direction: column; }
  .fin .todo-row {
    display: flex; align-items: center; gap: 14px; padding: 12px 2px;
    border-top: 1px solid var(--line-2); text-decoration: none; color: inherit;
  }
  .fin .todo-row:first-child { border-top: none; }
  .fin .todo-row:hover { background: var(--surface-2); }
  .fin .todo-main { flex: 1; min-width: 0; }
  .fin .todo-main b {
    font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 8px;
    flex-wrap: wrap; letter-spacing: -0.01em;
  }
  .fin .todo-main em {
    font-style: normal; display: block; font-size: 11.5px; color: var(--ink-3);
    margin-top: 2px; letter-spacing: -0.005em;
  }
  .fin .todo-fig { text-align: right; flex-shrink: 0; }
  .fin .todo-fig b {
    font-size: 15px; font-weight: 600; display: block; color: var(--late);
    font-variant-numeric: tabular-nums;
  }
  .fin .todo-fig em { font-style: normal; font-size: 11px; color: var(--ink-3); }

  /* ── Property / lease lists ── */
  .fin .plist { display: flex; flex-direction: column; }
  .fin .prow {
    display: flex; align-items: center; gap: 16px; padding: 12px 2px;
    border-top: 1px solid var(--line-2); text-decoration: none; color: inherit;
  }
  .fin .prow:first-child { border-top: none; }
  .fin .prow:hover { background: var(--surface-2); }
  .fin .prow-main { flex: 1; min-width: 0; }
  .fin .prow-main b {
    font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 8px;
    flex-wrap: wrap; letter-spacing: -0.01em;
  }
  .fin .prow-main em {
    font-style: normal; display: block; font-size: 11.5px; color: var(--ink-3); margin-top: 2px;
  }
  .fin .prow-rate { width: 74px; flex-shrink: 0; text-align: right; }
  .fin .prow-rate b { font-size: 13.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .fin .prow-owed { width: 92px; flex-shrink: 0; text-align: right; }
  .fin .prow-owed b { font-size: 13.5px; font-weight: 600; display: block; font-variant-numeric: tabular-nums; }
  .fin .prow-owed b.owed { color: var(--late); }
  .fin .prow-owed em { font-style: normal; font-size: 11px; color: var(--ink-3); }

  /* A note that leads somewhere, in the shape of the alarm bar but calm. */
  .fin .note-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 14px;
    background: var(--surface-2); border: 1px solid var(--line); border-radius: 14px;
    padding: 13px 17px; margin-bottom: 18px; text-decoration: none;
    font-size: 13.5px; color: var(--ink-2); line-height: 1.55; letter-spacing: -0.01em;
  }
  .fin .note-bar strong { color: var(--ink); }
  .fin .note-bar:hover { border-color: var(--accent); }
  .fin .note-bar .go { color: var(--accent); font-weight: 500; white-space: nowrap; }

  @media (max-width: 700px) {
    .fin .beh { grid-template-columns: 1fr; gap: 14px; }
    .fin .prow-rate { display: none; }
    .fin .prow-owed { width: 78px; }
    .fin .pulse { padding: 18px 17px; }
    .fin .pulse-head { font-size: 22px; }
    .fin .pulse-act { width: 100%; }
    .fin .pulse-act .btn-primary { width: 100%; }
    .fin .note-bar, .fin .alarm-bar { flex-direction: column; align-items: flex-start; gap: 8px; }
    .fin .sig-body { padding-left: 14px; }
  }
`
