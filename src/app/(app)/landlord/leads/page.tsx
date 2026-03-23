'use client'

import { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getLeadsForOwner } from '@/lib/leads'
import type { Lead } from '@/lib/leads'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const STATUS_ORDER: Lead['status'][] = [
  'new', 'contacted', 'engaged', 'qualified', 'tour_scheduled', 'closed',
]

const STATUS_LABELS: Record<Lead['status'], string> = {
  new: 'New',
  contacted: 'Contacted',
  engaged: 'Engaged',
  qualified: 'Qualified',
  tour_scheduled: 'Tour Scheduled',
  closed: 'Closed',
}

const STATUS_COLORS: Record<Lead['status'], string> = {
  new: '#3b82f6',
  contacted: '#f97316',
  engaged: '#eab308',
  qualified: '#10b981',
  tour_scheduled: '#8b5cf6',
  closed: '#6b7280',
}

const STATUS_BG: Record<Lead['status'], string> = {
  new: 'rgba(59,130,246,0.08)',
  contacted: 'rgba(249,115,22,0.08)',
  engaged: 'rgba(234,179,8,0.08)',
  qualified: 'rgba(16,185,129,0.08)',
  tour_scheduled: 'rgba(139,92,246,0.08)',
  closed: 'rgba(107,114,128,0.08)',
}

function getHeat(createdAt: string | null): { label: string; color: string; icon: string } {
  if (!createdAt) return { label: 'Unknown', color: '#94a3b8', icon: '' }
  const hours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60)
  if (hours < 24) return { label: '< 24h', color: '#ef4444', icon: '🔥' }
  if (hours < 72) return { label: '< 3d', color: '#f97316', icon: '🌡' }
  if (hours < 168) return { label: '< 7d', color: '#eab308', icon: '·' }
  return { label: '7d+', color: '#94a3b8', icon: '·' }
}

function getLastInitial(lastName: string | null): string {
  if (!lastName) return ''
  return ` ${lastName[0].toUpperCase()}.`
}

function formatDate(d: string | null): string {
  if (!d) return '—'
  return d
}

