'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import * as d3 from 'd3'
import FinancialsTab from './FinancialsTab'
import LandlordBooksTab from './LandlordBooksTab'
import {
  PLANS, PLAN_ORDER, PLAN_CHART_COLORS, RETIRED_PLAN_TYPES,
  planShortName, planPriceLabel, planPriceCents,
  formatMonthly, formatPropertyLimit,
  type PlanTier,
} from '@/lib/landlordPlans'
import { FREE_PROPERTY_LIMIT } from '@/lib/landlordAccess'

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
//
// Labels, colours and prices all come from `landlordPlans.ts`. This page used
// to hard-code a catalogue of four retired products — per-lead unlocks, two
// legacy listing plans and the $299 lifetime deal — with their Stripe price
// IDs and `STRIPE_PRICE_*` env vars, none of which the app reads any more. So
// the one screen whose job is to answer "what do we charge?" answered with a
// price list we stopped selling a year ago.

/** Every tier we sell, plus the retired types, labelled the same way everywhere. */
const planLabel = (planType: string) =>
  planType === 'free' ? 'Free' : planShortName(planType)

const planColor = (planType: string) => PLAN_CHART_COLORS[planType] ?? '#8e8e93'

/** Why each retired plan existed, so an old row on a landlord still explains itself. */
const RETIRED_NOTES: Record<string, string> = {
  single_listing: 'Pre-tier subscription — one listing, unlimited leads',
  two_listing:    'Pre-tier subscription — two listings, unlimited leads',
  lifetime:       'Founding-member one-time purchase, never expires',
  per_lead:       'Paid per unlocked lead, before leads were included',
  legacy_free:    'Grandfathered: on the platform before it was paid',
}

/** Icons are per-tier and purely decorative — the ladder reads top to bottom. */
const TIER_ICON: Record<PlanTier, string> = {
  starter:   '▣',
  growth:    '⊞',
  unlimited: '♾',
}

/**
 * The live catalogue, derived from the plan definitions rather than typed out.
 *
 * There are no Stripe price IDs or env vars to show: prices are created in
 * Stripe on first use from `lookupKey` (see `landlordPlanServer.ts`), which is
 * why the lookup key is the identifier worth putting on screen — it is the one
 * an admin would search Stripe for.
 */
