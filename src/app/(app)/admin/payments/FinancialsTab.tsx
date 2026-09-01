'use client'

// The Financials tab of the admin money hub.
//
// It is built around one question an operator asks first — "what did we keep
// this month?" — and then lets them take that number apart: which rail earned
// it, which landlord produced it, and which individual charge it came from.
// Everything reads from /api/admin/financials, which does the arithmetic; this
// file only chooses what deserves to be near the top.
//
// A deliberate choice: gross fees are never shown without the Stripe cost
// beside them. On card the processor takes ~39% of the surcharge, and a
// dashboard that reports the gross alone would flatter the business by a third.

import { useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'

// ─── TYPES ───────────────────────────────────────────────────────────────────
type Econ = {
  volumeCents: number
  passThroughCents: number
  feeCents: number
  costCents: number
  netCents: number
}

type Txn = Econ & {
  id: string
  kind: 'rent' | 'subscription' | 'lifetime' | 'per_lead'
  source: string
  date: string
  month: string
  status: 'paid' | 'processing'
  method: 'card' | 'ach' | 'manual_zelle' | 'manual_other'
  onPlatform: boolean
  items: string[]
  payer: string | null
  payerEmail: string | null
  propertyId: string | null
  propertyName: string | null
  landlordId: string | null
  landlordName: string | null
  intentId: string | null
}

type MonthRow = Econ & {
  month: string
  count: number
  rentNetCents: number
  saasNetCents: number
  offPlatformVolumeCents: number
}

export type FinancialsData = {
  generatedAt: string
  rates: {
    surcharge: { card: number; ach: number }
    stripe: {
      card: { pct: number; fixedCents: number }
      ach: { pct: number; fixedCents: number; capCents: number | null }
    }
  }
  totals: {
    allTime: Econ
    mtd: Econ
    prevMtd: Econ
    prevFull: Econ
    thisMonth: string
    prevMonth: string
    dayOfMonth: number
    inFlight: Econ
    offPlatform: Econ
    outstandingCents: number
    overdueCents: number
    achOpportunityCents: number
    txCount: number
    onPlatformTxCount: number
  }
  byMonth: MonthRow[]
  byMethod: (Econ & { method: Txn['method']; count: number })[]
  bySource: (Econ & { source: string; count: number })[]
  topLandlords: (Econ & { id: string; name: string; count: number })[]
  topProperties: (Econ & { id: string; name: string; count: number })[]
  transactions: Txn[]
  alerts: { level: 'warn' | 'info'; text: string }[]
}

// ─── FORMATTING ──────────────────────────────────────────────────────────────
const usd = (cents: number, opts: Intl.NumberFormatOptions = {}) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, ...opts })

/** Whole dollars for headline figures — cents are noise at this size. */
const usd0 = (cents: number) => usd(cents, { maximumFractionDigits: 0 })