export default function LandlordLeadsPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'pipeline' | 'list'>('pipeline')
  const [propertyFilter, setPropertyFilter] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<'all' | 'week' | 'month'>('all')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [closedReasonPicker, setClosedReasonPicker] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  // Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) {
        router.push('/login')
        return
      }
      setUserId(session.user.id)
    })
  }, [router])

  // Load leads
  const loadLeads = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    const data = await getLeadsForOwner(userId)
    setLeads(data)
    setLoading(false)
  }, [userId])

  useEffect(() => {
    loadLeads()
  }, [loadLeads])

  // Filter logic
  const filteredLeads = leads.filter(lead => {
    if (propertyFilter !== 'all' && lead.property !== propertyFilter) return false
    if (dateFilter !== 'all' && lead.created_at) {
      const created = new Date(lead.created_at)
      const now = new Date()
      if (dateFilter === 'week') {
        const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        if (created < cutoff) return false
      }
      if (dateFilter === 'month') {
        const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        if (created < cutoff) return false
      }
    }
    return true
  })

  const uniqueProperties = Array.from(new Set(leads.map(l => l.property).filter(Boolean))) as string[]

  const leadsByStatus = STATUS_ORDER.reduce<Record<Lead['status'], Lead[]>>((acc, s) => {
    acc[s] = filteredLeads.filter(l => l.status === s)
    return acc
  }, {} as Record<Lead['status'], Lead[]>)

  const showToast = (msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 3000)
  }

  const handleStatusUpdate = async (
    leadId: string,
    status: Lead['status'],
    closedReason?: 'leased' | 'lost'
  ) => {
    setStatusUpdating(true)
    try {
      const res = await fetch(`/api/leads/${leadId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, closed_reason: closedReason }),
      })
      if (res.ok) {
        // Update local state
        setLeads(prev => prev.map(l =>
          l.id === leadId
            ? { ...l, status, closed_reason: closedReason || l.closed_reason }
            : l
        ))
        if (selectedLead?.id === leadId) {
          setSelectedLead(prev => prev
            ? { ...prev, status, closed_reason: closedReason || prev.closed_reason }
            : null
          )
        }
        showToast(`Status updated to ${STATUS_LABELS[status]}`)
      }
    } catch (e) {
      console.error(e)
    }
    setStatusUpdating(false)
    setClosedReasonPicker(false)
  }

  // ── Lead Card ──
  const LeadCard = ({ lead }: { lead: Lead }) => {
    const heat = getHeat(lead.created_at)
    const isQualifiedOrMore = ['qualified', 'tour_scheduled', 'closed'].includes(lead.status)
    return (
      <div
        onClick={() => setSelectedLead(lead)}
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
          padding: '14px',
          cursor: 'pointer',
          transition: 'box-shadow 0.15s, transform 0.1s',
          marginBottom: '8px',
        }}
        onMouseEnter={e => {
          ;(e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'
          ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)'
        }}
        onMouseLeave={e => {
          ;(e.currentTarget as HTMLDivElement).style.boxShadow = 'none'
          ;(e.currentTarget as HTMLDivElement).style.transform = 'none'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
            {lead.first_name || '—'}{getLastInitial(lead.last_name)}
          </div>
          <span style={{ fontSize: '14px' }} title={heat.label}>{heat.icon}</span>
        </div>

        {lead.property && (
          <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>
            {lead.property}
          </div>
        )}

        {lead.move_in_date && (
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>
            Move-in: {lead.move_in_date}
          </div>
        )}

        {isQualifiedOrMore && (
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            background: 'rgba(16,185,129,0.1)',
            color: '#10b981',
            fontSize: '11px',
            fontWeight: 600,
            padding: '3px 8px',
            borderRadius: '999px',
          }}>
            ✓ Pre-screen complete
          </div>
        )}
      </div>
    )
  }

  // ── Detail Modal ──
  const DetailModal = () => {
    if (!selectedLead) return null
    const lead = selectedLead
    const heat = getHeat(lead.created_at)

    return (
      <>
        {/* Overlay */}
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.35)',
            zIndex: 200,
          }}
          onClick={() => setSelectedLead(null)}
        />
        {/* Panel */}
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: '420px', maxWidth: '100vw',
          background: '#ffffff',
          zIndex: 300,
          overflowY: 'auto',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
          padding: '28px 24px',
          fontFamily: "'DM Sans', sans-serif",
        }}>
          {/* Close */}
          <button
            onClick={() => setSelectedLead(null)}
            style={{
              position: 'absolute', top: '16px', right: '16px',
              background: 'none', border: 'none', fontSize: '20px',
              cursor: 'pointer', color: '#64748b',
            }}
          >✕</button>

          {/* Header */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>
                {lead.first_name || '—'}{lead.last_name ? ` ${lead.last_name}` : ''}
              </h2>
              <span style={{ fontSize: '16px' }} title={heat.label}>{heat.icon}</span>
            </div>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: STATUS_BG[lead.status],
              color: STATUS_COLORS[lead.status],
              fontSize: '12px',
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: '999px',
              border: `1px solid ${STATUS_COLORS[lead.status]}33`,
            }}>
              {STATUS_LABELS[lead.status]}
              {lead.status === 'closed' && lead.closed_reason && ` — ${lead.closed_reason}`}
            </div>
          </div>

          {/* Contact info */}
          <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '16px', marginBottom: '20px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '12px' }}>
              Contact
            </div>
            <Row label="Email" value={<a href={`mailto:${lead.email}`} style={{ color: '#10b981', textDecoration: 'none' }}>{lead.email}</a>} />
            <Row label="Phone" value={lead.phone || '—'} />
            <Row label="Property" value={lead.property || '—'} />
            <Row label="Move-in" value={formatDate(lead.move_in_date)} />
            <Row label="Submitted" value={lead.created_at ? new Date(lead.created_at).toLocaleDateString() : '—'} />
          </div>

          {/* Pre-screen data */}
          {(lead.budget || lead.lease_length || lead.lifestyle || lead.roommate_preference || lead.notes) && (
            <div style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: '10px', padding: '16px', marginBottom: '20px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '12px' }}>
                Pre-screen Data
              </div>
              {lead.budget && <Row label="Budget" value={lead.budget} />}
              {lead.lease_length && <Row label="Lease Length" value={lead.lease_length} />}
              {lead.lifestyle && <Row label="Lifestyle" value={lead.lifestyle} />}
              {lead.roommate_preference && <Row label="Roommates" value={lead.roommate_preference} />}
              {lead.notes && (
                <div style={{ marginTop: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>Notes</div>
                  <div style={{ fontSize: '13px', color: '#0f172a', lineHeight: 1.5 }}>{lead.notes}</div>
                </div>
              )}
            </div>
          )}

          {/* Status Change Pills */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '10px' }}>
              Update Status
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {STATUS_ORDER.filter(s => s !== 'closed').map(s => (
                <button
                  key={s}
                  onClick={() => handleStatusUpdate(lead.id, s)}
                  disabled={statusUpdating || lead.status === s}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '999px',
                    border: `1.5px solid ${STATUS_COLORS[s]}`,
                    background: lead.status === s ? STATUS_COLORS[s] : 'transparent',
                    color: lead.status === s ? '#fff' : STATUS_COLORS[s],
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: lead.status === s ? 'default' : 'pointer',
                    opacity: statusUpdating ? 0.6 : 1,
                    fontFamily: "'DM Sans', sans-serif",
                    transition: 'all 0.15s',
                  }}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Closed reason picker */}
          {(lead.status === 'closed' || closedReasonPicker) && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '10px' }}>
                Closed Reason
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => handleStatusUpdate(lead.id, 'closed', 'leased')}
                  disabled={statusUpdating}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: `1.5px solid #10b981`,
                    background: lead.closed_reason === 'leased' ? '#10b981' : 'transparent',
                    color: lead.closed_reason === 'leased' ? '#fff' : '#10b981',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  Leased ✓
                </button>
                <button
                  onClick={() => handleStatusUpdate(lead.id, 'closed', 'lost')}
                  disabled={statusUpdating}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: `1.5px solid #ef4444`,
                    background: lead.closed_reason === 'lost' ? '#ef4444' : 'transparent',
                    color: lead.closed_reason === 'lost' ? '#fff' : '#ef4444',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  Lost ✗
                </button>
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '10px' }}>
              Quick Actions
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <QuickAction
                label="Mark Contacted"
                color="#f97316"
                onClick={() => handleStatusUpdate(lead.id, 'contacted')}
                disabled={statusUpdating || lead.status === 'contacted'}
              />
              <QuickAction
                label="Schedule Tour"
                color="#8b5cf6"
                onClick={() => handleStatusUpdate(lead.id, 'tour_scheduled')}
                disabled={statusUpdating || lead.status === 'tour_scheduled'}
              />
              <QuickAction
                label="Close as Leased"
                color="#10b981"
                onClick={() => handleStatusUpdate(lead.id, 'closed', 'leased')}
                disabled={statusUpdating || (lead.status === 'closed' && lead.closed_reason === 'leased')}
              />
              <QuickAction
                label="Not a Fit"
                color="#ef4444"
                onClick={() => handleStatusUpdate(lead.id, 'closed', 'lost')}
                disabled={statusUpdating || (lead.status === 'closed' && lead.closed_reason === 'lost')}
              />
              {(lead.status === 'new' || lead.status === 'contacted') && (
                <QuickAction
                  label="Send Pre-screen Reminder"
                  color="#64748b"
                  onClick={() => showToast('Reminder sent! (coming soon)')}
                  disabled={false}
                />
              )}
            </div>
          </div>

        </div>
      </>
    )
  }

  // ── Render ──
  if (loading) {
    return (
      <div style={{ padding: '40px 32px', fontFamily: "'DM Sans', sans-serif" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');`}</style>
        <div style={{ display: 'flex', gap: '16px' }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{
              flex: 1,
              height: '200px',
              background: 'linear-gradient(90deg, #f0f4f8 25%, #e8edf2 50%, #f0f4f8 75%)',
              backgroundSize: '400% 100%',
              borderRadius: '12px',
              animation: 'shimmer 1.4s infinite',
            }} />
          ))}
        </div>
        <style>{`@keyframes shimmer { 0% { background-position: 100% 0 } 100% { background-position: -100% 0 } }`}</style>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", minHeight: '100vh', background: '#f0f4f8' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; }
        @media (max-width: 768px) {
          .pipeline-grid { flex-direction: column !important; }
          .pipeline-col { min-width: 100% !important; }
        }
      `}</style>

      {/* Toast */}
      {toastMsg && (
        <div style={{
          position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          background: '#0f172a', color: '#fff',
          padding: '12px 20px', borderRadius: '10px',
          fontSize: '14px', fontWeight: 500,
          zIndex: 400, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        }}>
          {toastMsg}
        </div>
      )}

      {/* Page Header */}
      <div style={{
        background: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        padding: '20px 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>Leads Pipeline</h1>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#64748b' }}>
            {filteredLeads.length} lead{filteredLeads.length !== 1 ? 's' : ''} total
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <a
            href="/landlord/leads/pipeline"
            style={{ fontSize: '13px', color: '#10b981', textDecoration: 'none', fontWeight: 500 }}
          >
            How does this work? →
          </a>
          {/* View toggle */}
          <div style={{
            display: 'flex',
            background: '#f1f5f9',
            borderRadius: '8px',
            padding: '3px',
            gap: '2px',
          }}>
            {(['pipeline', 'list'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  border: 'none',
                  background: viewMode === mode ? '#ffffff' : 'transparent',
                  color: viewMode === mode ? '#0f172a' : '#64748b',
                  fontSize: '13px',
                  fontWeight: viewMode === mode ? 600 : 400,
                  cursor: 'pointer',
                  fontFamily: "'DM Sans', sans-serif",
                  boxShadow: viewMode === mode ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                {mode === 'pipeline' ? '⊞ Pipeline' : '≡ List'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div style={{
        background: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        padding: '12px 32px',
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}>
        <select
          value={propertyFilter}
          onChange={e => setPropertyFilter(e.target.value)}
          style={{
            padding: '7px 12px',
            border: '1.5px solid #e2e8f0',
            borderRadius: '8px',
            fontSize: '13px',
            fontFamily: "'DM Sans', sans-serif",
            color: '#0f172a',
            background: '#fff',
            outline: 'none',
          }}
        >
          <option value="all">All Properties</option>
          {uniqueProperties.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        <div style={{ display: 'flex', gap: '6px' }}>
          {(['all', 'week', 'month'] as const).map(df => (
            <button
              key={df}
              onClick={() => setDateFilter(df)}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                border: `1.5px solid ${dateFilter === df ? '#10b981' : '#e2e8f0'}`,
                background: dateFilter === df ? 'rgba(16,185,129,0.08)' : '#fff',
                color: dateFilter === df ? '#10b981' : '#64748b',
                fontSize: '12px',
                fontWeight: dateFilter === df ? 600 : 400,
                cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              {df === 'all' ? 'All time' : df === 'week' ? 'This week' : 'This month'}
            </button>
          ))}
        </div>
      </div>

      {/* Empty State */}
      {filteredLeads.length === 0 && !loading && (
        <div style={{ padding: '60px 32px', display: 'flex', justifyContent: 'center' }}>
          <div style={{
            background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)',
            borderRadius: '16px',
            padding: '48px 40px',
            maxWidth: '520px',
            width: '100%',
            textAlign: 'center',
            color: '#f1f5f9',
          }}>
            <div style={{
              width: '60px', height: '60px', borderRadius: '50%',
              background: 'rgba(16,185,129,0.2)',
              color: '#10b981', fontSize: '28px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px',
            }}>
              ◉
            </div>
            <h2 style={{ margin: '0 0 12px', fontSize: '22px', fontWeight: 700 }}>
              No leads yet
            </h2>
            <p style={{ margin: '0 0 24px', fontSize: '15px', color: 'rgba(241,245,249,0.65)', lineHeight: 1.7 }}>
              When tenants express interest in your properties, they'll appear here. Your pipeline will fill up as leads come in.
            </p>
            <a
              href="/landlord/leads/pipeline"
              style={{
                display: 'inline-block',
                background: '#10b981',
                color: '#fff',
                textDecoration: 'none',
                padding: '12px 24px',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
              }}
            >
              Learn how the pipeline works →
            </a>
          </div>
        </div>
      )}

      {/* Pipeline View */}
      {viewMode === 'pipeline' && filteredLeads.length > 0 && (
        <div style={{ padding: '24px 24px', overflowX: 'auto' }}>
          <div
            className="pipeline-grid"
            style={{ display: 'flex', gap: '16px', minWidth: '900px' }}
          >
            {STATUS_ORDER.map(status => {
              const colLeads = leadsByStatus[status]
              return (
                <div
                  key={status}
                  className="pipeline-col"
                  style={{
                    flex: 1,
                    minWidth: '200px',
                    background: '#f8fafc',
                    borderRadius: '12px',
                    borderTop: `3px solid ${STATUS_COLORS[status]}`,
                    padding: '12px',
                  }}
                >
                  {/* Column Header */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '12px',
                    padding: '0 2px',
                  }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: STATUS_COLORS[status], textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {STATUS_LABELS[status]}
                    </span>
                    <span style={{
                      background: STATUS_COLORS[status],
                      color: '#fff',
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: '999px',
                      minWidth: '20px',
                      textAlign: 'center',
                    }}>
                      {colLeads.length}
                    </span>
                  </div>

                  {/* Lead Cards */}
                  {colLeads.map(lead => (
                    <LeadCard key={lead.id} lead={lead} />
                  ))}

                  {colLeads.length === 0 && (
                    <div style={{
                      padding: '20px',
                      textAlign: 'center',
                      color: '#cbd5e1',
                      fontSize: '12px',
                      border: '1.5px dashed #e2e8f0',
                      borderRadius: '8px',
                    }}>
                      No leads
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && filteredLeads.length > 0 && (
        <div style={{ padding: '24px 32px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filteredLeads.map(lead => {
              const heat = getHeat(lead.created_at)
              const isQualified = ['qualified', 'tour_scheduled', 'closed'].includes(lead.status)
              return (
                <div
                  key={lead.id}
                  onClick={() => setSelectedLead(lead)}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '16px 20px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    transition: 'box-shadow 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                      <span style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>
                        {lead.first_name || '—'}{getLastInitial(lead.last_name)}
                      </span>
                      <span style={{ fontSize: '14px' }}>{heat.icon}</span>
                    </div>
                    <div style={{ fontSize: '13px', color: '#64748b' }}>
                      {lead.property || '—'}{lead.move_in_date ? ` · Move-in: ${lead.move_in_date}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                    {isQualified && (
                      <span style={{
                        fontSize: '11px', fontWeight: 600,
                        color: '#10b981', background: 'rgba(16,185,129,0.08)',
                        padding: '3px 8px', borderRadius: '999px',
                      }}>
                        ✓ Pre-screen
                      </span>
                    )}
                    <span style={{
                      fontSize: '12px', fontWeight: 600,
                      color: STATUS_COLORS[lead.status],
                      background: STATUS_BG[lead.status],
                      padding: '4px 10px', borderRadius: '999px',
                      border: `1px solid ${STATUS_COLORS[lead.status]}33`,
                    }}>
                      {STATUS_LABELS[lead.status]}
                    </span>
                    <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                      {lead.created_at ? new Date(lead.created_at).toLocaleDateString() : '—'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Detail Modal */}
      <DetailModal />
    </div>
  )
}

// Helper: row in detail modal
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
      <span style={{ fontSize: '13px', color: '#64748b', minWidth: '100px' }}>{label}</span>
      <span style={{ fontSize: '13px', fontWeight: 500, color: '#0f172a', textAlign: 'right' }}>{value}</span>
    </div>
  )
}

// Helper: quick action button
function QuickAction({
  label,
  color,
  onClick,
  disabled,
}: {
  label: string
  color: string
  onClick: () => void
  disabled: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '10px 14px',
        borderRadius: '8px',
        border: `1.5px solid ${color}33`,
        background: disabled ? '#f8fafc' : `${color}0d`,
        color: disabled ? '#94a3b8' : color,
        fontSize: '13px',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: "'DM Sans', sans-serif",
        textAlign: 'left',
        transition: 'all 0.15s',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  )
}
