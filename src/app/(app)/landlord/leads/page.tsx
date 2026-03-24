'use client'

import { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getLeadsForOwner, getLeadById } from '@/lib/leads'
import type { Lead } from '@/lib/leads'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const STATUS_ORDER: Lead['status'][] = ['new', 'contacted', 'engaged', 'qualified', 'tour_scheduled', 'closed']

const STATUS_META: Record<Lead['status'], { label: string; color: string; bg: string; border: string }> = {
  new:            { label: 'New',           color: '#3b82f6', bg: 'rgba(59,130,246,0.08)',   border: 'rgba(59,130,246,0.25)' },
  contacted:      { label: 'Contacted',     color: '#f97316', bg: 'rgba(249,115,22,0.08)',   border: 'rgba(249,115,22,0.25)' },
  engaged:        { label: 'Engaged',       color: '#eab308', bg: 'rgba(234,179,8,0.08)',    border: 'rgba(234,179,8,0.3)' },
  qualified:      { label: 'Qualified',     color: '#10b981', bg: 'rgba(16,185,129,0.08)',   border: 'rgba(16,185,129,0.25)' },
  tour_scheduled: { label: 'Tour Sched.',   color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)',   border: 'rgba(139,92,246,0.25)' },
  closed:         { label: 'Closed',        color: '#6b7280', bg: 'rgba(107,114,128,0.08)',  border: 'rgba(107,114,128,0.25)' },
}

function getHeat(createdAt: string | null) {
  if (!createdAt) return { icon: '', color: '#94a3b8', label: '—' }
  const h = (Date.now() - new Date(createdAt).getTime()) / 3600000
  if (h < 24)  return { icon: '🔥', color: '#ef4444', label: '< 24h' }
  if (h < 72)  return { icon: '🌡', color: '#f97316', label: '< 3d' }
  if (h < 168) return { icon: '·',  color: '#eab308', label: '< 7d' }
  return { icon: '·', color: '#cbd5e1', label: '7d+' }
}

