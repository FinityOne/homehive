'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase, getCurrentUser } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import PhoneInput from '@/components/ui/PhoneInput'

type ProfileData = {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  role: string
  company_name: string | null
  verified: boolean
  onboarded: boolean
  avatar_url: string | null
}

type PlanType = 'per_lead' | 'single_listing' | 'two_listing' | 'lifetime' | null

type PlanRow = {
  plan_type: PlanType
  status: 'active' | 'cancelled' | 'past_due'
  stripe_customer_id: string
  stripe_subscription_id: string | null
  current_period_end: string | null
}

function splitName(full: string | null) {
  const parts = (full || '').trim().split(' ')
  return { first: parts[0] || '', last: parts.slice(1).join(' ') }
}

function formatDate(iso: string | null) {
  if (!iso) return 'Lifetime'
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

const PLAN_NAMES: Record<NonNullable<PlanType>, string> = {
  per_lead:       'Pay Per Lead',
  single_listing: 'Single Listing Plan',
  two_listing:    'Two Listing Plan',
  lifetime:       'Lifetime Founding Member',
}

// ─── Profile tab ─────────────────────────────────────────────────────────────
function ProfileTab({ profile, avatarUrl, setAvatarUrl, showToast }: {
  profile: ProfileData
  avatarUrl: string | null
  setAvatarUrl: (url: string | null) => void
  showToast: (msg: string, type: 'success' | 'error') => void
}) {
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [form, setForm] = useState(() => {
    const { first, last } = splitName(profile.full_name)
    return { first, last, phone: profile.phone || '', company_name: profile.company_name || '' }
  })
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSave = async () => {
    setSaving(true)
    const full_name = [form.first.trim(), form.last.trim()].filter(Boolean).join(' ')
    const { error } = await supabase
      .from('profiles')
      .update({ full_name, phone: form.phone.trim() || null, company_name: form.company_name.trim() || null })
      .eq('id', profile.id)
    setSaving(false)
    if (error) { showToast('Failed to save. Please try again.', 'error'); return }
    showToast('Profile updated!', 'success')
  }

  const handlePasswordReset = async () => {
    const { error } = await supabase.auth.resetPasswordForEmail(profile.email)
    if (!error) setResetSent(true)
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `${profile.id}/avatar.${ext}`
    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    if (uploadError) { showToast('Upload failed.', 'error'); setUploading(false); return }
    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
    const urlWithCacheBust = `${publicUrl}?t=${Date.now()}`
    const { error: updateError } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', profile.id)
    setUploading(false)
    if (updateError) { showToast('Failed to save photo.', 'error'); return }
    setAvatarUrl(urlWithCacheBust)
    showToast('Profile photo updated!', 'success')
    e.target.value = ''
  }

  return (
    <>
      {/* Avatar */}
      <div className="prof-card" style={{ marginBottom: '16px' }}>
        <div style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '18px' }}>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: 'none' }} onChange={handleAvatarUpload} />
          <div className="avatar-wrap" onClick={() => !uploading && fileInputRef.current?.click()} title="Change photo">
            {avatarUrl
              ? <img className="avatar-img" src={avatarUrl} alt="Profile photo" />
              : <div className="avatar-initials">{((form.first[0] || '') + (form.last[0] || '')).toUpperCase() || profile.email[0].toUpperCase()}</div>
            }
            {uploading
              ? <div className="avatar-uploading"><div style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .7s linear infinite' }} /></div>
              : <div className="avatar-overlay"><span className="avatar-overlay-icon">📷</span></div>
            }
          </div>
          <div>
            <div style={{ fontSize: '17px', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>
              {[form.first, form.last].filter(Boolean).join(' ') || profile.email}
            </div>
            <div style={{ fontSize: '12px', color: '#9b9b9b', marginBottom: '6px' }}>{profile.email}</div>
            <button onClick={() => !uploading && fileInputRef.current?.click()} disabled={uploading} style={{ fontSize: '12px', color: '#9b9b9b', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: "'DM Sans', sans-serif", textDecoration: 'underline', textDecorationColor: '#d4d0c9' }}>
              {uploading ? 'Uploading…' : 'Change photo'}
            </button>
          </div>
        </div>
      </div>

      {/* Personal info */}
      <div className="prof-card" style={{ marginBottom: '16px' }}>
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
            <PhoneInput
              value={form.phone || ''}
              onChange={e164 => setForm(f => ({ ...f, phone: e164 }))}
            />
          </div>
          {(profile.role === 'landlord' || profile.role === 'admin') && (
            <div className="field-wrap">
              <label className="field-label">Company / Business Name</label>
              <input className="field-input" placeholder="Optional" value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} />
            </div>
          )}
        </div>
      </div>

      {/* Email */}
      <div className="prof-card" style={{ marginBottom: '16px' }}>
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
            <span className="field-hint">Email cannot be changed here. Contact support if needed.</span>
          </div>
        </div>
      </div>

      {/* Password */}
      <div className="prof-card" style={{ marginBottom: '24px' }}>
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
              style={{ padding: '10px 16px', background: 'none', border: '1.5px solid #e8e5de', borderRadius: '9px', fontSize: '13px', fontWeight: 500, color: '#3a3a3a', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'border-color .15s' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#8C1D40')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#e8e5de')}
            >
              Send password reset email →
            </button>
          )}
        </div>
      </div>

      <button className="save-btn" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </>
  )
}

