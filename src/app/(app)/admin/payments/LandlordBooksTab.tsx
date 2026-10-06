'use client'

// Financials, organised by landlord.
//
// The Revenue tab answers "what did the platform keep?" as one number. This tab
// answers the question that follows it — *whose* money was that, and is it
// arriving on time — by drilling the same payments down a hierarchy the operator
// already thinks in: landlord → property → lease.
//
// Three deliberate choices:
//
//   • Rent collected and net revenue sit in the same row but never in the same
//     column. Rent is the landlord's; only the surcharge is ours. A table that
//     adds them together would overstate the business by roughly 20×.
//   • Lateness is reported as both a count and a dollar figure. "Three late
//     payments" and "$4,200 overdue" prompt different actions.
//   • Late fees are shown as *derived*, with the stored column beside them when
//     the two disagree, because on this database the stored column is wrong and
//     hiding that just moves the surprise later.

import { Fragment, useEffect, useMemo, useState } from 'react'
import type { Books, LandlordBooks, LeaseBooks, PropertyBooks } from '@/lib/landlordBooks'

export type LandlordBooksPayload = {
  generatedAt: string
  rates: {
    surcharge: { card: number; ach: number }
    stripe: {
      card: { pct: number; fixedCents: number }
      ach: { pct: number; fixedCents: number; capCents: number | null }
    }
  }
  landlords: LandlordBooks[]
  landlordTotals: Books
}

// ─── FORMATTING ──────────────────────────────────────────────────────────────
const usd = (cents: number, opts: Intl.NumberFormatOptions = {}) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, ...opts })

