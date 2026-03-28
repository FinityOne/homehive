'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import * as d3 from 'd3'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getAllPropertiesForAdmin } from '@/lib/properties'
import type { Property, AdminStatus } from '@/lib/properties'
import type { Lead } from '@/lib/leads'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── TYPES ────────────────────────────────────────────────────────────────────
type OverviewData = {
  stats: { totalLeads: number; activeProperties: number; thisWeekLeads: number; conversionRate: number }
  leadVolume: Array<{ day: string; count: number }>
  funnelData: Array<{ status: string; label: string; count: number; color: string }>
  statusDist: Array<{ status: string; label: string; count: number; color: string }>
  growthData: Array<{ date: Date; properties: number; leads: number }>
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const LEAD_STATUS_CONFIG: Record<Lead['status'], { label: string; color: string }> = {
  new:            { label: 'New',            color: '#1d4ed8' },
  contacted:      { label: 'Contacted',      color: '#c9973a' },
  engaged:        { label: 'Engaged',        color: '#7c3aed' },
  qualified:      { label: 'Qualified',      color: '#166534' },
  tour_scheduled: { label: 'Tour Scheduled', color: '#0e7490' },
  closed:         { label: 'Closed',         color: '#8C1D40' },
}

const ADMIN_STATUS_CFG: Record<AdminStatus, { label: string; color: string }> = {
  active:   { label: 'Active',   color: '#166534' },
  pending:  { label: 'Pending',  color: '#c9973a' },
  inactive: { label: 'Inactive', color: '#9b9b9b' },
  test:     { label: 'Test',     color: '#7c3aed' },
  flagged:  { label: 'Flagged',  color: '#dc2626' },
}

// ─── HELPER ───────────────────────────────────────────────────────────────────
function buildOverviewData(leads: Lead[], properties: Property[]): OverviewData {
  const now = Date.now()
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000

  const activeProperties = properties.filter(p => p.admin_status === 'active' && !p.is_test).length
  const thisWeekLeads = leads.filter(l => l.created_at && new Date(l.created_at).getTime() > oneWeekAgo).length
  const closedLeads = leads.filter(l => l.status === 'closed' && l.closed_reason === 'leased').length
  const conversionRate = leads.length > 0 ? Math.round((closedLeads / leads.length) * 100) : 0

  // Lead volume — last 30 days by day
  const volumeMap = new Map<string, number>()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000)
    volumeMap.set(d.toISOString().slice(0, 10), 0)
  }
  for (const l of leads) {
    if (!l.created_at) continue
    const day = l.created_at.slice(0, 10)
    if (volumeMap.has(day)) volumeMap.set(day, (volumeMap.get(day) ?? 0) + 1)
  }
  const leadVolume = Array.from(volumeMap.entries()).map(([day, count]) => ({ day, count }))

  // Funnel
  const funnelData = (Object.keys(LEAD_STATUS_CONFIG) as Lead['status'][]).map(s => ({
    status: s,
    label: LEAD_STATUS_CONFIG[s].label,
    count: leads.filter(l => l.status === s).length,
    color: LEAD_STATUS_CONFIG[s].color,
  }))

  // Property status distribution
  const statusDist = (Object.keys(ADMIN_STATUS_CFG) as AdminStatus[]).map(s => ({
    status: s,
    label: ADMIN_STATUS_CFG[s].label,
    count: properties.filter(p => p.admin_status === s).length,
    color: ADMIN_STATUS_CFG[s].color,
  })).filter(d => d.count > 0)

  // Platform growth — cumulative
  const events: Array<{ date: Date; type: 'property' | 'lead' }> = []
  for (const p of properties) if (p.created_at) events.push({ date: new Date(p.created_at), type: 'property' })
  for (const l of leads) if (l.created_at) events.push({ date: new Date(l.created_at), type: 'lead' })
  events.sort((a, b) => a.date.getTime() - b.date.getTime())
  let cumProps = 0, cumLeads = 0
  const growthData: OverviewData['growthData'] = []
  for (const e of events) {
    if (e.type === 'property') cumProps++; else cumLeads++
    growthData.push({ date: e.date, properties: cumProps, leads: cumLeads })
  }

  return { stats: { totalLeads: leads.length, activeProperties, thisWeekLeads, conversionRate }, leadVolume, funnelData, statusDist, growthData }
}

