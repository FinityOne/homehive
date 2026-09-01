'use client'

import { useEffect, useState } from 'react'
import { getCurrentUser } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { getPropertiesByOwner, Property } from '@/lib/properties'
import { getLeadsForOwner, Lead } from '@/lib/leads'
import { getLeasesForOwner, getLeaseStatus, formatLeaseDate, Lease } from '@/lib/leases'
import { getPlansForOwner, PaymentPlan } from '@/lib/payments'

function getGreeting(name: string) {
  const h = new Date().getHours()
  if (h < 12) return `Good morning, ${name}`
  if (h < 17) return `Good afternoon, ${name}`
  return `Good evening, ${name}`
}

const fmtCurrency = (n: number) =>
  n >= 1000
    ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`
    : `$${n.toLocaleString()}`

const fmtFull = (n: number) => `$${n.toLocaleString()}`

function daysUntil(dateStr: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr + 'T00:00:00')
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

const LEAD_STAGES = ['new', 'contacted', 'engaged', 'qualified', 'tour_scheduled'] as const
const STAGE_LABEL: Record<string, string> = {
  new: 'New', contacted: 'Contacted', engaged: 'Engaged',
  qualified: 'Qualified', tour_scheduled: 'Tour Sched.',
}
const STAGE_COLOR: Record<string, { color: string; bg: string; border: string }> = {
  new:            { color: '#1d4ed8', bg: '#eff6ff',  border: '#bfdbfe' },
  contacted:      { color: '#0891b2', bg: '#ecfeff',  border: '#a5f3fc' },
  engaged:        { color: '#d97706', bg: '#fffbeb',  border: '#fde68a' },
  qualified:      { color: '#16a34a', bg: '#f0fdf4',  border: '#bbf7d0' },
  tour_scheduled: { color: '#7c3aed', bg: '#f5f3ff',  border: '#ddd6fe' },
  closed:         { color: '#6b7280', bg: '#f9fafb',  border: '#e5e7eb' },
}

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

function LeadsTrendPanel({ dates }: { dates: (string | null | undefined)[] }) {
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

function LeadStatusDonut({ leads }: { leads: Lead[] }) {
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

function OccupancyByProperty({ properties }: { properties: Property[] }) {
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

function CollectionsBars({ payments }: { payments: { due_date: string; amount: number; paid_amount: number }[] }) {
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

export default function LandlordDashboard() {
  const router = useRouter()
  const [userName, setUserName] = useState('')
  const [properties, setProperties] = useState<Property[]>([])
  const [leads, setLeads]           = useState<Lead[]>([])
  const [leases, setLeases]         = useState<Lease[]>([])
  const [plans, setPlans]           = useState<PaymentPlan[]>([])
  const [dashProperty, setDashProperty] = useState('all')
  const [loading, setLoading]       = useState(true)

  useEffect(() => { document.title = 'Dashboard — Landlord | HomeHive' }, [])

  useEffect(() => {
    async function load() {
      const user = await getCurrentUser()
      if (!user) { router.push('/login'); return }
      setUserName(user.user_metadata?.full_name?.split(' ')[0] || 'there')
      const [props, lds, lss, pls] = await Promise.all([
        getPropertiesByOwner(user.id),
        getLeadsForOwner(user.id),
        getLeasesForOwner(user.id),
        getPlansForOwner(user.id),
      ])
      setProperties(props)
      setLeads(lds)
      setLeases(lss)
      setPlans(pls)
      setLoading(false)
    }
    load()
  }, [router])

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#94a3b8' }}>
        Loading...
      </div>
    )
  }

  // ─── Lease metrics ──────────────────────────────────────────────────────────
  const currentLeases  = leases.filter(l => getLeaseStatus(l.start_date, l.end_date) === 'current')
  const upcomingLeases = leases.filter(l => getLeaseStatus(l.start_date, l.end_date) === 'upcoming')
  const monthlyRevenue = currentLeases.reduce((s, l) => s + (l.rent_amount || 0), 0)
  const annualRevenue  = monthlyRevenue * 12

  // Expiring within 60 days
  const expiringSoon = currentLeases
    .map(l => ({ lease: l, days: daysUntil(l.end_date) }))
    .filter(x => x.days >= 0 && x.days <= 60)
    .sort((a, b) => a.days - b.days)

  // ─── Property metrics ────────────────────────────────────────────────────────
  const totalRooms   = properties.reduce((s, p) => s + (p.total_rooms || 0), 0)
  const vacantRooms  = properties.reduce((s, p) => s + (p.available || 0), 0)
  const occupiedRooms = totalRooms - vacantRooms
  const occupancyPct = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0
  // "Live" means approved by HomeHive *and* switched on by the landlord —
  // a listing marked Rented or Inactive isn't out there working for them.
  const liveProps    = properties.filter(p => p.admin_status === 'active' && (p.listing_status ?? 'active') === 'active').length
  const pendingProps = properties.filter(p => p.admin_status === 'pending')

  // ─── Payment metrics ─────────────────────────────────────────────────────────
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const thisMonth = { y: today.getFullYear(), m: today.getMonth() }

  const allSPs = plans.flatMap(p => p.scheduled_payments || [])

  // ─── Property-scoped views for the analytics section (top stats stay portfolio-wide) ──
  const scopedLeads      = dashProperty === 'all' ? leads : leads.filter(l => l.property === dashProperty)
  const scopedPlans      = dashProperty === 'all' ? plans : plans.filter(p => p.property?.slug === dashProperty)
  const scopedSPs        = scopedPlans.flatMap(p => p.scheduled_payments || [])
  const scopedProperties = dashProperty === 'all' ? properties : properties.filter(p => p.slug === dashProperty)

  const thisMonthSPs = allSPs.filter(sp => {
    const d = new Date(sp.due_date + 'T00:00:00')
    return d.getFullYear() === thisMonth.y && d.getMonth() === thisMonth.m
  })

  const monthDue     = thisMonthSPs.reduce((s, sp) => s + sp.amount, 0)
  const monthPaid    = thisMonthSPs.reduce((s, sp) => s + sp.paid_amount, 0)
  const monthPending = monthDue - monthPaid

  const overdueSPs = allSPs.filter(sp => {
    const d = new Date(sp.due_date + 'T00:00:00')
    return d < today && ['missed', 'late', 'partial', 'pending'].includes(sp.status) && sp.paid_amount < sp.amount
  })
  const overdueTotal = overdueSPs.reduce((s, sp) => s + (sp.amount - sp.paid_amount), 0)

  // Collection rate this month
  const collectionRate = monthDue > 0 ? Math.round((monthPaid / monthDue) * 100) : null

  // Overdue grouped by plan/property for the mini list
  type OverdueSummary = { planId: string; propertyName: string; owed: number; count: number }
  const overdueByPlan = new Map<string, OverdueSummary>()
  for (const sp of overdueSPs) {
    const plan = plans.find(p => p.id === sp.plan_id)
    if (!plan) continue
    const key = sp.plan_id
    const existing = overdueByPlan.get(key)
    const owed = sp.amount - sp.paid_amount
    if (existing) {
      existing.owed += owed
      existing.count++
    } else {
      overdueByPlan.set(key, {
        planId: plan.id,
        propertyName: plan.property?.name || 'Unknown',
        owed,
        count: 1,
      })
    }
  }
  const overdueList = Array.from(overdueByPlan.values()).sort((a, b) => b.owed - a.owed)

  // ─── Lead pipeline ───────────────────────────────────────────────────────────
  const activeLeads   = leads.filter(l => l.status !== 'closed')
  const stageCounts   = LEAD_STAGES.map(s => ({ stage: s, count: leads.filter(l => l.status === s).length }))
  const totalActive   = activeLeads.length
  const qualifiedCount = leads.filter(l => l.status === 'qualified' || l.status === 'tour_scheduled').length
  const recentLeads   = leads.slice(0, 6)

  // Property name map
  const propNameBySlug = Object.fromEntries(properties.map(p => [p.slug, p.name]))

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,300;1,9..144,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .db { max-width: 960px; margin: 0 auto; padding: 32px 20px 80px; font-family: 'DM Sans', sans-serif; }

        .db-greeting { font-family: 'Fraunces', serif; font-size: 28px; font-weight: 300; color: #0f172a; letter-spacing: -0.5px; line-height: 1.2; }
        .db-sub      { font-size: 13px; color: #94a3b8; margin-top: 4px; margin-bottom: 28px; }

        .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 32px; }
        .stat-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 18px; }
        .stat-label { font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.7px; margin-bottom: 8px; }
        .stat-num   { font-family: 'Fraunces', serif; font-size: 28px; font-weight: 300; color: #0f172a; letter-spacing: -1px; line-height: 1; }
        .stat-sub   { font-size: 11px; color: #94a3b8; margin-top: 5px; }

        .db-section-title { font-family: 'Fraunces', serif; font-size: 18px; font-weight: 300; color: #0f172a; letter-spacing: -0.3px; margin: 4px 0 14px; }
        .db-analytics-hd { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 4px 0 14px; }
        .db-prop-toggle { display: flex; gap: 7px; overflow-x: auto; padding-bottom: 2px; max-width: 100%; }
        .db-prop-pill { white-space: nowrap; flex-shrink: 0; padding: 6px 13px; border-radius: 100px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; border: 1px solid #e2e8f0; background: #fff; color: #475569; transition: background 0.15s, color 0.15s, border-color 0.15s; }
        .db-prop-pill:hover { border-color: #8C1D40; color: #8C1D40; }
        .db-prop-pill.is-active { background: #8C1D40; border-color: #8C1D40; color: #fff; }
        .db-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
        .db-row-full { margin-bottom: 24px; }

        .panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; }
        .panel-hd { padding: 14px 18px 12px; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between; }
        .panel-title { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.7px; }
        .panel-link  { font-size: 12px; color: #8C1D40; font-weight: 500; text-decoration: none; }
        .panel-link:hover { text-decoration: underline; }
        .panel-body  { padding: 14px 18px; }

        .row-item { display: flex; align-items: center; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid #f8fafc; gap: 8px; }
        .row-item:last-child { border-bottom: none; padding-bottom: 0; }
        .row-item-first { padding-top: 0; }

        .pill { display: inline-flex; align-items: center; border-radius: 20px; padding: 2px 9px; font-size: 11px; font-weight: 600; border: 1px solid; white-space: nowrap; }

        .funnel { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
        .funnel-seg { flex: 1; min-width: 60px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 8px; text-align: center; }
        .funnel-n  { font-family: 'Fraunces', serif; font-size: 20px; font-weight: 300; color: #0f172a; line-height: 1; }
        .funnel-lbl { font-size: 10px; color: #94a3b8; margin-top: 3px; font-weight: 600; letter-spacing: 0.3px; text-transform: uppercase; }

        .prog-bar { height: 6px; background: #f1f5f9; border-radius: 99px; overflow: hidden; margin-top: 4px; }
        .prog-fill { height: 100%; border-radius: 99px; transition: width 0.4s; }

        .badge-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

        .pending-banner { background: linear-gradient(135deg,#fffbeb,#fefce8); border: 1.5px solid #fde68a; border-left: 4px solid #f59e0b; border-radius: 14px; padding: 18px 20px; margin-bottom: 24px; }

        @media (max-width: 620px) {
          .stat-grid { grid-template-columns: repeat(2, 1fr); }
          .db-row    { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="db">

        {/* Header */}
        <div className="db-greeting">{getGreeting(userName)}.</div>
        <div className="db-sub">
          {properties.length === 0
            ? 'Get started by listing your first property'
            : `${liveProps} live propert${liveProps !== 1 ? 'ies' : 'y'} · ${occupancyPct}% occupied · ${fmtFull(monthlyRevenue)}/mo revenue`
          }
        </div>

        {/* Pending review banner */}
        {pendingProps.length > 0 && (
          <div className="pending-banner">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#92400e', marginBottom: 3 }}>
                  {pendingProps.length === 1 ? 'Your listing is under review' : `${pendingProps.length} listings are under review`}
                </div>
                <div style={{ fontSize: 13, color: '#78350f', lineHeight: 1.6 }}>
                  HomeHive reviews every listing within 24 hours. Most listings go live the same day.
                </div>
              </div>
              <span style={{ background: '#f59e0b', color: '#fff', borderRadius: 20, padding: '3px 11px', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                {pendingProps.length} in review
              </span>
            </div>
            {pendingProps.length === 1 && (
              <a href={`/landlord/listings/${pendingProps[0].slug}`} style={{ fontSize: 13, fontWeight: 600, color: '#92400e', textDecoration: 'none', borderBottom: '1px solid #f59e0b' }}>
                Complete your listing →
              </a>
            )}
          </div>
        )}

        {/* ── STAT CARDS ── */}
        <div className="stat-grid">

          <div className="stat-card">
            <div className="stat-label">Monthly Revenue</div>
            <div className="stat-num" style={{ color: monthlyRevenue > 0 ? '#0f172a' : '#94a3b8' }}>
              {monthlyRevenue > 0 ? fmtCurrency(monthlyRevenue) : '—'}
            </div>
            <div className="stat-sub">
              {annualRevenue > 0 ? `${fmtCurrency(annualRevenue)}/yr from ${currentLeases.length} lease${currentLeases.length !== 1 ? 's' : ''}` : 'no active leases'}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Occupancy</div>
            <div className="stat-num" style={{ color: occupancyPct >= 80 ? '#16a34a' : occupancyPct >= 50 ? '#d97706' : '#dc2626' }}>
              {totalRooms > 0 ? `${occupancyPct}%` : '—'}
            </div>
            <div className="stat-sub">{occupiedRooms} of {totalRooms} rooms filled · {vacantRooms} vacant</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Collections — This Month</div>
            <div className="stat-num" style={{ color: overdueTotal > 0 ? '#dc2626' : '#0f172a' }}>
              {monthDue > 0 ? fmtCurrency(monthPaid) : '—'}
            </div>
            <div className="stat-sub">
              {monthDue > 0
                ? collectionRate === 100
                  ? `100% collected · ${fmtFull(monthDue)} due`
                  : `${collectionRate ?? 0}% of ${fmtFull(monthDue)} due · ${fmtFull(monthPending)} pending`
                : 'no payments this month'
              }
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Overdue Balance</div>
            <div className="stat-num" style={{ color: overdueTotal > 0 ? '#dc2626' : '#94a3b8' }}>
              {overdueTotal > 0 ? fmtCurrency(overdueTotal) : '$0'}
            </div>
            <div className="stat-sub">
              {overdueTotal > 0 ? `${overdueSPs.length} payment${overdueSPs.length !== 1 ? 's' : ''} past due` : 'all payments current'}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Active Leases</div>
            <div className="stat-num">{currentLeases.length}</div>
            <div className="stat-sub">
              {upcomingLeases.length > 0
                ? `${upcomingLeases.length} upcoming · ${expiringSoon.length > 0 ? `${expiringSoon.length} expiring soon` : 'none expiring'}`
                : expiringSoon.length > 0
                  ? `${expiringSoon.length} expiring within 60 days`
                  : `${leases.length} total leases on file`
              }
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Lead Pipeline</div>
            <div className="stat-num" style={{ color: totalActive > 0 ? '#0f172a' : '#94a3b8' }}>
              {totalActive}
            </div>
            <div className="stat-sub">
              {qualifiedCount > 0
                ? `${qualifiedCount} qualified · ${leads.filter(l => l.status === 'new').length} new`
                : leads.filter(l => l.status === 'new').length > 0
                  ? `${leads.filter(l => l.status === 'new').length} new, awaiting pre-screen`
                  : `${leads.length} total leads`
              }
            </div>
          </div>

        </div>

        {/* ── CHARTS ── */}
        <div className="db-analytics-hd">
          <div className="db-section-title" style={{ margin: 0 }}>
            📊 {dashProperty === 'all' ? 'Portfolio analytics' : 'Property analytics'}
          </div>
          {properties.length > 1 && (
            <div className="db-prop-toggle">
              {[{ slug: 'all', name: 'All properties' }, ...properties].map(p => {
                const active = dashProperty === p.slug
                return (
                  <button
                    key={p.slug}
                    onClick={() => setDashProperty(p.slug)}
                    className={`db-prop-pill${active ? ' is-active' : ''}`}
                  >
                    {p.name}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <div className="db-row-full">
          <LeadsTrendPanel dates={scopedLeads.map(l => l.created_at)} />
        </div>
        <div className="db-row">
          <LeadStatusDonut leads={scopedLeads} />
          <OccupancyByProperty properties={scopedProperties} />
        </div>
        <div className="db-row-full">
          <CollectionsBars payments={scopedSPs} />
        </div>

        {/* ── ROW: Payments + Leases ── */}
        <div className="db-row">

          {/* Payments mini */}
          <div className="panel">
            <div className="panel-hd">
              <span className="panel-title">Payments</span>
              <a href="/landlord/financials" className="panel-link">View all →</a>
            </div>
            <div className="panel-body">

              {plans.length === 0 ? (
                <div style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', padding: '16px 0' }}>
                  No payment plans yet
                </div>
              ) : (
                <>
                  {/* This month summary bar */}
                  {monthDue > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                        <span style={{ color: '#64748b', fontWeight: 600 }}>This month</span>
                        <span style={{ color: monthPending > 0 ? '#d97706' : '#16a34a', fontWeight: 700 }}>
                          {fmtFull(monthPaid)} / {fmtFull(monthDue)}
                        </span>
                      </div>
                      <div className="prog-bar">
                        <div className="prog-fill" style={{
                          width: `${Math.min(100, Math.round((monthPaid / monthDue) * 100))}%`,
                          background: monthPending > 0 ? '#f59e0b' : '#10b981',
                        }} />
                      </div>
                      {monthPending > 0 && (
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
                          {fmtFull(monthPending)} pending
                        </div>
                      )}
                    </div>
                  )}

                  {/* Overdue list */}
                  {overdueList.length > 0 ? (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                        Overdue
                      </div>
                      {overdueList.slice(0, 4).map(item => (
                        <div key={item.planId} className="row-item">
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{item.propertyName}</div>
                            <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.count} payment{item.count !== 1 ? 's' : ''} past due</div>
                          </div>
                          <a href={`/landlord/payments/${item.planId}`} style={{ fontSize: 13, fontWeight: 700, color: '#dc2626', textDecoration: 'none', flexShrink: 0 }}>
                            {fmtFull(item.owed)}
                          </a>
                        </div>
                      ))}
                    </>
                  ) : monthDue > 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#16a34a', fontWeight: 600 }}>
                      <span style={{ fontSize: 16 }}>✓</span> All payments current
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: '#94a3b8' }}>No payments due this month</div>
                  )}

                  {/* Plan list */}
                  {plans.length > 0 && (
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                        Active plans
                      </div>
                      {plans.slice(0, 4).map(plan => {
                        const planPaid  = (plan.scheduled_payments || []).filter(sp => sp.status === 'paid').length
                        const planTotal = (plan.scheduled_payments || []).length
                        return (
                          <div key={plan.id} className="row-item">
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                                {plan.property?.name || 'Unknown'}
                              </div>
                              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                {plan.tenants.map(t => t.name).join(', ')} · {planPaid}/{planTotal} paid
                              </div>
                            </div>
                            <a href={`/landlord/payments/${plan.id}`} style={{ fontSize: 11, color: '#8C1D40', textDecoration: 'none', fontWeight: 500, flexShrink: 0 }}>
                              View →
                            </a>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Leases mini */}
          <div className="panel">
            <div className="panel-hd">
              <span className="panel-title">Active Leases</span>
              <a href="/landlord/leases" className="panel-link">View all →</a>
            </div>
            <div className="panel-body">

              {currentLeases.length === 0 && upcomingLeases.length === 0 ? (
                <div style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', padding: '16px 0' }}>
                  No active leases
                </div>
              ) : (
                <>
                  {expiringSoon.length > 0 && (
                    <div style={{ background: '#fef3cd', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#92400e', fontWeight: 500 }}>
                      ⚠ {expiringSoon.length} lease{expiringSoon.length !== 1 ? 's' : ''} expiring within 60 days
                    </div>
                  )}

                  {[...currentLeases].slice(0, 5).map(lease => {
                    const days = daysUntil(lease.end_date)
                    const expiring = days <= 60
                    const tenantNames = lease.tenants.map(t => t.name).filter(Boolean).join(', ') || 'No tenant'
                    return (
                      <div key={lease.id} className="row-item">
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {tenantNames}
                          </div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>
                            {lease.property?.name} · ends {formatLeaseDate(lease.end_date)}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          {expiring ? (
                            <span className="pill" style={{ color: '#c2410c', background: '#fff7ed', borderColor: '#fed7aa' }}>
                              {days}d left
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, color: '#94a3b8' }}>{days}d left</span>
                          )}
                          {lease.rent_amount && lease.rent_amount > 0 && (
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#10b981', marginTop: 2 }}>
                              {fmtCurrency(lease.rent_amount)}/mo
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {upcomingLeases.length > 0 && (
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #f1f5f9' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                        Upcoming
                      </div>
                      {upcomingLeases.slice(0, 2).map(lease => {
                        const tenantNames = lease.tenants.map(t => t.name).filter(Boolean).join(', ') || 'No tenant'
                        const startsIn = daysUntil(lease.start_date)
                        return (
                          <div key={lease.id} className="row-item" style={{ paddingTop: 6, paddingBottom: 6 }}>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{tenantNames}</div>
                              <div style={{ fontSize: 11, color: '#94a3b8' }}>{lease.property?.name}</div>
                            </div>
                            <span className="pill" style={{ color: '#1d4ed8', background: '#eff6ff', borderColor: '#bfdbfe' }}>
                              starts in {startsIn}d
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

        </div>

        {/* ── Lead Pipeline ── */}
        <div className="db-row-full">
          <div className="panel">
            <div className="panel-hd">
              <span className="panel-title">Lead Pipeline</span>
              <a href="/landlord/leads" className="panel-link">Full pipeline →</a>
            </div>
            <div className="panel-body">
              {leads.length === 0 ? (
                <div style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', padding: '20px 0' }}>
                  No leads yet — they&apos;ll appear here once tenants inquire about your properties.
                </div>
              ) : (
                <>
                  {/* Funnel */}
                  <div className="funnel">
                    {stageCounts.map(({ stage, count }) => (
                      <div key={stage} className="funnel-seg">
                        <div className="funnel-n" style={{ color: count > 0 ? '#0f172a' : '#cbd5e1' }}>{count}</div>
                        <div className="funnel-lbl">{STAGE_LABEL[stage]}</div>
                      </div>
                    ))}
                  </div>

                  {/* Recent leads */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
                    {recentLeads.map(lead => {
                      const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email
                      const initials = (name || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
                      const cfg = STAGE_COLOR[lead.status] || STAGE_COLOR.closed
                      const propName = lead.property ? (propNameBySlug[lead.property] || lead.property) : null
                      return (
                        <a key={lead.id} href={`/landlord/leads/${lead.id}`} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10, background: '#f8fafc', borderRadius: 10, padding: '10px 12px', border: '1px solid #f1f5f9' }}>
                          <div style={{ width: 34, height: 34, borderRadius: '50%', background: cfg.bg, border: `1px solid ${cfg.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: cfg.color, flexShrink: 0 }}>
                            {initials}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                            <div style={{ fontSize: 11, color: '#94a3b8' }}>{propName || 'No property'}</div>
                          </div>
                          <span className="pill" style={{ background: cfg.bg, color: cfg.color, borderColor: cfg.border }}>
                            {STAGE_LABEL[lead.status] || lead.status}
                          </span>
                        </a>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Properties ── */}
        <div className="db-row-full">
          <div className="panel">
            <div className="panel-hd">
              <span className="panel-title">Your Properties</span>
              <a href="/landlord/listings" className="panel-link">Manage all →</a>
            </div>
            {properties.length === 0 ? (
              <div style={{ padding: '28px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>No listings yet</div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>It takes about 5 minutes to go live.</div>
                <a href="/landlord/listings/new" style={{ background: '#0f172a', color: '#34d399', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                  Create your first listing →
                </a>
              </div>
            ) : (
              <div>
                {properties.map((p, i) => {
                  const propLeads   = leads.filter(l => l.property === p.slug)
                  const propCurrent = currentLeases.filter(l => l.property?.slug === p.slug)
                  const propPlan    = plans.find(pl => pl.property?.slug === p.slug)
                  const propOverdue = propPlan
                    ? (propPlan.scheduled_payments || []).filter(sp => {
                        const d = new Date(sp.due_date + 'T00:00:00')
                        return d < today && sp.paid_amount < sp.amount && ['missed','late','partial','pending'].includes(sp.status)
                      }).reduce((s, sp) => s + sp.amount - sp.paid_amount, 0)
                    : 0

                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderBottom: i < properties.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                      {p.images?.[0]
                        ? <img src={p.images[0]} alt={p.name} style={{ width: 52, height: 44, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                        : <div style={{ width: 52, height: 44, borderRadius: 8, background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>🏠</div>
                      }
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                          {p.admin_status === 'active'   && <span className="pill" style={{ color: '#065f46', background: '#d1fae5', borderColor: '#a7f3d0' }}>Live</span>}
                          {p.admin_status === 'pending'  && <span className="pill" style={{ color: '#92400e', background: '#fef3c7', borderColor: '#fde68a' }}>Review</span>}
                          {p.admin_status === 'inactive' && <span className="pill" style={{ color: '#6b7280', background: '#f9fafb', borderColor: '#e5e7eb' }}>Inactive</span>}
                          {p.admin_status === 'rejected' && <span className="pill" style={{ color: '#9f1239', background: '#fff1f2', borderColor: '#fecdd3' }}>Rejected</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#94a3b8', flexWrap: 'wrap' }}>
                          <span>${p.price?.toLocaleString()}/mo</span>
                          <span>{p.available} of {p.total_rooms} vacant</span>
                          {propCurrent.length > 0 && <span style={{ color: '#16a34a' }}>{propCurrent.length} active lease{propCurrent.length !== 1 ? 's' : ''}</span>}
                          {propLeads.length > 0 && <span>{propLeads.length} lead{propLeads.length !== 1 ? 's' : ''}</span>}
                          {propOverdue > 0 && <span style={{ color: '#dc2626', fontWeight: 600 }}>⚠ {fmtFull(propOverdue)} overdue</span>}
                        </div>
                      </div>
                      <a href={`/landlord/listings/${p.slug}`} style={{ fontSize: 12, fontWeight: 500, color: '#8C1D40', textDecoration: 'none', flexShrink: 0 }}>Manage →</a>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

      </div>
    </>
  )
}
