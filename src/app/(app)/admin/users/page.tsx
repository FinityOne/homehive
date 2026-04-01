'use client'

import { useEffect, useState, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getAllPropertiesForAdmin } from '@/lib/properties'
import type { Property, AdminStatus } from '@/lib/properties'
import type { Lead } from '@/lib/leads'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Profile = {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  role: string
  company_name: string | null
  verified: boolean
  onboarded: boolean
  created_at: string
}

type Plan = { plan_type: string; status: string; current_period_end: string | null }

type UserRow = Profile & {
  propertyCount: number
  activePropertyCount: number
  totalLeads: number
  latestActivityAt: string
  properties: Array<{ name: string; slug: string; admin_status: string }>
  plan: Plan | null
  score: number
}

// ─── Engagement score ──────────────────────────────────────────────────────────
// Max 100: recency (40) + active listings (35) + leads (25)
function computeScore(u: Omit<UserRow, 'score'>): number {
  const days = (Date.now() - new Date(u.latestActivityAt).getTime()) / 86400000
  const recency = days < 1 ? 40 : days < 7 ? 32 : days < 14 ? 22 : days < 30 ? 12 : days < 90 ? 4 : 0
  const listings = u.activePropertyCount >= 3 ? 35 : u.activePropertyCount === 2 ? 25 : u.activePropertyCount === 1 ? 14 : 0
  const leads = u.totalLeads >= 15 ? 25 : u.totalLeads >= 8 ? 19 : u.totalLeads >= 3 ? 12 : u.totalLeads >= 1 ? 6 : 0
  return recency + listings + leads
}

