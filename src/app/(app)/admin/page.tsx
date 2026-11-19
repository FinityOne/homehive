'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { supabase } from '@/lib/supabase'
import type { OverviewData } from '@/lib/adminOverview'

// d3 is the heaviest thing in the admin portal and nothing above the fold
// needs it, so the charts arrive as their own chunk after the page has already
// painted its tiles. `ssr: false` because every one of them draws by measuring
// a DOM node it owns.
// Reserves the chart's height while its chunk loads, so the tiles above do
// not jump once it arrives.
function chartFallback(h: number) {
  const ChartPlaceholder = () => <div style={{ height: h }} />
  ChartPlaceholder.displayName = `ChartPlaceholder(${h})`
  return ChartPlaceholder
}
const LeadVolumeChart = dynamic(() => import('./OverviewCharts').then(m => m.LeadVolumeChart), { ssr: false, loading: chartFallback(180) })
const LeadFunnelChart = dynamic(() => import('./OverviewCharts').then(m => m.LeadFunnelChart), { ssr: false, loading: chartFallback(180) })
const ListingStatusDonut = dynamic(() => import('./OverviewCharts').then(m => m.ListingStatusDonut), { ssr: false, loading: chartFallback(180) })
const PlatformGrowthChart = dynamic(() => import('./OverviewCharts').then(m => m.PlatformGrowthChart), { ssr: false, loading: chartFallback(160) })

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function AdminOverview() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/overview')
      if (res.ok) setData(await res.json() as OverviewData)
    } catch { /* leave the last good charts up rather than blanking them */ }
    setLoading(false)
  }, [])

  useEffect(() => { document.title = 'Overview — Admin | HomeHive' }, [])

  // Realtime, with a brake on it.
  //
  // This page is subscribed to *every* change on leads and properties, and
  // each one used to re-run the whole fetch. A single lead moving through five
  // statuses meant five rebuilds; a bulk import meant one per row. The charts
  // are 30-day aggregates — none of them can visibly change faster than this
  // — so changes are collected and acted on once, five seconds after the last
  // one lands.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    // No `getCurrentUser()` call here: the shell has already resolved who this
    // is, and /api/admin/overview re-checks the admin role server side. The
    // extra round trip only delayed the charts.
    fetchData()

    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(fetchData, 5000)
    }

    const ch = supabase.channel('admin-overview')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'properties' }, scheduleRefresh)
      .subscribe()

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      supabase.removeChannel(ch)
    }
  }, [fetchData])

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
            {data.stats.pendingListings > 0 && (
              <Link href="/admin/properties?status=pending" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: '10px', padding: '14px 20px', marginBottom: '16px', textDecoration: 'none', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ fontSize: '22px' }}>⏳</div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#92400e' }}>{data.stats.pendingListings} listing{data.stats.pendingListings !== 1 ? 's' : ''} pending review</div>
                    <div style={{ fontSize: '12px', color: '#b45309', marginTop: '1px' }}>Click to review and approve or reject</div>
                  </div>
                </div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#92400e' }}>Review now →</div>
              </Link>
            )}

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
