'use client'

/**
 * The portfolio charts.
 *
 * They were defined inside the overview's own file and drawn four bands deep
 * into it, which is where they were wrong: none of them answers a question a
 * landlord has on arrival. A 90-day lead trend is something you go and look
 * at, so they now live on `/landlord/dashboard/analytics`, and the overview
 * links to them instead of carrying them.
 *
 * Dependency-free SVG/HTML on purpose, and they borrow `.panel` from
 * `styles.tsx` so they match everything else on the screen.
 */

import { useState } from 'react'
import { Property } from '@/lib/properties'
import { Lead } from '@/lib/leads'
import { fmtCurrency } from './overview'

// ─── Portfolio charts (dependency-free SVG/HTML; reuse the .panel styling) ──────
const DONUT_STATUS: Record<string, { label: string; color: string }> = {
  new:            { label: 'New',            color: '#1d4ed8' },
  contacted:      { label: 'Contacted',      color: '#0891b2' },
  follow_up:      { label: 'Follow-up',      color: '#c2410c' },
  engaged:        { label: 'Engaged',        color: '#d97706' },
  qualified:      { label: 'Qualified',      color: '#16a34a' },
  tour_scheduled: { label: 'Qualified',      color: '#16a34a' },
  matching:       { label: 'Roommate match', color: '#7c3aed' },
  cold:           { label: 'Cold',           color: '#94a3b8' },
  closed:         { label: 'Closed',         color: '#6b7280' },
}

