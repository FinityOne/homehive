'use client'

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { getCurrentUser, supabase } from '@/lib/supabase'
import { getPlansForOwner, fmtCurrency, fmtDate, type PaymentPlan } from '@/lib/payments'
import {
  buildPortfolio, monthlyTrend, SCOPES, STAGE_LABEL, METHOD_META,
  type Scope, type LeaseSummary, type PropertyGroup, type MethodSlice,
  type SettledPayment,
} from '@/lib/financialsRollup'
import {
  filterPlans, stageCounts, standing, arrears, monthView, upcomingMonths,
  monthKeyOf, monthLabel, shiftMonth, monthsBetween, CHARGE_STATE_META, LEASE_FILTERS,
  type LeaseFilter, type MonthKey, type MonthView, type MonthLease, type UpcomingMonth,
  type Arrears, type Charge,
} from '@/lib/financialsMonth'

const PlanWorkspace = dynamic(() => import('@/components/payments/PlanWorkspace'), { ssr: false })

/**
 * Financials — the one place money lives.
 *
 * The old page answered one question (this month's rent) as a flat list of
 * payment plans. That list is why the page was confusing: a landlord with three
 * leases against one building saw three unrelated rows, no sense of which
 * address they belonged to, and no figure for a lease as a whole — only the
 * current month. "How is this property doing" had no answer on the page at all.
 *
 * So the page is now a ledger you read at whatever altitude you need:
 *
 *   portfolio total → property subtotal → one lease → one payer → one charge
 *
 * Every level is the same columns (billed, collected, outstanding) summed over
 * the same window, so a figure means the same thing wherever you read it, and
 * the levels visibly add up. The window itself is a control — this month is the
 * default, but "lease to date" and "full term" are the questions a manager
 * actually asks when deciding whether a tenancy is working out.
 *
 * Everything expands in place. Opening a property does not navigate; opening a
 * lease row does not navigate; only "Open ledger" does, because that is where
 * money gets edited and it deserves the whole screen.
 *
 * That rollup is now the *bottom* of the page rather than all of it, because
 * reporting is not the landlord's first question. The page reads top to bottom
 * as three different kinds of question:
 *
 *   1. **Right now**, bound to no window at all — who owes me money (across the
 *      whole tenancy, not this month), what lands in the next 30 days, what am
 *      I holding. A debt does not expire when the reporting period changes, so
 *      these figures do not move when it does.
 *   2. **A named month** — "October 2026", never "this month", with the
 *      neighbours one click away in both directions. Future months work
 *      identically to past ones, which is the only way to answer "what is
 *      coming in".
 *   3. **A window**, for accounting: the scope toggle and the property → lease
 *      drill-down, in their own section at the bottom.
 *
 * Active leases are the default throughout. A landlord with three years of
 * tenancies behind them was reading past every one of them to find the rent
 * they could still collect. Ended leases are a toggle away — and arrears on a
 * hidden lease are still reported, so filtering can never hide money.
 */

type View = 'portfolio' | 'received' | 'charges' | 'activity'
const VIEWS: { id: View; label: string }[] = [
  { id: 'portfolio', label: 'By property' },
  { id: 'received',  label: 'Payments received' },
  { id: 'charges',   label: 'Deposits & charges' },
  { id: 'activity',  label: 'Requests sent' },
]

const TREND_MONTHS = 12

/** How far ahead the look-ahead strip reaches. A year of rent is contracted, so
 *  this is knowable; more than this and the strip stops being scannable. */
const AHEAD_MONTHS = 6

/** One payment request, as the portfolio log returns it. */
type SentEmail = {
  id: string
  plan_id: string
  plan_label: string
  recipient_email: string
  recipient_name: string | null
  subject: string
  status: 'sent' | 'failed'
  error: string | null
  amount_total: number
  created_at: string
  items: { label: string; due_date: string; amount: number; kind: 'rent' | 'charge' }[]
}

