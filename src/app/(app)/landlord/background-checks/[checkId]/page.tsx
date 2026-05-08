'use client'

import { useState, useEffect, use } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { formatPhoneDisplay } from '@/components/ui/PhoneInput'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Lead = {
  id: string; first_name: string | null; last_name: string | null
  email: string; phone: string | null; property: string | null
  status: string | null; move_in_date: string | null; created_at: string | null
}

type Reference = {
  id: string; bg_check_id: string; type: 'employer' | 'residence'
  name: string | null; phone: string | null; email: string | null
  address: string | null; contact_date: string | null
  status: 'pending' | 'contacted' | 'verified' | 'unverified'
  notes: string | null; created_at: string
}

type BgCheck = {
  id: string; lead_id: string; landlord_id: string
  is_student: boolean | null
  cosigner: 'yes' | 'no' | 'pending' | 'need_cosigner' | null
  credit: 'great' | 'average' | 'poor' | null
  employment_check: 'clear' | 'not_clear' | null
  current_residence_check: 'clear' | 'not_clear' | null
  criminal_check: 'clear' | 'not_clear' | null
  eviction_check: 'clear' | 'not_clear' | null
  notes: string | null
  created_at: string; updated_at: string
  leads: Lead | null
  bg_check_references: Reference[]
}

// ── Template questions ────────────────────────────────────────────────────────
const EMPLOYER_QUESTIONS = [
  'Can you confirm [Name] is currently employed at your company?',
  'What is their job title and employment start date?',
  'Is their employment full-time, part-time, or contract?',
  'What is their approximate gross monthly income?',
  'Is their employment in good standing with no pending termination?',
  'Are there any garnishments or liens on their wages?',
]