const compact = (cents: number) => {
  const d = cents / 100
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`
  if (Math.abs(d) >= 1_000) return `$${(d / 1_000).toFixed(d >= 10_000 ? 0 : 1)}k`
  return `$${Math.round(d)}`
}

const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

const dayLabel = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const METHOD_META: Record<Txn['method'], { label: string; color: string }> = {
  card:         { label: 'Card',    color: '#a78bfa' },
  ach:          { label: 'ACH',     color: '#38bdf8' },
  manual_zelle: { label: 'Zelle',   color: '#f59e0b' },
  manual_other: { label: 'Manual',  color: '#71717a' },
}

const SOURCE_META: Record<string, { label: string; color: string }> = {
  rent_card:    { label: 'Rent surcharge — card', color: '#a78bfa' },
  rent_ach:     { label: 'Rent surcharge — ACH',  color: '#38bdf8' },
  subscription: { label: 'Subscriptions',          color: '#10b981' },
  lifetime:     { label: 'Lifetime deals',         color: '#f59e0b' },
  per_lead:     { label: 'Lead unlocks',           color: '#3b82f6' },
}

const NET = '#34d399'
const COST = '#fb7185'
const VOLUME = '#818cf8'

const empty: Econ = { volumeCents: 0, passThroughCents: 0, feeCents: 0, costCents: 0, netCents: 0 }
const addE = (a: Econ, b: Econ): Econ => ({
  volumeCents: a.volumeCents + b.volumeCents,
  passThroughCents: a.passThroughCents + b.passThroughCents,
  feeCents: a.feeCents + b.feeCents,
  costCents: a.costCents + b.costCents,
  netCents: a.netCents + b.netCents,
})
const sumE = (rows: Econ[]) => rows.reduce(addE, empty)

// ─── PERIOD ──────────────────────────────────────────────────────────────────
type PeriodId = 'mtd' | 'last' | 'q' | 'y' | 'all'

const PERIODS: { id: PeriodId; label: string; months: number | null }[] = [
  { id: 'mtd',  label: 'This month',  months: 1  },
  { id: 'last', label: 'Last month',  months: 1  },
  { id: 'q',    label: '3 months',    months: 3  },
  { id: 'y',    label: '12 months',   months: 12 },
  { id: 'all',  label: 'All time',    months: null },
]

/** Which YYYY-MM keys a period covers. `null` means "no filter". */
function periodMonths(id: PeriodId, data: FinancialsData): Set<string> | null {
  const all = data.byMonth.map(m => m.month)
  if (id === 'all') return null
  if (id === 'mtd') return new Set([data.totals.thisMonth])
  if (id === 'last') return new Set([data.totals.prevMonth])
  return new Set(all.slice(-(id === 'q' ? 3 : 12)))
}

// ─── SMALL PARTS ─────────────────────────────────────────────────────────────
function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  if (before === 0 && now === 0) return <span className="fin-delta fin-flat">no activity {label}</span>
  if (before === 0) return <span className="fin-delta fin-up">new {label}</span>
  const change = (now - before) / Math.abs(before)
  const up = change >= 0
  return (
    <span className={`fin-delta ${up ? 'fin-up' : 'fin-down'}`}>
      {up ? '▲' : '▼'} {pct(Math.abs(change), 0)} {label}
    </span>
  )
}

function Stat({
  label, value, sub, color, hint, wide,
}: { label: string; value: string; sub?: React.ReactNode; color?: string; hint?: string; wide?: boolean }) {
  return (
    <div className={`fin-stat${wide ? ' fin-stat-wide' : ''}`} title={hint}>
      <div className="fin-stat-label">{label}{hint && <span className="fin-info">?</span>}</div>
      <div className="fin-stat-value" style={{ color: color ?? '#fafafa' }}>{value}</div>
      {sub && <div className="fin-stat-sub">{sub}</div>}
    </div>
  )
}

/** fees = net + Stripe cost, drawn to scale. The split is the whole story. */
function SplitBar({ e }: { e: Econ }) {
  const gross = Math.max(e.feeCents, 1)
  const netW = Math.max(0, Math.min(100, (e.netCents / gross) * 100))
  return (
    <div className="fin-split">
      <div className="fin-split-track">
        <div className="fin-split-net" style={{ width: `${netW}%` }} />
        <div className="fin-split-cost" style={{ width: `${100 - netW}%` }} />
      </div>
      <div className="fin-split-legend">
        <span><i style={{ background: NET }} /> Kept {usd(e.netCents)}</span>
        <span><i style={{ background: COST }} /> Stripe {usd(e.costCents)}</span>
      </div>
    </div>
  )
}

function Card({ title, right, children, pad = true }: {
  title: string; right?: React.ReactNode; children: React.ReactNode; pad?: boolean
}) {
  return (
    <section className="fin-card">
      <header className="fin-card-hdr">
        <h3 className="fin-card-title">{title}</h3>
        {right}
      </header>
      <div className={pad ? 'fin-card-body' : ''}>{children}</div>
    </section>
  )
}

// ─── CHART: net revenue, Stripe cost, and volume by month ────────────────────
function RevenueChart({ rows }: { rows: MonthRow[] }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<MonthRow | null>(null)

  useEffect(() => {
    if (!svgRef.current || !wrapRef.current || rows.length === 0) return

    const draw = () => {
      const width = wrapRef.current!.clientWidth
      const height = 260
      const m = { top: 16, right: 46, bottom: 26, left: 52 }
      const iw = Math.max(10, width - m.left - m.right)
      const ih = height - m.top - m.bottom

      const svg = d3.select(svgRef.current!)
      svg.selectAll('*').remove()
      svg.attr('width', width).attr('height', height)
      const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`)

      const x = d3.scaleBand<string>().domain(rows.map(r => r.month)).range([0, iw]).padding(0.32)
      const maxGross = d3.max(rows, r => r.feeCents) ?? 0
      const y = d3.scaleLinear().domain([0, Math.max(maxGross * 1.15, 1000)]).range([ih, 0]).nice()
      const maxVol = d3.max(rows, r => r.volumeCents) ?? 0
      const yv = d3.scaleLinear().domain([0, Math.max(maxVol * 1.15, 1000)]).range([ih, 0]).nice()

      // Gridlines first, so nothing important sits under them.
      g.append('g').call(d3.axisLeft(y).ticks(4).tickSize(-iw).tickFormat(() => ''))
        .call(gg => { gg.select('.domain').remove(); gg.selectAll('line').attr('stroke', '#3f3f46').attr('stroke-dasharray', '2,3') })

      // Stacked bar: what we kept, and what Stripe took, together = gross fees.
      const col = g.selectAll('.fin-bar').data(rows).join('g').attr('class', 'fin-bar')
        .attr('transform', r => `translate(${x(r.month)},0)`)
        .style('cursor', 'pointer')
        .on('mouseenter', (_, r) => setHover(r))
        .on('mouseleave', () => setHover(null))

      col.append('rect')
        .attr('y', 0).attr('height', ih).attr('width', x.bandwidth())
        .attr('fill', 'transparent')

      col.append('rect')
        .attr('x', 0).attr('width', x.bandwidth())
        .attr('y', r => y(r.netCents)).attr('height', r => Math.max(0, ih - y(r.netCents)))
        .attr('fill', NET).attr('rx', 2)

      col.append('rect')
        .attr('x', 0).attr('width', x.bandwidth())
        .attr('y', r => y(r.netCents + r.costCents))
        .attr('height', r => Math.max(0, y(r.netCents) - y(r.netCents + r.costCents)))
        .attr('fill', COST).attr('rx', 2)

      // Volume rides its own axis — it dwarfs the fee bars by two orders of
      // magnitude, and the shape of it is the point, not the height.
      const line = d3.line<MonthRow>()
        .x(r => (x(r.month) ?? 0) + x.bandwidth() / 2)
        .y(r => yv(r.volumeCents))
        .curve(d3.curveMonotoneX)
      g.append('path').datum(rows).attr('fill', 'none')
        .attr('stroke', VOLUME).attr('stroke-width', 1.75).attr('stroke-dasharray', '4,3')
        .attr('d', line)
      g.selectAll('.fin-dot').data(rows).join('circle')
        .attr('cx', r => (x(r.month) ?? 0) + x.bandwidth() / 2)
        .attr('cy', r => yv(r.volumeCents))
        .attr('r', 2.5).attr('fill', VOLUME)

      // Axis chrome: dim the labels, and on the value axes drop the rule and
      // ticks entirely — the gridlines already carry the scale.
      type Axis = d3.Selection<SVGGElement, unknown, null, undefined>
      const style = (sel: Axis, { bare = false, tick = '#71717a' } = {}) => {
        sel.select('.domain').attr('stroke', bare ? 'none' : '#3f3f46')
        sel.selectAll('line').attr('stroke', bare ? 'none' : '#3f3f46')
        sel.selectAll('text').attr('fill', tick)
          .style('font-size', '10px').style('font-family', 'DM Sans, sans-serif')
        return sel
      }

      style(g.append('g').attr('transform', `translate(0,${ih})`)
        .call(d3.axisBottom(x).tickFormat(d => monthLabel(d as string))))
      style(g.append('g').call(d3.axisLeft(y).ticks(4).tickFormat(v => compact(+v))), { bare: true })
      style(g.append('g').attr('transform', `translate(${iw},0)`)
        .call(d3.axisRight(yv).ticks(4).tickFormat(v => compact(+v))), { bare: true, tick: VOLUME })
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [rows])

  return (
    <div className="fin-chart">
      <div className="fin-chart-legend">
        <span><i style={{ background: NET }} /> Net kept</span>
        <span><i style={{ background: COST }} /> Stripe cost</span>
        <span><i className="fin-dash" style={{ background: VOLUME }} /> Volume processed (right)</span>
      </div>
      <div ref={wrapRef}><svg ref={svgRef} style={{ display: 'block' }} /></div>
      <div className="fin-chart-foot">
        {hover ? (
          <>
            <strong>{monthLabel(hover.month)}</strong>
            <span>{hover.count} payment{hover.count === 1 ? '' : 's'}</span>
            <span>Volume {usd0(hover.volumeCents)}</span>
            <span>Fees {usd(hover.feeCents)}</span>
            <span style={{ color: COST }}>Stripe −{usd(hover.costCents)}</span>
            <span style={{ color: NET }}>Net {usd(hover.netCents)}</span>
          </>
        ) : (
          <span className="fin-muted">Hover a month for its breakdown. Bar height is gross fees; the green part is what survived Stripe.</span>
        )}
      </div>
    </div>
  )
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function FinancialsTab() {
  const [data, setData] = useState<FinancialsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<PeriodId>('mtd')
  const [q, setQ] = useState('')
  const [methodFilter, setMethodFilter] = useState<'all' | Txn['method']>('all')
  const [kindFilter, setKindFilter] = useState<'all' | 'rent' | 'saas'>('all')
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

  const scope = useMemo(() => {
    if (!data) return null
    const months = periodMonths(period, data)
    const txns = months ? data.transactions.filter(t => months.has(t.month)) : data.transactions
    const rows = months ? data.byMonth.filter(m => months.has(m.month)) : data.byMonth
    return { months, txns, rows, total: sumE(txns) }
  }, [data, period])

  const ledger = useMemo(() => {
    if (!scope) return []
    const needle = q.trim().toLowerCase()
    return scope.txns.filter(t => {
      if (methodFilter !== 'all' && t.method !== methodFilter) return false
      if (kindFilter === 'rent' && t.kind !== 'rent') return false
      if (kindFilter === 'saas' && t.kind === 'rent') return false
      if (!needle) return true
      return [t.payer, t.payerEmail, t.propertyName, t.landlordName, t.intentId, ...t.items]
        .some(v => v && v.toLowerCase().includes(needle))
    })
  }, [scope, q, methodFilter, kindFilter])

  if (error) return <div className="fin-empty">Couldn’t load financials — {error}</div>
  if (!data || !scope) return <div className="fin-empty">Adding up the money…</div>

  const { totals } = data
  const periodLabel = PERIODS.find(p => p.id === period)!.label

  // Month-to-date only compares fairly against the same slice of last month.
  const comparison = period === 'mtd'
    ? { before: totals.prevMtd, label: `vs ${totals.dayOfMonth === 1 ? 'day 1' : `first ${totals.dayOfMonth} days`} of last month` }
    : period === 'last'
      ? { before: null, label: '' }
      : { before: null, label: '' }

  const scoped = scope.total
  const takeRate = scoped.volumeCents > 0 ? scoped.netCents / scoped.volumeCents : 0
  const marginPct = scoped.feeCents > 0 ? scoped.netCents / scoped.feeCents : 0
  const onPlatform = scope.txns.filter(t => t.onPlatform)
  const avgNet = onPlatform.length > 0 ? Math.round(scoped.netCents / onPlatform.length) : 0

  const methodRows = data.byMethod.filter(m => m.count > 0)
  const sourceRows = data.bySource.filter(s => s.count > 0)
  const maxSourceNet = Math.max(...sourceRows.map(s => Math.abs(s.netCents)), 1)

  const exportCsv = () => {
    const head = ['date', 'kind', 'method', 'status', 'payer', 'property', 'landlord', 'volume', 'rent_to_landlord', 'fee', 'stripe_cost', 'net', 'intent']
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [head.join(',')].concat(ledger.map(t => [
      t.date, t.kind, t.method, t.status, t.payer, t.propertyName, t.landlordName,
      (t.volumeCents / 100).toFixed(2), (t.passThroughCents / 100).toFixed(2),
      (t.feeCents / 100).toFixed(2), (t.costCents / 100).toFixed(2), (t.netCents / 100).toFixed(2),
      t.intentId,
    ].map(esc).join(',')))
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `homehive-financials-${period}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <style>{CSS}</style>

      {/* Period scope — everything below answers for this window. */}
      <div className="fin-periods">
        {PERIODS.map(p => (
          <button key={p.id}
            className={`fin-period${period === p.id ? ' active' : ''}`}
            onClick={() => { setPeriod(p.id); setLimit(25) }}
          >{p.label}</button>
        ))}
        <span className="fin-updated">
          Updated {new Date(data.generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </span>
      </div>

      {/* ── The one number, and how it was arrived at ───────────────────── */}
      <div className="fin-hero">
        <div className="fin-hero-main">
          <div className="fin-hero-label">Net revenue — {periodLabel.toLowerCase()}</div>
          <div className="fin-hero-value">{usd(scoped.netCents)}</div>
          <div className="fin-hero-sub">
            {usd(scoped.feeCents)} in fees, less {usd(scoped.costCents)} to Stripe
            {comparison.before && (
              <> · <Delta now={scoped.netCents} before={comparison.before.netCents} label={comparison.label} /></>
            )}
          </div>
          <SplitBar e={scoped} />
        </div>
        <div className="fin-hero-side">
          <Stat label="Volume processed" value={usd0(scoped.volumeCents)}
            sub={`${scope.txns.length} payment${scope.txns.length === 1 ? '' : 's'}`}
            hint="Everything that moved, including the landlord’s rent. Not revenue." />
          <Stat label="Take rate" value={pct(takeRate, 2)} color={VOLUME}
            sub="Net kept per dollar processed"
            hint="Net revenue ÷ volume processed." />
          <Stat label="Fee margin" value={pct(marginPct, 0)} color={marginPct >= 0.6 ? NET : '#fbbf24'}
            sub="Of gross fees, after Stripe"
            hint="Card charges keep ~40% of the surcharge; ACH keeps ~85%." />
          <Stat label="Net per payment" value={usd(avgNet)}
            sub={`${onPlatform.length} through Stripe`} />
        </div>
      </div>

      {data.alerts.length > 0 && (
        <div className="fin-alerts">
          {data.alerts.map((a, i) => (
            <div key={i} className={`fin-alert fin-alert-${a.level}`}>
              <span>{a.level === 'warn' ? '⚠' : 'ⓘ'}</span>{a.text}
            </div>
          ))}
        </div>
      )}

      {/* ── Trend ───────────────────────────────────────────────────────── */}
      <Card title="Revenue, cost and volume by month"
        right={<span className="fin-card-note">Last 12 months · all periods</span>}>
        <RevenueChart rows={data.byMonth} />
      </Card>

      {/* ── Where it comes from, and what each rail costs ───────────────── */}
      <div className="fin-two">
        <Card title="Where revenue comes from" right={<span className="fin-card-note">All time</span>}>
          {sourceRows.length === 0 && <div className="fin-muted">No revenue recorded yet.</div>}
          {sourceRows.map(s => {
            const meta = SOURCE_META[s.source] ?? { label: s.source, color: '#71717a' }
            return (
              <div key={s.source} className="fin-srow">
                <div className="fin-srow-top">
                  <span className="fin-srow-name"><i style={{ background: meta.color }} />{meta.label}</span>
                  <span className="fin-srow-net">{usd(s.netCents)}</span>
                </div>
                <div className="fin-bar-track">
                  <div className="fin-bar-fill" style={{
                    width: `${(Math.abs(s.netCents) / maxSourceNet) * 100}%`, background: meta.color,
                  }} />
                </div>
                <div className="fin-srow-meta">
                  {s.count} charge{s.count === 1 ? '' : 's'} · {usd(s.feeCents)} gross · Stripe −{usd(s.costCents)}
                </div>
              </div>
            )
          })}
        </Card>

        <Card title="Rail economics" right={<span className="fin-card-note">All time · rent only</span>} pad={false}>
          <table className="fin-table">
            <thead>
              <tr><th>Rail</th><th className="r">Volume</th><th className="r">Fees</th><th className="r">Stripe</th><th className="r">Net</th><th className="r">Margin</th></tr>
            </thead>
            <tbody>
              {methodRows.map(m => {
                const meta = METHOD_META[m.method]
                const mg = m.feeCents > 0 ? m.netCents / m.feeCents : 0
                return (
                  <tr key={m.method}>
                    <td><span className="fin-pill" style={{ color: meta.color, borderColor: meta.color + '55', background: meta.color + '18' }}>{meta.label}</span>
                      <span className="fin-sub"> {m.count}</span></td>
                    <td className="r">{usd0(m.volumeCents)}</td>
                    <td className="r">{usd(m.feeCents)}</td>
                    <td className="r" style={{ color: m.costCents > 0 ? COST : '#52525b' }}>{m.costCents > 0 ? `−${usd(m.costCents)}` : '—'}</td>
                    <td className="r" style={{ color: m.netCents > 0 ? NET : '#71717a', fontWeight: 700 }}>{usd(m.netCents)}</td>
                    <td className="r">{m.feeCents > 0 ? pct(mg, 0) : '—'}</td>
                  </tr>
                )
              })}
              {methodRows.length === 0 && <tr><td colSpan={6} className="fin-muted">No rent settled yet.</td></tr>}
            </tbody>
          </table>
          <div className="fin-note">
            Stripe bills on the whole charge, not our slice: card costs {pct(data.rates.stripe.card.pct)} + {usd(data.rates.stripe.card.fixedCents)},
            ACH {pct(data.rates.stripe.ach.pct)} capped at {usd(data.rates.stripe.ach.capCents ?? 0)}.
            We surcharge {pct(data.rates.surcharge.card, 0)} on card and {pct(data.rates.surcharge.ach, 0)} on ACH.
          </div>
        </Card>
      </div>

      {/* ── Forward-looking: in flight, owed, and left on the table ─────── */}
      <div className="fin-three">
        <div className="fin-mini">
          <div className="fin-mini-label">Settling now</div>
          <div className="fin-mini-value" style={{ color: '#fbbf24' }}>{usd0(totals.inFlight.volumeCents)}</div>
          <div className="fin-mini-sub">ACH in flight · {usd(totals.inFlight.netCents)} net once it clears. A debit can still bounce.</div>
        </div>
        <div className="fin-mini">
          <div className="fin-mini-label">Rent still owed</div>
          <div className="fin-mini-value">{usd0(totals.outstandingCents)}</div>
          <div className="fin-mini-sub">
            {totals.overdueCents > 0
              ? <>Including <strong style={{ color: COST }}>{usd0(totals.overdueCents)}</strong> already late or missed.</>
              : 'Nothing late — every open charge is still within its due date.'}
          </div>
        </div>
        <div className="fin-mini fin-mini-accent">
          <div className="fin-mini-label">Collected off-platform</div>
          <div className="fin-mini-value">{usd0(totals.offPlatform.volumeCents)}</div>
          <div className="fin-mini-sub">
            Zelle and hand-recorded rent — earns nothing today.
            Moved onto ACH at {pct(data.rates.surcharge.ach, 0)} it would have netted{' '}
            <strong style={{ color: NET }}>{usd0(totals.achOpportunityCents)}</strong>.
          </div>
        </div>
      </div>

      {/* ── Who produces it ─────────────────────────────────────────────── */}
      <Card title="Top landlords by net revenue" right={<span className="fin-card-note">All time</span>} pad={false}>
        <table className="fin-table">
          <thead>
            <tr><th>Landlord</th><th className="r">Payments</th><th className="r">Volume</th><th className="r">Fees</th><th className="r">Stripe</th><th className="r">Net</th></tr>
          </thead>
          <tbody>
            {data.topLandlords.map(l => (
              <tr key={l.id}>
                <td className="fin-strong">{l.name}</td>
                <td className="r">{l.count}</td>
                <td className="r">{usd0(l.volumeCents)}</td>
                <td className="r">{usd(l.feeCents)}</td>
                <td className="r" style={{ color: l.costCents > 0 ? COST : '#52525b' }}>{l.costCents > 0 ? `−${usd(l.costCents)}` : '—'}</td>
                <td className="r" style={{ color: l.netCents > 0 ? NET : '#71717a', fontWeight: 700 }}>{usd(l.netCents)}</td>
              </tr>
            ))}
            {data.topLandlords.length === 0 && <tr><td colSpan={6} className="fin-muted">No payments recorded yet.</td></tr>}
          </tbody>
        </table>
      </Card>

      {/* ── Every payment ───────────────────────────────────────────────── */}
      <Card
        title={`Payments — ${periodLabel.toLowerCase()}`}
        right={
          <div className="fin-toolbar">
            <input className="fin-search" placeholder="Tenant, property, landlord, intent…"
              value={q} onChange={e => setQ(e.target.value)} />
            <select className="fin-select" value={kindFilter} onChange={e => setKindFilter(e.target.value as typeof kindFilter)}>
              <option value="all">All revenue</option>
              <option value="rent">Rent only</option>
              <option value="saas">Plans &amp; unlocks</option>
            </select>
            <select className="fin-select" value={methodFilter} onChange={e => setMethodFilter(e.target.value as typeof methodFilter)}>
              <option value="all">All rails</option>
              <option value="card">Card</option>
              <option value="ach">ACH</option>
              <option value="manual_zelle">Zelle</option>
              <option value="manual_other">Manual</option>
            </select>
            <button className="fin-btn" onClick={exportCsv} disabled={ledger.length === 0}>Export CSV</button>
          </div>
        }
        pad={false}
      >
        <table className="fin-table fin-ledger">
          <thead>
            <tr>
              <th>Date</th><th>Payer</th><th>For</th><th>Rail</th>
              <th className="r">Charged</th><th className="r">To landlord</th>
              <th className="r">Our fee</th><th className="r">Stripe</th><th className="r">Net</th>
            </tr>
          </thead>
          <tbody>
            {ledger.slice(0, limit).map(t => (
              <tr key={t.id}>
                <td>
                  <div className="fin-strong">{dayLabel(t.date)}</div>
                  {t.status === 'processing' && <span className="fin-pill fin-pill-warn">settling</span>}
                </td>
                <td>
                  <div className="fin-strong">{t.payer ?? '—'}</div>
                  <div className="fin-sub">{t.propertyName ?? (t.kind === 'rent' ? '—' : 'HomeHive plan')}</div>
                </td>
                <td className="fin-sub">
                  {t.items.slice(0, 2).join(', ')}{t.items.length > 2 ? ` +${t.items.length - 2}` : ''}
                </td>
                <td>
                  <span className="fin-pill" style={{
                    color: METHOD_META[t.method].color,
                    borderColor: METHOD_META[t.method].color + '55',
                    background: METHOD_META[t.method].color + '18',
                  }}>{METHOD_META[t.method].label}</span>
                  {t.intentId && (
                    <a className="fin-link" target="_blank" rel="noreferrer"
                      href={`https://dashboard.stripe.com/payments/${t.intentId}`}>Stripe ↗</a>
                  )}
                </td>
                <td className="r">{usd(t.volumeCents)}</td>
                <td className="r fin-sub">{t.passThroughCents > 0 ? usd(t.passThroughCents) : '—'}</td>
                <td className="r">{t.feeCents > 0 ? usd(t.feeCents) : <span className="fin-muted">none</span>}</td>
                <td className="r" style={{ color: t.costCents > 0 ? COST : '#52525b' }}>{t.costCents > 0 ? `−${usd(t.costCents)}` : '—'}</td>
                <td className="r" style={{ color: t.netCents > 0 ? NET : '#71717a', fontWeight: 700 }}>{usd(t.netCents)}</td>
              </tr>
            ))}
            {ledger.length === 0 && (
              <tr><td colSpan={9} className="fin-muted">No payments match this filter in {periodLabel.toLowerCase()}.</td></tr>
            )}
          </tbody>
        </table>
        {ledger.length > limit && (
          <button className="fin-more" onClick={() => setLimit(l => l + 50)}>
            Show more — {ledger.length - limit} older payment{ledger.length - limit === 1 ? '' : 's'}
          </button>
        )}
      </Card>

      <p className="fin-footnote">
        Stripe costs are estimated from published US pricing and are accurate to the cent for standard charges;
        reconcile against the Stripe payout statement before closing the books. Rent shown as “to landlord” is
        pass-through and never counted as revenue.
      </p>
    </>
  )
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const CSS = `
  .fin-periods { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 18px; }
  .fin-period { padding: 6px 14px; border-radius: 20px; border: 1.5px solid #3f3f46; background: #27272a;
    font-size: 12px; font-weight: 500; color: #a1a1aa; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all .15s; }
  .fin-period:hover { color: #fafafa; border-color: #52525b; }
  .fin-period.active { background: rgba(52,211,153,.14); color: #6ee7b7; border-color: rgba(52,211,153,.45); font-weight: 600; }
  .fin-updated { margin-left: auto; font-size: 11px; color: #52525b; }

  .fin-hero { display: grid; grid-template-columns: minmax(280px, 1.1fr) 2fr; gap: 14px; margin-bottom: 16px; }
  .fin-hero-main { background: linear-gradient(140deg, #1f2b26 0%, #27272a 60%); border: 1px solid #3f3f46;
    border-radius: 14px; padding: 22px 24px; }
  .fin-hero-label { font-size: 11px; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: .7px; }
  .fin-hero-value { font-size: 44px; font-weight: 800; color: #6ee7b7; letter-spacing: -1.5px; line-height: 1.1; margin: 6px 0 4px; }
  .fin-hero-sub { font-size: 12px; color: #a1a1aa; margin-bottom: 16px; }
  .fin-hero-side { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }

  .fin-stat { background: #27272a; border: 1px solid #3f3f46; border-radius: 12px; padding: 14px 16px; }
  .fin-stat-label { font-size: 10px; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: .6px; margin-bottom: 6px; }
  .fin-stat-value { font-size: 22px; font-weight: 800; letter-spacing: -.5px; line-height: 1.15; }
  .fin-stat-sub { font-size: 11px; color: #71717a; margin-top: 4px; }
  .fin-info { display: inline-flex; align-items: center; justify-content: center; width: 12px; height: 12px; margin-left: 5px;
    border-radius: 50%; border: 1px solid #52525b; color: #52525b; font-size: 8px; cursor: help; }

  .fin-delta { font-weight: 600; }
  .fin-up { color: #34d399; } .fin-down { color: #fb7185; } .fin-flat { color: #71717a; }

  .fin-split { margin-top: 4px; }
  .fin-split-track { display: flex; height: 8px; border-radius: 5px; overflow: hidden; background: #3f3f46; }
  .fin-split-net { background: ${NET}; } .fin-split-cost { background: ${COST}; }
  .fin-split-legend { display: flex; gap: 16px; margin-top: 8px; font-size: 11px; color: #a1a1aa; }
  .fin-split-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 6px; }

  .fin-alerts { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
  .fin-alert { display: flex; gap: 8px; align-items: flex-start; padding: 10px 14px; border-radius: 10px;
    font-size: 12px; border: 1px solid; }
  .fin-alert-warn { background: rgba(251,113,133,.1); border-color: rgba(251,113,133,.32); color: #fda4af; }
  .fin-alert-info { background: rgba(129,140,248,.1); border-color: rgba(129,140,248,.3); color: #a5b4fc; }

  .fin-card { background: #27272a; border: 1px solid #3f3f46; border-radius: 14px; overflow: hidden; margin-bottom: 16px; }
  .fin-card-hdr { display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 12px 18px; border-bottom: 1px solid #3f3f46; flex-wrap: wrap; }
  .fin-card-title { font-size: 11px; font-weight: 700; color: #a1a1aa; text-transform: uppercase; letter-spacing: .7px; }
  .fin-card-note { font-size: 10px; color: #52525b; text-transform: uppercase; letter-spacing: .5px; }
  .fin-card-body { padding: 16px 18px; }

  .fin-two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
  .fin-three { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 16px; }

  .fin-mini { background: #27272a; border: 1px solid #3f3f46; border-radius: 14px; padding: 16px 18px; }
  .fin-mini-accent { border-color: rgba(52,211,153,.3); background: linear-gradient(150deg, #1f2b26, #27272a 70%); }
  .fin-mini-label { font-size: 10px; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: .6px; }
  .fin-mini-value { font-size: 26px; font-weight: 800; color: #fafafa; letter-spacing: -.6px; margin: 5px 0 6px; }
  .fin-mini-sub { font-size: 11.5px; color: #a1a1aa; line-height: 1.5; }

  .fin-srow { margin-bottom: 14px; }
  .fin-srow:last-child { margin-bottom: 0; }
  .fin-srow-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
  .fin-srow-name { font-size: 12.5px; color: #d4d4d8; display: flex; align-items: center; gap: 7px; }
  .fin-srow-name i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
  .fin-srow-net { font-size: 13px; font-weight: 700; color: #fafafa; }
  .fin-srow-meta { font-size: 10.5px; color: #71717a; margin-top: 4px; }
  .fin-bar-track { height: 6px; background: #3f3f46; border-radius: 3px; overflow: hidden; }
  .fin-bar-fill { height: 100%; border-radius: 3px; transition: width .4s; }

  .fin-chart-legend { display: flex; gap: 16px; font-size: 11px; color: #a1a1aa; margin-bottom: 4px; flex-wrap: wrap; }
  .fin-chart-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 6px; }
  .fin-chart-legend .fin-dash { height: 2px; width: 14px; border-radius: 1px; }
  .fin-chart-foot { display: flex; gap: 14px; flex-wrap: wrap; font-size: 11.5px; color: #d4d4d8;
    border-top: 1px solid #3f3f46; margin-top: 8px; padding-top: 10px; min-height: 34px; align-items: center; }

  .fin-table { width: 100%; border-collapse: collapse; }
  .fin-table thead th { background: #1f1f22; padding: 8px 14px; text-align: left; font-size: 10px; font-weight: 700;
    color: #71717a; text-transform: uppercase; letter-spacing: .6px; border-bottom: 1px solid #3f3f46; white-space: nowrap; }
  .fin-table td { padding: 10px 14px; font-size: 12.5px; color: #d4d4d8; border-bottom: 1px solid #3f3f46; vertical-align: top; }
  .fin-table tbody tr:last-child td { border-bottom: none; }
  .fin-table tbody tr:hover { background: rgba(250,250,250,.03); }
  .fin-table .r { text-align: right; white-space: nowrap; }
  .fin-strong { color: #fafafa; font-weight: 600; }
  .fin-sub { font-size: 11px; color: #71717a; }
  .fin-muted { color: #52525b; font-size: 11.5px; }
  .fin-note { padding: 10px 14px; font-size: 11px; color: #71717a; border-top: 1px solid #3f3f46; line-height: 1.6; }
  .fin-footnote { font-size: 11px; color: #52525b; line-height: 1.6; margin: 4px 0 8px; max-width: 760px; }

  .fin-pill { display: inline-flex; padding: 1px 8px; border-radius: 20px; font-size: 10.5px; font-weight: 600; border: 1px solid; }
  .fin-pill-warn { color: #fbbf24; border-color: rgba(251,191,36,.4); background: rgba(251,191,36,.12); margin-top: 4px; }
  .fin-link { font-size: 10.5px; color: #818cf8; text-decoration: none; margin-left: 8px; white-space: nowrap; }
  .fin-link:hover { text-decoration: underline; }

  .fin-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .fin-search { padding: 6px 11px; border: 1.5px solid #3f3f46; border-radius: 8px; font-size: 12px; width: 220px;
    background: #1f1f22; color: #fafafa; outline: none; font-family: 'DM Sans', sans-serif; }
  .fin-search:focus { border-color: #34d399; }
  .fin-select { padding: 6px 8px; border: 1.5px solid #3f3f46; border-radius: 8px; font-size: 12px;
    background: #1f1f22; color: #d4d4d8; outline: none; font-family: 'DM Sans', sans-serif; cursor: pointer; }
  .fin-btn { padding: 6px 12px; border: 1.5px solid #3f3f46; border-radius: 8px; font-size: 12px; font-weight: 600;
    background: #1f1f22; color: #d4d4d8; cursor: pointer; font-family: 'DM Sans', sans-serif; }
  .fin-btn:hover:not(:disabled) { border-color: #34d399; color: #6ee7b7; }
  .fin-btn:disabled { opacity: .4; cursor: not-allowed; }
  .fin-more { width: 100%; padding: 11px; background: #1f1f22; border: none; border-top: 1px solid #3f3f46;
    color: #a1a1aa; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
  .fin-more:hover { color: #fafafa; }

  .fin-empty { padding: 48px 20px; text-align: center; color: #71717a; font-size: 13px; }

  @media (max-width: 1000px) {
    .fin-hero { grid-template-columns: 1fr; }
    .fin-two, .fin-three { grid-template-columns: 1fr; }
  }
  @media (max-width: 640px) {
    .fin-hero-value { font-size: 34px; }
    .fin-card-hdr { align-items: flex-start; flex-direction: column; }
    .fin-search { width: 100%; }
    .fin-ledger { display: block; overflow-x: auto; white-space: nowrap; }
  }
`
