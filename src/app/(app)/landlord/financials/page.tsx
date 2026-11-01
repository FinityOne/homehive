'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { getCurrentUser, supabase } from '@/lib/supabase'
import { getPlansForOwner, fmtCurrency, fmtDate, type PaymentPlan } from '@/lib/payments'
import {
  buildPortfolio, METHOD_META,
  type LeaseSummary,
} from '@/lib/financialsRollup'
import {
  filterPlans, stageCounts, standing, arrears, monthView, upcomingMonths, allCharges,
  monthKeyOf, monthLabel, shiftMonth, monthsBetween, CHARGE_STATE_META, LEASE_FILTERS,
  type LeaseFilter, type MonthKey, type MonthView, type MonthLease, type UpcomingMonth,
  type Arrears, type Charge,
} from '@/lib/financialsMonth'

import {
  lateFeeLedger, withReminderHistory, EMPTY_LEDGER,
  type LateFeeLedger as FeeLedger, type LateFeeWaiver,
} from '@/lib/lateFees'

const PlanWorkspace = dynamic(() => import('@/components/payments/PlanWorkspace'), { ssr: false })
const LateFeesPanel = dynamic(() => import('@/components/payments/LateFeesPanel'), { ssr: false })

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
 *   3. **Money in** — the payments that actually arrived, newest first.
 *
 * It deliberately does *not* carry a reporting window any more. The bottom half
 * of this page used to be one: a period toggle, four totals that moved whenever
 * it changed, four standing facts repeating the tiles at the top, and four tabs
 * of tables that re-summed rows already on screen. None of it told a landlord
 * anything they could act on, and all of it had to be read past before reaching
 * the things that did. Reporting over an arbitrary window is an accountant's
 * question; a lease's own ledger and the admin books answer it.
 *
 * Every payment line on the page — a missed charge, a charge inside the month,
 * a payment that arrived — opens the same detail sheet: what was billed, what
 * the figure is made of, the fee the rule assessed and why, what has been paid
 * against it, and who has been chased.
 *
 * And a "due" figure means the same thing everywhere: the shortfall **plus**
 * the late fee the rule has assessed on it. A fee the landlord is entitled to
 * collect is money owed, so leaving it out made every total on the page smaller
 * than the figure the tenant should be quoted.
 *
 * Active leases are the default throughout. A landlord with three years of
 * tenancies behind them was reading past every one of them to find the rent
 * they could still collect. Ended leases are a toggle away — and arrears on a
 * hidden lease are still reported, so filtering can never hide money.
 */

/** How far ahead the look-ahead strip reaches. A year of rent is contracted, so
 *  this is knowable; more than this and the strip stops being scannable. */
const AHEAD_MONTHS = 6

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