// ─── D3: LEAD VOLUME BAR ─────────────────────────────────────────────────────
function LeadVolumeChart({ data }: { data: Array<{ day: string; count: number }> }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || data.length === 0) return
    const draw = () => {
      const svg = d3.select(svgRef.current!)
      svg.selectAll('*').remove()
      const W0 = containerRef.current!.clientWidth || 400
      const height = 180, margin = { top: 14, right: 12, bottom: 36, left: 32 }
      const W = W0 - margin.left - margin.right, H = height - margin.top - margin.bottom
      const g = svg.attr('width', W0).attr('height', height).append('g').attr('transform', `translate(${margin.left},${margin.top})`)
      const x = d3.scaleBand().domain(data.map(d => d.day)).range([0, W]).padding(0.25)
      const y = d3.scaleLinear().domain([0, Math.max(d3.max(data, d => d.count) ?? 1, 1)]).nice().range([H, 0])
      g.append('g').call(d3.axisLeft(y).ticks(4).tickSize(-W).tickFormat(() => ''))
        .call(gg => { gg.select('.domain').remove(); gg.selectAll('line').attr('stroke', '#f0ede6') })
      g.selectAll('.bar').data(data).join('rect').attr('class', 'bar')
        .attr('x', d => x(d.day) ?? 0).attr('y', d => y(d.count))
        .attr('width', x.bandwidth()).attr('height', d => H - y(d.count))
        .attr('fill', '#8C1D40').attr('opacity', 0.82).attr('rx', 2)
      g.append('g').attr('transform', `translate(0,${H})`).call(
        d3.axisBottom(x).tickValues(data.filter((_, i) => i % 5 === 0 || i === data.length - 1).map(d => d.day))
          .tickFormat(d => { const [, m, day] = (d as string).split('-'); return `${parseInt(m)}/${parseInt(day)}` })
      ).call(gg => {
        gg.select('.domain').attr('stroke', '#e8e4db')
        gg.selectAll('line').attr('stroke', '#e8e4db')
        gg.selectAll('text').attr('fill', '#9b9b9b').style('font-size', '10px').style('font-family', 'DM Sans, sans-serif')
      })
      g.append('g').call(d3.axisLeft(y).ticks(4))
        .call(gg => { gg.select('.domain').remove(); gg.selectAll('line').remove(); gg.selectAll('text').attr('fill', '#9b9b9b').style('font-size', '10px').style('font-family', 'DM Sans, sans-serif') })
    }
    draw()
    const ro = new ResizeObserver(draw); ro.observe(containerRef.current!); return () => ro.disconnect()
  }, [data])

  return <div ref={containerRef} style={{ width: '100%' }}><svg ref={svgRef} style={{ display: 'block' }} /></div>
}

// ─── D3: LEAD FUNNEL ─────────────────────────────────────────────────────────
function LeadFunnelChart({ data }: { data: Array<{ status: string; label: string; count: number; color: string }> }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return
    const draw = () => {
      const svg = d3.select(svgRef.current!); svg.selectAll('*').remove()
      const W0 = containerRef.current!.clientWidth || 320
      const rowH = 34, margin = { top: 8, right: 40, bottom: 8, left: 108 }
      const W = W0 - margin.left - margin.right
      const height = data.length * rowH + margin.top + margin.bottom
      const maxCount = Math.max(d3.max(data, d => d.count) ?? 1, 1)
      const x = d3.scaleLinear().domain([0, maxCount]).range([0, W])
      svg.attr('width', W0).attr('height', height)
      const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
      data.forEach((d, i) => {
        const y = i * rowH + rowH / 2 - 9
        g.append('rect').attr('x', 0).attr('y', y).attr('width', W).attr('height', 18).attr('fill', '#faf9f6').attr('rx', 3)
        if (x(d.count) > 0) g.append('rect').attr('x', 0).attr('y', y).attr('width', x(d.count)).attr('height', 18).attr('fill', d.color).attr('opacity', 0.18).attr('rx', 3)
        g.append('text').attr('x', -8).attr('y', y + 12).attr('text-anchor', 'end').attr('fill', '#6b6b6b').style('font-size', '11px').style('font-family', 'DM Sans, sans-serif').style('font-weight', '500').text(d.label)
        g.append('text').attr('x', W + 6).attr('y', y + 12).attr('text-anchor', 'start').attr('fill', d.count > 0 ? d.color : '#c5c1b8').style('font-size', '11px').style('font-family', 'DM Sans, sans-serif').style('font-weight', '700').text(d.count)
      })
    }
    draw()
    const ro = new ResizeObserver(draw); ro.observe(containerRef.current!); return () => ro.disconnect()
  }, [data])

  return <div ref={containerRef} style={{ width: '100%' }}><svg ref={svgRef} style={{ display: 'block' }} /></div>
}

