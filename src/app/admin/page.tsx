'use client'

import { useEffect, useState, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── TYPES ────────────────────────────────────────────────────────────────────
type Lead = {
  id: string
  created_at: string
  first_name: string
  last_name: string
  email: string
  phone: string
  property: string
  move_in_date: string
  budget: string
  roommate_preference: string
  lifestyle: string
  notes: string
  status: 'new' | 'contacted' | 'touring' | 'qualified' | 'signed' | 'lost'
}

type Stats = {
  total: number
  new: number
  contacted: number
  touring: number
  qualified: number
  signed: number
  lost: number
  thisWeek: number
  conversionRate: number
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<Lead['status'], { label: string; color: string; bg: string; border: string }> = {
  new:       { label: 'New',       color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  contacted: { label: 'Contacted', color: '#c9973a', bg: '#fefce8', border: '#fde68a' },
  touring:   { label: 'Touring',   color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  qualified: { label: 'Qualified', color: '#166534', bg: '#f0fdf4', border: '#bbf7d0' },
  signed:    { label: 'Signed',    color: '#fff',    bg: '#8C1D40', border: '#8C1D40' },
  lost:      { label: 'Lost',      color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
}

const STATUSES = Object.keys(STATUS_CONFIG) as Lead['status'][]

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function timeAgo(dateStr: string) {
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

function initials(first: string, last: string) {
  return `${(first || '?')[0]}${(last || '?')[0]}`.toUpperCase()
}

// ─── STATUS BADGE ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: Lead['status'] }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, fontSize: '11px', fontWeight: 600, padding: '2px 9px', borderRadius: '20px', whiteSpace: 'nowrap', letterSpacing: '0.2px' }}>
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
  const [notes, setNotes] = useState(lead.notes || '')
  const [status, setStatus] = useState(lead.status)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const save = async () => {
    setSaving(true)
    const { error } = await supabase
      .from('leads')
      .update({ notes, status })
      .eq('id', lead.id)
    if (!error) {
      onUpdate(lead.id, { notes, status })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
    setSaving(false)
  }

  const sendEmail = () => {
    window.open(`mailto:${lead.email}?subject=Re: Your interest in ${lead.property || 'HomeHive'}&body=Hi ${lead.first_name},%0D%0A%0D%0A`, '_blank')
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex' }}>
      {/* Backdrop */}
      <div style={{ flex: 1, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)' }} onClick={onClose} />

      {/* Panel */}
      <div style={{ width: '420px', background: '#fff', height: '100%', overflowY: 'auto', borderLeft: '1px solid #e8e4db', display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans', sans-serif" }}>

        {/* Header */}
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

        {/* Contact actions */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #f0ede6', display: 'flex', gap: '8px' }}>
          <button onClick={sendEmail} style={{ flex: 1, background: '#8C1D40', color: '#fff', border: 'none', borderRadius: '7px', padding: '9px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
            Email {lead.first_name}
          </button>
          {lead.phone && (
            <a href={`tel:${lead.phone}`} style={{ flex: 1, background: '#fff', color: '#1a1a1a', border: '1.5px solid #e8e4db', borderRadius: '7px', padding: '9px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", textDecoration: 'none', textAlign: 'center' }}>
              Call
            </a>
          )}
        </div>

        {/* Status */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #f0ede6' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: '10px' }}>Status</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {STATUSES.map(s => {
              const cfg = STATUS_CONFIG[s]
              const active = status === s
              return (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  style={{ background: active ? cfg.bg : '#fff', color: active ? cfg.color : '#9b9b9b', border: `1.5px solid ${active ? cfg.border : '#e8e4db'}`, borderRadius: '20px', padding: '4px 12px', fontSize: '12px', fontWeight: active ? 600 : 400, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'all 0.15s' }}
                >
                  {cfg.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Lead details */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #f0ede6' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: '14px' }}>Lead details</div>
          {[
            { label: 'Email',      value: lead.email,                link: `mailto:${lead.email}` },
            { label: 'Phone',      value: lead.phone || '—',         link: lead.phone ? `tel:${lead.phone}` : undefined },
            { label: 'Property',   value: lead.property || '—',      link: undefined },
            { label: 'Move-in',    value: lead.move_in_date || '—',  link: undefined },
            { label: 'Budget',     value: lead.budget || '—',        link: undefined },
            { label: 'Roommates',  value: lead.roommate_preference || '—', link: undefined },
            { label: 'Lifestyle',  value: lead.lifestyle || '—',     link: undefined },
            { label: 'Submitted',  value: new Date(lead.created_at).toLocaleString(), link: undefined },
          ].map(row => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid #f5f4f0', gap: '12px' }}>
              <span style={{ fontSize: '12px', color: '#9b9b9b', flexShrink: 0 }}>{row.label}</span>
              {row.link ? (
                <a href={row.link} style={{ fontSize: '13px', color: '#8C1D40', fontWeight: 500, textDecoration: 'none', textAlign: 'right', wordBreak: 'break-all' }}>{row.value}</a>
              ) : (
                <span style={{ fontSize: '13px', color: '#1a1a1a', textAlign: 'right', wordBreak: 'break-word' }}>{row.value}</span>
              )}
            </div>
          ))}
        </div>

        {/* Notes */}
        <div style={{ padding: '20px 24px', flex: 1 }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: '10px' }}>Notes</div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Add notes about this lead — tour scheduled, price discussed, any concerns..."
            style={{ width: '100%', height: '120px', border: '1.5px solid #e8e4db', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', fontFamily: "'DM Sans', sans-serif", resize: 'none', outline: 'none', boxSizing: 'border-box', color: '#1a1a1a', lineHeight: 1.6 }}
          />
        </div>

        {/* Save */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #e8e4db', flexShrink: 0 }}>
          <button
            onClick={save}
            disabled={saving}
            style={{ width: '100%', background: saved ? '#16a34a' : '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'background 0.2s' }}
          >
            {saving ? 'Saving...' : saved ? 'Saved' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── MAIN DASHBOARD ───────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const router = useRouter()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [filter, setFilter] = useState<Lead['status'] | 'all'>('all')
  const [search, setSearch] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [userEmail, setUserEmail] = useState('')

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/admin/login')
  }

  const fetchLeads = useCallback(async () => {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })
    if (!error && data) {
      setLeads(data as Lead[])
      computeStats(data as Lead[])
    }
    setLoading(false)
  }, [])

  const computeStats = (data: Lead[]) => {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const s: Stats = {
      total: data.length,
      new: data.filter(l => l.status === 'new').length,
      contacted: data.filter(l => l.status === 'contacted').length,
      touring: data.filter(l => l.status === 'touring').length,
      qualified: data.filter(l => l.status === 'qualified').length,
      signed: data.filter(l => l.status === 'signed').length,
      lost: data.filter(l => l.status === 'lost').length,
      thisWeek: data.filter(l => new Date(l.created_at).getTime() > oneWeekAgo).length,
      conversionRate: data.length > 0 ? Math.round((data.filter(l => l.status === 'signed').length / data.length) * 100) : 0,
    }
    setStats(s)
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserEmail(data.user.email || '')
    })
    fetchLeads()

    // Real-time updates
    const channel = supabase
      .channel('leads-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => fetchLeads())
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [fetchLeads])

  const updateLead = (id: string, updates: Partial<Lead>) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l))
    if (selectedLead?.id === id) setSelectedLead(prev => prev ? { ...prev, ...updates } : prev)
    computeStats(leads.map(l => l.id === id ? { ...l, ...updates } : l))
  }

  const filtered = leads.filter(l => {
    if (filter !== 'all' && l.status !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        `${l.first_name} ${l.last_name}`.toLowerCase().includes(q) ||
        l.email?.toLowerCase().includes(q) ||
        l.property?.toLowerCase().includes(q) ||
        l.phone?.includes(q)
      )
    }
    return true
  })

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; background: #f5f4f0; color: #1a1a1a; }

        .admin-wrap { min-height: 100vh; display: flex; flex-direction: column; }

        /* TOP NAV */
        .admin-nav { background: #fff; border-bottom: 1px solid #e8e4db; height: 56px; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; position: sticky; top: 0; z-index: 100; flex-shrink: 0; }
        .admin-logo { font-family: 'DM Sans', sans-serif; font-size: 18px; font-weight: 600; color: #1a1a1a; letter-spacing: -0.3px; }
        .admin-logo em { font-family: 'Fraunces', serif; font-style: italic; color: #FFC627; }
        .admin-nav-right { display: flex; align-items: center; gap: 16px; }
        .admin-user { font-size: 12px; color: #9b9b9b; }
        .signout-btn { background: none; border: 1px solid #e8e4db; border-radius: 6px; padding: 6px 12px; font-size: 12px; color: #6b6b6b; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; }
        .signout-btn:hover { border-color: #8C1D40; color: #8C1D40; }

        /* PAGE BODY */
        .admin-body { flex: 1; max-width: 1200px; width: 100%; margin: 0 auto; padding: 28px 24px; }

        /* STAT CARDS */
        .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 28px; }
        .stat-card { background: #fff; border: 1px solid #e8e4db; border-radius: 12px; padding: 18px 20px; }
        .stat-label { font-size: 11px; font-weight: 600; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 6px; }
        .stat-num { font-family: 'Fraunces', serif; font-size: 32px; font-weight: 300; color: #1a1a1a; letter-spacing: -1px; line-height: 1; }
        .stat-sub { font-size: 11px; color: #9b9b9b; margin-top: 4px; }

        /* PIPELINE */
        .pipeline-row { display: flex; gap: 6px; margin-bottom: 28px; flex-wrap: wrap; }
        .pipeline-stage { flex: 1; min-width: 80px; background: #fff; border: 1px solid #e8e4db; border-radius: 10px; padding: 12px 14px; text-align: center; cursor: pointer; transition: all 0.15s; }
        .pipeline-stage:hover { border-color: #8C1D40; }
        .pipeline-stage.active { border-color: #8C1D40; background: #fdf2f5; }
        .pipeline-num { font-family: 'Fraunces', serif; font-size: 22px; font-weight: 300; color: #1a1a1a; line-height: 1; }
        .pipeline-lbl { font-size: 10px; font-weight: 600; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 3px; }

        /* TOOLBAR */
        .leads-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
        .search-wrap { display: flex; align-items: center; gap: 8px; background: #fff; border: 1.5px solid #e8e4db; border-radius: 8px; padding: 0 12px; height: 36px; flex: 1; min-width: 200px; }
        .search-wrap input { border: none; background: none; outline: none; font-size: 13px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; width: 100%; }
        .search-wrap input::placeholder { color: #c5c1b8; }
        .toolbar-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
        .export-btn { background: #fff; border: 1px solid #e8e4db; border-radius: 7px; padding: 7px 14px; font-size: 12px; font-weight: 500; color: #6b6b6b; cursor: pointer; font-family: 'DM Sans', sans-serif; white-space: nowrap; }
        .export-btn:hover { border-color: #1a1a1a; color: #1a1a1a; }
        .leads-count { font-size: 13px; color: #9b9b9b; white-space: nowrap; }

        /* LEADS TABLE */
        .leads-table-wrap { background: #fff; border: 1px solid #e8e4db; border-radius: 12px; overflow: hidden; }
        .leads-table { width: 100%; border-collapse: collapse; }
        .leads-table th { background: #faf9f6; padding: 10px 16px; text-align: left; font-size: 11px; font-weight: 600; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.6px; border-bottom: 1px solid #e8e4db; white-space: nowrap; }
        .leads-table td { padding: 13px 16px; border-bottom: 1px solid #f5f4f0; vertical-align: middle; }
        .leads-table tr:last-child td { border-bottom: none; }
        .leads-table tbody tr { cursor: pointer; transition: background 0.1s; }
        .leads-table tbody tr:hover { background: #faf9f6; }
        .lead-name { display: flex; align-items: center; gap: 10px; }
        .lead-avatar { width: 32px; height: 32px; border-radius: 50%; background: #fdf2f5; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #8C1D40; flex-shrink: 0; }
        .lead-name-text { font-size: 14px; font-weight: 500; color: #1a1a1a; }
        .lead-email { font-size: 12px; color: #9b9b9b; margin-top: 1px; }
        .lead-prop { font-size: 13px; color: #4a4a4a; max-width: 160px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .lead-date { font-size: 12px; color: #9b9b9b; white-space: nowrap; }
        .lead-budget { font-size: 13px; color: #4a4a4a; }
        .new-indicator { width: 7px; height: 7px; border-radius: 50%; background: #1d4ed8; animation: blink 2s infinite; flex-shrink: 0; }
        @keyframes blink { 0%,100%{opacity:1}50%{opacity:0.3} }

        /* EMPTY */
        .empty-state { text-align: center; padding: 60px 20px; }
        .empty-title { font-family: 'Fraunces', serif; font-size: 22px; font-weight: 300; color: #1a1a1a; margin-bottom: 8px; }
        .empty-sub { font-size: 14px; color: #9b9b9b; }

        /* LOADING */
        .loading-row td { padding: 40px; text-align: center; font-size: 14px; color: #9b9b9b; }

        @media (max-width: 768px) {
          .stats-row { grid-template-columns: 1fr 1fr; }
          .admin-body { padding: 20px 16px; }
          .col-budget, .col-lifestyle, .col-roommate { display: none; }
        }
      `}</style>

      {selectedLead && (
        <LeadPanel
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onUpdate={updateLead}
        />
      )}

      <div className="admin-wrap">

        {/* NAV */}
        <div className="admin-nav">
          <div className="admin-logo">Home<em>Hive</em> <span style={{ fontSize: '11px', fontWeight: 600, color: '#9b9b9b', letterSpacing: '0.5px', textTransform: 'uppercase', marginLeft: '8px' }}>Admin</span></div>
          <div className="admin-nav-right">
            <a href="/" target="_blank" style={{ fontSize: '12px', color: '#9b9b9b', textDecoration: 'none' }}>View site</a>
            <span className="admin-user">{userEmail}</span>
            <button className="signout-btn" onClick={signOut}>Sign out</button>
          </div>
        </div>

        <div className="admin-body">

          {/* PAGE TITLE */}
          <div style={{ marginBottom: '24px' }}>
            <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: '28px', fontWeight: 300, color: '#1a1a1a', letterSpacing: '-0.5px', marginBottom: '4px' }}>Lead dashboard</h1>
            <p style={{ fontSize: '13px', color: '#9b9b9b' }}>All interest form submissions · Real-time updates</p>
          </div>

          {/* STAT CARDS */}
          {stats && (
            <div className="stats-row">
              <div className="stat-card">
                <div className="stat-label">Total leads</div>
                <div className="stat-num">{stats.total}</div>
                <div className="stat-sub">{stats.thisWeek} this week</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">New / unread</div>
                <div className="stat-num" style={{ color: stats.new > 0 ? '#1d4ed8' : '#1a1a1a' }}>{stats.new}</div>
                <div className="stat-sub">Needs follow-up</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Rooms signed</div>
                <div className="stat-num" style={{ color: stats.signed > 0 ? '#8C1D40' : '#1a1a1a' }}>{stats.signed}</div>
                <div className="stat-sub">Leases executed</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Conversion</div>
                <div className="stat-num">{stats.conversionRate}%</div>
                <div className="stat-sub">Leads → signed</div>
              </div>
            </div>
          )}

          {/* PIPELINE */}
          {stats && (
            <div className="pipeline-row">
              {(['all', ...STATUSES] as const).map(s => {
                const count = s === 'all' ? stats.total : stats[s as keyof Stats] as number
                const label = s === 'all' ? 'All' : STATUS_CONFIG[s as Lead['status']].label
                return (
                  <div
                    key={s}
                    className={`pipeline-stage${filter === s ? ' active' : ''}`}
                    onClick={() => setFilter(s as any)}
                  >
                    <div className="pipeline-num">{count}</div>
                    <div className="pipeline-lbl">{label}</div>
                  </div>
                )
              })}
            </div>
          )}

          {/* TOOLBAR */}
          <div className="leads-toolbar">
            <div className="search-wrap">
              <span style={{ color: '#9b9b9b', fontSize: '14px', flexShrink: 0 }}>⌕</span>
              <input
                placeholder="Search by name, email, phone, or property..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="toolbar-right">
              <span className="leads-count">{filtered.length} lead{filtered.length !== 1 ? 's' : ''}</span>
              <button
                className="export-btn"
                onClick={() => {
                  const csv = [
                    ['Name', 'Email', 'Phone', 'Property', 'Move-in', 'Budget', 'Roommate pref', 'Status', 'Submitted'].join(','),
                    ...filtered.map(l => [
                      `${l.first_name} ${l.last_name}`,
                      l.email, l.phone, l.property,
                      l.move_in_date, l.budget,
                      l.roommate_preference, l.status,
                      new Date(l.created_at).toLocaleDateString(),
                    ].map(v => `"${v || ''}"`).join(','))
                  ].join('\n')
                  const blob = new Blob([csv], { type: 'text/csv' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url; a.download = 'homehive-leads.csv'; a.click()
                  URL.revokeObjectURL(url)
                }}
              >
                Export CSV
              </button>
            </div>
          </div>

          {/* LEADS TABLE */}
          <div className="leads-table-wrap">
            <table className="leads-table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Property</th>
                  <th>Move-in</th>
                  <th className="col-budget">Budget</th>
                  <th className="col-roommate">Roommates</th>
                  <th>Status</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr className="loading-row"><td colSpan={7}>Loading leads...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7}>
                    <div className="empty-state">
                      <div className="empty-title">{search || filter !== 'all' ? 'No leads match your filters' : 'No leads yet'}</div>
                      <div className="empty-sub">{search || filter !== 'all' ? 'Try clearing your search or filter' : 'Leads will appear here when students submit the interest form'}</div>
                    </div>
                  </td></tr>
                ) : filtered.map(lead => (
                  <tr key={lead.id} onClick={() => setSelectedLead(lead)}>
                    <td>
                      <div className="lead-name">
                        {lead.status === 'new' && <span className="new-indicator" />}
                        <div className="lead-avatar">{initials(lead.first_name, lead.last_name)}</div>
                        <div>
                          <div className="lead-name-text">{lead.first_name} {lead.last_name}</div>
                          <div className="lead-email">{lead.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><div className="lead-prop">{lead.property || '—'}</div></td>
                    <td><span style={{ fontSize: '13px', color: '#4a4a4a' }}>{lead.move_in_date || '—'}</span></td>
                    <td className="col-budget"><span className="lead-budget">{lead.budget || '—'}</span></td>
                    <td className="col-roommate"><span style={{ fontSize: '12px', color: '#6b6b6b' }}>{lead.roommate_preference || '—'}</span></td>
                    <td><StatusBadge status={lead.status || 'new'} /></td>
                    <td><span className="lead-date">{timeAgo(lead.created_at)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </div>
      </div>
    </>
  )
}
