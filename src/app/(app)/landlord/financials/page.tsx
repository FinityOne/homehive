'use client'

/**
 * Financials — the overview.
 *
 * ── The fault this version fixes ───────────────────────────────────────────
 *
 * The last one carried thirteen blocks: a pulse, eleven signals, six tiles, a
 * trend chart, a rate chart, an aging chart, a payment-behaviour card, a
 * thirteen-week forecast, an action list, a look-ahead strip, a property
 * league table, an expiring-lease list and a footnote. Every one of them was
 * worth having. Together they were still a wall — just a better-looking one
 * than the wall before it. A landlord arriving to ask *is anything wrong*
 * should not have to read a page to find out.
 *
 * So this screen now holds **five things and stops**:
 *
 *   1. **The pulse** — one sentence on the state of the business, and the one
 *      thing to press.
 *   2. **Six numbers** — each a door, each the answer to a question a landlord
 *      actually arrives with.
 *   3. **The worst three signals** — triage, not a report. The rest are a page.
 *   4. **One chart** — collected against billed, twelve months. The single
 *      most useful picture in the product.
 *   5. **Where to go next** — six destinations, each carrying a live figure,
 *      so choosing where to click is itself informed.
 *
 * Everything else moved somewhere it can be read properly:
 *
 *   • the full signal list      → /financials/insights
 *   • the forecast, the rate
 *     chart and payment
 *     behaviour                 → /financials/cashflow
 *   • aging and the action list → /financials/collections  (already there)
 *   • the property league table
 *     and expiring leases       → /financials/portfolio
 *
 * None of it was deleted and nothing is duplicated — the aging chart and the
 * action list were *already* on collections, and the property table was
 * already on portfolio, so removing them here closed a genuine duplication
 * rather than losing a feature.
 *
 * ── Rules the figures obey ─────────────────────────────────────────────────
 *
 * A standing figure (owed, held, contracted, clearing) is bound to no window,
 * because the thing it describes isn't. A period figure names its period:
 * "October 2026", never "this month". A collection rate is rent against rent,
 * so a late fee never enters the numerator. "Owed" always means shortfall
 * **plus** the fee assessed on it. And a delta is only ever drawn between
 * *completed* months — nothing snapshots a portfolio, so "arrears up 8% this
 * week" is a number this product cannot honestly produce and never shows.
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { fmtCurrency } from '@/lib/payments'
import { useMoney } from '@/lib/useMoney'
import { buildDashboard } from '@/lib/financialsDashboard'
import { signals, pulse } from '@/lib/financialsSignals'
import { forecast } from '@/lib/financialsForecast'
import { leaseHref, planHref } from '@/lib/financialsTree'
import { monthKeyOf, monthLabel } from '@/lib/financialsMonth'
import MoneyHub from '@/components/finance/MoneyHub'
import Signals from '@/components/finance/Signals'
import Glyph, { GLYPH_CSS, type GlyphName } from '@/components/finance/Glyph'
import CommandPalette, { usePaletteShortcut } from '@/components/finance/CommandPalette'
import { TrendBars, Meter, VIZ_CSS } from '@/components/finance/Charts'
import { FINANCE_THEME } from '@/lib/financeTheme'

/** How many signals the landing screen shows before deferring to Insights. */
const SIGNALS_SHOWN = 3

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
            {/* ══ 1. THE PULSE ══
                Tone is a left edge and a faint wash, never a saturated banner:
                one late tenant should not make a portfolio feel like an
                emergency. */}
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

            {/* ══ 2. SIX NUMBERS, EACH A DOOR ══ */}
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
              </Link>

              <Link href="/landlord/financials/cashflow" className="kpi">
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
              </Link>

              <div className="kpi">
                <div className="kpi-label">Deposits held</div>
                <div className="kpi-value">{fmtCurrency(d.depositsHeld)}</div>
                <div className="kpi-meta">
                  {d.depositsHeld > 0 ? 'returnable at move-out' : 'none on file'}
                </div>
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

            {/* ══ 3. THE WORST THREE SIGNALS ══ */}
            <Signals
              signals={sigs}
              limit={SIGNALS_SHOWN}
              moreHref="/landlord/financials/insights"
            />

            {/* ══ 4. ONE CHART ══
                The rate line that used to sit under this moved to Cash flow,
                where it belongs beside the behaviour it is explained by. */}
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
                <span className="card-note">click a month to open it</span>
              </div>
              <TrendBars
                points={d.trend}
                selected={thisMonth}
                onSelect={key => router.push(`/landlord/financials/schedule?month=${key}`)}
              />
            </section>

            {/* ══ 5. WHERE TO GO NEXT ══
                Not a nav menu — each card carries a live figure, so choosing
                where to click is itself informed. This is the part that lets
                the screen above it stay short. */}
            <div className="sec-hd">
              <h2 className="sec-title">Go deeper</h2>
              <span className="sec-note">every number above has a page behind it</span>
            </div>
            <div className="dests">
              <Dest
                icon="alert"
                tone={d.owed > 0 ? 'critical' : 'good'}
                title="Collections"
                stat={d.owed > 0 ? fmtCurrency(d.owed) : 'All clear'}
                line={d.owed > 0
                  ? `${d.owedPayers} behind, aged into buckets, with who to call first`
                  : 'Nobody is behind. Late fees and write-offs live here too.'}
                href="/landlord/financials/collections"
              />
              <Dest
                icon="wallet"
                title="Cash flow"
                stat={cash.expected > 0 ? fmtCurrency(cash.expected) : '—'}
                line={`Projected over ${cash.weeks.length} weeks, the collection rate, and how reliably each tenant pays`}
                href="/landlord/financials/cashflow"
              />
              <Dest
                icon="bolt"
                tone={sigs.some(s => s.severity === 'critical') ? 'critical'
                  : sigs.some(s => s.severity === 'warning') ? 'warning' : undefined}
                title="Insights"
                stat={`${sigs.length}`}
                line="Everything the figures add up to, ranked by what it costs to ignore"
                href="/landlord/financials/insights"
              />
              <Dest
                icon="building"
                title="Portfolio"
                stat={`${d.tree.propertyCount} / ${d.tree.leaseCount}`}
                line="Property → lease → plan → tenant, with leases ending soon"
                href="/landlord/financials/portfolio"
              />
              <Dest
                icon="calendar"
                title="Schedule"
                stat={d.upcoming[1]
                  ? fmtCurrency(d.upcoming[1].expected)
                  : fmtCurrency(d.next30.amount)}
                line={`What falls due month by month — ${
                  d.upcoming[1] ? `${monthLabel(d.upcoming[1].key, true)} next` : 'lease by lease'}`}
                href="/landlord/financials/schedule"
              />
              <Dest
                icon="check"
                title="Payments"
                stat={fmtCurrency(d.received12)}
                line="Every payment that arrived, cleared, is clearing, or bounced"
                href="/landlord/financials/payments"
              />
            </div>
          </>
        )}
      </div>

      <CommandPalette tree={d.tree} open={find} onClose={() => setFind(false)} />
    </>
  )
}

