'use client'

/**
 * Portfolio — the money hierarchy, as a landlord actually holds it.
 *
 *     property → lease → payment plan → payer → the lines they pay
 *
 * ── The problem this page exists to fix ────────────────────────────────────
 *
 * Everything in the money area used to be organised around the **payment
 * plan**, because that is the row in the database. That is not how anyone
 * thinks about a building, and it produced the single worst piece of this
 * product: a lease with three tenants billed through separate plans appeared as
 * three unrelated rows, each named after the same lease, each holding a third
 * of the rent, with nothing anywhere saying they were the same tenancy. *Where
 * is Aleeya's payment plan* had no answer you could navigate to — you had to
 * recognise it by its rent figure.
 *
 * So the plan is demoted. A lease is the thing you navigate, every plan written
 * against it hangs underneath it, and the lease's figures are the sum of its
 * plans. One lease, however many tenants, however many plans, one row — with
 * the plans visible as what they really are: the billing arrangements a subset
 * of the tenants pay under.
 *
 * ── Why it expands rather than navigates ───────────────────────────────────
 *
 * The four levels are not four pages. A landlord opening a property to see its
 * leases, and a lease to see who pays, is *orienting* — they have not decided
 * where they are going yet, and a page load per level makes them commit before
 * they know. So every level opens in place and keeps its parents on screen.
 * Only two things navigate: the lease page (where a tenancy is worked) and the
 * rent ledger (where money is edited). Both are explicit buttons.
 *
 * ── Filtering ──────────────────────────────────────────────────────────────
 *
 * Active leases are the default. A landlord with three years of finished
 * tenancies behind them was reading past every one to find the rent they can
 * still collect. Ended leases are one control away — and money owed on a lease
 * the filter hides is still reported at the bottom, because a default filter
 * must never be able to make a debt disappear.
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { fmtCurrency, fmtDate } from '@/lib/payments'
import { useMoney } from '@/lib/useMoney'
import { buildTree, leaseHref, planHref, type TreeLease, type TreePlan, type TreePayer, type TreeProperty } from '@/lib/financialsTree'
import {
  filterPlans, stageCounts, arrears, LEASE_FILTERS, type LeaseFilter,
} from '@/lib/financialsMonth'
import MoneyHub from '@/components/finance/MoneyHub'
import CommandPalette, { usePaletteShortcut } from '@/components/finance/CommandPalette'
import { GLYPH_CSS } from '@/components/finance/Glyph'
import { ProgressBar, Meter, VIZ_CSS } from '@/components/finance/Charts'
import { dayOrdinal } from '@/components/finance/ChargeSheet'
import { FINANCE_THEME } from '@/lib/financeTheme'

/** How the tree can be ordered. Attention first by default: the reason to open
 *  this page on a normal day is to find out which building is a problem. */
type SortKey = 'attention' | 'name' | 'rent' | 'owed'

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'attention', label: 'Needs attention' },
  { id: 'name',      label: 'Property name' },
  { id: 'rent',      label: 'Monthly rent' },
  { id: 'owed',      label: 'Amount overdue' },
]

