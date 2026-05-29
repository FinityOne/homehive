'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import type { Lead } from '@/lib/leads'

const CopyIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

const UnlockModal = dynamic(() => import('@/components/leads/UnlockModal'), { ssr: false })

const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  new:            { label: 'New',        color: '#3b82f6', bg: 'rgba(59,130,246,0.08)',   border: 'rgba(59,130,246,0.25)' },
  contacted:      { label: 'Contacted',  color: '#f97316', bg: 'rgba(249,115,22,0.08)',   border: 'rgba(249,115,22,0.25)' },
  follow_up:      { label: 'Follow Up',  color: '#c2410c', bg: 'rgba(194,65,12,0.08)',    border: 'rgba(194,65,12,0.25)' },
  engaged:        { label: 'Engaged',    color: '#eab308', bg: 'rgba(234,179,8,0.08)',    border: 'rgba(234,179,8,0.3)'  },
  qualified:      { label: 'Qualified',  color: '#10b981', bg: 'rgba(16,185,129,0.08)',   border: 'rgba(16,185,129,0.25)'},
  matching:       { label: 'Matching',   color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)',   border: 'rgba(139,92,246,0.25)'},
  cold:           { label: 'Cold',       color: '#64748b', bg: 'rgba(100,116,139,0.08)',  border: 'rgba(100,116,139,0.25)'},
  tour_scheduled: { label: 'Qualified',  color: '#10b981', bg: 'rgba(16,185,129,0.08)',   border: 'rgba(16,185,129,0.25)'},
  closed:         { label: 'Closed',     color: '#6b7280', bg: 'rgba(107,114,128,0.08)',  border: 'rgba(107,114,128,0.25)'},
}

function getHeat(createdAt: string | null) {
  if (!createdAt) return { icon: '', label: '—' }
  const h = (Date.now() - new Date(createdAt).getTime()) / 3_600_000
  if (h < 24)  return { icon: '🔥', label: '< 24h' }
  if (h < 72)  return { icon: '🌡', label: '< 3d'  }
  if (h < 168) return { icon: '·',  label: '< 7d'  }
  return { icon: '·', label: '7d+' }
}

function timeAgo(d: string | null): string {
  if (!d) return '—'
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7)  return `${days}d ago`
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function initials(first: string | null, last: string | null) {
  return ((first?.[0] || '') + (last?.[0] || '')).toUpperCase() || '?'
}

/** The oldest lead for this set is always free — one per listing. */
function computeFreeLeadId(leads: Lead[]): string | null {
  let oldest: Lead | null = null
  for (const lead of leads) {
    if (!oldest || new Date(lead.created_at ?? 0) < new Date(oldest.created_at ?? 0)) {
      oldest = lead
    }
  }
  return oldest?.id ?? null
}

export interface LeadsTableProps {
  leads: Lead[]
  /** Active plan means all leads unlocked */
  hasPlan: boolean
  /** Lead IDs already unlocked (from lead_unlocks table) */
  initialUnlockedIds: string[]
}

