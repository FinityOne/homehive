'use client'

/**
 * Collections — who is behind, how far behind, and what to do about it.
 *
 * ── Why this is its own page ───────────────────────────────────────────────
 *
 * Chasing rent is the one genuinely operational job in the money area, and it
 * used to be two sections buried halfway down a six-section scroll: "missed
 * payments", grouped by payer, and the late-fee ledger underneath it. Both were
 * good. Neither could be *worked*, because neither could be cut — no way to see
 * only one building, no way to separate a debt that is a week old from one that
 * is three months old, no way to hand a list to someone else.
 *
 * So this page is the work surface, and it is allowed to be a table.
 *
 * ── Grouped by person, not by charge ───────────────────────────────────────
 *
 * A landlord chases a *person*. Three missed months from one tenant is one
 * phone call and one figure to quote; a flat list of charges makes that take
 * arithmetic, which is exactly what the old page asked of its reader. So each
 * row is a payer on a tenancy, opening to the charges underneath.
 *
 * Keyed per lease as well as per person, for a reason that matters: the same
 * name on two tenancies is two separate conversations, and one email covering
 * both would be unanswerable.
 *
 * ── Age is the axis, because age decides the action ────────────────────────
 *
 * $4,000 that went overdue yesterday is an email. The same $4,000 ninety days
 * old is a legal question. Collapsing both into one arrears figure is why a
 * portfolio can sit at a large, stable number for months with nothing ever
 * escalating. The buckets are the ones an accountant's aging report uses —
 * 1–15, 16–30, 31–60, 60+ — so the two documents can be read side by side.
 *
 * ── Late fees are kept separate, deliberately ─────────────────────────────
 *
 * A fee on rent that has *already settled* is not arrears at all, and that is
 * where nearly all of this money is. It also needs an action arrears does not
 * have: writing it off is a legitimate, often correct outcome, and in much of
 * the US billing a fee months after accepting rent in full is unenforceable.
 * So fees get their own section with its own ledger — see
 * `src/lib/lateFees.ts`, which explains why that judgement belongs in the
 * product rather than in the landlord's head.
 */

import { use, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { fmtCurrency, fmtDate } from '@/lib/payments'
import { useMoney } from '@/lib/useMoney'
import { buildTree, leaseHref, planHref } from '@/lib/financialsTree'
import {
  arrears, filterPlans, type ArrearsPayer, type Charge, type LeaseFilter,
} from '@/lib/financialsMonth'
import { agingBuckets, bucketOf, type AgingBucket } from '@/lib/financialsDashboard'
import {
  lateFeeLedger, withReminderHistory, EMPTY_LEDGER, type LateFeeLedger,
} from '@/lib/lateFees'
import { waivedLedger, EMPTY_WAIVED_LEDGER } from '@/lib/lateFeeWaivers'
import MoneyHub from '@/components/finance/MoneyHub'
import { AgingChart, VIZ_CSS } from '@/components/finance/Charts'
import ChargeSheet, { StatePill } from '@/components/finance/ChargeSheet'
import { FINANCE_THEME } from '@/lib/financeTheme'

const LateFeesPanel = dynamic(() => import('@/components/payments/LateFeesPanel'), { ssr: false })

type SortKey = 'amount' | 'age' | 'name' | 'property'

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'amount',   label: 'Most owed' },
  { id: 'age',      label: 'Oldest debt' },
  { id: 'name',     label: 'Tenant name' },
  { id: 'property', label: 'Property' },
]

const AGE_LABEL: Record<AgingBucket['id'], string> = {
  fresh: '1–15 days', month: '16–30 days', twoMonths: '31–60 days', severe: '60+ days',
}

/** The list as a spreadsheet. A landlord working arrears with a bookkeeper or a
 *  lawyer needs to hand the list over, and "screenshot the page" is not that. */
