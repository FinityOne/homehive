'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Lead = {
  id: string
  created_at: string
  first_name: string | null
  email: string
  property: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  landing_page: string | null
  device_type: string | null
}

type PageView = {
  property_slug: string | null
  utm_source: string | null
  utm_campaign: string | null
  created_at: string
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = key(item) || '(direct)'
    acc[k] = [...(acc[k] || []), item]
    return acc
  }, {} as Record<string, T[]>)
}

export default function MarketingDashboard() {
  const router = useRouter()
  const [leads, setLeads] = useState<Lead[]>([])
  const [pageViews, setPageViews] = useState<PageView[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('30d')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
    const since = new Date(Date.now() - days * 86400000).toISOString()

    Promise.all([
      supabase
        .from('leads')
        .select('id, created_at, first_name, email, property, utm_source, utm_medium, utm_campaign, utm_content, landing_page, device_type')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('property_page_views')
        .select('property_slug, utm_source, utm_campaign, created_at')
        .gte('created_at', since)
        .limit(2000),
    ]).then(([leadsRes, pvRes]) => {
      setLeads((leadsRes.data || []) as Lead[])
      setPageViews((pvRes.data || []) as PageView[])
      setLoading(false)
    })
  }, [range])

  // ── Derived stats ──────────────────────────────────────────────────────────
  const adLeads     = leads.filter(l => l.utm_source)
  const directLeads = leads.filter(l => !l.utm_source)

  const bySource   = groupBy(leads, l => l.utm_source || '(direct)')
  const byCampaign = groupBy(adLeads, l => l.utm_campaign || '(none)')
  const byProperty = groupBy(leads, l => l.property || '(unknown)')
  const pvBySlug   = groupBy(pageViews, v => v.property_slug || '(unknown)')

  const topSources   = Object.entries(bySource).sort((a, b) => b[1].length - a[1].length).slice(0, 6)
  const topCampaigns = Object.entries(byCampaign).sort((a, b) => b[1].length - a[1].length).slice(0, 8)
  const topProperties = Object.entries(byProperty)
    .map(([slug, lList]) => {
      const views = pvBySlug[slug]?.length || 0
      const convRate = views > 0 ? ((lList.length / views) * 100).toFixed(1) : '—'
      return { slug, leads: lList.length, views, convRate }
    })
    .sort((a, b) => b.leads - a.leads)
    .slice(0, 8)

  const overallConv = pageViews.length > 0
    ? ((leads.length / pageViews.length) * 100).toFixed(1)
    : '—'

  const SOURCE_COLORS: Record<string, string> = {
    facebook: '#1877f2', instagram: '#e1306c', google: '#4285f4',
    tiktok: '#010101', email: '#059669', organic: '#6366f1', '(direct)': '#6b7280',
  }
  function sourceColor(s: string) {
    const low = s.toLowerCase()
    for (const [k, v] of Object.entries(SOURCE_COLORS)) if (low.includes(k)) return v
    return '#8b5cf6'
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        .mkt { font-family: 'Geist', system-ui, sans-serif; background: #f8f7f4; min-height: 100vh; padding: 32px 28px; }
        .mkt-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; flex-wrap: wrap; gap: 12px; }
        .mkt-title { font-size: 22px; font-weight: 600; color: #1a1a1a; letter-spacing: -0.4px; }
        .mkt-range { display: flex; gap: 6px; }
        .mkt-range-btn { font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 20px; border: 1.5px solid #e8e5de; background: #fff; color: #6b6b6b; cursor: pointer; transition: all 0.15s; }
        .mkt-range-btn.active { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }

        /* Stat cards */
        .mkt-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 24px; }
        .stat-card { background: #fff; border: 1px solid #e8e5de; border-radius: 14px; padding: 20px 22px; }
        .stat-label { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #9b9b9b; margin-bottom: 10px; }
        .stat-num { font-size: 32px; font-weight: 300; color: #1a1a1a; letter-spacing: -1.5px; line-height: 1; margin-bottom: 6px; }
        .stat-sub { font-size: 12px; color: #9b9b9b; }
        .stat-accent { color: #D9A14A; }

        /* Grid layout */
        .mkt-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 18px; }
        .mkt-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 18px; margin-bottom: 18px; }
        .mkt-panel { background: #fff; border: 1px solid #e8e5de; border-radius: 14px; padding: 22px; }
        .panel-title { font-size: 13px; font-weight: 600; color: #1a1a1a; margin-bottom: 18px; letter-spacing: -0.2px; }

        /* Bar chart rows */
        .bar-row { margin-bottom: 14px; }
        .bar-label-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }
        .bar-label { font-size: 12px; color: #3a3a3a; font-weight: 500; }
        .bar-count { font-size: 12px; color: #9b9b9b; font-weight: 600; }
        .bar-track { height: 6px; background: #f0ede6; border-radius: 100px; overflow: hidden; }
        .bar-fill { height: 100%; border-radius: 100px; transition: width 0.5s ease; }

        /* Source pill */
        .src-pill { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 20px; }
        .src-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

        /* Table */
        .mkt-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .mkt-table th { text-align: left; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #9b9b9b; padding: 0 0 10px; border-bottom: 1px solid #f0ede6; }
        .mkt-table td { padding: 11px 0; border-bottom: 1px solid #f8f6f2; color: #3a3a3a; vertical-align: middle; }
        .mkt-table tr:last-child td { border-bottom: none; }
        .td-mono { font-family: 'Geist Mono', monospace; font-size: 11px; color: #9b9b9b; }

        /* Device split */
        .device-split { display: flex; gap: 16px; }
        .device-item { flex: 1; background: #f8f7f4; border-radius: 10px; padding: 14px 16px; text-align: center; }
        .device-pct { font-size: 24px; font-weight: 300; color: #1a1a1a; letter-spacing: -1px; }
        .device-label { font-size: 11px; color: #9b9b9b; margin-top: 3px; font-weight: 500; }

        @media (max-width: 900px) {
          .mkt-stats { grid-template-columns: repeat(2, 1fr); }
          .mkt-grid, .mkt-grid-3 { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="mkt">
        <div className="mkt-header">
          <div className="mkt-title">Marketing Attribution</div>
          <div className="mkt-range">
            {(['7d', '30d', '90d'] as const).map(r => (
              <button key={r} className={`mkt-range-btn${range === r ? ' active' : ''}`} onClick={() => setRange(r)}>
                {r === '7d' ? '7 days' : r === '30d' ? '30 days' : '90 days'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#9b9b9b', fontSize: '14px' }}>Loading attribution data…</div>
        ) : (
          <>
            {/* ── Stat cards ── */}
            <div className="mkt-stats">
              <div className="stat-card">
                <div className="stat-label">Total Leads</div>
                <div className="stat-num">{leads.length}</div>
                <div className="stat-sub">{adLeads.length} from ads · {directLeads.length} direct</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Ad Leads</div>
                <div className="stat-num stat-accent">{adLeads.length}</div>
                <div className="stat-sub">{leads.length > 0 ? ((adLeads.length / leads.length) * 100).toFixed(0) : 0}% of total</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Page Views</div>
                <div className="stat-num">{pageViews.length.toLocaleString()}</div>
                <div className="stat-sub">Listing page visits</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Conversion Rate</div>
                <div className="stat-num">{overallConv}%</div>
                <div className="stat-sub">Views → leads</div>
              </div>
            </div>

            {/* ── Traffic sources + Campaigns ── */}
            <div className="mkt-grid">
              <div className="mkt-panel">
                <div className="panel-title">Top Traffic Sources</div>
                {topSources.map(([source, list]) => {
                  const pct = leads.length > 0 ? (list.length / leads.length) * 100 : 0
                  const color = sourceColor(source)
                  return (
                    <div className="bar-row" key={source}>
                      <div className="bar-label-row">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span className="src-dot" style={{ background: color }} />
                          <span className="bar-label">{source}</span>
                        </div>
                        <span className="bar-count">{list.length} leads · {pct.toFixed(0)}%</span>
                      </div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
                      </div>
                    </div>
                  )
                })}
                {topSources.length === 0 && <div style={{ fontSize: 13, color: '#9b9b9b' }}>No data yet</div>}
              </div>

              <div className="mkt-panel">
                <div className="panel-title">Best Performing Campaigns</div>
                {topCampaigns.length === 0 ? (
                  <div style={{ fontSize: 13, color: '#9b9b9b' }}>No campaign data yet. Leads will appear here once UTM parameters are captured.</div>
                ) : (
                  <table className="mkt-table">
                    <thead>
                      <tr>
                        <th>Campaign</th>
                        <th style={{ textAlign: 'right' }}>Leads</th>
                        <th style={{ textAlign: 'right' }}>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topCampaigns.map(([campaign, list]) => (
                        <tr key={campaign}>
                          <td style={{ fontWeight: 500 }}>{campaign}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600, color: '#D9A14A' }}>{list.length}</td>
                          <td style={{ textAlign: 'right' }}>
                            <span className="src-dot" style={{ background: sourceColor(list[0]?.utm_source || ''), display: 'inline-block', marginRight: 4 }} />
                            <span className="td-mono">{list[0]?.utm_source || '—'}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* ── Property conversion table ── */}
            <div className="mkt-panel" style={{ marginBottom: 18 }}>
              <div className="panel-title">Highest Converting Listings</div>
              <table className="mkt-table">
                <thead>
                  <tr>
                    <th>Property</th>
                    <th style={{ textAlign: 'right' }}>Leads</th>
                    <th style={{ textAlign: 'right' }}>Views</th>
                    <th style={{ textAlign: 'right' }}>Conv. Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {topProperties.map(({ slug, leads: lCount, views, convRate }) => (
                    <tr key={slug}>
                      <td style={{ fontWeight: 500, color: '#2F4A48' }}>{slug}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{lCount}</td>
                      <td style={{ textAlign: 'right', color: '#9b9b9b' }}>{views}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: 600, color: convRate === '—' ? '#9b9b9b' : parseFloat(convRate as string) > 5 ? '#059669' : '#1a1a1a' }}>
                          {convRate}{convRate !== '—' ? '%' : ''}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Device split + Recent ad leads ── */}
            <div className="mkt-grid">
              <div className="mkt-panel">
                <div className="panel-title">Device Split (Ad Leads)</div>
                {(() => {
                  const mobile = adLeads.filter(l => l.device_type === 'mobile').length
                  const desktop = adLeads.filter(l => l.device_type !== 'mobile').length
                  const total = mobile + desktop || 1
                  return (
                    <div className="device-split">
                      <div className="device-item">
                        <div className="device-pct">{((mobile / total) * 100).toFixed(0)}%</div>
                        <div className="device-label">📱 Mobile</div>
                        <div style={{ fontSize: 11, color: '#c5c2b4', marginTop: 2 }}>{mobile} leads</div>
                      </div>
                      <div className="device-item">
                        <div className="device-pct">{((desktop / total) * 100).toFixed(0)}%</div>
                        <div className="device-label">💻 Desktop</div>
                        <div style={{ fontSize: 11, color: '#c5c2b4', marginTop: 2 }}>{desktop} leads</div>
                      </div>
                    </div>
                  )
                })()}
              </div>

              <div className="mkt-panel">
                <div className="panel-title">Recent Ad Leads</div>
                <table className="mkt-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Source</th>
                      <th>Campaign</th>
                      <th style={{ textAlign: 'right' }}>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adLeads.slice(0, 8).map(lead => (
                      <tr key={lead.id}>
                        <td style={{ fontWeight: 500 }}>{lead.first_name || lead.email}</td>
                        <td>
                          <span className="src-pill" style={{ background: `${sourceColor(lead.utm_source || '')}18`, color: sourceColor(lead.utm_source || '') }}>
                            <span className="src-dot" style={{ background: sourceColor(lead.utm_source || '') }} />
                            {lead.utm_source}
                          </span>
                        </td>
                        <td className="td-mono">{lead.utm_campaign || '—'}</td>
                        <td style={{ textAlign: 'right', color: '#9b9b9b', fontSize: 11 }}>{timeAgo(lead.created_at)}</td>
                      </tr>
                    ))}
                    {adLeads.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ textAlign: 'center', color: '#9b9b9b', paddingTop: 20 }}>
                          No ad leads yet. Start a campaign with UTM params to see data here.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