export default function LeadsTable({ leads, hasPlan, initialUnlockedIds }: LeadsTableProps) {
  const router = useRouter()

  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(() =>
    hasPlan ? new Set(leads.map(l => l.id)) : new Set(initialUnlockedIds)
  )
  const [unlockModalLeadId, setUnlockModalLeadId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const copyToClipboard = useCallback((text: string, key: string, e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }, [])

  const freeLeadId = computeFreeLeadId(leads)
  const isVisible  = (l: Lead) => l.id === freeLeadId || unlockedIds.has(l.id)

  const sortedLeads  = [...leads].sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime())
  const visibleLeads = sortedLeads.filter(l => isVisible(l))
  const lockedLeads  = sortedLeads.filter(l => !isVisible(l))

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  function handleUnlockSuccess(unlockType: string) {
    if (unlockType === 'subscription') {
      setUnlockedIds(new Set(leads.map(l => l.id)))
      showToast('Plan activated! All leads now unlocked.')
    } else if (unlockModalLeadId) {
      setUnlockedIds(prev => new Set([...prev, unlockModalLeadId]))
      showToast('Lead unlocked!')
    }
    setUnlockModalLeadId(null)
  }

  if (leads.length === 0) {
    return (
      <div style={{ padding: '32px 20px', textAlign: 'center', fontFamily: "'DM Sans', sans-serif", color: '#94a3b8', fontSize: '13px' }}>
        No leads yet — get your listing live to start receiving interest.
      </div>
    )
  }

  return (
    <>
      <style>{`
        @keyframes lt-toastIn { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        .lt-table { width: 100%; border-collapse: collapse; }
        .lt-table thead th { background: #f8f7f4; padding: 8px 14px; text-align: left; font-size: 10px; font-weight: 700; color: #a8a49c; text-transform: uppercase; letter-spacing: 0.7px; border-bottom: 1px solid #ece9e2; white-space: nowrap; font-family: 'DM Sans', sans-serif; }
        .lt-table thead th.th-avatar { width: 48px; padding-left: 16px; }
        .lt-table thead th.th-actions { text-align: right; padding-right: 16px; }
        .lt-table tbody tr { border-bottom: 1px solid #f2f0ec; transition: background 0.12s; }
        .lt-table tbody tr:last-child { border-bottom: none; }
        .lt-table td { padding: 10px 14px; vertical-align: middle; font-family: 'DM Sans', sans-serif; }
        .lt-table td:first-child { padding-left: 16px; }
        .lt-table td:last-child  { padding-right: 16px; }
        .lt-tr-link { cursor: pointer; }
        .lt-tr-link:hover { background: #faf9f6; }
        .lt-badge { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid; white-space: nowrap; }
        .lt-unlock-btn { padding: 5px 12px; border-radius: 6px; border: 1.5px solid #FFC627; font-size: 11px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; background: rgba(255,198,39,0.08); color: #b07a00; white-space: nowrap; transition: all 0.15s; }
        .lt-unlock-btn:hover { background: rgba(255,198,39,0.18); }
        .lt-view-btn { padding: 6px 14px; border-radius: 6px; border: 1.5px solid #e8e5de; font-size: 11px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; background: #fff; color: #3a3a3a; white-space: nowrap; transition: all 0.15s; }
        .lt-view-btn:hover { border-color: #8C1D40; color: #8C1D40; background: rgba(140,29,64,0.03); }
        .lt-blur-line { background: #e0ddd7; border-radius: 3px; }
        .lt-toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); background: #1a1a1a; color: #fff; padding: 11px 20px; border-radius: 10px; font-size: 13px; font-weight: 500; z-index: 9999; white-space: nowrap; box-shadow: 0 4px 20px rgba(0,0,0,0.2); animation: lt-toastIn 0.2s ease; font-family: 'DM Sans', sans-serif; }
        .lt-contact-cell { display: flex; flex-direction: column; gap: 1px; }
        .lt-contact-row { display: flex; align-items: center; gap: 0; min-width: 180px; max-width: 220px; }
        .lt-contact-text { font-size: 11px; color: #9b9b9b; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lt-copy-btn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 22px; border-radius: 5px; border: none; background: none; cursor: pointer; color: #c5c1b8; padding: 0; flex-shrink: 0; transition: all 0.12s; }
        .lt-copy-btn:hover { background: rgba(140,29,64,0.08); color: #8C1D40; }
        .lt-copy-btn.ok { color: #10b981; }
      `}</style>

      {toast && <div className="lt-toast">✓ {toast}</div>}

      {unlockModalLeadId && (
        <UnlockModal
          leadId={unlockModalLeadId}
          onSuccess={handleUnlockSuccess}
          onClose={() => setUnlockModalLeadId(null)}
        />
      )}

      <table className="lt-table">
        <thead>
          <tr>
            <th className="th-avatar" />
            <th>Lead</th>
            <th>Status</th>
            <th>Move-in</th>
            <th>Age</th>
            <th className="th-actions">Actions</th>
          </tr>
        </thead>

        {/* ── Visible rows ── */}
        {visibleLeads.length > 0 && (
          <tbody>
            {visibleLeads.map(lead => {
              const heat  = getHeat(lead.created_at)
              const meta  = STATUS_META[lead.status] ?? STATUS_META.new
              const preScreened = ['qualified', 'matching', 'tour_scheduled', 'closed'].includes(lead.status)
              return (
                <tr
                  key={lead.id}
                  className="lt-tr-link"
                  onClick={() => router.push(`/landlord/leads/${lead.id}`)}
                >
                  <td>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#8C1D40', color: '#FFC627', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '0.5px' }}>
                      {initials(lead.first_name, lead.last_name)}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#1a1a1a', lineHeight: 1.3, marginBottom: 3 }}>
                      {lead.first_name || '—'}{lead.last_name ? ` ${lead.last_name}` : ''}
                      {heat.icon && <span style={{ marginLeft: 5, fontSize: 12 }} title={heat.label}>{heat.icon}</span>}
                    </div>
                    <div className="lt-contact-cell">
                      <div className="lt-contact-row">
                        <span className="lt-contact-text">{lead.email}</span>
                        <button
                          className={`lt-copy-btn${copiedKey === `${lead.id}-email` ? ' ok' : ''}`}
                          title="Copy email"
                          onClick={e => copyToClipboard(lead.email, `${lead.id}-email`, e)}
                        >
                          {copiedKey === `${lead.id}-email` ? <CheckIcon /> : <CopyIcon />}
                        </button>
                      </div>
                      <div className="lt-contact-row">
                        <span className="lt-contact-text" style={{ color: lead.phone ? '#b0a898' : '#dbd7d0' }}>
                          {lead.phone || 'No phone'}
                        </span>
                        {lead.phone && (
                          <button
                            className={`lt-copy-btn${copiedKey === `${lead.id}-phone` ? ' ok' : ''}`}
                            title="Copy phone"
                            onClick={e => copyToClipboard(lead.phone!, `${lead.id}-phone`, e)}
                          >
                            {copiedKey === `${lead.id}-phone` ? <CheckIcon /> : <CopyIcon />}
                          </button>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="lt-badge" style={{ color: meta.color, background: meta.bg, borderColor: meta.border }}>
                      {meta.label}
                    </span>
                    <div style={{ marginTop: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 10, color: preScreened ? '#10b981' : '#c5c1b8', fontWeight: preScreened ? 600 : 400 }}>
                        {preScreened ? '✓ Pre-screened' : 'Needs pre-screen'}
                      </span>
                      {(lead.toured || lead.status === 'tour_scheduled') && (
                        <span style={{ fontSize: 10, color: '#8b5cf6', fontWeight: 600 }}>
                          ✓ Toured
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: '#64748b' }}>
                    {lead.move_in_date || '—'}
                  </td>
                  <td style={{ fontSize: 11, color: '#b0a898', whiteSpace: 'nowrap' }}>
                    {timeAgo(lead.created_at)}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        className="lt-view-btn"
                        onClick={() => router.push(`/landlord/leads/${lead.id}`)}
                      >
                        View →
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        )}

        {/* ── Locked section ── */}
        {lockedLeads.length > 0 && (
          <tbody>
            {/* Upgrade banner */}
            <tr>
              <td colSpan={6} style={{ padding: 0 }}>
                <div style={{
                  background: 'linear-gradient(135deg, #1a1a1a 0%, #2a1118 100%)',
                  padding: '14px 18px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 16, flexWrap: 'wrap',
                  borderTop: visibleLeads.length > 0 ? '2px solid #e8e5de' : 'none',
                }}>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 700, fontSize: 14, marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>
                      🔒 {lockedLeads.length} lead{lockedLeads.length !== 1 ? 's' : ''} locked
                    </div>
                    <div style={{ color: '#9b9b9b', fontSize: 11, lineHeight: 1.7, fontFamily: "'DM Sans', sans-serif" }}>
                      Unlock to see name, email & phone&nbsp;·&nbsp;
                      <span style={{ color: '#FFC627', fontWeight: 600 }}>$29.99/mo</span> 1 listing&nbsp;·&nbsp;
                      <span style={{ color: '#FFC627', fontWeight: 600 }}>$49.99/mo</span> unlimited&nbsp;·&nbsp;
                      <span style={{ color: '#FFC627', fontWeight: 600 }}>$299</span> lifetime&nbsp;·&nbsp;
                      <span style={{ color: '#FFC627', fontWeight: 600 }}>$1.99</span> per lead
                    </div>
                  </div>
                  <button
                    onClick={() => setUnlockModalLeadId(lockedLeads[0].id)}
                    style={{
                      background: '#FFC627', color: '#1a1a1a', border: 'none',
                      borderRadius: 7, padding: '9px 18px', fontSize: 13,
                      fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                      fontFamily: "'DM Sans', sans-serif", flexShrink: 0,
                    }}
                  >
                    Unlock Leads →
                  </button>
                </div>
              </td>
            </tr>

            {/* Blurred preview rows (max 3) */}
            {lockedLeads.slice(0, 3).map(lead => {
              const meta = STATUS_META[lead.status] ?? STATUS_META.new
              return (
                <tr
                  key={lead.id}
                  style={{ background: '#fafaf8', cursor: 'pointer' }}
                  onClick={() => setUnlockModalLeadId(lead.id)}
                >
                  <td>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#d4d0c8', filter: 'blur(3px)' }} />
                  </td>
                  <td>
                    <div style={{ filter: 'blur(5px)', userSelect: 'none', pointerEvents: 'none' }}>
                      <div className="lt-blur-line" style={{ width: 90, height: 12, marginBottom: 4 }} />
                      <div className="lt-blur-line" style={{ width: 120, height: 10 }} />
                    </div>
                  </td>
                  <td>
                    <span className="lt-badge" style={{ color: meta.color, background: meta.bg, borderColor: meta.border }}>
                      {meta.label}
                    </span>
                  </td>
                  <td>
                    <div className="lt-blur-line" style={{ width: 60, height: 10, filter: 'blur(3px)' }} />
                  </td>
                  <td style={{ fontSize: 11, color: '#b0a898', whiteSpace: 'nowrap' }}>
                    {timeAgo(lead.created_at)}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        className="lt-unlock-btn"
                        onClick={() => setUnlockModalLeadId(lead.id)}
                      >
                        🔒 Unlock
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}

            {lockedLeads.length > 3 && (
              <tr>
                <td colSpan={6} style={{ padding: '10px 18px', background: '#f7f6f3', textAlign: 'center', borderTop: '1px dashed #e0ddd7' }}>
                  <span style={{ fontSize: 12, color: '#9b9b9b', fontFamily: "'DM Sans', sans-serif" }}>
                    +{lockedLeads.length - 3} more lead{lockedLeads.length - 3 !== 1 ? 's' : ''} —{' '}
                  </span>
                  <button
                    onClick={() => setUnlockModalLeadId(lockedLeads[0].id)}
                    style={{ background: 'none', border: 'none', color: '#8C1D40', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", padding: 0 }}
                  >
                    unlock all →
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        )}
      </table>
    </>
  )
}
