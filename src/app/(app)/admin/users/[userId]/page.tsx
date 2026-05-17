'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── Types ─────────────────────────────────────────────────────────────────────
type Profile = {
  id: string; email: string; full_name: string | null; phone: string | null
  role: string; company_name: string | null; verified: boolean; onboarded: boolean
  created_at: string; avatar_url?: string | null
}
type Property = {
  id: string; name: string; slug: string; address: string
  admin_status: string; is_active: boolean; created_at: string
}
type Plan = {
  id: string; plan_type: string; status: string
  stripe_subscription_id: string | null; current_period_end: string | null
  stripe_customer_id: string | null; created_at: string
}
type Unlock = {
  id: string; lead_id: string; listing_id: string | null; unlock_type: string
  stripe_payment_intent_id: string | null; created_at: string
}
type Lead = { id: string; property: string; status: string; created_at: string }
type AuditEntry = {
  id: string; landlord_id: string; admin_id: string; action: 'grant' | 'revoke'
  from_plan_type: string | null; to_plan_type: string | null; note: string | null
  created_at: string; admin?: { id: string; full_name: string | null; email: string } | null
}

type UserData = {
  profile: Profile
  properties: Property[]
  plan: Plan | null
  unlocks: Unlock[]
  leads: Lead[]
  auditLog: AuditEntry[]
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function initials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(' ')
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
  }
  return email[0].toUpperCase()
}

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const PLAN_LABELS: Record<string, string> = {
  per_lead: 'Pay per Lead', single_listing: '1 Listing · $29.99/mo',
  two_listing: 'Unlimited · $49.99/mo', lifetime: 'Lifetime Deal · $299',
}
const PLAN_SHORT: Record<string, string> = {
  per_lead: 'Pay/Lead', single_listing: '1 Listing',
  two_listing: 'Unlimited', lifetime: 'Lifetime',
}

// ─── Engagement score ───────────────────────────────────────────────────────────
function computeScore(data: UserData): { score: number; breakdown: { recency: number; listings: number; leads: number } } {
  const latestActivity = [
    data.profile.created_at,
    ...data.properties.map(p => p.created_at),
    ...data.leads.map(l => l.created_at),
    ...data.unlocks.map(u => u.created_at),
  ].sort().reverse()[0]

  const days = (Date.now() - new Date(latestActivity).getTime()) / 86400000
  const recency = days < 1 ? 40 : days < 7 ? 32 : days < 14 ? 22 : days < 30 ? 12 : days < 90 ? 4 : 0
  const activeListings = data.properties.filter(p => p.admin_status === 'active').length
  const listings = activeListings >= 3 ? 35 : activeListings === 2 ? 25 : activeListings === 1 ? 14 : 0
  const leadCount = data.leads.length
  const leads = leadCount >= 15 ? 25 : leadCount >= 8 ? 19 : leadCount >= 3 ? 12 : leadCount >= 1 ? 6 : 0
  return { score: recency + listings + leads, breakdown: { recency, listings, leads } }
}

function scoreMeta(s: number) {
  if (s >= 70) return { label: '🔥 High', color: '#dc2626', bg: '#fef2f2', track: '#fecaca' }
  if (s >= 45) return { label: '◎ Active', color: '#ea580c', bg: '#fff7ed', track: '#fed7aa' }
  if (s >= 15) return { label: '· Warm', color: '#ca8a04', bg: '#fefce8', track: '#fef08a' }
  return { label: '— Cold', color: '#9b9b9b', bg: '#f9fafb', track: '#e5e7eb' }
}