const LIVE_PRODUCTS = PLAN_ORDER.map(tier => {
  const plan = PLANS[tier]
  return {
    tier,
    name: plan.name,
    description: plan.tagline,
    audience: plan.audience,
    priceLabel: formatMonthly(plan.priceCents),
    propertyLimit: formatPropertyLimit(plan.propertyLimit),
    lookupKey: plan.lookupKey,
    color: PLAN_CHART_COLORS[tier],
    icon: TIER_ICON[tier],
    highlight: !!plan.highlight,
  }
})

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
  if (plan.status === 'active' && isAdminGrant(plan)) return { label: 'Admin Grant', color: '#146b7d', bg: 'rgba(20,107,125,0.12)', border: 'rgba(20,107,125,0.3)' }
  if (plan.status === 'active') return { label: 'Active', color: '#0f7a43', bg: 'rgba(15,122,67,0.12)', border: 'rgba(15,122,67,0.3)' }
  if (plan.status === 'past_due') return { label: 'Past Due', color: '#b25000', bg: 'rgba(178,80,0,0.12)', border: 'rgba(178,80,0,0.3)' }
  return { label: 'Cancelled', color: '#8e8e93', bg: 'rgba(142,142,147,0.1)', border: 'rgba(142,142,147,0.2)' }
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
        .call(gg => { gg.select('.domain').remove(); gg.selectAll('line').attr('stroke', '#e5e5ea').attr('stroke-dasharray', '3,3') })

      // Bars
      g.selectAll('.bar').data(data).join('rect').attr('class', 'bar')
        .attr('x', d => x(d.month) ?? 0).attr('y', d => y(d.revenue))
        .attr('width', x.bandwidth()).attr('height', d => Math.max(0, H - y(d.revenue)))
        .attr('fill', d => d.revenue > 0 ? '#146b7d' : '#eceeef').attr('rx', 3).attr('opacity', 0.85)

      // X axis
      g.append('g').attr('transform', `translate(0,${H})`).call(
        d3.axisBottom(x)
          .tickValues(data.filter((_, i) => i % 2 === 0 || i === data.length - 1).map(d => d.month))
          .tickFormat(d => fmtMonth(d as string))
      ).call(gg => {
        gg.select('.domain').attr('stroke', '#e5e5ea')
        gg.selectAll('line').attr('stroke', '#e5e5ea')
        gg.selectAll('text').attr('fill', '#8e8e93').style('font-size', '10px').style('font-family', 'DM Sans, sans-serif')
      })

      // Y axis
      g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(v => `$${+v >= 1000 ? `${(+v / 1000).toFixed(1)}k` : v}`))
        .call(gg => {
          gg.select('.domain').remove(); gg.selectAll('line').remove()
          gg.selectAll('text').attr('fill', '#8e8e93').style('font-size', '10px').style('font-family', 'DM Sans, sans-serif')
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
      .attr('d', arc).attr('fill', d => planColor(d.data.plan_type))
      .attr('stroke', '#ffffff').attr('stroke-width', 2)
    g.append('text').attr('text-anchor', 'middle').attr('dy', '-0.15em')
      .style('font-family', 'DM Sans, sans-serif').style('font-size', '22px').style('font-weight', '700').style('fill', '#1d1d1f').text(total)
    g.append('text').attr('text-anchor', 'middle').attr('dy', '1.2em')
      .style('font-family', 'DM Sans, sans-serif').style('font-size', '9px').style('fill', '#8e8e93').style('text-transform', 'uppercase').style('letter-spacing', '0.6px').text('active plans')
  }, [active, total])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <svg ref={svgRef} style={{ display: 'block', flexShrink: 0 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.map(d => (
          <div key={d.plan_type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: planColor(d.plan_type), flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: '#6e6e73', fontFamily: 'DM Sans, sans-serif', minWidth: 70 }}>{planLabel(d.plan_type)}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1d1d1f', fontFamily: 'DM Sans, sans-serif' }}>{d.active}</span>
            {d.total !== d.active && <span style={{ fontSize: 10, color: '#a1a1a6', fontFamily: 'DM Sans, sans-serif' }}>/ {d.total}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── KPI CARD ────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color = '#1d1d1f' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: '#ffffff', border: '1px solid #e5e5ea', borderRadius: 12, padding: '16px 20px', minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#8e8e93', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6, fontFamily: 'DM Sans, sans-serif' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color, fontFamily: 'DM Sans, sans-serif', letterSpacing: '-0.5px', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#a1a1a6', marginTop: 4, fontFamily: 'DM Sans, sans-serif' }}>{sub}</div>}
    </div>
  )
}

// ─── MAIN PAGE ───────────────────────────────────────────────────────────────
type Tab = 'overview' | 'landlords' | 'financials' | 'subscriptions' | 'products'

const TAB_IDS: Tab[] = ['overview', 'landlords', 'financials', 'subscriptions', 'products']

/** The tabs that actually read `/api/admin/payments`. */
const NEEDS_PLAN_DATA = new Set<Tab>(['overview', 'subscriptions', 'products'])

const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    .pa-wrap { padding: 0; font-family: 'DM Sans', sans-serif; background: #f5f8f8; min-height: 100vh; }

    /* Header */
    .pa-header { background: #f5f8f8; border-bottom: 1px solid #e5e5ea; padding: 20px 28px 0; }
    .pa-title { font-size: 20px; font-weight: 700; color: #1d1d1f; margin-bottom: 2px; }
    .pa-sub { font-size: 12px; color: #8e8e93; margin-bottom: 16px; }

    /* Tabs */
    .pa-tabs { display: flex; gap: 0; border-bottom: none; overflow-x: auto; scrollbar-width: none; }
    .pa-tabs::-webkit-scrollbar { display: none; }
    .pa-tab { padding: 10px 18px; font-size: 13px; font-weight: 500; color: #8e8e93; border: none; background: none;
      cursor: pointer; font-family: 'DM Sans', sans-serif; white-space: nowrap; border-bottom: 2px solid transparent;
      margin-bottom: -1px; transition: color 0.15s; }
    .pa-tab:hover { color: #3a3a3c; }
    .pa-tab.active { color: #0f5663; border-bottom-color: #0f5663; font-weight: 600; }

    /* Content */
    .pa-content { padding: 24px 28px; }

    /* KPI grid */
    .pa-kpi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }

    /* Chart cards */
    .pa-card { background: #ffffff; border: 1px solid #e5e5ea; border-radius: 12px; overflow: hidden; margin-bottom: 16px; }
    .pa-card-hdr { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid #e5e5ea; }
    .pa-card-title { font-size: 11px; font-weight: 700; color: #8e8e93; text-transform: uppercase; letter-spacing: 0.6px; }
    .pa-card-body { padding: 16px 18px; }

    /* Table */
    .pa-table-wrap { background: #ffffff; border: 1px solid #e5e5ea; border-radius: 12px; overflow: hidden; margin-bottom: 16px; }
    .pa-table { width: 100%; border-collapse: collapse; }
    .pa-table thead th { background: #fafafb; padding: 8px 14px; text-align: left; font-size: 10px; font-weight: 700;
      color: #8e8e93; text-transform: uppercase; letter-spacing: 0.6px; border-bottom: 1px solid #e5e5ea; white-space: nowrap; }
    .pa-table tbody tr { border-bottom: 1px solid #e5e5ea; transition: background 0.1s; }
    .pa-table tbody tr:last-child { border-bottom: none; }
    .pa-table tbody tr:hover { background: rgba(20,24,27,0.03); }
    .pa-table td { padding: 10px 14px; vertical-align: middle; font-size: 13px; color: #3a3a3c; }
    .pa-badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid; white-space: nowrap; }

    /* Filters */
    .pa-filters { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
    .pa-search { padding: 7px 12px; border: 1.5px solid #e5e5ea; border-radius: 8px; font-size: 13px;
      font-family: 'DM Sans', sans-serif; background: #ffffff; color: #1d1d1f; outline: none; width: 220px; transition: border-color 0.15s; }
    .pa-search::placeholder { color: #a1a1a6; }
    .pa-search:focus { border-color: #146b7d; }
    .pa-filter-pill { padding: 5px 12px; border-radius: 20px; border: 1.5px solid #e5e5ea; background: #ffffff;
      font-size: 12px; font-weight: 500; color: #8e8e93; cursor: pointer; transition: all 0.15s; white-space: nowrap;
      font-family: 'DM Sans', sans-serif; }
    .pa-filter-pill.active { background: rgba(20,107,125,0.15); color: #0f5663; border-color: rgba(20,107,125,0.4); font-weight: 600; }

    /* Product cards */
    .pa-product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; margin-bottom: 24px; }
    .pa-product-card { background: #ffffff; border: 1px solid #e5e5ea; border-radius: 14px; padding: 20px; position: relative; overflow: hidden; }
    .pa-product-id { font-size: 10px; color: #a1a1a6; font-family: monospace; margin-top: 8px; word-break: break-all; }

    /* Audit */
    .pa-audit-row { display: flex; gap: 10px; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid #e5e5ea; }
    .pa-audit-row:last-child { border-bottom: none; }

    /* Unlock breakdown bars */
    .pa-breakdown-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .pa-bar-track { flex: 1; height: 6px; background: #e5e5ea; border-radius: 3px; overflow: hidden; }
    .pa-bar-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }

    @media (max-width: 640px) {
      .pa-content { padding: 16px; }
      .pa-header { padding: 16px 16px 0; }
      .pa-kpi-grid { grid-template-columns: 1fr 1fr; }
      .pa-product-grid { grid-template-columns: 1fr; }
    }
  `

/**
 * The title and tab bar, lifted out of the page so the two tabs that do not
 * read `/api/admin/payments` can render it without first waiting for that
 * call to come back. They are their own screens; the chrome around them is
 * shared, not a reason to block.
 */
function PaymentsHeader({ tab, openTab }: { tab: Tab; openTab: (next: Tab) => void }) {
  return (
        <div className="pa-header">
          <div className="pa-title">Payments & Revenue</div>
          <div className="pa-sub">Financial gateway — subscriptions, transactions, and product pricing</div>
          <div className="pa-tabs">
            {([
              { id: 'overview',      label: '⊞ Overview'          },
              // Financials is the books by landlord — payments processed, rent
              // collected, lateness and fees, drilled landlord → property →
              // lease. Revenue is the same money as one platform P&L.
              { id: 'landlords',     label: '◈ Financials'        },
              // Labelled "Revenue", but the tab id stays `financials` so every
              // existing ?tab=financials link and bookmark still lands here.
              { id: 'financials',    label: '◉ Revenue'           },
              { id: 'subscriptions', label: '◎ Subscriptions'     },
              { id: 'products',      label: '▣ Products & Pricing' },
            ] as { id: Tab; label: string }[]).map(t => (
              <button
                key={t.id}
                className={`pa-tab${tab === t.id ? ' active' : ''}`}
                onClick={() => openTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
  )
}

export default function AdminPaymentsPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [data, setData] = useState<PaymentsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'admin_grant' | 'cancelled'>('all')

  // `/api/admin/payments` answers "who is on which plan", which only three of
  // the five tabs ask. The Landlords and Revenue tabs read
  // `/api/admin/financials` instead and used to sit behind this call anyway —
  // opening ?tab=landlords meant waiting out a subscriptions query, then a
  // seven-table financials scan, in series, before anything appeared.
  const load = useCallback(async () => {
    setLoading(true)
    // No `getCurrentUser()` first: the shell has already resolved the session,
    // and the route checks the admin role server side. All this bought was a
    // round trip in front of the data.
    const res = await fetch('/api/admin/payments')
    if (res.ok) setData(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { document.title = 'Payments — Admin | HomeHive' }, [])

  // Tabs live in the URL so ?tab=financials can be linked and bookmarked — the
  // money view is the one an admin returns to daily. Read on mount rather than
  // through useSearchParams, which would force this whole page into Suspense.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('tab')
    if (wanted && (TAB_IDS as string[]).includes(wanted))
      setTab(wanted as Tab)
  }, [])

  const openTab = (next: Tab) => {
    setTab(next)
    const url = next === 'overview' ? '/admin/payments' : `/admin/payments?tab=${next}`
    window.history.replaceState(null, '', url)
  }

  // Fetched for the tabs that read it, and only once — `loaded` guards against
  // a second trip when the admin comes back to one of those tabs.
  const loaded = useRef(false)
  useEffect(() => {
    if (!NEEDS_PLAN_DATA.has(tab) || loaded.current) return
    loaded.current = true
    load()
  }, [tab, load])

  // The two self-sufficient tabs render immediately, without waiting on — or
  // failing on — plan data they do not read.
  if (tab === 'landlords' || tab === 'financials') return (
    <>
      <style>{CSS}</style>
      <div className="pa-wrap">
        <PaymentsHeader tab={tab} openTab={openTab} />
        <div className="pa-content">
          {tab === 'landlords' ? <LandlordBooksTab /> : <FinancialsTab />}
        </div>
      </div>
    </>
  )

  if (loading) return (
    <div style={{ padding: 40, fontFamily: 'DM Sans, sans-serif', color: '#8e8e93', textAlign: 'center' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <div style={{ width: 24, height: 24, border: '2px solid #e5e5ea', borderTopColor: '#146b7d', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
      Loading payment data…
    </div>
  )

  if (!data) return <div style={{ padding: 40, color: '#8e8e93', fontFamily: 'DM Sans, sans-serif' }}>Failed to load payment data.</div>

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


  const UNLOCK_COLORS: Record<string, string> = {
    per_lead: '#0d7f82', subscription: '#0f7a43', free: '#8e8e93', plan: '#146b7d',
  }
  const UNLOCK_LABELS: Record<string, string> = {
    per_lead: `Per Lead (${planPriceLabel('per_lead')})`,
    subscription: 'Subscription unlock', free: 'Free (first lead)', plan: 'Plan',
  }

  const maxUnlocks = Math.max(...unlockTypeBreakdown.map(u => u.count), 1)

  return (
    <>
      <style>{CSS}</style>
      <div className="pa-wrap">

        <PaymentsHeader tab={tab} openTab={openTab} />

        <div className="pa-content">

          {/* The two money tabs — Financials (per landlord) and Revenue (the
              platform P&L) — are returned above this point, because they read
              /api/admin/financials rather than the plan data these tabs need
              and must not queue behind it. Both go through
              adminFinancialsClient, so moving between them is one scan, not
              one per switch. */}

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
                  color="#0f5663"
                />
                <KpiCard
                  label="ARR (Est.)"
                  value={fmt$(stats.mrr * 12)}
                  sub="MRR × 12"
                  color="#146b7d"
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
                  color="#0f7a43"
                />
                <KpiCard
                  label="Admin Grants"
                  value={String(stats.adminGrantCount)}
                  sub="Comped — no Stripe revenue"
                  color="#146b7d"
                />
                {/* The retired products only earn a tile when they actually
                    happened. A row of permanent zeroes for things we no longer
                    sell made the overview read as a failing business. */}
                {stats.lifetimePaidCount > 0 && (
                  <KpiCard
                    label="Lifetime (Legacy)"
                    value={String(stats.lifetimePaidCount)}
                    sub={`${fmt$(stats.lifetimePaidCount * planPriceCents('lifetime') / 100)} one-time`}
                    color="#b25000"
                  />
                )}
                {stats.perLeadPaidCount > 0 && (
                  <KpiCard
                    label="Per-Lead (Legacy)"
                    value={String(stats.perLeadPaidCount)}
                    sub={`${fmt$(stats.perLeadPaidCount * planPriceCents('per_lead') / 100)} — retired product`}
                    color="#0d7f82"
                  />
                )}
              </div>

              {/* Where the MRR comes from, tier by tier. The thing an admin
                  actually wants from this page: which rung of the ladder is
                  selling, priced at what we charge today. */}
              <div className="pa-card">
                <div className="pa-card-hdr">
                  <span className="pa-card-title">Live plans — what we charge today</span>
                  <span style={{ fontSize: 11, color: '#a1a1a6', fontFamily: 'DM Sans, sans-serif' }}>
                    Priced by property count
                  </span>
                </div>
                <div className="pa-card-body">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
                    {PLAN_ORDER.map(tier => {
                      const plan = PLANS[tier]
                      const row = planTypeBreakdown.find(p => p.plan_type === tier)
                      const active = row?.active ?? 0
                      const contribution = active * plan.priceCents / 100
                      return (
                        <div key={tier} style={{
                          border: '1px solid #e5e5ea', borderRadius: 10, padding: '12px 14px',
                          display: 'flex', flexDirection: 'column', gap: 2,
                          borderLeft: `3px solid ${PLAN_CHART_COLORS[tier]}`,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#1d1d1f', fontFamily: 'DM Sans, sans-serif' }}>
                              {plan.name}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: PLAN_CHART_COLORS[tier], fontFamily: 'DM Sans, sans-serif' }}>
                              {formatMonthly(plan.priceCents)}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: '#8e8e93', fontFamily: 'DM Sans, sans-serif' }}>
                            {formatPropertyLimit(plan.propertyLimit)}{' '}
                            {plan.propertyLimit === 1 ? 'property' : 'properties'}
                          </div>
                          <div style={{ marginTop: 6, fontSize: 20, fontWeight: 800, color: '#1d1d1f', fontFamily: 'DM Sans, sans-serif', letterSpacing: '-0.5px' }}>
                            {active}
                            <span style={{ fontSize: 11, fontWeight: 500, color: '#8e8e93', marginLeft: 6 }}>
                              active
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: '#8e8e93', fontFamily: 'DM Sans, sans-serif' }}>
                            {fmt$(contribution)} of MRR
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Charts row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, marginBottom: 16, alignItems: 'start' }}>
                {/* Revenue trend */}
                <div className="pa-card">
                  <div className="pa-card-hdr">
                    <span className="pa-card-title">Monthly Revenue (Est.) — last 12 months</span>
                    <span style={{ fontSize: 12, color: '#a1a1a6', fontFamily: 'DM Sans, sans-serif' }}>Supabase-derived</span>
                  </div>
                  <div className="pa-card-body">
                    <RevenueChart data={monthlyRevenue} />
                    <div style={{ marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      {monthlyRevenue.filter(m => m.revenue > 0).slice(-3).map(m => (
                        <div key={m.month} style={{ fontSize: 11, color: '#8e8e93', fontFamily: 'DM Sans, sans-serif' }}>
                          <span style={{ color: '#0f5663', fontWeight: 700 }}>{fmtMonth(m.month)}</span>
                          {' '}{fmt$(m.revenue)}
                          {m.newSubs > 0 && <span style={{ color: '#a1a1a6' }}> · {m.newSubs} new sub{m.newSubs !== 1 ? 's' : ''}</span>}
                        </div>
                      ))}
                      {monthlyRevenue.every(m => m.revenue === 0) && (
                        <span style={{ fontSize: 12, color: '#a1a1a6', fontFamily: 'DM Sans, sans-serif' }}>No paid transactions recorded yet</span>
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

              {/* Unlock breakdown — lead unlocks are a retired product, so this
                  card only exists for the accounts that have history in it. */}
              {unlockTypeBreakdown.some(u => u.count > 0) && (
              <div className="pa-card" style={{ marginBottom: 16 }}>
                <div className="pa-card-hdr">
                  <span className="pa-card-title">Unlock Type Breakdown</span>
                  <span style={{ fontSize: 11, color: '#a1a1a6', fontFamily: 'DM Sans, sans-serif' }}>Retired — history only</span>
                </div>
                <div className="pa-card-body">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 32px' }}>
                    {unlockTypeBreakdown.map(u => (
                      <div key={u.type} className="pa-breakdown-row">
                        <div style={{ fontSize: 12, color: '#6e6e73', fontFamily: 'DM Sans, sans-serif', minWidth: 130 }}>
                          {UNLOCK_LABELS[u.type] ?? u.type}
                        </div>
                        <div className="pa-bar-track">
                          <div className="pa-bar-fill" style={{ width: `${(u.count / maxUnlocks) * 100}%`, background: UNLOCK_COLORS[u.type] ?? '#a1a1a6' }} />
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1d1d1f', minWidth: 28, textAlign: 'right', fontFamily: 'DM Sans, sans-serif' }}>
                          {u.count}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              )}

              {/* Revenue mix summary */}
              <div className="pa-card" style={{ marginBottom: 16 }}>
                <div className="pa-card-hdr">
                  <span className="pa-card-title">Revenue Channel Mix</span>
                  <span style={{ fontSize: 11, color: '#a1a1a6', fontFamily: 'DM Sans, sans-serif' }}>Live tiers first, then history</span>
                </div>
                <div className="pa-card-body">
                  {(() => {
                    // Every channel priced from the one price list, live tiers
                    // in ladder order. A retired channel appears only if it
                    // ever earned anything: the mix should describe the
                    // business, not catalogue what we used to sell.
                    const liveChannels = PLAN_ORDER.map(tier => ({
                      label: `${PLANS[tier].name} subscriptions`,
                      count: planTypeBreakdown.find(p => p.plan_type === tier)?.active ?? 0,
                      price: PLANS[tier].priceCents / 100,
                      color: PLAN_CHART_COLORS[tier],
                      interval: '/mo',
                    }))
                    const legacyChannels = [
                      { label: 'Legacy — 1 listing',  count: planTypeBreakdown.find(p => p.plan_type === 'single_listing')?.active ?? 0, price: planPriceCents('single_listing') / 100, color: PLAN_CHART_COLORS.single_listing, interval: '/mo' },
                      { label: 'Legacy — 2 listings', count: planTypeBreakdown.find(p => p.plan_type === 'two_listing')?.active ?? 0,    price: planPriceCents('two_listing') / 100,    color: PLAN_CHART_COLORS.two_listing,    interval: '/mo' },
                      { label: 'Lifetime deals',      count: stats.lifetimePaidCount, price: planPriceCents('lifetime') / 100, color: PLAN_CHART_COLORS.lifetime, interval: ' once' },
                      { label: 'Per-lead unlocks',    count: stats.perLeadPaidCount,  price: planPriceCents('per_lead') / 100, color: PLAN_CHART_COLORS.per_lead, interval: ' each' },
                    ].filter(c => c.count > 0)
                    const channels = [...liveChannels, ...legacyChannels]
                    const totalRev = channels.reduce((s, c) => s + c.count * c.price, 0) || 1
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {channels.map(c => {
                          const rev = c.count * c.price
                          const pct = totalRev > 0 ? (rev / totalRev) * 100 : 0
                          return (
                            <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <div style={{ width: 10, height: 10, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                              <div style={{ fontSize: 12, color: '#6e6e73', fontFamily: 'DM Sans, sans-serif', minWidth: 180 }}>{c.label}</div>
                              <div style={{ flex: 1, height: 6, background: '#e5e5ea', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: c.color, borderRadius: 3, transition: 'width 0.4s' }} />
                              </div>
                              <div style={{ fontSize: 12, color: '#3a3a3c', fontWeight: 600, minWidth: 60, textAlign: 'right', fontFamily: 'DM Sans, sans-serif' }}>
                                {fmt$(rev)}
                              </div>
                              <div style={{ fontSize: 11, color: '#a1a1a6', minWidth: 80, fontFamily: 'DM Sans, sans-serif' }}>
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
                    <span style={{ fontSize: 11, color: '#a1a1a6', fontFamily: 'DM Sans, sans-serif' }}>{auditLog.length} entries</span>
                  </div>
                  <div className="pa-card-body" style={{ padding: '0 18px' }}>
                    {auditLog.slice(0, 10).map(entry => (
                      <div key={entry.id} className="pa-audit-row">
                        <div style={{
                          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                          background: entry.action === 'grant' ? 'rgba(20,107,125,0.18)' : 'rgba(142,142,147,0.18)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12,
                        }}>
                          {entry.action === 'grant' ? '↑' : '↓'}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: '#3a3a3c', fontFamily: 'DM Sans, sans-serif' }}>
                            <span style={{ color: entry.action === 'grant' ? '#0f5663' : '#8e8e93', fontWeight: 600 }}>
                              {entry.action === 'grant' ? 'Granted' : 'Revoked'}
                            </span>
                            {entry.to_plan_type && (
                              <> <span style={{ color: '#1d1d1f', fontWeight: 600 }}>{planLabel(entry.to_plan_type)}</span> plan</>
                            )}
                            {entry.from_plan_type && entry.action === 'revoke' && (
                              <> from <span style={{ color: '#6e6e73' }}>{planLabel(entry.from_plan_type)}</span></>
                            )}
                          </div>
                          {entry.note && <div style={{ fontSize: 11, color: '#a1a1a6', marginTop: 2, fontFamily: 'DM Sans, sans-serif' }}>Note: {entry.note}</div>}
                          <div style={{ fontSize: 10, color: '#a1a1a6', marginTop: 2, fontFamily: 'DM Sans, sans-serif' }}>
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
                  { label: 'Active paid', value: stats.activePaidCount, color: '#0f7a43' },
                  { label: 'Admin grants', value: stats.adminGrantCount, color: '#146b7d' },
                  { label: 'Cancelled', value: stats.cancelledCount, color: '#8e8e93' },
                  { label: 'Lifetime', value: stats.lifetimePaidCount, color: '#b25000' },
                ].map(s => (
                  <div key={s.label} style={{ background: '#ffffff', border: '1px solid #e5e5ea', borderRadius: 8, padding: '8px 16px', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: s.color ?? '#1d1d1f', fontFamily: 'DM Sans, sans-serif' }}>{s.value}</span>
                    <span style={{ fontSize: 11, color: '#8e8e93', fontFamily: 'DM Sans, sans-serif' }}>{s.label}</span>
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
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#a1a1a6', fontFamily: 'DM Sans, sans-serif' }}>
                  {filteredPlans.length} result{filteredPlans.length !== 1 ? 's' : ''}
                </span>
              </div>

              {filteredPlans.length === 0 ? (
                <div style={{ padding: '60px 20px', textAlign: 'center', color: '#a1a1a6', fontFamily: 'DM Sans, sans-serif', fontSize: 14 }}>
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
                        const tierColor = planColor(plan.plan_type)
                        return (
                          <tr key={plan.id}>
                            <td>
                              <div style={{ fontWeight: 600, fontSize: 13, color: '#1d1d1f' }}>
                                {plan.profile?.full_name || '—'}
                              </div>
                              <div style={{ fontSize: 11, color: '#8e8e93', marginTop: 1 }}>{plan.profile?.email}</div>
                            </td>
                            <td>
                              <span style={{ fontSize: 11, background: 'rgba(20,107,125,0.1)', color: '#0f5663', border: '1px solid rgba(20,107,125,0.2)', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>
                                {plan.profile?.role ?? '—'}
                              </span>
                            </td>
                            <td>
                              <span style={{ fontSize: 12, fontWeight: 700, color: tierColor }}>
                                {planLabel(plan.plan_type)}
                              </span>
                            </td>
                            <td>
                              <span className="pa-badge" style={{ color: st.color, background: st.bg, borderColor: st.border }}>
                                {st.label}
                              </span>
                            </td>
                            <td style={{ fontSize: 12, color: '#6e6e73' }}>{fmtDate(plan.created_at)}</td>
                            <td style={{ fontSize: 12, color: '#6e6e73' }}>
                              {plan.plan_type === 'lifetime' ? <span style={{ color: '#b25000', fontWeight: 600 }}>♾ Forever</span> : fmtDate(plan.current_period_end)}
                            </td>
                            <td>
                              {isAdminGrant(plan)
                                ? <span style={{ fontSize: 11, color: '#146b7d', fontWeight: 600 }}>Admin override</span>
                                : <span style={{ fontSize: 11, color: '#0f7a43', fontWeight: 600 }}>Stripe</span>
                              }
                            </td>
                            <td>
                              <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#a1a1a6' }}>
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
                <div style={{ fontSize: 13, color: '#8e8e93', fontFamily: 'DM Sans, sans-serif', lineHeight: 1.6, maxWidth: 680 }}>
                  One axis: how many properties a landlord may have live. Every tier is the
                  whole platform — paying more never unlocks a feature, only more doors.
                  These cards are generated from <span style={{ fontFamily: 'monospace', color: '#146b7d' }}>src/lib/landlordPlans.ts</span>,
                  which is the single source of truth: the Stripe catalogue, the database
                  limits, the pricing page and this screen all read it, so they cannot disagree.
                </div>
              </div>

              <div className="pa-product-grid">
                {LIVE_PRODUCTS.map(product => {
                  const active = planTypeBreakdown.find(p => p.plan_type === product.tier)?.active ?? 0
                  return (
                    <div key={product.tier} className="pa-product-card">
                      {/* Colour accent bar */}
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: product.color, borderRadius: '14px 14px 0 0' }} />

                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10, marginTop: 8 }}>
                        <div style={{ fontSize: 22 }}>{product.icon}</div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {product.highlight && (
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                              background: 'rgba(178,80,0,0.10)', color: '#b25000',
                              border: '1px solid rgba(178,80,0,0.25)', letterSpacing: '0.4px',
                              fontFamily: 'DM Sans, sans-serif',
                            }}>
                              MOST POPULAR
                            </span>
                          )}
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                            background: 'rgba(15,122,67,0.12)', color: '#0f7a43',
                            border: '1px solid rgba(15,122,67,0.25)', letterSpacing: '0.4px',
                            fontFamily: 'DM Sans, sans-serif',
                          }}>
                            LIVE
                          </span>
                        </div>
                      </div>

                      <div style={{ fontWeight: 700, fontSize: 16, color: '#1d1d1f', fontFamily: 'DM Sans, sans-serif', marginBottom: 4 }}>
                        {product.name}
                      </div>
                      <div style={{ fontSize: 12, color: '#8e8e93', fontFamily: 'DM Sans, sans-serif', lineHeight: 1.5, marginBottom: 14 }}>
                        {product.description}
                      </div>

                      {/* Price */}
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 14, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 28, fontWeight: 800, color: product.color, fontFamily: 'DM Sans, sans-serif', letterSpacing: '-0.5px' }}>
                          {product.priceLabel.split('/')[0]}
                        </span>
                        <span style={{ fontSize: 13, color: '#8e8e93', fontFamily: 'DM Sans, sans-serif' }}>/ month</span>
                        <span style={{ marginLeft: 6, fontSize: 11, background: 'rgba(15,122,67,0.1)', color: '#0f7a43', border: '1px solid rgba(15,122,67,0.3)', padding: '1px 7px', borderRadius: 20, fontWeight: 600, fontFamily: 'DM Sans, sans-serif' }}>
                          Subscription
                        </span>
                      </div>

                      {/* What it buys */}
                      <div style={{ borderTop: '1px solid #e5e5ea', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: '#a1a1a6', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, fontFamily: 'DM Sans, sans-serif' }}>Live properties</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#1d1d1f', fontFamily: 'DM Sans, sans-serif' }}>{product.propertyLimit}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: '#a1a1a6', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, fontFamily: 'DM Sans, sans-serif' }}>Who buys it</div>
                          <div style={{ fontSize: 11.5, color: '#6e6e73', fontFamily: 'DM Sans, sans-serif', lineHeight: 1.5 }}>{product.audience}</div>
                        </div>
                        {/* The identifier worth showing: a Stripe price is created
                            on first use from this key, so there is no price ID to
                            paste into an env var. Changing a price means a new key. */}
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: '#a1a1a6', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2, fontFamily: 'DM Sans, sans-serif' }}>Stripe lookup key</div>
                          <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#146b7d', wordBreak: 'break-all' }}>{product.lookupKey}</div>
                        </div>
                      </div>

                      {/* Usage counter */}
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e5e5ea', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11, color: '#8e8e93', fontFamily: 'DM Sans, sans-serif' }}>Active on platform</span>
                        <span style={{ fontSize: 15, fontWeight: 800, color: product.color, fontFamily: 'DM Sans, sans-serif' }}>
                          {active}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* What a landlord gets before paying anything. It is part of the
                  price list: the free ceiling is the top of the funnel, and an
                  admin answering "why is this landlord not paying?" needs it. */}
              <div className="pa-card">
                <div className="pa-card-hdr">
                  <span className="pa-card-title">Free, before any plan</span>
                  <span style={{ fontSize: 11, color: '#a1a1a6', fontFamily: 'DM Sans, sans-serif' }}>
                    Cap: {FREE_PROPERTY_LIMIT} properties
                  </span>
                </div>
                <div className="pa-card-body">
                  <div style={{ fontSize: 13, color: '#6e6e73', fontFamily: 'DM Sans, sans-serif', lineHeight: 1.65, maxWidth: 680 }}>
                    A landlord can sign up and build up to {FREE_PROPERTY_LIMIT} properties — the full
                    editor, photos, status and preview — without paying. What a plan buys is
                    <strong style={{ color: '#1d1d1f' }}> publishing</strong> those listings and every
                    other section of the portal: leads, screening, leases, rent collection,
                    maintenance and move-out.
                  </div>
                </div>
              </div>

              {/* Retired plans — the price list has a history, and revenue above
                  is computed from it, so it is stated rather than implied. */}
              <div className="pa-card" style={{ marginTop: 16 }}>
                <div className="pa-card-hdr">
                  <span className="pa-card-title">Retired — not for sale</span>
                  <span style={{ fontSize: 11, color: '#a1a1a6', fontFamily: 'DM Sans, sans-serif' }}>Existing rows keep what they paid for</span>
                </div>
                <div className="pa-card-body">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {RETIRED_PLAN_TYPES.map(pt => {
                      const row = planTypeBreakdown.find(p => p.plan_type === pt)
                      const held = pt === 'per_lead' ? stats.perLeadPaidCount : (row?.total ?? 0)
                      return (
                        <div key={pt} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: '1px solid #f0f0f2' }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: planColor(pt), flexShrink: 0 }} />
                          <div style={{ fontSize: 13, color: '#1d1d1f', fontFamily: 'DM Sans, sans-serif', minWidth: 150, fontWeight: 600 }}>
                            {planLabel(pt)}
                          </div>
                          <div style={{ fontSize: 12, color: '#8e8e93', fontFamily: 'DM Sans, sans-serif', flex: 1 }}>
                            {RETIRED_NOTES[pt]}
                          </div>
                          <div style={{ fontSize: 12, color: '#6e6e73', fontFamily: 'DM Sans, sans-serif', minWidth: 90, textAlign: 'right' }}>
                            {planPriceLabel(pt)}
                          </div>
                          <div style={{ fontSize: 12, color: held > 0 ? '#1d1d1f' : '#a1a1a6', fontWeight: held > 0 ? 700 : 400, fontFamily: 'DM Sans, sans-serif', minWidth: 70, textAlign: 'right' }}>
                            {held} held
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Stripe environment info */}
              <div className="pa-card" style={{ marginTop: 16 }}>
                <div className="pa-card-hdr"><span className="pa-card-title">Stripe Environment</span></div>
                <div className="pa-card-body">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
                    {[
                      { label: 'Account', value: 'FinityOne', sub: 'acct_1Fz9EmH0iOs5gSJc' },
                      { label: 'Price catalogue', value: 'By lookup key', sub: 'created on first checkout', color: '#146b7d' },
                      { label: 'Publishable key', value: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ? 'Set' : '⚠ Not set', sub: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', color: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ? '#0f7a43' : '#d13b30' },
                      { label: 'Webhooks', value: 'Dashboard-configured', sub: 'STRIPE_WEBHOOK_SECRET (server)', color: '#8e8e93' },
                    ].map(item => (
                      <div key={item.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#a1a1a6', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'DM Sans, sans-serif' }}>{item.label}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: item.color ?? '#1d1d1f', fontFamily: 'DM Sans, sans-serif' }}>{item.value}</div>
                        <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#a1a1a6' }}>{item.sub}</div>
                      </div>
                    ))}
                  </div>
                  {/* Server-only secrets cannot be read from a client component,
                      so this page does not claim to know whether the webhook
                      secret is set. It used to assert "⚠ Not set" unconditionally
                      — a permanent false alarm on a working integration. */}
                  <div style={{ marginTop: 16, fontSize: 12, color: '#8e8e93', fontFamily: 'DM Sans, sans-serif', lineHeight: 1.6 }}>
                    Webhook delivery is verified in the{' '}
                    <a href="https://dashboard.stripe.com/webhooks" target="_blank" rel="noopener noreferrer" style={{ color: '#146b7d' }}>Stripe Dashboard</a>
                    {' '}— server secrets are not readable from this screen.
                  </div>
                </div>
              </div>

              {/* Revenue model summary */}
              <div className="pa-card" style={{ marginTop: 16 }}>
                <div className="pa-card-hdr"><span className="pa-card-title">Revenue Model Summary</span></div>
                <div className="pa-card-body">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[
                      ...PLAN_ORDER.map(tier => ({
                        icon: TIER_ICON[tier],
                        name: PLANS[tier].name,
                        model: `Monthly subscription — ${formatPropertyLimit(PLANS[tier].propertyLimit).toLowerCase()} ${PLANS[tier].propertyLimit === 1 ? 'property' : 'properties'}`,
                        price: formatMonthly(PLANS[tier].priceCents),
                        note: PLANS[tier].audience,
                        color: PLAN_CHART_COLORS[tier],
                      })),
                      {
                        icon: '🗄', name: 'Retired plans',
                        model: 'Per-lead unlocks, legacy listing plans, lifetime deals',
                        price: '—',
                        note: 'No longer sold; existing rows still counted in revenue above',
                        color: '#8e8e93',
                      },
                    ].map(r => (
                      <div key={r.name} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid #e5e5ea' }}>
                        <div style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>{r.icon}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: r.color, fontFamily: 'DM Sans, sans-serif' }}>{r.name}</div>
                          <div style={{ fontSize: 12, color: '#6e6e73', fontFamily: 'DM Sans, sans-serif', marginTop: 2 }}>{r.model}</div>
                          <div style={{ fontSize: 11, color: '#a1a1a6', fontFamily: 'DM Sans, sans-serif', marginTop: 3, fontStyle: 'italic' }}>{r.note}</div>
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
