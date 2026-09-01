'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

type Lead = {
  id: string
  created_at: string
  first_name: string | null
  last_name: string | null
  email: string
  phone: string | null
  property: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  landing_page: string | null
  referrer: string | null
  device_type: string | null
}

type PageView = {
  id?: string
  property_slug: string | null
  session_id: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  landing_page: string | null
  referrer: string | null
  device_type: string | null
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

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = key(item) || '(direct)'
    acc[k] = [...(acc[k] || []), item]
    return acc
  }, {} as Record<string, T[]>)
}

function isMetaSource(s: string | null) {
  if (!s) return false
  const l = s.toLowerCase()
  return l.includes('facebook') || l.includes('instagram') || l.includes('meta') || l === 'fb'
}

const SOURCE_COLORS: Record<string, string> = {
  facebook: '#1877f2', instagram: '#e1306c', google: '#4285f4',
  tiktok: '#010101', email: '#059669', organic: '#6366f1', '(direct)': '#6b7280',
}
function sourceColor(s: string) {
  const low = s.toLowerCase()
  for (const [k, v] of Object.entries(SOURCE_COLORS)) if (low.includes(k)) return v
  return '#8b5cf6'
}

const PAGE_SIZE = 25

export default function MarketingDashboard() {
  const router = useRouter()
  const [leads, setLeads] = useState<Lead[]>([])
  const [pageViews, setPageViews] = useState<PageView[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('30d')
  const [tab, setTab] = useState<'overview' | 'ads'>('overview')

  // Pagination state for ads tab
  const [viewsPage, setViewsPage] = useState(0)
  const [leadsPage, setLeadsPage] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
    const since = new Date(Date.now() - days * 86400000).toISOString()
    setViewsPage(0)
    setLeadsPage(0)

    Promise.all([
      supabase
        .from('leads')
        .select('id, created_at, first_name, last_name, email, phone, property, utm_source, utm_medium, utm_campaign, utm_content, landing_page, referrer, device_type')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('property_page_views')
        .select('property_slug, session_id, utm_source, utm_medium, utm_campaign, utm_content, landing_page, referrer, device_type, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
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

  // ── Meta Ads derived data ──────────────────────────────────────────────────
  const metaLeads     = leads.filter(l => isMetaSource(l.utm_source))
  const metaPageViews = pageViews.filter(v => isMetaSource(v.utm_source))
  const metaConvRate  = metaPageViews.length > 0
    ? ((metaLeads.length / metaPageViews.length) * 100).toFixed(1)
    : '—'

  const metaByCampaign = groupBy(metaLeads, l => l.utm_campaign || '(no campaign)')
  const metaCampaignRows = Object.entries(metaByCampaign)
    .map(([campaign, list]) => ({
      campaign,
      leads: list.length,
      views: metaPageViews.filter(v => (v.utm_campaign || '(no campaign)') === campaign).length,
      source: list[0]?.utm_source || '',
    }))
    .sort((a, b) => b.leads - a.leads)

  // Pagination slices
  const viewsTotalPages = Math.ceil(metaPageViews.length / PAGE_SIZE)
  const leadsTotalPages = Math.ceil(metaLeads.length / PAGE_SIZE)
  const visibleViews = metaPageViews.slice(viewsPage * PAGE_SIZE, (viewsPage + 1) * PAGE_SIZE)
  const visibleLeads = metaLeads.slice(leadsPage * PAGE_SIZE, (leadsPage + 1) * PAGE_SIZE)

  const META_BLUE = '#1877f2'
  const META_PINK = '#e1306c'

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        .mkt { font-family: 'Geist', system-ui, sans-serif; background: #f8f7f4; min-height: 100vh; padding: 32px 28px; }
        .mkt-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
        .mkt-title { font-size: 22px; font-weight: 600; color: #1a1a1a; letter-spacing: -0.4px; }
        .mkt-range { display: flex; gap: 6px; }
        .mkt-range-btn { font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 20px; border: 1.5px solid #e8e5de; background: #fff; color: #6b6b6b; cursor: pointer; transition: all 0.15s; }
        .mkt-range-btn.active { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }

        /* Tabs */
        .mkt-tabs { display: flex; gap: 0; border-bottom: 2px solid #e8e5de; margin-bottom: 28px; }
        .mkt-tab { font-size: 13px; font-weight: 600; padding: 10px 20px; border: none; background: none; cursor: pointer; color: #9b9b9b; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all 0.15s; font-family: 'Geist', system-ui, sans-serif; display: flex; align-items: center; gap: 7px; }
        .mkt-tab.active { color: #1a1a1a; border-bottom-color: #1a1a1a; }
        .mkt-tab:hover:not(.active) { color: #3a3a3a; }
        .tab-badge { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 20px; background: #f0ede6; color: #6b6b6b; }
        .mkt-tab.active .tab-badge { background: #1877f220; color: #1877f2; }

        /* Stat cards */
        .mkt-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 24px; }
        .mkt-stats-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 24px; }
        .stat-card { background: #fff; border: 1px solid #e8e5de; border-radius: 14px; padding: 20px 22px; }
        .stat-card-accent { border-color: #1877f230; background: linear-gradient(135deg, #fff 0%, #f0f6ff 100%); }
        .stat-label { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #9b9b9b; margin-bottom: 10px; }
        .stat-num { font-size: 32px; font-weight: 300; color: #1a1a1a; letter-spacing: -1.5px; line-height: 1; margin-bottom: 6px; }
        .stat-sub { font-size: 12px; color: #9b9b9b; }
        .stat-accent { color: #D9A14A; }
        .stat-meta { color: #1877f2; }

        /* Grid layout */
        .mkt-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 18px; }
        .mkt-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 18px; margin-bottom: 18px; }
        .mkt-panel { background: #fff; border: 1px solid #e8e5de; border-radius: 14px; padding: 22px; }
        .mkt-panel-full { background: #fff; border: 1px solid #e8e5de; border-radius: 14px; padding: 22px; margin-bottom: 18px; }
        .panel-title { font-size: 13px; font-weight: 600; color: #1a1a1a; margin-bottom: 18px; letter-spacing: -0.2px; display: flex; align-items: center; gap: 8px; }
        .panel-count { font-size: 12px; color: #9b9b9b; font-weight: 500; background: #f0ede6; padding: 2px 8px; border-radius: 20px; }

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
        .mkt-table th { text-align: left; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #9b9b9b; padding: 0 8px 10px 0; border-bottom: 1px solid #f0ede6; white-space: nowrap; }
        .mkt-table td { padding: 11px 8px 11px 0; border-bottom: 1px solid #f8f6f2; color: #3a3a3a; vertical-align: middle; }
        .mkt-table tr:last-child td { border-bottom: none; }
        .td-mono { font-family: 'Geist Mono', monospace; font-size: 11px; color: #9b9b9b; }
        .td-clip { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        /* Device split */
        .device-split { display: flex; gap: 16px; }
        .device-item { flex: 1; background: #f8f7f4; border-radius: 10px; padding: 14px 16px; text-align: center; }
        .device-pct { font-size: 24px; font-weight: 300; color: #1a1a1a; letter-spacing: -1px; }
        .device-label { font-size: 11px; color: #9b9b9b; margin-top: 3px; font-weight: 500; }

        /* Meta badge */
        .meta-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 20px; }
        .meta-fb { background: #1877f215; color: #1877f2; }
        .meta-ig { background: #e1306c15; color: #e1306c; }

        /* Pagination */
        .pagination { display: flex; align-items: center; gap: 8px; margin-top: 16px; justify-content: flex-end; }
        .page-btn { font-size: 12px; font-weight: 600; padding: 5px 12px; border-radius: 8px; border: 1.5px solid #e8e5de; background: #fff; color: #3a3a3a; cursor: pointer; transition: all 0.15s; }
        .page-btn:hover:not(:disabled) { border-color: #1877f2; color: #1877f2; }
        .page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .page-info { font-size: 12px; color: #9b9b9b; }

        /* Empty state */
        .empty-state { text-align: center; padding: 40px 20px; }
        .empty-icon { font-size: 32px; margin-bottom: 10px; }
        .empty-title { font-size: 14px; font-weight: 600; color: #3a3a3a; margin-bottom: 6px; }
        .empty-desc { font-size: 12px; color: #9b9b9b; max-width: 300px; margin: 0 auto; line-height: 1.5; }

        @media (max-width: 900px) {
          .mkt-stats, .mkt-stats-3 { grid-template-columns: repeat(2, 1fr); }
          .mkt-grid, .mkt-grid-3 { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="mkt">
        <div className="mkt-header">
          <div className="mkt-title">Marketing</div>
          <div className="mkt-range">
            {(['7d', '30d', '90d'] as const).map(r => (
              <button key={r} className={`mkt-range-btn${range === r ? ' active' : ''}`} onClick={() => setRange(r)}>
                {r === '7d' ? '7 days' : r === '30d' ? '30 days' : '90 days'}
              </button>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="mkt-tabs">
          <button className={`mkt-tab${tab === 'overview' ? ' active' : ''}`} onClick={() => setTab('overview')}>
            Overview
          </button>
          <button className={`mkt-tab${tab === 'ads' ? ' active' : ''}`} onClick={() => setTab('ads')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
              <path d="M22.675 0H1.325C.593 0 0 .593 0 1.325v21.351C0 23.407.593 24 1.325 24H12.82v-9.294H9.692v-3.622h3.128V8.413c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.763v2.313h3.587l-.467 3.622h-3.12V24h6.116c.73 0 1.323-.593 1.323-1.325V1.325C24 .593 23.407 0 22.675 0z" fill="#1877f2"/>
            </svg>
            Meta Ads
            {!loading && <span className="tab-badge">{metaLeads.length} leads</span>}
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#9b9b9b', fontSize: '14px' }}>Loading data…</div>
        ) : tab === 'overview' ? (
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
        ) : (
          /* ══════════════════════════════════════════════════════════════
             ADS MANAGEMENT TAB
          ══════════════════════════════════════════════════════════════ */
          <>
            {/* Hero banner */}
            <div style={{ background: 'linear-gradient(135deg, #1877f2 0%, #e1306c 100%)', borderRadius: 16, padding: '20px 24px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.8)', marginBottom: 4, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Meta Ads Attribution</div>
                <div style={{ fontSize: 22, fontWeight: 300, color: '#fff', letterSpacing: -0.5 }}>
                  Facebook &amp; Instagram traffic
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>
                  All visits and leads where utm_source = facebook / instagram / meta
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <span style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 20, padding: '6px 14px', fontSize: 12, fontWeight: 700, color: '#fff' }}>
                  {metaPageViews.length.toLocaleString()} views
                </span>
                <span style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 20, padding: '6px 14px', fontSize: 12, fontWeight: 700, color: '#fff' }}>
                  {metaLeads.length} submissions
                </span>
              </div>
            </div>

            {/* Stat cards */}
            <div className="mkt-stats-3">
              <div className="stat-card stat-card-accent">
                <div className="stat-label">Meta Page Views</div>
                <div className="stat-num stat-meta">{metaPageViews.length.toLocaleString()}</div>
                <div className="stat-sub">
                  {pageViews.length > 0 ? ((metaPageViews.length / pageViews.length) * 100).toFixed(0) : 0}% of all views
                </div>
              </div>
              <div className="stat-card stat-card-accent">
                <div className="stat-label">Meta Submissions</div>
                <div className="stat-num stat-meta">{metaLeads.length}</div>
                <div className="stat-sub">
                  {leads.length > 0 ? ((metaLeads.length / leads.length) * 100).toFixed(0) : 0}% of all leads
                </div>
              </div>
              <div className="stat-card stat-card-accent">
                <div className="stat-label">Meta Conv. Rate</div>
                <div className="stat-num stat-meta">{metaConvRate === '—' ? '—' : `${metaConvRate}%`}</div>
                <div className="stat-sub">Meta views → leads</div>
              </div>
            </div>

            {/* Campaign breakdown */}
            {metaCampaignRows.length > 0 && (
              <div className="mkt-panel-full">
                <div className="panel-title">
                  Campaign Breakdown
                  <span className="panel-count">{metaCampaignRows.length} campaigns</span>
                </div>
                <table className="mkt-table">
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th style={{ textAlign: 'right' }}>Views</th>
                      <th style={{ textAlign: 'right' }}>Leads</th>
                      <th style={{ textAlign: 'right' }}>Conv. Rate</th>
                      <th style={{ textAlign: 'right' }}>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metaCampaignRows.map(row => {
                      const cr = row.views > 0 ? ((row.leads / row.views) * 100).toFixed(1) : '—'
                      return (
                        <tr key={row.campaign}>
                          <td style={{ fontWeight: 500 }}>{row.campaign}</td>
                          <td style={{ textAlign: 'right', color: '#9b9b9b' }}>{row.views}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600, color: META_BLUE }}>{row.leads}</td>
                          <td style={{ textAlign: 'right' }}>
                            <span style={{ fontWeight: 600, color: cr === '—' ? '#9b9b9b' : parseFloat(cr) > 5 ? '#059669' : '#1a1a1a' }}>
                              {cr}{cr !== '—' ? '%' : ''}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span className={`meta-badge ${row.source.toLowerCase().includes('instagram') ? 'meta-ig' : 'meta-fb'}`}>
                              {row.source}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Submissions table */}
            <div className="mkt-panel-full">
              <div className="panel-title">
                Meta Ad Submissions
                <span className="panel-count">{metaLeads.length} total</span>
              </div>
              {metaLeads.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📭</div>
                  <div className="empty-title">No Meta ad leads yet</div>
                  <div className="empty-desc">When someone submits a form after arriving from a Facebook or Instagram ad (with utm_source=facebook/instagram), they&apos;ll appear here.</div>
                </div>
              ) : (
                <>
                  <table className="mkt-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Property</th>
                        <th>Campaign</th>
                        <th>Ad / Content</th>
                        <th>Device</th>
                        <th>Source</th>
                        <th style={{ textAlign: 'right' }}>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleLeads.map(lead => (
                        <tr key={lead.id}>
                          <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {[lead.first_name, lead.last_name].filter(Boolean).join(' ') || '—'}
                          </td>
                          <td className="td-mono td-clip" style={{ maxWidth: 160 }}>{lead.email}</td>
                          <td className="td-mono" style={{ whiteSpace: 'nowrap' }}>{lead.phone || '—'}</td>
                          <td style={{ color: '#2F4A48', fontWeight: 500, whiteSpace: 'nowrap' }}>
                            {lead.property || '—'}
                          </td>
                          <td className="td-mono td-clip">{lead.utm_campaign || '—'}</td>
                          <td className="td-mono td-clip">{lead.utm_content || '—'}</td>
                          <td>
                            <span style={{ fontSize: 11, color: '#6b6b6b' }}>
                              {lead.device_type === 'mobile' ? '📱' : '💻'} {lead.device_type || '—'}
                            </span>
                          </td>
                          <td>
                            <span className={`meta-badge ${(lead.utm_source || '').toLowerCase().includes('instagram') ? 'meta-ig' : 'meta-fb'}`}>
                              {lead.utm_source}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <span style={{ fontSize: 11, color: '#9b9b9b' }}>{fmtDate(lead.created_at)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {leadsTotalPages > 1 && (
                    <div className="pagination">
                      <span className="page-info">
                        {leadsPage * PAGE_SIZE + 1}–{Math.min((leadsPage + 1) * PAGE_SIZE, metaLeads.length)} of {metaLeads.length}
                      </span>
                      <button className="page-btn" disabled={leadsPage === 0} onClick={() => setLeadsPage(p => p - 1)}>← Prev</button>
                      <button className="page-btn" disabled={leadsPage >= leadsTotalPages - 1} onClick={() => setLeadsPage(p => p + 1)}>Next →</button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Page views table */}
            <div className="mkt-panel-full">
              <div className="panel-title">
                Meta Ad Page Views
                <span className="panel-count">{metaPageViews.length.toLocaleString()} total</span>
              </div>
              {metaPageViews.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">👁️</div>
                  <div className="empty-title">No Meta ad page views yet</div>
                  <div className="empty-desc">Page views from Facebook/Instagram ads will appear here once visitors arrive from your campaigns.</div>
                </div>
              ) : (
                <>
                  <table className="mkt-table">
                    <thead>
                      <tr>
                        <th>Property</th>
                        <th>Campaign</th>
                        <th>Ad / Content</th>
                        <th>Landing Page</th>
                        <th>Device</th>
                        <th>Source</th>
                        <th style={{ textAlign: 'right' }}>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleViews.map((view, i) => (
                        <tr key={`${view.session_id}-${i}`}>
                          <td style={{ color: '#2F4A48', fontWeight: 500, whiteSpace: 'nowrap' }}>
                            {view.property_slug || '—'}
                          </td>
                          <td className="td-mono td-clip">{view.utm_campaign || '—'}</td>
                          <td className="td-mono td-clip">{view.utm_content || '—'}</td>
                          <td className="td-mono td-clip" style={{ maxWidth: 160, fontSize: 10 }}>
                            {view.landing_page || '—'}
                          </td>
                          <td>
                            <span style={{ fontSize: 11, color: '#6b6b6b' }}>
                              {view.device_type === 'mobile' ? '📱' : '💻'} {view.device_type || '—'}
                            </span>
                          </td>
                          <td>
                            <span className={`meta-badge ${(view.utm_source || '').toLowerCase().includes('instagram') ? 'meta-ig' : 'meta-fb'}`}>
                              {view.utm_source}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <span style={{ fontSize: 11, color: '#9b9b9b' }}>{fmtDate(view.created_at)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {viewsTotalPages > 1 && (
                    <div className="pagination">
                      <span className="page-info">
                        {viewsPage * PAGE_SIZE + 1}–{Math.min((viewsPage + 1) * PAGE_SIZE, metaPageViews.length)} of {metaPageViews.length}
                      </span>
                      <button className="page-btn" disabled={viewsPage === 0} onClick={() => setViewsPage(p => p - 1)}>← Prev</button>
                      <button className="page-btn" disabled={viewsPage >= viewsTotalPages - 1} onClick={() => setViewsPage(p => p + 1)}>Next →</button>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