const RESIDENCE_QUESTIONS = [
  'Can you confirm [Name] resided at [Address] from [Start] to [End]?',
  'Did they pay rent on time consistently?',
  'Were there any noise complaints, violations, or lease infractions?',
  'Did they leave the unit in good condition upon move-out?',
  'Would you rent to this tenant again?',
  'Was the security deposit returned in full? If not, why?',
]

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function ToggleGroup({ label, value, options, onChange }: {
  label: string
  value: string | null | boolean
  options: { value: string | boolean; label: string; color?: string; bg?: string; border?: string }[]
  onChange: (v: any) => void
}) {
  return (
    <div style={{ marginBottom: '18px' }}>
      <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px' }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
        {options.map(opt => {
          const isSelected = value === opt.value
          return (
            <button
              key={String(opt.value)}
              onClick={() => onChange(isSelected ? null : opt.value)}
              style={{
                padding: '7px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: isSelected ? 700 : 500,
                border: `2px solid ${isSelected ? (opt.border || '#8C1D40') : '#e8e5de'}`,
                background: isSelected ? (opt.bg || '#fdf2f5') : '#fff',
                color: isSelected ? (opt.color || '#8C1D40') : '#6b6b6b',
                cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'all 0.15s',
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ClearToggle({ label, value, onChange }: { label: string; value: 'clear' | 'not_clear' | null; onChange: (v: any) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', background: '#fff', border: '1px solid #f0ede6', borderRadius: '9px', marginBottom: '8px' }}>
      <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{label}</span>
      <div style={{ display: 'flex', gap: '6px' }}>
        <button
          onClick={() => onChange(value === 'clear' ? null : 'clear')}
          style={{
            padding: '5px 12px', borderRadius: '7px', fontSize: '12px', fontWeight: 600,
            border: `1.5px solid ${value === 'clear' ? 'rgba(16,185,129,0.4)' : '#e8e5de'}`,
            background: value === 'clear' ? 'rgba(16,185,129,0.08)' : '#faf9f6',
            color: value === 'clear' ? '#10b981' : '#9b9b9b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'all 0.15s',
          }}
        >✓ Clear</button>
        <button
          onClick={() => onChange(value === 'not_clear' ? null : 'not_clear')}
          style={{
            padding: '5px 12px', borderRadius: '7px', fontSize: '12px', fontWeight: 600,
            border: `1.5px solid ${value === 'not_clear' ? 'rgba(239,68,68,0.4)' : '#e8e5de'}`,
            background: value === 'not_clear' ? 'rgba(239,68,68,0.06)' : '#faf9f6',
            color: value === 'not_clear' ? '#ef4444' : '#9b9b9b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'all 0.15s',
          }}
        >✕ Not Clear</button>
      </div>
    </div>
  )
}

export default function BgCheckDetailPage({ params }: { params: Promise<{ checkId: string }> }) {
  const { checkId } = use(params)
  const router = useRouter()

  const [check, setCheck] = useState<BgCheck | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // Local form state (mirrors check fields)
  const [form, setForm] = useState({
    is_student: null as boolean | null,
    cosigner: null as string | null,
    credit: null as string | null,
    employment_check: null as string | null,
    current_residence_check: null as string | null,
    criminal_check: null as string | null,
    eviction_check: null as string | null,
    notes: '',
  })

  // References state
  const [refs, setRefs] = useState<Reference[]>([])
  const [addingRef, setAddingRef] = useState(false)
  const [refType, setRefType] = useState<'employer' | 'residence'>('employer')
  const [refForm, setRefForm] = useState({ name: '', phone: '', email: '', address: '', contact_date: '', notes: '' })
  const [savingRef, setSavingRef] = useState(false)
  const [expandedRef, setExpandedRef] = useState<string | null>(null)
  const [editingRef, setEditingRef] = useState<string | null>(null)
  const [editRefForm, setEditRefForm] = useState<Partial<Reference>>({})
  const [templateModal, setTemplateModal] = useState<{ type: 'employer' | 'residence'; refName?: string } | null>(null)
  const [copiedQ, setCopiedQ] = useState<number | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }

      const res = await fetch(`/api/background-checks/${checkId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) { setNotFound(true); setLoading(false); return }

      const { check: c } = await res.json()
      setCheck(c)
      setRefs(c.bg_check_references || [])
      setForm({
        is_student: c.is_student,
        cosigner: c.cosigner,
        credit: c.credit,
        employment_check: c.employment_check,
        current_residence_check: c.current_residence_check,
        criminal_check: c.criminal_check,
        eviction_check: c.eviction_check,
        notes: c.notes || '',
      })
      setLoading(false)
    }
    load()
  }, [checkId, router])

  const handleSave = async () => {
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/background-checks/${checkId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(form),
    })
    if (res.ok) {
      const { check: c } = await res.json()
      setCheck(prev => prev ? { ...prev, ...c } : prev)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      showToast('Saved')
    } else {
      showToast('Failed to save', 'error')
    }
    setSaving(false)
  }

  const handleAddRef = async () => {
    setSavingRef(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/background-checks/${checkId}/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ type: refType, ...refForm, contact_date: refForm.contact_date || null }),
    })
    if (res.ok) {
      const { reference } = await res.json()
      setRefs(prev => [...prev, reference])
      setAddingRef(false)
      setRefForm({ name: '', phone: '', email: '', address: '', contact_date: '', notes: '' })
      showToast(`${refType === 'employer' ? 'Employer' : 'Residence'} reference added`)
    } else {
      showToast('Failed to add reference', 'error')
    }
    setSavingRef(false)
  }

  const handleUpdateRef = async (refId: string) => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/background-checks/${checkId}/references`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ refId, ...editRefForm }),
    })
    if (res.ok) {
      const { reference } = await res.json()
      setRefs(prev => prev.map(r => r.id === refId ? reference : r))
      setEditingRef(null)
      showToast('Reference updated')
    } else {
      showToast('Failed to update', 'error')
    }
  }

  const handleDeleteRef = async (refId: string) => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/background-checks/${checkId}/references?refId=${refId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    if (res.ok) {
      setRefs(prev => prev.filter(r => r.id !== refId))
      showToast('Removed')
    }
  }

  const handleRefStatusUpdate = async (refId: string, status: Reference['status']) => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/background-checks/${checkId}/references`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ refId, status }),
    })
    if (res.ok) {
      const { reference } = await res.json()
      setRefs(prev => prev.map(r => r.id === refId ? reference : r))
    }
  }

  if (loading) return (
    <div style={{ padding: '32px', fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&display=swap'); @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
      {[1,2,3,4].map(i => <div key={i} style={{ height: '72px', borderRadius: '10px', marginBottom: '10px', background: 'linear-gradient(90deg,#f0ede6 25%,#faf9f6 50%,#f0ede6 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s infinite' }} />)}
    </div>
  )

  if (notFound || !check) return (
    <div style={{ padding: '60px 32px', textAlign: 'center', fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ fontSize: '18px', fontWeight: 600, color: '#1a1a1a', marginBottom: '8px' }}>Check not found</div>
      <button onClick={() => router.push('/landlord/background-checks')} style={{ color: '#8C1D40', background: 'none', border: 'none', fontSize: '14px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>← Back</button>
    </div>
  )

  const lead = check.leads
  const initials = ((lead?.first_name?.[0] || '') + (lead?.last_name?.[0] || '')).toUpperCase() || lead?.email?.[0]?.toUpperCase() || '?'
  const employers = refs.filter(r => r.type === 'employer')
  const residences = refs.filter(r => r.type === 'residence')

  const STATUS_COLORS: Record<Reference['status'], { color: string; bg: string; border: string; label: string }> = {
    pending:    { color: '#9b9b9b', bg: '#f5f4f0',                  border: '#e8e5de',              label: 'Pending' },
    contacted:  { color: '#f97316', bg: 'rgba(249,115,22,0.08)',    border: 'rgba(249,115,22,0.3)', label: 'Contacted' },
    verified:   { color: '#10b981', bg: 'rgba(16,185,129,0.08)',    border: 'rgba(16,185,129,0.3)', label: 'Verified' },
    unverified: { color: '#ef4444', bg: 'rgba(239,68,68,0.06)',     border: 'rgba(239,68,68,0.25)', label: 'Unverified' },
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .bgd-page { background: #f5f4f0; min-height: 100vh; font-family: 'DM Sans', sans-serif; }

        .bgd-hdr { background: #fff; border-bottom: 1px solid #e8e5de; padding: 12px 24px; display: flex; align-items: center; gap: 12px; }
        .bgd-back { font-size: 12px; color: #9b9b9b; background: none; border: none; cursor: pointer; font-family: 'DM Sans', sans-serif; padding: 0; display: flex; align-items: center; gap: 4px; }
        .bgd-back:hover { color: #1a1a1a; }
        .bgd-hdr-title { font-size: 16px; font-weight: 700; color: #1a1a1a; }
        .bgd-hdr-sub { font-size: 11px; color: #9b9b9b; }

        .bgd-body { padding: 20px 24px 60px; display: grid; grid-template-columns: 1fr 360px; gap: 16px; align-items: start; max-width: 1200px; }
        @media(max-width:900px) { .bgd-body { grid-template-columns: 1fr; } }

        .bgd-card { background: #fff; border-radius: 12px; border: 1px solid #e8e5de; margin-bottom: 14px; overflow: hidden; }
        .bgd-card-hd { padding: 11px 16px; border-bottom: 1px solid #f0ede6; display: flex; align-items: center; justify-content: space-between; }
        .bgd-card-ttl { font-size: 10px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.7px; }
        .bgd-card-bd { padding: 14px 16px; }

        .lead-banner { background: #1a1a1a; border-radius: 12px; padding: 16px 20px; margin-bottom: 14px; display: flex; align-items: center; gap: 14px; }
        .lead-av { width: 44px; height: 44px; border-radius: 50%; background: #8C1D40; color: #FFC627; font-size: 15px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .lead-name { font-size: 16px; font-weight: 700; color: #fff; }
        .lead-sub { font-size: 12px; color: rgba(255,255,255,0.55); margin-top: 2px; }
        .lead-prop { font-size: 11px; color: #FFC627; margin-top: 3px; font-weight: 600; }

        .kv-row { display: flex; justify-content: space-between; align-items: baseline; padding: 6px 0; border-bottom: 1px solid #f5f4f0; gap: 8px; }
        .kv-row:last-child { border-bottom: none; }
        .kv-l { font-size: 11px; color: #9b9b9b; flex-shrink: 0; }
        .kv-r { font-size: 12px; color: #1a1a1a; font-weight: 500; text-align: right; }

        .ref-item { border: 1px solid #f0ede6; border-radius: 10px; margin-bottom: 8px; overflow: hidden; }
        .ref-item-hd { padding: 10px 14px; display: flex; align-items: center; gap: 10px; cursor: pointer; background: #faf9f6; }
        .ref-item-hd:hover { background: #f5f3f0; }
        .ref-icon { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
        .ref-name { font-size: 13px; font-weight: 600; color: #1a1a1a; }
        .ref-sub { font-size: 11px; color: #9b9b9b; margin-top: 1px; }
        .ref-status-badge { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 20px; font-size: 10px; font-weight: 700; border: 1px solid; margin-left: auto; flex-shrink: 0; }
        .ref-bd { padding: 12px 14px; border-top: 1px solid #f0ede6; background: #fff; }

        .status-cycle { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 10px; }
        .status-opt { padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1.5px solid; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; background: #fff; }

        .template-q { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border: 1px solid #f0ede6; border-radius: 8px; margin-bottom: 7px; background: #faf9f6; cursor: pointer; transition: all 0.15s; }
        .template-q:hover { border-color: #8C1D40; background: #fdf2f5; }
        .template-q-text { font-size: 13px; color: #1a1a1a; line-height: 1.5; flex: 1; }

        .notes-area { width: 100%; border: 1.5px solid #e8e5de; border-radius: 10px; padding: 11px 13px; font-size: 13px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; resize: vertical; outline: none; min-height: 100px; background: #faf9f6; line-height: 1.6; transition: border-color 0.15s; }
        .notes-area:focus { border-color: #8C1D40; background: #fff; }

        .edit-input { width: 100%; border: 1.5px solid #e8e5de; border-radius: 9px; padding: 9px 12px; font-size: 13px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; background: #faf9f6; outline: none; transition: border-color 0.15s; margin-bottom: 8px; }
        .edit-input:focus { border-color: #8C1D40; background: #fff; }
        .edit-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

        .btn-save { background: #8C1D40; color: #fff; border: none; border-radius: 9px; padding: 10px 22px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; }
        .btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-save:hover:not(:disabled) { opacity: 0.88; }
        .btn-ghost-sm { background: transparent; color: #6b6b6b; border: 1.5px solid #e8e5de; border-radius: 8px; padding: 8px 14px; font-size: 12px; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-add-ref { width: 100%; padding: 9px; background: #faf9f6; border: 1.5px dashed #d0cdc5; border-radius: 9px; font-size: 13px; font-weight: 600; color: #6b6b6b; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; margin-top: 6px; }
        .btn-add-ref:hover { border-color: #8C1D40; color: #8C1D40; background: #fdf2f5; }

        .add-ref-form { background: #faf9f6; border: 1.5px solid #e8e5de; border-radius: 11px; padding: 14px; margin-bottom: 10px; }
        .add-ref-type-row { display: flex; gap: 8px; margin-bottom: 12px; }
        .type-btn { flex: 1; padding: 8px; border: 2px solid #e8e5de; border-radius: 8px; background: #fff; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; }
        .type-btn.active { border-color: #8C1D40; background: #fdf2f5; color: #8C1D40; }

        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 600; display: flex; align-items: center; justify-content: center; padding: 24px; backdrop-filter: blur(4px); }
        .modal-box { background: #fff; border-radius: 16px; width: 100%; max-width: 520px; max-height: 88vh; overflow-y: auto; padding: 28px; box-shadow: 0 24px 80px rgba(0,0,0,0.25); }
        .modal-ttl { font-size: 18px; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }
        .modal-sub { font-size: 13px; color: #9b9b9b; margin-bottom: 18px; }

        .toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); padding: 10px 18px; border-radius: 10px; font-size: 13px; font-weight: 500; z-index: 999; white-space: nowrap; box-shadow: 0 4px 20px rgba(0,0,0,0.2); animation: toastIn 0.2s ease; }
        @keyframes toastIn { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }

        .progress-bar-wrap { height: 5px; background: #f0ede6; border-radius: 3px; overflow: hidden; margin-top: 10px; }
        .progress-bar-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }
      `}</style>

      <div className="bgd-page">

        {toast && (
          <div className="toast" style={{ background: toast.type === 'success' ? '#1a1a1a' : '#8C1D40', color: '#fff' }}>
            {toast.type === 'success' ? '✓ ' : '✕ '}{toast.msg}
          </div>
        )}

        {/* Header */}
        <div className="bgd-hdr">
          <button className="bgd-back" onClick={() => router.push('/landlord/background-checks')}>← Background Checks</button>
          <div style={{ flex: 1 }}>
            <div className="bgd-hdr-title">
              {lead?.first_name || lead?.last_name
                ? `${lead.first_name || ''} ${lead.last_name || ''}`.trim()
                : lead?.email} — Background Check
            </div>
            <div className="bgd-hdr-sub">Started {timeAgo(check.created_at)}{check.updated_at !== check.created_at ? ` · Updated ${timeAgo(check.updated_at)}` : ''}</div>
          </div>
          <button
            className="btn-save"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Changes'}
          </button>
        </div>

        <div className="bgd-body">

          {/* LEFT COLUMN */}
          <div>

            {/* Lead banner */}
            <div className="lead-banner">
              <div className="lead-av">{initials}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="lead-name">
                  {lead?.first_name || lead?.last_name
                    ? `${lead?.first_name || ''} ${lead?.last_name || ''}`.trim()
                    : lead?.email}
                </div>
                <div className="lead-sub">
                  {lead?.email}
                  {lead?.phone ? ` · +1 ${formatPhoneDisplay(lead.phone)}` : ''}
                </div>
                {lead?.property && <div className="lead-prop">📍 {lead.property}</div>}
              </div>
              <button
                onClick={() => lead && window.open(`/landlord/leads/${lead.id}`, '_blank')}
                style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', padding: '7px 13px', fontSize: '12px', fontWeight: 600, color: '#fff', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                View Lead →
              </button>
            </div>

            {/* ── Checklist ── */}
            <div className="bgd-card">
              <div className="bgd-card-hd">
                <span className="bgd-card-ttl">Screening Checklist</span>
                {(() => {
                  const fields = [
                    check.employment_check, check.current_residence_check,
                    check.criminal_check, check.eviction_check,
                  ]
                  const done = fields.filter(Boolean).length
                  const allClear = fields.every(f => f === 'clear')
                  return (
                    <span style={{ fontSize: '11px', fontWeight: 700, color: allClear ? '#10b981' : done > 0 ? '#f97316' : '#9b9b9b' }}>
                      {done}/{fields.length} reviewed
                    </span>
                  )
                })()}
              </div>
              <div className="bgd-card-bd">

                <ToggleGroup
                  label="Student"
                  value={form.is_student}
                  options={[
                    { value: true,  label: '✓ Yes — Student',     color: '#3b82f6', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.4)' },
                    { value: false, label: '✕ No — Not a Student', color: '#6b6b6b', bg: '#f5f4f0',              border: '#d0cdc5' },
                  ]}
                  onChange={v => setForm(f => ({ ...f, is_student: v }))}
                />

                <ToggleGroup
                  label="Cosigner"
                  value={form.cosigner}
                  options={[
                    { value: 'yes',          label: '✓ Has Cosigner',   color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.4)' },
                    { value: 'no',           label: '✕ No Cosigner',    color: '#6b6b6b', bg: '#f5f4f0',               border: '#d0cdc5' },
                    { value: 'pending',      label: '⏳ Pending',        color: '#f97316', bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.4)' },
                    { value: 'need_cosigner',label: '⚠ Need Cosigner',  color: '#dc2626', bg: 'rgba(220,38,38,0.06)', border: 'rgba(220,38,38,0.35)' },
                  ]}
                  onChange={v => setForm(f => ({ ...f, cosigner: v }))}
                />

                <ToggleGroup
                  label="Credit"
                  value={form.credit}
                  options={[
                    { value: 'great',   label: '★ Great',   color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.4)' },
                    { value: 'average', label: '◑ Average', color: '#f97316', bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.4)' },
                    { value: 'poor',    label: '▽ Poor',    color: '#ef4444', bg: 'rgba(239,68,68,0.06)',  border: 'rgba(239,68,68,0.35)' },
                  ]}
                  onChange={v => setForm(f => ({ ...f, credit: v }))}
                />

                <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px' }}>Verification Checks</div>

                <ClearToggle
                  label="Employment"
                  value={form.employment_check as any}
                  onChange={v => setForm(f => ({ ...f, employment_check: v }))}
                />
                <ClearToggle
                  label="Current Residence"
                  value={form.current_residence_check as any}
                  onChange={v => setForm(f => ({ ...f, current_residence_check: v }))}
                />
                <ClearToggle
                  label="Criminal"
                  value={form.criminal_check as any}
                  onChange={v => setForm(f => ({ ...f, criminal_check: v }))}
                />
                <ClearToggle
                  label="Eviction"
                  value={form.eviction_check as any}
                  onChange={v => setForm(f => ({ ...f, eviction_check: v }))}
                />

                {/* Progress bar */}
                {(() => {
                  const fields = [form.employment_check, form.current_residence_check, form.criminal_check, form.eviction_check]
                  const cleared = fields.filter(f => f === 'clear').length
                  const flagged = fields.filter(f => f === 'not_clear').length
                  const pct = (fields.filter(Boolean).length / fields.length) * 100
                  return (
                    <div style={{ marginTop: '14px' }}>
                      <div className="progress-bar-wrap">
                        <div className="progress-bar-fill" style={{
                          width: `${pct}%`,
                          background: flagged > 0 ? '#ef4444' : cleared === fields.length ? '#10b981' : '#f97316',
                        }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px', fontSize: '10px', color: '#9b9b9b' }}>
                        <span>{cleared} clear · {flagged} flagged · {fields.length - fields.filter(Boolean).length} pending</span>
                        <span style={{ fontWeight: 600, color: flagged > 0 ? '#ef4444' : cleared === fields.length ? '#10b981' : '#f97316' }}>
                          {flagged > 0 ? '⚠ Review Required' : cleared === fields.length ? '✓ All Clear' : `${Math.round(pct)}% complete`}
                        </span>
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>

            {/* ── Notes ── */}
            <div className="bgd-card">
              <div className="bgd-card-hd">
                <span className="bgd-card-ttl">Notes</span>
              </div>
              <div className="bgd-card-bd">
                <textarea
                  className="notes-area"
                  placeholder="Add internal notes — SSN verified, ID reviewed, red flags, follow-up items…"
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                  <button className="btn-save" disabled={saving} onClick={handleSave}>
                    {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
                  </button>
                </div>
              </div>
            </div>

          </div>

          {/* RIGHT COLUMN */}
          <div>

            {/* Lead quick info */}
            <div className="bgd-card">
              <div className="bgd-card-hd"><span className="bgd-card-ttl">Lead Details</span></div>
              <div className="bgd-card-bd">
                <div className="kv-row"><span className="kv-l">Name</span><span className="kv-r">{lead?.first_name || '—'}{lead?.last_name ? ` ${lead.last_name}` : ''}</span></div>
                <div className="kv-row"><span className="kv-l">Email</span><span className="kv-r"><a href={`mailto:${lead?.email}`} style={{ color: '#8C1D40', textDecoration: 'none' }}>{lead?.email}</a></span></div>
                {lead?.phone && <div className="kv-row"><span className="kv-l">Phone</span><span className="kv-r">+1 {formatPhoneDisplay(lead.phone)}</span></div>}
                {lead?.property && <div className="kv-row"><span className="kv-l">Property</span><span className="kv-r">{lead.property}</span></div>}
                {lead?.move_in_date && <div className="kv-row"><span className="kv-l">Move-in</span><span className="kv-r">{new Date(lead.move_in_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>}
                {lead?.status && <div className="kv-row"><span className="kv-l">Status</span><span className="kv-r" style={{ textTransform: 'capitalize' }}>{lead.status.replace(/_/g, ' ')}</span></div>}
              </div>
            </div>

            {/* ── Employer References ── */}
            <div className="bgd-card">
              <div className="bgd-card-hd">
                <span className="bgd-card-ttl">Employer Verification</span>
                <button
                  onClick={() => setTemplateModal({ type: 'employer' })}
                  style={{ fontSize: '11px', color: '#8C1D40', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                >
                  📋 Templates
                </button>
              </div>
              <div className="bgd-card-bd">
                {employers.length === 0 && !addingRef && (
                  <div style={{ textAlign: 'center', padding: '12px 0', fontSize: '12px', color: '#9b9b9b' }}>No employer contacts yet</div>
                )}
                {employers.map(ref => (
                  <RefCard
                    key={ref.id}
                    ref_={ref}
                    expanded={expandedRef === ref.id}
                    editing={editingRef === ref.id}
                    editForm={editRefForm}
                    statusColors={STATUS_COLORS}
                    onToggle={() => setExpandedRef(expandedRef === ref.id ? null : ref.id)}
                    onStatusChange={s => handleRefStatusUpdate(ref.id, s)}
                    onEdit={() => { setEditingRef(ref.id); setEditRefForm({ name: ref.name, phone: ref.phone, email: ref.email, address: ref.address, contact_date: ref.contact_date, notes: ref.notes }) }}
                    onEditChange={patch => setEditRefForm(prev => ({ ...prev, ...patch }))}
                    onEditSave={() => handleUpdateRef(ref.id)}
                    onEditCancel={() => setEditingRef(null)}
                    onDelete={() => handleDeleteRef(ref.id)}
                    onTemplate={() => setTemplateModal({ type: 'employer', refName: ref.name || undefined })}
                  />
                ))}

                {addingRef && refType === 'employer' && (
                  <AddRefForm
                    type="employer"
                    form={refForm}
                    saving={savingRef}
                    onChange={patch => setRefForm(f => ({ ...f, ...patch }))}
                    onSave={handleAddRef}
                    onCancel={() => { setAddingRef(false); setRefForm({ name: '', phone: '', email: '', address: '', contact_date: '', notes: '' }) }}
                  />
                )}

                <button
                  className="btn-add-ref"
                  onClick={() => { setRefType('employer'); setAddingRef(true) }}
                >
                  + Add Employer Contact
                </button>
              </div>
            </div>

            {/* ── Previous Residences ── */}
            <div className="bgd-card">
              <div className="bgd-card-hd">
                <span className="bgd-card-ttl">Previous Residences</span>
                <button
                  onClick={() => setTemplateModal({ type: 'residence' })}
                  style={{ fontSize: '11px', color: '#8C1D40', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                >
                  📋 Templates
                </button>
              </div>
              <div className="bgd-card-bd">
                {residences.length === 0 && !(addingRef && refType === 'residence') && (
                  <div style={{ textAlign: 'center', padding: '12px 0', fontSize: '12px', color: '#9b9b9b' }}>No previous residences added</div>
                )}
                {residences.map(ref => (
                  <RefCard
                    key={ref.id}
                    ref_={ref}
                    expanded={expandedRef === ref.id}
                    editing={editingRef === ref.id}
                    editForm={editRefForm}
                    statusColors={STATUS_COLORS}
                    onToggle={() => setExpandedRef(expandedRef === ref.id ? null : ref.id)}
                    onStatusChange={s => handleRefStatusUpdate(ref.id, s)}
                    onEdit={() => { setEditingRef(ref.id); setEditRefForm({ name: ref.name, phone: ref.phone, email: ref.email, address: ref.address, contact_date: ref.contact_date, notes: ref.notes }) }}
                    onEditChange={patch => setEditRefForm(prev => ({ ...prev, ...patch }))}
                    onEditSave={() => handleUpdateRef(ref.id)}
                    onEditCancel={() => setEditingRef(null)}
                    onDelete={() => handleDeleteRef(ref.id)}
                    onTemplate={() => setTemplateModal({ type: 'residence', refName: ref.name || undefined })}
                  />
                ))}

                {addingRef && refType === 'residence' && (
                  <AddRefForm
                    type="residence"
                    form={refForm}
                    saving={savingRef}
                    onChange={patch => setRefForm(f => ({ ...f, ...patch }))}
                    onSave={handleAddRef}
                    onCancel={() => { setAddingRef(false); setRefForm({ name: '', phone: '', email: '', address: '', contact_date: '', notes: '' }) }}
                  />
                )}

                <button
                  className="btn-add-ref"
                  onClick={() => { setRefType('residence'); setAddingRef(true) }}
                >
                  + Add Previous Residence
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── TEMPLATE MODAL ── */}
      {templateModal && (
        <div className="modal-overlay" onClick={() => setTemplateModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <div className="modal-ttl">
                  {templateModal.type === 'employer' ? '💼 Employer Verification' : '🏠 Previous Landlord'}
                  {templateModal.refName ? ` — ${templateModal.refName}` : ''}
                </div>
                <div className="modal-sub">
                  Click any question to copy it. Fill in the [brackets] before sending.
                </div>
              </div>
              <button onClick={() => setTemplateModal(null)} style={{ background: 'none', border: 'none', fontSize: '18px', color: '#9b9b9b', cursor: 'pointer', padding: '2px', lineHeight: 1 }}>✕</button>
            </div>

            {(templateModal.type === 'employer' ? EMPLOYER_QUESTIONS : RESIDENCE_QUESTIONS).map((q, i) => (
              <div
                key={i}
                className="template-q"
                onClick={() => {
                  navigator.clipboard.writeText(q)
                  setCopiedQ(i)
                  setTimeout(() => setCopiedQ(null), 1800)
                }}
              >
                <span style={{ fontSize: '16px', flexShrink: 0 }}>{copiedQ === i ? '✓' : '📋'}</span>
                <span className="template-q-text">{q}</span>
                <span style={{ fontSize: '10px', color: copiedQ === i ? '#10b981' : '#b0a898', flexShrink: 0, fontWeight: 600 }}>
                  {copiedQ === i ? 'Copied!' : 'Copy'}
                </span>
              </div>
            ))}

            <button
              onClick={() => setTemplateModal(null)}
              style={{ marginTop: '12px', width: '100%', background: '#f5f4f0', border: 'none', borderRadius: '9px', padding: '10px', fontSize: '13px', color: '#6b6b6b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RefCard({ ref_, expanded, editing, editForm, statusColors, onToggle, onStatusChange, onEdit, onEditChange, onEditSave, onEditCancel, onDelete, onTemplate }: {
  ref_: Reference
  expanded: boolean
  editing: boolean
  editForm: Partial<Reference>
  statusColors: Record<Reference['status'], { color: string; bg: string; border: string; label: string }>
  onToggle: () => void
  onStatusChange: (s: Reference['status']) => void
  onEdit: () => void
  onEditChange: (patch: Partial<Reference>) => void
  onEditSave: () => void
  onEditCancel: () => void
  onDelete: () => void
  onTemplate: () => void
}) {
  const sc = statusColors[ref_.status]
  return (
    <div className="ref-item" style={{ marginBottom: '8px' }}>
      <div className="ref-item-hd" onClick={onToggle}>
        <div className="ref-icon" style={{ background: ref_.type === 'employer' ? 'rgba(59,130,246,0.1)' : 'rgba(16,185,129,0.1)' }}>
          {ref_.type === 'employer' ? '💼' : '🏠'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ref-name">{ref_.name || (ref_.type === 'employer' ? 'Employer' : 'Residence')}</div>
          <div className="ref-sub">
            {ref_.phone || ref_.email || ref_.address || '—'}
          </div>
        </div>
        <span className="ref-status-badge" style={{ color: sc.color, background: sc.bg, borderColor: sc.border }}>
          {sc.label}
        </span>
        <span style={{ color: '#9b9b9b', fontSize: '10px', marginLeft: '8px', flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="ref-bd">
          {editing ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px', marginBottom: '0' }}>
                <input className="edit-input" placeholder={ref_.type === 'employer' ? 'Company name' : 'Landlord / property name'} value={editForm.name || ''} onChange={e => onEditChange({ name: e.target.value })} />
                <input className="edit-input" placeholder="Phone" value={editForm.phone || ''} onChange={e => onEditChange({ phone: e.target.value })} />
                <input className="edit-input" placeholder="Email" value={editForm.email || ''} onChange={e => onEditChange({ email: e.target.value })} />
                <input className="edit-input" type="date" placeholder="Contact date" value={editForm.contact_date || ''} onChange={e => onEditChange({ contact_date: e.target.value })} />
              </div>
              <input className="edit-input" placeholder={ref_.type === 'employer' ? 'Company address (optional)' : 'Property address'} value={editForm.address || ''} onChange={e => onEditChange({ address: e.target.value })} />
              <textarea className="edit-input" rows={3} placeholder="Notes…" style={{ resize: 'vertical', minHeight: '60px' }} value={editForm.notes || ''} onChange={e => onEditChange({ notes: e.target.value })} />
              <div style={{ display: 'flex', gap: '7px' }}>
                <button onClick={onEditSave} style={{ flex: 2, background: '#8C1D40', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>Save</button>
                <button onClick={onEditCancel} className="btn-ghost-sm" style={{ flex: 1 }}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                {ref_.phone && <a href={`tel:${ref_.phone}`} style={{ fontSize: '12px', color: '#3b82f6', textDecoration: 'none' }}>📞 {ref_.phone}</a>}
                {ref_.email && <a href={`mailto:${ref_.email}`} style={{ fontSize: '12px', color: '#3b82f6', textDecoration: 'none' }}>✉ {ref_.email}</a>}
                {ref_.address && <span style={{ fontSize: '12px', color: '#6b6b6b' }}>📍 {ref_.address}</span>}
                {ref_.contact_date && <span style={{ fontSize: '12px', color: '#6b6b6b' }}>📅 Contacted {new Date(ref_.contact_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
              </div>
              {ref_.notes && (
                <div style={{ background: '#faf9f6', border: '1px solid #f0ede6', borderRadius: '7px', padding: '8px 10px', fontSize: '12px', color: '#4a4a4a', lineHeight: 1.55, marginBottom: '10px', fontStyle: 'italic' }}>
                  {ref_.notes}
                </div>
              )}

              <div style={{ fontSize: '10px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Status</div>
              <div className="status-cycle">
                {(['pending','contacted','verified','unverified'] as Reference['status'][]).map(s => {
                  const c = { pending: '#9b9b9b', contacted: '#f97316', verified: '#10b981', unverified: '#ef4444' }[s]
                  return (
                    <button
                      key={s}
                      className="status-opt"
                      style={{ color: ref_.status === s ? c : '#9b9b9b', borderColor: ref_.status === s ? c : '#e8e5de', background: ref_.status === s ? `${c}15` : '#fff' }}
                      onClick={() => onStatusChange(s)}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  )
                })}
              </div>

              <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                <button onClick={onTemplate} style={{ flex: 1, background: '#faf9f6', border: '1.5px solid #e8e5de', borderRadius: '7px', padding: '7px', fontSize: '11px', fontWeight: 600, color: '#6b6b6b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                  📋 Template Questions
                </button>
                <button onClick={onEdit} style={{ flex: 1, background: '#faf9f6', border: '1.5px solid #e8e5de', borderRadius: '7px', padding: '7px', fontSize: '11px', fontWeight: 600, color: '#6b6b6b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                  ✎ Edit
                </button>
                <button onClick={onDelete} style={{ background: 'rgba(239,68,68,0.06)', border: '1.5px solid rgba(239,68,68,0.25)', borderRadius: '7px', padding: '7px 10px', fontSize: '11px', fontWeight: 600, color: '#dc2626', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                  ✕
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function AddRefForm({ type, form, saving, onChange, onSave, onCancel }: {
  type: 'employer' | 'residence'
  form: { name: string; phone: string; email: string; address: string; contact_date: string; notes: string }
  saving: boolean
  onChange: (patch: Partial<typeof form>) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="add-ref-form">
      <div style={{ fontSize: '12px', fontWeight: 700, color: '#8C1D40', marginBottom: '10px' }}>
        {type === 'employer' ? '💼 Add Employer' : '🏠 Add Previous Residence'}
      </div>
      <div className="edit-row">
        <input className="edit-input" placeholder={type === 'employer' ? 'Company name' : 'Landlord / property name'} value={form.name} onChange={e => onChange({ name: e.target.value })} />
        <input className="edit-input" placeholder="Phone" value={form.phone} onChange={e => onChange({ phone: e.target.value })} />
        <input className="edit-input" placeholder="Email" value={form.email} onChange={e => onChange({ email: e.target.value })} />
        <input className="edit-input" type="date" value={form.contact_date} onChange={e => onChange({ contact_date: e.target.value })} />
      </div>
      <input className="edit-input" placeholder={type === 'employer' ? 'Company address (optional)' : 'Property address'} value={form.address} onChange={e => onChange({ address: e.target.value })} />
      <textarea className="edit-input" rows={2} placeholder="Notes…" style={{ resize: 'vertical' }} value={form.notes} onChange={e => onChange({ notes: e.target.value })} />
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={onSave} disabled={saving} style={{ flex: 2, background: saving ? '#9b9b9b' : '#8C1D40', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px', fontSize: '13px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
          {saving ? 'Adding…' : `Add ${type === 'employer' ? 'Employer' : 'Residence'}`}
        </button>
        <button onClick={onCancel} className="btn-ghost-sm">Cancel</button>
      </div>
    </div>
  )
}
