'use client'

import { useEffect, useState, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import type { Lead } from '@/lib/leads'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const LEAD_STATUS_CONFIG: Record<Lead['status'], { label: string; color: string; bg: string; border: string }> = {
  new:            { label: 'New',            color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  contacted:      { label: 'Contacted',      color: '#c9973a', bg: '#fefce8', border: '#fde68a' },
  engaged:        { label: 'Engaged',        color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  qualified:      { label: 'Qualified',      color: '#166534', bg: '#f0fdf4', border: '#bbf7d0' },
  tour_scheduled: { label: 'Tour Scheduled', color: '#0e7490', bg: '#ecfeff', border: '#a5f3fc' },
  closed:         { label: 'Closed',         color: '#fff',    bg: '#8C1D40', border: '#8C1D40' },
}
const LEAD_STATUSES = Object.keys(LEAD_STATUS_CONFIG) as Lead['status'][]

function timeAgo(dateStr: string | null) {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function initials(first: string | null, last: string | null) {
  return `${(first || '?')[0]}${(last || '?')[0]}`.toUpperCase()
}

function LeadStatusBadge({ status }: { status: Lead['status'] }) {
  const cfg = LEAD_STATUS_CONFIG[status] ?? LEAD_STATUS_CONFIG['new']
  return (
    <span style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, fontSize: '11px', fontWeight: 600, padding: '2px 9px', borderRadius: '20px', whiteSpace: 'nowrap' }}>
      {cfg.label}
    </span>
  )
}

// ─── LEAD DETAIL PANEL ────────────────────────────────────────────────────────
function LeadPanel({ lead, onClose, onUpdate }: {
  lead: Lead
  onClose: () => void
  onUpdate: (id: string, updates: Partial<Lead>) => void
}) {
  const [status, setStatus] = useState(lead.status)
  const [closedReason, setClosedReason] = useState<'leased' | 'lost' | null>(lead.closed_reason)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const save = async () => {
    setSaving(true)
    const payload: Record<string, unknown> = { status }
    if (status === 'closed') payload.closed_reason = closedReason
    const { error } = await supabase.from('leads').update(payload).eq('id', lead.id)
    if (!error) {
      onUpdate(lead.id, { status, closed_reason: status === 'closed' ? closedReason : lead.closed_reason })
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    }
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex' }}>
      <div style={{ flex: 1, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)' }} onClick={onClose} />
      <div style={{ width: '420px', background: '#fff', height: '100%', overflowY: 'auto', borderLeft: '1px solid #e8e4db', display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans', sans-serif" }}>

        <div style={{ padding: '20px 24px', borderBottom: '1px solid #e8e4db', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#fdf2f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700, color: '#8C1D40', flexShrink: 0 }}>
              {initials(lead.first_name, lead.last_name)}
            </div>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 600, color: '#1a1a1a' }}>{lead.first_name} {lead.last_name}</div>
              <div style={{ fontSize: '12px', color: '#9b9b9b' }}>{timeAgo(lead.created_at)}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', color: '#9b9b9b', cursor: 'pointer', padding: '4px', lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ padding: '16px 24px', borderBottom: '1px solid #f0ede6', display: 'flex', gap: '8px' }}>
          <button onClick={() => window.open(`mailto:${lead.email}?subject=Re: Your interest in ${lead.property || 'HomeHive'}&body=Hi ${lead.first_name},%0D%0A%0D%0A`, '_blank')}
            style={{ flex: 1, background: '#8C1D40', color: '#fff', border: 'none', borderRadius: '7px', padding: '9px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
            Email {lead.first_name}
          </button>
          {lead.phone && (
            <a href={`tel:${lead.phone}`} style={{ flex: 1, background: '#fff', color: '#1a1a1a', border: '1.5px solid #e8e4db', borderRadius: '7px', padding: '9px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", textDecoration: 'none', textAlign: 'center' }}>Call</a>
          )}
        </div>

        <div style={{ padding: '20px 24px', borderBottom: '1px solid #f0ede6' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: '10px' }}>Status</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: status === 'closed' ? '10px' : '0' }}>
            {LEAD_STATUSES.map(s => {
              const cfg = LEAD_STATUS_CONFIG[s]; const active = status === s
              return (
                <button key={s} onClick={() => setStatus(s)}
                  style={{ background: active ? cfg.bg : '#fff', color: active ? cfg.color : '#9b9b9b', border: `1.5px solid ${active ? cfg.border : '#e8e4db'}`, borderRadius: '20px', padding: '4px 12px', fontSize: '12px', fontWeight: active ? 600 : 400, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                  {cfg.label}
                </button>
              )
            })}
          </div>
          {status === 'closed' && (
            <div style={{ display: 'flex', gap: '8px' }}>
              {(['leased', 'lost'] as const).map(r => (
                <button key={r} onClick={() => setClosedReason(r)}
                  style={{ flex: 1, background: closedReason === r ? (r === 'leased' ? '#f0fdf4' : '#fff1f2') : '#fff', color: closedReason === r ? (r === 'leased' ? '#166534' : '#dc2626') : '#9b9b9b', border: `1.5px solid ${closedReason === r ? (r === 'leased' ? '#bbf7d0' : '#fecdd3') : '#e8e4db'}`, borderRadius: '7px', padding: '6px', fontSize: '12px', fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                  {r === 'leased' ? 'Leased ✓' : 'Lost ✗'}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: '20px 24px', borderBottom: '1px solid #f0ede6' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: '14px' }}>Lead details</div>
          {[
            { label: 'Email',     value: lead.email,               link: `mailto:${lead.email}` },
            { label: 'Phone',     value: lead.phone || '—',        link: lead.phone ? `tel:${lead.phone}` : undefined },
            { label: 'Property',  value: lead.property || '—',     link: undefined },
            { label: 'Move-in',   value: lead.move_in_date || '—', link: undefined },
            { label: 'Submitted', value: lead.created_at ? new Date(lead.created_at).toLocaleString() : '—', link: undefined },
          ].map(row => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f5f4f0', gap: '12px' }}>
              <span style={{ fontSize: '12px', color: '#9b9b9b', flexShrink: 0 }}>{row.label}</span>
              {row.link
                ? <a href={row.link} style={{ fontSize: '13px', color: '#8C1D40', fontWeight: 500, textDecoration: 'none', textAlign: 'right', wordBreak: 'break-all' }}>{row.value}</a>
                : <span style={{ fontSize: '13px', color: '#1a1a1a', textAlign: 'right', wordBreak: 'break-word' }}>{row.value}</span>
              }
            </div>
          ))}
        </div>

        <div style={{ padding: '20px 24px', flex: 1 }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: '10px' }}>Notes</div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add notes about this lead..."
            style={{ width: '100%', height: '120px', border: '1.5px solid #e8e4db', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', fontFamily: "'DM Sans', sans-serif", resize: 'none', outline: 'none', boxSizing: 'border-box', color: '#1a1a1a', lineHeight: 1.6 }} />
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid #e8e4db', flexShrink: 0 }}>
          <button onClick={save} disabled={saving}
            style={{ width: '100%', background: saved ? '#16a34a' : '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'background 0.2s' }}>
            {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function AdminLeadsPage() {
  const router = useRouter()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Lead | null>(null)
  const [filter, setFilter] = useState<Lead['status'] | 'all'>('all')
  const [search, setSearch] = useState('')

  const fetchLeads = useCallback(async () => {
    const { data, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false })
    if (!error && data) setLeads(data as Lead[])
    setLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (!data.user) router.push('/login') })
    fetchLeads()
    const ch = supabase.channel('admin-leads')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, fetchLeads)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [fetchLeads, router])

  const updateLead = (id: string, updates: Partial<Lead>) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l))
    setSelected(prev => prev?.id === id ? { ...prev, ...updates } : prev)
  }

  const stats = {
    total: leads.length,
    new: leads.filter(l => l.status === 'new').length,
    thisWeek: leads.filter(l => l.created_at && Date.now() - new Date(l.created_at).getTime() < 7 * 24 * 60 * 60 * 1000).length,
    leased: leads.filter(l => l.status === 'closed' && l.closed_reason === 'leased').length,
    conversionRate: leads.length > 0 ? Math.round((leads.filter(l => l.status === 'closed' && l.closed_reason === 'leased').length / leads.length) * 100) : 0,
  }

  const filtered = leads.filter(l => {
    if (filter !== 'all' && l.status !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      return `${l.first_name} ${l.last_name}`.toLowerCase().includes(q) || l.email?.toLowerCase().includes(q) || l.property?.toLowerCase().includes(q) || l.phone?.includes(q)
    }
    return true
  })

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .l-body { max-width: 1200px; margin: 0 auto; padding: 28px 24px 80px; font-family: 'DM Sans', sans-serif; }
        .l-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
        .l-stat { background: #fff; border: 1px solid #e8e4db; border-radius: 12px; padding: 18px 20px; }
        .l-stat-label { font-size: 11px; font-weight: 600; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 6px; }
        .l-stat-num { font-family: 'Fraunces', serif; font-size: 32px; font-weight: 300; color: #1a1a1a; letter-spacing: -1px; line-height: 1; }
        .l-stat-sub { font-size: 11px; color: #9b9b9b; margin-top: 4px; }
        .l-pipeline { display: flex; gap: 6px; margin-bottom: 20px; flex-wrap: wrap; }
        .l-stage { flex: 1; min-width: 80px; background: #fff; border: 1px solid #e8e4db; border-radius: 10px; padding: 12px 14px; text-align: center; cursor: pointer; transition: all 0.15s; }
        .l-stage:hover { border-color: #8C1D40; }
        .l-stage.active { border-color: #8C1D40; background: #fdf2f5; }
        .l-stage-num { font-family: 'Fraunces', serif; font-size: 22px; font-weight: 300; color: #1a1a1a; line-height: 1; }
        .l-stage-lbl { font-size: 10px; font-weight: 600; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 3px; }
        .l-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
        .l-search { display: flex; align-items: center; gap: 8px; background: #fff; border: 1.5px solid #e8e4db; border-radius: 8px; padding: 0 12px; height: 36px; flex: 1; min-width: 200px; }
        .l-search input { border: none; background: none; outline: none; font-size: 13px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; width: 100%; }
        .l-search input::placeholder { color: #c5c1b8; }
        .l-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
        .l-count { font-size: 13px; color: #9b9b9b; white-space: nowrap; }
        .l-export { background: #fff; border: 1px solid #e8e4db; border-radius: 7px; padding: 7px 14px; font-size: 12px; font-weight: 500; color: #6b6b6b; cursor: pointer; font-family: 'DM Sans', sans-serif; white-space: nowrap; }
        .l-export:hover { border-color: #1a1a1a; color: #1a1a1a; }
        .l-table-wrap { background: #fff; border: 1px solid #e8e4db; border-radius: 12px; overflow: hidden; }
        .l-table { width: 100%; border-collapse: collapse; }
        .l-table th { background: #faf9f6; padding: 10px 16px; text-align: left; font-size: 11px; font-weight: 600; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.6px; border-bottom: 1px solid #e8e4db; white-space: nowrap; }
        .l-table td { padding: 13px 16px; border-bottom: 1px solid #f5f4f0; vertical-align: middle; }
        .l-table tr:last-child td { border-bottom: none; }
        .l-table tbody tr { cursor: pointer; transition: background 0.1s; }
        .l-table tbody tr:hover { background: #faf9f6; }
        .l-lead { display: flex; align-items: center; gap: 10px; }
        .l-avatar { width: 32px; height: 32px; border-radius: 50%; background: #fdf2f5; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #8C1D40; flex-shrink: 0; }
        .l-name { font-size: 14px; font-weight: 500; color: #1a1a1a; }
        .l-email { font-size: 12px; color: #9b9b9b; margin-top: 1px; }
        .l-prop { font-size: 13px; color: #4a4a4a; max-width: 160px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .l-date { font-size: 12px; color: #9b9b9b; white-space: nowrap; }
        .l-new-dot { width: 7px; height: 7px; border-radius: 50%; background: #1d4ed8; animation: blink 2s infinite; flex-shrink: 0; }
        @keyframes blink { 0%,100%{opacity:1}50%{opacity:0.3} }
        .l-empty { text-align: center; padding: 60px 20px; }
        .l-empty-title { font-family: 'Fraunces', serif; font-size: 22px; font-weight: 300; color: #1a1a1a; margin-bottom: 8px; }
        .l-empty-sub { font-size: 14px; color: #9b9b9b; }
        @media (max-width: 900px) { .l-stats { grid-template-columns: 1fr 1fr; } }
        @media (max-width: 600px) { .l-body { padding: 20px 16px; } }
      `}</style>

      {selected && (
        <LeadPanel lead={selected} onClose={() => setSelected(null)} onUpdate={updateLead} />
      )}

      <div className="l-body">
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: '28px', fontWeight: 300, color: '#1a1a1a', letterSpacing: '-0.5px', marginBottom: '4px' }}>Leads</h1>
          <p style={{ fontSize: '13px', color: '#9b9b9b' }}>All interest form submissions · Real-time</p>
        </div>

        <div className="l-stats">
          <div className="l-stat"><div className="l-stat-label">Total leads</div><div className="l-stat-num">{stats.total}</div><div className="l-stat-sub">{stats.thisWeek} this week</div></div>
          <div className="l-stat"><div className="l-stat-label">New / unread</div><div className="l-stat-num" style={{ color: stats.new > 0 ? '#1d4ed8' : '#1a1a1a' }}>{stats.new}</div><div className="l-stat-sub">Needs follow-up</div></div>
          <div className="l-stat"><div className="l-stat-label">Leased</div><div className="l-stat-num" style={{ color: stats.leased > 0 ? '#8C1D40' : '#1a1a1a' }}>{stats.leased}</div><div className="l-stat-sub">Closed as leased</div></div>
          <div className="l-stat"><div className="l-stat-label">Conversion</div><div className="l-stat-num">{stats.conversionRate}%</div><div className="l-stat-sub">Leads → leased</div></div>
        </div>

        <div className="l-pipeline">
          {(['all', ...LEAD_STATUSES] as const).map(s => {
            const count = s === 'all' ? stats.total : leads.filter(l => l.status === s).length
            const label = s === 'all' ? 'All' : LEAD_STATUS_CONFIG[s as Lead['status']].label
            return (
              <div key={s} className={`l-stage${filter === s ? ' active' : ''}`} onClick={() => setFilter(s as Lead['status'] | 'all')}>
                <div className="l-stage-num">{count}</div>
                <div className="l-stage-lbl">{label}</div>
              </div>
            )
          })}
        </div>

        <div className="l-toolbar">
          <div className="l-search">
            <span style={{ color: '#9b9b9b', fontSize: '14px', flexShrink: 0 }}>⌕</span>
            <input placeholder="Search name, email, phone, property..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="l-right">
            <span className="l-count">{filtered.length} lead{filtered.length !== 1 ? 's' : ''}</span>
            <button className="l-export" onClick={() => {
              const csv = [
                ['Name', 'Email', 'Phone', 'Property', 'Move-in', 'Status', 'Submitted'].join(','),
                ...filtered.map(l => [`${l.first_name} ${l.last_name}`, l.email, l.phone, l.property, l.move_in_date, l.status, l.created_at ? new Date(l.created_at).toLocaleDateString() : ''].map(v => `"${v || ''}"`).join(','))
              ].join('\n')
              const blob = new Blob([csv], { type: 'text/csv' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a'); a.href = url; a.download = 'homehive-leads.csv'; a.click(); URL.revokeObjectURL(url)
            }}>Export CSV</button>
          </div>
        </div>

        <div className="l-table-wrap">
          <table className="l-table">
            <thead>
              <tr><th>Lead</th><th>Property</th><th>Move-in</th><th>Status</th><th>Submitted</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: '#9b9b9b', fontSize: '14px' }}>Loading leads...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5}>
                  <div className="l-empty">
                    <div className="l-empty-title">{search || filter !== 'all' ? 'No leads match your filters' : 'No leads yet'}</div>
                    <div className="l-empty-sub">{search || filter !== 'all' ? 'Try clearing your search or filter' : 'Leads will appear here when students submit the interest form'}</div>
                  </div>
                </td></tr>
              ) : filtered.map(lead => (
                <tr key={lead.id} onClick={() => setSelected(lead)}>
                  <td>
                    <div className="l-lead">
                      {lead.status === 'new' && <span className="l-new-dot" />}
                      <div className="l-avatar">{initials(lead.first_name, lead.last_name)}</div>
                      <div>
                        <div className="l-name">{lead.first_name} {lead.last_name}</div>
                        <div className="l-email">{lead.email}</div>
                      </div>
                    </div>
                  </td>
                  <td><div className="l-prop">{lead.property || '—'}</div></td>
                  <td><span style={{ fontSize: '13px', color: '#4a4a4a' }}>{lead.move_in_date || '—'}</span></td>
                  <td><LeadStatusBadge status={lead.status ?? 'new'} /></td>
                  <td><span className="l-date">{timeAgo(lead.created_at)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