export function LeadsTrendPanel({ dates }: { dates: (string | null | undefined)[] }) {
  const [range, setRange] = useState<30 | 90>(30)
  const buckets = (() => {
    const out: { label: string; full: string; count: number }[] = []
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const countIn = (from: Date, to: Date) => dates.filter(d => {
      if (!d) return false
      const t = new Date(d).getTime()
      return t >= from.getTime() && t < to.getTime()
    }).length
    if (range === 30) {
      for (let i = 29; i >= 0; i--) {
        const day = new Date(start); day.setDate(day.getDate() - i)
        const next = new Date(day); next.setDate(next.getDate() + 1)
        out.push({ label: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), full: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), count: countIn(day, next) })
      }
    } else {
      for (let i = 12; i >= 0; i--) {
        const ws = new Date(start); ws.setDate(ws.getDate() - i * 7 - 6)
        const we = new Date(start); we.setDate(we.getDate() - i * 7 + 1)
        out.push({ label: ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), full: `Week of ${ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, count: countIn(ws, we) })
      }
    }
    return out
  })()
  const n = buckets.length
  const total = buckets.reduce((s, b) => s + b.count, 0)
  const maxCount = Math.max(1, ...buckets.map(b => b.count))
  const niceMax = maxCount <= 4 ? maxCount : Math.ceil(maxCount / 5) * 5
  const W = 720, H = 190, padL = 26, padR = 12, padT = 12, padB = 22
  const innerW = W - padL - padR, innerH = H - padT - padB
  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v: number) => padT + innerH - (v / niceMax) * innerH
  const line = buckets.map((b, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(b.count).toFixed(1)}`).join(' ')
  const area = `${line} L ${x(n - 1).toFixed(1)} ${y(0).toFixed(1)} L ${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`
  const labelEvery = range === 30 ? 5 : 2

  return (
    <div className="panel">
      <div className="panel-hd">
        <span className="panel-title">Leads over time</span>
        <div style={{ display: 'inline-flex', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
          {([30, 90] as const).map(r => (
            <button key={r} onClick={() => setRange(r)} style={{ padding: '5px 11px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", background: range === r ? '#8C1D40' : '#fff', color: range === r ? '#fff' : '#64748b' }}>{r}d</button>
          ))}
        </div>
      </div>
      <div className="panel-body">
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 8 }}>
          <strong style={{ color: '#0f172a', fontSize: 15 }}>{total}</strong> new lead{total !== 1 ? 's' : ''} in the last {range} days
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
          <defs>
            <linearGradient id="dbLeadArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8C1D40" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#8C1D40" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, niceMax / 2, niceMax].map((v, i) => (
            <g key={i}>
              <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#f1f5f9" strokeWidth="1" />
              <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#cbd5e1">{Math.round(v)}</text>
            </g>
          ))}
          <path d={area} fill="url(#dbLeadArea)" />
          <path d={line} fill="none" stroke="#8C1D40" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {buckets.map((b, i) => (
            <g key={i}>
              <circle cx={x(i)} cy={y(b.count)} r={b.count > 0 ? 2.5 : 0} fill="#8C1D40" />
              <rect x={x(i) - innerW / n / 2} y={padT} width={innerW / n} height={innerH} fill="transparent"><title>{`${b.full}: ${b.count} lead${b.count !== 1 ? 's' : ''}`}</title></rect>
              {i % labelEvery === 0 && <text x={x(i)} y={H - 7} textAnchor="middle" fontSize="9" fill="#94a3b8">{b.label}</text>}
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}

export function LeadStatusDonut({ leads }: { leads: Lead[] }) {
  const agg: Record<string, { label: string; color: string; count: number }> = {}
  for (const l of leads) {
    const meta = DONUT_STATUS[l.status] || { label: l.status, color: '#cbd5e1' }
    if (agg[meta.label]) agg[meta.label].count++
    else agg[meta.label] = { label: meta.label, color: meta.color, count: 1 }
  }
  const segs = Object.values(agg).sort((a, b) => b.count - a.count)
  const total = segs.reduce((s, x) => s + x.count, 0)
  const r = 52, sw = 22, C = 2 * Math.PI * r
  let acc = 0

  return (
    <div className="panel">
      <div className="panel-hd"><span className="panel-title">Lead status mix</span></div>
      <div className="panel-body">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <svg viewBox="0 0 140 140" style={{ width: 120, height: 120, flexShrink: 0 }}>
            <g transform="rotate(-90 70 70)">
              {total === 0 ? (
                <circle cx="70" cy="70" r={r} fill="none" stroke="#f1f5f9" strokeWidth={sw} />
              ) : segs.map((x, i) => {
                const dash = (x.count / total) * C
                const seg = <circle key={i} cx="70" cy="70" r={r} fill="none" stroke={x.color} strokeWidth={sw} strokeDasharray={`${dash.toFixed(2)} ${(C - dash).toFixed(2)}`} strokeDashoffset={(-acc).toFixed(2)} />
                acc += dash
                return seg
              })}
            </g>
            <text x="70" y="67" textAnchor="middle" fontSize="25" fontWeight="700" fill="#0f172a">{total}</text>
            <text x="70" y="85" textAnchor="middle" fontSize="10" fill="#94a3b8">leads</text>
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 110 }}>
            {segs.length === 0 ? <span style={{ fontSize: 12, color: '#94a3b8' }}>No leads yet</span> :
              segs.map((x, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: x.color, flexShrink: 0 }} />
                  <span style={{ color: '#475569', flex: 1 }}>{x.label}</span>
                  <span style={{ color: '#0f172a', fontWeight: 700 }}>{x.count}</span>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function OccupancyByProperty({ properties }: { properties: Property[] }) {
  const rows = properties
    .filter(p => (p.total_rooms || 0) > 0)
    .map(p => {
      const total = p.total_rooms || 0, vacant = p.available || 0, occ = total - vacant
      return { name: p.name, total, occ, vacant, pct: total > 0 ? Math.round((occ / total) * 100) : 0 }
    })
    .sort((a, b) => b.total - a.total)

  return (
    <div className="panel">
      <div className="panel-hd"><span className="panel-title">Occupancy by property</span></div>
      <div className="panel-body">
        {rows.length === 0 ? (
          <div style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', padding: '12px 0' }}>No rooms configured yet</div>
        ) : rows.map(r => (
          <div key={r.name} style={{ marginBottom: 11 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
              <span style={{ color: '#475569', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              <span style={{ color: '#94a3b8', flexShrink: 0, marginLeft: 8 }}>{r.occ}/{r.total} filled · {r.pct}%</span>
            </div>
            <div style={{ height: 14, background: '#e2e8f0', borderRadius: 5, overflow: 'hidden' }}>
              <div style={{ width: `${r.pct}%`, height: '100%', background: r.pct >= 80 ? '#16a34a' : r.pct >= 50 ? '#d97706' : '#dc2626', borderRadius: 5 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CollectionsBars({ payments }: { payments: { due_date: string; amount: number; paid_amount: number }[] }) {
  const now = new Date()
  const months: { label: string; due: number; paid: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const y = d.getFullYear(), m = d.getMonth()
    const inMonth = payments.filter(p => {
      const pd = new Date(p.due_date + 'T00:00:00')
      return pd.getFullYear() === y && pd.getMonth() === m
    })
    months.push({ label: d.toLocaleDateString('en-US', { month: 'short' }), due: inMonth.reduce((s, p) => s + p.amount, 0), paid: inMonth.reduce((s, p) => s + p.paid_amount, 0) })
  }
  const max = Math.max(1, ...months.map(mo => mo.due))
  const fmt = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `$${n}`
  const totalPaid = months.reduce((s, mo) => s + mo.paid, 0)

  return (
    <div className="panel">
      <div className="panel-hd"><span className="panel-title">Collections — last 6 months</span></div>
      <div className="panel-body">
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
          <strong style={{ color: '#0f172a', fontSize: 15 }}>{fmt(totalPaid)}</strong> collected
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 130 }}>
          {months.map(mo => {
            const h = (mo.due / max) * 100
            const paidH = mo.due > 0 ? (mo.paid / mo.due) * 100 : 0
            return (
              <div key={mo.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{ width: '100%', height: 104, display: 'flex', alignItems: 'flex-end' }}>
                  <div title={`${mo.label}: ${fmt(mo.paid)} paid / ${fmt(mo.due)} due`} style={{ width: '100%', height: `${Math.max(h, mo.due > 0 ? 6 : 0)}%`, minHeight: mo.due > 0 ? 4 : 0, background: '#e2e8f0', borderRadius: '5px 5px 0 0', overflow: 'hidden', display: 'flex', alignItems: 'flex-end' }}>
                    <div style={{ width: '100%', height: `${paidH}%`, background: '#8C1D40' }} />
                  </div>
                </div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>{mo.label}</div>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 12, fontSize: 11, color: '#94a3b8' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: '#8C1D40' }} /> Collected</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: '#e2e8f0' }} /> Billed</span>
        </div>
      </div>
    </div>
  )
}