const usd0 = (cents: number) => usd(cents, { maximumFractionDigits: 0 })
const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`

const dayLabel = (iso: string | null) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

// Status tokens, reserved for state and never reused as a series colour.
const GOOD = '#34d399'
const WARN = '#fbbf24'
const BAD  = '#fb7185'
const INK  = '#d4d4d8'
const MUTED = '#71717a'

/** On-time rate reads as a state, not a measurement: colour it like one. */
const punctualityColor = (rate: number | null) =>
  rate == null ? MUTED : rate >= 0.95 ? GOOD : rate >= 0.8 ? WARN : BAD

type SortId = 'net' | 'collected' | 'overdue' | 'late' | 'ontime' | 'name'

const SORTS: { id: SortId; label: string }[] = [
  { id: 'net',       label: 'Net to HomeHive' },
  { id: 'collected', label: 'Rent collected' },
  { id: 'overdue',   label: 'Overdue' },
  { id: 'late',      label: 'Late payments' },
  { id: 'ontime',    label: 'Worst on-time rate' },
  { id: 'name',      label: 'Name (A–Z)' },
]

function sortLandlords(list: LandlordBooks[], sort: SortId): LandlordBooks[] {
  const copy = [...list]
  switch (sort) {
    case 'collected': return copy.sort((a, b) => b.collection.collectedCents - a.collection.collectedCents)
    case 'overdue':   return copy.sort((a, b) => b.collection.overdueCents - a.collection.overdueCents)
    case 'late':      return copy.sort((a, b) =>
      (b.punctuality.paidLateCount + b.punctuality.openLateCount) -
      (a.punctuality.paidLateCount + a.punctuality.openLateCount))
    case 'ontime':    return copy.sort((a, b) => {
      // Landlords with nothing settled have no rate to rank; park them last
      // rather than letting `null` sort as if it were perfect or terrible.
      const ra = a.punctuality.onTimeRate, rb = b.punctuality.onTimeRate
      if (ra == null && rb == null) return 0
      if (ra == null) return 1
      if (rb == null) return -1
      return ra - rb
    })
    case 'name':      return copy.sort((a, b) => a.name.localeCompare(b.name))
    default:          return copy.sort((a, b) => b.earnings.netCents - a.earnings.netCents)
  }
}

// ─── SMALL PIECES ────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, color = INK }: {
  label: string; value: string; sub?: React.ReactNode; color?: string
}) {
  return (
    <div className="lb-kpi">
      <div className="lb-kpi-label">{label}</div>
      <div className="lb-kpi-value" style={{ color }}>{value}</div>
      {sub && <div className="lb-kpi-sub">{sub}</div>}
    </div>
  )
}

/** Single-series meter: how much of settled rent arrived on time. */
function OnTimeMeter({ p }: { p: LandlordBooks['punctuality'] }) {
  const settled = p.paidOnTimeCount + p.paidLateCount
  if (settled === 0) return <span className="lb-muted">no rent settled</span>
  const rate = p.onTimeRate ?? 0
  return (
    <div className="lb-meter-wrap">
      <div className="lb-meter-track">
        <div className="lb-meter-fill" style={{ width: `${rate * 100}%`, background: punctualityColor(rate) }} />
      </div>
      <span className="lb-meter-text" style={{ color: punctualityColor(rate) }}>{pct(rate)}</span>
    </div>
  )
}

/** The lateness cell: counts first, because that is what gets acted on. */
function LateCell({ p }: { p: LandlordBooks['punctuality'] }) {
  const total = p.paidLateCount + p.openLateCount
  if (total === 0) return <span className="lb-muted">none</span>
  return (
    <div className="lb-late">
      <span style={{ color: p.openLateCount > 0 ? BAD : WARN, fontWeight: 700 }}>{total}</span>
      <span className="lb-sub">
        {p.openLateCount > 0 && <>{p.openLateCount} open</>}
        {p.openLateCount > 0 && p.paidLateCount > 0 && ' · '}
        {p.paidLateCount > 0 && <>{p.paidLateCount} paid late</>}
      </span>
      {p.worstLateDays > 0 && <span className="lb-sub">worst {p.worstLateDays}d past grace</span>}
    </div>
  )
}

const BOOK_COLUMNS = 9

/** One row of money, used identically for a landlord, a property and a lease. */
function MoneyCells({ b }: { b: Books }) {
  const { collection: c, punctuality: p, earnings: e } = b
  return (
    <>
      <td className="r">
        <div className="lb-strong">{usd0(c.collectedCents)}</div>
        {c.inFlightCents > 0 && <div className="lb-sub" style={{ color: WARN }}>+{usd0(c.inFlightCents)} settling</div>}
      </td>
      <td className="r">
        {c.outstandingCents > 0 ? (
          <>
            <div>{usd0(c.outstandingCents)}</div>
            {c.overdueCents > 0 && <div className="lb-sub" style={{ color: BAD }}>{usd0(c.overdueCents)} overdue</div>}
          </>
        ) : <span className="lb-muted">—</span>}
      </td>
      <td><LateCell p={p} /></td>
      <td className="r">
        {p.lateFeesDueCents > 0
          ? <div style={{ color: WARN }}>{usd(p.lateFeesDueCents)}</div>
          : <span className="lb-muted">—</span>}
      </td>
      <td className="r">
        {e.feeCents > 0 ? (
          <>
            <div className="lb-strong">{usd(e.feeCents)}</div>
            {e.saasFeeCents > 0 && e.rentFeeCents > 0 && (
              <div className="lb-sub">{usd(e.rentFeeCents)} rent · {usd(e.saasFeeCents)} plan</div>
            )}
          </>
        ) : <span className="lb-muted">none</span>}
      </td>
      <td className="r" style={{ color: e.costCents > 0 ? BAD : '#52525b' }}>
        {e.costCents > 0 ? `−${usd(e.costCents)}` : '—'}
      </td>
      <td className="r">
        <div style={{ color: e.netCents > 0 ? GOOD : e.netCents < 0 ? BAD : MUTED, fontWeight: 700 }}>
          {usd(e.netCents)}
        </div>
        {e.feeCents > 0 && (
          <div className="lb-sub">{pct(e.netCents / e.feeCents)} of fees kept</div>
        )}
      </td>
    </>
  )
}

function LeaseRow({ lease }: { lease: LeaseBooks }) {
  const stale = lease.punctuality.lateFeesRecordedCents > 0 &&
    Math.abs(lease.punctuality.lateFeesRecordedCents - lease.punctuality.lateFeesDueCents) > 100
  return (
    <tr className="lb-row-lease">
      <td className="lb-indent-2">
        <div className="lb-lease-name">{lease.name}</div>
        <div className="lb-sub">
          {lease.lateFeeAmountCents > 0
            ? <>{usd(lease.lateFeeAmountCents)} late fee · {lease.graceDays}-day grace</>
            : 'no late-fee rule'}
          {stale && (
            <span className="lb-flag" title={`The stored late_fees_applied column says ${usd(lease.punctuality.lateFeesRecordedCents)} on this lease. Derived from the rule it is ${usd(lease.punctuality.lateFeesDueCents)}. The derived figure is the one shown.`}>
              stored column disagrees
            </span>
          )}
        </div>
        {lease.punctuality.lateFeeRisk && (
          <div className="lb-sub" style={{ color: WARN }}>⚠ {lease.punctuality.lateFeeRisk}</div>
        )}
      </td>
      <td><OnTimeMeter p={lease.punctuality} /></td>
      <MoneyCells b={lease} />
    </tr>
  )
}

function PropertyRows({ property }: { property: PropertyBooks }) {
  return (
    <>
      <tr className="lb-row-property">
        <td className="lb-indent-1">
          <div className="lb-strong">{property.name}</div>
          <div className="lb-sub">{property.leases.length} lease{property.leases.length === 1 ? '' : 's'}</div>
        </td>
        <td><OnTimeMeter p={property.punctuality} /></td>
        <MoneyCells b={property} />
      </tr>
      {property.leases.map(l => <LeaseRow key={l.id} lease={l} />)}
    </>
  )
}

// ─── THE TAB ─────────────────────────────────────────────────────────────────

export default function LandlordBooksTab() {
  const [data, setData] = useState<LandlordBooksPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortId>('net')
  const [onlyProblem, setOnlyProblem] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [limit, setLimit] = useState(25)

  useEffect(() => {
    let live = true
    fetch('/api/admin/financials')
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
        return r.json()
      })
      .then(d => { if (live) setData(d) })
      .catch(e => { if (live) setError(String(e.message ?? e)) })
    return () => { live = false }
  }, [])

  const rows = useMemo(() => {
    if (!data) return []
    const needle = q.trim().toLowerCase()
    let list = data.landlords
    if (needle) {
      list = list.filter(l =>
        [l.name, l.email, l.plan, ...l.properties.map(p => p.name), ...l.properties.flatMap(p => p.leases.map(x => x.name))]
          .some(v => v && v.toLowerCase().includes(needle)))
    }
    if (onlyProblem) {
      list = list.filter(l => l.collection.overdueCents > 0 || l.punctuality.openLateCount > 0)
    }
    return sortLandlords(list, sort)
  }, [data, q, sort, onlyProblem])

  const toggle = (id: string) =>
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const exportCsv = () => {
    if (!data) return
    const head = [
      'level', 'landlord', 'landlord_email', 'plan', 'property', 'lease',
      'rent_collected', 'rent_in_flight', 'outstanding', 'overdue',
      'paid_on_time', 'paid_late', 'open_late', 'late_fees_due',
      'our_fees', 'rent_surcharges', 'plan_revenue', 'stripe_cost', 'net_to_homehive',
    ]
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const money = (c: number) => (c / 100).toFixed(2)
    const line = (
      level: string, l: LandlordBooks, propertyName: string, leaseName: string, b: Books,
    ) => [
      level, l.name, l.email, l.plan ?? '', propertyName, leaseName,
      money(b.collection.collectedCents), money(b.collection.inFlightCents),
      money(b.collection.outstandingCents), money(b.collection.overdueCents),
      b.punctuality.paidOnTimeCount, b.punctuality.paidLateCount, b.punctuality.openLateCount,
      money(b.punctuality.lateFeesDueCents),
      money(b.earnings.feeCents), money(b.earnings.rentFeeCents), money(b.earnings.saasFeeCents),
      money(b.earnings.costCents), money(b.earnings.netCents),
    ].map(esc).join(',')

    // Every level, not just the visible one: a spreadsheet is where someone
    // pivots this, and they cannot pivot rows the export left out.
    const lines = [head.join(',')]
    for (const l of rows) {
      lines.push(line('landlord', l, '', '', l))
      for (const p of l.properties) {
        lines.push(line('property', l, p.name, '', p))
        for (const lease of p.leases) lines.push(line('lease', l, p.name, lease.name, lease))
      }
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `homehive-financials-by-landlord-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (error) return <div className="lb-empty">Couldn’t load the books — {error}</div>
  if (!data) return <div className="lb-empty">Adding up the money…</div>

  const t = data.landlordTotals
  const settled = t.punctuality.paidOnTimeCount + t.punctuality.paidLateCount
  const shown = rows.slice(0, limit)
  const landlordsWithOverdue = data.landlords.filter(l => l.collection.overdueCents > 0).length

  return (
    <>
      <style>{CSS}</style>

      {/* ── Platform-wide, so a single landlord's row has something to be a
             share of ─────────────────────────────────────────────────────── */}
      <div className="lb-kpis">
        <Kpi label="Rent collected" value={usd0(t.collection.collectedCents)}
          sub={`across ${data.landlords.length} landlord${data.landlords.length === 1 ? '' : 's'} · pass-through, not revenue`} />
        <Kpi label="Still owed" value={usd0(t.collection.outstandingCents)}
          color={t.collection.overdueCents > 0 ? WARN : INK}
          sub={t.collection.overdueCents > 0
            ? <>incl. <strong style={{ color: BAD }}>{usd0(t.collection.overdueCents)}</strong> overdue at {landlordsWithOverdue} landlord{landlordsWithOverdue === 1 ? '' : 's'}</>
            : 'nothing past its grace period'} />
        <Kpi label="Late payments" value={String(t.punctuality.paidLateCount + t.punctuality.openLateCount)}
          color={t.punctuality.openLateCount > 0 ? BAD : INK}
          sub={`${t.punctuality.openLateCount} still unpaid · ${t.punctuality.paidLateCount} settled late of ${settled}`} />
        <Kpi label="Late fees accrued" value={usd0(t.punctuality.lateFeesDueCents)}
          color={WARN} sub="derived from each lease’s rule, not the stored column" />
        <Kpi label="Fees earned" value={usd0(t.earnings.feeCents)}
          sub={`${usd0(t.earnings.rentFeeCents)} rent surcharges · ${usd0(t.earnings.saasFeeCents)} plans`} />
        <Kpi label="Net to HomeHive" value={usd0(t.earnings.netCents)} color={GOOD}
          sub={<>after {usd0(t.earnings.costCents)} to Stripe</>} />
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="lb-toolbar">
        <input className="lb-search" placeholder="Landlord, email, property, lease…"
          value={q} onChange={e => { setQ(e.target.value); setLimit(25) }} />
        <select className="lb-select" value={sort} onChange={e => setSort(e.target.value as SortId)}>
          {SORTS.map(s => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}
        </select>
        <label className="lb-check">
          <input type="checkbox" checked={onlyProblem}
            onChange={e => { setOnlyProblem(e.target.checked); setLimit(25) }} />
          Only landlords with overdue or late rent
        </label>
        <span className="lb-count">{rows.length} of {data.landlords.length}</span>
        <button className="lb-btn" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</button>
      </div>

      {/* ── The books ───────────────────────────────────────────────────── */}
      <div className="lb-table-wrap">
        <table className="lb-table">
          <thead>
            <tr>
              <th>Landlord · property · lease</th>
              <th>On time</th>
              <th className="r">Rent collected</th>
              <th className="r">Still owed</th>
              <th>Late</th>
              <th className="r">Late fees</th>
              <th className="r">Our fees</th>
              <th className="r">Stripe</th>
              <th className="r">Net to us</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(l => {
              const isOpen = open.has(l.id)
              return (
                <Fragment key={l.id}>
                  <tr className={`lb-row-landlord${isOpen ? ' open' : ''}`}
                    onClick={() => toggle(l.id)}
                    // The whole row is the hit target, so it needs to be
                    // reachable the way a disclosure button would be.
                    tabIndex={0}
                    role="button"
                    aria-expanded={isOpen}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(l.id) }
                    }}>
                    <td>
                      <div className="lb-landlord">
                        <span className="lb-caret">{isOpen ? '▾' : '▸'}</span>
                        <div>
                          <div className="lb-strong">{l.name}</div>
                          <div className="lb-sub">
                            {l.email ?? 'no email'}
                            {l.plan && <> · <span className="lb-pill">{l.plan}{l.comped ? ' (comped)' : ''}</span></>}
                            {' · '}{l.propertyCount} propert{l.propertyCount === 1 ? 'y' : 'ies'}, {l.leaseCount} lease{l.leaseCount === 1 ? '' : 's'}
                          </div>
                          <div className="lb-sub">
                            {l.earnings.paymentCount > 0
                              ? <>{l.earnings.paymentCount} payment{l.earnings.paymentCount === 1 ? '' : 's'} · {dayLabel(l.firstPaymentDate)} → {dayLabel(l.lastPaymentDate)}</>
                              : 'no payments recorded'}
                            {l.earnings.offPlatformVolumeCents > 0 &&
                              <> · {usd0(l.earnings.offPlatformVolumeCents)} collected off-platform</>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td><OnTimeMeter p={l.punctuality} /></td>
                    <MoneyCells b={l} />
                  </tr>
                  {isOpen && l.properties.map(p => <PropertyRows key={`${l.id}:${p.id}`} property={p} />)}
                  {isOpen && l.properties.length === 0 && (
                    <tr className="lb-row-property">
                      <td className="lb-indent-1 lb-muted" colSpan={BOOK_COLUMNS}>
                        No leases on this landlord — their revenue is plan subscriptions only.
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={BOOK_COLUMNS} className="lb-muted">
                No landlord matches that filter.
              </td></tr>
            )}
          </tbody>
        </table>
        {rows.length > limit && (
          <button className="lb-more" onClick={() => setLimit(n => n + 50)}>
            Show more — {rows.length - limit} more landlord{rows.length - limit === 1 ? '' : 's'}
          </button>
        )}
      </div>

      <p className="lb-footnote">
        Rent collected is the landlord’s money passing through us; only “our fees” is revenue —
        {' '}{pct(data.rates.surcharge.card)} on card and {pct(data.rates.surcharge.ach)} on ACH, plus plan prices.
        Stripe cost is estimated from published US pricing ({pct(data.rates.stripe.card.pct, 1)} + {usd(data.rates.stripe.card.fixedCents)} per card charge,
        {' '}{pct(data.rates.stripe.ach.pct, 1)} capped at {usd(data.rates.stripe.ach.capCents ?? 0)} per ACH debit) and billed on the whole charge, not our slice.
        Late fees are recomputed from each lease’s rule against the date the charge actually settled —
        the stored <code>late_fees_applied</code> column is unreliable and is never summed here.
        Updated {new Date(data.generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.
      </p>
    </>
  )
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const CSS = `
  .lb-empty { padding: 48px; text-align: center; color: #71717a; font-size: 13px; }

  .lb-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .lb-kpi { background: #27272a; border: 1px solid #3f3f46; border-radius: 12px; padding: 14px 16px; }
  .lb-kpi-label { font-size: 10px; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: .6px; margin-bottom: 6px; }
  .lb-kpi-value { font-size: 24px; font-weight: 800; letter-spacing: -.6px; line-height: 1.15; }
  .lb-kpi-sub { font-size: 11px; color: #71717a; margin-top: 5px; line-height: 1.45; }

  .lb-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
  .lb-search { flex: 1 1 240px; min-width: 200px; padding: 7px 12px; border-radius: 8px; border: 1px solid #3f3f46;
    background: #1f1f22; color: #fafafa; font-size: 12px; font-family: 'DM Sans', sans-serif; }
  .lb-search::placeholder { color: #52525b; }
  .lb-select { padding: 7px 10px; border-radius: 8px; border: 1px solid #3f3f46; background: #1f1f22;
    color: #d4d4d8; font-size: 12px; font-family: 'DM Sans', sans-serif; cursor: pointer; }
  .lb-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #a1a1aa; cursor: pointer; }
  .lb-check input { accent-color: #a78bfa; cursor: pointer; }
  .lb-count { font-size: 11px; color: #52525b; margin-left: auto; }
  .lb-btn { padding: 7px 14px; border-radius: 8px; border: 1px solid #3f3f46; background: #27272a;
    color: #d4d4d8; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
  .lb-btn:hover:not(:disabled) { border-color: #52525b; color: #fafafa; }
  .lb-btn:disabled { opacity: .45; cursor: not-allowed; }

  .lb-table-wrap { background: #27272a; border: 1px solid #3f3f46; border-radius: 12px; overflow-x: auto; }
  .lb-table { width: 100%; border-collapse: collapse; min-width: 1080px; }
  .lb-table thead th { background: #1f1f22; padding: 9px 14px; text-align: left; font-size: 10px; font-weight: 700;
    color: #71717a; text-transform: uppercase; letter-spacing: .6px; white-space: nowrap; position: sticky; top: 0; }
  .lb-table th.r, .lb-table td.r { text-align: right; }
  .lb-table td { padding: 11px 14px; vertical-align: top; font-size: 13px; color: #d4d4d8;
    border-top: 1px solid #3f3f46; }

  .lb-row-landlord { cursor: pointer; transition: background .1s; }
  .lb-row-landlord:hover { background: rgba(250,250,250,.035); }
  .lb-row-landlord.open { background: rgba(167,139,250,.07); }
  .lb-row-landlord:focus-visible { outline: 2px solid #a78bfa; outline-offset: -2px; }
  .lb-row-landlord > td { border-top: 1px solid #52525b; }
  .lb-row-property > td { background: rgba(0,0,0,.14); font-size: 12px; }
  .lb-row-lease > td { background: rgba(0,0,0,.26); font-size: 12px; color: #a1a1aa; }

  .lb-landlord { display: flex; gap: 9px; align-items: flex-start; }
  .lb-caret { color: #71717a; font-size: 11px; line-height: 1.6; width: 10px; flex: none; }
  .lb-indent-1 { padding-left: 38px !important; }
  .lb-indent-2 { padding-left: 60px !important; }
  .lb-lease-name { color: #d4d4d8; font-weight: 600; }

  .lb-strong { font-weight: 600; color: #fafafa; }
  .lb-sub { font-size: 11px; color: #71717a; margin-top: 2px; line-height: 1.45; }
  .lb-muted { color: #52525b; }
  .lb-pill { display: inline-block; padding: 1px 7px; border-radius: 10px; border: 1px solid #52525b;
    font-size: 10px; font-weight: 600; color: #a1a1aa; }
  .lb-flag { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 9px;
    border: 1px solid rgba(251,191,36,.45); background: rgba(251,191,36,.12); color: #fbbf24;
    font-size: 10px; font-weight: 600; cursor: help; }

  .lb-meter-wrap { display: flex; align-items: center; gap: 7px; min-width: 96px; }
  .lb-meter-track { flex: 1; height: 5px; border-radius: 3px; background: #3f3f46; overflow: hidden; }
  .lb-meter-fill { height: 100%; border-radius: 3px; }
  .lb-meter-text { font-size: 11px; font-weight: 700; min-width: 30px; text-align: right; }

  .lb-late { display: flex; flex-direction: column; gap: 1px; }

  .lb-more { width: 100%; padding: 11px; background: #1f1f22; border: none; border-top: 1px solid #3f3f46;
    color: #a1a1aa; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
  .lb-more:hover { color: #fafafa; }

  .lb-footnote { margin-top: 14px; font-size: 11px; color: #52525b; line-height: 1.65; max-width: 980px; }
  .lb-footnote code { background: #27272a; padding: 1px 4px; border-radius: 4px; font-size: 10px; }

  @media (max-width: 900px) {
    .lb-count { margin-left: 0; }
  }
`