function timeAgo(d: string | null): string {
  if (!d) return '—'
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function initials(first: string | null, last: string | null): string {
  return ((first?.[0] || '') + (last?.[0] || '')).toUpperCase() || '?'
}

type Property = { slug: string; name: string }

export default function LandlordLeadsPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'list' | 'pipeline'>('list')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<Lead['status'] | 'all'>('all')
  const [propertyFilter, setPropertyFilter] = useState('all')
  const [toast, setToast] = useState<string | null>(null)

  // Add lead modal
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState({ first_name: '', last_name: '', email: '', phone: '', property: '', move_in_date: '' })
  const [addingLead, setAddingLead] = useState(false)

  // Reminder sending
  const [remindingId, setRemindingId] = useState<string | null>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3500) }

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      setUserId(user.id)
    })
  }, [router])

  const loadLeads = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    const data = await getLeadsForOwner(userId)
    // Sort by most recent first
    data.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    setLeads(data)

    // Extract unique properties
    const props = Array.from(new Set(data.map(l => l.property).filter(Boolean))) as string[]
    setProperties(props.map(slug => ({ slug, name: slug })))
    setLoading(false)
  }, [userId])

  // Also fetch property names from Supabase
  useEffect(() => {
    if (!userId) return
    supabase.from('properties').select('slug, name').eq('owner_id', userId).then(({ data }) => {
      if (data) setProperties(data)
    })
  }, [userId])

  useEffect(() => { loadLeads() }, [loadLeads])

  const filteredLeads = leads.filter(l => {
    if (statusFilter !== 'all' && l.status !== statusFilter) return false
    if (propertyFilter !== 'all' && l.property !== propertyFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!((l.first_name || '').toLowerCase().includes(q) ||
            (l.last_name || '').toLowerCase().includes(q) ||
            (l.email || '').toLowerCase().includes(q) ||
            (l.property || '').toLowerCase().includes(q))) return false
    }
    return true
  })

  const leadsByStatus = STATUS_ORDER.reduce<Record<string, Lead[]>>((acc, s) => {
    acc[s] = filteredLeads.filter(l => l.status === s)
    return acc
  }, {})

  const counts = STATUS_ORDER.reduce<Record<string, number>>((acc, s) => {
    acc[s] = leads.filter(l => l.status === s).length
    return acc
  }, {})
  const needsPrescreen = leads.filter(l => ['new', 'contacted', 'engaged'].includes(l.status)).length

  const sendReminder = async (lead: Lead, e: React.MouseEvent) => {
    e.stopPropagation()
    setRemindingId(lead.id)
    try {
      const res = await fetch(`/api/leads/${lead.id}/send-reminder`, { method: 'POST' })
      if (res.ok) showToast(`Reminder sent to ${lead.first_name || lead.email}`)
      else showToast('Failed to send reminder')
    } catch { showToast('Failed to send reminder') }
    setRemindingId(null)
  }

  const handleAddLead = async () => {
    if (!addForm.first_name || !addForm.email || !addForm.property) return
    setAddingLead(true)
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      })
      if (res.ok) {
        setShowAddModal(false)
        setAddForm({ first_name: '', last_name: '', email: '', phone: '', property: '', move_in_date: '' })
        await loadLeads()
        showToast('Lead added + pre-screen email sent!')
      } else {
        showToast('Failed to add lead')
      }
    } catch { showToast('Failed to add lead') }
    setAddingLead(false)
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: '32px', fontFamily: "'DM Sans', sans-serif" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap'); @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
        {[1,2,3,4,5].map(i => (
          <div key={i} style={{ height: '64px', borderRadius: '10px', marginBottom: '8px', background: 'linear-gradient(90deg,#f0ede6 25%,#faf9f6 50%,#f0ede6 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s infinite' }} />
        ))}
      </div>
    )
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .ll-page { background: #f5f4f0; min-height: 100vh; font-family: 'DM Sans', sans-serif; }

        /* Header */
        .ll-header { background: #1a1a1a; padding: 20px 28px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .ll-title { font-size: 20px; font-weight: 700; color: #fff; }
        .ll-subtitle { font-size: 12px; color: #9b9b9b; margin-top: 2px; }
        .ll-header-right { display: flex; align-items: center; gap: 10px; }

        /* Stats bar */
        .ll-stats { background: #fff; border-bottom: 1px solid #e8e5de; padding: 10px 28px; display: flex; gap: 24px; overflow-x: auto; }
        .ll-stat { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
        .ll-stat-num { font-size: 16px; font-weight: 700; color: #1a1a1a; }
        .ll-stat-label { font-size: 11px; color: #9b9b9b; }
        .ll-stat-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

        /* Filters */
        .ll-filters { background: #fff; border-bottom: 1px solid #e8e5de; padding: 10px 28px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .ll-search { padding: 8px 12px 8px 34px; border: 1.5px solid #e8e5de; border-radius: 8px; font-size: 13px; font-family: 'DM Sans', sans-serif; outline: none; width: 220px; background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%239b9b9b' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='M21 21l-4.35-4.35'/%3E%3C/svg%3E") no-repeat 10px center; transition: border-color 0.15s; }
        .ll-search:focus { border-color: #8C1D40; }
        .ll-status-pills { display: flex; gap: 4px; flex-wrap: wrap; }
        .ll-pill { padding: 5px 12px; border-radius: 20px; border: 1.5px solid #e8e5de; background: #fff; font-size: 12px; font-weight: 500; color: #6b6b6b; cursor: pointer; transition: all 0.15s; white-space: nowrap; font-family: 'DM Sans', sans-serif; }
        .ll-pill.active { background: #1a1a1a; color: #fff; border-color: #1a1a1a; font-weight: 600; }
        .ll-select { padding: 7px 12px; border: 1.5px solid #e8e5de; border-radius: 8px; font-size: 13px; font-family: 'DM Sans', sans-serif; outline: none; background: #fff; color: #1a1a1a; cursor: pointer; }
        .ll-view-toggle { display: flex; background: #f5f4f0; border-radius: 7px; padding: 3px; gap: 2px; }
        .ll-view-btn { padding: 5px 12px; border: none; border-radius: 5px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; }
        .ll-view-btn.active { background: #fff; color: #1a1a1a; font-weight: 600; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
        .ll-view-btn:not(.active) { background: transparent; color: #9b9b9b; }

        /* List */
        .ll-list { padding: 16px 28px; display: flex; flex-direction: column; gap: 6px; }
        .ll-row { background: #fff; border: 1px solid #e8e5de; border-radius: 10px; padding: 14px 18px; display: flex; align-items: center; gap: 14px; cursor: pointer; transition: box-shadow 0.15s, border-color 0.15s; }
        .ll-row:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.08); border-color: #d0cdc7; }
        .ll-avatar { width: 38px; height: 38px; border-radius: 50%; background: #8C1D40; color: #FFC627; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; letter-spacing: 0.5px; }
        .ll-name { font-size: 14px; font-weight: 600; color: #1a1a1a; }
        .ll-email { font-size: 12px; color: #9b9b9b; margin-top: 1px; }
        .ll-prop { font-size: 12px; color: #6b6b6b; }
        .ll-movein { font-size: 11px; color: #b0a898; }
        .ll-badge { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid; white-space: nowrap; }
        .ll-time { font-size: 11px; color: #b0a898; white-space: nowrap; }
        .ll-action-btn { padding: 5px 10px; border-radius: 6px; border: 1.5px solid; font-size: 11px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; white-space: nowrap; }

        /* Pipeline */
        .ll-pipeline { padding: 16px 28px; display: flex; gap: 12px; overflow-x: auto; }
        .ll-pcol { flex-shrink: 0; width: 210px; background: #fff; border-radius: 12px; border-top: 3px solid; overflow: hidden; }
        .ll-pcol-header { padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #f0ede6; }
        .ll-pcol-label { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
        .ll-pcol-count { width: 20px; height: 20px; border-radius: 50%; color: #fff; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
        .ll-pcard { margin: 8px 8px 0; padding: 12px; border: 1px solid #f0ede6; border-radius: 8px; cursor: pointer; transition: box-shadow 0.15s; }
        .ll-pcard:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        .ll-pcard:last-child { margin-bottom: 8px; }

        /* Buttons */
        .btn-primary { background: #8C1D40; color: #fff; border: none; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; white-space: nowrap; }
        .btn-primary:hover { opacity: 0.88; }
        .btn-gold { background: #FFC627; color: #1a1a1a; border: none; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; white-space: nowrap; }
        .btn-gold:hover { opacity: 0.9; }
        .btn-ghost { background: transparent; color: #9b9b9b; border: 1.5px solid #e8e5de; border-radius: 8px; padding: 9px 14px; font-size: 13px; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; }
        .btn-ghost:hover { border-color: #8C1D40; color: #8C1D40; }

        /* Add Lead Modal */
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 400; display: flex; align-items: center; justify-content: center; padding: 24px; backdrop-filter: blur(2px); }
        .modal-card { background: #fff; border-radius: 16px; padding: 28px; width: 100%; max-width: 480px; box-shadow: 0 20px 60px rgba(0,0,0,0.2); max-height: 90vh; overflow-y: auto; }
        .modal-title { font-size: 18px; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }
        .modal-sub { font-size: 13px; color: #9b9b9b; margin-bottom: 22px; }
        .field-label { font-size: 12px; font-weight: 700; color: #1a1a1a; margin-bottom: 5px; display: block; }
        .field-input { width: 100%; padding: 10px 13px; border: 1.5px solid #e8e5de; border-radius: 8px; font-size: 14px; font-family: 'DM Sans', sans-serif; outline: none; transition: border-color 0.15s; }
        .field-input:focus { border-color: #8C1D40; }
        .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
        .field-col { display: flex; flex-direction: column; margin-bottom: 14px; }

        /* Toast */
        .ll-toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); background: #1a1a1a; color: #fff; padding: 11px 20px; border-radius: 10px; font-size: 13px; font-weight: 500; z-index: 999; white-space: nowrap; box-shadow: 0 4px 20px rgba(0,0,0,0.2); animation: toastIn 0.2s ease; }
        @keyframes toastIn { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }

        /* Empty */
        .ll-empty { padding: 60px 28px; display: flex; justify-content: center; }
        .ll-empty-card { background: #fff; border: 1px dashed #e8e5de; border-radius: 16px; padding: 48px 40px; max-width: 440px; width: 100%; text-align: center; }

        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @media (max-width: 640px) {
          .ll-header { padding: 16px; }
          .ll-filters { padding: 10px 16px; }
          .ll-list { padding: 12px 16px; }
          .ll-row { flex-wrap: wrap; }
          .field-row { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="ll-page">

        {/* Toast */}
        {toast && <div className="ll-toast">✓ {toast}</div>}

        {/* Header */}
        <div className="ll-header">
          <div>
            <div className="ll-title">Leads CRM</div>
            <div className="ll-subtitle">{leads.length} total · sorted by most recent</div>
          </div>
          <div className="ll-header-right">
            <a href="/landlord/leads/pipeline" style={{ fontSize: '12px', color: '#9b9b9b', textDecoration: 'none', fontWeight: 500 }}>Pipeline guide →</a>
            <button className="btn-gold" onClick={() => setShowAddModal(true)}>+ Add Lead</button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="ll-stats">
          {STATUS_ORDER.map(s => (
            <div key={s} className="ll-stat" style={{ cursor: 'pointer' }} onClick={() => setStatusFilter(s === statusFilter ? 'all' : s)}>
              <div className="ll-stat-dot" style={{ background: STATUS_META[s].color }} />
              <div className="ll-stat-num" style={{ color: STATUS_META[s].color }}>{counts[s]}</div>
              <div className="ll-stat-label">{STATUS_META[s].label}</div>
            </div>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <div className="ll-stat-dot" style={{ background: '#FFC627' }} />
            <div className="ll-stat-num" style={{ color: '#c9973a' }}>{needsPrescreen}</div>
            <div className="ll-stat-label">Need pre-screen</div>
          </div>
        </div>

        {/* Filters */}
        <div className="ll-filters">
          <input
            className="ll-search"
            placeholder="Search name, email, property…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="ll-status-pills">
            <div className={`ll-pill${statusFilter === 'all' ? ' active' : ''}`} onClick={() => setStatusFilter('all')}>All</div>
            {STATUS_ORDER.map(s => (
              <div
                key={s}
                className={`ll-pill${statusFilter === s ? ' active' : ''}`}
                onClick={() => setStatusFilter(s)}
                style={statusFilter === s ? {} : { borderColor: STATUS_META[s].border, color: STATUS_META[s].color }}
              >
                {STATUS_META[s].label}
              </div>
            ))}
          </div>
          {properties.length > 1 && (
            <select className="ll-select" value={propertyFilter} onChange={e => setPropertyFilter(e.target.value)}>
              <option value="all">All Properties</option>
              {properties.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
            </select>
          )}
          <div style={{ marginLeft: 'auto' }}>
            <div className="ll-view-toggle">
              <button className={`ll-view-btn${viewMode === 'list' ? ' active' : ''}`} onClick={() => setViewMode('list')}>≡ List</button>
              <button className={`ll-view-btn${viewMode === 'pipeline' ? ' active' : ''}`} onClick={() => setViewMode('pipeline')}>⊞ Pipeline</button>
            </div>
          </div>
        </div>

        {/* Empty state */}
        {filteredLeads.length === 0 && (
          <div className="ll-empty">
            <div className="ll-empty-card">
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>📋</div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#1a1a1a', marginBottom: '8px' }}>
                {search || statusFilter !== 'all' || propertyFilter !== 'all' ? 'No matching leads' : 'No leads yet'}
              </div>
              <div style={{ fontSize: '13px', color: '#9b9b9b', marginBottom: '20px', lineHeight: 1.6 }}>
                {search || statusFilter !== 'all' ? 'Try adjusting your filters.' : 'Add a lead manually or wait for tenants to submit interest forms.'}
              </div>
              <button className="btn-primary" onClick={() => setShowAddModal(true)}>+ Add First Lead</button>
            </div>
          </div>
        )}

        {/* ── LIST VIEW ── */}
        {viewMode === 'list' && filteredLeads.length > 0 && (
          <div className="ll-list">
            {filteredLeads.map(lead => {
              const heat = getHeat(lead.created_at)
              const meta = STATUS_META[lead.status]
              const hasPrescreen = ['qualified', 'tour_scheduled', 'closed'].includes(lead.status)
              const needsRemind = ['new', 'contacted', 'engaged'].includes(lead.status)
              const prop = properties.find(p => p.slug === lead.property)

              return (
                <div
                  key={lead.id}
                  className="ll-row"
                  onClick={() => router.push(`/landlord/leads/${lead.id}`)}
                >
                  {/* Avatar */}
                  <div className="ll-avatar">{initials(lead.first_name, lead.last_name)}</div>

                  {/* Name + email */}
                  <div style={{ flex: '0 0 180px', minWidth: 0 }}>
                    <div className="ll-name">
                      {lead.first_name || '—'}{lead.last_name ? ` ${lead.last_name}` : ''}
                      {heat.icon && <span style={{ marginLeft: '5px', fontSize: '13px' }} title={heat.label}>{heat.icon}</span>}
                    </div>
                    <div className="ll-email">{lead.email}</div>
                  </div>

                  {/* Property + move-in */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ll-prop">{prop?.name || lead.property || '—'}</div>
                    {lead.move_in_date && <div className="ll-movein">Move-in: {lead.move_in_date}</div>}
                  </div>

                  {/* Pre-screen badge */}
                  <div style={{ flexShrink: 0 }}>
                    {hasPrescreen ? (
                      <span className="ll-badge" style={{ color: '#10b981', background: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.2)', fontSize: '10px' }}>
                        ✓ Pre-screened
                      </span>
                    ) : (
                      <span className="ll-badge" style={{ color: '#b0a898', background: '#faf9f6', borderColor: '#e8e5de', fontSize: '10px' }}>
                        Needs pre-screen
                      </span>
                    )}
                  </div>

                  {/* Status */}
                  <div style={{ flexShrink: 0 }}>
                    <span className="ll-badge" style={{ color: meta.color, background: meta.bg, borderColor: meta.border }}>
                      {meta.label}
                      {lead.status === 'closed' && lead.closed_reason && ` · ${lead.closed_reason}`}
                    </span>
                  </div>

                  {/* Time */}
                  <div className="ll-time">{timeAgo(lead.created_at)}</div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    {needsRemind && (
                      <button
                        className="ll-action-btn"
                        style={{ color: '#8C1D40', borderColor: '#f4c9d5', background: '#fdf2f5' }}
                        disabled={remindingId === lead.id}
                        onClick={e => sendReminder(lead, e)}
                      >
                        {remindingId === lead.id ? '…' : '📧 Remind'}
                      </button>
                    )}
                    <button
                      className="ll-action-btn"
                      style={{ color: '#3a3a3a', borderColor: '#e8e5de', background: '#fff' }}
                      onClick={e => { e.stopPropagation(); router.push(`/landlord/leads/${lead.id}`) }}
                    >
                      View →
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── PIPELINE VIEW ── */}
        {viewMode === 'pipeline' && filteredLeads.length > 0 && (
          <div className="ll-pipeline">
            {STATUS_ORDER.map(status => {
              const meta = STATUS_META[status]
              const colLeads = leadsByStatus[status] || []
              return (
                <div key={status} className="ll-pcol" style={{ borderTopColor: meta.color }}>
                  <div className="ll-pcol-header">
                    <span className="ll-pcol-label" style={{ color: meta.color }}>{meta.label}</span>
                    <span className="ll-pcol-count" style={{ background: meta.color }}>{colLeads.length}</span>
                  </div>
                  {colLeads.length === 0 && (
                    <div style={{ padding: '16px 12px', textAlign: 'center', fontSize: '12px', color: '#c5c1b8', borderBottom: 'none' }}>No leads</div>
                  )}
                  {colLeads.map(lead => {
                    const heat = getHeat(lead.created_at)
                    return (
                      <div
                        key={lead.id}
                        className="ll-pcard"
                        onClick={() => router.push(`/landlord/leads/${lead.id}`)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                          <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#8C1D40', color: '#FFC627', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {initials(lead.first_name, lead.last_name)}
                          </div>
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>
                              {lead.first_name || '—'}{lead.last_name ? ` ${lead.last_name[0]}.` : ''}
                              {heat.icon && <span style={{ marginLeft: '4px' }}>{heat.icon}</span>}
                            </div>
                            <div style={{ fontSize: '11px', color: '#9b9b9b' }}>{lead.email}</div>
                          </div>
                        </div>
                        {lead.property && <div style={{ fontSize: '11px', color: '#6b6b6b', marginBottom: '4px' }}>{lead.property}</div>}
                        <div style={{ fontSize: '10px', color: '#b0a898' }}>{timeAgo(lead.created_at)}</div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}

      </div>

      {/* ── ADD LEAD MODAL ── */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <div className="modal-title">Add Lead Manually</div>
                <div className="modal-sub">A pre-screen invitation will be emailed automatically.</div>
              </div>
              <button style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#9b9b9b', padding: '0 0 0 12px' }} onClick={() => setShowAddModal(false)}>✕</button>
            </div>

            <div className="field-row">
              <div className="field-col" style={{ marginBottom: 0 }}>
                <label className="field-label">First Name *</label>
                <input className="field-input" placeholder="Jordan" value={addForm.first_name} onChange={e => setAddForm(f => ({ ...f, first_name: e.target.value }))} />
              </div>
              <div className="field-col" style={{ marginBottom: 0 }}>
                <label className="field-label">Last Name</label>
                <input className="field-input" placeholder="Lee" value={addForm.last_name} onChange={e => setAddForm(f => ({ ...f, last_name: e.target.value }))} />
              </div>
            </div>

            <div className="field-col" style={{ marginTop: '14px' }}>
              <label className="field-label">Email *</label>
              <input className="field-input" type="email" placeholder="jordan@asu.edu" value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} />
            </div>

            <div className="field-row" style={{ marginTop: '14px' }}>
              <div className="field-col" style={{ marginBottom: 0 }}>
                <label className="field-label">Phone</label>
                <input className="field-input" type="tel" placeholder="(480) 000-0000" value={addForm.phone} onChange={e => setAddForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="field-col" style={{ marginBottom: 0 }}>
                <label className="field-label">Property *</label>
                <select className="field-input" value={addForm.property} onChange={e => setAddForm(f => ({ ...f, property: e.target.value }))}>
                  <option value="">Select property</option>
                  {properties.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                </select>
              </div>
            </div>

            <div className="field-col" style={{ marginTop: '14px' }}>
              <label className="field-label">Desired Move-in</label>
              <input className="field-input" placeholder="e.g. August 2026" value={addForm.move_in_date} onChange={e => setAddForm(f => ({ ...f, move_in_date: e.target.value }))} />
            </div>

            <div style={{ background: '#fdf9ec', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px 14px', marginTop: '16px', marginBottom: '20px', fontSize: '12px', color: '#92400e' }}>
              📧 HomeHive will automatically email this lead a personalized pre-screen invitation.
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setShowAddModal(false)}>Cancel</button>
              <button
                className="btn-gold"
                style={{ flex: 2 }}
                disabled={!addForm.first_name || !addForm.email || !addForm.property || addingLead}
                onClick={handleAddLead}
              >
                {addingLead ? 'Adding…' : 'Add Lead + Send Pre-screen →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
