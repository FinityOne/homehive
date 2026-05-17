'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type BgCheck = {
  id: string
  created_at: string
  updated_at: string
  is_student: boolean | null
  cosigner: string | null
  credit: string | null
  employment_check: string | null
  current_residence_check: string | null
  criminal_check: string | null
  eviction_check: string | null
  notes: string | null
  leads: {
    id: string
    first_name: string | null
    last_name: string | null
    email: string
    property: string | null
    status: string | null
  } | null
}

function checkScore(c: BgCheck): { passed: number; total: number } {
  const fields = [
    c.employment_check === 'clear',
    c.current_residence_check === 'clear',
    c.criminal_check === 'clear',
    c.eviction_check === 'clear',
  ]
  return { passed: fields.filter(Boolean).length, total: fields.length }
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function BackgroundChecksPage() {
  const router = useRouter()
  const [checks, setChecks] = useState<BgCheck[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newModal, setNewModal] = useState(false)
  const [leads, setLeads] = useState<{ id: string; first_name: string | null; last_name: string | null; email: string; property: string | null }[]>([])
  const [selectedLead, setSelectedLead] = useState('')
  const [leadSearch, setLeadSearch] = useState('')

  useEffect(() => { document.title = 'Background Checks — Landlord | HomeHive' }, [])

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }

      const [checksRes, leadsRes] = await Promise.all([
        fetch('/api/background-checks', { headers: { Authorization: `Bearer ${session.access_token}` } }),
        supabase.from('leads').select('id, first_name, last_name, email, property').order('created_at', { ascending: false }),
      ])

      if (checksRes.ok) {
        const { checks: c } = await checksRes.json()
        setChecks(c || [])
      }
      if (leadsRes.data) setLeads(leadsRes.data)
      setLoading(false)
    }
    load()
  }, [router])

  const handleCreate = async () => {
    if (!selectedLead) return
    setCreating(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/background-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ lead_id: selectedLead }),
    })
    if (res.ok) {
      const { check } = await res.json()
      router.push(`/landlord/background-checks/${check.id}`)
    }
    setCreating(false)
  }

  const filteredLeads = leads.filter(l => {
    const q = leadSearch.toLowerCase()
    return (
      l.email.toLowerCase().includes(q) ||
      (l.first_name || '').toLowerCase().includes(q) ||
      (l.last_name || '').toLowerCase().includes(q)
    )
  })

  const existingLeadIds = new Set(checks.map(c => c.leads?.id).filter(Boolean))

  if (loading) {
    return (
      <div style={{ padding: '32px', fontFamily: "'DM Sans', sans-serif" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&display=swap'); @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
        {[1,2,3].map(i => <div key={i} style={{ height: '72px', borderRadius: '10px', marginBottom: '10px', background: 'linear-gradient(90deg,#f0ede6 25%,#faf9f6 50%,#f0ede6 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s infinite' }} />)}
      </div>
    )
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .bgc-page { background: #f5f4f0; min-height: 100vh; font-family: 'DM Sans', sans-serif; padding: 24px; }
        .bgc-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
        .bgc-title { font-size: 20px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.3px; }
        .bgc-sub { font-size: 13px; color: #9b9b9b; margin-top: 2px; }
        .bgc-btn-new { display: inline-flex; align-items: center; gap: 6px; background: #8C1D40; color: #fff; border: none; border-radius: 9px; padding: 9px 18px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; }
        .bgc-btn-new:hover { opacity: 0.88; }
        .bgc-empty { text-align: center; padding: 60px 24px; background: #fff; border-radius: 14px; border: 1px solid #e8e5de; }
        .bgc-empty-icon { font-size: 40px; margin-bottom: 12px; }
        .bgc-empty-title { font-size: 16px; font-weight: 700; color: #1a1a1a; margin-bottom: 6px; }
        .bgc-empty-sub { font-size: 13px; color: #9b9b9b; margin-bottom: 18px; }
        .bgc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
        .bgc-card { background: #fff; border-radius: 12px; border: 1px solid #e8e5de; padding: 16px 18px; cursor: pointer; transition: all 0.15s; }
        .bgc-card:hover { border-color: #8C1D40; box-shadow: 0 2px 16px rgba(140,29,64,0.1); transform: translateY(-1px); }
        .bgc-card-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 10px; }
        .bgc-card-av { width: 38px; height: 38px; border-radius: 50%; background: #8C1D40; color: #FFC627; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .bgc-card-name { font-size: 14px; font-weight: 700; color: #1a1a1a; }
        .bgc-card-email { font-size: 11px; color: #9b9b9b; margin-top: 2px; }
        .bgc-card-date { font-size: 10px; color: #b0a898; }
        .bgc-checks-row { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
        .bgc-dot { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 20px; font-size: 10px; font-weight: 600; border: 1px solid; }
        .dot-clear { color: #10b981; background: rgba(16,185,129,0.08); border-color: rgba(16,185,129,0.25); }
        .dot-notclear { color: #ef4444; background: rgba(239,68,68,0.06); border-color: rgba(239,68,68,0.2); }
        .dot-pending { color: #9b9b9b; background: #f5f4f0; border-color: #e8e5de; }
        .bgc-score { font-size: 11px; font-weight: 700; color: #3a3a3a; }

        /* Modal */
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 500; display: flex; align-items: flex-end; justify-content: center; padding: 0; backdrop-filter: blur(3px); }
        @media(min-width:600px) { .modal-overlay { align-items: center; padding: 24px; } }
        .modal-sheet { background: #fff; width: 100%; max-width: 520px; border-radius: 20px 20px 0 0; padding: 0 0 env(safe-area-inset-bottom); animation: sheetUp 0.28s cubic-bezier(0.32,0.72,0,1); max-height: 88vh; overflow-y: auto; }
        @media(min-width:600px) { .modal-sheet { border-radius: 20px; } }
        @keyframes sheetUp { from{transform:translateY(40px);opacity:0} to{transform:translateY(0);opacity:1} }
        .modal-handle { width: 36px; height: 4px; background: #e0ddd7; border-radius: 2px; margin: 10px auto 0; }
        .modal-hdr { padding: 20px 24px 0; display: flex; align-items: center; justify-content: space-between; }
        .modal-title { font-size: 18px; font-weight: 700; color: #1a1a1a; }
        .modal-sub { font-size: 13px; color: #9b9b9b; margin-top: 3px; }
        .modal-body { padding: 16px 24px; }
        .modal-ftr { padding: 8px 24px 24px; display: flex; gap: 10px; }
        .search-input { width: 100%; border: 1.5px solid #e8e5de; border-radius: 10px; padding: 10px 13px; font-size: 14px; color: #1a1a1a; font-family: 'DM Sans', sans-serif; background: #faf9f6; outline: none; transition: border-color 0.15s; margin-bottom: 10px; }
        .search-input:focus { border-color: #8C1D40; background: #fff; }
        .lead-option { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 9px; border: 1.5px solid #e8e5de; background: #fff; cursor: pointer; transition: all 0.15s; margin-bottom: 6px; }
        .lead-option:hover { border-color: #8C1D40; background: #fdf2f5; }
        .lead-option.selected { border-color: #8C1D40; background: #fdf2f5; }
        .lead-option-av { width: 32px; height: 32px; border-radius: 50%; background: #8C1D40; color: #FFC627; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .lead-option-name { font-size: 13px; font-weight: 600; color: #1a1a1a; }
        .lead-option-sub { font-size: 11px; color: #9b9b9b; margin-top: 1px; }
        .lead-option-badge { margin-left: auto; font-size: 10px; color: #b0a898; background: #f5f4f0; border: 1px solid #e8e5de; border-radius: 20px; padding: 2px 8px; flex-shrink: 0; }
        .btn-primary { background: #8C1D40; color: #fff; border: none; border-radius: 9px; padding: 10px 18px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-ghost { background: transparent; color: #3a3a3a; border: 1.5px solid #e8e5de; border-radius: 9px; padding: 10px 16px; font-size: 13px; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .leads-list { max-height: 320px; overflow-y: auto; }
      `}</style>

      <div className="bgc-page">
        <div className="bgc-header">
          <div>
            <div className="bgc-title">Background Checks</div>
            <div className="bgc-sub">{checks.length} check{checks.length !== 1 ? 's' : ''} on file</div>
          </div>
          <button className="bgc-btn-new" onClick={() => setNewModal(true)}>
            + New Background Check
          </button>
        </div>

        {checks.length === 0 ? (
          <div className="bgc-empty">
            <div className="bgc-empty-icon">🔍</div>
            <div className="bgc-empty-title">No background checks yet</div>
            <div className="bgc-empty-sub">Start a check by assigning it to a lead.</div>
            <button className="bgc-btn-new" onClick={() => setNewModal(true)}>
              + Start First Check
            </button>
          </div>
        ) : (
          <div className="bgc-grid">
            {checks.map(c => {
              const lead = c.leads
              const initials = ((lead?.first_name?.[0] || '') + (lead?.last_name?.[0] || '')).toUpperCase() || (lead?.email?.[0]?.toUpperCase() || '?')
              const score = checkScore(c)
              const checkFields: { label: string; value: string | null }[] = [
                { label: 'Employment', value: c.employment_check },
                { label: 'Residence', value: c.current_residence_check },
                { label: 'Criminal', value: c.criminal_check },
                { label: 'Eviction', value: c.eviction_check },
              ]
              return (
                <div key={c.id} className="bgc-card" onClick={() => router.push(`/landlord/background-checks/${c.id}`)}>
                  <div className="bgc-card-top">
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <div className="bgc-card-av">{initials}</div>
                      <div>
                        <div className="bgc-card-name">
                          {lead?.first_name || lead?.last_name ? `${lead?.first_name || ''} ${lead?.last_name || ''}`.trim() : lead?.email}
                        </div>
                        <div className="bgc-card-email">{lead?.email}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="bgc-card-date">{timeAgo(c.updated_at || c.created_at)}</div>
                      <div className="bgc-score" style={{ marginTop: '4px', color: score.passed === score.total ? '#10b981' : score.passed > 0 ? '#f97316' : '#9b9b9b' }}>
                        {score.passed}/{score.total} clear
                      </div>
                    </div>
                  </div>

                  <div className="bgc-checks-row">
                    {checkFields.map(f => (
                      <span key={f.label} className={`bgc-dot ${f.value === 'clear' ? 'dot-clear' : f.value === 'not_clear' ? 'dot-notclear' : 'dot-pending'}`}>
                        {f.value === 'clear' ? '✓' : f.value === 'not_clear' ? '✕' : '○'} {f.label}
                      </span>
                    ))}
                    {c.cosigner && (
                      <span className="bgc-dot" style={{ color: '#8b5cf6', background: 'rgba(139,92,246,0.08)', borderColor: 'rgba(139,92,246,0.25)' }}>
                        Cosigner: {c.cosigner === 'need_cosigner' ? 'Needed' : c.cosigner === 'pending' ? 'Pending' : c.cosigner === 'yes' ? 'Yes' : 'No'}
                      </span>
                    )}
                    {c.credit && (
                      <span className="bgc-dot" style={{
                        color: c.credit === 'great' ? '#10b981' : c.credit === 'average' ? '#f97316' : '#ef4444',
                        background: c.credit === 'great' ? 'rgba(16,185,129,0.08)' : c.credit === 'average' ? 'rgba(249,115,22,0.08)' : 'rgba(239,68,68,0.06)',
                        borderColor: c.credit === 'great' ? 'rgba(16,185,129,0.25)' : c.credit === 'average' ? 'rgba(249,115,22,0.25)' : 'rgba(239,68,68,0.2)',
                      }}>
                        Credit: {c.credit.charAt(0).toUpperCase() + c.credit.slice(1)}
                      </span>
                    )}
                  </div>
                  {lead?.property && (
                    <div style={{ marginTop: '8px', fontSize: '11px', color: '#b0a898' }}>📍 {lead.property}</div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── NEW CHECK MODAL ── */}
      {newModal && (
        <div className="modal-overlay" onClick={() => { setNewModal(false); setSelectedLead(''); setLeadSearch('') }}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="modal-hdr">
              <div>
                <div className="modal-title">Start Background Check</div>
                <div className="modal-sub">Select the lead to run this check on</div>
              </div>
              <button onClick={() => { setNewModal(false); setSelectedLead(''); setLeadSearch('') }} style={{ background: '#f0ede6', border: 'none', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', fontSize: '14px', color: '#6b6b6b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
            <div className="modal-body">
              <input
                className="search-input"
                placeholder="Search by name or email…"
                value={leadSearch}
                onChange={e => setLeadSearch(e.target.value)}
                autoFocus
              />
              <div className="leads-list">
                {filteredLeads.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: '#9b9b9b', fontSize: '13px' }}>No leads found</div>
                ) : (
                  filteredLeads.map(l => {
                    const initials = ((l.first_name?.[0] || '') + (l.last_name?.[0] || '')).toUpperCase() || l.email[0].toUpperCase()
                    const hasCheck = existingLeadIds.has(l.id)
                    return (
                      <div
                        key={l.id}
                        className={`lead-option${selectedLead === l.id ? ' selected' : ''}`}
                        onClick={() => setSelectedLead(l.id)}
                      >
                        <div className="lead-option-av">{initials}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="lead-option-name">
                            {l.first_name || l.last_name ? `${l.first_name || ''} ${l.last_name || ''}`.trim() : l.email}
                          </div>
                          <div className="lead-option-sub">{l.email}{l.property ? ` · ${l.property}` : ''}</div>
                        </div>
                        {hasCheck && <span className="lead-option-badge">Has check</span>}
                        {selectedLead === l.id && <span style={{ color: '#8C1D40', fontSize: '16px', flexShrink: 0 }}>✓</span>}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
            <div className="modal-ftr">
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => { setNewModal(false); setSelectedLead(''); setLeadSearch('') }}>Cancel</button>
              <button
                className="btn-primary"
                style={{ flex: 2 }}
                disabled={!selectedLead || creating}
                onClick={handleCreate}
              >
                {creating ? 'Creating…' : 'Start Check →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
