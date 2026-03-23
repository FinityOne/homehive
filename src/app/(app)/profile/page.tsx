'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type ProfileData = {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  role: string
  company_name: string | null
  verified: boolean
  onboarded: boolean
}

function splitName(full: string | null) {
  const parts = (full || '').trim().split(' ')
  return { first: parts[0] || '', last: parts.slice(1).join(' ') }
}

export default function ProfilePage() {
  const router = useRouter()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [resetSent, setResetSent] = useState(false)

  const [form, setForm] = useState({ first: '', last: '', phone: '', company_name: '' })

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (data) {
        setProfile({ ...data, email: user.email || '' })
        const { first, last } = splitName(data.full_name)
        setForm({ first, last, phone: data.phone || '', company_name: data.company_name || '' })
      }
      setLoading(false)
    }
    load()
  }, [router])

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const handleSave = async () => {
    if (!profile) return
    setSaving(true)
    const full_name = [form.first.trim(), form.last.trim()].filter(Boolean).join(' ')
    const { error } = await supabase
      .from('profiles')
      .update({ full_name, phone: form.phone.trim() || null, company_name: form.company_name.trim() || null })
      .eq('id', profile.id)
    setSaving(false)
    if (error) { showToast('Failed to save. Please try again.', 'error'); return }
    setProfile(prev => prev ? { ...prev, full_name, phone: form.phone || null } : prev)
    showToast('Profile updated!', 'success')
  }

  const handlePasswordReset = async () => {
    if (!profile?.email) return
    const { error } = await supabase.auth.resetPasswordForEmail(profile.email)
    if (!error) setResetSent(true)
  }

  const roleMeta = {
    admin:    { label: 'Admin',    bg: '#f3f0ff', color: '#6d28d9' },
    landlord: { label: 'Landlord', bg: '#f0fdf4', color: '#065f46' },
    tenant:   { label: 'Student',  bg: '#fdf2f5', color: '#8C1D40' },
  }[profile?.role || 'tenant'] ?? { label: 'Student', bg: '#fdf2f5', color: '#8C1D40' }

  if (loading) {
    return (
      <div style={{ padding: '60px 24px', fontFamily: "'DM Sans', sans-serif" }}>
        <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
        {[1,2,3].map(i => (
          <div key={i} style={{ height: '52px', borderRadius: '10px', marginBottom: '12px', background: 'linear-gradient(90deg,#f0ede6 25%,#faf9f6 50%,#f0ede6 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s infinite' }} />
        ))}
      </div>
    )
  }

  if (!profile) return null

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .prof-page  { max-width: 640px; margin: 0 auto; padding: 36px 24px 80px; font-family: 'DM Sans', sans-serif; }
        .prof-card  { background: #fff; border-radius: 16px; border: 1px solid #e8e5de; overflow: hidden; margin-bottom: 16px; }
        .prof-card-header { padding: 20px 24px; border-bottom: 1px solid #f0ede6; display: flex; align-items: center; gap: 12px; }
        .prof-section-title { font-size: 13px; font-weight: 600; color: #1a1a1a; }
        .prof-section-icon  { width: 34px; height: 34px; border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
        .prof-card-body  { padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; }
        .prof-row   { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .field-wrap { display: flex; flex-direction: column; gap: 5px; }
        .field-label { font-size: 11px; font-weight: 600; letter-spacing: .5px; text-transform: uppercase; color: #9b9b9b; }
        .field-input { padding: 10px 13px; border: 1.5px solid #e8e5de; border-radius: 9px; font-size: 14px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; background: #fff; outline: none; transition: border-color .15s; }
        .field-input:focus { border-color: #8C1D40; }
        .field-input::placeholder { color: #c5c1b8; }
        .field-input.readonly { background: #faf9f6; color: #9b9b9b; cursor: default; border-color: #f0ede6; }
        .field-hint { font-size: 11px; color: #c5c1b8; margin-top: 2px; }

        .save-btn { width: 100%; padding: 13px; background: #1a1a1a; color: #fff; border: none; border-radius: 9px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: background .2s; }
        .save-btn:hover:not(:disabled) { background: #333; }
        .save-btn:disabled { opacity: .6; cursor: not-allowed; }

        .toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); padding: 11px 20px; border-radius: 10px; font-size: 13px; font-weight: 500; font-family: 'DM Sans', sans-serif; z-index: 9999; white-space: nowrap; box-shadow: 0 4px 20px rgba(0,0,0,.15); animation: toastIn .2s ease; }
        @keyframes toastIn { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }

        @media (max-width: 500px) {
          .prof-page { padding: 20px 16px 80px; }
          .prof-row { grid-template-columns: 1fr; }
        }
      `}</style>

      {/* Toast */}
      {toast && (
        <div className="toast" style={{ background: toast.type === 'success' ? '#1a1a1a' : '#8C1D40', color: '#fff' }}>
          {toast.type === 'success' ? '✓ ' : '✕ '}{toast.msg}
        </div>
      )}

      <div className="prof-page">

        {/* Page header */}
        <div style={{ marginBottom: '28px' }}>
          <h1 style={{ fontSize: '26px', fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.3px', marginBottom: '4px' }}>My Profile</h1>
          <p style={{ fontSize: '13px', color: '#9b9b9b' }}>Manage your personal information</p>
        </div>

        {/* Avatar + role card */}
        <div className="prof-card">
          <div style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '18px' }}>
            <div style={{ width: '62px', height: '62px', borderRadius: '50%', background: '#8C1D40', color: '#FFC627', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', fontWeight: 700, flexShrink: 0, letterSpacing: '0.5px' }}>
              {((form.first[0] || '') + (form.last[0] || '')).toUpperCase() || profile.email[0].toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: '17px', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>
                {[form.first, form.last].filter(Boolean).join(' ') || profile.email}
              </div>
              <div style={{ fontSize: '12px', color: '#9b9b9b', marginBottom: '8px' }}>{profile.email}</div>
              <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', padding: '3px 10px', borderRadius: '20px', background: roleMeta.bg, color: roleMeta.color }}>
                {roleMeta.label}
              </span>
            </div>
          </div>
        </div>

        {/* Personal info */}
        <div className="prof-card">
          <div className="prof-card-header">
            <div className="prof-section-icon" style={{ background: '#fdf2f5' }}>👤</div>
            <div>
              <div className="prof-section-title">Personal Information</div>
              <div style={{ fontSize: '11px', color: '#9b9b9b' }}>Shown to landlords when you apply</div>
            </div>
          </div>
          <div className="prof-card-body">
            <div className="prof-row">
              <div className="field-wrap">
                <label className="field-label">First Name</label>
                <input className="field-input" placeholder="Jordan" value={form.first} onChange={e => setForm(f => ({ ...f, first: e.target.value }))} />
              </div>
              <div className="field-wrap">
                <label className="field-label">Last Name</label>
                <input className="field-input" placeholder="Lee" value={form.last} onChange={e => setForm(f => ({ ...f, last: e.target.value }))} />
              </div>
            </div>
            <div className="field-wrap">
              <label className="field-label">Phone Number</label>
              <input className="field-input" type="tel" placeholder="(480) 000-0000" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            {(profile.role === 'landlord' || profile.role === 'admin') && (
              <div className="field-wrap">
                <label className="field-label">Company / Business Name</label>
                <input className="field-input" placeholder="Optional" value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} />
              </div>
            )}
          </div>
        </div>

        {/* Email — read only */}
        <div className="prof-card">
          <div className="prof-card-header">
            <div className="prof-section-icon" style={{ background: '#faf9f6' }}>✉️</div>
            <div>
              <div className="prof-section-title">Email Address</div>
              <div style={{ fontSize: '11px', color: '#9b9b9b' }}>Used to log in and receive notifications</div>
            </div>
          </div>
          <div className="prof-card-body">
            <div className="field-wrap">
              <label className="field-label">Email</label>
              <input className="field-input readonly" value={profile.email} readOnly />
              <span className="field-hint">Email address cannot be changed here. Contact support if needed.</span>
            </div>
          </div>
        </div>

        {/* Password */}
        <div className="prof-card">
          <div className="prof-card-header">
            <div className="prof-section-icon" style={{ background: '#faf9f6' }}>🔒</div>
            <div>
              <div className="prof-section-title">Password</div>
              <div style={{ fontSize: '11px', color: '#9b9b9b' }}>Reset via email link</div>
            </div>
          </div>
          <div className="prof-card-body">
            <div className="field-wrap">
              <label className="field-label">Current Password</label>
              <input className="field-input readonly" type="password" value="••••••••••••" readOnly />
            </div>
            {resetSent ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '11px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '9px', fontSize: '13px', color: '#166534' }}>
                <span>✓</span> Reset link sent to <strong>{profile.email}</strong>
              </div>
            ) : (
              <button
                onClick={handlePasswordReset}
                style={{ padding: '10px 16px', background: 'none', border: '1.5px solid #e8e5de', borderRadius: '9px', fontSize: '13px', fontWeight: 500, color: '#3a3a3a', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", textAlign: 'left', transition: 'border-color .15s' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#8C1D40')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#e8e5de')}
              >
                Send password reset email →
              </button>
            )}
          </div>
        </div>

        {/* Save */}
        <button className="save-btn" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>

      </div>
    </>
  )
}