export default function FinancialsPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; leases?: string; month?: string }>
}) {
  const { plan: planParam, leases: leasesParam, month: monthParam } = use(searchParams)

  const [plans, setPlans] = useState<PaymentPlan[]>([])
  const [loading, setLoading] = useState(true)
  // Which lease's ledger is open. null = the portfolio rollup.
  const [openPlanId, setOpenPlanId] = useState<string | null>(planParam ?? null)
  // Active leases unless asked otherwise — see LEASE_FILTERS.
  const [leaseFilter, setLeaseFilter] = useState<LeaseFilter>(
    LEASE_FILTERS.some(f => f.id === leasesParam) ? (leasesParam as LeaseFilter) : 'current'
  )
  // The month the ledger is pointed at. A key, not an offset, so it survives a
  // refresh and can be linked — and so it is still the same month tomorrow.
  const [month, setMonth] = useState<MonthKey>(
    /^\d{4}-\d{2}$/.test(monthParam ?? '') ? (monthParam as MonthKey) : monthKeyOf(new Date())
  )

  // The payment line being inspected, if any. One sheet serves every list on
  // the page, so a charge reads the same wherever it was clicked from.
  const [detail, setDetail] = useState<Charge | null>(null)

  // Waivers are the landlord's recorded decisions not to collect a fee. They
  // live outside the plan rows, so they are fetched alongside and netted off
  // the derived fees — see `lateFeeLedger`.
  const [waivers, setWaivers] = useState<LateFeeWaiver[]>([])

  useEffect(() => { document.title = 'Financials — Landlord | HomeHive' }, [])

  const loadWaivers = useCallback(async () => {
    // RLS keys this table on plan ownership, so no owner filter is needed here
    // and none would be trustworthy if it were.
    const { data } = await supabase
      .from('late_fee_waivers')
      .select('scheduled_payment_id, amount, reason, created_at')
    setWaivers((data ?? []).map(w => ({ ...w, amount: Number(w.amount) })))
  }, [])

  /** After a fee is chased or written off, both halves have moved. */
  const reloadMoney = useCallback(async () => {
    const user = await getCurrentUser()
    if (!user) return
    const [data] = await Promise.all([getPlansForOwner(user.id), loadWaivers()])
    setPlans(data)
  }, [loadWaivers])

  useEffect(() => {
    getCurrentUser().then(user => {
      if (!user) return
      getPlansForOwner(user.id).then(data => { setPlans(data); setLoading(false) })
      loadWaivers()
    })
  }, [loadWaivers])

  // ── Everything the page renders, derived in one place ────────────────────

  // The leases in view. Every figure below is over these — except arrears on
  // leases the filter excludes, which are reported separately rather than
  // silently dropped.
  const scoped = useMemo(() => filterPlans(plans, leaseFilter), [plans, leaseFilter])
  const counts = useMemo(() => stageCounts(plans), [plans])

  // Still built, but over the whole contracted term and never over a toggle:
  // all the page asks of it now is how many leases and properties are in view,
  // and the vitals strip above a single lease's ledger.
  const portfolio = useMemo(() => buildPortfolio(scoped, 'term'), [scoped])

  // Every charge on the leases in view, flattened once. The payments log and
  // every detail sheet read from this, so a figure cannot disagree with itself
  // depending on which list it was clicked from.
  const charges = useMemo(() => allCharges(scoped), [scoped])

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

  // Late fees still owed, across the whole of each lease — like arrears, bound
  // to no window, because a fee assessed in August is still unpaid in November.
  // Reminder history rides on the rent rows, so it is folded in here rather
  // than costing a second round trip.
  const feeLedger = useMemo<FeeLedger>(() => {
    if (scoped.length === 0) return EMPTY_LEDGER
    const history: Record<string, { count: number; lastAt: string | null }> = {}
    for (const p of scoped) {
      for (const sp of p.scheduled_payments ?? []) {
        if (sp.late_fee_reminder_count > 0) {
          history[sp.id] = { count: sp.late_fee_reminder_count, lastAt: sp.late_fee_reminder_sent_at }
        }
      }
    }
    return withReminderHistory(lateFeeLedger(scoped, waivers), history)
  }, [scoped, waivers])

  // The named month, and the months either side of it.
  const ledger    = useMemo(() => monthView(scoped, month), [scoped, month])
  const ahead     = useMemo(
    () => upcomingMonths(scoped, monthKeyOf(new Date()), AHEAD_MONTHS),
    [scoped],
  )
  const thisMonth = monthKeyOf(new Date())

  /** The URL carries the ledger, which leases and which month, so any view of
   *  the numbers can be linked or refreshed as-is. */
  const urlFor = (opts: {
    plan?: string | null; leases?: LeaseFilter; month?: MonthKey
  }) => {
    const planId = opts.plan !== undefined ? opts.plan : openPlanId
    if (planId) return `/landlord/financials?plan=${planId}`
    const q = new URLSearchParams()
    const f = opts.leases ?? leaseFilter
    const m = opts.month ?? month
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

  // The filter is a replace: flicking between stages should not fill the back
  // stack with places the landlord never meant to go.
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
      const f = q.get('leases')
      setLeaseFilter(LEASE_FILTERS.some(x => x.id === f) ? (f as LeaseFilter) : 'current')
      const m = q.get('month')
      setMonth(m && /^\d{4}-\d{2}$/.test(m) ? m : monthKeyOf(new Date()))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

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

  // ── The portfolio, top to bottom ─────────────────────────────────────────
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
                Arrears run for the whole tenancy, the next 30 days is the next
                30 days, and a deposit is held or it isn't. None of these four
                has a reporting period to be read against, which is exactly why
                they lead: a figure that moves when a window changes is a figure
                a landlord cannot act on. */}
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
              onInspect={setDetail}
            />

            {/* ══ 2b. LATE FEES — assessed by the lease, never collected ══
                Its own section rather than a line inside arrears: a fee on rent
                that has *already settled* is not arrears at all, and that is
                where nearly all of this money is. It also needs actions arrears
                does not have — writing a fee off is a legitimate outcome. */}
            <LateFeesPanel
              ledger={feeLedger}
              onReload={reloadMoney}
              onOpenLease={openLeaseLedger}
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
              onInspect={setDetail}
            />

            {/* ══ 5. MONEY IN — a log, not a report ══
                What used to sit here was a reporting half: a reporting-window
                toggle, four window-bound totals, four standing facts that
                repeated the tiles at the top of the page, and four tabs of
                tables underneath. Every figure in it moved when the window
                changed, which is exactly the property a landlord cannot act on,
                and all four tabs were *the same rows* this page already shows —
                summed differently.
                What is left is the one thing those tables had that nothing else
                on the page did: money that actually arrived, newest first, with
                a way into any single payment. No window, no toggle. */}
            <RecentPayments charges={charges} onInspect={setDetail} />
          </>
        )}
      </div>

      {/* Any payment line on the page opens here: what was billed, what it was
          made of, the fee the rule assessed, and what has arrived against it. */}
      {detail && (
        <ChargeDetail
          charge={detail}
          onClose={() => setDetail(null)}
          onOpenLedger={() => { const id = detail.planId; setDetail(null); openLeaseLedger(id) }}
        />
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
  arrears: a, hidden, filter, onShowAll, onOpen, onInspect,
}: {
  arrears: Arrears
  hidden: Arrears
  filter: LeaseFilter
  onShowAll: () => void
  onOpen: (planId: string) => void
  onInspect: (charge: Charge) => void
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
                    <button
                      key={`${c.kind}-${c.id}`}
                      className="miss-charge"
                      onClick={() => onInspect(c)}
                      title="See what this charge is made of"
                    >
                      <span className="mc-label">{c.label}</span>
                      <span className="mc-due">due {fmtDate(c.dueDate)} · {c.daysLate}d late</span>
                      {/* The fee is inside this figure, as it is everywhere else
                          on the page, and spelled out underneath it. */}
                      <span className="mc-amt">
                        {fmtCurrency(c.totalDue)}
                        {c.paid > 0 && <span className="mc-part"> of {fmtCurrency(c.amount)}</span>}
                      </span>
                      {c.lateFee > 0
                        ? <span className="mc-fee">incl. {fmtCurrency(c.lateFee)} late fee</span>
                        : <span className="mc-fee quiet">no fee</span>}
                      <span className="mc-chev" aria-hidden="true" />
                    </button>
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
                title={`${m.label} — ${fmtCurrency(m.expected)} still due of ${fmtCurrency(m.billed)} billed${
                  m.feesDue > 0 ? `, including ${fmtCurrency(m.feesDue)} of late fees` : ''
                }`}
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
  view, thisMonth, onSelect, onOpen, onInspect,
}: {
  view: MonthView
  thisMonth: MonthKey
  onSelect: (m: MonthKey) => void
  onOpen: (planId: string) => void
  onInspect: (charge: Charge) => void
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
          // Rent still owed *plus* the fees the rule has assessed on it — the
          // figure a landlord would actually quote, not the rent half of it.
          label="Still due"
          value={fmtCurrency(view.totalDue)}
          meta={view.feesDue > 0
            ? `incl. ${fmtCurrency(view.feesDue)} late fees`
            : t.inFlight > 0 ? `${fmtCurrency(t.inFlight)} clearing` : `${t.count - t.settledCount} unsettled`}
          tone={view.totalDue > 0 ? 'warn' : 'good'}
        />
        <MonthFig
          label="Overdue in this month"
          value={view.overdueDue > 0 ? fmtCurrency(view.overdueDue) : 'None'}
          meta={view.position === 'future' ? 'nothing can be late yet' : `${t.overdueCount} past due`}
          tone={view.overdueDue > 0 ? 'bad' : 'good'}
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
          <MonthLeaseBlock key={l.planId} lease={l} onOpen={onOpen} onInspect={onInspect} />
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
function MonthLeaseBlock({
  lease, onOpen, onInspect,
}: {
  lease: MonthLease
  onOpen: (planId: string) => void
  onInspect: (charge: Charge) => void
}) {
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
          <span
            className={`ml-fig${lease.totalDue > 0 ? ' owed' : ''}`}
            title={lease.lateFees > 0
              ? `${fmtCurrency(lease.outstanding)} of rent and charges plus ${fmtCurrency(lease.lateFees)} of late fees`
              : undefined}
          >
            <b>{fmtCurrency(lease.totalDue)}</b> due
          </span>
          <button className="btn-quiet sm" onClick={() => onOpen(lease.planId)}>Ledger</button>
        </div>
      </div>

      <div className="ml-payers">
        {lease.payers.map(p => (
          <div key={p.payerId ?? p.name} className="mp">
            <span className="mp-who">{p.name}</span>
            <span className="mp-charges">
              {/* Every charge is a button: the month tells you *that* $1,450 is
                  owed, and one click tells you what it is made of. */}
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

/** Settlement time, to the minute when we have it and honestly vague when not.
 *
 *  `paid_date` is a DATE column, so most historical rows genuinely have no time
 *  of day. Printing "12:00 AM" for those would be inventing precision, so a row
 *  without a recorded instant simply shows its date and says so on hover. */
function settledLabel(p: { paidDate: string; settledAt: string | null }): { date: string; time: string | null } {
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

// ─── MONEY IN ────────────────────────────────────────────────────────────────

/** How many payments the log shows before asking. Eight is about one screen —
 *  enough to answer "has anything landed?" without becoming a table. */
const RECENT_SHOWN = 8

/**
 * Every payment that actually arrived, newest first.
 *
 * This is all that is left of the page's reporting half, and it is the one
 * thing that half had which nothing else here does: proof that money moved. It
 * carries no window — a payment does not stop having happened because the
 * reporting period rolled over — and each row opens the same detail sheet as
 * every other payment line on the page.
 *
 * The surcharge is explained rather than subtracted: the tenant pays it to the
 * processor on top of the rent, so the landlord still receives the full amount.
 * A "fee" column beside a "net" column invites exactly the wrong arithmetic, so
 * the note underneath says so outright.
 */
function RecentPayments({
  charges, onInspect,
}: {
  charges: Charge[]
  onInspect: (charge: Charge) => void
}) {
  const [all, setAll] = useState(false)

  const rows = useMemo(
    () => charges
      .filter(c => c.settlement !== null && (c.settlement.net > 0 || c.settlement.lateFee > 0))
      .sort((a, b) => (b.settlement!.paidDate ?? '').localeCompare(a.settlement!.paidDate ?? '')),
    [charges],
  )

  const received = rows.reduce((n, c) => n + c.settlement!.net + c.settlement!.lateFee, 0)
  const surcharges = rows.reduce((n, c) => n + c.settlement!.surcharge, 0)
  const lateCount = rows.filter(c => (c.settlement!.daysLate ?? 0) > 0).length
  const shown = all ? rows : rows.slice(0, RECENT_SHOWN)

  return (
    <section className="panel">
      <div className="panel-hd">
        <h2 className="panel-title">Payments received</h2>
        <span className="panel-note">
          {rows.length === 0
            ? 'nothing has landed yet'
            : `${fmtCurrency(received)} across ${rows.length} payment${rows.length !== 1 ? 's' : ''}${
                lateCount > 0 ? ` · ${lateCount} arrived late` : ''}`}
        </span>
      </div>

      <div className={`panel-bd${rows.length ? ' flush' : ''}`}>
        {rows.length === 0 ? (
          <p className="muted">
            No rent or charges have been paid on these leases yet. Money a tenant pays online lands
            here the moment it settles, and anything you record by hand appears too.
          </p>
        ) : (
          <>
            <div className="pay-hd">
              <span>Payment</span>
              <span>Arrived</span>
              <span className="num">Received</span>
              <span>How</span>
              <span />
            </div>
            {shown.map(c => {
              const st = c.settlement!
              const when = st.paidDate
                ? settledLabel({ paidDate: st.paidDate, settledAt: st.settledAt })
                : null
              const method = st.method ? METHOD_META[st.method] : null
              return (
                <button
                  key={`${c.kind}-${c.id}`}
                  className="pay-row"
                  onClick={() => onInspect(c)}
                  title="See the full breakdown of this payment"
                >
                  <span className="pay-main">
                    <span className="pay-name">
                      {c.who ?? 'The lease'}
                      {(st.daysLate ?? 0) > 0 && <span className="pill bad">{st.daysLate}d late</span>}
                      {st.recordedBy === 'landlord' && <span className="pill plain">by hand</span>}
                    </span>
                    <span className="pay-sub">{c.label} · {c.propertyName}</span>
                  </span>
                  <span className="pay-when">
                    {when ? when.date : '—'}
                    {when?.time && <em>{when.time}</em>}
                  </span>
                  <span className="pay-amt num">
                    {fmtCurrency(st.net + st.lateFee)}
                    {st.lateFee > 0 && <em>incl. {fmtCurrency(st.lateFee)} fee</em>}
                  </span>
                  <span className="pay-how">
                    {method ? (
                      <span className="mchip sm" style={{ background: method.bg, color: method.color }}>
                        {method.short}
                      </span>
                    ) : (
                      <span className="muted sm">—</span>
                    )}
                  </span>
                  <span className="row-chev" aria-hidden="true" />
                </button>
              )
            })}
            <div className="pay-ft">
              <span>
                You receive the <strong>full</strong> amount above. Tenants paid{' '}
                {fmtCurrency(surcharges)} in card and bank surcharges on top, which goes to the
                payment processor and is never taken out of your rent.
              </span>
              {rows.length > RECENT_SHOWN && (
                <button className="btn-quiet sm" onClick={() => setAll(v => !v)}>
                  {all ? `Show latest ${RECENT_SHOWN}` : `Show all ${rows.length}`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

/**
 * One charge, opened from any payment line on the page.
 *
 * The page's figures are deliberately dense, which leaves one question they
 * cannot answer: *what is this number made of?* A landlord on the phone to a
 * tenant needs the parts — the rent, the utilities riding on it, the fee the
 * rule assessed and the rule that assessed it, what has already arrived, and
 * who has been chased. That is what this sheet is, and because every list on
 * the page opens the same one, a charge reads identically wherever it is found.
 */
function ChargeDetail({
  charge: c, onClose, onOpenLedger,
}: {
  charge: Charge
  onClose: () => void
  onOpenLedger: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    // The sheet is a layer over the page, so the page beneath must not scroll
    // out from under it.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const st = c.settlement
  const when = st?.paidDate ? settledLabel({ paidDate: st.paidDate, settledAt: st.settledAt }) : null
  const method = st?.method ? METHOD_META[st.method] : null
  const paidTotal = (st?.net ?? 0) + (st?.lateFee ?? 0)

  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={`${c.label} detail`}>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-hd">
          <div className="sheet-id">
            <div className="sheet-title">
              {c.label}
              <StatePill state={c.state} />
            </div>
            <div className="sheet-sub">
              {c.propertyName} · {c.leaseName}
              {c.who && <> · {c.who}</>}
              {c.whoEmail && <> · {c.whoEmail}</>}
            </div>
          </div>
          <button className="sheet-x" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <div className="sheet-bd">
          {/* ── What was asked for ── */}
          <div className="sheet-sec">
            <div className="sheet-sec-hd">
              <h3>What was billed</h3>
              <span>
                due {fmtDate(c.dueDate)}
                {c.daysLate > 0 && <> · {c.daysLate} day{c.daysLate !== 1 ? 's' : ''} late</>}
              </span>
            </div>

            {c.lines.length > 0 ? (
              <>
                {c.lines.map((l, i) => (
                  <div key={i} className="sline">
                    <span className="sline-lbl">
                      {l.label}
                      {l.kind === 'utility' && <span className="pill plain">utility</span>}
                    </span>
                    <span className="sline-amt num">{fmtCurrency(l.amount)}</span>
                  </div>
                ))}
                <div className="sline sub">
                  <span className="sline-lbl">Charge total</span>
                  <span className="sline-amt num">{fmtCurrency(c.amount)}</span>
                </div>
              </>
            ) : (
              <div className="sline">
                <span className="sline-lbl">
                  {c.categoryLabel ?? 'Rent'}
                  {c.kind === 'charge' && <span className="pill plain">one-off</span>}
                </span>
                <span className="sline-amt num">{fmtCurrency(c.amount)}</span>
              </div>
            )}

            {(c.lateFee > 0 || c.lateFeePaid > 0) && (
              <div className="sline fee">
                <span className="sline-lbl">
                  Late fee assessed
                  {c.feeCapped && (
                    <span
                      className="pill warn"
                      title="This rule has no maximum, so it is held to the size of the charge"
                    >
                      capped at the charge
                    </span>
                  )}
                  {c.feeRule && <span className="sline-note">{c.feeRule}</span>}
                </span>
                <span className="sline-amt num">{fmtCurrency(c.lateFee + c.lateFeePaid)}</span>
              </div>
            )}

            {/* The figure the tenant should be quoted: shortfall plus fee. */}
            <div className="sline total">
              <span className="sline-lbl">
                {c.totalDue > 0 ? 'Still due now' : 'Settled in full'}
                {c.lateFee > 0 && (
                  <span className="sline-note">
                    {fmtCurrency(c.outstanding)} of the charge + {fmtCurrency(c.lateFee)} of late fees
                  </span>
                )}
              </span>
              <span className={`sline-amt num${c.totalDue > 0 ? ' owed' : ' good'}`}>
                {c.totalDue > 0 ? fmtCurrency(c.totalDue) : fmtCurrency(0)}
              </span>
            </div>
          </div>

          {/* ── What arrived ── */}
          <div className="sheet-sec">
            <div className="sheet-sec-hd">
              <h3>What has been paid</h3>
              {when && (
                <span>
                  {when.date}
                  {when.time ? ` · ${when.time}` : ' · time not recorded'}
                </span>
              )}
            </div>

            {!st || paidTotal === 0 ? (
              <p className="muted sm">
                Nothing has arrived against this charge yet.
                {c.state === 'scheduled' && ' It is not due yet.'}
                {c.state === 'clearing' && ' A bank transfer is clearing.'}
              </p>
            ) : (
              <>
                <div className="sline">
                  <span className="sline-lbl">
                    {c.kind === 'rent' ? 'Rent received' : 'Charge received'}
                    {method && (
                      <span className="mchip sm" style={{ background: method.bg, color: method.color }}>
                        {method.label}
                      </span>
                    )}
                    {st.recordedBy === 'landlord' && <span className="pill plain">recorded by you</span>}
                  </span>
                  <span className="sline-amt num good">{fmtCurrency(st.net)}</span>
                </div>
                {st.lateFee > 0 && (
                  <div className="sline">
                    <span className="sline-lbl">Late fee received</span>
                    <span className="sline-amt num good">{fmtCurrency(st.lateFee)}</span>
                  </div>
                )}
                {st.surcharge > 0 && (
                  <div className="sline">
                    <span className="sline-lbl">
                      Surcharge the tenant paid
                      <span className="sline-note">
                        Paid on top to the payment processor — never deducted from you
                      </span>
                    </span>
                    <span className="sline-amt num quiet">{fmtCurrency(st.surcharge)}</span>
                  </div>
                )}
                <div className="sline sub">
                  <span className="sline-lbl">
                    Credited to you
                    {st.daysLate !== null && (
                      <span className="sline-note">
                        {st.daysLate > 0
                          ? `arrived ${st.daysLate} day${st.daysLate !== 1 ? 's' : ''} after the due date`
                          : st.daysLate < 0
                            ? `arrived ${Math.abs(st.daysLate)} day${st.daysLate !== -1 ? 's' : ''} early`
                            : 'arrived on the due date'}
                      </span>
                    )}
                  </span>
                  <span className="sline-amt num">{fmtCurrency(paidTotal)}</span>
                </div>
              </>
            )}
          </div>

          {/* ── Who has been asked ── */}
          {(c.chases.count > 0 || c.chases.feeCount > 0 || c.notes) && (
            <div className="sheet-sec">
              <div className="sheet-sec-hd"><h3>History</h3></div>
              {c.chases.count > 0 && (
                <p className="muted sm">
                  Chased {c.chases.count} time{c.chases.count !== 1 ? 's' : ''} about the charge
                  {c.chases.lastAt && <> — last {whenLabel(c.chases.lastAt)}</>}.
                </p>
              )}
              {c.chases.feeCount > 0 && (
                <p className="muted sm">
                  Chased {c.chases.feeCount} time{c.chases.feeCount !== 1 ? 's' : ''} about the late fee
                  {c.chases.feeLastAt && <> — last {whenLabel(c.chases.feeLastAt)}</>}.
                </p>
              )}
              {c.notes && <p className="muted sm">Note: {c.notes}</p>}
            </div>
          )}
        </div>

        <div className="sheet-ft">
          <span className="muted sm">Recording, chasing and editing money happens in the ledger.</span>
          <button className="btn-primary sm" onClick={onOpenLedger}>Open the lease ledger</button>
        </div>
      </div>
    </div>
  )
}

// ─── SMALL PIECES ────────────────────────────────────────────────────────────

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

  .seg {
    display: inline-flex; background: var(--line-2); border-radius: 10px; padding: 2px;
    gap: 2px; max-width: 100%; overflow-x: auto;
  }
  .seg-btn {
    border: none; background: none; font-family: inherit; cursor: pointer;
    padding: 7px 16px; border-radius: 8px; font-size: 13.5px; font-weight: 500;
    color: var(--ink-2); letter-spacing: -0.01em; white-space: nowrap;
    display: inline-flex; align-items: center; gap: 7px;
    transition: background 0.18s, color 0.18s, box-shadow 0.18s;
  }
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

  .mchip {
    display: inline-flex; align-items: center; gap: 7px;
    border-radius: 980px; padding: 5px 13px 5px 10px; font-size: 12.5px;
    letter-spacing: -0.01em; white-space: nowrap;
  }
  /* ── Panels ── */
  .panel { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; margin-bottom: 16px; overflow: hidden; }
  .panel-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 18px 22px 14px; }
  .panel-title { font-size: 16px; font-weight: 600; letter-spacing: -0.015em; }
  .panel-note { font-size: 12.5px; color: var(--ink-3); letter-spacing: -0.01em; text-align: right; font-variant-numeric: tabular-nums; }
  .panel-bd { padding: 4px 22px 20px; }
  .panel-bd.flush { padding: 0; }

  .num { text-align: right; font-size: 13.5px; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; white-space: nowrap; }
  .num.good { color: var(--good); }
  .num.bad  { color: var(--bad); font-weight: 600; }
  .num.warn { color: var(--warn); }
  .num.dim  { color: var(--ink-3); }
  .num.info { color: #0057b8; }

  .dfact { padding: 0 16px; border-left: 1px solid #e3e8ef; }
  .dfact:first-child { border-left: none; padding-left: 0; }
  .dfact-label { font-size: 11.5px; color: var(--ink-3); letter-spacing: -0.005em; }
  .dfact-value { font-size: 17px; font-weight: 600; letter-spacing: -0.018em; margin-top: 3px; font-variant-numeric: tabular-nums; }
  .dfact-value.good { color: var(--good); }
  .dfact-value.bad  { color: var(--bad); }
  .dfact-meta { font-size: 11.5px; color: var(--ink-3); margin-top: 2px; }

  /* ── Lease vitals, above the ledger ── */
  .vitals { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 18px 20px 16px; }
  .vitals-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0; }
  .vitals-bar { position: relative; height: 6px; background: var(--line-2); border-radius: 99px; margin-top: 18px; }
  .vitals-fill { height: 100%; background: var(--good); border-radius: 99px; transition: width 0.4s cubic-bezier(0.4,0,0.2,1); }
  /* Collection against term elapsed: if the marker is ahead of the fill, the
     lease is behind where it should be — the fastest read of a tenancy. */
  .vitals-mark { position: absolute; top: -3px; width: 2px; height: 12px; background: var(--ink); border-radius: 2px; }
  .vitals-key { display: flex; gap: 16px; flex-wrap: wrap; font-size: 11.5px; color: var(--ink-3); margin-top: 8px; }

  /* ── Row chevron ── */
  .row-chev {
    width: 7px; height: 7px; border-top: 1.6px solid #c7c7cc; border-right: 1.6px solid #c7c7cc;
    transform: rotate(45deg); flex-shrink: 0;
  }
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
  /* ── Section walls ─────────────────────────────────────────────────────────
     The page now carries three kinds of question, and a reader needs to know
     which one they are in. A labelled rule does that more quietly than a box. */
  .sec-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 4px 0 12px; }
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
    display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; width: 100%;
    background: none; border: none; border-bottom: 1px solid var(--line-2);
    font-family: inherit; color: inherit; text-align: left; cursor: pointer;
    padding: 8px 6px 8px 0; font-size: 13px; letter-spacing: -0.01em; border-radius: 6px;
    transition: background 0.12s;
  }
  .miss-charge:hover { background: #f6f7f9; }
  .mc-fee.quiet { color: var(--ink-3); }
  .mc-chev {
    width: 6px; height: 6px; border-top: 1.5px solid #c7c7cc; border-right: 1.5px solid #c7c7cc;
    transform: rotate(45deg); flex-shrink: 0; margin-left: auto;
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
  .mp-charge {
    display: inline-flex; align-items: center; gap: 7px;
    background: none; border: none; font-family: inherit; color: inherit;
    padding: 3px 7px; margin: -3px -2px; border-radius: 8px; cursor: pointer;
    font-size: inherit; letter-spacing: -0.01em; transition: background 0.12s;
  }
  .mp-charge:hover { background: #f1f2f5; }
  .mp-fee { font-size: 11px; color: var(--warn); font-variant-numeric: tabular-nums; }
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

  @media (max-width: 820px) {
    .dfact:nth-child(odd) { border-left: none; padding-left: 0; }
    .vitals-row { grid-template-columns: repeat(2, 1fr); row-gap: 14px; }
  }
  @media (max-width: 700px) {
    .fin-wrap { padding: 24px 16px 90px; }
    .title { font-size: 26px; }
  }

  /* ── Payments received ─────────────────────────────────────────────────────
     A log, not a table: four columns, every row a button into the detail
     sheet. The grid is shared by the header and the rows so the money column
     lines up digit-for-digit down the page. */
  .pay-hd, .pay-row {
    display: grid;
    grid-template-columns: minmax(220px, 2.6fr) 118px 132px 86px 14px;
    gap: 12px; align-items: center; text-align: left;
  }
  .pay-hd {
    padding: 9px 22px; background: #fafafb;
    border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
    font-size: 11px; font-weight: 600; color: var(--ink-3);
    text-transform: uppercase; letter-spacing: 0.045em;
  }
  .pay-row {
    width: 100%; background: none; border: none; font-family: inherit; color: inherit;
    padding: 12px 22px; border-bottom: 1px solid var(--line-2); cursor: pointer;
    transition: background 0.12s;
  }
  .pay-row:hover { background: #fafafb; }
  .pay-main { min-width: 0; }
  .pay-name {
    display: block; font-size: 14px; font-weight: 500; letter-spacing: -0.012em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .pay-sub {
    display: block; font-size: 12.5px; color: var(--ink-2); margin-top: 2px;
    letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .pay-when { font-size: 13px; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
  .pay-when em { display: block; font-style: normal; font-size: 11.5px; color: var(--ink-3); }
  .pay-amt { font-size: 14.5px; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
  .pay-amt em {
    display: block; font-style: normal; font-size: 11.5px; font-weight: 400; color: var(--ink-3);
  }
  .pay-how { text-align: left; }
  .pay-ft {
    display: flex; align-items: baseline; justify-content: space-between; gap: 14px;
    flex-wrap: wrap; padding: 14px 22px 16px; font-size: 12.5px; color: var(--ink-2);
    line-height: 1.6; letter-spacing: -0.01em;
  }

  /* ── The detail sheet ──────────────────────────────────────────────────────
     Every payment line on the page opens this, which is why it is a layer and
     not a route: a landlord checking what a figure is made of has not changed
     the subject, and should land back exactly where they were. */
  .sheet-wrap { position: fixed; inset: 0; z-index: 70; display: flex; justify-content: flex-end; }
  .sheet-scrim { position: absolute; inset: 0; background: rgba(0,0,0,0.26); backdrop-filter: blur(1.5px); }
  .sheet {
    position: relative; width: 100%; max-width: 520px; background: var(--surface);
    display: flex; flex-direction: column; box-shadow: -18px 0 48px rgba(0,0,0,0.14);
    animation: sheet-in 0.2s ease-out;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'DM Sans', sans-serif;
  }
  @keyframes sheet-in { from { transform: translateX(16px); opacity: 0.6; } to { transform: none; opacity: 1; } }
  .sheet-hd {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
    padding: 20px 22px 16px; border-bottom: 1px solid var(--line);
  }
  .sheet-id { min-width: 0; }
  .sheet-title {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    font-size: 17px; font-weight: 600; letter-spacing: -0.018em;
  }
  .sheet-sub { font-size: 12.5px; color: var(--ink-2); margin-top: 5px; line-height: 1.5; letter-spacing: -0.01em; }
  .sheet-x {
    background: none; border: none; font-size: 24px; line-height: 1; color: var(--ink-3);
    cursor: pointer; font-family: inherit; padding: 0 2px;
  }
  .sheet-x:hover { color: var(--ink); }
  .sheet-bd { padding: 4px 22px 18px; overflow-y: auto; flex: 1; }
  .sheet-sec { padding: 16px 0; border-bottom: 1px solid var(--line-2); }
  .sheet-sec:last-child { border-bottom: none; }
  .sheet-sec-hd {
    display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
    flex-wrap: wrap; margin-bottom: 8px;
  }
  .sheet-sec-hd h3 {
    font-size: 11.5px; font-weight: 600; color: var(--ink-2);
    text-transform: uppercase; letter-spacing: 0.055em;
  }
  .sheet-sec-hd span { font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }

  .sline {
    display: flex; align-items: baseline; justify-content: space-between; gap: 14px;
    padding: 7px 0; font-size: 13.5px; letter-spacing: -0.01em;
  }
  .sline-lbl { display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; min-width: 0; }
  .sline-note {
    display: block; width: 100%; font-size: 11.5px; color: var(--ink-3);
    line-height: 1.5; margin-top: 2px;
  }
  .sline-amt { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .sline-amt.good  { color: var(--good); }
  .sline-amt.owed  { color: var(--bad); }
  .sline-amt.quiet { color: var(--ink-3); }
  .sline.sub { border-top: 1px solid var(--line-2); margin-top: 4px; padding-top: 10px; font-weight: 500; }
  .sline.fee { color: var(--warn); }
  .sline.total {
    border-top: 1.5px solid var(--line); margin-top: 6px; padding-top: 12px;
    font-size: 15px; font-weight: 600;
  }
  .sline.total .sline-amt { font-size: 19px; letter-spacing: -0.02em; }

  .sheet-ft {
    display: flex; align-items: center; justify-content: space-between; gap: 14px;
    flex-wrap: wrap; padding: 14px 22px; border-top: 1px solid var(--line); background: #fcfcfd;
  }
  .muted.sm { font-size: 12.5px; line-height: 1.6; }
  .mchip.sm { padding: 1px 8px; font-size: 11px; }

  @media (max-width: 760px) {
    .sheet { max-width: none; }
    .pay-hd, .pay-row { grid-template-columns: 1fr 120px 14px; }
    .pay-hd > :nth-child(2), .pay-row > :nth-child(2),
    .pay-hd > :nth-child(4), .pay-row > :nth-child(4) { display: none; }
  }
`