/**
 * One destination.
 *
 * A figure, not just a label — the whole reason this replaces the sections it
 * replaces is that a landlord can see what is behind a door before opening it.
 */
function Dest({
  icon, title, stat, line, href, tone,
}: {
  icon: GlyphName
  title: string
  stat: string
  line: string
  href: string
  tone?: 'critical' | 'warning' | 'good'
}) {
  return (
    <Link className="dest" href={href}>
      <span className={`gl-plate${tone ? ' ' + tone : ''}`}>
        <Glyph name={icon} size={15} />
      </span>
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

  .fin .kpi-value small { font-size: 0.5em; font-weight: 500; color: var(--ink-3); margin-left: 2px; }
  .fin .card-title { display: flex; align-items: center; gap: 8px; }
  .fin .card-title .gl { color: var(--ink-3); }

  /* ── Destinations ─────────────────────────────────────────────────────────
     Three across on a desktop, one on a phone. Deliberately airier than the
     KPI tiles above: these are a decision about where to go, not a figure to
     read, and crowding them would reproduce the problem this section exists
     to solve. */
  .fin .dests {
    display: grid; gap: 12px; margin-bottom: 20px;
    grid-template-columns: repeat(auto-fit, minmax(278px, 1fr));
  }
  .fin .dest {
    display: flex; align-items: flex-start; gap: 13px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
    padding: 17px 18px; text-decoration: none; color: inherit; min-width: 0;
    transition: border-color 0.15s var(--ease), box-shadow 0.15s var(--ease);
  }
  .fin .dest:hover { border-color: #d9d9de; box-shadow: var(--lift-1); }
  .fin .dest .row-chev { margin-top: 10px; }
  .fin .dest-main { flex: 1; min-width: 0; }
  .fin .dest-title {
    display: block; font-size: 11.5px; font-weight: 500; text-transform: uppercase;
    letter-spacing: 0.045em; color: var(--ink-3);
  }
  .fin .dest-stat {
    display: block; font-size: 21px; font-weight: 600; letter-spacing: -0.022em;
    margin-top: 5px; font-variant-numeric: tabular-nums; line-height: 1.15;
  }
  .fin .dest-line {
    display: block; font-size: 12px; color: var(--ink-2); line-height: 1.5;
    margin-top: 6px; letter-spacing: -0.005em;
  }

  @media (max-width: 700px) {
    .fin .pulse { padding: 18px 17px; }
    .fin .pulse-head { font-size: 22px; }
    .fin .pulse-act { width: 100%; }
    .fin .pulse-act .btn-primary { width: 100%; }
    .fin .alarm-bar { flex-direction: column; align-items: flex-start; gap: 8px; }
    .fin .sig-body { padding-left: 14px; }
    .fin .dest { padding: 15px; }
    .fin .dest-stat { font-size: 19px; }
  }
`