// ─── Billing tab ──────────────────────────────────────────────────────────────
function BillingTab({ userId }: { userId: string }) {
  const [subTab, setSubTab] = useState<'subscription' | 'usage'>('subscription')
  const [plan, setPlan] = useState<PlanRow | null | 'loading'>('loading')
  const [unlockCount, setUnlockCount] = useState(0)
  const [portalLoading, setPortalLoading] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('landlord_plans').select('plan_type, status, stripe_customer_id, stripe_subscription_id, current_period_end').eq('landlord_id', userId).eq('status', 'active').maybeSingle(),
      supabase.from('lead_unlocks').select('id', { count: 'exact', head: true }).eq('landlord_id', userId),
    ]).then(([planRes, unlocksRes]) => {
      setPlan(planRes.data as PlanRow | null)
      setUnlockCount(unlocksRes.count ?? 0)
    })
  }, [userId])

  const openPortal = async () => {
    setPortalLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const { url, error } = await res.json()
      if (url) window.location.href = url
      else alert(error ?? 'Could not open billing portal')
    } catch { alert('Could not open billing portal') }
    finally { setPortalLoading(false) }
  }

  const isLoading = plan === 'loading'
  const activePlan = plan === 'loading' ? null : plan
  const isLifetime = activePlan?.plan_type === 'lifetime'
  const isAdminGrant = activePlan?.stripe_subscription_id === 'admin_override'

  const subTabs = [
    { id: 'subscription' as const, label: 'Subscription' },
    { id: 'usage' as const, label: 'Usage' },
  ]

  const planStatusBadge = activePlan
    ? isLifetime
      ? { label: 'Founding Member ⭐', bg: '#fffbeb', color: '#92400e', border: '#fde68a' }
      : activePlan.status === 'active'
      ? { label: 'Active', bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' }
      : activePlan.status === 'past_due'
      ? { label: 'Past Due', bg: '#fef2f2', color: '#dc2626', border: '#fecaca' }
      : { label: 'Cancelled', bg: '#f5f4f0', color: '#6b6b6b', border: '#e0ddd7' }
    : null

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: '2px', borderBottom: '1px solid #e8e5de', marginBottom: '24px' }}>
        {subTabs.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)} style={{
            background: 'none', border: 'none',
            borderBottom: subTab === t.id ? '2px solid #8C1D40' : '2px solid transparent',
            padding: '8px 14px', fontSize: '13px', fontWeight: subTab === t.id ? 700 : 500,
            color: subTab === t.id ? '#8C1D40' : '#9b9b9b',
            cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", marginBottom: '-1px',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Subscription sub-tab */}
      {subTab === 'subscription' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Current plan */}
          <div className="prof-card">
            <div className="prof-card-header">
              <div className="prof-section-icon" style={{ background: '#fdf9ec' }}>💳</div>
              <div>
                <div className="prof-section-title">Current Plan</div>
                <div style={{ fontSize: '11px', color: '#9b9b9b' }}>Your active HomeHive subscription</div>
              </div>
            </div>
            <div className="prof-card-body">
              {isLoading ? (
                <div style={{ height: '40px', background: 'linear-gradient(90deg,#f0ede6 25%,#faf9f6 50%,#f0ede6 75%)', backgroundSize: '400% 100%', borderRadius: '8px', animation: 'shimmer 1.4s infinite' }} />
              ) : activePlan ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '16px', color: '#1a1a1a' }}>
                        {isAdminGrant ? `Complimentary ${PLAN_NAMES[activePlan.plan_type!]}` : PLAN_NAMES[activePlan.plan_type!]}
                      </span>
                      {isAdminGrant && (
                        <span style={{ fontSize: '10px', fontWeight: 700, background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '2px 8px', borderRadius: '20px' }}>
                          COMPLIMENTARY
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '13px', color: '#9b9b9b', marginTop: '4px' }}>
                      {isAdminGrant
                        ? 'Complimentary plan — contact support for questions'
                        : isLifetime
                        ? 'Lifetime access — never expires'
                        : activePlan.status === 'active'
                        ? `Renews ${formatDate(activePlan.current_period_end)}`
                        : activePlan.status === 'past_due'
                        ? '⚠️ Payment past due — update payment method'
                        : 'Cancelled'}
                    </div>
                  </div>
                  {planStatusBadge && !isAdminGrant && (
                    <span style={{ background: planStatusBadge.bg, color: planStatusBadge.color, border: `1px solid ${planStatusBadge.border}`, borderRadius: '20px', fontSize: '11px', fontWeight: 700, padding: '3px 12px' }}>
                      {planStatusBadge.label}
                    </span>
                  )}
                  {isAdminGrant && (
                    <span style={{ background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', borderRadius: '20px', fontSize: '11px', fontWeight: 700, padding: '3px 12px' }}>
                      Active ✓
                    </span>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: '14px', color: '#6b6b6b', marginBottom: '14px' }}>
                    No active plan. You're on pay-per-lead — first lead per listing is always free.
                  </div>
                  <a href="/landlord/leads" style={{ display: 'inline-block', background: '#8C1D40', color: '#fff', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 700, textDecoration: 'none', fontFamily: "'DM Sans', sans-serif" }}>
                    View Plans →
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Plan comparison — only show if no active plan or not lifetime */}
          {!isLoading && !isLifetime && (
            <div className="prof-card">
              <div className="prof-card-header">
                <div className="prof-section-icon" style={{ background: '#f0fdf4' }}>⬆</div>
                <div>
                  <div className="prof-section-title">{activePlan ? 'Change Plan' : 'Available Plans'}</div>
                  <div style={{ fontSize: '11px', color: '#9b9b9b' }}>Unlock unlimited leads for your listings</div>
                </div>
              </div>
              <div className="prof-card-body">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                  {[
                    { name: 'Per Lead', price: '$1.99', freq: 'one time', desc: 'Pay as you go', current: activePlan?.plan_type === 'per_lead' },
                    { name: '1 Listing', price: '$29.99', freq: '/mo', desc: 'Unlimited for 1 listing', current: activePlan?.plan_type === 'single_listing' },
                    { name: '2 Listings', price: '$49.99', freq: '/mo', desc: 'Unlimited for 2 listings', highlight: true, badge: 'BEST VALUE', current: activePlan?.plan_type === 'two_listing' },
                  ].map(p => (
                    <div key={p.name} style={{
                      background: p.current ? '#fdf2f5' : p.highlight ? '#f8f7f4' : '#fff',
                      border: p.current ? '2px solid #8C1D40' : p.highlight ? '2px solid #1a1a1a' : '1.5px solid #e8e4db',
                      borderRadius: '10px', padding: '14px 12px', position: 'relative',
                    }}>
                      {p.badge && (
                        <div style={{ position: 'absolute', top: '-9px', left: '50%', transform: 'translateX(-50%)', background: '#FFC627', color: '#1a1a1a', fontSize: '9px', fontWeight: 800, padding: '2px 7px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{p.badge}</div>
                      )}
                      {p.current && (
                        <div style={{ position: 'absolute', top: '-9px', right: '10px', background: '#8C1D40', color: '#fff', fontSize: '9px', fontWeight: 800, padding: '2px 7px', borderRadius: '20px' }}>CURRENT</div>
                      )}
                      <div style={{ fontSize: '11px', fontWeight: 700, color: '#6b6b6b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>{p.name}</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '2px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '20px', fontWeight: 800, color: '#1a1a1a' }}>{p.price}</span>
                        <span style={{ fontSize: '11px', color: '#9b9b9b' }}>{p.freq}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#6b6b6b' }}>{p.desc}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: '14px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <a href="/landlord/leads" style={{ display: 'inline-block', background: '#1a1a1a', color: '#fff', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 700, textDecoration: 'none', fontFamily: "'DM Sans', sans-serif" }}>
                    Unlock a Lead to Upgrade →
                  </a>
                  {activePlan && !isLifetime && !isAdminGrant && (
                    <button onClick={openPortal} disabled={portalLoading} style={{ background: 'none', border: '1.5px solid #e8e5de', color: '#3a3a3a', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                      {portalLoading ? 'Opening…' : 'Manage Subscription →'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Manage subscription for active plans (not admin grants or lifetime) */}
          {!isLoading && activePlan && !isLifetime && !isAdminGrant && (
            <div className="prof-card">
              <div className="prof-card-header">
                <div className="prof-section-icon" style={{ background: '#faf9f6' }}>⚙️</div>
                <div>
                  <div className="prof-section-title">Manage Subscription</div>
                  <div style={{ fontSize: '11px', color: '#9b9b9b' }}>Update payment method, download invoices, cancel</div>
                </div>
              </div>
              <div className="prof-card-body">
                <button onClick={openPortal} disabled={portalLoading} style={{ background: portalLoading ? '#c5c1b8' : '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 20px', fontSize: '13px', fontWeight: 700, cursor: portalLoading ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                  {portalLoading ? 'Opening…' : 'Open Billing Portal →'}
                </button>
                <span style={{ fontSize: '11px', color: '#9b9b9b', marginTop: '8px', display: 'block' }}>
                  You'll be redirected to Stripe's secure billing portal.
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Usage sub-tab */}
      {subTab === 'usage' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="prof-card">
            <div className="prof-card-header">
              <div className="prof-section-icon" style={{ background: '#eff6ff' }}>📊</div>
              <div>
                <div className="prof-section-title">Lead Usage</div>
                <div style={{ fontSize: '11px', color: '#9b9b9b' }}>All-time unlock history</div>
              </div>
            </div>
            <div className="prof-card-body">
              <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '36px', fontWeight: 800, color: '#1a1a1a', letterSpacing: '-1px' }}>{unlockCount}</div>
                  <div style={{ fontSize: '12px', color: '#9b9b9b', marginTop: '2px' }}>total leads unlocked</div>
                </div>
                <div>
                  <div style={{ fontSize: '36px', fontWeight: 800, color: unlockCount === 0 ? '#c5c1b8' : '#10b981', letterSpacing: '-1px' }}>
                    {unlockCount === 0 ? '—' : activePlan && activePlan.plan_type !== 'per_lead' ? '∞' : `$${(unlockCount * 1.99).toFixed(2)}`}
                  </div>
                  <div style={{ fontSize: '12px', color: '#9b9b9b', marginTop: '2px' }}>
                    {activePlan && activePlan.plan_type !== 'per_lead' ? 'unlimited plan active' : 'est. pay-per-lead spend'}
                  </div>
                </div>
              </div>

              {unlockCount === 0 && (
                <div style={{ marginTop: '16px', padding: '12px 14px', background: '#f5f4f0', borderRadius: '8px', fontSize: '13px', color: '#9b9b9b' }}>
                  No leads unlocked yet. Your first lead on each listing is always free.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Page wrapper (needs Suspense for useSearchParams) ────────────────────────
function ProfilePageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const defaultTab = searchParams.get('tab') === 'billing' ? 'billing' : 'profile'
  const [activeTab, setActiveTab] = useState<'profile' | 'billing'>(defaultTab as any)

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  useEffect(() => { document.title = 'My Profile — My Portal | HomeHive' }, [])

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser()
      if (!user) { router.push('/login'); return }
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (data) {
        setProfile({ ...data, email: user.email || '' })
        setAvatarUrl(data.avatar_url || null)
      }
      setLoading(false)
    }
    load()
  }, [router])

  const roleMeta = {
    admin:    { label: 'Admin',    bg: '#f3f0ff', color: '#6d28d9' },
    landlord: { label: 'Landlord', bg: '#f0fdf4', color: '#065f46' },
    tenant:   { label: 'Student',  bg: '#fdf2f5', color: '#8C1D40' },
  }[profile?.role || 'tenant'] ?? { label: 'Student', bg: '#fdf2f5', color: '#8C1D40' }

  const isLandlord = profile?.role === 'landlord' || profile?.role === 'admin'

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

  const { first, last } = splitName(profile.full_name)
  const displayName = [first, last].filter(Boolean).join(' ') || profile.email

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .prof-page  { max-width: 640px; margin: 0 auto; padding: 36px 24px 80px; font-family: 'DM Sans', sans-serif; }
        .prof-card  { background: #fff; border-radius: 14px; border: 1px solid #e8e5de; overflow: hidden; }
        .prof-card-header { padding: 18px 22px; border-bottom: 1px solid #f0ede6; display: flex; align-items: center; gap: 12px; }
        .prof-section-title { font-size: 13px; font-weight: 600; color: #1a1a1a; }
        .prof-section-icon  { width: 34px; height: 34px; border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
        .prof-card-body  { padding: 18px 22px; display: flex; flex-direction: column; gap: 14px; }
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

        .avatar-wrap { position: relative; width: 56px; height: 56px; flex-shrink: 0; cursor: pointer; }
        .avatar-img { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; display: block; }
        .avatar-initials { width: 56px; height: 56px; border-radius: 50%; background: #8C1D40; color: #FFC627; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
        .avatar-overlay { position: absolute; inset: 0; border-radius: 50%; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity .2s; }
        .avatar-wrap:hover .avatar-overlay { opacity: 1; }
        .avatar-overlay-icon { font-size: 16px; }
        .avatar-uploading { position: absolute; inset: 0; border-radius: 50%; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; }

        .toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); padding: 11px 20px; border-radius: 10px; font-size: 13px; font-weight: 500; font-family: 'DM Sans', sans-serif; z-index: 9999; white-space: nowrap; box-shadow: 0 4px 20px rgba(0,0,0,.15); animation: toastIn .2s ease; }
        @keyframes toastIn { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

        @media (max-width: 500px) {
          .prof-page { padding: 20px 16px 80px; }
          .prof-row { grid-template-columns: 1fr; }
        }
      `}</style>

      {toast && (
        <div className="toast" style={{ background: toast.type === 'success' ? '#1a1a1a' : '#8C1D40', color: '#fff' }}>
          {toast.type === 'success' ? '✓ ' : '✕ '}{toast.msg}
        </div>
      )}

      <div className="prof-page">

        {/* Page header — always visible */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '28px' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#8C1D40', color: '#FFC627', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: 700, flexShrink: 0 }}>
            {((first[0] || '') + (last[0] || '')).toUpperCase() || profile.email[0].toUpperCase()}
          </div>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.3px', margin: 0 }}>{displayName}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <span style={{ fontSize: '12px', color: '#9b9b9b' }}>{profile.email}</span>
              <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', padding: '2px 8px', borderRadius: '20px', background: roleMeta.bg, color: roleMeta.color }}>
                {roleMeta.label}
              </span>
            </div>
          </div>
        </div>

        {/* Tabs — only show Billing for landlords/admins */}
        {isLandlord && (
          <div style={{ display: 'flex', borderBottom: '1.5px solid #e8e5de', marginBottom: '24px' }}>
            {(['profile', 'billing'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                background: 'none', border: 'none',
                borderBottom: activeTab === tab ? '2.5px solid #8C1D40' : '2.5px solid transparent',
                padding: '8px 16px', fontSize: '14px', fontWeight: activeTab === tab ? 700 : 500,
                color: activeTab === tab ? '#8C1D40' : '#9b9b9b',
                cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", marginBottom: '-1.5px',
                textTransform: 'capitalize',
              }}>
                {tab === 'billing' ? '💳 Billing' : '👤 Profile'}
              </button>
            ))}
          </div>
        )}

        {/* Tab content */}
        {activeTab === 'profile' && (
          <ProfileTab
            profile={profile}
            avatarUrl={avatarUrl}
            setAvatarUrl={setAvatarUrl}
            showToast={showToast}
          />
        )}

        {activeTab === 'billing' && isLandlord && (
          <BillingTab userId={profile.id} />
        )}

      </div>
    </>
  )
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<div style={{ padding: '60px 24px', fontFamily: "'DM Sans', sans-serif", color: '#9b9b9b' }}>Loading…</div>}>
      <ProfilePageInner />
    </Suspense>
  )
}