function arrearsCsv(rows: ArrearsPayer[]): string {
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = [
    'Tenant', 'Email', 'Property', 'Lease', 'Charges missed', 'Oldest due',
    'Days late', 'Rent owed', 'Late fees', 'Total owed',
  ]
  const body = rows.map(p => [
    p.name, p.email ?? '', p.propertyName, p.leaseName, p.charges.length,
    p.oldestDue, p.maxDaysLate, p.shortfall.toFixed(2), p.lateFees.toFixed(2), p.total.toFixed(2),
  ])
  return [head, ...body].map(r => r.map(esc).join(',')).join('\n')
}

export default function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ age?: string; property?: string; leases?: string; q?: string }>
}) {
  const sp = use(searchParams)
  const router = useRouter()
  const { plans, waivers, bounced, loading, reload } = useMoney()

  // Everything in view, including ended leases: a debt does not stop being
  // owed because the tenancy finished, and this is the page where that
  // matters most. The filter is still available, it simply is not the default
  // here the way it is everywhere else.
  const [leaseFilter, setLeaseFilter] = useState<LeaseFilter>(
    sp.leases === 'current' || sp.leases === 'past' || sp.leases === 'upcoming'
      ? (sp.leases as LeaseFilter)
      : 'all',
  )
  const [age, setAge] = useState<AgingBucket['id'] | 'all'>(
    ['fresh', 'month', 'twoMonths', 'severe'].includes(sp.age ?? '')
      ? (sp.age as AgingBucket['id'])
      : 'all',
  )
  const [property, setProperty] = useState(sp.property ?? '')
  const [query, setQuery] = useState(sp.q ?? '')
  const [sort, setSort] = useState<SortKey>('amount')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [detail, setDetail] = useState<Charge | null>(null)

  useEffect(() => { document.title = 'Collections — Financials | HomeHive' }, [])

  const scoped = useMemo(() => filterPlans(plans, leaseFilter), [plans, leaseFilter])
  const tree = useMemo(() => buildTree(scoped, waivers), [scoped, waivers])
  const a = useMemo(() => arrears(scoped), [scoped])
  const buckets = useMemo(() => agingBuckets(a), [a])

  /** Late fees across the whole of each lease — like arrears, bound to no
   *  window, because a fee assessed in August is still unpaid in November.
   *  Reminder history rides on the rent rows, so it is folded in here rather
   *  than costing a second round trip. */
  const feeLedger = useMemo<LateFeeLedger>(() => {
    if (scoped.length === 0) return EMPTY_LEDGER
    const history: Record<string, { count: number; lastAt: string | null }> = {}
    for (const p of scoped) {
      for (const sp2 of p.scheduled_payments ?? []) {
        if (sp2.late_fee_reminder_count > 0) {
          history[sp2.id] = { count: sp2.late_fee_reminder_count, lastAt: sp2.late_fee_reminder_sent_at }
        }
      }
    }
    return withReminderHistory(lateFeeLedger(scoped, waivers), history)
  }, [scoped, waivers])

  /** What has been forgiven. A waived fee leaves the ledger by design — it is
   *  not owed — so without this the money would simply vanish from the page,
   *  and so would the fact that some of it was given up. */
  const waivedLog = useMemo(
    () => (scoped.length === 0 ? EMPTY_WAIVED_LEDGER : waivedLedger(scoped, waivers)),
    [scoped, waivers],
  )

  const properties = useMemo(
    () => [...new Set(a.payers.map(p => p.propertyName))].sort((x, y) => x.localeCompare(y)),
    [a],
  )

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = a.payers.filter(p => {
      if (property && p.propertyName !== property) return false
      if (age !== 'all' && bucketOf(p.maxDaysLate) !== age) return false
      if (q && !(
        p.name.toLowerCase().includes(q) ||
        (p.email ?? '').toLowerCase().includes(q) ||
        p.propertyName.toLowerCase().includes(q) ||
        p.leaseName.toLowerCase().includes(q)
      )) return false
      return true
    })
    const by: Record<SortKey, (x: ArrearsPayer, y: ArrearsPayer) => number> = {
      amount:   (x, y) => y.total - x.total,
      age:      (x, y) => y.maxDaysLate - x.maxDaysLate,
      name:     (x, y) => x.name.localeCompare(y.name),
      property: (x, y) => x.propertyName.localeCompare(y.propertyName) || y.total - x.total,
    }
    return list.slice().sort(by[sort])
  }, [a, property, age, query, sort])

  const shownTotal = rows.reduce((n, p) => n + p.total, 0)
  const filtered = age !== 'all' || property !== '' || query.trim() !== '' || leaseFilter !== 'all'
  const leaseKeyOfPlan = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of tree.leases) for (const p of l.plans) m.set(p.planId, l.key)
    return m
  }, [tree])

  const toggle = (key: string) => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const download = () => {
    const blob = new Blob([arrearsCsv(rows)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a2 = document.createElement('a')
    a2.href = url
    a2.download = `arrears-${new Date().toISOString().slice(0, 10)}.csv`
    a2.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <style>{FINANCE_THEME}{VIZ_CSS}{CSS}</style>
      <div className="fin fin-wrap">
        <MoneyHub
          tab="collections"
          title="Collections"
          sub={a.total > 0
            ? `${fmtCurrency(a.total)} overdue across ${a.payerCount} ${
                a.payerCount === 1 ? 'person' : 'people'} — the whole of each lease, not this month.`
            : 'Nobody is behind on rent anywhere in the portfolio.'}
          action={rows.length > 0 ? { label: 'Export this list', onClick: download } : undefined}
          alarmCount={bounced}
          dueCount={a.payerCount}
          filters={
            <div className="filters">
              <input
                className="fsearch"
                type="search"
                placeholder="Tenant, email or property…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                aria-label="Search the arrears list"
              />
              <select
                className={`fsel${age !== 'all' ? ' on' : ''}`}
                value={age}
                onChange={e => setAge(e.target.value as AgingBucket['id'] | 'all')}
                aria-label="How old"
              >
                <option value="all">Any age</option>
                {buckets.map(b => (
                  <option key={b.id} value={b.id} disabled={b.amount === 0}>
                    {AGE_LABEL[b.id]} ({b.payerCount})
                  </option>
                ))}
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
              <select
                className={`fsel${leaseFilter !== 'all' ? ' on' : ''}`}
                value={leaseFilter}
                onChange={e => setLeaseFilter(e.target.value as LeaseFilter)}
                aria-label="Which leases"
              >
                <option value="all">Every lease</option>
                <option value="current">Live leases only</option>
                <option value="past">Finished leases only</option>
              </select>
              <select
                className={`fsel${sort !== 'amount' ? ' on' : ''}`}
                value={sort}
                onChange={e => setSort(e.target.value as SortKey)}
                aria-label="Sort by"
              >
                {SORTS.map(s => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}
              </select>
              {filtered && (
                <button
                  className="btn-quiet sm"
                  onClick={() => { setAge('all'); setProperty(''); setQuery(''); setLeaseFilter('all') }}
                >
                  Reset
                </button>
              )}
              <span className="fcount">
                {rows.length} of {a.payerCount} · {fmtCurrency(shownTotal)}
              </span>
            </div>
          }
        />

        {loading ? (
          <div className="skeleton-hero" />
        ) : (
          <>
            {/* ══ THE SHAPE OF THE DEBT ══ */}
            <div className="kpis">
              <div className={`kpi lead${a.total > 0 ? ' hot' : ''}`}>
                <div className="kpi-label">Overdue in total</div>
                <div className={`kpi-value ${a.total > 0 ? 'bad' : 'good'}`}>
                  {a.total > 0 ? fmtCurrency(a.total) : 'All clear'}
                </div>
                <div className="kpi-meta">
                  {a.total > 0
                    ? `${a.payerCount} ${a.payerCount === 1 ? 'person' : 'people'} · ${
                        a.chargeCount} charge${a.chargeCount !== 1 ? 's' : ''} · worst ${
                        a.maxDaysLate} days late`
                    : 'every charge that has come due has been settled'}
                </div>
                {a.lateFees > 0 && (
                  <div className="kpi-foot">
                    {fmtCurrency(a.shortfall)} of rent and charges + {fmtCurrency(a.lateFees)} of
                    late fees assessed on them
                  </div>
                )}
              </div>
              <div className="kpi">
                <div className="kpi-label">Worst case</div>
                <div className="kpi-value">
                  {a.payers[0] ? fmtCurrency(a.payers[0].total) : '—'}
                </div>
                <div className="kpi-meta">
                  {a.payers[0]
                    ? `${a.payers[0].name} · ${a.payers[0].propertyName}`
                    : 'nothing outstanding'}
                </div>
              </div>
              <div className={`kpi${buckets[3].amount > 0 ? ' hot' : ''}`}>
                <div className="kpi-label">Past 60 days</div>
                <div className={`kpi-value ${buckets[3].amount > 0 ? 'bad' : 'good'}`}>
                  {buckets[3].amount > 0 ? fmtCurrency(buckets[3].amount) : 'None'}
                </div>
                <div className="kpi-meta">
                  {buckets[3].amount > 0
                    ? `${buckets[3].payerCount} ${buckets[3].payerCount === 1 ? 'person' : 'people'} · rarely collected without a notice`
                    : 'nothing has aged that far'}
                </div>
              </div>
              <div className={`kpi${feeLedger.total > 0 ? ' warm' : ''}`}>
                <div className="kpi-label">Late fees owed</div>
                <div className={`kpi-value ${feeLedger.total > 0 ? 'warn' : 'good'}`}>
                  {feeLedger.total > 0 ? fmtCurrency(feeLedger.total) : 'None'}
                </div>
                <div className="kpi-meta">
                  {feeLedger.accruing > 0
                    ? `${fmtCurrency(feeLedger.accruing)} still growing · ${fmtCurrency(feeLedger.perDay)}/day`
                    : feeLedger.total > 0
                      ? 'all frozen — the rent they sat on has settled'
                      : 'nothing assessed and unpaid'}
                </div>
                <a className="kpi-go" href="#fees">See the fee ledger →</a>
              </div>
            </div>

            {a.total > 0 && (
              <div className="cards two">
                <section className="card">
                  <div className="card-hd">
                    <div>
                      <h2 className="card-title">By age</h2>
                      <p className="muted sm">How old a debt is decides what to do about it.</p>
                    </div>
                    <span className="card-note">click to filter</span>
                  </div>
                  <AgingChart buckets={buckets} onSelect={id => setAge(id)} />
                </section>

                <section className="card">
                  <div className="card-hd">
                    <div>
                      <h2 className="card-title">By property</h2>
                      <p className="muted sm">Where the money is sitting.</p>
                    </div>
                  </div>
                  <div className="plist">
                    {[...new Map(
                      a.payers.map(p => [p.propertyName, a.payers.filter(x => x.propertyName === p.propertyName)]),
                    ).entries()]
                      .map(([name, ps]) => ({
                        name,
                        total: ps.reduce((n, p) => n + p.total, 0),
                        people: ps.length,
                        worst: Math.max(...ps.map(p => p.maxDaysLate)),
                      }))
                      .sort((x, y) => y.total - x.total)
                      .map(r => (
                        <button
                          key={r.name}
                          className="prow"
                          onClick={() => setProperty(property === r.name ? '' : r.name)}
                        >
                          <span className="prow-main">
                            <b>
                              {r.name}
                              {property === r.name && <span className="pill info">filtering</span>}
                            </b>
                            <em>
                              {r.people} {r.people === 1 ? 'person' : 'people'} · worst {r.worst} days late
                            </em>
                          </span>
                          <span className="prow-owed">
                            <b className="owed">{fmtCurrency(r.total)}</b>
                            <em>overdue</em>
                          </span>
                        </button>
                      ))}
                  </div>
                </section>
              </div>
            )}

            {/* ══ THE LIST ══ */}
            <section className="panel">
              <div className="panel-hd">
                <h2 className="panel-title">
                  Who is behind
                  {rows.length > 0 && <span className="panel-count">{rows.length}</span>}
                </h2>
                <span className="panel-note">
                  {rows.length > 0
                    ? `${fmtCurrency(shownTotal)} across the whole of these leases`
                    : filtered ? 'nothing matches these filters' : 'nobody'}
                </span>
              </div>

              <div className={`panel-bd${rows.length ? ' flush' : ''}`}>
                {a.payerCount === 0 ? (
                  <p className="muted">
                    Every charge that has come due has been paid. Rent that is not due yet is on
                    the <Link className="lnk" href="/landlord/financials/schedule">schedule</Link>,
                    not here.
                  </p>
                ) : rows.length === 0 ? (
                  <p className="muted">
                    No tenant matches these filters, though {fmtCurrency(a.total)} is overdue
                    elsewhere in the portfolio.{' '}
                    <button className="btn-quiet sm" onClick={() => { setAge('all'); setProperty(''); setQuery('') }}>
                      Clear the filters
                    </button>
                  </p>
                ) : rows.map(p => (
                  <PayerBlock
                    key={p.key}
                    payer={p}
                    open={open.has(p.key)}
                    onToggle={() => toggle(p.key)}
                    onInspect={setDetail}
                    leaseKey={leaseKeyOfPlan.get(p.planId) ?? `plan-${p.planId}`}
                  />
                ))}
              </div>

              {rows.length > 0 && (
                <div className="panel-ft">
                  <span>
                    Every figure here is <strong>rent owed plus the late fee the rule assessed on
                    it</strong> — the number to put in front of the tenant, not the rent half of it.
                  </span>
                  <button className="btn-secondary sm" onClick={download}>Export CSV</button>
                </div>
              )}
            </section>

            {/* ══ LATE FEES ══
                Its own section rather than a line inside arrears: a fee on rent
                that has already settled is not arrears at all, and that is
                where nearly all of this money is. */}
            <div id="fees">
              <LateFeesPanel
                ledger={feeLedger}
                waived={waivedLog}
                onReload={reload}
                onOpenLease={planId => router.push(planHref(planId))}
              />
            </div>
          </>
        )}
      </div>

      {detail && <ChargeSheet charge={detail} onClose={() => setDetail(null)} />}
    </>
  )
}

/** One person behind on one tenancy, opening to the charges underneath. */
function PayerBlock({
  payer: p, open, onToggle, onInspect, leaseKey,
}: {
  payer: ArrearsPayer
  open: boolean
  onToggle: () => void
  onInspect: (c: Charge) => void
  leaseKey: string
}) {
  const bucket = bucketOf(p.maxDaysLate)
  return (
    <div className="miss">
      <div
        className="miss-row"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() }
        }}
      >
        <span className={`twist${open ? ' open' : ''}`} aria-hidden="true" />
        <span className={`age-dot age-${bucket}`} title={AGE_LABEL[bucket]} aria-hidden="true" />
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
            {p.lateFees > 0
              ? `${fmtCurrency(p.shortfall)} + ${fmtCurrency(p.lateFees)} fees`
              : 'outstanding'}
          </div>
        </div>
      </div>

      {open && (
        <div className="miss-detail">
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Charge</th>
                  <th>Due</th>
                  <th className="num">Billed</th>
                  <th className="num">Paid</th>
                  <th className="num">Still due</th>
                  <th>Chased</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {p.charges.map(c => (
                  <tr key={`${c.kind}-${c.id}`} className="click" onClick={() => onInspect(c)}>
                    <td className="cell-main">
                      <b>{c.label}</b>
                      <em>{c.kind === 'charge' ? (c.categoryLabel ?? 'one-off') : 'rent'}</em>
                    </td>
                    <td>
                      {fmtDate(c.dueDate)}
                      <em className="cell-note">{c.daysLate}d late</em>
                    </td>
                    <td className="num">{fmtCurrency(c.amount)}</td>
                    <td className="num">{c.paid > 0 ? fmtCurrency(c.paid) : '—'}</td>
                    <td className="num owed">
                      {fmtCurrency(c.totalDue)}
                      {c.lateFee > 0 && <em className="cell-note">incl. {fmtCurrency(c.lateFee)} fee</em>}
                    </td>
                    <td>
                      {c.chases.count > 0
                        ? <>{c.chases.count}×<em className="cell-note">
                            {c.chases.lastAt ? fmtDate(c.chases.lastAt.slice(0, 10)) : ''}
                          </em></>
                        : <span className="muted sm">never</span>}
                    </td>
                    <td><StatePill state={c.state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="miss-actions">
            <Link className="btn-primary sm" href={planHref(p.planId)}>
              Chase or record a payment
            </Link>
            <Link className="btn-secondary sm" href={leaseHref(leaseKey)}>
              The whole tenancy
            </Link>
            <Link className="btn-secondary sm" href={`/landlord/reminders?plan=${p.planId}`}>
              What they were sent
            </Link>
            {p.email && (
              <a
                className="btn-quiet sm"
                href={`mailto:${p.email}?subject=${encodeURIComponent(
                  `Rent outstanding — ${p.propertyName}`,
                )}&body=${encodeURIComponent(
                  `Hi ${p.name.split(' ')[0]},\n\n` +
                  `Our records show ${fmtCurrency(p.total)} outstanding on ${p.propertyName}` +
                  `${p.lateFees > 0 ? ` (${fmtCurrency(p.shortfall)} of rent and charges plus ${fmtCurrency(p.lateFees)} in late fees)` : ''}` +
                  `, the oldest due ${fmtDate(p.oldestDue)}.\n\nCould you let me know when it will be settled?\n\nThank you.`,
                )}`}
              >
                Email directly
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');

  .fin .miss { border-bottom: 1px solid var(--line-2); }
  .fin .miss:last-child { border-bottom: none; }
  .fin .miss-row {
    display: flex; align-items: center; gap: 12px; padding: 14px 22px; cursor: pointer;
  }
  .fin .miss-row:hover { background: var(--surface-2); }
  .fin .miss-main { flex: 1; min-width: 0; }
  .fin .miss-name {
    font-size: 14.5px; font-weight: 600; letter-spacing: -0.015em;
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  }
  .fin .miss-sub { font-size: 12px; color: var(--ink-2); margin-top: 3px; line-height: 1.5; }
  .fin .miss-fig { text-align: right; flex-shrink: 0; }
  .fin .miss-amt {
    font-size: 16px; font-weight: 600; color: var(--late); font-variant-numeric: tabular-nums;
  }
  .fin .miss-amt-lbl { font-size: 11px; color: var(--ink-3); margin-top: 1px; }
  .fin .miss-detail { background: var(--surface-2); padding: 4px 22px 18px; border-top: 1px solid var(--line-2); }
  .fin .miss-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }

  .fin .cell-note {
    font-style: normal; display: block; font-size: 10.5px; color: var(--ink-3); margin-top: 1px;
  }
  .fin .tbl td.owed { color: var(--late); font-weight: 600; }

  .fin .plist { display: flex; flex-direction: column; }
  .fin .prow {
    display: flex; align-items: center; gap: 16px; padding: 11px 2px; width: 100%;
    border: none; border-top: 1px solid var(--line-2); background: none;
    font-family: inherit; color: inherit; text-align: left; cursor: pointer;
  }
  .fin .prow:first-child { border-top: none; }
  .fin .prow:hover { background: var(--surface-2); }
  .fin .prow-main { flex: 1; min-width: 0; }
  .fin .prow-main b {
    font-size: 13.5px; font-weight: 500; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  }
  .fin .prow-main em { font-style: normal; display: block; font-size: 11.5px; color: var(--ink-3); margin-top: 2px; }
  .fin .prow-owed { text-align: right; flex-shrink: 0; }
  .fin .prow-owed b { font-size: 13.5px; font-weight: 600; display: block; font-variant-numeric: tabular-nums; }
  .fin .prow-owed b.owed { color: var(--late); }
  .fin .prow-owed em { font-style: normal; font-size: 11px; color: var(--ink-3); }

  @media (max-width: 700px) {
    .fin .miss-row { padding: 13px 14px; }
    .fin .miss-detail { padding: 4px 12px 16px; }
  }
`