function scoreMeta(s: number) {
  if (s >= 70) return { label: 'Hot', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' }
  if (s >= 45) return { label: 'Active', color: '#ea580c', bg: '#fff7ed', border: '#fed7aa' }
  if (s >= 15) return { label: 'Warm', color: '#ca8a04', bg: '#fefce8', border: '#fef08a' }
  return { label: 'Cold', color: '#9b9b9b', bg: '#f9fafb', border: '#e5e7eb' }
}

const PLAN_LABELS: Record<string, string> = {
  per_lead: 'Pay/Lead',
  single_listing: '1 Listing',
  two_listing: 'Unlimited',
  lifetime: 'Lifetime',
}

function planMeta(plan: Plan | null) {
  if (!plan || plan.status !== 'active') return { label: 'Free', color: '#9b9b9b', bg: '#f9fafb', border: '#e5e7eb' }
  return { label: PLAN_LABELS[plan.plan_type] ?? plan.plan_type, color: '#8C1D40', bg: '#fdf2f5', border: '#f4c9d5' }
}

const ADMIN_STATUS_CFG: Record<AdminStatus, { label: string; color: string; bg: string; border: string }> = {
  active:   { label: 'Active',   color: '#166534', bg: '#f0fdf4', border: '#bbf7d0' },
  pending:  { label: 'Pending',  color: '#92400e', bg: '#fffbeb', border: '#fde68a' },
  inactive: { label: 'Inactive', color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
  test:     { label: 'Test',     color: '#5b21b6', bg: '#f5f3ff', border: '#ddd6fe' },
  flagged:  { label: 'Flagged',  color: '#9f1239', bg: '#fff1f2', border: '#fecdd3' },
  rejected: { label: 'Rejected', color: '#9f1239', bg: '#fff1f2', border: '#fecdd3' },
}

const ROLE_CFG: Record<string, { color: string; bg: string; border: string }> = {
  admin:    { color: '#1e3a8a', bg: '#eff6ff', border: '#bfdbfe' },
  landlord: { color: '#6b21a8', bg: '#faf5ff', border: '#e9d5ff' },
  tenant:   { color: '#0f766e', bg: '#f0fdfa', border: '#99f6e4' },
}

function Badge({ label, color, bg, border }: { label: string; color: string; bg: string; border: string }) {
  return (
    <span style={{ background: bg, color, border: `1px solid ${border}`, fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px', whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

function ScoreBar({ score }: { score: number }) {
  const meta = scoreMeta(score)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
      <div style={{ width: '48px', height: '4px', background: '#f0ede6', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ width: `${score}%`, height: '100%', background: meta.color, borderRadius: '2px', transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: '12px', fontWeight: 700, color: meta.color, minWidth: '22px' }}>{score}</span>
      <Badge label={meta.label} color={meta.color} bg={meta.bg} border={meta.border} />
    </div>
  )
}

function EditForm({ user, onSave, onCancel }: { user: UserRow; onSave: (updated: Partial<Profile>) => Promise<void>; onCancel: () => void }) {
  const [form, setForm] = useState({
    full_name: user.full_name ?? '',
    phone: user.phone ?? '',
    company_name: user.company_name ?? '',
    role: user.role,
    verified: user.verified,
  })
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))
  const handleSave = async () => { setSaving(true); await onSave(form); setSaving(false) }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', maxWidth: '520px' }}>
      {[
        { label: 'Full Name', key: 'full_name', val: form.full_name },
        { label: 'Phone', key: 'phone', val: form.phone },
        { label: 'Company', key: 'company_name', val: form.company_name },
      ].map(({ label, key, val }) => (
        <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</label>
          <input value={val} onChange={e => set(key, e.target.value)} style={{ border: '1.5px solid #e8e4db', borderRadius: '7px', padding: '7px 10px', fontSize: '13px', fontFamily: 'DM Sans, sans-serif', outline: 'none' }} />
        </div>
      ))}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label style={{ fontSize: '11px', fontWeight: 600, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Role</label>
        <select value={form.role} onChange={e => set('role', e.target.value)} style={{ border: '1.5px solid #e8e4db', borderRadius: '7px', padding: '7px 10px', fontSize: '13px', fontFamily: 'DM Sans, sans-serif', outline: 'none', background: '#fff' }}>
          <option value="landlord">landlord</option>
          <option value="tenant">tenant</option>
          <option value="admin">admin</option>
        </select>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', gridColumn: '1 / -1' }}>
        <input type="checkbox" id={`v-${user.id}`} checked={form.verified} onChange={e => set('verified', e.target.checked)} style={{ width: '15px', height: '15px', accentColor: '#8C1D40' }} />
        <label htmlFor={`v-${user.id}`} style={{ fontSize: '13px', color: '#4a4a4a', cursor: 'pointer' }}>Verified</label>
      </div>
      <div style={{ display: 'flex', gap: '8px', gridColumn: '1 / -1', marginTop: '4px' }}>
        <button onClick={handleSave} disabled={saving} style={{ padding: '7px 18px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, fontFamily: 'DM Sans, sans-serif' }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} style={{ padding: '7px 14px', background: 'transparent', color: '#9b9b9b', border: '1.5px solid #e8e4db', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>Cancel</button>
      </div>
    </div>
  )
}

export default function AdminUsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')

  const fetchData = useCallback(async () => {
    const [apiRes, leadsRes, propsData] = await Promise.all([
      fetch('/api/admin/users').then(r => r.json()) as Promise<{ profiles: Profile[]; plans: Record<string, Plan> }>,
      supabase.from('leads').select('property, status').order('created_at', { ascending: false }),
      getAllPropertiesForAdmin(),
    ])

    const leads = (leadsRes.data ?? []) as Lead[]
    const leadsBySlug = new Map<string, number>()
    for (const l of leads) {
      if (l.property) leadsBySlug.set(l.property, (leadsBySlug.get(l.property) ?? 0) + 1)
    }

    const propsByOwner = new Map<string, Property[]>()
    for (const p of propsData) {
      if (!p.owner_id) continue
      const arr = propsByOwner.get(p.owner_id) ?? []
      arr.push(p)
      propsByOwner.set(p.owner_id, arr)
    }

    const rows: UserRow[] = (apiRes.profiles ?? []).map(profile => {
      const ownedProps = propsByOwner.get(profile.id) ?? []
      const totalLeads = ownedProps.reduce((sum, p) => sum + (leadsBySlug.get(p.slug) ?? 0), 0)
      const latestActivityAt = ownedProps.reduce((latest, p) => p.created_at > latest ? p.created_at : latest, profile.created_at)
      const plan = apiRes.plans?.[profile.id] ?? null
      const base = {
        ...profile,
        propertyCount: ownedProps.length,
        activePropertyCount: ownedProps.filter(p => p.admin_status === 'active').length,
        totalLeads,
        latestActivityAt,
        properties: ownedProps.map(p => ({ name: p.name, slug: p.slug, admin_status: p.admin_status ?? 'pending' })),
        plan,
      }
      return { ...base, score: computeScore(base) }
    })

    // Sort by engagement score descending
    rows.sort((a, b) => b.score - a.score)
    setUsers(rows)
    setLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (!data.user) router.push('/login') })
    fetchData()
  }, [fetchData, router])

  const handleSave = async (userId: string, fields: Partial<Profile>) => {
    await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: userId, ...fields }),
    })
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...fields } : u))
    setEditing(null)
  }

  const filtered = users.filter(u => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      u.full_name?.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.phone?.includes(q) ||
      u.company_name?.toLowerCase().includes(q) ||
      u.properties.some(p => p.name.toLowerCase().includes(q))
    )
  })

  const avgScore = filtered.length ? Math.round(filtered.reduce((s, u) => s + u.score, 0) / filtered.length) : 0

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .u-body { max-width: 1200px; margin: 0 auto; padding: 28px 24px 80px; font-family: 'DM Sans', sans-serif; }
        .u-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
        .u-search { display: flex; align-items: center; gap: 8px; background: #fff; border: 1.5px solid #e8e4db; border-radius: 8px; padding: 0 12px; height: 36px; flex: 1; max-width: 360px; }
        .u-search input { border: none; background: none; outline: none; font-size: 13px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; width: 100%; }
        .u-search input::placeholder { color: #c5c1b8; }
        .u-filter-btn { height: 36px; padding: 0 14px; border: 1.5px solid #e8e4db; border-radius: 8px; background: #fff; font-size: 13px; font-family: 'DM Sans', sans-serif; color: #4a4a4a; cursor: pointer; transition: all 0.1s; }
        .u-filter-btn.active { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }
        .u-table-wrap { background: #fff; border: 1px solid #e8e4db; border-radius: 12px; overflow: hidden; }
        .u-table { width: 100%; border-collapse: collapse; }
        .u-table th { background: #faf9f6; padding: 8px 14px; text-align: left; font-size: 10px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.6px; border-bottom: 1px solid #e8e4db; white-space: nowrap; }
        .u-table td { padding: 11px 14px; border-bottom: 1px solid #f5f4f0; vertical-align: middle; font-size: 13px; }
        .u-table tr:last-child td { border-bottom: none; }
        .u-table tbody tr.u-row { cursor: pointer; transition: background 0.1s; }
        .u-table tbody tr.u-row:hover { background: #faf9f6; }
        .u-expand td { padding: 14px 14px 16px 40px; border-bottom: 1px solid #f5f4f0; background: #faf9f6; }
        input:focus, select:focus { border-color: #8C1D40 !important; }
        .u-stat { background: #fff; border: 1px solid #e8e4db; border-radius: 10px; padding: 12px 16px; }
        .u-stat-val { font-size: 22px; font-weight: 700; color: #1a1a1a; line-height: 1; margin-bottom: 3px; }
        .u-stat-lbl { font-size: 11px; color: #9b9b9b; font-weight: 500; }
        @media (max-width: 640px) { .u-body { padding: 18px 14px; } .col-score, .col-plan, .col-active, .col-leads { display: none; } }
      `}</style>

      <div className="u-body">
        <div style={{ marginBottom: '20px' }}>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: '28px', fontWeight: 300, color: '#1a1a1a', letterSpacing: '-0.5px', marginBottom: '4px' }}>Users</h1>
          <p style={{ fontSize: '13px', color: '#9b9b9b' }}>Sorted by engagement score · click a row to view full profile</p>
        </div>

        {/* Summary stats */}
        {!loading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px', marginBottom: '18px' }}>
            {[
              { val: users.length, lbl: 'Total users' },
              { val: users.filter(u => u.role === 'landlord').length, lbl: 'Landlords' },
              { val: users.filter(u => u.plan?.status === 'active').length, lbl: 'Paid plans' },
              { val: users.filter(u => u.score >= 45).length, lbl: 'Active users' },
              { val: avgScore, lbl: 'Avg. score' },
            ].map(({ val, lbl }) => (
              <div key={lbl} className="u-stat">
                <div className="u-stat-val">{val}</div>
                <div className="u-stat-lbl">{lbl}</div>
              </div>
            ))}
          </div>
        )}

        <div className="u-toolbar">
          <div className="u-search">
            <span style={{ color: '#9b9b9b', fontSize: '14px', flexShrink: 0 }}>⌕</span>
            <input placeholder="Search name, email, company…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {['all', 'landlord', 'tenant', 'admin'].map(r => (
            <button key={r} className={`u-filter-btn${roleFilter === r ? ' active' : ''}`} onClick={() => setRoleFilter(r)}>
              {r === 'all' ? 'All' : r}
            </button>
          ))}
          <span style={{ fontSize: '13px', color: '#9b9b9b', marginLeft: 'auto' }}>{filtered.length} user{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="u-table-wrap">
          <table className="u-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th className="col-plan">Plan</th>
                <th>Properties</th>
                <th className="col-active">Active</th>
                <th className="col-leads">Leads</th>
                <th className="col-score">Score</th>
                <th>Joined</th>
                <th style={{ width: '28px' }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: '#9b9b9b', fontSize: '14px' }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: '60px 20px', textAlign: 'center', color: '#9b9b9b', fontSize: '14px' }}>
                  {search ? 'No users match your search' : 'No users found'}
                </td></tr>
              ) : filtered.map(u => {
                const pm = planMeta(u.plan)
                const rm = ROLE_CFG[u.role] ?? { color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' }
                return (
                  <>
                    <tr
                      key={u.id}
                      className="u-row"
                      onClick={() => router.push(`/admin/users/${u.id}`)}
                    >
                      <td>
                        <div style={{ fontWeight: 600, color: '#1a1a1a', lineHeight: 1.3 }}>{u.full_name || <span style={{ color: '#c5c1b8', fontWeight: 400 }}>No name</span>}</div>
                        <div style={{ fontSize: '12px', color: '#9b9b9b', marginTop: '2px' }}>{u.email}</div>
                      </td>
                      <td><Badge label={u.role} color={rm.color} bg={rm.bg} border={rm.border} /></td>
                      <td className="col-plan"><Badge label={pm.label} color={pm.color} bg={pm.bg} border={pm.border} /></td>
                      <td><span style={{ fontWeight: 600, color: u.propertyCount > 0 ? '#1a1a1a' : '#9b9b9b' }}>{u.propertyCount}</span></td>
                      <td className="col-active"><span style={{ color: u.activePropertyCount > 0 ? '#166534' : '#9b9b9b', fontWeight: u.activePropertyCount > 0 ? 600 : 400 }}>{u.activePropertyCount}</span></td>
                      <td className="col-leads"><span style={{ color: u.totalLeads > 0 ? '#8C1D40' : '#9b9b9b', fontWeight: u.totalLeads > 0 ? 600 : 400 }}>{u.totalLeads}</span></td>
                      <td className="col-score"><ScoreBar score={u.score} /></td>
                      <td><span style={{ fontSize: '12px', color: '#9b9b9b' }}>{new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</span></td>
                      <td style={{ textAlign: 'center', color: '#c5c1b8', fontSize: '11px' }} onClick={e => { e.stopPropagation(); setExpanded(expanded === u.id ? null : u.id); setEditing(null) }}>
                        {expanded === u.id ? '▲' : '▼'}
                      </td>
                    </tr>
                    {expanded === u.id && (
                      <tr key={`${u.id}-exp`} className="u-expand">
                        <td colSpan={9}>
                          {editing === u.id ? (
                            <EditForm user={u} onSave={fields => handleSave(u.id, fields)} onCancel={() => setEditing(null)} />
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '13px', color: '#4a4a4a' }}>
                                {u.phone && <span>📞 {u.phone}</span>}
                                {u.company_name && <span>🏢 {u.company_name}</span>}
                                {u.verified && <span style={{ color: '#166534', fontWeight: 600 }}>✓ Verified</span>}
                                {u.plan && u.plan.status === 'active' && (
                                  <span style={{ color: '#8C1D40', fontWeight: 600 }}>💳 {PLAN_LABELS[u.plan.plan_type] ?? u.plan.plan_type} plan</span>
                                )}
                                <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#c5c1b8' }}>{u.id}</span>
                              </div>
                              {u.properties.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                  {u.properties.map(p => {
                                    const cfg = ADMIN_STATUS_CFG[p.admin_status as AdminStatus] ?? ADMIN_STATUS_CFG.pending
                                    return (
                                      <div key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                                        <Badge label={cfg.label} color={cfg.color} bg={cfg.bg} border={cfg.border} />
                                        <span style={{ fontWeight: 500, color: '#1a1a1a' }}>{p.name}</span>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button onClick={e => { e.stopPropagation(); setEditing(u.id) }} style={{ padding: '6px 14px', background: 'transparent', color: '#4a4a4a', border: '1.5px solid #e8e4db', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                                  Edit profile
                                </button>
                                <button onClick={e => { e.stopPropagation(); router.push(`/admin/users/${u.id}`) }} style={{ padding: '6px 14px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                                  View full profile →
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
