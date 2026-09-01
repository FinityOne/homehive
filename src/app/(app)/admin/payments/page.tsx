'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase'
import * as d3 from 'd3'

// ─── TYPES ───────────────────────────────────────────────────────────────────
type Stats = {
  mrr: number
  estimatedTotalRevenue: number
  activePaidCount: number
  adminGrantCount: number
  lifetimePaidCount: number
  perLeadPaidCount: number
  totalPlans: number
  totalUnlocks: number
  cancelledCount: number
}

type Plan = {
  id: string
  landlord_id: string
  plan_type: string
  status: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  current_period_end: string | null
  created_at: string
  updated_at: string
  profile: { full_name: string | null; email: string; role: string } | null
}

type MonthlyRevenue = { month: string; revenue: number; newSubs: number }
type PlanTypeBreakdown = { plan_type: string; active: number; total: number }
type UnlockTypeBreakdown = { type: string; count: number }
type AuditEntry = {
  id: string; created_at: string; action: string
  from_plan_type: string | null; to_plan_type: string | null; note: string | null
  admin: { full_name: string | null; email: string } | null
  landlord_id: string
}

type PaymentsData = {
  stats: Stats
  plans: Plan[]
  monthlyRevenue: MonthlyRevenue[]
  planTypeBreakdown: PlanTypeBreakdown[]
  unlockTypeBreakdown: UnlockTypeBreakdown[]
  auditLog: AuditEntry[]
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const PLAN_LABELS: Record<string, string> = {
  single_listing: '1 Listing',
  two_listing:    'Unlimited',
  lifetime:       'Lifetime',
  per_lead:       'Pay/Lead',
  free:           'Free',
}

const PLAN_COLORS: Record<string, string> = {
  single_listing: '#8b5cf6',
  two_listing:    '#10b981',
  lifetime:       '#f59e0b',
  per_lead:       '#3b82f6',
}

const STRIPE_PRODUCTS = [
  {
    id: 'prod_UFl3BTWU24661b',
    name: 'Pay Per Lead',
    description: 'Unlock individual lead contact details for a one-time fee',
    price: '$1.99',
    priceId: 'price_1THFZ7H0iOs5gSJcuSLutPJP',
    amount: 199,
    type: 'one_time',
    interval: null,
    color: '#3b82f6',
    icon: '🔓',
    envKey: 'STRIPE_PRICE_PER_LEAD',
    active: true,
  },
  {
    id: 'prod_UFl309LHsXg4nZ',
    name: '1 Listing Plan',
    description: 'Unlimited leads for one listing per month',
    price: '$29.99/mo',
    priceId: 'price_1THFZ7H0iOs5gSJc7WBt2Oac',
    amount: 2999,
    type: 'recurring',
    interval: 'month',
    color: '#8b5cf6',
    icon: '▣',
    envKey: 'STRIPE_PRICE_SINGLE_LISTING',
    active: true,
  },
  {
    id: 'prod_UFl3RFzjBKs3v3',
    name: 'Unlimited Listings',
    description: 'Unlimited leads for any two listings per month',
    price: '$49.99/mo',
    priceId: 'price_1THFZ7H0iOs5gSJcwjZFPg9o',
    amount: 4999,
    type: 'recurring',
    interval: 'month',
    color: '#10b981',
    icon: '⊞',
    envKey: 'STRIPE_PRICE_TWO_LISTING',
    active: true,
  },
  {
    id: 'prod_UFl3573R4QWOGx',
    name: 'Lifetime Deal',
    description: 'One-time lifetime access to all leads — founding member pricing',
    price: '$299',
    priceId: 'price_1THFZ8H0iOs5gSJcirmsHRZp',
    amount: 29900,
    type: 'one_time',
    interval: null,
    color: '#f59e0b',
    icon: '♾',
    envKey: 'STRIPE_PRICE_LIFETIME',
    active: true,
  },
]

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function fmt$(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtMonth(m: string) {
  const [y, mo] = m.split('-')
  return new Date(+y, +mo - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function timeAgo(d: string | null) {
  if (!d) return '—'
  const diff = Date.now() - new Date(d).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

function isAdminGrant(plan: Plan) {
  return plan.stripe_subscription_id === 'admin_override'
}

function planStatus(plan: Plan) {
  if (plan.status === 'active' && isAdminGrant(plan)) return { label: 'Admin Grant', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.3)' }
  if (plan.status === 'active') return { label: 'Active', color: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)' }
  if (plan.status === 'past_due') return { label: 'Past Due', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' }
  return { label: 'Cancelled', color: '#6b7280', bg: 'rgba(107,114,128,0.1)', border: 'rgba(107,114,128,0.2)' }
}

// ─── D3: REVENUE CHART ───────────────────────────────────────────────────────
function RevenueChart({ data }: { data: MonthlyRevenue[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || data.length === 0) return
    const draw = () => {
      const svg = d3.select(svgRef.current!); svg.selectAll('*').remove()
      const W0 = containerRef.current!.clientWidth || 600
      const height = 200, margin = { top: 16, right: 16, bottom: 36, left: 52 }
      const W = W0 - margin.left - margin.right, H = height - margin.top - margin.bottom
      const g = svg.attr('width', W0).attr('height', height).append('g').attr('transform', `translate(${margin.left},${margin.top})`)
      const x = d3.scaleBand().domain(data.map(d => d.month)).range([0, W]).padding(0.28)
      const maxY = Math.max(d3.max(data, d => d.revenue) ?? 1, 1)
      const y = d3.scaleLinear().domain([0, maxY]).nice().range([H, 0])

      // Grid lines
      g.append('g').call(d3.axisLeft(y).ticks(5).tickSize(-W).tickFormat(() => ''))
        .call(gg => { gg.select('.domain').remove(); gg.selectAll('line').attr('stroke', '#27272a').attr('stroke-dasharray', '3,3') })

      // Bars
      g.selectAll('.bar').data(data).join('rect').attr('class', 'bar')
        .attr('x', d => x(d.month) ?? 0).attr('y', d => y(d.revenue))
        .attr('width', x.bandwidth()).attr('height', d => Math.max(0, H - y(d.revenue)))
        .attr('fill', d => d.revenue > 0 ? '#a78bfa' : '#27272a').attr('rx', 3).attr('opacity', 0.85)

      // X axis
      g.append('g').attr('transform', `translate(0,${H})`).call(
        d3.axisBottom(x)
          .tickValues(data.filter((_, i) => i % 2 === 0 || i === data.length - 1).map(d => d.month))
          .tickFormat(d => fmtMonth(d as string))
      ).call(gg => {
        gg.select('.domain').attr('stroke', '#3f3f46')
        gg.selectAll('line').attr('stroke', '#3f3f46')
        gg.selectAll('text').attr('fill', '#71717a').style('font-size', '10px').style('font-family', 'DM Sans, sans-serif')
      })

      // Y axis
      g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(v => `$${+v >= 1000 ? `${(+v / 1000).toFixed(1)}k` : v}`))
        .call(gg => {
          gg.select('.domain').remove(); gg.selectAll('line').remove()
          gg.selectAll('text').attr('fill', '#71717a').style('font-size', '10px').style('font-family', 'DM Sans, sans-serif')
        })
    }
    draw()
    const ro = new ResizeObserver(draw); ro.observe(containerRef.current!); return () => ro.disconnect()
  }, [data])

  return <div ref={containerRef}><svg ref={svgRef} style={{ display: 'block' }} /></div>
}

// ─── D3: PLAN DONUT ──────────────────────────────────────────────────────────
function PlanDonut({ data }: { data: PlanTypeBreakdown[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const active = data.filter(d => d.active > 0)
  const total = active.reduce((s, d) => s + d.active, 0)

  useEffect(() => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current); svg.selectAll('*').remove()
    if (total === 0) return
    const size = 140, r = size / 2 - 6, innerR = r * 0.54
    svg.attr('width', size).attr('height', size)
    const g = svg.append('g').attr('transform', `translate(${size / 2},${size / 2})`)
    const pie = d3.pie<PlanTypeBreakdown>().value(d => d.active).sort(null)
    const arc = d3.arc<d3.PieArcDatum<PlanTypeBreakdown>>().innerRadius(innerR).outerRadius(r)
    g.selectAll('path').data(pie(active)).join('path')
      .attr('d', arc).attr('fill', d => PLAN_COLORS[d.data.plan_type] ?? '#52525b')
      .attr('stroke', '#18181b').attr('stroke-width', 2)
    g.append('text').attr('text-anchor', 'middle').attr('dy', '-0.15em')
      .style('font-family', 'DM Sans, sans-serif').style('font-size', '22px').style('font-weight', '700').style('fill', '#fafafa').text(total)
    g.append('text').attr('text-anchor', 'middle').attr('dy', '1.2em')
      .style('font-family', 'DM Sans, sans-serif').style('font-size', '9px').style('fill', '#71717a').style('text-transform', 'uppercase').style('letter-spacing', '0.6px').text('active plans')
  }, [active, total])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <svg ref={svgRef} style={{ display: 'block', flexShrink: 0 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.map(d => (
          <div key={d.plan_type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: PLAN_COLORS[d.plan_type] ?? '#52525b', flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: '#a1a1aa', fontFamily: 'DM Sans, sans-serif', minWidth: 70 }}>{PLAN_LABELS[d.plan_type]}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fafafa', fontFamily: 'DM Sans, sans-serif' }}>{d.active}</span>
            {d.total !== d.active && <span style={{ fontSize: 10, color: '#52525b', fontFamily: 'DM Sans, sans-serif' }}>/ {d.total}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── KPI CARD ────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color = '#fafafa' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: '#27272a', border: '1px solid #3f3f46', borderRadius: 12, padding: '16px 20px', minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6, fontFamily: 'DM Sans, sans-serif' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color, fontFamily: 'DM Sans, sans-serif', letterSpacing: '-0.5px', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#52525b', marginTop: 4, fontFamily: 'DM Sans, sans-serif' }}>{sub}</div>}
    </div>
  )
}

// ─── MAIN PAGE ───────────────────────────────────────────────────────────────
type Tab = 'overview' | 'subscriptions' | 'products'

export default function AdminPaymentsPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('overview')
  const [data, setData] = useState<PaymentsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'admin_grant' | 'cancelled'>('all')

  const load = useCallback(async () => {
    const user = await getCurrentUser()
    if (!user) { router.push('/login'); return }
    setLoading(true)
    const res = await fetch('/api/admin/payments')
    if (res.ok) setData(await res.json())
    setLoading(false)
  }, [router])

  useEffect(() => { document.title = 'Payments — Admin | HomeHive' }, [])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div style={{ padding: 40, fontFamily: 'DM Sans, sans-serif', color: '#71717a', textAlign: 'center' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <div style={{ width: 24, height: 24, border: '2px solid #3f3f46', borderTopColor: '#a78bfa', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
      Loading payment data…
    </div>
  )

  if (!data) return <div style={{ padding: 40, color: '#71717a', fontFamily: 'DM Sans, sans-serif' }}>Failed to load payment data.</div>

  const { stats, plans, monthlyRevenue, planTypeBreakdown, unlockTypeBreakdown, auditLog } = data

  // ── Filter subscriptions ──────────────────────────────────────────────────
  const filteredPlans = plans.filter(p => {
    if (statusFilter === 'active' && !(p.status === 'active' && !isAdminGrant(p))) return false
    if (statusFilter === 'admin_grant' && !isAdminGrant(p)) return false
    if (statusFilter === 'cancelled' && p.status !== 'cancelled') return false
    if (search) {
      const q = search.toLowerCase()
      const name = (p.profile?.full_name ?? '').toLowerCase()
      const email = (p.profile?.email ?? '').toLowerCase()
      if (!name.includes(q) && !email.includes(q)) return false
    }
    return true
  })

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    .pa-wrap { padding: 0; font-family: 'DM Sans', sans-serif; background: #18181b; min-height: 100vh; }

    /* Header */
    .pa-header { background: #18181b; border-bottom: 1px solid #27272a; padding: 20px 28px 0; }
    .pa-title { font-size: 20px; font-weight: 700; color: #fafafa; margin-bottom: 2px; }
    .pa-sub { font-size: 12px; color: #71717a; margin-bottom: 16px; }

    /* Tabs */
    .pa-tabs { display: flex; gap: 0; border-bottom: none; overflow-x: auto; scrollbar-width: none; }
    .pa-tabs::-webkit-scrollbar { display: none; }
    .pa-tab { padding: 10px 18px; font-size: 13px; font-weight: 500; color: #71717a; border: none; background: none;
      cursor: pointer; font-family: 'DM Sans', sans-serif; white-space: nowrap; border-bottom: 2px solid transparent;
      margin-bottom: -1px; transition: color 0.15s; }
    .pa-tab:hover { color: #d4d4d8; }
    .pa-tab.active { color: #c4b5fd; border-bottom-color: #c4b5fd; font-weight: 600; }

    /* Content */
    .pa-content { padding: 24px 28px; }

    /* KPI grid */
    .pa-kpi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }

    /* Chart cards */
    .pa-card { background: #27272a; border: 1px solid #3f3f46; border-radius: 12px; overflow: hidden; margin-bottom: 16px; }
    .pa-card-hdr { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid #3f3f46; }
    .pa-card-title { font-size: 11px; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: 0.6px; }
    .pa-card-body { padding: 16px 18px; }

    /* Table */
    .pa-table-wrap { background: #27272a; border: 1px solid #3f3f46; border-radius: 12px; overflow: hidden; margin-bottom: 16px; }
    .pa-table { width: 100%; border-collapse: collapse; }
    .pa-table thead th { background: #1f1f22; padding: 8px 14px; text-align: left; font-size: 10px; font-weight: 700;
      color: #71717a; text-transform: uppercase; letter-spacing: 0.6px; border-bottom: 1px solid #3f3f46; white-space: nowrap; }
    .pa-table tbody tr { border-bottom: 1px solid #3f3f46; transition: background 0.1s; }
    .pa-table tbody tr:last-child { border-bottom: none; }
    .pa-table tbody tr:hover { background: rgba(250,250,250,0.03); }
    .pa-table td { padding: 10px 14px; vertical-align: middle; font-size: 13px; color: #d4d4d8; }
    .pa-badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid; white-space: nowrap; }

    /* Filters */
    .pa-filters { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
    .pa-search { padding: 7px 12px; border: 1.5px solid #3f3f46; border-radius: 8px; font-size: 13px;
      font-family: 'DM Sans', sans-serif; background: #27272a; color: #fafafa; outline: none; width: 220px; transition: border-color 0.15s; }
    .pa-search::placeholder { color: #52525b; }
    .pa-search:focus { border-color: #a78bfa; }
    .pa-filter-pill { padding: 5px 12px; border-radius: 20px; border: 1.5px solid #3f3f46; background: #27272a;
      font-size: 12px; font-weight: 500; color: #71717a; cursor: pointer; transition: all 0.15s; white-space: nowrap;
      font-family: 'DM Sans', sans-serif; }
    .pa-filter-pill.active { background: rgba(167,139,250,0.15); color: #c4b5fd; border-color: rgba(167,139,250,0.4); font-weight: 600; }

    /* Product cards */
    .pa-product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; margin-bottom: 24px; }
    .pa-product-card { background: #27272a; border: 1px solid #3f3f46; border-radius: 14px; padding: 20px; position: relative; overflow: hidden; }
    .pa-product-id { font-size: 10px; color: #52525b; font-family: monospace; margin-top: 8px; word-break: break-all; }

    /* Audit */
    .pa-audit-row { display: flex; gap: 10px; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid #27272a; }
    .pa-audit-row:last-child { border-bottom: none; }

    /* Unlock breakdown bars */
    .pa-breakdown-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .pa-bar-track { flex: 1; height: 6px; background: #3f3f46; border-radius: 3px; overflow: hidden; }
    .pa-bar-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }

    @media (max-width: 640px) {
      .pa-content { padding: 16px; }
      .pa-header { padding: 16px 16px 0; }
      .pa-kpi-grid { grid-template-columns: 1fr 1fr; }
      .pa-product-grid { grid-template-columns: 1fr; }
    }
  `

  const UNLOCK_COLORS: Record<string, string> = {
    per_lead: '#3b82f6', subscription: '#10b981', free: '#71717a', plan: '#a78bfa',
  }
  const UNLOCK_LABELS: Record<string, string> = {
    per_lead: 'Per Lead ($1.99)', subscription: 'Subscription unlock', free: 'Free (first lead)', plan: 'Plan',
  }

  const maxUnlocks = Math.max(...unlockTypeBreakdown.map(u => u.count), 1)

  return (
    <>
      <style>{CSS}</style>
      <div className="pa-wrap">

        {/* Header */}
        <div className="pa-header">
          <div className="pa-title">Payments & Revenue</div>
          <div className="pa-sub">Financial gateway — subscriptions, transactions, and product pricing</div>
          <div className="pa-tabs">
            {([
              { id: 'overview',      label: '⊞ Overview'          },
              { id: 'subscriptions', label: '◎ Subscriptions'     },
              { id: 'products',      label: '▣ Products & Pricing' },
            ] as { id: Tab; label: string }[]).map(t => (
              <button
                key={t.id}
                className={`pa-tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pa-content">

          {/* ═══════════════════════════════════════════════════════════
              OVERVIEW TAB
          ═══════════════════════════════════════════════════════════ */}
          {tab === 'overview' && (
            <>
              {/* KPI Bar */}
              <div className="pa-kpi-grid">
                <KpiCard
                  label="MRR (Est.)"
                  value={fmt$(stats.mrr)}
                  sub="Active paid subscriptions"
                  color="#c4b5fd"
                />
                <KpiCard
                  label="ARR (Est.)"
                  value={fmt$(stats.mrr * 12)}
                  sub="MRR × 12"
                  color="#a78bfa"
                />
                <KpiCard
                  label="Total Revenue (Est.)"
                  value={fmt$(stats.estimatedTotalRevenue)}
                  sub="All-time from Supabase records"
                />
                <KpiCard
                  label="Paid Plans"
                  value={String(stats.activePaidCount)}
                  sub="Active subscriptions via Stripe"
                  color="#10b981"
                />
                <KpiCard
                  label="Admin Grants"
                  value={String(stats.adminGrantCount)}
                  sub="Comped — no Stripe revenue"
                  color="#a78bfa"
                />
                <KpiCard
                  label="Lifetime Sales"
                  value={String(stats.lifetimePaidCount)}
                  sub={`${fmt$(stats.lifetimePaidCount * 299)} est.`}
                  color="#f59e0b"
                />
                <KpiCard
                  label="Per-Lead Unlocks"
                  value={String(stats.perLeadPaidCount)}
                  sub={`${fmt$(stats.perLeadPaidCount * 1.99)} est.`}
                  color="#3b82f6"
                />
                <KpiCard
                  label="Total Unlocks"
                  value={String(stats.totalUnlocks)}
                  sub="All unlock events ever"
                />
              </div>

              {/* Charts row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, marginBottom: 16, alignItems: 'start' }}>
                {/* Revenue trend */}
                <div className="pa-card">
                  <div className="pa-card-hdr">
                    <span className="pa-card-title">Monthly Revenue (Est.) — last 12 months</span>
                    <span style={{ fontSize: 12, color: '#52525b', fontFamily: 'DM Sans, sans-serif' }}>Supabase-derived</span>
                  </div>
                  <div className="pa-card-body">
                    <RevenueChart data={monthlyRevenue} />
                    <div style={{ marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      {monthlyRevenue.filter(m => m.revenue > 0).slice(-3).map(m => (
                        <div key={m.month} style={{ fontSize: 11, color: '#71717a', fontFamily: 'DM Sans, sans-serif' }}>
                          <span style={{ color: '#c4b5fd', fontWeight: 700 }}>{fmtMonth(m.month)}</span>
                          {' '}{fmt$(m.revenue)}
                          {m.newSubs > 0 && <span style={{ color: '#52525b' }}> · {m.newSubs} new sub{m.newSubs !== 1 ? 's' : ''}</span>}
                        </div>
                      ))}
                      {monthlyRevenue.every(m => m.revenue === 0) && (
                        <span style={{ fontSize: 12, color: '#52525b', fontFamily: 'DM Sans, sans-serif' }}>No paid transactions recorded yet</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Plan donut */}
                <div className="pa-card" style={{ minWidth: 240 }}>
                  <div className="pa-card-hdr"><span className="pa-card-title">Active Plans</span></div>
                  <div className="pa-card-body">
                    <PlanDonut data={planTypeBreakdown} />
                  </div>
                </div>
              </div>

              {/* Unlock breakdown */}
              <div className="pa-card" style={{ marginBottom: 16 }}>
                <div className="pa-card-hdr"><span className="pa-card-title">Unlock Type Breakdown</span></div>
                <div className="pa-card-body">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 32px' }}>
                    {unlockTypeBreakdown.map(u => (
                      <div key={u.type} className="pa-breakdown-row">
                        <div style={{ fontSize: 12, color: '#a1a1aa', fontFamily: 'DM Sans, sans-serif', minWidth: 130 }}>
                          {UNLOCK_LABELS[u.type] ?? u.type}
                        </div>
                        <div className="pa-bar-track">
                          <div className="pa-bar-fill" style={{ width: `${(u.count / maxUnlocks) * 100}%`, background: UNLOCK_COLORS[u.type] ?? '#52525b' }} />
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#fafafa', minWidth: 28, textAlign: 'right', fontFamily: 'DM Sans, sans-serif' }}>
                          {u.count}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Revenue mix summary */}
              <div className="pa-card" style={{ marginBottom: 16 }}>
                <div className="pa-card-hdr"><span className="pa-card-title">Revenue Channel Mix</span></div>
                <div className="pa-card-body">
                  {(() => {
                    const channels = [
                      { label: '1 Listing subscriptions', count: planTypeBreakdown.find(p => p.plan_type === 'single_listing')?.active ?? 0, price: 29.99, color: '#8b5cf6', interval: '/mo' },
                      { label: 'Unlimited subscriptions', count: planTypeBreakdown.find(p => p.plan_type === 'two_listing')?.active ?? 0, price: 49.99, color: '#10b981', interval: '/mo' },
                      { label: 'Lifetime deals (paid)',   count: stats.lifetimePaidCount, price: 299, color: '#f59e0b', interval: ' once' },
                      { label: 'Per-lead unlocks',        count: stats.perLeadPaidCount,  price: 1.99, color: '#3b82f6', interval: ' each' },
                    ]
                    const totalRev = channels.reduce((s, c) => s + c.count * c.price, 0) || 1
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {channels.map(c => {
                          const rev = c.count * c.price
                          const pct = totalRev > 0 ? (rev / totalRev) * 100 : 0
                          return (
                            <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <div style={{ width: 10, height: 10, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                              <div style={{ fontSize: 12, color: '#a1a1aa', fontFamily: 'DM Sans, sans-serif', minWidth: 180 }}>{c.label}</div>
                              <div style={{ flex: 1, height: 6, background: '#3f3f46', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: c.color, borderRadius: 3, transition: 'width 0.4s' }} />
                              </div>
                              <div style={{ fontSize: 12, color: '#d4d4d8', fontWeight: 600, minWidth: 60, textAlign: 'right', fontFamily: 'DM Sans, sans-serif' }}>
                                {fmt$(rev)}
                              </div>
                              <div style={{ fontSize: 11, color: '#52525b', minWidth: 80, fontFamily: 'DM Sans, sans-serif' }}>
                                {c.count} × {fmt$(c.price)}{c.interval}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>
              </div>

              {/* Admin grant audit log */}
              {auditLog.length > 0 && (
                <div className="pa-card">
                  <div className="pa-card-hdr">
                    <span className="pa-card-title">Plan Grant / Revoke Audit</span>
                    <span style={{ fontSize: 11, color: '#52525b', fontFamily: 'DM Sans, sans-serif' }}>{auditLog.length} entries</span>
                  </div>
                  <div className="pa-card-body" style={{ padding: '0 18px' }}>
                    {auditLog.slice(0, 10).map(entry => (
                      <div key={entry.id} className="pa-audit-row">
                        <div style={{
                          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                          background: entry.action === 'grant' ? 'rgba(167,139,250,0.18)' : 'rgba(107,114,128,0.18)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12,
                        }}>
                          {entry.action === 'grant' ? '↑' : '↓'}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: '#d4d4d8', fontFamily: 'DM Sans, sans-serif' }}>
                            <span style={{ color: entry.action === 'grant' ? '#c4b5fd' : '#6b7280', fontWeight: 600 }}>
                              {entry.action === 'grant' ? 'Granted' : 'Revoked'}
                            </span>
                            {entry.to_plan_type && (
                              <> <span style={{ color: '#fafafa', fontWeight: 600 }}>{PLAN_LABELS[entry.to_plan_type] ?? entry.to_plan_type}</span> plan</>
                            )}
                            {entry.from_plan_type && entry.action === 'revoke' && (
                              <> from <span style={{ color: '#a1a1aa' }}>{PLAN_LABELS[entry.from_plan_type] ?? entry.from_plan_type}</span></>
                            )}
                          </div>
                          {entry.note && <div style={{ fontSize: 11, color: '#52525b', marginTop: 2, fontFamily: 'DM Sans, sans-serif' }}>Note: {entry.note}</div>}
                          <div style={{ fontSize: 10, color: '#52525b', marginTop: 2, fontFamily: 'DM Sans, sans-serif' }}>
                            by {entry.admin?.full_name ?? entry.admin?.email ?? 'Admin'} · {timeAgo(entry.created_at)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════
              SUBSCRIPTIONS TAB
          ═══════════════════════════════════════════════════════════ */}
          {tab === 'subscriptions' && (
            <>
              {/* Summary strip */}
              <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
                {[
                  { label: 'Total plans', value: stats.totalPlans },
                  { label: 'Active paid', value: stats.activePaidCount, color: '#10b981' },
                  { label: 'Admin grants', value: stats.adminGrantCount, color: '#a78bfa' },
                  { label: 'Cancelled', value: stats.cancelledCount, color: '#6b7280' },
                  { label: 'Lifetime', value: stats.lifetimePaidCount, color: '#f59e0b' },
                ].map(s => (
                  <div key={s.label} style={{ background: '#27272a', border: '1px solid #3f3f46', borderRadius: 8, padding: '8px 16px', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: s.color ?? '#fafafa', fontFamily: 'DM Sans, sans-serif' }}>{s.value}</span>
                    <span style={{ fontSize: 11, color: '#71717a', fontFamily: 'DM Sans, sans-serif' }}>{s.label}</span>
                  </div>
                ))}
              </div>

              {/* Filters */}
              <div className="pa-filters">
                <input
                  className="pa-search"
                  placeholder="Search by name or email…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {([
                  { id: 'all',        label: 'All' },
                  { id: 'active',     label: 'Active' },
                  { id: 'admin_grant',label: 'Admin Grants' },
                  { id: 'cancelled',  label: 'Cancelled' },
                ] as { id: typeof statusFilter; label: string }[]).map(f => (
                  <div
                    key={f.id}
                    className={`pa-filter-pill${statusFilter === f.id ? ' active' : ''}`}
                    onClick={() => setStatusFilter(f.id)}
                  >
                    {f.label}
                  </div>
                ))}
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#52525b', fontFamily: 'DM Sans, sans-serif' }}>
                  {filteredPlans.length} result{filteredPlans.length !== 1 ? 's' : ''}
                </span>
              </div>

              {filteredPlans.length === 0 ? (
                <div style={{ padding: '60px 20px', textAlign: 'center', color: '#52525b', fontFamily: 'DM Sans, sans-serif', fontSize: 14 }}>
                  No subscriptions match your filters.
                </div>
              ) : (
                <div className="pa-table-wrap">
                  <table className="pa-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Role</th>
                        <th>Plan</th>
                        <th>Status</th>
                        <th>Started</th>
                        <th>Expires</th>
                        <th>Source</th>
                        <th>Stripe Customer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPlans.map(plan => {
                        const st = planStatus(plan)
                        const planColor = PLAN_COLORS[plan.plan_type] ?? '#71717a'
                        return (
                          <tr key={plan.id}>
                            <td>
                              <div style={{ fontWeight: 600, fontSize: 13, color: '#fafafa' }}>
                                {plan.profile?.full_name || '—'}
                              </div>
                              <div style={{ fontSize: 11, color: '#71717a', marginTop: 1 }}>{plan.profile?.email}</div>
                            </td>
                            <td>
                              <span style={{ fontSize: 11, background: 'rgba(167,139,250,0.1)', color: '#c4b5fd', border: '1px solid rgba(167,139,250,0.2)', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>
                                {plan.profile?.role ?? '—'}
                              </span>
                            </td>
                            <td>
                              <span style={{ fontSize: 12, fontWeight: 700, color: planColor }}>
                                {PLAN_LABELS[plan.plan_type] ?? plan.plan_type}
                              </span>
                            </td>
                            <td>
                              <span className="pa-badge" style={{ color: st.color, background: st.bg, borderColor: st.border }}>
                                {st.label}
                              </span>
                            </td>
                            <td style={{ fontSize: 12, color: '#a1a1aa' }}>{fmtDate(plan.created_at)}</td>
                            <td style={{ fontSize: 12, color: '#a1a1aa' }}>
                              {plan.plan_type === 'lifetime' ? <span style={{ color: '#f59e0b', fontWeight: 600 }}>♾ Forever</span> : fmtDate(plan.current_period_end)}
                            </td>
                            <td>
                              {isAdminGrant(plan)
                                ? <span style={{ fontSize: 11, color: '#a78bfa', fontWeight: 600 }}>Admin override</span>
                                : <span style={{ fontSize: 11, color: '#10b981', fontWeight: 600 }}>Stripe</span>
                              }
                            </td>
                            <td>
                              <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#52525b' }}>
                                {plan.stripe_customer_id ?? '—'}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════
              PRODUCTS & PRICING TAB
          ═══════════════════════════════════════════════════════════ */}
          {tab === 'products' && (
            <>
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, color: '#71717a', fontFamily: 'DM Sans, sans-serif', lineHeight: 1.6 }}>
                  All products and prices are live in Stripe (test mode · account <span style={{ fontFamily: 'monospace', color: '#a78bfa' }}>acct_1Fz9EmH0iOs5gSJc</span>).
                  Prices below match the price IDs configured in your environment variables.
                </div>
              </div>

              <div className="pa-product-grid">
                {STRIPE_PRODUCTS.map(product => (
                  <div key={product.id} className="pa-product-card">
                    {/* Colour accent bar */}
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: product.color, borderRadius: '14px 14px 0 0' }} />

                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10, marginTop: 8 }}>
                      <div style={{ fontSize: 22 }}>{product.icon}</div>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                        background: 'rgba(16,185,129,0.12)', color: '#10b981',
                        border: '1px solid rgba(16,185,129,0.25)', letterSpacing: '0.4px',
                        fontFamily: 'DM Sans, sans-serif',
                      }}>
                        LIVE
                      </span>
                    </div>

                    <div style={{ fontWeight: 700, fontSize: 16, color: '#fafafa', fontFamily: 'DM Sans, sans-serif', marginBottom: 4 }}>
                      {product.name}
                    </div>
                    <div style={{ fontSize: 12, color: '#71717a', fontFamily: 'DM Sans, sans-serif', lineHeight: 1.5, marginBottom: 14 }}>
                      {product.description}
                    </div>

                    {/* Price */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 14 }}>
                      <span style={{ fontSize: 28, fontWeight: 800, color: product.color, fontFamily: 'DM Sans, sans-serif', letterSpacing: '-0.5px' }}>
                        {product.price.split('/')[0]}
                      </span>
                      {product.interval && (
                        <span style={{ fontSize: 13, color: '#71717a', fontFamily: 'DM Sans, sans-serif' }}>/ {product.interval}</span>
                      )}
                      <span style={{ marginLeft: 6, fontSize: 11, background: product.type === 'recurring' ? 'rgba(16,185,129,0.1)' : 'rgba(59,130,246,0.1)', color: product.type === 'recurring' ? '#10b981' : '#3b82f6', border: `1px solid ${product.type === 'recurring' ? 'rgba(16,185,129,0.3)' : 'rgba(59,130,246,0.3)'}`, padding: '1px 7px', borderRadius: 20, fontWeight: 600, fontFamily: 'DM Sans, sans-serif' }}>
                        {product.type === 'recurring' ? 'Subscription' : 'One-time'}
                      </span>
                    </div>

                    {/* IDs */}
                    <div style={{ borderTop: '1px solid #3f3f46', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, fontFamily: 'DM Sans, sans-serif' }}>Product ID</div>
                        <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#71717a', wordBreak: 'break-all' }}>{product.id}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, fontFamily: 'DM Sans, sans-serif' }}>Price ID</div>
                        <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#71717a', wordBreak: 'break-all' }}>{product.priceId}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, fontFamily: 'DM Sans, sans-serif' }}>Env Variable</div>
                        <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#a78bfa' }}>{product.envKey}</div>
                      </div>
                    </div>

                    {/* Usage counter */}
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #3f3f46', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11, color: '#71717a', fontFamily: 'DM Sans, sans-serif' }}>Active on platform</span>
                      <span style={{ fontSize: 15, fontWeight: 800, color: product.color, fontFamily: 'DM Sans, sans-serif' }}>
                        {product.id === 'prod_UFl3BTWU24661b'
                          ? stats.perLeadPaidCount
                          : product.id === 'prod_UFl3573R4QWOGx'
                          ? stats.lifetimePaidCount
                          : product.id === 'prod_UFl309LHsXg4nZ'
                          ? (planTypeBreakdown.find(p => p.plan_type === 'single_listing')?.active ?? 0)
                          : (planTypeBreakdown.find(p => p.plan_type === 'two_listing')?.active ?? 0)
                        }
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Stripe environment info */}
              <div className="pa-card">
                <div className="pa-card-hdr"><span className="pa-card-title">Stripe Environment</span></div>
                <div className="pa-card-body">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
                    {[
                      { label: 'Account', value: 'FinityOne', sub: 'acct_1Fz9EmH0iOs5gSJc' },
                      { label: 'Mode', value: 'Test', sub: 'pk_test_… / sk_test_…', color: '#f59e0b' },
                      { label: 'Webhook Secret', value: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ? 'Configured' : '⚠ Not set', sub: 'STRIPE_WEBHOOK_SECRET', color: '#ef4444' },
                      { label: 'Publishable Key', value: 'Set', sub: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', color: '#10b981' },
                    ].map(item => (
                      <div key={item.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'DM Sans, sans-serif' }}>{item.label}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: item.color ?? '#fafafa', fontFamily: 'DM Sans, sans-serif' }}>{item.value}</div>
                        <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#52525b' }}>{item.sub}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8 }}>
                    <div style={{ fontSize: 12, color: '#d97706', fontFamily: 'DM Sans, sans-serif', fontWeight: 600, marginBottom: 3 }}>⚠ Action required: Stripe Webhook Secret</div>
                    <div style={{ fontSize: 12, color: '#92400e', fontFamily: 'DM Sans, sans-serif', lineHeight: 1.5 }}>
                      STRIPE_WEBHOOK_SECRET is not set. Stripe events (subscription created/updated, payment succeeded) will not be processed.
                      Add your webhook endpoint in the <a href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer" style={{ color: '#f59e0b' }}>Stripe Dashboard</a> and set the secret in your environment.
                    </div>
                  </div>
                </div>
              </div>

              {/* Revenue model summary */}
              <div className="pa-card" style={{ marginTop: 16 }}>
                <div className="pa-card-hdr"><span className="pa-card-title">Revenue Model Summary</span></div>
                <div className="pa-card-body">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[
                      { icon: '🔓', name: 'Pay Per Lead', model: 'One-time charge per lead unlock', price: '$1.99', note: 'Low friction — captures price-sensitive landlords', color: '#3b82f6' },
                      { icon: '▣', name: '1 Listing Plan', model: 'Monthly subscription — 1 listing, unlimited leads', price: '$29.99/mo', note: 'Entry subscription tier', color: '#8b5cf6' },
                      { icon: '⊞', name: 'Unlimited Listings', model: 'Monthly subscription — all listings', price: '$49.99/mo', note: 'Best value — target active landlords with multiple properties', color: '#10b981' },
                      { icon: '♾', name: 'Lifetime Deal', model: 'One-time payment, all listings forever', price: '$299', note: 'Founding member rate — high LTV, limited availability', color: '#f59e0b' },
                    ].map(r => (
                      <div key={r.name} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid #3f3f46' }}>
                        <div style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>{r.icon}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: r.color, fontFamily: 'DM Sans, sans-serif' }}>{r.name}</div>
                          <div style={{ fontSize: 12, color: '#a1a1aa', fontFamily: 'DM Sans, sans-serif', marginTop: 2 }}>{r.model}</div>
                          <div style={{ fontSize: 11, color: '#52525b', fontFamily: 'DM Sans, sans-serif', marginTop: 3, fontStyle: 'italic' }}>{r.note}</div>
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: r.color, fontFamily: 'DM Sans, sans-serif', flexShrink: 0 }}>{r.price}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
