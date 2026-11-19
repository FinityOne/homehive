'use client'

// The overview's four d3 charts.
//
// They live in their own module so that `d3` — comfortably the largest
// dependency in the admin portal — is a lazy chunk rather than part of the
// bundle that has to arrive before /admin can paint anything at all. The page
// imports this with `next/dynamic`, so the stat tiles and the pending-review
// banner render on the first frame and the charts fill in behind them.
//
// The drawing code is unchanged. The one difference is `PlatformGrowthChart`,
// which now takes ISO day strings (the series crosses JSON from
// /api/admin/overview) and parses them here.

import { useEffect, useRef } from 'react'
import * as d3 from 'd3'

// ─── D3: LEAD VOLUME BAR ─────────────────────────────────────────────────────
export function LeadVolumeChart({ data }: { data: Array<{ day: string; count: number }> }) {
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
        .attr('fill', '#146b7d').attr('opacity', 0.82).attr('rx', 2)
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
export function LeadFunnelChart({ data }: { data: Array<{ status: string; label: string; count: number; color: string }> }) {
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
export function ListingStatusDonut({ data }: { data: Array<{ status: string; label: string; count: number; color: string }> }) {
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
export function PlatformGrowthChart({ data: raw }: { data: Array<{ date: string; properties: number; leads: number }> }) {
  // One Date per point, built once per render rather than inside every d3
  // accessor call.
  const data = raw.map(d => ({ ...d, date: new Date(d.date + 'T12:00:00') }))
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
      g.append('path').datum(data).attr('fill', '#146b7d').attr('opacity', 0.12).attr('d', areaLeads)
      g.append('path').datum(data).attr('fill', '#b4792b').attr('opacity', 0.14).attr('d', areaProps)
      const lineLeads = d3.line<typeof data[0]>().x(d => x(d.date)).y(d => y(d.leads)).curve(d3.curveMonotoneX)
      const lineProps = d3.line<typeof data[0]>().x(d => x(d.date)).y(d => y(d.properties)).curve(d3.curveMonotoneX)
      g.append('path').datum(data).attr('fill', 'none').attr('stroke', '#146b7d').attr('stroke-width', 1.8).attr('d', lineLeads)
      g.append('path').datum(data).attr('fill', 'none').attr('stroke', '#b4792b').attr('stroke-width', 1.8).attr('d', lineProps)
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
        {[{ color: '#146b7d', label: 'Leads' }, { color: '#b4792b', label: 'Properties' }].map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: '20px', height: '2px', background: s.color, borderRadius: '1px' }} />
            <span style={{ fontSize: '11px', color: '#6b6b6b', fontFamily: 'DM Sans, sans-serif' }}>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