// ─── Sub-components ──────────────────────────────────────────────────────────────
function StatCard({ val, label, sub, color }: { val: string | number; label: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e4db', borderRadius: '10px', padding: '14px 18px' }}>
      <div style={{ fontSize: '24px', fontWeight: 700, color: color ?? '#1a1a1a', lineHeight: 1, marginBottom: '4px' }}>{val}</div>
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#4a4a4a' }}>{label}</div>
      {sub && <div style={{ fontSize: '11px', color: '#9b9b9b', marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}

const UNLOCK_PRICES: Record<string, number> = { per_lead: 1.99 }

function unlockLabel(type: string) {
  if (type === 'per_lead') return { text: 'Per-lead unlock', amount: '$1.99', color: '#8C1D40' }
  if (type === 'subscription') return { text: 'Plan unlock', amount: '—', color: '#6b21a8' }
  return { text: 'Free unlock', amount: '$0', color: '#166534' }
}

const ADMIN_STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  active:   { color: '#166534', bg: '#f0fdf4' },
  pending:  { color: '#92400e', bg: '#fffbeb' },
  inactive: { color: '#6b7280', bg: '#f9fafb' },
  test:     { color: '#5b21b6', bg: '#f5f3ff' },
  flagged:  { color: '#9f1239', bg: '#fff1f2' },
  rejected: { color: '#9f1239', bg: '#fff1f2' },
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AdminUserDetailPage() {
  const router = useRouter()
  const params = useParams()
  const userId = params.userId as string

  const [data, setData] = useState<UserData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({ full_name: '', phone: '', company_name: '', role: '', verified: false })
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [overridePlan, setOverridePlan] = useState<string>('')
  const [overrideNote, setOverrideNote] = useState<string>('')
  const [overriding, setOverriding] = useState(false)
  const [overrideMsg, setOverrideMsg] = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => { document.title = 'User Details — Admin | HomeHive' }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: d }) => { if (!d.user) router.push('/login') })
  }, [router])

  useEffect(() => {
    if (!userId) return
    fetch(`/api/admin/users/${userId}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setLoading(false); return }
        setData(d)
        setEditForm({
          full_name: d.profile.full_name ?? '',
          phone: d.profile.phone ?? '',
          company_name: d.profile.company_name ?? '',
          role: d.profile.role,
          verified: d.profile.verified,
        })
        setLoading(false)
      })
      .catch(() => { setError('Failed to load user'); setLoading(false) })
  }, [userId])

  const auditLog: AuditEntry[] = data?.auditLog ?? []

  const handleSave = async () => {
    setSaving(true)
    await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: userId, ...editForm }),
    })
    setData(prev => prev ? { ...prev, profile: { ...prev.profile, ...editForm } } : prev)
    setSaving(false)
    setEditMode(false)
    setSaveMsg('Saved!')
    setTimeout(() => setSaveMsg(''), 2500)
  }

  const handlePlanOverride = async () => {
    if (!overridePlan) return
    setOverriding(true)
    setOverrideMsg(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'override_plan', plan_type: overridePlan, note: overrideNote.trim() || undefined }),
      })
      const d = await res.json()
      if (!res.ok || d.error) {
        setOverrideMsg({ text: d.error ?? 'Failed', ok: false })
      } else {
        setData(prev => {
          if (!prev) return prev
          const newAuditLog = d.auditEntry ? [d.auditEntry, ...prev.auditLog] : prev.auditLog
          return { ...prev, plan: overridePlan === 'free' ? null : d.plan, auditLog: newAuditLog }
        })
        setOverrideMsg({ text: overridePlan === 'free' ? 'Plan revoked — user is now on free tier' : `Upgraded to ${PLAN_LABELS[overridePlan] ?? overridePlan} — no charge applied`, ok: true })
        setOverridePlan('')
        setOverrideNote('')
      }
    } catch {
      setOverrideMsg({ text: 'Request failed', ok: false })
    }
    setOverriding(false)
    setTimeout(() => setOverrideMsg(null), 5000)
  }

  if (loading) return (
    <div style={{ padding: '48px 28px', fontFamily: "'DM Sans', sans-serif", color: '#9b9b9b', fontSize: '14px' }}>
      Loading…
    </div>
  )
  if (error || !data) return (
    <div style={{ padding: '48px 28px', fontFamily: "'DM Sans', sans-serif", color: '#dc2626' }}>
      {error ?? 'User not found'}
    </div>
  )

  const { profile, properties, plan, unlocks, leads } = data
  const { score, breakdown } = computeScore(data)
  const sm = scoreMeta(score)
  const activeProperties = properties.filter(p => p.admin_status === 'active')
  const perLeadUnlocks = unlocks.filter(u => u.unlock_type === 'per_lead')
  const totalSpend = perLeadUnlocks.length * 1.99
  const leadsByProperty = leads.reduce<Record<string, number>>((acc, l) => {
    acc[l.property] = (acc[l.property] ?? 0) + 1
    return acc
  }, {})

  const ROLE_COLORS: Record<string, string> = {
    admin: '#1e3a8a', landlord: '#6b21a8', tenant: '#0f766e',
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; }
        .ud-page { max-width: 1080px; margin: 0 auto; padding: 28px 24px 80px; font-family: 'DM Sans', sans-serif; }
        .ud-card { background: #fff; border: 1px solid #e8e4db; border-radius: 12px; padding: 20px 22px; }
        .ud-card-title { font-size: 11px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 14px; }
        .ud-table { width: 100%; border-collapse: collapse; }
        .ud-table th { font-size: 10px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.5px; padding: 6px 0; border-bottom: 1px solid #f0ede6; text-align: left; }
        .ud-table td { padding: 10px 0; border-bottom: 1px solid #f7f6f3; font-size: 13px; vertical-align: middle; }
        .ud-table tr:last-child td { border-bottom: none; }
        .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .field-input { width: 100%; padding: 8px 11px; border: 1.5px solid #e8e4db; border-radius: 7px; font-size: 13px; font-family: 'DM Sans', sans-serif; outline: none; }
        .field-input:focus { border-color: #8C1D40; }
        .score-seg { height: 7px; border-radius: 3px; flex: 1; }
      `}</style>

      <div className="ud-page">

        {/* Back */}
        <button
          onClick={() => router.push('/admin/users')}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', color: '#9b9b9b', fontFamily: 'DM Sans, sans-serif', marginBottom: '20px', padding: 0 }}
        >
          ← Users
        </button>

        {/* Header card */}
        <div className="ud-card" style={{ marginBottom: '16px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
            {/* Avatar */}
            <div style={{
              width: '56px', height: '56px', borderRadius: '50%', background: '#8C1D40',
              color: '#FFC627', fontSize: '18px', fontWeight: 700, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '1px',
            }}>
              {initials(profile.full_name, profile.email)}
            </div>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', lineHeight: 1.2 }}>
                {profile.full_name || <span style={{ color: '#9b9b9b', fontWeight: 400 }}>No name</span>}
                {saveMsg && <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 500, marginLeft: '10px' }}>{saveMsg}</span>}
              </div>
              <div style={{ fontSize: '13px', color: '#9b9b9b', marginTop: '3px' }}>{profile.email}</div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 9px', borderRadius: '20px', background: '#f5f3ff', color: ROLE_COLORS[profile.role] ?? '#6b7280', border: `1px solid #e9d5ff` }}>
                  {profile.role}
                </span>
                {profile.verified && <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 9px', borderRadius: '20px', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' }}>✓ Verified</span>}
                {plan && plan.status === 'active' && (
                  <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 9px', borderRadius: '20px', background: '#fdf2f5', color: '#8C1D40', border: '1px solid #f4c9d5' }}>
                    💳 {PLAN_SHORT[plan.plan_type] ?? plan.plan_type}
                  </span>
                )}
                <span style={{ fontSize: '11px', color: '#9b9b9b' }}>Joined {fmtDate(profile.created_at)}</span>
              </div>
            </div>
          </div>

          {/* Engagement score */}
          <div style={{ textAlign: 'center', minWidth: '140px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Engagement Score</div>
            <div style={{ fontSize: '48px', fontWeight: 800, color: sm.color, lineHeight: 1, marginBottom: '6px' }}>{score}</div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: sm.color, background: sm.bg, borderRadius: '20px', padding: '3px 12px', display: 'inline-block', marginBottom: '10px' }}>{sm.label}</div>
            {/* Score bar segments */}
            <div style={{ display: 'flex', gap: '3px', marginBottom: '6px' }}>
              <div className="score-seg" style={{ background: breakdown.recency > 0 ? '#8C1D40' : '#f0ede6' }} title={`Recency: ${breakdown.recency}/40`} />
              <div className="score-seg" style={{ background: breakdown.listings > 0 ? '#8C1D40' : '#f0ede6', opacity: 0.75 }} title={`Listings: ${breakdown.listings}/35`} />
              <div className="score-seg" style={{ background: breakdown.leads > 0 ? '#8C1D40' : '#f0ede6', opacity: 0.5 }} title={`Leads: ${breakdown.leads}/25`} />
            </div>
            <div style={{ fontSize: '10px', color: '#c5c1b8', lineHeight: 1.5 }}>
              Recency {breakdown.recency} · Listings {breakdown.listings} · Leads {breakdown.leads}
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '10px', marginBottom: '16px' }}>
          <StatCard val={properties.length} label="Total listings" />
          <StatCard val={activeProperties.length} label="Active listings" color={activeProperties.length > 0 ? '#166534' : undefined} />
          <StatCard val={leads.length} label="Total leads" color={leads.length > 0 ? '#8C1D40' : undefined} />
          <StatCard val={unlocks.length} label="Leads unlocked" />
          <StatCard
            val={plan?.status === 'active' ? (PLAN_SHORT[plan.plan_type] ?? plan.plan_type) : 'Free'}
            label="Current plan"
            sub={plan?.status === 'active' ? `Renews ${fmtDate(plan.current_period_end)}` : 'No active subscription'}
            color={plan?.status === 'active' ? '#8C1D40' : undefined}
          />
          <StatCard val={`$${totalSpend.toFixed(2)}`} label="Est. spend" sub={`${perLeadUnlocks.length} per-lead unlock${perLeadUnlocks.length !== 1 ? 's' : ''}`} />
        </div>

        {/* Info + Plan row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>

          {/* Account info */}
          <div className="ud-card">
            <div className="ud-card-title">Account Info</div>
            {editMode ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div className="field-row">
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#9b9b9b', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Full Name</div>
                    <input className="field-input" value={editForm.full_name} onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))} />
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#9b9b9b', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Phone</div>
                    <input className="field-input" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#9b9b9b', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Company</div>
                  <input className="field-input" value={editForm.company_name} onChange={e => setEditForm(f => ({ ...f, company_name: e.target.value }))} />
                </div>
                <div className="field-row">
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#9b9b9b', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Role</div>
                    <select className="field-input" value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}>
                      <option value="landlord">landlord</option>
                      <option value="tenant">tenant</option>
                      <option value="admin">admin</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '20px' }}>
                    <input type="checkbox" id="edit-verified" checked={editForm.verified} onChange={e => setEditForm(f => ({ ...f, verified: e.target.checked }))} style={{ accentColor: '#8C1D40', width: '15px', height: '15px' }} />
                    <label htmlFor="edit-verified" style={{ fontSize: '13px', cursor: 'pointer' }}>Verified</label>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  <button onClick={handleSave} disabled={saving} style={{ padding: '7px 16px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setEditMode(false)} style={{ padding: '7px 12px', background: 'transparent', color: '#9b9b9b', border: '1.5px solid #e8e4db', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                {[
                  { label: 'Email', val: profile.email },
                  { label: 'Phone', val: profile.phone || '—' },
                  { label: 'Company', val: profile.company_name || '—' },
                  { label: 'Role', val: profile.role },
                  { label: 'Verified', val: profile.verified ? '✓ Yes' : '✗ No' },
                  { label: 'Onboarded', val: profile.onboarded ? '✓ Yes' : '—' },
                  { label: 'User ID', val: profile.id.slice(0, 8) + '…' },
                ].map(({ label, val }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f7f6f3', fontSize: '13px' }}>
                    <span style={{ color: '#9b9b9b', fontWeight: 500 }}>{label}</span>
                    <span style={{ color: '#1a1a1a', fontWeight: 500, textAlign: 'right', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</span>
                  </div>
                ))}
                <button onClick={() => setEditMode(true)} style={{ marginTop: '12px', padding: '6px 14px', background: 'transparent', color: '#4a4a4a', border: '1.5px solid #e8e4db', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                  Edit
                </button>
              </>
            )}
          </div>

          {/* Subscription */}
          <div className="ud-card">
            <div className="ud-card-title">Subscription & Billing</div>

            {/* Current plan status */}
            {plan && plan.status === 'active' ? (
              <>
                <div style={{
                  background: plan.stripe_subscription_id === 'admin_override' ? '#f0fdf4' : '#fdf2f5',
                  border: `1px solid ${plan.stripe_subscription_id === 'admin_override' ? '#bbf7d0' : '#f4c9d5'}`,
                  borderRadius: '10px', padding: '12px 14px', marginBottom: '12px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: plan.stripe_subscription_id === 'admin_override' ? '#166534' : '#8C1D40' }}>
                      {PLAN_LABELS[plan.plan_type] ?? plan.plan_type}
                    </span>
                    {plan.stripe_subscription_id === 'admin_override' && (
                      <span style={{ fontSize: '10px', fontWeight: 700, background: '#166534', color: '#fff', padding: '1px 7px', borderRadius: '20px', letterSpacing: '0.3px' }}>
                        ADMIN GRANT
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: '#9b9b9b' }}>
                    <strong style={{ color: '#166534' }}>Active</strong>
                    {plan.current_period_end && plan.plan_type !== 'lifetime' && <> · Expires {fmtDate(plan.current_period_end)}</>}
                    {plan.plan_type === 'lifetime' && <> · Never expires</>}
                  </div>
                </div>
                {[
                  { label: 'Plan type', val: plan.plan_type },
                  { label: 'Stripe sub ID', val: plan.stripe_subscription_id === 'admin_override' ? '— (admin grant)' : plan.stripe_subscription_id ? plan.stripe_subscription_id.slice(0, 22) + '…' : '—' },
                  { label: 'Customer ID', val: plan.stripe_customer_id ? plan.stripe_customer_id.slice(0, 22) + '…' : '—' },
                  { label: 'Plan since', val: fmtDate(plan.created_at) },
                  { label: 'Per-lead purchases', val: perLeadUnlocks.length > 0 ? `${perLeadUnlocks.length} × $1.99 = $${totalSpend.toFixed(2)}` : '—' },
                ].map(({ label, val }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f7f6f3', fontSize: '13px' }}>
                    <span style={{ color: '#9b9b9b' }}>{label}</span>
                    <span style={{ color: '#1a1a1a', fontWeight: 500, textAlign: 'right' }}>{val}</span>
                  </div>
                ))}
              </>
            ) : (
              <div style={{ padding: '16px 0 12px', borderBottom: '1px solid #f0ede6', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '22px' }}>💳</span>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#4a4a4a' }}>Free Tier</div>
                    <div style={{ fontSize: '12px', color: '#9b9b9b' }}>
                      {perLeadUnlocks.length > 0
                        ? `${perLeadUnlocks.length} per-lead purchase${perLeadUnlocks.length !== 1 ? 's' : ''} · $${totalSpend.toFixed(2)} total`
                        : 'No purchases yet'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Admin plan override ── */}
            <div style={{ background: '#faf9f6', border: '1px solid #e8e4db', borderRadius: '9px', padding: '14px 14px 12px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#6b6b6b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>⚡</span> Admin Plan Override
              </div>
              <div style={{ fontSize: '12px', color: '#9b9b9b', marginBottom: '12px', lineHeight: 1.5 }}>
                Grant or revoke a plan without any payment. Overrides take effect immediately and bypass Stripe.
              </div>
              <div style={{ marginBottom: '8px' }}>
                <input
                  type="text"
                  value={overrideNote}
                  onChange={e => setOverrideNote(e.target.value)}
                  placeholder="Reason / note (optional)"
                  style={{ width: '100%', padding: '7px 10px', border: '1.5px solid #e8e4db', borderRadius: '7px', fontSize: '12px', fontFamily: 'DM Sans, sans-serif', outline: 'none', color: '#1a1a1a' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <select
                  value={overridePlan}
                  onChange={e => setOverridePlan(e.target.value)}
                  style={{
                    flex: 1, padding: '8px 10px', border: '1.5px solid #e8e4db', borderRadius: '7px',
                    fontSize: '13px', fontFamily: 'DM Sans, sans-serif', outline: 'none',
                    background: '#fff', color: overridePlan ? '#1a1a1a' : '#9b9b9b', cursor: 'pointer',
                  }}
                >
                  <option value="">Select a plan…</option>
                  <optgroup label="Grant plan (no charge)">
                    <option value="single_listing">1 Listing — $29.99/mo value</option>
                    <option value="two_listing">Unlimited Listings — $49.99/mo value</option>
                    <option value="lifetime">Lifetime Deal — $299 value</option>
                  </optgroup>
                  <optgroup label="Revoke">
                    <option value="free">Free tier (revoke subscription)</option>
                  </optgroup>
                </select>
                <button
                  disabled={!overridePlan || overriding}
                  onClick={handlePlanOverride}
                  style={{
                    padding: '8px 16px', borderRadius: '7px', border: 'none', fontSize: '13px',
                    fontWeight: 700, cursor: overridePlan && !overriding ? 'pointer' : 'not-allowed',
                    fontFamily: 'DM Sans, sans-serif', whiteSpace: 'nowrap', transition: 'all 0.15s',
                    background: overridePlan === 'free' ? '#fee2e2' : overridePlan ? '#1a1a1a' : '#f0ede6',
                    color: overridePlan === 'free' ? '#dc2626' : overridePlan ? '#fff' : '#9b9b9b',
                    opacity: overriding ? 0.6 : 1,
                  }}
                >
                  {overriding ? 'Applying…' : overridePlan === 'free' ? 'Revoke' : 'Grant →'}
                </button>
              </div>
              {overrideMsg && (
                <div style={{
                  marginTop: '10px', padding: '8px 12px', borderRadius: '7px', fontSize: '12px', fontWeight: 500,
                  background: overrideMsg.ok ? '#f0fdf4' : '#fef2f2',
                  color: overrideMsg.ok ? '#166534' : '#dc2626',
                  border: `1px solid ${overrideMsg.ok ? '#bbf7d0' : '#fecaca'}`,
                }}>
                  {overrideMsg.ok ? '✓ ' : '✗ '}{overrideMsg.text}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Listings */}
        <div className="ud-card" style={{ marginBottom: '12px' }}>
          <div className="ud-card-title">Listings ({properties.length})</div>
          {properties.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: '#9b9b9b', fontSize: '13px' }}>No listings</div>
          ) : (
            <table className="ud-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Address</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Leads</th>
                  <th style={{ textAlign: 'right' }}>Created</th>
                </tr>
              </thead>
              <tbody>
                {properties.map(p => {
                  const sc = ADMIN_STATUS_COLORS[p.admin_status] ?? { color: '#6b7280', bg: '#f9fafb' }
                  const lc = leadsByProperty[p.slug] ?? 0
                  return (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600, color: '#1a1a1a' }}>{p.name}</td>
                      <td style={{ color: '#6b6b6b', fontSize: '12px', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.address || '—'}</td>
                      <td>
                        <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px', background: sc.bg, color: sc.color }}>
                          {p.admin_status}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: lc > 0 ? 700 : 400, color: lc > 0 ? '#8C1D40' : '#9b9b9b' }}>{lc}</td>
                      <td style={{ textAlign: 'right', fontSize: '12px', color: '#9b9b9b' }}>{fmtDate(p.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Plan change audit log */}
        <div className="ud-card" style={{ marginBottom: '12px' }}>
          <div className="ud-card-title">Plan Change History ({auditLog.length})</div>
          {auditLog.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: '#9b9b9b', fontSize: '13px' }}>No plan changes recorded</div>
          ) : (
            <table className="ud-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Action</th>
                  <th>Change</th>
                  <th>By</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.map(entry => {
                  const isGrant = entry.action === 'grant'
                  const fromLabel = entry.from_plan_type ? (PLAN_SHORT[entry.from_plan_type] ?? entry.from_plan_type) : 'Free'
                  const toLabel = entry.to_plan_type ? (PLAN_SHORT[entry.to_plan_type] ?? entry.to_plan_type) : 'Free'
                  return (
                    <tr key={entry.id}>
                      <td style={{ color: '#6b6b6b', whiteSpace: 'nowrap', fontSize: '12px' }}>
                        {fmtDate(entry.created_at)}
                        <span style={{ fontSize: '11px', color: '#b0a898', marginLeft: '6px' }}>{timeAgo(entry.created_at)}</span>
                      </td>
                      <td>
                        <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: isGrant ? '#f0fdf4' : '#fef2f2', color: isGrant ? '#166534' : '#dc2626' }}>
                          {isGrant ? '↑ Grant' : '↓ Revoke'}
                        </span>
                      </td>
                      <td style={{ fontSize: '12px', color: '#1a1a1a', whiteSpace: 'nowrap' }}>
                        <span style={{ color: '#9b9b9b' }}>{fromLabel}</span>
                        <span style={{ margin: '0 5px', color: '#c5c1b8' }}>→</span>
                        <span style={{ fontWeight: 600 }}>{toLabel}</span>
                      </td>
                      <td style={{ fontSize: '12px', color: '#4a4a4a' }}>
                        {entry.admin?.full_name || entry.admin?.email || <span style={{ color: '#9b9b9b' }}>Unknown</span>}
                      </td>
                      <td style={{ fontSize: '12px', color: '#6b6b6b', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.note || <span style={{ color: '#c5c1b8' }}>—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Unlock / Payment history */}
        <div className="ud-card">
          <div className="ud-card-title">Unlock Activity ({unlocks.length})</div>
          {unlocks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: '#9b9b9b', fontSize: '13px' }}>No unlock activity yet</div>
          ) : (
            <table className="ud-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th style={{ fontFamily: 'monospace', letterSpacing: 0 }}>Payment ID</th>
                </tr>
              </thead>
              <tbody>
                {unlocks.map(u => {
                  const ul = unlockLabel(u.unlock_type)
                  return (
                    <tr key={u.id}>
                      <td style={{ color: '#6b6b6b', whiteSpace: 'nowrap' }}>{fmtDate(u.created_at)} <span style={{ fontSize: '11px', color: '#b0a898' }}>· {timeAgo(u.created_at)}</span></td>
                      <td>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: ul.color }}>{ul.text}</span>
                      </td>
                      <td style={{ fontWeight: 700, color: ul.amount !== '$0' && ul.amount !== '—' ? '#1a1a1a' : '#9b9b9b' }}>{ul.amount}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '11px', color: '#c5c1b8' }}>
                        {u.stripe_payment_intent_id ? u.stripe_payment_intent_id.slice(0, 24) + '…' : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </>
  )
}
