'use client'

import { useEffect, useState, useCallback, Fragment } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Visit = {
  id: string
  created_at: string
  path: string | null
  property_slug: string | null
  referrer: string | null
  utm_source: string | null
  utm_campaign: string | null
}

type Visitor = {
  key: string
  email: string | null
  full_name: string | null
  identified_via: string | null
  ip: string | null
  ip_location: string | null
  device_type: string | null
  first_seen: string
  last_seen: string
  visit_count: number
  utm_source: string | null
  utm_campaign: string | null
  paths: string[]
  visits: Visit[]
}

type Stats = { totalHits: number; uniqueVisitors: number; identified: number; last24h: number }

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function fmt(d: string) {
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const VIA_LABEL: Record<string, string> = {
  one_tap: '◈ Google One Tap',
  lead_form: '✎ Inquiry form',
  email_gate: '✉ Email alert',
  login: '↪ Logged in',
  known: '• Returning',
  unknown: '• Identified',
}

export default function VisitorsPage() {
  const router = useRouter()
  const [visitors, setVisitors] = useState<Visitor[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'identified'>('all')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/visitors')
      if (res.status === 401) { router.push('/login'); return }
      if (res.status === 403) { setError('Admin access only.'); setLoading(false); return }
      const data = await res.json()
      setVisitors(data.visitors || [])
      setStats(data.stats || null)
    } catch {
      setError('Failed to load visitors.')
    }
    setLoading(false)
  }, [router])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      load()
    })
  }, [load, router])

  const shown = visitors.filter(v => {
    if (filter === 'identified' && !v.email) return false
    if (query) {
      const q = query.toLowerCase()
      return (
        (v.email?.toLowerCase().includes(q)) ||
        (v.ip?.includes(q)) ||
        (v.ip_location?.toLowerCase().includes(q)) ||
        (v.utm_campaign?.toLowerCase().includes(q)) ||
        (v.utm_source?.toLowerCase().includes(q))
      )
    }
    return true
  })

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '28px 20px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, color: '#1a1a1a' }}>Website Visitors</h1>
          <p style={{ margin: '4px 0 0', color: '#6b6b6b', fontSize: 14 }}>
            Every hit on the site — IP, location, source, and email once a visitor identifies themselves.
          </p>
        </div>
        <button
          onClick={load}
          style={{ padding: '9px 16px', borderRadius: 9, border: '1px solid #d9d5cc', background: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
        >
          ↻ Refresh
        </button>
      </div>

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, margin: '20px 0 8px' }}>
          {[
            { label: 'Total hits', value: stats.totalHits },
            { label: 'Unique visitors', value: stats.uniqueVisitors },
            { label: 'Identified (with email)', value: stats.identified },
            { label: 'Hits last 24h', value: stats.last24h },
          ].map(s => (
            <div key={s.label} style={{ background: '#fff', border: '1px solid #ece9e2', borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#1a1a1a' }}>{s.value}</div>
              <div style={{ fontSize: 13, color: '#6b6b6b', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '18px 0 12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, background: '#f1efe9', borderRadius: 9, padding: 3 }}>
          {(['all', 'identified'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                background: filter === f ? '#fff' : 'transparent',
                color: filter === f ? '#1a1a1a' : '#6b6b6b',
                boxShadow: filter === f ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {f === 'all' ? 'All visitors' : 'Identified only'}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search email, IP, location, campaign…"
          style={{ flex: 1, minWidth: 220, padding: '9px 12px', borderRadius: 9, border: '1px solid #d9d5cc', fontSize: 14, outline: 'none' }}
        />
      </div>

      {error && <p style={{ color: '#b91c1c', fontWeight: 600 }}>{error}</p>}
      {loading && <p style={{ color: '#6b6b6b' }}>Loading…</p>}

      {!loading && !error && (
        <div style={{ background: '#fff', border: '1px solid #ece9e2', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: 860 }}>
              <thead>
                <tr style={{ background: '#faf9f6', textAlign: 'left', color: '#6b6b6b' }}>
                  <th style={th}>Visitor</th>
                  <th style={th}>IP / Location</th>
                  <th style={th}>Device</th>
                  <th style={th}>Source</th>
                  <th style={th}>Hits</th>
                  <th style={th}>Last seen</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {shown.map(v => {
                  const open = expanded === v.key
                  return (
                    <Fragment key={v.key}>
                      <tr style={{ borderTop: '1px solid #f0eee8' }}>
                        <td style={td}>
                          {v.email ? (
                            <div>
                              <div style={{ fontWeight: 700, color: '#1a1a1a' }}>{v.email}</div>
                              <div style={{ fontSize: 11.5, color: '#166534' }}>
                                {VIA_LABEL[v.identified_via || 'unknown'] || 'Identified'}
                                {v.full_name ? ` · ${v.full_name}` : ''}
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: '#9b9b9b', fontStyle: 'italic' }}>Anonymous</span>
                          )}
                        </td>
                        <td style={td}>
                          <div style={{ fontFamily: 'ui-monospace, monospace' }}>{v.ip || '—'}</div>
                          <div style={{ fontSize: 11.5, color: '#9b9b9b' }}>{v.ip_location || ''}</div>
                        </td>
                        <td style={{ ...td, textTransform: 'capitalize' }}>{v.device_type || '—'}</td>
                        <td style={td}>
                          {v.utm_source ? (
                            <>
                              <div>{v.utm_source}</div>
                              {v.utm_campaign && <div style={{ fontSize: 11.5, color: '#9b9b9b' }}>{v.utm_campaign}</div>}
                            </>
                          ) : <span style={{ color: '#bcb8ae' }}>direct</span>}
                        </td>
                        <td style={{ ...td, fontWeight: 700 }}>{v.visit_count}</td>
                        <td style={td}>
                          <div>{timeAgo(v.last_seen)}</div>
                          <div style={{ fontSize: 11.5, color: '#9b9b9b' }}>{fmt(v.last_seen)}</div>
                        </td>
                        <td style={td}>
                          <button
                            onClick={() => setExpanded(open ? null : v.key)}
                            style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#8C1D40', fontWeight: 600, fontSize: 13 }}
                          >
                            {open ? 'Hide' : 'Journey'}
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={7} style={{ background: '#faf9f6', padding: '4px 16px 14px' }}>
                            <div style={{ fontSize: 12, color: '#6b6b6b', margin: '8px 0 6px' }}>
                              {v.visit_count} page views · first seen {fmt(v.first_seen)}
                            </div>
                            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                              {v.visits.slice().reverse().map(h => (
                                <li key={h.id} style={{ padding: '3px 0', color: '#333' }}>
                                  <span style={{ fontFamily: 'ui-monospace, monospace' }}>{h.path || '/'}</span>
                                  <span style={{ color: '#9b9b9b', marginLeft: 8, fontSize: 11.5 }}>{fmt(h.created_at)}</span>
                                  {h.utm_campaign && <span style={{ color: '#8C1D40', marginLeft: 8, fontSize: 11.5 }}>· {h.utm_campaign}</span>}
                                </li>
                              ))}
                            </ol>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {shown.length === 0 && (
                  <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#9b9b9b', padding: 40 }}>No visitors match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

const th: React.CSSProperties = { padding: '12px 14px', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.3 }
const td: React.CSSProperties = { padding: '12px 14px', verticalAlign: 'top' }