// ─── D3: STATUS DONUT ────────────────────────────────────────────────────────
function ListingStatusDonut({ data }: { data: Array<{ status: string; label: string; count: number; color: string }> }) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return
    const svg = d3.select(svgRef.current); svg.selectAll('*').remove()
    const size = 160, r = size / 2 - 8, innerR = r * 0.52
    const total = d3.sum(data, d => d.count)
    svg.attr('width', size).attr('height', size)
    const g = svg.append('g').attr('transform', `translate(${size / 2},${size / 2})`)
    const pie = d3.pie<typeof data[0]>().value(d => d.count).sort(null)
    const arc = d3.arc<d3.PieArcDatum<typeof data[0]>>().innerRadius(innerR).outerRadius(r)
    g.selectAll('path').data(pie(data)).join('path')
      .attr('d', arc).attr('fill', d => d.data.color).attr('stroke', '#fff').attr('stroke-width', 2)
    g.append('text').attr('text-anchor', 'middle').attr('dy', '-0.2em')
      .style('font-family', 'Fraunces, serif').style('font-size', '26px').style('font-weight', '300').style('fill', '#1a1a1a').text(total)
    g.append('text').attr('text-anchor', 'middle').attr('dy', '1.3em')
      .style('font-family', 'DM Sans, sans-serif').style('font-size', '10px').style('fill', '#9b9b9b').style('text-transform', 'uppercase').style('letter-spacing', '0.5px').text('listings')
  }, [data])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
      <svg ref={svgRef} style={{ display: 'block' }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', justifyContent: 'center' }}>
        {data.map(d => (
          <div key={d.status} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: d.color, flexShrink: 0 }} />
            <span style={{ fontSize: '11px', color: '#6b6b6b', fontFamily: 'DM Sans, sans-serif' }}>{d.label} <strong style={{ color: '#1a1a1a' }}>{d.count}</strong></span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── D3: PLATFORM GROWTH ─────────────────────────────────────────────────────
function PlatformGrowthChart({ data }: { data: Array<{ date: Date; properties: number; leads: number }> }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || data.length < 2) return
    const draw = () => {
      const svg = d3.select(svgRef.current!); svg.selectAll('*').remove()
      const W0 = containerRef.current!.clientWidth || 400
      const height = 160, margin = { top: 12, right: 16, bottom: 28, left: 32 }
      const W = W0 - margin.left - margin.right, H = height - margin.top - margin.bottom
      const g = svg.attr('width', W0).attr('height', height).append('g').attr('transform', `translate(${margin.left},${margin.top})`)
      const x = d3.scaleTime().domain(d3.extent(data, d => d.date) as [Date, Date]).range([0, W])
      const maxY = Math.max(d3.max(data, d => d.leads) ?? 1, d3.max(data, d => d.properties) ?? 1, 1)
      const y = d3.scaleLinear().domain([0, maxY]).nice().range([H, 0])
      g.append('g').call(d3.axisLeft(y).ticks(4).tickSize(-W).tickFormat(() => ''))
        .call(gg => { gg.select('.domain').remove(); gg.selectAll('line').attr('stroke', '#f0ede6') })
      const areaLeads = d3.area<typeof data[0]>().x(d => x(d.date)).y0(H).y1(d => y(d.leads)).curve(d3.curveMonotoneX)
      const areaProps = d3.area<typeof data[0]>().x(d => x(d.date)).y0(H).y1(d => y(d.properties)).curve(d3.curveMonotoneX)
      g.append('path').datum(data).attr('fill', '#8C1D40').attr('opacity', 0.12).attr('d', areaLeads)
      g.append('path').datum(data).attr('fill', '#a78bfa').attr('opacity', 0.14).attr('d', areaProps)
      const lineLeads = d3.line<typeof data[0]>().x(d => x(d.date)).y(d => y(d.leads)).curve(d3.curveMonotoneX)
      const lineProps = d3.line<typeof data[0]>().x(d => x(d.date)).y(d => y(d.properties)).curve(d3.curveMonotoneX)
      g.append('path').datum(data).attr('fill', 'none').attr('stroke', '#8C1D40').attr('stroke-width', 1.8).attr('d', lineLeads)
      g.append('path').datum(data).attr('fill', 'none').attr('stroke', '#a78bfa').attr('stroke-width', 1.8).attr('d', lineProps)
      g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(x).ticks(4))
        .call(gg => { gg.select('.domain').attr('stroke', '#e8e4db'); gg.selectAll('line').attr('stroke', '#e8e4db'); gg.selectAll('text').attr('fill', '#9b9b9b').style('font-size', '10px').style('font-family', 'DM Sans, sans-serif') })
      g.append('g').call(d3.axisLeft(y).ticks(4))
        .call(gg => { gg.select('.domain').remove(); gg.selectAll('line').remove(); gg.selectAll('text').attr('fill', '#9b9b9b').style('font-size', '10px').style('font-family', 'DM Sans, sans-serif') })
    }
    draw()
    const ro = new ResizeObserver(draw); ro.observe(containerRef.current!); return () => ro.disconnect()
  }, [data])

  return (
    <div>
      <div ref={containerRef} style={{ width: '100%' }}><svg ref={svgRef} style={{ display: 'block' }} /></div>
      <div style={{ display: 'flex', gap: '16px', marginTop: '8px', justifyContent: 'center' }}>
        {[{ color: '#8C1D40', label: 'Leads' }, { color: '#a78bfa', label: 'Properties' }].map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: '20px', height: '2px', background: s.color, borderRadius: '1px' }} />
            <span style={{ fontSize: '11px', color: '#6b6b6b', fontFamily: 'DM Sans, sans-serif' }}>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function AdminOverview() {
  const router = useRouter()
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const [leadsRes, propsData] = await Promise.all([
      supabase.from('leads').select('id, created_at, status, closed_reason, property').order('created_at', { ascending: false }),
      getAllPropertiesForAdmin(),
    ])
    const leads = (leadsRes.data ?? []) as Lead[]
    setData(buildOverviewData(leads, propsData))
    setLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (!data.user) router.push('/login') })
    fetchData()
    const ch = supabase.channel('admin-overview')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'properties' }, fetchData)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [fetchData, router])

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .ov-body { max-width: 1200px; margin: 0 auto; padding: 28px 24px 80px; font-family: 'DM Sans', sans-serif; }
        .ov-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
        .ov-stat { background: #fff; border: 1px solid #e8e4db; border-radius: 12px; padding: 18px 20px; }
        .ov-stat-label { font-size: 11px; font-weight: 600; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 6px; }
        .ov-stat-num { font-family: 'Fraunces', serif; font-size: 32px; font-weight: 300; color: #1a1a1a; letter-spacing: -1px; line-height: 1; }
        .ov-stat-sub { font-size: 11px; color: #9b9b9b; margin-top: 4px; }
        .ov-charts-row { display: flex; gap: 14px; margin-bottom: 14px; }
        .ov-chart { background: #fff; border: 1px solid #e8e4db; border-radius: 12px; padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
        .ov-chart-head { display: flex; align-items: baseline; gap: 8px; }
        .ov-chart-title { font-size: 13px; font-weight: 600; color: #1a1a1a; }
        .ov-chart-sub { font-size: 11px; color: #9b9b9b; }
        @media (max-width: 900px) {
          .ov-stats { grid-template-columns: 1fr 1fr; }
          .ov-charts-row { flex-direction: column; }
        }
        @media (max-width: 600px) { .ov-body { padding: 20px 16px; } }
      `}</style>

      <div className="ov-body">
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: '28px', fontWeight: 300, color: '#1a1a1a', letterSpacing: '-0.5px', marginBottom: '4px' }}>Overview</h1>
          <p style={{ fontSize: '13px', color: '#9b9b9b' }}>Platform metrics · Real-time</p>
        </div>

        {loading || !data ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#9b9b9b', fontSize: '14px' }}>Loading...</div>
        ) : (
          <>
            <div className="ov-stats">
              {[
                { label: 'Total leads',     value: data.stats.totalLeads,       sub: 'All time' },
                { label: 'Active listings', value: data.stats.activeProperties,  sub: 'Non-test, public' },
                { label: 'Leads this week', value: data.stats.thisWeekLeads,     sub: 'Last 7 days' },
                { label: 'Conversion rate', value: `${data.stats.conversionRate}%`, sub: 'Leads → leased' },
              ].map(c => (
                <div key={c.label} className="ov-stat">
                  <div className="ov-stat-label">{c.label}</div>
                  <div className="ov-stat-num">{c.value}</div>
                  <div className="ov-stat-sub">{c.sub}</div>
                </div>
              ))}
            </div>

            <div className="ov-charts-row">
              <div className="ov-chart" style={{ flex: 3 }}>
                <div className="ov-chart-head"><div className="ov-chart-title">Lead volume</div><div className="ov-chart-sub">Last 30 days</div></div>
                <LeadVolumeChart data={data.leadVolume} />
              </div>
              <div className="ov-chart" style={{ flex: 2 }}>
                <div className="ov-chart-head"><div className="ov-chart-title">Lead pipeline</div><div className="ov-chart-sub">By stage</div></div>
                <LeadFunnelChart data={data.funnelData} />
              </div>
            </div>

            <div className="ov-charts-row">
              <div className="ov-chart" style={{ flex: 1, alignItems: 'center' }}>
                <div className="ov-chart-head" style={{ width: '100%' }}><div className="ov-chart-title">Listing status</div><div className="ov-chart-sub">Distribution</div></div>
                <ListingStatusDonut data={data.statusDist} />
              </div>
              <div className="ov-chart" style={{ flex: 2 }}>
                <div className="ov-chart-head"><div className="ov-chart-title">Platform growth</div><div className="ov-chart-sub">Cumulative all time</div></div>
                <PlatformGrowthChart data={data.growthData} />
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