/** "2 hours ago" / "Aug 12" — recent things get relative time, older get a date. */
export function whenLabel(iso: string): string {
  const then = new Date(iso)
  const mins = Math.floor((Date.now() - then.getTime()) / 60000)
  if (mins < 1)     return 'Just now'
  if (mins < 60)    return `${mins}m ago`
  if (mins < 1440)  return `${Math.floor(mins / 60)}h ago`
  if (mins < 10080) return `${Math.floor(mins / 1440)}d ago`
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Aug 2026 – Jul 2027 — a term reads as months; the days are noise at this level. */
function termLabel(start: string | null, end: string | null): string | null {
  if (!start || !end) return null
  const f = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  return `${f(start)} – ${f(end)}`
}

export default function FinancialsPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; view?: string; scope?: string; leases?: string; month?: string }>
}) {
  const {
    plan: planParam, view: viewParam, scope: scopeParam,
    leases: leasesParam, month: monthParam,
  } = use(searchParams)

  const [plans, setPlans] = useState<PaymentPlan[]>([])
  const [loading, setLoading] = useState(true)
  // Which lease's ledger is open. null = the portfolio rollup.
  const [openPlanId, setOpenPlanId] = useState<string | null>(planParam ?? null)
  const [view, setView] = useState<View>(
    VIEWS.some(v => v.id === viewParam) ? (viewParam as View) : 'portfolio'
  )
  const [scope, setScope] = useState<Scope>(
    SCOPES.some(s => s.id === scopeParam) ? (scopeParam as Scope) : 'month'
  )
  // Active leases unless asked otherwise — see LEASE_FILTERS.
  const [leaseFilter, setLeaseFilter] = useState<LeaseFilter>(
    LEASE_FILTERS.some(f => f.id === leasesParam) ? (leasesParam as LeaseFilter) : 'current'
  )
  // The month the ledger is pointed at. A key, not an offset, so it survives a
  // refresh and can be linked — and so it is still the same month tomorrow.
  const [month, setMonth] = useState<MonthKey>(
    /^\d{4}-\d{2}$/.test(monthParam ?? '') ? (monthParam as MonthKey) : monthKeyOf(new Date())
  )

  // Which property sections and lease rows are expanded. Properties start open
  // when there are few of them — with one or two buildings, a collapsed page is
  // just an extra click before any information at all.
  const [openProps, setOpenProps] = useState<Set<string> | null>(null)
  const [openLeases, setOpenLeases] = useState<Set<string>>(new Set())

  const [emails, setEmails] = useState<SentEmail[] | null>(null)
  // A ref, not state: this only guards against a second fetch, and flipping
  // state synchronously inside the effect would cascade a render for nothing.
  const emailsRequested = useRef(false)

  useEffect(() => { document.title = 'Financials — Landlord | HomeHive' }, [])

  // The request log is only fetched once the landlord asks for it — it is the
  // one section here that costs a round trip nobody else needs.
  const loadEmails = useCallback(async () => {
    if (emailsRequested.current) return
    emailsRequested.current = true
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/payments/emails', {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      })
      const json = await res.json()
      setEmails(res.ok ? (json.emails ?? []) : [])
    } catch {
      setEmails([])
    }
  }, [])

  useEffect(() => {
    getCurrentUser().then(user => {
      if (!user) return
      getPlansForOwner(user.id).then(data => { setPlans(data); setLoading(false) })
      // Deep-linked straight to the log — nothing will click for us.
      if (viewParam === 'activity') loadEmails()
    })
  }, [viewParam, loadEmails])

  // ── Everything the page renders, derived in one place ────────────────────

  // The leases in view. Every figure below is over these — except arrears on
  // leases the filter excludes, which are reported separately rather than
  // silently dropped.
  const scoped = useMemo(() => filterPlans(plans, leaseFilter), [plans, leaseFilter])
  const counts = useMemo(() => stageCounts(plans), [plans])

  const portfolio = useMemo(() => buildPortfolio(scoped, scope), [scoped, scope])
  const trend     = useMemo(() => monthlyTrend(scoped, TREND_MONTHS), [scoped])

  // Bound to no window: what is owed, what is about to land, what is held.
  const now       = useMemo(() => standing(scoped), [scoped])
  const behind    = now.arrears

  // Money owed on leases the current filter hides. Reported so that narrowing
  // the view can never make a debt disappear — the one thing a default filter
  // must not be allowed to do.
  const hidden = useMemo<Arrears>(() => {
    const ids = new Set(scoped.map(p => p.id))
    return arrears(plans.filter(p => !ids.has(p.id)))
  }, [plans, scoped])

  // The named month, and the months either side of it.
  const ledger    = useMemo(() => monthView(scoped, month), [scoped, month])
  const ahead     = useMemo(
    () => upcomingMonths(scoped, monthKeyOf(new Date()), AHEAD_MONTHS),
    [scoped],
  )
  const thisMonth = monthKeyOf(new Date())

  // Which properties are open before the landlord has touched anything. Derived
  // rather than seeded into state by an effect: `openProps` stays null until the
  // first real interaction, so "nobody has chosen yet" and "everything is shut"
  // remain distinguishable, and no cascading render is needed to express it.
  const defaultOpenProps = useMemo(() => new Set(
    portfolio.groups.length <= 3
      ? portfolio.groups.map(g => g.propertyId)
      // Many buildings: open only the ones with money outstanding, so the page
      // opens on the work rather than on everything at once.
      : portfolio.groups.filter(g => g.total.outstanding > 0).map(g => g.propertyId)
  ), [portfolio.groups])

  const effectiveOpenProps = openProps ?? defaultOpenProps
  const propOpen = (id: string) => effectiveOpenProps.has(id)
  const toggleProp = (id: string) => setOpenProps(prev => {
    const next = new Set(prev ?? defaultOpenProps)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const toggleLease = (id: string) => setOpenLeases(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  /** The URL carries the ledger, the section and the window, so any view of the
   *  numbers can be linked, refreshed or sent to a bookkeeper as-is. */
  const urlFor = (opts: {
    plan?: string | null; view?: View; scope?: Scope; leases?: LeaseFilter; month?: MonthKey
  }) => {
    const planId = opts.plan !== undefined ? opts.plan : openPlanId
    if (planId) return `/landlord/financials?plan=${planId}`
    const q = new URLSearchParams()
    const v = opts.view ?? view
    const s = opts.scope ?? scope
    const f = opts.leases ?? leaseFilter
    const m = opts.month ?? month
    if (v !== 'portfolio') q.set('view', v)
    if (s !== 'month') q.set('scope', s)
    // Only the non-defaults ride in the URL, so a plain link stays plain.
    if (f !== 'current') q.set('leases', f)
    if (m !== monthKeyOf(new Date())) q.set('month', m)
    const qs = q.toString()
    return qs ? `/landlord/financials?${qs}` : '/landlord/financials'
  }

  // Pushed, so Back returns to the rollup rather than leaving the page.
  const openPlan = (id: string | null) => {
    setOpenPlanId(id)
    window.history.pushState(null, '', urlFor({ plan: id }))
    window.scrollTo({ top: 0 })
  }

  // Sections and windows are replaces: flicking between them should not fill
  // the back stack with places the landlord never meant to go.
  const selectView = (v: View) => {
    setView(v)
    if (v === 'activity') loadEmails()
    window.history.replaceState(null, '', urlFor({ plan: null, view: v }))
  }
  const selectScope = (s: Scope) => {
    setScope(s)
    window.history.replaceState(null, '', urlFor({ plan: null, scope: s }))
  }
  const selectLeaseFilter = (f: LeaseFilter) => {
    setLeaseFilter(f)
    window.history.replaceState(null, '', urlFor({ plan: null, leases: f }))
  }
  const selectMonth = (m: MonthKey) => {
    setMonth(m)
    window.history.replaceState(null, '', urlFor({ plan: null, month: m }))
  }

  useEffect(() => {
    const onPop = () => {
      const q = new URLSearchParams(window.location.search)
      setOpenPlanId(q.get('plan'))
      const v = q.get('view')
      setView(VIEWS.some(x => x.id === v) ? (v as View) : 'portfolio')
      const s = q.get('scope')
      setScope(SCOPES.some(x => x.id === s) ? (s as Scope) : 'month')
      const f = q.get('leases')
      setLeaseFilter(LEASE_FILTERS.some(x => x.id === f) ? (f as LeaseFilter) : 'current')
      const m = q.get('month')
      setMonth(m && /^\d{4}-\d{2}$/.test(m) ? m : monthKeyOf(new Date()))
      if (v === 'activity') loadEmails()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [loadEmails])

  /** Jump to a lease's ledger from anywhere — the action queue, a charge, a row. */
  const openLeaseLedger = (planId: string) => openPlan(planId)

  // ── Ledger for one lease, opened in place ────────────────────────────────
  if (openPlanId) {
    const current = plans.find(p => p.id === openPlanId)
    const summary = portfolio.leases.find(l => l.planId === openPlanId)
    return (
      <>
        <style>{CSS}</style>
        <div className="fin-wrap wide">
          <button className="back" onClick={() => openPlan(null)}>
            <span className="back-chev" aria-hidden="true" />
            Financials
          </button>

          <header className="led-head">
            <div className="led-head-main">
              <h1 className="title">{current ? (current.property?.name ?? current.name) : 'Rent ledger'}</h1>
              <p className="sub">
                {current ? current.name : 'Loading…'}
                {current?.lease && ` · ${fmtDate(current.lease.start_date)} – ${fmtDate(current.lease.end_date)}`}
              </p>
            </div>
            {current?.lease_id && (
              <a href={`/landlord/leases/${current.lease_id}`} className="btn-quiet">View lease</a>
            )}
          </header>

          {/* The lease's whole financial life, above the month-by-month work.
              Without it the ledger could only answer "what about this month". */}
          {summary && <LeaseVitals lease={summary} />}

          {current?.lease_id && (
            <p className="led-note">
              Rent, deposits and one-off charges live here. The{' '}
              <a href={`/landlord/leases/${current.lease_id}`} className="lnk">lease</a> holds the
              tenancy itself — people, documents and move-out.
            </p>
          )}

          <PlanWorkspace planId={openPlanId} embedded />
        </div>
      </>
    )
  }

  // ── Portfolio rollup ─────────────────────────────────────────────────────
  const t = portfolio.total
  const scopeMeta = SCOPES.find(s => s.id === scope)!

  return (
    <>
      <style>{CSS}</style>
      <div className="fin-wrap wide">
        <header className="fin-head">
          <div>
            <h1 className="title">Financials</h1>
            <p className="sub">
              {leaseFilter === 'current'
                ? 'Rent you can still collect — leases running right now.'
                : LEASE_FILTERS.find(f => f.id === leaseFilter)!.hint + '.'}
            </p>
          </div>
          <a href="/landlord/financials/new" className="btn-primary">New plan</a>
        </header>

        {/* Which tenancies the whole page is about. First control on the page
            because it changes what every figure below even refers to. */}
        {!loading && plans.length > 0 && (
          <div className="lease-bar">
            <div className="seg" role="tablist" aria-label="Which leases">
              {LEASE_FILTERS.map(f => {
                const n = counts[f.id]
                // An empty stage is noise — except "Active", which must stay
                // visible to explain an empty page, and "All", which is the
                // way back from one.
                if (n === 0 && f.id !== 'current' && f.id !== 'all') return null
                return (
                  <button
                    key={f.id}
                    role="tab"
                    aria-selected={leaseFilter === f.id}
                    title={f.hint}
                    className={`seg-btn${leaseFilter === f.id ? ' on' : ''}`}
                    onClick={() => selectLeaseFilter(f.id)}
                  >
                    {f.label}
                    <span className="seg-badge quiet">{n}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {loading ? (
          <div className="skeleton-hero" />
        ) : plans.length === 0 ? (
          <div className="empty">
            <div className="empty-title">No rent being tracked yet</div>
            <p className="empty-sub">
              Set up a payment plan against a lease to schedule rent, track who has paid, and record
              deposits and one-off charges.
            </p>
            <a href="/landlord/financials/new" className="btn-primary">Create your first plan</a>
          </div>
        ) : scoped.length === 0 ? (
          /* The filter, not the portfolio, is empty. Say which, and never let
             that state hide money still owed on the leases it excluded. */
          <div className="empty">
            <div className="empty-title">
              {leaseFilter === 'current' ? 'No lease is running right now' : 'Nothing in this view'}
            </div>
            <p className="empty-sub">
              {leaseFilter === 'current'
                ? `You have ${counts.all} lease${counts.all !== 1 ? 's' : ''} on record, but none inside its term today.`
                : LEASE_FILTERS.find(f => f.id === leaseFilter)!.hint + '.'}
              {hidden.total > 0 && (
                <> <strong>{fmtCurrency(hidden.total)}</strong> is still owed on
                {' '}{hidden.payerCount === 1 ? 'a payer' : `${hidden.payerCount} payers`} elsewhere.</>
              )}
            </p>
            <button className="btn-primary" onClick={() => selectLeaseFilter('all')}>
              Show all leases
            </button>
          </div>
        ) : (
          <>
            {/* ══ 1. WHERE THINGS STAND — bound to no window at all ══
                These four are deliberately immune to the scope toggle below.
                Arrears run for the whole tenancy, the next 30 days is the next
                30 days, and a deposit is held or it isn't. A figure that moved
                when the reporting period changed would be a figure a landlord
                could not act on. */}
            <section className="now" aria-label="Where things stand">
              <div className="sec-hd">
                <h2 className="sec-title">Where things stand</h2>
                <span className="sec-note">Right now, across the whole of each lease — not this month</span>
              </div>
              <div className="now-tiles">
                <NowTile
                  label="Owed to you now"
                  value={behind.total > 0 ? fmtCurrency(behind.total) : 'Nothing'}
                  tone={behind.total > 0 ? 'bad' : 'good'}
                  wide
                  meta={behind.total > 0
                    ? `${behind.payerCount} ${behind.payerCount === 1 ? 'person' : 'people'} · ${behind.chargeCount} charge${behind.chargeCount !== 1 ? 's' : ''} missed · worst ${behind.maxDaysLate} day${behind.maxDaysLate !== 1 ? 's' : ''} late`
                    : 'Every charge due so far has been settled'}
                  foot={behind.lateFees > 0
                    ? `includes ${fmtCurrency(behind.lateFees)} of late fees`
                    : undefined}
                />
                <NowTile
                  label="Landing in 30 days"
                  value={now.next30.amount > 0 ? fmtCurrency(now.next30.amount) : 'Nothing'}
                  meta={now.next30.count > 0
                    ? `${now.next30.count} charge${now.next30.count !== 1 ? 's' : ''} coming due`
                    : 'nothing falls due in the next month'}
                />
                <NowTile
                  label="Contracted rent"
                  value={`${fmtCurrency(now.monthly)}/mo`}
                  meta={`${portfolio.activeLeaseCount} active lease${portfolio.activeLeaseCount !== 1 ? 's' : ''} · ${portfolio.propertyCount} propert${portfolio.propertyCount !== 1 ? 'ies' : 'y'}`}
                />
                <NowTile
                  label="Deposits held"
                  value={fmtCurrency(now.depositsHeld)}
                  meta={now.clearing.amount > 0
                    ? `${fmtCurrency(now.clearing.amount)} clearing by bank transfer`
                    : 'no transfers clearing'}
                />
              </div>
            </section>

            {/* ══ 2. WHO IS BEHIND — the whole lease, never one month ══ */}
            <MissedPayments
              arrears={behind}
              hidden={hidden}
              filter={leaseFilter}
              onShowAll={() => selectLeaseFilter('all')}
              onOpen={openLeaseLedger}
            />

            {/* ══ 3. WHAT IS COMING ══ */}
            <UpcomingStrip
              months={ahead}
              selected={month}
              thisMonth={thisMonth}
              onSelect={selectMonth}
            />

            {/* ══ 4. ONE NAMED MONTH ══ */}
            <MonthLedger
              view={ledger}
              thisMonth={thisMonth}
              onSelect={selectMonth}
              onOpen={openLeaseLedger}
            />

            {/* ══ 5. ACCOUNTING BY WINDOW ══
                Everything from here down *is* window-bound, which is why it is
                fenced off and labelled. This is the reporting half of the page:
                totals over a period, and the property → lease drill-down. */}
            <div className="sec-hd wall">
              <h2 className="sec-title">Totals by period</h2>
              <span className="sec-note">Reporting view — pick the window these figures cover</span>
            </div>

            {/* The window every figure below is measured over. */}
            <div className="scope-bar">
              <div className="seg" role="tablist" aria-label="Reporting period">
                {SCOPES.map(s => (
                  <button
                    key={s.id}
                    role="tab"
                    aria-selected={scope === s.id}
                    title={s.hint}
                    className={`seg-btn${scope === s.id ? ' on' : ''}`}
                    onClick={() => selectScope(s.id)}
                  >
                    {/* Even here, the month gets named. "This month" was the
                        habit that made the old page hard to trust. */}
                    {s.id === 'month' ? monthLabel(thisMonth) : s.label}
                  </button>
                ))}
              </div>
              <span className="scope-hint">
                {scope === 'month'
                  ? `Rent and charges due in ${monthLabel(thisMonth)}`
                  : scopeMeta.hint}
              </span>
            </div>

            {/* Summary — the four figures that add up, each a way into the detail. */}
            <section className="summary" aria-label="Portfolio summary">
              <SummaryCard
                label="Billed"
                value={fmtCurrency(t.billed)}
                meta={`${t.count} charge${t.count !== 1 ? 's' : ''} across ${portfolio.leaseCount} lease${portfolio.leaseCount !== 1 ? 's' : ''}`}
                onClick={() => selectView('portfolio')}
              />
              <SummaryCard
                label="Collected"
                // Money actually received, which includes late fees the tenant
                // paid on top. Those used to be invisible here: settlement
                // records only the rent in `paid_amount`, so a fee a tenant
                // genuinely handed over appeared nowhere on this page.
                value={fmtCurrency(t.received)}
                meta={
                  // Collecting the money late is still a problem, and `overdue`
                  // forgets it the instant a tenant pays. Say it here or the
                  // page congratulates itself on rent that arrived three weeks
                  // after it was owed.
                  t.lateFeesCollected > 0
                    ? `incl. ${fmtCurrency(t.lateFeesCollected)} of late fees collected`
                    : t.collectedLate > 0
                      ? `${fmtCurrency(t.collectedLate)} of it arrived late`
                      : t.rate !== null ? `${t.rate}% of billed` : 'Nothing billed yet'
                }
                tone="good"
                bar={t.rate}
                onClick={() => selectView('received')}
              />
              <SummaryCard
                label="Outstanding"
                value={fmtCurrency(t.outstanding)}
                meta={
                  t.outstanding === 0 ? 'All settled'
                  // An ACH debit already sent is outstanding but not owed —
                  // saying so is the difference between chasing a tenant who
                  // has paid and one who hasn't.
                  : t.inFlight > 0 ? `incl. ${fmtCurrency(t.inFlight)} clearing by bank transfer`
                  : `${t.count - t.settledCount} charge${t.count - t.settledCount !== 1 ? 's' : ''} unsettled`
                }
                tone={t.outstanding > 0 ? 'warn' : 'good'}
                onClick={() => selectView('portfolio')}
              />
              <SummaryCard
                label="Overdue"
                value={t.overdue > 0 ? fmtCurrency(t.overdue) : 'None'}
                // This is overdue money *billed inside the window*, which is a
                // narrower thing than what anyone owes — change the window and
                // it moves. "Missed payments" at the top of the page is the
                // figure to chase; say so rather than letting the two be
                // mistaken for each other.
                meta={t.overdue > 0
                  ? `${t.overdueCount} payment${t.overdueCount !== 1 ? 's' : ''} billed in this window`
                  : 'Nothing billed in this window is past due'}
                tone={t.overdue > 0 ? 'bad' : 'good'}
                onClick={() => selectView('portfolio')}
              />
            </section>

            {/* Standing figures that do not move with the window. */}
            <div className="facts">
              <Fact label="Contracted rent" value={`${fmtCurrency(portfolio.monthly)}/mo`} />
              <Fact label="Deposits held" value={fmtCurrency(portfolio.depositsHeld)} />
              <Fact
                label="Clearing now"
                value={t.inFlight > 0 ? fmtCurrency(t.inFlight) : 'None'}
                meta={t.inFlightCount > 0
                  ? `${t.inFlightCount} bank transfer${t.inFlightCount !== 1 ? 's' : ''} in flight`
                  : 'no transfers pending'}
              />
              <Fact
                label="Active leases"
                value={`${portfolio.activeLeaseCount} of ${portfolio.leaseCount}`}
                meta={`${portfolio.propertyCount} propert${portfolio.propertyCount !== 1 ? 'ies' : 'y'}`}
              />
            </div>

            {/* How the money actually arrived. Card and bank transfer cost the
                tenant different surcharges and settle on different timescales,
                so the split is a fact about the portfolio, not a detail. */}
            {portfolio.methods.length > 0 && (
              <section className="methods-bar">
                <span className="methods-label">How it was paid</span>
                <MethodChips slices={portfolio.methods} />
              </section>
            )}

            <div className="seg full" role="tablist" aria-label="Financials sections">
              {VIEWS.map(v => (
                <button
                  key={v.id}
                  role="tab"
                  aria-selected={view === v.id}
                  className={`seg-btn${view === v.id ? ' on' : ''}`}
                  onClick={() => selectView(v.id)}
                >
                  {v.label}
                </button>
              ))}
            </div>

            {view === 'portfolio' && (
              <>
                {portfolio.groups.map(g => (
                  <PropertyBlock
                    key={g.propertyId}
                    group={g}
                    scope={scope}
                    open={propOpen(g.propertyId)}
                    onToggle={() => toggleProp(g.propertyId)}
                    openLeases={openLeases}
                    onToggleLease={toggleLease}
                    onOpenLedger={openLeaseLedger}
                  />
                ))}
                <TrendPanel points={trend} />
              </>
            )}

            {view === 'received' && (
              <ReceivedPayments
                groups={portfolio.groups}
                total={t}
                onOpen={openLeaseLedger}
              />
            )}

            {view === 'charges' && (
              <ChargesByProperty groups={portfolio.groups} onOpen={openLeaseLedger} />
            )}

            {view === 'activity' && (
              <section className="panel">
                <div className="panel-hd">
                  <h2 className="panel-title">Payment requests sent</h2>
                  <span className="panel-note">
                    {emails === null ? '' : `${emails.length} across every lease`}
                  </span>
                </div>
                <div className={`panel-bd${emails && emails.length ? ' flush' : ''}`}>
                  {emails === null ? (
                    <p className="muted">Loading…</p>
                  ) : emails.length === 0 ? (
                    <p className="muted">
                      No payment requests sent yet. Chasing rent or a deposit from a lease&apos;s
                      ledger records it here, so you can see who was asked, for what, and when.
                    </p>
                  ) : emails.map(e => (
                    <div
                      key={e.id}
                      className="row"
                      role="button"
                      tabIndex={0}
                      onClick={() => openLeaseLedger(e.plan_id)}
                      onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openLeaseLedger(e.plan_id) } }}
                    >
                      <div className="row-main">
                        <div className="row-name">
                          {e.recipient_name || e.recipient_email}
                          {e.status === 'failed'
                            ? <span className="pill bad">not delivered</span>
                            : <span className="pill good">sent</span>}
                        </div>
                        <div className="row-sub">
                          {e.plan_label} · {e.items.map(i => i.label).join(', ') || e.subject}
                        </div>
                        {e.status === 'failed' && e.error && (
                          <div className="row-err">{e.error}</div>
                        )}
                      </div>
                      <div className="row-fig">
                        <div className="row-amt">{fmtCurrency(e.amount_total)}</div>
                        <div className="row-amt-lbl">{whenLabel(e.created_at)}</div>
                      </div>
                      <span className="row-chev" aria-hidden="true" />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </>
  )
}

// ─── PROPERTY → LEASE TABLE ──────────────────────────────────────────────────

/**
 * One building, with its leases as rows of a table that shares the property's
 * own column grid — so the subtotal sits directly above the figures it sums and
 * the arithmetic is visible rather than asserted.
 */
function PropertyBlock({
  group, scope, open, onToggle, openLeases, onToggleLease, onOpenLedger,
}: {
  group: PropertyGroup
  scope: Scope
  open: boolean
  onToggle: () => void
  openLeases: Set<string>
  onToggleLease: (id: string) => void
  onOpenLedger: (planId: string) => void
}) {
  const t = group.total
  const tone = t.overdue > 0 ? 'bad' : t.outstanding > 0 ? 'warn' : 'good'

  return (
    <section className="panel prop">
      <button className="prop-hd" onClick={onToggle} aria-expanded={open}>
        <span className={`disc${open ? ' open' : ''}`} aria-hidden="true" />
        <span className="prop-id">
          <span className="prop-name">{group.propertyName}</span>
          <span className="prop-sub">
            {group.leases.length} lease{group.leases.length !== 1 ? 's' : ''}
            {group.activeLeases > 0 && ` · ${group.activeLeases} active`}
            {group.monthly > 0 && ` · ${fmtCurrency(group.monthly)}/mo`}
            {group.depositsHeld > 0 && ` · ${fmtCurrency(group.depositsHeld)} deposits held`}
          </span>
        </span>
        <span className="prop-figs">
          <Fig label="billed" value={fmtCurrency(t.billed)} />
          <Fig label="collected" value={fmtCurrency(t.collected)} tone="good" />
          <Fig
            label={t.overdue > 0 ? 'overdue' : 'outstanding'}
            value={fmtCurrency(t.overdue > 0 ? t.overdue : t.outstanding)}
            tone={tone === 'good' ? undefined : tone}
          />
        </span>
      </button>

      {/* Always visible, open or shut: the one bar that says how this building
          is doing, so a collapsed property is still readable at a glance. */}
      <div className="prop-bar">
        <div className="prop-bar-fill" data-tone={tone} style={{ width: `${Math.min(100, t.rate ?? 0)}%` }} />
      </div>

      {open && (
        <div className="tbl">
          <div className="tbl-hd" role="row">
            <span>Lease agreement</span>
            <span className="num">Payers</span>
            <span className="num">Monthly</span>
            <span className="num">Billed</span>
            <span className="num">Collected</span>
            <span className="num">Outstanding</span>
            <span aria-hidden="true" />
          </div>

          {group.leases.map(l => (
            <LeaseRow
              key={l.planId}
              lease={l}
              scope={scope}
              open={openLeases.has(l.planId)}
              onToggle={() => onToggleLease(l.planId)}
              onOpenLedger={() => onOpenLedger(l.planId)}
            />
          ))}

          {group.leases.length > 1 && (
            <div className="tbl-foot" role="row">
              <span className="foot-label">{group.propertyName} total</span>
              <span className="num dim">
                {group.leases.reduce((s, l) => s + l.activePayers, 0)}
              </span>
              <span className="num">{fmtCurrency(group.monthly)}</span>
              <span className="num">{fmtCurrency(t.billed)}</span>
              <span className="num good">{fmtCurrency(t.collected)}</span>
              <span className={`num${t.outstanding > 0 ? (t.overdue > 0 ? ' bad' : ' warn') : ''}`}>
                {fmtCurrency(t.outstanding)}
              </span>
              <span aria-hidden="true" />
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * One lease agreement. Collapsed it is a row of figures; expanded it breaks
 * into the people who owe them, which is the level a landlord acts at on a
 * shared student lease where six payers sit behind one rent number.
 */
function LeaseRow({
  lease, scope, open, onToggle, onOpenLedger,
}: {
  lease: LeaseSummary
  scope: Scope
  open: boolean
  onToggle: () => void
  onOpenLedger: () => void
}) {
  const t = lease.total
  const term = termLabel(lease.termStart, lease.termEnd)
  const ended = lease.stage === 'ended'

  return (
    <>
      <div
        className={`tbl-row${open ? ' open' : ''}${ended ? ' faded' : ''}`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
      >
        <span className="cell-lease">
          <span className="lease-name">
            <span className={`disc sm${open ? ' open' : ''}`} aria-hidden="true" />
            {lease.name}
            <StagePill stage={lease.stage} />
            {t.overdueCount > 0 && <span className="pill bad">{t.overdueCount} overdue</span>}
            {t.inFlightCount > 0 && (
              <span className="pill info">{fmtCurrency(t.inFlight)} clearing</span>
            )}
            {lease.openCharges.length > 0 && (
              <span className="pill warn">{lease.openCharges.length} open charge{lease.openCharges.length !== 1 ? 's' : ''}</span>
            )}
          </span>
          <span className="lease-sub">
            {term ?? 'No term on file'}
            {lease.termProgress !== null && !ended && ` · ${lease.termProgress}% through term`}
            {lease.nextDue && ` · next ${fmtCurrency(lease.nextDue.amount)} on ${fmtDate(lease.nextDue.date)}`}
          </span>
        </span>
        <span className="num dim">{lease.activePayers || '—'}</span>
        <span className="num">{lease.monthly > 0 ? fmtCurrency(lease.monthly) : '—'}</span>
        <span className="num">{t.billed > 0 ? fmtCurrency(t.billed) : '—'}</span>
        <span className="num good">{t.collected > 0 ? fmtCurrency(t.collected) : '—'}</span>
        <span className={`num${t.outstanding > 0 ? (t.overdue > 0 ? ' bad' : t.inFlight >= t.outstanding ? ' info' : ' warn') : ' dim'}`}>
          {t.outstanding > 0 ? fmtCurrency(t.outstanding) : 'Settled'}
        </span>
        <span className="row-chev" aria-hidden="true" />
      </div>

      {open && (
        <div className="drill">
          {/* Where this lease stands over its whole life, not just the window. */}
          <div className="drill-vitals">
            <DrillFact label="Contract value" value={fmtCurrency(lease.contractValue)} meta="rent over the full term" />
            <DrillFact label="Paid to date" value={fmtCurrency(lease.contractCollected)} meta={
              lease.contractValue > 0
                ? `${Math.round((lease.contractCollected / lease.contractValue) * 100)}% of the lease`
                : '—'
            } tone="good" />
            <DrillFact label="Deposits held" value={fmtCurrency(lease.depositsHeld)} meta={lease.depositsHeld > 0 ? 'returnable at move-out' : 'none on file'} />
            <DrillFact label="Last payment" value={lease.lastPaid ? fmtCurrency(lease.lastPaid.amount) : '—'} meta={lease.lastPaid ? fmtDate(lease.lastPaid.date) : 'nothing received yet'} />
          </div>

          {/* The monthly figure above includes the lease's utilities, so name
              them — otherwise rent and the bills riding on it are one number. */}
          {lease.utilitiesMonthly > 0 && (
            <div className="util-note">
              <span>
                Of {fmtCurrency(lease.monthly)}/mo billed,{' '}
                <strong>{fmtCurrency(lease.utilitiesMonthly)}</strong> is{' '}
                {lease.utilityLabels.join(', ')} charged across the lease — the rest is rent.
              </span>
              <button className="btn-quiet sm" onClick={onOpenLedger}>Manage utilities</button>
            </div>
          )}

          {/* Who owes what, inside this one agreement. */}
          <div className="drill-sec">
            <div className="drill-hd">
              Payers
              <span className="drill-hd-note">{SCOPES.find(s => s.id === scope)!.label.toLowerCase()}</span>
            </div>
            {lease.payers.length === 0 ? (
              <p className="muted sm">No payers on this plan.</p>
            ) : (
              <div className="payers">
                {lease.payers.map(p => (
                  <div key={p.id} className={`payer${p.status !== 'active' ? ' faded' : ''}`}>
                    <span className="payer-who">
                      <span className="avatar">{(p.name || '?')[0].toUpperCase()}</span>
                      <span className="payer-id">
                        <span className="payer-name">
                          {p.name}
                          {p.status !== 'active' && <span className="pill plain">{p.status}</span>}
                        </span>
                        {p.email && <span className="payer-mail">{p.email}</span>}
                      </span>
                    </span>
                    <span className="num dim">{fmtCurrency(p.monthly)}/mo</span>
                    <span className="num">{fmtCurrency(p.rent.billed)}</span>
                    <span className="num good">{fmtCurrency(p.rent.collected)}</span>
                    <span className={`num${p.rent.outstanding > 0 ? (p.rent.overdue > 0 ? ' bad' : ' warn') : ' dim'}`}>
                      {p.rent.outstanding > 0 ? fmtCurrency(p.rent.outstanding) : 'Settled'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {lease.methods.length > 0 && (
            <div className="drill-sec">
              <div className="drill-hd">
                How it was paid
                {lease.total.inFlight > 0 && (
                  <span className="drill-hd-note">
                    {fmtCurrency(lease.total.inFlight)} still clearing
                  </span>
                )}
              </div>
              <MethodChips slices={lease.methods} />
            </div>
          )}

          {lease.openCharges.length > 0 && (
            <div className="drill-sec">
              <div className="drill-hd">
                Open deposits &amp; charges
                <span className="drill-hd-note">
                  {fmtCurrency(lease.openCharges.reduce((s, c) => s + c.amount, 0))} outstanding
                </span>
              </div>
              <div className="chips">
                {lease.openCharges.map(c => (
                  <span key={c.id} className={`chip${c.overdue ? ' bad' : ''}`}>
                    <strong>{fmtCurrency(c.amount)}</strong> {c.label}
                    <span className="chip-meta">
                      {c.categoryLabel}{c.who ? ` · ${c.who}` : ''} · due {fmtDate(c.dueDate)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="drill-actions">
            <button className="btn-primary sm" onClick={onOpenLedger}>
              Open ledger &amp; adjust payments
            </button>
            {lease.leaseId && (
              <a href={`/landlord/leases/${lease.leaseId}`} className="btn-quiet">View lease agreement</a>
            )}
            {lease.lateFeesDue > 0 && (
              <span className="drill-note">{fmtCurrency(lease.lateFeesDue)} in late fees accrued</span>
            )}
            {lease.lateFeeRisk && (
              <span className="drill-warn" title={lease.lateFeeRisk}>⚠ uncapped late-fee rule</span>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ─── OTHER SECTIONS ──────────────────────────────────────────────────────────

/** The lease's whole financial life, shown above its month-by-month ledger. */
function LeaseVitals({ lease }: { lease: LeaseSummary }) {
  const pct = lease.contractValue > 0
    ? Math.round((lease.contractCollected / lease.contractValue) * 100)
    : 0
  return (
    <section className="vitals">
      <div className="vitals-row">
        <DrillFact label="Contract value" value={fmtCurrency(lease.contractValue)} meta="rent over the full term" />
        <DrillFact label="Paid to date" value={fmtCurrency(lease.contractCollected)} meta={`${pct}% of the lease`} tone="good" />
        <DrillFact
          label="Still to collect"
          value={fmtCurrency(Math.max(0, lease.contractValue - lease.contractCollected))}
          meta={lease.nextDue ? `next ${fmtCurrency(lease.nextDue.amount)} on ${fmtDate(lease.nextDue.date)}` : 'nothing scheduled'}
        />
        <DrillFact
          label="Overdue"
          value={lease.total.overdue > 0 ? fmtCurrency(lease.total.overdue) : 'None'}
          meta={lease.total.overdueCount > 0 ? `${lease.total.overdueCount} payment${lease.total.overdueCount !== 1 ? 's' : ''}` : 'nothing past due'}
          tone={lease.total.overdue > 0 ? 'bad' : 'good'}
        />
        <DrillFact label="Deposits held" value={fmtCurrency(lease.depositsHeld)} meta={lease.depositsHeld > 0 ? 'returnable at move-out' : 'none on file'} />
      </div>
      <div className="vitals-bar" title={`${pct}% of the contract collected`}>
        <div className="vitals-fill" style={{ width: `${Math.min(100, pct)}%` }} />
        {lease.termProgress !== null && (
          <div className="vitals-mark" style={{ left: `${lease.termProgress}%` }} title={`${lease.termProgress}% through the term`} />
        )}
      </div>
      <div className="vitals-key">
        <span>{pct}% of contracted rent collected</span>
        {lease.termProgress !== null && <span>marker = {lease.termProgress}% through the term</span>}
      </div>
    </section>
  )
}

/** One standing figure. `wide` gives the headline tile twice the room, because
 *  "what am I owed" is not one of four equal questions. */
function NowTile({
  label, value, meta, foot, tone, wide,
}: {
  label: string
  value: string
  meta: string
  foot?: string
  tone?: 'good' | 'bad'
  wide?: boolean
}) {
  return (
    <div className={`now-tile${wide ? ' wide' : ''}${tone ? ' ' + tone : ''}`}>
      <div className="now-label">{label}</div>
      <div className="now-value">{value}</div>
      <div className="now-meta">{meta}</div>
      {foot && <div className="now-foot">{foot}</div>}
    </div>
  )
}

/** Paid / Overdue / Scheduled — the state of one charge, as a pill. */
function StatePill({ state }: { state: Charge['state'] }) {
  const meta = CHARGE_STATE_META[state]
  return <span className={`st st-${meta.tone}`}>{meta.label}</span>
}

const dayOrdinal = (n: number) =>
  n % 10 === 1 && n !== 11 ? `${n}st`
  : n % 10 === 2 && n !== 12 ? `${n}nd`
  : n % 10 === 3 && n !== 13 ? `${n}rd`
  : `${n}th`

/**
 * Who is behind, by person, across the whole of their tenancy.
 *
 * Grouped by payer rather than by charge because a landlord chases a person,
 * not a row: three missed months from one tenant is one conversation and one
 * figure to quote, and a flat list of charges makes that take arithmetic.
 */
function MissedPayments({
  arrears: a, hidden, filter, onShowAll, onOpen,
}: {
  arrears: Arrears
  hidden: Arrears
  filter: LeaseFilter
  onShowAll: () => void
  onOpen: (planId: string) => void
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (k: string) => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k); else next.add(k)
    return next
  })

  return (
    <section className={`panel missed${a.total > 0 ? ' hot' : ''}`}>
      <div className="panel-hd">
        <h2 className="panel-title">
          Missed payments
          {a.payerCount > 0 && <span className="panel-count">{a.payerCount}</span>}
        </h2>
        <span className="panel-note">
          {a.total > 0
            ? `${fmtCurrency(a.total)} owed across every month of these leases`
            : 'Nobody is behind'}
        </span>
      </div>

      <div className={`panel-bd${a.payerCount ? ' flush' : ''}`}>
        {a.payerCount === 0 ? (
          <p className="muted">
            Every charge that has come due has been paid. Rent that is not due yet is in the
            look-ahead below, not here.
          </p>
        ) : a.payers.map(p => {
          const isOpen = open.has(p.key)
          return (
            <div key={p.key} className="miss">
              <div
                className="miss-row"
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                onClick={() => toggle(p.key)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(p.key) } }}
              >
                <span className={`twist${isOpen ? ' open' : ''}`} aria-hidden="true" />
                <div className="miss-main">
                  <div className="miss-name">
                    {p.name}
                    <span className="pill bad">{p.maxDaysLate}d late</span>
                    {p.stage === 'ended' && <span className="pill plain">lease ended</span>}
                    {p.payerStatus === 'terminated' && <span className="pill plain">moved out</span>}
                  </div>
                  <div className="miss-sub">
                    {p.propertyName} · {p.charges.length} missed charge{p.charges.length !== 1 ? 's' : ''} ·
                    {' '}oldest {fmtDate(p.oldestDue)}
                    {p.email && <> · {p.email}</>}
                  </div>
                </div>
                <div className="miss-fig">
                  <div className="miss-amt">{fmtCurrency(p.total)}</div>
                  <div className="miss-amt-lbl">
                    {p.lateFees > 0 ? `${fmtCurrency(p.shortfall)} + ${fmtCurrency(p.lateFees)} fees` : 'outstanding'}
                  </div>
                </div>
              </div>

              {isOpen && (
                <div className="miss-detail">
                  {p.charges.map(c => (
                    <div key={`${c.kind}-${c.id}`} className="miss-charge">
                      <span className="mc-label">{c.label}</span>
                      <span className="mc-due">due {fmtDate(c.dueDate)} · {c.daysLate}d late</span>
                      <span className="mc-amt">
                        {fmtCurrency(c.outstanding)}
                        {c.paid > 0 && <span className="mc-part"> of {fmtCurrency(c.amount)}</span>}
                      </span>
                      {c.lateFee > 0 && <span className="mc-fee">+{fmtCurrency(c.lateFee)} late fee</span>}
                    </div>
                  ))}
                  <button className="btn-quiet sm" onClick={() => onOpen(p.planId)}>
                    Open ledger to record or chase
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* A filter must never be able to hide a debt. If there is money owed on
          a lease this view excludes, say so and offer the way to it. */}
      {hidden.total > 0 && filter !== 'all' && (
        <div className="panel-ft">
          <span>
            <strong>{fmtCurrency(hidden.total)}</strong> is also owed by{' '}
            {hidden.payerCount} {hidden.payerCount === 1 ? 'payer' : 'payers'} on leases outside
            this view.
          </span>
          <button className="btn-quiet sm" onClick={onShowAll}>Show all leases</button>
        </div>
      )}
    </section>
  )
}

/**
 * The next few months as a strip of bars — click one to point the ledger at it.
 *
 * Rent is contracted a year ahead, so "what is coming in" is knowable and the
 * page simply never said it. Each bar is that month's `expected` against the
 * tallest month in view, and a month a tenant has already paid into shrinks —
 * which is exactly the signal a landlord wants.
 */
function UpcomingStrip({
  months, selected, thisMonth, onSelect,
}: {
  months: UpcomingMonth[]
  selected: MonthKey
  thisMonth: MonthKey
  onSelect: (m: MonthKey) => void
}) {
  const peak = Math.max(1, ...months.map(m => Math.max(m.expected, m.paid)))
  const total = months.reduce((s, m) => s + m.expected, 0)

  return (
    <section className="panel ahead">
      <div className="panel-hd">
        <h2 className="panel-title">Upcoming payments</h2>
        <span className="panel-note">
          {total > 0
            ? `${fmtCurrency(total)} still to come over the next ${months.length} months`
            : 'nothing scheduled in the months ahead'}
        </span>
      </div>
      <div className="panel-bd">
        <div className="strip">
          {months.map(m => {
            const h = Math.round((m.expected / peak) * 100)
            const paidH = Math.round((m.paid / peak) * 100)
            return (
              <button
                key={m.key}
                className={`strip-col${m.key === selected ? ' on' : ''}`}
                onClick={() => onSelect(m.key)}
                title={`${m.label} — ${fmtCurrency(m.expected)} expected of ${fmtCurrency(m.billed)} billed`}
              >
                <span className="strip-amt">{m.expected > 0 ? fmtCurrency(m.expected) : '—'}</span>
                <span className="strip-bars">
                  {/* Two stacked facts: what is still expected, and what has
                      already been paid into that month. A month paid early is a
                      short bar with a green foot, not an empty one. */}
                  <span className="strip-bar" style={{ height: `${h}%` }} />
                  {paidH > 0 && <span className="strip-paid" style={{ height: `${paidH}%` }} />}
                </span>
                <span className="strip-lbl">
                  {m.shortLabel}
                  {m.key === thisMonth && <span className="strip-now">now</span>}
                </span>
                {m.overdueCount > 0 && <span className="strip-flag">{m.overdueCount} late</span>}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/**
 * One named month, lease by lease and payer by payer.
 *
 * The month is in the heading — "October 2026", not "this month" — and the
 * arrows reach any month in either direction. A future month renders through
 * exactly the same code as a past one; only the charge states differ, so there
 * is no second code path to disagree with the first.
 */
function MonthLedger({
  view, thisMonth, onSelect, onOpen,
}: {
  view: MonthView
  thisMonth: MonthKey
  onSelect: (m: MonthKey) => void
  onOpen: (planId: string) => void
}) {
  const t = view.totals
  const offset = monthsBetween(thisMonth, view.key)
  const when =
    view.position === 'current' ? 'This month'
    : offset === 1 ? 'Next month'
    : offset === -1 ? 'Last month'
    : offset > 0 ? `${offset} months ahead`
    : `${Math.abs(offset)} months back`

  return (
    <section className="panel month">
      <div className="month-hd">
        <div className="month-nav">
          <button
            className="mn-btn"
            onClick={() => onSelect(shiftMonth(view.key, -1))}
            aria-label={`Go to ${monthLabel(shiftMonth(view.key, -1))}`}
          >&lsaquo;</button>
          <div className="month-title">
            <h2 className="month-name">{view.label}</h2>
            <span className="month-when">{when}</span>
          </div>
          <button
            className="mn-btn"
            onClick={() => onSelect(shiftMonth(view.key, 1))}
            aria-label={`Go to ${monthLabel(shiftMonth(view.key, 1))}`}
          >&rsaquo;</button>
        </div>
        {view.position !== 'current' && (
          <button className="btn-quiet sm" onClick={() => onSelect(thisMonth)}>
            Back to {monthLabel(thisMonth, true)}
          </button>
        )}
      </div>

      <div className="month-figs">
        <MonthFig
          label="Due this month"
          value={fmtCurrency(t.billed)}
          meta={`${t.count} charge${t.count !== 1 ? 's' : ''}`}
        />
        <MonthFig
          label={view.position === 'future' ? 'Paid early' : 'Collected'}
          value={fmtCurrency(t.received)}
          // The rate stays rent-against-rent: fold fees into the numerator and
          // a tenant who pays late pushes a collection rate past 100%.
          meta={t.lateFeesCollected > 0
            ? `incl. ${fmtCurrency(t.lateFeesCollected)} late fees`
            : t.rate !== null ? `${t.rate}% of the month` : 'nothing billed'}
          tone={t.rate !== null && t.rate >= 100 ? 'good' : undefined}
        />
        <MonthFig
          label="Still outstanding"
          value={fmtCurrency(t.outstanding)}
          meta={t.inFlight > 0 ? `${fmtCurrency(t.inFlight)} clearing` : `${t.count - t.settledCount} unsettled`}
          tone={t.outstanding > 0 ? 'warn' : 'good'}
        />
        <MonthFig
          label="Overdue in this month"
          value={t.overdue > 0 ? fmtCurrency(t.overdue) : 'None'}
          meta={view.position === 'future' ? 'nothing can be late yet' : `${t.overdueCount} past due`}
          tone={t.overdue > 0 ? 'bad' : 'good'}
        />
      </div>

      <div className="panel-bd flush">
        {view.empty ? (
          <p className="muted pad">
            Nothing is scheduled for {view.label}.{' '}
            {view.position === 'future'
              ? 'No lease in view bills in that month.'
              : 'No rent or charges fell due in that month.'}
          </p>
        ) : view.leases.map(l => (
          <MonthLeaseBlock key={l.planId} lease={l} onOpen={onOpen} />
        ))}
      </div>
    </section>
  )
}

function MonthFig({
  label, value, meta, tone,
}: { label: string; value: string; meta: string; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className={`mf${tone ? ' ' + tone : ''}`}>
      <div className="mf-label">{label}</div>
      <div className="mf-value">{value}</div>
      <div className="mf-meta">{meta}</div>
    </div>
  )
}

/** One lease inside the selected month: its payers, and what each one owes. */
function MonthLeaseBlock({ lease, onOpen }: { lease: MonthLease; onOpen: (planId: string) => void }) {
  return (
    <div className="ml">
      <div className="ml-hd">
        <div>
          <div className="ml-name">
            {lease.propertyName}
            {lease.stage === 'ended' && <span className="pill plain">ended</span>}
            {lease.stage === 'ending' && <span className="pill warn">ending soon</span>}
          </div>
          <div className="ml-sub">
            {lease.leaseName} · rent due on the {dayOrdinal(lease.dueDay)}
          </div>
        </div>
        <div className="ml-figs">
          <span className="ml-fig"><b>{fmtCurrency(lease.paid)}</b> in</span>
          <span className={`ml-fig${lease.outstanding > 0 ? ' owed' : ''}`}>
            <b>{fmtCurrency(lease.outstanding)}</b> out
          </span>
          <button className="btn-quiet sm" onClick={() => onOpen(lease.planId)}>Ledger</button>
        </div>
      </div>

      <div className="ml-payers">
        {lease.payers.map(p => (
          <div key={p.payerId ?? p.name} className="mp">
            <span className="mp-who">{p.name}</span>
            <span className="mp-charges">
              {p.charges.map(c => (
                <span key={`${c.kind}-${c.id}`} className="mp-charge">
                  <StatePill state={c.state} />
                  <span className="mp-c-label">
                    {c.kind === 'charge' ? c.label : `due ${fmtDate(c.dueDate)}`}
                  </span>
                  {c.daysLate > 0 && <span className="mp-late">{c.daysLate}d late</span>}
                </span>
              ))}
            </span>
            <span className="mp-fig">
              <span className={`mp-amt${p.outstanding > 0 ? ' owed' : ''}`}>
                {p.outstanding > 0 ? fmtCurrency(p.outstanding) : fmtCurrency(p.paid)}
              </span>
              <span className="mp-amt-lbl">
                {p.outstanding > 0
                  ? p.paid > 0 ? `owed of ${fmtCurrency(p.billed)}` : 'owed'
                  : 'paid'}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Settlement time, to the minute when we have it and honestly vague when not.
 *
 *  `paid_date` is a DATE column, so most historical rows genuinely have no time
 *  of day. Printing "12:00 AM" for those would be inventing precision, so a row
 *  without a recorded instant simply shows its date and says so on hover. */
function settledLabel(p: SettledPayment): { date: string; time: string | null } {
  const date = new Date(p.paidDate + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
  if (!p.settledAt) return { date, time: null }
  const d = new Date(p.settledAt)
  return {
    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }),
  }
}

/**
 * Every payment that actually arrived — the half of the ledger the page never
 * showed.
 *
 * Two questions it exists to answer. "Did they pay late?" survives payment here,
 * because days-late is computed from due date to paid date and does not vanish
 * when the row settles. And "what did I actually get?" is spelled out per row:
 * charged to the tenant, the surcharge they paid on top, and the net credited to
 * the landlord — which is the full rent, because the surcharge is never taken
 * out of it. That last point is stated rather than implied: a column called
 * "fee" next to a column called "net" invites exactly the wrong subtraction.
 */
function ReceivedPayments({
  groups, total, onOpen,
}: {
  groups: PropertyGroup[]
  total: { collected: number; collectedLate: number; collectedLateCount: number; maxDaysLate: number; tenantFees: number }
  onOpen: (planId: string) => void
}) {
  const [lateOnly, setLateOnly] = useState(false)

  const rows = groups
    .flatMap(g => g.leases.flatMap(l =>
      (lateOnly ? l.settledLate : l.settled).map(p => ({ p, lease: l, group: g }))
    ))
    .sort((a, b) => b.p.paidDate.localeCompare(a.p.paidDate))

  const shown = rows.slice(0, 60)
  const net = rows.reduce((s, r) => s + r.p.net, 0)
  const fees = rows.reduce((s, r) => s + r.p.tenantFee, 0)

  return (
    <>
      <section className="netband">
        <div className="netband-row">
          <DrillFact label="Credited to you" value={fmtCurrency(net)} meta="rent and charges received" tone="good" />
          <DrillFact
            label="Tenant processing fees"
            value={fmtCurrency(fees)}
            meta="paid by tenants on top — not deducted"
          />
          <DrillFact
            label="Arrived late"
            value={total.collectedLate > 0 ? fmtCurrency(total.collectedLate) : 'None'}
            meta={total.collectedLateCount > 0
              ? `${total.collectedLateCount} payment${total.collectedLateCount !== 1 ? 's' : ''} · worst ${total.maxDaysLate}d`
              : 'everything arrived on time'}
            tone={total.collectedLate > 0 ? 'bad' : undefined}
          />
        </div>
        <p className="netband-note">
          You receive the <strong>full</strong> rent. The card or bank surcharge is charged to the
          tenant on top of it and goes to the payment processor, so nothing above is taken out of
          what you are owed.
        </p>
      </section>

      <section className="panel">
        <div className="panel-hd">
          <h2 className="panel-title">Payments received</h2>
          <div className="recv-tools">
            <button
              className={`chipbtn${lateOnly ? ' on' : ''}`}
              onClick={() => setLateOnly(v => !v)}
            >
              Late only
            </button>
            <span className="panel-note">{rows.length} payment{rows.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className={`panel-bd${rows.length ? ' flush' : ''}`}>
          {rows.length === 0 ? (
            <p className="muted">
              {lateOnly
                ? 'Every payment in this window arrived on or before its due date.'
                : 'No payments have been received in this window yet.'}
            </p>
          ) : (
            <div className="rtbl">
              <div className="rtbl-hd" role="row">
                <span>Payment</span>
                <span>Settled</span>
                <span className="num">Charged</span>
                <span className="num">Tenant fee</span>
                <span className="num">Credited to you</span>
                <span aria-hidden="true" />
              </div>
              {shown.map(({ p, lease, group }) => {
                const when = settledLabel(p)
                return (
                  <div
                    key={`${p.kind}-${p.id}`}
                    className="rtbl-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpen(lease.planId)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(lease.planId) } }}
                  >
                    <span className="cell-lease">
                      <span className="lease-name">
                        {p.label}
                        {p.daysLate > 0
                          ? <span className="pill bad">{p.daysLate}d late</span>
                          : <span className="pill good">on time</span>}
                        {p.kind === 'charge' && <span className="pill plain">one-off</span>}
                        {p.method && (
                          <span
                            className="pill"
                            style={{ background: METHOD_META[p.method].bg, color: METHOD_META[p.method].color }}
                          >{METHOD_META[p.method].short}</span>
                        )}
                      </span>
                      <span className="lease-sub">
                        {p.who ? `${p.who} · ` : ''}{group.propertyName} · {lease.name} · due {fmtDate(p.dueDate)}
                      </span>
                    </span>
                    <span className="cell-when">
                      <span className="when-date">{when.date}</span>
                      <span className="when-time">
                        {when.time ?? <em title="Recorded by hand — only the date is known">date only</em>}
                      </span>
                    </span>
                    <span className="num">{fmtCurrency(p.chargedToTenant)}</span>
                    <span className="num dim">
                      {p.tenantFee > 0 ? fmtCurrency(p.tenantFee) : '—'}
                    </span>
                    <span className="num good strong">{fmtCurrency(p.net)}</span>
                    <span className="row-chev" aria-hidden="true" />
                  </div>
                )
              })}
              {rows.length > shown.length && (
                <div className="row-more">
                  + {rows.length - shown.length} more — open a lease ledger for its full history
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  )
}

/** Deposits and one-off money, kept under the property they belong to. */
function ChargesByProperty({ groups, onOpen }: { groups: PropertyGroup[]; onOpen: (planId: string) => void }) {
  const withCharges = groups
    .map(g => ({ g, leases: g.leases.filter(l => l.openCharges.length > 0) }))
    .filter(x => x.leases.length > 0)

  const held = groups.reduce((s, g) => s + g.depositsHeld, 0)

  return (
    <>
      <section className="panel">
        <div className="panel-hd">
          <h2 className="panel-title">Deposits held</h2>
          <span className="panel-note">{fmtCurrency(held)} across the portfolio</span>
        </div>
        <div className="panel-bd flush">
          {groups.filter(g => g.depositsHeld > 0).length === 0 ? (
            <p className="muted" style={{ padding: '4px 22px 18px' }}>
              No security deposits recorded as received yet.
            </p>
          ) : groups.filter(g => g.depositsHeld > 0).map(g => (
            <div key={g.propertyId} className="row static">
              <div className="row-main">
                <div className="row-name">{g.propertyName}</div>
                <div className="row-sub">
                  {g.leases.filter(l => l.depositsHeld > 0).map(l => l.name).join(' · ')}
                </div>
              </div>
              <div className="row-fig">
                <div className="row-amt">{fmtCurrency(g.depositsHeld)}</div>
                <div className="row-amt-lbl">returnable</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-hd">
          <h2 className="panel-title">Open deposits &amp; one-off charges</h2>
          <span className="panel-note">
            {withCharges.length === 0
              ? 'Nothing outstanding'
              : fmtCurrency(withCharges.flatMap(x => x.leases).flatMap(l => l.openCharges).reduce((s, c) => s + c.amount, 0)) + ' outstanding'}
          </span>
        </div>
        <div className={`panel-bd${withCharges.length ? ' flush' : ''}`}>
          {withCharges.length === 0 ? (
            <p className="muted">
              Every deposit and one-off charge on file has been settled or waived. New ones are added
              inside a lease&apos;s ledger, under Charges.
            </p>
          ) : withCharges.map(({ g, leases }) => (
            <div key={g.propertyId} className="chg-group">
              <div className="chg-group-hd">{g.propertyName}</div>
              {leases.map(l => l.openCharges.map(c => (
                <div
                  key={c.id}
                  className="row"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(l.planId)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(l.planId) } }}
                >
                  <div className="row-main">
                    <div className="row-name">
                      {c.label}
                      <span className="pill plain">{c.categoryLabel}</span>
                      {c.overdue && <span className="pill bad">past due</span>}
                    </div>
                    <div className="row-sub">
                      {l.name}{c.who ? ` · ${c.who}` : ''} · due {fmtDate(c.dueDate)}
                    </div>
                  </div>
                  <div className="row-fig">
                    <div className="row-amt">{fmtCurrency(c.amount)}</div>
                    <div className="row-amt-lbl">outstanding</div>
                  </div>
                  <span className="row-chev" aria-hidden="true" />
                </div>
              )))}
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

/** Collected against billed, month by month — is this slipping or holding? */
function TrendPanel({ points }: { points: { key: string; label: string; year: number; billed: number; collected: number; rate: number | null }[] }) {
  const peak = Math.max(1, ...points.map(p => p.billed))
  const live = points.filter(p => p.billed > 0)
  const avg = live.length > 0
    ? Math.round(live.reduce((s, p) => s + (p.rate ?? 0), 0) / live.length)
    : null

  return (
    <section className="panel">
      <div className="panel-hd">
        <h2 className="panel-title">Collected vs billed</h2>
        <span className="panel-note">
          Last {points.length} months{avg !== null && ` · ${avg}% average`}
        </span>
      </div>
      <div className="panel-bd">
        <div className="chart">
          {points.map(p => (
            <div key={p.key} className="col">
              <div
                className="col-stack"
                title={`${p.label} ${p.year}: ${fmtCurrency(p.collected)} of ${fmtCurrency(p.billed)}`}
              >
                <div className="col-exp" style={{ height: `${(p.billed / peak) * 100}%` }}>
                  <div
                    className="col-col"
                    data-tone={p.rate !== null && p.rate < 90 ? 'low' : 'ok'}
                    style={{ height: `${p.billed > 0 ? Math.min(100, (p.collected / p.billed) * 100) : 0}%` }}
                  />
                </div>
              </div>
              <div className="col-pct">{p.rate === null ? '—' : `${p.rate}%`}</div>
              <div className="col-label">{p.label}</div>
            </div>
          ))}
        </div>
        <p className="chart-key">
          The bar is what was billed that month; the filled part is what arrived. A month is counted
          by when rent was <em>due</em>, so late money lands in the month it was owed.
        </p>
      </div>
    </section>
  )
}

// ─── SMALL PIECES ────────────────────────────────────────────────────────────

function SummaryCard({
  label, value, meta, tone, bar, onClick,
}: {
  label: string
  value: string
  meta: string
  tone?: 'good' | 'bad' | 'warn'
  bar?: number | null
  onClick: () => void
}) {
  return (
    <button className="sum-card" onClick={onClick}>
      <span className="sum-label">{label}</span>
      <span className={`sum-value${tone ? ` ${tone}` : ''}`}>{value}</span>
      <span className="sum-meta">{meta}</span>
      {bar != null && (
        <span className="sum-bar"><span className="sum-bar-fill" style={{ width: `${Math.min(100, bar)}%` }} /></span>
      )}
    </button>
  )
}

/**
 * How money arrived, one chip per method.
 *
 * Card and bank transfer are not interchangeable: the tenant pays a different
 * surcharge for each, and only ACH has a days-long gap between "paid" and
 * "landed". A chip therefore carries both the amount and, when some of it is
 * still clearing, how much — so "ACH $2,400" and "ACH $2,400, $800 clearing"
 * can never be read as the same thing.
 */
function MethodChips({ slices }: { slices: MethodSlice[] }) {
  return (
    <div className="mchips">
      {slices.map(s => {
        const meta = METHOD_META[s.method]
        return (
          <span
            key={s.method}
            className="mchip"
            style={{ background: meta.bg, color: meta.color }}
            title={`${s.count} payment${s.count !== 1 ? 's' : ''} by ${meta.label}`}
          >
            <span className="mchip-dot" style={{ background: meta.color }} aria-hidden="true" />
            <span className="mchip-label">{meta.short}</span>
            <strong className="mchip-amt">{fmtCurrency(s.amount)}</strong>
            {s.clearing > 0 && (
              <span className="mchip-clearing">{fmtCurrency(s.clearing)} clearing</span>
            )}
          </span>
        )
      })}
    </div>
  )
}

function Fact({ label, value, meta }: { label: string; value: string; meta?: string }) {
  return (
    <div className="fact">
      <div className="fact-label">{label}</div>
      <div className="fact-value">{value}</div>
      {meta && <div className="fact-meta">{meta}</div>}
    </div>
  )
}

function Fig({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <span className="fig">
      <span className={`fig-val${tone ? ` ${tone}` : ''}`}>{value}</span>
      <span className="fig-lbl">{label}</span>
    </span>
  )
}

function DrillFact({
  label, value, meta, tone,
}: { label: string; value: string; meta: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="dfact">
      <div className="dfact-label">{label}</div>
      <div className={`dfact-value${tone ? ` ${tone}` : ''}`}>{value}</div>
      <div className="dfact-meta">{meta}</div>
    </div>
  )
}

function StagePill({ stage }: { stage: LeaseSummary['stage'] }) {
  const cls =
    stage === 'ending' ? 'warn'
    : stage === 'ended' ? 'plain'
    : stage === 'upcoming' ? 'info'
    : 'good'
  return <span className={`pill ${cls}`}>{STAGE_LABEL[stage]}</span>
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  /* A restrained palette and a lot of air: one accent, hairline separators,
     and every figure set in tabular numerals so columns of money line up
     digit-for-digit down the page — the whole point of a grouped table. */
  .fin-wrap {
    --ink:      #1d1d1f;
    --ink-2:    #6e6e73;
    --ink-3:    #8e8e93;
    --line:     #e5e5ea;
    --line-2:   #f0f0f2;
    --surface:  #ffffff;
    --accent:   #0071e3;
    --good:     #1d8a4e;
    --warn:     #b25000;
    --bad:      #d13b30;
    max-width: 940px; margin: 0 auto; padding: 32px 22px 96px;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'DM Sans', sans-serif;
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
  }
  /* The grouped tables need the room; the ledger beneath them does too. */
  .fin-wrap.wide { max-width: 1120px; }

  .title { font-size: 30px; font-weight: 600; letter-spacing: -0.022em; line-height: 1.15; }
  .sub   { font-size: 14px; color: var(--ink-2); margin-top: 5px; letter-spacing: -0.01em; }

  .fin-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 22px; }

  .btn-primary {
    background: var(--accent); color: #fff; border: none; border-radius: 980px;
    padding: 9px 18px; font-size: 14px; font-weight: 500; font-family: inherit;
    cursor: pointer; text-decoration: none; display: inline-block; white-space: nowrap;
    letter-spacing: -0.01em; transition: opacity 0.15s;
  }
  .btn-primary:hover { opacity: 0.85; }
  .btn-primary.sm { padding: 7px 15px; font-size: 13px; }
  .btn-quiet {
    background: none; border: none; color: var(--accent); font-size: 14px;
    text-decoration: none; white-space: nowrap; letter-spacing: -0.01em; cursor: pointer;
    font-family: inherit; padding: 0;
  }
  .btn-quiet:hover { text-decoration: underline; }

  /* ── Back affordance ── */
  .back {
    display: inline-flex; align-items: center; gap: 5px; background: none; border: none;
    padding: 0; margin-bottom: 16px; cursor: pointer; font-family: inherit;
    font-size: 14px; color: var(--accent); letter-spacing: -0.01em;
  }
  .back-chev {
    width: 7px; height: 7px; border-left: 1.7px solid currentColor; border-bottom: 1.7px solid currentColor;
    transform: rotate(45deg); display: inline-block;
  }
  .back:hover { text-decoration: underline; }

  .led-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
  .led-head-main { min-width: 0; }
  .led-note { font-size: 13px; color: var(--ink-2); line-height: 1.6; margin: 18px 0; letter-spacing: -0.01em; }

  /* ── Reporting window ── */
  .scope-bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
  .scope-hint { font-size: 12.5px; color: var(--ink-3); letter-spacing: -0.01em; }

  .seg {
    display: inline-flex; background: var(--line-2); border-radius: 10px; padding: 2px;
    gap: 2px; max-width: 100%; overflow-x: auto;
  }
  .seg.full { display: flex; margin-bottom: 20px; }
  .seg-btn {
    border: none; background: none; font-family: inherit; cursor: pointer;
    padding: 7px 16px; border-radius: 8px; font-size: 13.5px; font-weight: 500;
    color: var(--ink-2); letter-spacing: -0.01em; white-space: nowrap;
    display: inline-flex; align-items: center; gap: 7px;
    transition: background 0.18s, color 0.18s, box-shadow 0.18s;
  }
  .seg.full .seg-btn { flex: 1; justify-content: center; }
  .seg-btn:hover { color: var(--ink); }
  .seg-btn.on {
    background: var(--surface); color: var(--ink);
    box-shadow: 0 1px 3px rgba(0,0,0,0.10), 0 0 0 0.5px rgba(0,0,0,0.04);
  }
  .seg-badge {
    background: #d8d8dc; color: #4a4a4f; font-size: 11px; font-weight: 600;
    border-radius: 980px; padding: 1px 7px; font-variant-numeric: tabular-nums;
  }
  .seg-badge.bad { background: #fdeceb; color: var(--bad); }

  /* ── Summary: the figures that add up ── */
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 14px; }
  .sum-card {
    display: flex; flex-direction: column; align-items: flex-start; gap: 0;
    background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
    padding: 18px 20px 16px; text-align: left; font-family: inherit; cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s;
  }
  .sum-card:hover { border-color: #d6d6db; box-shadow: 0 2px 10px rgba(0,0,0,0.045); }
  .sum-card:active { transform: scale(0.995); }
  .sum-label { font-size: 12.5px; color: var(--ink-2); letter-spacing: -0.01em; }
  .sum-value {
    font-size: 27px; font-weight: 600; letter-spacing: -0.025em; margin-top: 5px;
    font-variant-numeric: tabular-nums; line-height: 1.1;
  }
  .sum-value.good { color: var(--good); }
  .sum-value.bad  { color: var(--bad); }
  .sum-value.warn { color: var(--warn); }
  .sum-meta { font-size: 12px; color: var(--ink-3); margin-top: 6px; letter-spacing: -0.01em; }
  .sum-bar { display: block; width: 100%; height: 3px; background: var(--line-2); border-radius: 99px; margin-top: 12px; overflow: hidden; }
  .sum-bar-fill { display: block; height: 100%; background: var(--good); border-radius: 99px; transition: width 0.4s cubic-bezier(0.4,0,0.2,1); }

  /* ── Standing facts ── */
  .facts {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 0;
    background: var(--surface); border: 1px solid var(--line); border-radius: 14px;
    padding: 4px; margin-bottom: 22px;
  }
  .fact { padding: 12px 16px; border-left: 1px solid var(--line-2); }
  .fact:first-child { border-left: none; }
  .fact-label { font-size: 11.5px; color: var(--ink-3); letter-spacing: -0.005em; }
  .fact-value { font-size: 16px; font-weight: 600; letter-spacing: -0.015em; margin-top: 3px; font-variant-numeric: tabular-nums; }
  .fact-meta { font-size: 11.5px; color: var(--ink-3); margin-top: 2px; }

  /* ── How money arrived ── */
  .methods-bar {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    background: var(--surface); border: 1px solid var(--line); border-radius: 14px;
    padding: 13px 18px; margin-bottom: 22px;
  }
  .methods-label { font-size: 12.5px; color: var(--ink-2); letter-spacing: -0.01em; }
  .mchips { display: flex; gap: 8px; flex-wrap: wrap; }
  .mchip {
    display: inline-flex; align-items: center; gap: 7px;
    border-radius: 980px; padding: 5px 13px 5px 10px; font-size: 12.5px;
    letter-spacing: -0.01em; white-space: nowrap;
  }
  .mchip-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .mchip-label { font-weight: 500; }
  .mchip-amt { font-variant-numeric: tabular-nums; font-weight: 600; }
  /* The clearing share rides inside the chip, not beside it: an ACH figure
     without it reads as money the landlord already has. */
  .mchip-clearing {
    font-size: 11px; opacity: 0.85; padding-left: 7px;
    border-left: 1px solid currentColor; font-variant-numeric: tabular-nums;
  }

  /* ── Payments received ── */
  .netband { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 18px 20px 14px; margin-bottom: 16px; }
  .netband-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; }
  .netband-note { font-size: 12.5px; color: var(--ink-2); line-height: 1.6; margin-top: 14px; padding-top: 13px; border-top: 1px solid var(--line-2); letter-spacing: -0.01em; }

  .recv-tools { display: flex; align-items: center; gap: 12px; }
  .chipbtn {
    border: 1px solid var(--line); background: var(--surface); border-radius: 980px;
    padding: 5px 13px; font-size: 12.5px; font-family: inherit; cursor: pointer;
    color: var(--ink-2); letter-spacing: -0.01em; transition: all 0.15s;
  }
  .chipbtn:hover { border-color: #d6d6db; color: var(--ink); }
  .chipbtn.on { background: #fdeceb; border-color: #f3c6c2; color: var(--bad); font-weight: 500; }

  .rtbl { border-top: 1px solid var(--line); }
  .rtbl-hd, .rtbl-row {
    display: grid;
    grid-template-columns: minmax(240px, 2.4fr) 118px 104px 94px 128px 14px;
    gap: 10px; align-items: center;
  }
  .rtbl-hd {
    padding: 9px 20px; background: #fafafb; border-bottom: 1px solid var(--line);
    font-size: 11px; font-weight: 600; color: var(--ink-3);
    text-transform: uppercase; letter-spacing: 0.045em;
  }
  .rtbl-row { padding: 12px 20px; border-bottom: 1px solid var(--line-2); cursor: pointer; transition: background 0.12s; }
  .rtbl-row:hover { background: #fafafb; }
  .cell-when { min-width: 0; }
  .when-date { display: block; font-size: 13px; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
  .when-time { display: block; font-size: 11.5px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
  .when-time em { font-style: normal; opacity: 0.75; }
  .num.strong { font-weight: 600; }
  .drill-warn { font-size: 12px; color: var(--warn); cursor: help; }

  /* ── Panels ── */
  .panel { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; margin-bottom: 16px; overflow: hidden; }
  .panel-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 18px 22px 14px; }
  .panel-title { font-size: 16px; font-weight: 600; letter-spacing: -0.015em; }
  .panel-note { font-size: 12.5px; color: var(--ink-3); letter-spacing: -0.01em; text-align: right; font-variant-numeric: tabular-nums; }
  .panel-bd { padding: 4px 22px 20px; }
  .panel-bd.flush { padding: 0; }

  /* ── Property block ── */
  .prop { overflow: visible; }
  .prop-hd {
    display: flex; align-items: center; gap: 12px; width: 100%;
    background: none; border: none; font-family: inherit; text-align: left;
    padding: 16px 20px 14px; cursor: pointer; color: inherit;
  }
  .prop-hd:hover { background: #fcfcfd; }
  .prop-id { flex: 1; min-width: 0; }
  .prop-name { display: block; font-size: 17px; font-weight: 600; letter-spacing: -0.018em; }
  .prop-sub { display: block; font-size: 12.5px; color: var(--ink-2); margin-top: 3px; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
  .prop-figs { display: flex; gap: 26px; flex-shrink: 0; }
  .fig { display: flex; flex-direction: column; align-items: flex-end; }
  .fig-val { font-size: 15.5px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.015em; }
  .fig-val.good { color: var(--good); }
  .fig-val.bad  { color: var(--bad); }
  .fig-val.warn { color: var(--warn); }
  .fig-lbl { font-size: 11px; color: var(--ink-3); margin-top: 1px; }

  .prop-bar { height: 3px; background: var(--line-2); }
  .prop-bar-fill { height: 100%; background: var(--good); transition: width 0.4s cubic-bezier(0.4,0,0.2,1); }
  .prop-bar-fill[data-tone="bad"]  { background: var(--bad); }
  .prop-bar-fill[data-tone="warn"] { background: #e8a33d; }

  /* Disclosure triangle — the one affordance that says "this opens in place". */
  .disc {
    width: 0; height: 0; flex-shrink: 0;
    border-left: 5.5px solid #b4b4b9; border-top: 4.5px solid transparent; border-bottom: 4.5px solid transparent;
    transition: transform 0.18s ease; transform-origin: 25% 50%;
  }
  .disc.open { transform: rotate(90deg); }
  .disc.sm { border-left-width: 4.5px; border-top-width: 3.5px; border-bottom-width: 3.5px; }

  /* ── The lease table ── */
  .tbl { border-top: 1px solid var(--line); }
  .tbl-hd, .tbl-row, .tbl-foot {
    display: grid;
    grid-template-columns: minmax(240px, 2.4fr) 68px 100px 108px 108px 118px 14px;
    gap: 10px; align-items: center;
  }
  .tbl-hd {
    padding: 9px 20px; background: #fafafb; border-bottom: 1px solid var(--line);
    font-size: 11px; font-weight: 600; color: var(--ink-3);
    text-transform: uppercase; letter-spacing: 0.045em;
  }
  .tbl-row {
    padding: 13px 20px; border-bottom: 1px solid var(--line-2);
    cursor: pointer; transition: background 0.12s;
  }
  .tbl-row:hover { background: #fafafb; }
  .tbl-row.open { background: #f7f9fc; }
  .tbl-row.faded .cell-lease, .tbl-row.faded .num { opacity: 0.62; }
  .cell-lease { min-width: 0; }
  .lease-name {
    display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
    font-size: 14px; font-weight: 500; letter-spacing: -0.01em;
  }
  .lease-sub { display: block; font-size: 12px; color: var(--ink-2); margin-top: 3px; margin-left: 12px; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }

  .num { text-align: right; font-size: 13.5px; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; white-space: nowrap; }
  .num.good { color: var(--good); }
  .num.bad  { color: var(--bad); font-weight: 600; }
  .num.warn { color: var(--warn); }
  .num.dim  { color: var(--ink-3); }
  .num.info { color: #0057b8; }

  .tbl-foot {
    padding: 12px 20px; background: #fafafb; border-top: 1px solid var(--line);
    font-weight: 600; font-size: 13.5px;
  }
  .foot-label { font-size: 12.5px; color: var(--ink-2); font-weight: 500; letter-spacing: -0.01em; }

  /* ── Lease drill-down ── */
  .drill { background: #f7f9fc; border-bottom: 1px solid var(--line); padding: 4px 20px 18px; }
  .drill-vitals { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; padding: 14px 0 4px; }
  .util-note {
    display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    margin: 12px 0 2px; padding: 10px 13px; border-radius: 10px;
    background: #f4fbfa; border: 1px solid #cdeae6; color: #15605a;
    font-size: 12.5px; line-height: 1.5; letter-spacing: -0.01em;
  }
  .util-note strong { font-variant-numeric: tabular-nums; color: #0f4f4a; }
  .dfact { padding: 0 16px; border-left: 1px solid #e3e8ef; }
  .dfact:first-child { border-left: none; padding-left: 0; }
  .dfact-label { font-size: 11.5px; color: var(--ink-3); letter-spacing: -0.005em; }
  .dfact-value { font-size: 17px; font-weight: 600; letter-spacing: -0.018em; margin-top: 3px; font-variant-numeric: tabular-nums; }
  .dfact-value.good { color: var(--good); }
  .dfact-value.bad  { color: var(--bad); }
  .dfact-meta { font-size: 11.5px; color: var(--ink-3); margin-top: 2px; }

  .drill-sec { margin-top: 18px; }
  .drill-hd {
    display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
    font-size: 11px; font-weight: 600; color: var(--ink-3);
    text-transform: uppercase; letter-spacing: 0.045em; margin-bottom: 8px;
  }
  .drill-hd-note { text-transform: none; letter-spacing: -0.01em; font-weight: 500; font-size: 11.5px; font-variant-numeric: tabular-nums; }

  .payers { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  .payer {
    display: grid; grid-template-columns: minmax(180px, 2fr) 96px 100px 100px 112px;
    gap: 10px; align-items: center; padding: 10px 14px; border-top: 1px solid var(--line-2);
  }
  .payer:first-child { border-top: none; }
  .payer.faded { opacity: 0.6; }
  .payer-who { display: flex; align-items: center; gap: 9px; min-width: 0; }
  .avatar {
    width: 26px; height: 26px; border-radius: 50%; background: #e8ecf1; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 600; color: #5b6676;
  }
  .payer-id { min-width: 0; }
  .payer-name { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; letter-spacing: -0.01em; }
  .payer-mail { display: block; font-size: 11.5px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip {
    display: flex; flex-direction: column; gap: 2px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 11px;
    padding: 9px 13px; font-size: 13px; letter-spacing: -0.01em;
  }
  .chip strong { font-variant-numeric: tabular-nums; }
  .chip.bad { border-color: #f3c6c2; background: #fffafa; }
  .chip-meta { font-size: 11.5px; color: var(--ink-3); }

  .drill-actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-top: 18px; }
  .drill-note { font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }

  /* ── Lease vitals, above the ledger ── */
  .vitals { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 18px 20px 16px; }
  .vitals-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0; }
  .vitals-bar { position: relative; height: 6px; background: var(--line-2); border-radius: 99px; margin-top: 18px; }
  .vitals-fill { height: 100%; background: var(--good); border-radius: 99px; transition: width 0.4s cubic-bezier(0.4,0,0.2,1); }
  /* Collection against term elapsed: if the marker is ahead of the fill, the
     lease is behind where it should be — the fastest read of a tenancy. */
  .vitals-mark { position: absolute; top: -3px; width: 2px; height: 12px; background: var(--ink); border-radius: 2px; }
  .vitals-key { display: flex; gap: 16px; flex-wrap: wrap; font-size: 11.5px; color: var(--ink-3); margin-top: 8px; }

  /* ── Charges grouped under their property ── */
  .chg-group { border-top: 1px solid var(--line); }
  .chg-group:first-child { border-top: none; }
  .chg-group-hd {
    padding: 11px 22px 8px; background: #fafafb; font-size: 11px; font-weight: 600;
    color: var(--ink-3); text-transform: uppercase; letter-spacing: 0.045em;
  }

  /* ── Chart ── */
  .chart { display: flex; align-items: flex-end; gap: 10px; height: 160px; }
  .col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; min-width: 0; }
  .col-stack { flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center; }
  .col-exp { width: 100%; max-width: 46px; background: var(--line-2); border-radius: 6px 6px 0 0; display: flex; align-items: flex-end; min-height: 3px; }
  .col-col { width: 100%; background: var(--good); border-radius: 6px 6px 0 0; }
  .col-col[data-tone="low"] { background: #e8a33d; }
  .col-pct { font-size: 11px; font-weight: 500; color: var(--ink-2); margin-top: 8px; font-variant-numeric: tabular-nums; }
  .col-label { font-size: 11px; color: var(--ink-3); margin-top: 2px; }
  .chart-key { font-size: 12px; color: var(--ink-3); margin-top: 16px; line-height: 1.55; letter-spacing: -0.01em; }

  /* ── Rows ── */
  .row {
    display: flex; align-items: center; gap: 14px; padding: 14px 22px;
    border-top: 1px solid var(--line-2); text-decoration: none; color: inherit; cursor: pointer;
    transition: background 0.12s;
  }
  .row:first-child { border-top: none; }
  .row:hover { background: #fafafb; }
  .row.static { cursor: default; }
  .row.static:hover { background: none; }
  .row-main { flex: 1; min-width: 0; }
  .row-name { font-size: 14px; font-weight: 500; letter-spacing: -0.01em; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .row-sub { font-size: 12.5px; color: var(--ink-2); margin-top: 3px; letter-spacing: -0.01em; }
  .row-err { font-size: 12px; color: var(--bad); margin-top: 3px; }
  .row-fig { text-align: right; white-space: nowrap; }
  .row-amt { font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
  .row-amt-lbl { font-size: 11.5px; color: var(--ink-3); margin-top: 2px; }
  .row-chev {
    width: 7px; height: 7px; border-top: 1.6px solid #c7c7cc; border-right: 1.6px solid #c7c7cc;
    transform: rotate(45deg); flex-shrink: 0;
  }
  .who { font-size: 12.5px; color: var(--ink-2); font-weight: 400; }

  /* ── Pills ── */
  .pill { font-size: 11px; font-weight: 500; padding: 2px 9px; border-radius: 980px; letter-spacing: -0.005em; white-space: nowrap; }
  .pill.bad   { background: #fdeceb; color: var(--bad); }
  .pill.good  { background: #e8f5ed; color: var(--good); }
  .pill.warn  { background: #fdf1e3; color: var(--warn); }
  .pill.info  { background: #e8f1fd; color: #0057b8; }
  .pill.plain { background: var(--line-2); color: var(--ink-2); }

  /* ── Empty / loading ── */
  .empty { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; padding: 56px 36px; text-align: center; }
  .empty-title { font-size: 19px; font-weight: 600; letter-spacing: -0.015em; margin-bottom: 8px; }
  .empty-sub { font-size: 14px; color: var(--ink-2); line-height: 1.6; max-width: 400px; margin: 0 auto 22px; letter-spacing: -0.01em; }
  .skeleton-hero { height: 190px; border-radius: 18px; background: linear-gradient(90deg,#f2f2f4,#f7f7f9,#f2f2f4); background-size: 200% 100%; animation: sk 1.4s ease-in-out infinite; }
  @keyframes sk { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }

  .lnk { color: var(--accent); text-decoration: none; }
  .lnk:hover { text-decoration: underline; }
  .muted { font-size: 13.5px; color: var(--ink-2); line-height: 1.6; letter-spacing: -0.01em; }
  .muted.sm { font-size: 12.5px; }

  /* ── Narrow screens ──
     The money columns are the first thing to go: on a phone a lease is a name
     and one number — what is still owed — and everything else lives one tap
     deeper, where there is room to lay it out properly. */
  @media (max-width: 1040px) {
    .tbl-hd, .tbl-row, .tbl-foot { grid-template-columns: minmax(180px, 2.2fr) 96px 104px 112px 14px; }
    .tbl-hd > :nth-child(2), .tbl-row > :nth-child(2), .tbl-foot > :nth-child(2),
    .tbl-hd > :nth-child(3), .tbl-row > :nth-child(3), .tbl-foot > :nth-child(3) { display: none; }
  }
  /* ── Section walls ─────────────────────────────────────────────────────────
     The page now carries three kinds of question, and a reader needs to know
     which one they are in. A labelled rule does that more quietly than a box. */
  .sec-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 4px 0 12px; }
  .sec-hd.wall { margin-top: 38px; padding-top: 20px; border-top: 1px solid var(--line); }
  .sec-title { font-size: 17px; font-weight: 600; letter-spacing: -0.018em; }
  .sec-note { font-size: 12.5px; color: var(--ink-3); letter-spacing: -0.01em; }

  .lease-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 22px; }
  .seg-badge.quiet { background: var(--line-2); color: var(--ink-2); }
  .seg-btn.on .seg-badge.quiet { background: rgba(255,255,255,0.22); color: #fff; }

  /* ── Where things stand ───────────────────────────────────────────────────
     The headline tile is wider and louder than the other three on purpose:
     "what am I owed" outranks every other figure on the page. */
  .now { margin-bottom: 18px; }
  .now-tiles { display: grid; grid-template-columns: 1.6fr 1fr 1fr 1fr; gap: 12px; }
  .now-tile {
    background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
    padding: 16px 18px 15px; display: flex; flex-direction: column; min-width: 0;
  }
  .now-tile.wide { background: #fbfbfd; }
  .now-tile.wide.bad { background: #fff8f7; border-color: #f6cfcb; }
  .now-tile.wide.good { background: #f7fcf9; border-color: #cfe9d9; }
  .now-label { font-size: 11.5px; font-weight: 500; color: var(--ink-2); text-transform: uppercase; letter-spacing: 0.055em; }
  .now-value {
    font-size: 27px; font-weight: 600; letter-spacing: -0.024em; line-height: 1.12;
    margin-top: 7px; font-variant-numeric: tabular-nums;
  }
  .now-tile.wide .now-value { font-size: 34px; }
  .now-tile.bad .now-value { color: var(--bad); }
  .now-tile.good .now-value { color: var(--good); }
  .now-meta { font-size: 12.5px; color: var(--ink-2); margin-top: 6px; letter-spacing: -0.01em; line-height: 1.45; font-variant-numeric: tabular-nums; }
  .now-foot { font-size: 11.5px; color: var(--ink-3); margin-top: 5px; font-variant-numeric: tabular-nums; }

  /* ── Missed payments ─────────────────────────────────────────────────────── */
  .panel.missed.hot { border-color: #f2cdc9; }
  .panel-count {
    display: inline-block; margin-left: 8px; background: #fdeceb; color: var(--bad);
    font-size: 11.5px; font-weight: 600; border-radius: 980px; padding: 1px 8px;
    vertical-align: 2px; font-variant-numeric: tabular-nums;
  }
  .panel-ft {
    display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    padding: 12px 22px; border-top: 1px solid var(--line-2); background: #fbfbfd;
    font-size: 12.5px; color: var(--ink-2); letter-spacing: -0.01em;
  }
  .panel-ft strong { color: var(--ink); font-variant-numeric: tabular-nums; }

  .miss { border-top: 1px solid var(--line-2); }
  .miss:first-child { border-top: none; }
  .miss-row {
    display: grid; grid-template-columns: 14px 1fr auto; align-items: center; gap: 12px;
    padding: 13px 22px; cursor: pointer;
  }
  .miss-row:hover { background: #fcfcfd; }
  .miss-main { min-width: 0; }
  .miss-name { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 14.5px; font-weight: 500; letter-spacing: -0.012em; }
  .miss-sub { font-size: 12.5px; color: var(--ink-2); margin-top: 3px; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
  .miss-fig { text-align: right; }
  .miss-amt { font-size: 17px; font-weight: 600; color: var(--bad); font-variant-numeric: tabular-nums; letter-spacing: -0.018em; }
  .miss-amt-lbl { font-size: 11.5px; color: var(--ink-3); margin-top: 2px; font-variant-numeric: tabular-nums; }

  .twist {
    width: 7px; height: 7px; border-right: 1.5px solid var(--ink-3); border-bottom: 1.5px solid var(--ink-3);
    transform: rotate(-45deg); transition: transform 0.15s; margin-left: 2px;
  }
  .twist.open { transform: rotate(45deg); }

  .miss-detail { padding: 2px 22px 16px 48px; background: #fcfcfd; border-top: 1px solid var(--line-2); }
  .miss-charge {
    display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
    padding: 7px 0; border-bottom: 1px solid var(--line-2); font-size: 13px; letter-spacing: -0.01em;
  }
  .mc-label { font-weight: 500; min-width: 150px; }
  .mc-due { color: var(--ink-3); font-size: 12px; font-variant-numeric: tabular-nums; flex: 1; }
  .mc-amt { font-weight: 600; font-variant-numeric: tabular-nums; }
  .mc-part { font-weight: 400; color: var(--ink-3); font-size: 12px; }
  .mc-fee { font-size: 11.5px; color: var(--warn); font-variant-numeric: tabular-nums; }
  .miss-detail .btn-quiet { margin-top: 12px; }

  /* ── Upcoming strip ──────────────────────────────────────────────────────── */
  .strip { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 10px; align-items: end; padding: 6px 0 2px; }
  .strip-col {
    display: flex; flex-direction: column; align-items: center; gap: 7px;
    background: none; border: 1px solid transparent; border-radius: 14px;
    padding: 10px 6px 9px; cursor: pointer; font-family: inherit; color: inherit;
    transition: background 0.15s, border-color 0.15s;
  }
  .strip-col:hover { background: #fbfbfd; border-color: var(--line); }
  .strip-col.on { background: #f3f8ff; border-color: #bcd9fb; }
  .strip-amt { font-size: 12.5px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.012em; }
  /* A fixed-height track, so bar heights are comparable between months. */
  .strip-bars { position: relative; display: block; width: 100%; max-width: 54px; height: 76px; }
  .strip-bar {
    position: absolute; left: 0; right: 0; bottom: 0; border-radius: 6px 6px 0 0;
    background: linear-gradient(180deg, #9cc6f5, #6aa8ee); min-height: 2px;
  }
  .strip-col.on .strip-bar { background: linear-gradient(180deg, #4b9bf0, var(--accent)); }
  /* Money already in for that month sits at the foot of the same track. */
  .strip-paid {
    position: absolute; left: 0; right: 0; bottom: 0; border-radius: 6px 6px 0 0;
    background: #9ad9b4; min-height: 2px;
  }
  .strip-lbl { font-size: 12px; color: var(--ink-2); letter-spacing: -0.01em; display: flex; align-items: center; gap: 5px; }
  .strip-col.on .strip-lbl { color: var(--ink); font-weight: 500; }
  .strip-now { font-size: 9.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; background: var(--line-2); color: var(--ink-2); border-radius: 980px; padding: 1px 6px; }
  .strip-flag { font-size: 10.5px; font-weight: 500; color: var(--bad); font-variant-numeric: tabular-nums; }

  /* ── The named month ─────────────────────────────────────────────────────── */
  .panel.month { border-color: #d9d9e0; }
  .month-hd {
    display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
    padding: 16px 22px 14px; border-bottom: 1px solid var(--line-2);
  }
  .month-nav { display: flex; align-items: center; gap: 10px; }
  .mn-btn {
    width: 31px; height: 31px; flex-shrink: 0; border-radius: 50%;
    border: 1px solid var(--line); background: var(--surface); color: var(--ink);
    font-size: 17px; line-height: 1; cursor: pointer; font-family: inherit;
    display: flex; align-items: center; justify-content: center; transition: background 0.15s;
  }
  .mn-btn:hover { background: var(--line-2); }
  .month-title { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .month-name { font-size: 21px; font-weight: 600; letter-spacing: -0.021em; }
  .month-when { font-size: 12px; color: var(--ink-3); letter-spacing: -0.005em; text-transform: uppercase; font-weight: 500; letter-spacing: 0.05em; }

  .month-figs { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid var(--line-2); }
  .mf { padding: 14px 22px; border-left: 1px solid var(--line-2); }
  .mf:first-child { border-left: none; }
  .mf-label { font-size: 11.5px; color: var(--ink-2); letter-spacing: -0.005em; }
  .mf-value { font-size: 19px; font-weight: 600; letter-spacing: -0.02em; margin-top: 4px; font-variant-numeric: tabular-nums; }
  .mf.good .mf-value { color: var(--good); }
  .mf.warn .mf-value { color: var(--warn); }
  .mf.bad  .mf-value { color: var(--bad); }
  .mf-meta { font-size: 11.5px; color: var(--ink-3); margin-top: 3px; font-variant-numeric: tabular-nums; }

  .muted.pad { padding: 18px 22px; }

  .ml { border-bottom: 1px solid var(--line-2); }
  .ml:last-child { border-bottom: none; }
  .ml-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; flex-wrap: wrap; padding: 14px 22px 10px; }
  .ml-name { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 14.5px; font-weight: 600; letter-spacing: -0.014em; }
  .ml-sub { font-size: 12px; color: var(--ink-2); margin-top: 3px; letter-spacing: -0.01em; }
  .ml-figs { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .ml-fig { font-size: 12.5px; color: var(--ink-2); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
  .ml-fig b { font-size: 14.5px; font-weight: 600; color: var(--ink); }
  .ml-fig.owed b { color: var(--bad); }

  /* One payer, one line: who, the state of each of their charges, the figure.
     A shared house is six of these and must stay readable at a glance. */
  .ml-payers { padding: 0 22px 12px; }
  .mp {
    display: grid; grid-template-columns: minmax(120px, 1.1fr) minmax(0, 2.4fr) auto;
    align-items: center; gap: 12px; padding: 8px 0; border-top: 1px solid var(--line-2);
  }
  .mp-who { font-size: 13.5px; font-weight: 500; letter-spacing: -0.012em; min-width: 0; }
  .mp-charges { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; min-width: 0; }
  .mp-charge { display: inline-flex; align-items: center; gap: 7px; }
  .mp-c-label { font-size: 12px; color: var(--ink-2); letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
  .mp-late { font-size: 11px; font-weight: 500; color: var(--bad); font-variant-numeric: tabular-nums; }
  .mp-fig { text-align: right; }
  .mp-amt { display: block; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.014em; }
  .mp-amt.owed { color: var(--bad); }
  .mp-amt-lbl { display: block; font-size: 11px; color: var(--ink-3); font-variant-numeric: tabular-nums; }

  /* Charge state, as a pill. Quiet for "scheduled": a future charge is the
     normal case and should not shout alongside a missed one. */
  .st { font-size: 10.5px; font-weight: 600; padding: 2px 8px; border-radius: 980px; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; }
  .st-good  { background: #e8f5ed; color: var(--good); }
  .st-bad   { background: #fdeceb; color: var(--bad); }
  .st-warn  { background: #fdf1e3; color: var(--warn); }
  .st-info  { background: #e8f1fd; color: #0057b8; }
  .st-quiet { background: var(--line-2); color: var(--ink-3); }

  @media (max-width: 1040px) {
    .now-tiles { grid-template-columns: 1fr 1fr; }
    .now-tile.wide { grid-column: span 2; }
  }
  @media (max-width: 820px) {
    .month-figs { grid-template-columns: repeat(2, 1fr); }
    .mf:nth-child(3) { border-left: none; }
    .mf:nth-child(n+3) { border-top: 1px solid var(--line-2); }
    .mp { grid-template-columns: 1fr auto; }
    .mp-charges { grid-column: 1 / -1; }
  }
  @media (max-width: 700px) {
    .now-tiles { grid-template-columns: 1fr; }
    .now-tile.wide { grid-column: auto; }
    .strip { grid-auto-flow: row; grid-auto-columns: auto; }
    .strip-col { flex-direction: row; justify-content: space-between; padding: 9px 12px; }
    .strip-bars { display: none; }
    .month-name { font-size: 19px; }
    .miss-row { padding: 12px 16px; }
    .miss-detail { padding-left: 16px; }
    .mc-label { min-width: 0; }
  }

  @media (max-width: 1040px) {
    .rtbl-hd, .rtbl-row { grid-template-columns: minmax(180px, 2.2fr) 110px 128px 14px; }
    .rtbl-hd > :nth-child(3), .rtbl-row > :nth-child(3),
    .rtbl-hd > :nth-child(4), .rtbl-row > :nth-child(4) { display: none; }
  }
  @media (max-width: 820px) {
    .netband-row { grid-template-columns: 1fr; row-gap: 14px; }
    .netband-row .dfact { border-left: none; padding-left: 0; }
    .summary { grid-template-columns: repeat(2, 1fr); }
    .facts { grid-template-columns: repeat(2, 1fr); }
    .fact:nth-child(3) { border-left: none; }
    .fact:nth-child(odd) { border-left: none; }
    .drill-vitals { grid-template-columns: repeat(2, 1fr); row-gap: 14px; }
    .dfact:nth-child(odd) { border-left: none; padding-left: 0; }
    .vitals-row { grid-template-columns: repeat(2, 1fr); row-gap: 14px; }
    .prop-figs { gap: 16px; }
    .prop-figs .fig:first-child { display: none; }
  }
  @media (max-width: 700px) {
    .fin-wrap { padding: 24px 16px 90px; }
    .title { font-size: 26px; }
    .sum-value { font-size: 23px; }
    .tbl-hd, .tbl-row, .tbl-foot { grid-template-columns: 1fr 112px 14px; }
    .tbl-hd > :nth-child(4), .tbl-row > :nth-child(4), .tbl-foot > :nth-child(4),
    .tbl-hd > :nth-child(5), .tbl-row > :nth-child(5), .tbl-foot > :nth-child(5) { display: none; }
    .payer { grid-template-columns: 1fr 112px; row-gap: 4px; }
    .payer > :nth-child(2), .payer > :nth-child(3), .payer > :nth-child(4) { display: none; }
    .row-fig { text-align: right; }
    .prop-figs .fig:nth-child(2) { display: none; }
  }
`