export default function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ leases?: string; q?: string; open?: string }>
}) {
  const sp = use(searchParams)
  const { plans, waivers, bounced, loading } = useMoney()
  const [find, setFind] = useState(false)
  usePaletteShortcut(useCallback(() => setFind(true), []))

  const [leaseFilter, setLeaseFilter] = useState<LeaseFilter>(
    LEASE_FILTERS.some(f => f.id === sp.leases) ? (sp.leases as LeaseFilter) : 'current',
  )
  const [query, setQuery] = useState(sp.q ?? '')
  const [sort, setSort] = useState<SortKey>('attention')
  const [openProps, setOpenProps] = useState<Set<string>>(new Set())
  const [openLeases, setOpenLeases] = useState<Set<string>>(new Set())
  /** Set once the first tree arrives, so the auto-expand below runs once and
   *  never fights the landlord's own collapsing. */
  const [primed, setPrimed] = useState(false)

  useEffect(() => { document.title = 'Portfolio — Financials | HomeHive' }, [])

  const scoped = useMemo(() => filterPlans(plans, leaseFilter), [plans, leaseFilter])
  const counts = useMemo(() => stageCounts(plans), [plans])
  const tree = useMemo(() => buildTree(scoped, waivers), [scoped, waivers])

  // Money owed on leases this filter excludes. Reported so narrowing the view
  // can never make a debt vanish — the one thing a default filter must not do.
  const hidden = useMemo(() => {
    const ids = new Set(scoped.map(p => p.id))
    return arrears(plans.filter(p => !ids.has(p.id)))
  }, [plans, scoped])

  /** A search hits a property, a lease, a plan or a person — all four are
   *  things a landlord would type, and which one matched does not matter. */
  const matches = (p: TreeProperty): boolean => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    if (p.propertyName.toLowerCase().includes(q)) return true
    return p.leases.some(l =>
      l.label.toLowerCase().includes(q) ||
      l.plans.some(pl => pl.name.toLowerCase().includes(q)) ||
      l.payers.some(t =>
        t.name.toLowerCase().includes(q) || (t.email ?? '').toLowerCase().includes(q)),
    )
  }

  const shown = useMemo(() => {
    const list = tree.properties.filter(matches)
    const by: Record<SortKey, (a: TreeProperty, b: TreeProperty) => number> = {
      attention: (a, b) => b.urgency - a.urgency || b.totals.billed - a.totals.billed,
      name:      (a, b) => a.propertyName.localeCompare(b.propertyName),
      rent:      (a, b) => b.monthly - a.monthly,
      owed:      (a, b) => b.owed - a.owed,
    }
    return list.slice().sort(by[sort])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, query, sort])

  // A portfolio small enough to read at once opens itself; a large one does
  // not, because forty expanded properties is the wall this page replaced.
  useEffect(() => {
    if (primed || tree.properties.length === 0) return
    const next = new Set<string>()
    if (tree.properties.length <= 3) for (const p of tree.properties) next.add(p.propertyId)
    else if (tree.properties[0]) next.add(tree.properties[0].propertyId)
    setOpenProps(next)
    setPrimed(true)
  }, [tree, primed])

  // A link from the overview carries the property it was about.
  useEffect(() => {
    const hash = window.location.hash
    const id = hash.startsWith('#p-') ? hash.slice(3) : sp.open
    if (!id) return
    setOpenProps(prev => new Set(prev).add(id))
    // The browser cannot scroll to a node that was collapsed when it tried.
    const t = setTimeout(() => {
      document.getElementById(`p-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }, 120)
    return () => clearTimeout(t)
  }, [sp.open, loading])

  // A search is a request to see what matched, so matches open themselves —
  // otherwise typing a tenant's name shows a property row that does not
  // mention them.
  useEffect(() => {
    if (!query.trim()) return
    setOpenProps(new Set(shown.map(p => p.propertyId)))
    setOpenLeases(new Set(
      shown.flatMap(p => p.leases
        .filter(l => l.payers.some(t =>
          t.name.toLowerCase().includes(query.trim().toLowerCase())))
        .map(l => l.key)),
    ))
  }, [query, shown])

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key); else next.add(key)
    setter(next)
  }

  const filtered = query.trim().length > 0 || leaseFilter !== 'current'

  return (
    <>
      <style>{FINANCE_THEME}{GLYPH_CSS}{VIZ_CSS}{CSS}</style>
      <div className="fin fin-wrap">
        <MoneyHub
          tab="portfolio"
          title="Portfolio"
          sub="Every property, the leases on it, how each lease is billed, and who pays."
          action={{ label: 'New payment plan', href: '/landlord/financials/new' }}
          onFind={() => setFind(true)}
          alarmCount={bounced}
          dueCount={tree.leases.filter(l => l.owed > 0).length}
          filters={
            <div className="filters">
              <input
                className="fsearch"
                type="search"
                placeholder="Property, lease, plan or tenant…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                aria-label="Search the portfolio"
              />
              <select
                className={`fsel${leaseFilter !== 'current' ? ' on' : ''}`}
                value={leaseFilter}
                onChange={e => setLeaseFilter(e.target.value as LeaseFilter)}
                aria-label="Which leases"
              >
                {LEASE_FILTERS.map(f => (
                  <option key={f.id} value={f.id}>{f.label} ({counts[f.id]})</option>
                ))}
              </select>
              <select
                className={`fsel${sort !== 'attention' ? ' on' : ''}`}
                value={sort}
                onChange={e => setSort(e.target.value as SortKey)}
                aria-label="Sort by"
              >
                {SORTS.map(s => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}
              </select>
              {filtered && (
                <button
                  className="btn-quiet sm"
                  onClick={() => { setQuery(''); setLeaseFilter('current') }}
                >
                  Reset
                </button>
              )}
              <span className="fcount">
                {shown.length} propert{shown.length !== 1 ? 'ies' : 'y'} ·
                {' '}{shown.reduce((n, p) => n + p.leases.length, 0)} leases ·
                {' '}{shown.reduce((n, p) => n + p.payerCount, 0)} payers
              </span>
            </div>
          }
        />

        {loading ? (
          <div className="skeleton-hero" />
        ) : plans.length === 0 ? (
          <div className="empty">
            <div className="empty-title">Nothing to show yet</div>
            <p className="empty-sub">
              A payment plan is what connects a lease to the rent it bills. Create one and this
              page fills in: the property, the tenancy, the people on it, and what each of them
              pays every month.
            </p>
            <Link href="/landlord/financials/new" className="btn-primary">Create a payment plan</Link>
          </div>
        ) : shown.length === 0 ? (
          <div className="empty">
            <div className="empty-title">
              {query.trim() ? `Nothing matches “${query.trim()}”` : 'Nothing in this view'}
            </div>
            <p className="empty-sub">
              {query.trim()
                ? 'Searching looks at property names, lease and plan names, tenant names and tenant emails.'
                : LEASE_FILTERS.find(f => f.id === leaseFilter)!.hint + '.'}
            </p>
            <button className="btn-primary" onClick={() => { setQuery(''); setLeaseFilter('all') }}>
              Show everything
            </button>
          </div>
        ) : (
          <>
            {/* The portfolio in one line, so the tree below has a total to be
                read against. */}
            <div className="kpis">
              <div className="kpi">
                <div className="kpi-label">Contracted rent</div>
                <div className="kpi-value">{fmtCurrency(tree.monthly)}<small>/mo</small></div>
                <div className="kpi-meta">
                  across {tree.activeLeaseCount} active lease{tree.activeLeaseCount !== 1 ? 's' : ''}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Billed to date</div>
                <div className="kpi-value">{fmtCurrency(tree.totals.billed)}</div>
                <div className="kpi-meta">
                  {tree.totals.rate !== null
                    ? `${tree.totals.rate}% collected`
                    : 'nothing billed yet'}
                </div>
                <Meter pct={tree.totals.rate} />
              </div>
              <div className={`kpi${tree.owed > 0 ? ' hot' : ''}`}>
                <div className="kpi-label">Overdue</div>
                <div className={`kpi-value ${tree.owed > 0 ? 'bad' : 'good'}`}>
                  {tree.owed > 0 ? fmtCurrency(tree.owed) : 'None'}
                </div>
                <div className="kpi-meta">
                  {tree.owed > 0
                    ? `on ${tree.leases.filter(l => l.owed > 0).length} lease${
                        tree.leases.filter(l => l.owed > 0).length !== 1 ? 's' : ''}`
                    : 'every lease is current'}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Deposits held</div>
                <div className="kpi-value">{fmtCurrency(tree.depositsHeld)}</div>
                <div className="kpi-meta">returnable at move-out</div>
              </div>
            </div>

            {tree.splitLeaseCount > 0 && (
              <p className="lead-note">
                <strong>{tree.splitLeaseCount}</strong> of these tenancies bill rent through more
                than one payment plan. They appear here as <em>one lease</em> with its plans listed
                underneath, which is what they are — not as separate leases, which is how the rest
                of this product used to show them.
              </p>
            )}

            <div className="panel">
              <div className="tree">
                {shown.map(p => (
                  <PropertyNode
                    key={p.propertyId}
                    property={p}
                    open={openProps.has(p.propertyId)}
                    onToggle={() => toggle(openProps, setOpenProps, p.propertyId)}
                    openLeases={openLeases}
                    onToggleLease={k => toggle(openLeases, setOpenLeases, k)}
                  />
                ))}
              </div>
            </div>

            {hidden.total > 0 && leaseFilter !== 'all' && (
              <div className="note-bar" role="note">
                <span>
                  <strong>{fmtCurrency(hidden.total)}</strong> is also owed by {hidden.payerCount}{' '}
                  {hidden.payerCount === 1 ? 'payer' : 'payers'} on leases outside this view.
                  A filter is not allowed to hide money.
                </span>
                <button className="btn-secondary sm" onClick={() => setLeaseFilter('all')}>
                  Show all leases
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <CommandPalette tree={tree} open={find} onClose={() => setFind(false)} />
    </>
  )
}

// ─── LEVEL 1: PROPERTY ───────────────────────────────────────────────────────

function PropertyNode({
  property: p, open, onToggle, openLeases, onToggleLease,
}: {
  property: TreeProperty
  open: boolean
  onToggle: () => void
  openLeases: Set<string>
  onToggleLease: (key: string) => void
}) {
  return (
    <div className="tnode" id={`p-${p.propertyId}`}>
      <button className="trow" onClick={onToggle} aria-expanded={open}>
        <span className={`twist${open ? ' open' : ''}`} aria-hidden="true" />
        <span className="trow-main">
          <span className="trow-name">
            {p.propertyName}
            {p.owed > 0 && <span className="pill bad">{fmtCurrency(p.owed)} overdue</span>}
            {p.activeLeases === 0 && <span className="pill plain">no live lease</span>}
          </span>
          <span className="trow-sub">
            {p.leases.length} lease{p.leases.length !== 1 ? 's' : ''} ·
            {' '}{p.payerCount} payer{p.payerCount !== 1 ? 's' : ''} ·
            {' '}{fmtCurrency(p.monthly)}/mo
            {p.utilitiesMonthly > 0 && <> · incl. {fmtCurrency(p.utilitiesMonthly)} utilities</>}
            {p.nextDue && <> · next {fmtCurrency(p.nextDue.amount)} on {fmtDate(p.nextDue.date)}</>}
          </span>
        </span>
        <span className="trow-figs">
          <span className="tfig">
            <b>{p.totals.rate !== null ? `${p.totals.rate}%` : '—'}</b>
            <em>collected</em>
          </span>
          <span className="tfig">
            <b className={p.owed > 0 ? 'owed' : ''}>
              {p.owed > 0 ? fmtCurrency(p.owed) : fmtCurrency(0)}
            </b>
            <em>overdue</em>
          </span>
        </span>
      </button>

      {open && (
        <div className="tkids">
          {p.leases.map(l => (
            <div key={l.key} className="tkid">
              <LeaseNode
                lease={l}
                open={openLeases.has(l.key)}
                onToggle={() => onToggleLease(l.key)}
              />
            </div>
          ))}
          {p.propertySlug && (
            <div className="tfoot">
              <Link className="btn-quiet sm" href={`/landlord/listings/${p.propertySlug}`}>
                The listing for {p.propertyName} →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── LEVEL 2: LEASE ──────────────────────────────────────────────────────────

/**
 * One tenancy.
 *
 * The row says the three things that decide whether to open it: how far through
 * its term it is, how much of its contract has actually been collected, and
 * whether anybody on it is behind. The plan count is on the row too, because a
 * lease billed through three plans is the case this page was built for and
 * hiding that fact one level down would defeat the point.
 */
function LeaseNode({
  lease: l, open, onToggle,
}: {
  lease: TreeLease
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className="tnode">
      <button className="trow sub" onClick={onToggle} aria-expanded={open}>
        <span className={`twist${open ? ' open' : ''}`} aria-hidden="true" />
        <span className="trow-main">
          <span className="trow-name sm">
            {l.label}
            <span className={`pill ${
              l.stage === 'active' ? 'good'
              : l.stage === 'ending' ? 'warn'
              : l.stage === 'upcoming' ? 'info'
              : 'plain'}`}>
              {l.stageLabel}
            </span>
            {l.splitBilling && (
              <span className="pill info" title="Rent on this lease is billed through more than one payment plan">
                {l.plans.length} plans
              </span>
            )}
          </span>
          <span className="trow-sub">
            {l.termStart && l.termEnd
              ? <>{fmtDate(l.termStart)} – {fmtDate(l.termEnd)}</>
              : 'no term on file'}
            {' · '}{l.activePayers} tenant{l.activePayers !== 1 ? 's' : ''}
            {' · '}{fmtCurrency(l.monthly)}/mo
            {' · '}rent due on the {l.dueDays.map(dayOrdinal).join(' and ')}
            {l.daysLeft !== null && l.daysLeft >= 0 && l.daysLeft <= 60 && (
              <> · <b className="warn-ink">{l.daysLeft} days left</b></>
            )}
          </span>
        </span>
        <span className="trow-figs">
          <span className="tfig">
            <b>{l.contractProgress !== null ? `${l.contractProgress}%` : '—'}</b>
            <em>of contract in</em>
          </span>
          <span className="tfig">
            <b className={l.owed > 0 ? 'owed' : 'good'}>
              {l.owed > 0 ? fmtCurrency(l.owed) : '—'}
            </b>
            <em>{l.owed > 0 ? 'overdue' : 'current'}</em>
          </span>
        </span>
      </button>

      {open && (
        <div className="lease-open">
          {/* The lease's whole financial life in one strip, so the plans below
              have a context. The marker on the bar is where the *term* has got
              to: if it sits ahead of the fill, the tenancy is behind where it
              should be, which is the fastest read of a lease there is. */}
          <div className="lvitals">
            <Fact label="Contract value" value={fmtCurrency(l.contractValue)} meta="rent over the full term" />
            <Fact label="Collected" value={fmtCurrency(l.contractCollected)} meta={`${l.contractProgress ?? 0}% of it`} tone="good" />
            <Fact
              label="Still to collect"
              value={fmtCurrency(Math.max(0, l.contractValue - l.contractCollected))}
              meta={l.nextDue ? `next ${fmtCurrency(l.nextDue.amount)} on ${fmtDate(l.nextDue.date)}` : 'nothing scheduled'}
            />
            <Fact
              label="Overdue"
              value={l.owed > 0 ? fmtCurrency(l.owed) : 'None'}
              meta={l.lateFees > 0 ? `incl. ${fmtCurrency(l.lateFees)} late fees` : 'nothing past due'}
              tone={l.owed > 0 ? 'bad' : 'good'}
            />
            <Fact label="Deposits held" value={fmtCurrency(l.depositsHeld)} meta={l.depositsHeld > 0 ? 'returnable at move-out' : 'none on file'} />
          </div>
          <ProgressBar
            pct={l.contractProgress ?? 0}
            markAt={l.termProgress}
            label={`${l.contractProgress ?? 0}% of the contract collected, ${l.termProgress ?? 0}% through the term`}
          />
          <div className="lvitals-key">
            <span>{l.contractProgress ?? 0}% of contracted rent collected</span>
            {l.termProgress !== null && <span>marker = {l.termProgress}% through the term</span>}
          </div>

          {/* ── Level 3: the plans ── */}
          <div className="sec-hd tight">
            <h3 className="sec-title sm">
              {l.splitBilling
                ? `Billed through ${l.plans.length} payment plans`
                : 'Payment plan'}
            </h3>
            <span className="sec-note">
              {l.splitBilling
                ? 'one tenancy, separate billing arrangements'
                : 'one plan covering every tenant on the lease'}
            </span>
          </div>
          {l.plans.map(pl => <PlanBlock key={pl.planId} plan={pl} />)}

          {/* ── Utilities, declared once per plan ── */}
          {l.utilities.length > 0 && (
            <>
              <div className="sec-hd tight">
                <h3 className="sec-title sm">Utilities and shared charges</h3>
                <span className="sec-note">
                  {fmtCurrency(l.utilitiesMonthly)}/mo on top of base rent
                </span>
              </div>
              <div className="utils">
                {l.utilities.map(u => (
                  <div key={u.id} className="util">
                    <span className="util-main">
                      <b>{u.label}</b>
                      <em>
                        {u.cadence === 'monthly' ? 'every month' : 'one time'} ·
                        {' '}{u.split === 'per_payer' ? 'each payer pays this' : 'split evenly between payers'}
                      </em>
                    </span>
                    <span className="util-fig">
                      <b>{fmtCurrency(u.amount)}</b>
                      <em>
                        {u.cadence === 'monthly' && u.split === 'per_payer'
                          ? `${fmtCurrency(u.houseMonthly)} across the house`
                          : 'as declared'}
                      </em>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="lease-acts">
            <Link className="btn-primary sm" href={leaseHref(l.key)}>
              Open this lease
            </Link>
            {l.leaseId && (
              <Link className="btn-secondary sm" href={`/landlord/leases/${l.leaseId}`}>
                The tenancy — people and documents
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── LEVEL 3: PLAN ───────────────────────────────────────────────────────────

/**
 * One billing arrangement, with the people on it.
 *
 * A plan is no longer a destination, so this is deliberately a *block* and not
 * a row: it exists to answer "who pays under this, and how much", and then to
 * hand off to the ledger where the money is actually edited.
 */
function PlanBlock({ plan: p }: { plan: TreePlan }) {
  const [openPayer, setOpenPayer] = useState<string | null>(null)

  return (
    <div className="plan">
      <div className="plan-hd">
        <div>
          <div className="plan-name">
            {p.name}
            {p.feeRisk && (
              <span className="pill warn" title={p.feeRisk}>uncapped late fee</span>
            )}
          </div>
          <div className="plan-sub">
            rent due on the {dayOrdinal(p.dueDay)} ·
            {' '}{p.activePayers} payer{p.activePayers !== 1 ? 's' : ''} ·
            {' '}{fmtCurrency(p.monthly)}/mo
            {p.feeRule && <> · late fee {p.feeRule}</>}
          </div>
        </div>
        <div className="plan-acts">
          {p.owed > 0 && <span className="pill bad">{fmtCurrency(p.owed)} overdue</span>}
          <Link className="btn-secondary sm" href={planHref(p.planId)}>
            Rent ledger
          </Link>
        </div>
      </div>

      <div className="tbl-scroll">
        <table className="tbl payers">
          <thead>
            <tr>
              <th>Tenant</th>
              <th className="num">Pays monthly</th>
              <th className="num">Share</th>
              <th className="num">Collected</th>
              <th className="num">Overdue</th>
              <th>Next due</th>
            </tr>
          </thead>
          <tbody>
            {p.payers.map(t => (
              <PayerRow
                key={t.id}
                payer={t}
                open={openPayer === t.id}
                onToggle={() => setOpenPayer(openPayer === t.id ? null : t.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── LEVEL 4: PAYER ──────────────────────────────────────────────────────────

/** One person, and — opened — the lines their monthly figure is made of. */
function PayerRow({
  payer: t, open, onToggle,
}: {
  payer: TreePayer
  open: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr
        className="click"
        id={`payer-${t.planId}:${t.id}`}
        onClick={onToggle}
        aria-expanded={open}
      >
        <td className="cell-main">
          <b>
            <span className={`twist${open ? ' open' : ''}`} aria-hidden="true" />
            {t.name}
            {t.status !== 'active' && (
              <span className="pill plain">{t.status === 'terminated' ? 'moved out' : 'finished'}</span>
            )}
          </b>
          <em>{t.email ?? 'no email on file'}</em>
        </td>
        <td className="num">{fmtCurrency(t.monthly)}</td>
        <td className="num">{t.share !== null ? `${t.share}%` : '—'}</td>
        <td className="num">{fmtCurrency(t.rent.collected)}</td>
        <td className={`num${t.owed > 0 ? ' owed' : ''}`}>
          {t.owed > 0 ? fmtCurrency(t.owed) : '—'}
          {t.lateFees > 0 && <em className="cell-note">incl. {fmtCurrency(t.lateFees)} fees</em>}
        </td>
        <td>
          {t.nextDue
            ? <>{fmtDate(t.nextDue.date)} <em className="cell-note">{fmtCurrency(t.nextDue.amount)}</em></>
            : <span className="muted sm">—</span>}
        </td>
      </tr>

      {open && (
        <tr className="payer-detail">
          <td colSpan={6}>
            <div className="pd">
              <div className="pd-half">
                <div className="pd-hd">What {t.name.split(' ')[0]} pays each month</div>
                {t.lines.length === 0 ? (
                  <p className="muted sm">
                    No line items on this payer — their monthly total of {fmtCurrency(t.monthly)} is
                    held as one figure.
                  </p>
                ) : (
                  <>
                    {t.lines.map(l => (
                      <div key={l.id} className="sline">
                        <span className="sline-lbl">
                          {l.label}
                          {l.isUtility && (
                            <span className="pill plain" title="This line comes from a lease utility — edit the utility, not the line">
                              utility
                            </span>
                          )}
                          {l.notes && <span className="sline-note">{l.notes}</span>}
                        </span>
                        <span className="sline-amt num">{fmtCurrency(l.amount)}</span>
                      </div>
                    ))}
                    <div className="sline sub">
                      <span className="sline-lbl">Monthly total</span>
                      <span className="sline-amt num">{fmtCurrency(t.monthly)}</span>
                    </div>
                  </>
                )}
              </div>

              <div className="pd-half">
                <div className="pd-hd">Their record</div>
                <div className="sline">
                  <span className="sline-lbl">Billed to date</span>
                  <span className="sline-amt num">{fmtCurrency(t.rent.billed)}</span>
                </div>
                <div className="sline">
                  <span className="sline-lbl">Collected</span>
                  <span className="sline-amt num good">{fmtCurrency(t.rent.collected)}</span>
                </div>
                {t.rent.collectedLateCount > 0 && (
                  <div className="sline">
                    <span className="sline-lbl">
                      Arrived late
                      <span className="sline-note">
                        {t.rent.collectedLateCount} payment
                        {t.rent.collectedLateCount !== 1 ? 's' : ''}, worst {t.rent.maxDaysLate} days
                      </span>
                    </span>
                    <span className="sline-amt num">{fmtCurrency(t.rent.collectedLate)}</span>
                  </div>
                )}
                {t.depositsHeld > 0 && (
                  <div className="sline">
                    <span className="sline-lbl">Deposit held</span>
                    <span className="sline-amt num">{fmtCurrency(t.depositsHeld)}</span>
                  </div>
                )}
                <div className="sline total">
                  <span className="sline-lbl">
                    {t.owed > 0 ? 'Owed right now' : 'Up to date'}
                    {t.lateFees > 0 && (
                      <span className="sline-note">
                        {fmtCurrency(t.shortfall)} of rent + {fmtCurrency(t.lateFees)} of late fees
                      </span>
                    )}
                  </span>
                  <span className={`sline-amt num${t.owed > 0 ? ' owed' : ' good'}`}>
                    {t.owed > 0 ? fmtCurrency(t.owed) : fmtCurrency(0)}
                  </span>
                </div>
                <div className="pd-acts">
                  <Link className="btn-secondary sm" href={planHref(t.planId)}>
                    Their charges
                  </Link>
                  {t.owed > 0 && (
                    <Link className="btn-primary sm" href="/landlord/financials/collections">
                      Chase this
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}

    </>
  )
}

function Fact({
  label, value, meta, tone,
}: { label: string; value: string; meta: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="lfact">
      <div className="lfact-label">{label}</div>
      <div className={`lfact-value${tone ? ' ' + tone : ''}`}>{value}</div>
      <div className="lfact-meta">{meta}</div>
    </div>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');

  .fin .kpi-value small { font-size: 0.5em; font-weight: 500; color: var(--ink-3); margin-left: 2px; }
  .fin .sec-title.sm { font-size: 13px; }
  .fin .sec-hd.tight { margin: 22px 0 10px; }
  .fin .warn-ink { color: var(--fee); font-weight: 600; }
  .fin .lead-note {
    font-size: 13px; color: var(--ink-2); line-height: 1.65; margin: 0 0 16px;
    letter-spacing: -0.01em; max-width: 86ch;
  }
  .fin .lead-note strong { color: var(--ink); }

  .fin .trow.sub { padding: 13px 18px; }
  .fin .trow-name.sm { font-size: 14px; font-weight: 500; }
  .fin .tfoot { padding: 10px 20px 14px; }

  /* ── An opened lease ── */
  .fin .lease-open { padding: 4px 20px 20px; background: var(--surface); border-top: 1px solid var(--line-2); }
  .fin .lvitals {
    display: grid; grid-template-columns: repeat(5, 1fr); gap: 0; padding-top: 16px;
  }
  .fin .lfact { padding: 0 14px; border-left: 1px solid var(--line-2); min-width: 0; }
  .fin .lfact:first-child { border-left: none; padding-left: 0; }
  .fin .lfact-label { font-size: 11px; color: var(--ink-3); }
  .fin .lfact-value {
    font-size: 16.5px; font-weight: 600; letter-spacing: -0.018em; margin-top: 3px;
    font-variant-numeric: tabular-nums;
  }
  .fin .lfact-value.good { color: var(--in); }
  .fin .lfact-value.bad  { color: var(--late); }
  .fin .lfact-meta { font-size: 11px; color: var(--ink-3); margin-top: 2px; line-height: 1.45; }
  .fin .lvitals-key {
    display: flex; gap: 18px; flex-wrap: wrap; font-size: 11px; color: var(--ink-3);
  }

  /* ── A plan ── */
  .fin .plan {
    border: 1px solid var(--line); border-radius: 14px; overflow: hidden; margin-bottom: 12px;
  }
  .fin .plan-hd {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 14px;
    flex-wrap: wrap; padding: 13px 16px; background: var(--surface-2);
    border-bottom: 1px solid var(--line-2);
  }
  .fin .plan-name {
    font-size: 14px; font-weight: 600; letter-spacing: -0.014em;
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  }
  .fin .plan-sub { font-size: 11.5px; color: var(--ink-2); margin-top: 3px; line-height: 1.5; }
  .fin .plan-acts { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .fin .tbl.payers { font-size: 13px; }
  .fin .tbl.payers thead th { position: static; }
  .fin .tbl.payers .twist { margin-right: 4px; }
  .fin .cell-note {
    font-style: normal; display: block; font-size: 10.5px; color: var(--ink-3); margin-top: 1px;
  }

  /* ── An opened payer ── */
  .fin .payer-detail td { padding: 0; background: var(--surface-2); }
  .fin .pd {
    display: grid; grid-template-columns: 1fr 1fr; gap: 26px; padding: 16px 14px 18px;
  }
  .fin .pd-half { min-width: 0; }
  .fin .pd-hd {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--ink-3);
    font-weight: 500; margin-bottom: 7px;
  }
  .fin .pd-acts { display: flex; gap: 9px; flex-wrap: wrap; margin-top: 14px; }

  /* ── Utilities ── */
  .fin .utils { display: flex; flex-direction: column; }
  .fin .util {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 10px 2px; border-top: 1px solid var(--line-2);
  }
  .fin .util:first-child { border-top: none; }
  .fin .util-main b { font-size: 13.5px; font-weight: 500; display: block; }
  .fin .util-main em {
    font-style: normal; font-size: 11.5px; color: var(--ink-3); display: block; margin-top: 1px;
  }
  .fin .util-fig { text-align: right; flex-shrink: 0; }
  .fin .util-fig b { font-size: 13.5px; font-weight: 600; display: block; font-variant-numeric: tabular-nums; }
  .fin .util-fig em { font-style: normal; font-size: 11px; color: var(--ink-3); }

  .fin .lease-acts {
    display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px;
    padding-top: 16px; border-top: 1px solid var(--line-2);
  }

  .fin .note-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 14px;
    background: var(--surface-2); border: 1px solid var(--line); border-radius: 14px;
    padding: 13px 17px; margin-top: 16px;
    font-size: 13.5px; color: var(--ink-2); line-height: 1.55; letter-spacing: -0.01em;
  }
  .fin .note-bar strong { color: var(--ink); }

  @media (max-width: 860px) {
    .fin .lvitals { grid-template-columns: repeat(2, 1fr); gap: 14px 0; }
    .fin .lfact:nth-child(odd) { border-left: none; padding-left: 0; }
    .fin .pd { grid-template-columns: 1fr; gap: 20px; }
  }
  @media (max-width: 700px) {
    .fin .trow-figs .tfig:first-child { display: none; }
    .fin .lease-open { padding: 4px 14px 16px; }
    .fin .note-bar { flex-direction: column; align-items: flex-start; gap: 10px; }
  }
`
