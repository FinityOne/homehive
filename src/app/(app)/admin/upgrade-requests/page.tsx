'use client'

import { useEffect, useState, useCallback } from 'react'
import { getCurrentUser } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

type UpgradeRequest = {
  id: string
  user_id: string
  email: string
  full_name: string | null
  message: string | null
  status: 'pending' | 'approved' | 'rejected'
  admin_note: string | null
  created_at: string
  reviewed_at: string | null
}

const STATUS_CFG = {
  pending:  { label: 'Pending',  color: '#92400e', bg: '#fffbeb', border: '#fde68a' },
  approved: { label: 'Approved', color: '#166534', bg: '#f0fdf4', border: '#bbf7d0' },
  rejected: { label: 'Rejected', color: '#9f1239', bg: '#fff1f2', border: '#fecdd3' },
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function initials(name: string | null, email: string) {
  if (name) {
    const parts = name.trim().split(' ')
    if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    return parts[0][0].toUpperCase()
  }
  return email[0].toUpperCase()
}

export default function AdminUpgradeRequestsPage() {
  const router = useRouter()
  const [requests, setRequests] = useState<UpgradeRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending')

  // Review modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [modalAction, setModalAction] = useState<'approve' | 'reject'>('approve')
  const [modalRequest, setModalRequest] = useState<UpgradeRequest | null>(null)
  const [noteText, setNoteText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [toast, setToast] = useState<string | null>(null)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3500) }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/upgrade-requests')
    if (res.ok) {
      const data = await res.json()
      setRequests(data)
    }
    setLoading(false)
  }, [])

  useEffect(() => { document.title = 'Upgrade Requests — Admin | HomeHive' }, [])

  useEffect(() => {
    getCurrentUser().then(user => {
      if (!user) { router.push('/login'); return }
    })
    load()
  }, [router, load])

  const openModal = (req: UpgradeRequest, action: 'approve' | 'reject') => {
    setModalRequest(req)
    setModalAction(action)
    setNoteText('')
    setModalOpen(true)
  }

  const handleReview = async () => {
    if (!modalRequest) return
    if (modalAction === 'reject' && !noteText.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/upgrade-requests/${modalRequest.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: modalAction, note: noteText }),
      })
      if (res.ok) {
        setModalOpen(false)
        showToast(modalAction === 'approve' ? `✓ ${modalRequest.full_name || modalRequest.email} approved as landlord` : `Request rejected`)
        await load()
      } else {
        showToast('Something went wrong — try again')
      }
    } catch {
      showToast('Something went wrong — try again')
    }
    setSubmitting(false)
  }

  const filtered = requests.filter(r => filter === 'all' || r.status === filter)
  const pendingCount = requests.filter(r => r.status === 'pending').length

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .ur-page { background: #f4f4f5; min-height: 100vh; font-family: 'DM Sans', sans-serif; }

        .ur-header { background: #18181b; padding: 20px 28px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
        .ur-title { font-size: 20px; font-weight: 700; color: #fafafa; }
        .ur-subtitle { font-size: 12px; color: rgba(250,250,250,0.45); margin-top: 2px; }

        .ur-filters { background: #fff; border-bottom: 1px solid #e4e4e7; padding: 10px 28px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        .ur-pill { padding: 5px 14px; border-radius: 20px; border: 1.5px solid #e4e4e7; background: #fff; font-size: 12px; font-weight: 500; color: #71717a; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; white-space: nowrap; }
        .ur-pill.active { background: #18181b; color: #fafafa; border-color: #18181b; font-weight: 600; }

        .ur-list { padding: 20px 28px; display: flex; flex-direction: column; gap: 10px; }

        .ur-card { background: #fff; border: 1px solid #e4e4e7; border-radius: 12px; padding: 18px 20px; display: flex; align-items: flex-start; gap: 14px; }
        .ur-card.is-pending { border-left: 3px solid #f59e0b; }
        .ur-avatar { width: 40px; height: 40px; border-radius: 50%; background: #a78bfa; color: #fff; font-size: 14px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; letter-spacing: 0.3px; }
        .ur-body { flex: 1; min-width: 0; }
        .ur-name { font-size: 14px; font-weight: 700; color: #18181b; }
        .ur-email { font-size: 12px; color: #71717a; margin-top: 1px; }
        .ur-message { margin-top: 8px; font-size: 13px; color: #3f3f46; background: #fafafa; border: 1px solid #f4f4f5; border-radius: 7px; padding: 9px 12px; line-height: 1.5; }
        .ur-message-label { font-size: 10px; font-weight: 700; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
        .ur-meta { font-size: 11px; color: #a1a1aa; margin-top: 8px; }
        .ur-admin-note { margin-top: 8px; font-size: 12px; color: #6b7280; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 7px; padding: 8px 11px; line-height: 1.5; }
        .ur-admin-note-label { font-size: 10px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }

        .ur-actions { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
        .btn-approve { background: #10b981; color: #fff; border: none; border-radius: 7px; padding: 7px 16px; font-size: 12px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; white-space: nowrap; transition: opacity 0.15s; }
        .btn-approve:hover { opacity: 0.88; }
        .btn-reject { background: #fff; color: #9f1239; border: 1.5px solid #fecdd3; border-radius: 7px; padding: 7px 16px; font-size: 12px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; white-space: nowrap; transition: all 0.15s; }
        .btn-reject:hover { background: #fff1f2; }

        .ur-badge { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid; white-space: nowrap; }

        /* ── MODAL ── */
        .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 500; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .modal-card { background: #fff; border-radius: 16px; padding: 28px; width: 100%; max-width: 460px; box-shadow: 0 20px 60px rgba(0,0,0,0.25); }
        .modal-title { font-size: 18px; font-weight: 700; color: #18181b; margin-bottom: 6px; }
        .modal-sub { font-size: 13px; color: #71717a; margin-bottom: 20px; line-height: 1.5; }
        .modal-label { font-size: 12px; font-weight: 700; color: #3f3f46; margin-bottom: 6px; display: block; }
        .modal-textarea { width: 100%; padding: 10px 13px; border: 1.5px solid #e4e4e7; border-radius: 8px; font-size: 13px; font-family: 'DM Sans', sans-serif; resize: none; height: 90px; outline: none; line-height: 1.6; transition: border-color 0.15s; }
        .modal-textarea:focus { border-color: #8C1D40; }
        .modal-textarea::placeholder { color: #a1a1aa; }
        .modal-actions { display: flex; gap: 10px; margin-top: 20px; }
        .modal-confirm-approve { flex: 1; background: #10b981; color: #fff; border: none; border-radius: 8px; padding: 11px; font-size: 14px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; }
        .modal-confirm-approve:disabled { opacity: 0.5; cursor: not-allowed; }
        .modal-confirm-approve:not(:disabled):hover { opacity: 0.88; }
        .modal-confirm-reject { flex: 1; background: #8C1D40; color: #fff; border: none; border-radius: 8px; padding: 11px; font-size: 14px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; }
        .modal-confirm-reject:disabled { opacity: 0.5; cursor: not-allowed; }
        .modal-confirm-reject:not(:disabled):hover { opacity: 0.88; }
        .modal-cancel { background: #f4f4f5; color: #3f3f46; border: none; border-radius: 8px; padding: 11px 20px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }

        .ur-toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); background: #18181b; color: #fafafa; padding: 11px 20px; border-radius: 10px; font-size: 13px; font-weight: 500; z-index: 999; white-space: nowrap; box-shadow: 0 4px 20px rgba(0,0,0,0.2); animation: toastIn 0.2s ease; }
        @keyframes toastIn { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }

        .ur-empty { padding: 60px 28px; text-align: center; }
        .ur-empty-icon { font-size: 40px; margin-bottom: 12px; }
        .ur-empty-title { font-size: 16px; font-weight: 700; color: #18181b; margin-bottom: 6px; }
        .ur-empty-sub { font-size: 13px; color: #71717a; }

        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @media (max-width: 600px) {
          .ur-header, .ur-filters, .ur-list { padding-left: 16px; padding-right: 16px; }
          .ur-card { flex-direction: column; }
          .ur-actions { flex-direction: row; }
        }
      `}</style>

      {toast && <div className="ur-toast">{toast}</div>}

      {/* Review modal */}
      {modalOpen && modalRequest && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}>
          <div className="modal-card">
            <div className="modal-title">
              {modalAction === 'approve' ? '✓ Approve landlord access' : '✕ Reject request'}
            </div>
            <div className="modal-sub">
              {modalAction === 'approve'
                ? `${modalRequest.full_name || modalRequest.email} will be upgraded to landlord and receive a congratulations email.`
                : `${modalRequest.full_name || modalRequest.email} will be notified by email. Please explain why.`
              }
            </div>
            <label className="modal-label">
              {modalAction === 'approve' ? 'Note for them (optional)' : 'Reason for rejection *'}
            </label>
            <textarea
              className="modal-textarea"
              placeholder={modalAction === 'approve'
                ? 'e.g. Welcome to HomeHive! We look forward to working with you.'
                : 'e.g. We need more information about your property. Please contact us at hello@homehive.live.'
              }
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
            />
            <div className="modal-actions">
              <button className="modal-cancel" onClick={() => setModalOpen(false)}>Cancel</button>
              {modalAction === 'approve' ? (
                <button
                  className="modal-confirm-approve"
                  disabled={submitting}
                  onClick={handleReview}
                >
                  {submitting ? 'Approving…' : 'Approve & notify →'}
                </button>
              ) : (
                <button
                  className="modal-confirm-reject"
                  disabled={submitting || !noteText.trim()}
                  onClick={handleReview}
                >
                  {submitting ? 'Rejecting…' : 'Reject & notify →'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="ur-page">
        {/* Header */}
        <div className="ur-header">
          <div>
            <div className="ur-title">
              Upgrade Requests
              {pendingCount > 0 && (
                <span style={{ marginLeft: '10px', background: '#f59e0b', color: '#fff', fontSize: '12px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>
                  {pendingCount} pending
                </span>
              )}
            </div>
            <div className="ur-subtitle">Tenants requesting landlord portal access</div>
          </div>
        </div>

        {/* Filter pills */}
        <div className="ur-filters">
          {(['pending', 'all', 'approved', 'rejected'] as const).map(f => (
            <button key={f} className={`ur-pill${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              {f === 'pending' && pendingCount > 0 && (
                <span style={{ marginLeft: '5px', background: '#f59e0b', color: '#fff', fontSize: '10px', fontWeight: 700, padding: '1px 5px', borderRadius: '10px' }}>
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="ur-list">
            {[1,2,3].map(i => (
              <div key={i} style={{ height: '80px', borderRadius: '12px', background: 'linear-gradient(90deg,#f4f4f5 25%,#e4e4e7 50%,#f4f4f5 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s infinite' }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="ur-empty">
            <div className="ur-empty-icon">📋</div>
            <div className="ur-empty-title">
              {filter === 'pending' ? 'No pending requests' : `No ${filter === 'all' ? '' : filter + ' '}requests`}
            </div>
            <div className="ur-empty-sub">
              {filter === 'pending' ? "You're all caught up!" : 'Try switching the filter above.'}
            </div>
          </div>
        ) : (
          <div className="ur-list">
            {filtered.map(req => {
              const cfg = STATUS_CFG[req.status]
              return (
                <div key={req.id} className={`ur-card${req.status === 'pending' ? ' is-pending' : ''}`}>
                  <div className="ur-avatar">{initials(req.full_name, req.email)}</div>

                  <div className="ur-body">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <div className="ur-name">{req.full_name || req.email}</div>
                      <span className="ur-badge" style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.border }}>
                        {cfg.label}
                      </span>
                    </div>
                    <div className="ur-email">{req.email}</div>

                    {req.message && (
                      <div className="ur-message">
                        <div className="ur-message-label">Their message</div>
                        {req.message}
                      </div>
                    )}

                    {req.admin_note && (
                      <div className="ur-admin-note">
                        <div className="ur-admin-note-label">Admin note</div>
                        {req.admin_note}
                      </div>
                    )}

                    <div className="ur-meta">
                      Submitted {timeAgo(req.created_at)}
                      {req.reviewed_at && ` · Reviewed ${timeAgo(req.reviewed_at)}`}
                    </div>
                  </div>

                  {req.status === 'pending' && (
                    <div className="ur-actions">
                      <button className="btn-approve" onClick={() => openModal(req, 'approve')}>
                        ✓ Approve
                      </button>
                      <button className="btn-reject" onClick={() => openModal(req, 'reject')}>
                        ✕ Reject
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
