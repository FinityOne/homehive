'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { AdminStatus } from '@/lib/properties'
import { planShortName, isPlanTier } from '@/lib/landlordPlans'

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

/** One row of `admin_user_directory`, as `/api/admin/users` returns it. */
type ApiRow = Profile & {
  plan_type: string | null
  plan_status: string | null
  plan_period_end: string | null
  property_count: number
  active_property_count: number
  total_leads: number
  latest_activity_at: string
  score: number
  properties: Array<{ name: string; slug: string; admin_status: string }>
}

type ApiResponse = {
  users: ApiRow[]
  total: number
  stats: { total: number; paidPlans: number; withListings: number; activeUsers: number; avgScore: number }
  roleCounts: Record<string, number>
}

/**
 * The engagement score used to be computed here, from every profile, lead and
 * property on the platform — which is precisely why the table could not be
 * paginated: you cannot ask a server for the top page of a ranking it has
 * never heard of. It now lives in the `admin_user_directory` view, digit for
 * digit, so Postgres can both compute and order by it.
 */
const toRow = (r: ApiRow): UserRow => ({
  ...r,
  propertyCount: r.property_count,
  activePropertyCount: r.active_property_count,
  totalLeads: r.total_leads,
  latestActivityAt: r.latest_activity_at,
  plan: r.plan_status
    ? { plan_type: r.plan_type ?? '', status: r.plan_status, current_period_end: r.plan_period_end }
    : null,
})

const SORT_OPTIONS = [
  { id: 'score',      label: 'Engagement' },
  { id: 'newest',     label: 'Newest' },
  { id: 'properties', label: 'Properties' },
  { id: 'leads',      label: 'Leads' },
  { id: 'name',       label: 'Name A–Z' },
] as const

function scoreMeta(s: number) {
  if (s >= 70) return { label: 'Hot', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' }
  if (s >= 45) return { label: 'Active', color: '#ea580c', bg: '#fff7ed', border: '#fed7aa' }
  if (s >= 15) return { label: 'Warm', color: '#ca8a04', bg: '#fefce8', border: '#fef08a' }
  return { label: 'Cold', color: '#9b9b9b', bg: '#f9fafb', border: '#e5e7eb' }
}

// Plan names come from `landlordPlans.ts`, so a landlord on Starter is not
// labelled with one of the three retired products this map used to list.
function planMeta(plan: Plan | null) {
  if (!plan || plan.status !== 'active') return { label: 'Free', color: '#9b9b9b', bg: '#f9fafb', border: '#e5e7eb' }
  // A live tier wears the portal green; a retired plan stays grey, so scanning
  // the list separates paying customers from grandfathered ones at a glance.
  return isPlanTier(plan.plan_type)
    ? { label: planShortName(plan.plan_type), color: '#0b6336', bg: '#e8f5ed', border: '#cfe9d9' }
    : { label: planShortName(plan.plan_type), color: '#6e6e73', bg: '#f0f0f2', border: '#e5e5ea' }
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

export function AdminUsersPage({ initialRole = 'all' }: { initialRole?: string }) {
  const router = useRouter()
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<string>('score')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<ApiResponse['stats'] | null>(null)
  const [roleCounts, setRoleCounts] = useState<Record<string, number>>({})
  const PAGE_SIZE = 25

  // The role is fixed per route (/admin/users/landlords and friends), so it is
  // not state — treating it as state is what let the old page render the wrong
  // tab's heading for a tick after a navigation.
  const roleFilter = initialRole

  // Typing is not a page view. Without this, every keystroke in the search box
  // would be a round trip; the search is now the server's job, so it has to be
  // asked at human speed rather than at keyboard speed.
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  // Drops the answer to a request that has been superseded — a slow page 1 must
  // not overwrite a fast page 2.
  const reqId = useRef(0)

  const fetchData = useCallback(async () => {
    const mine = ++reqId.current
    setLoading(true)
    const params = new URLSearchParams({
      role: roleFilter,
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sort,
    })
    if (debouncedSearch) params.set('q', debouncedSearch)

    try {
      const res = await fetch(`/api/admin/users?${params}`)
      const data = (await res.json()) as ApiResponse
      if (mine !== reqId.current) return
      setUsers((data.users ?? []).map(toRow))
      setTotal(data.total ?? 0)
      setStats(data.stats ?? null)
      setRoleCounts(data.roleCounts ?? {})
    } catch {
      if (mine === reqId.current) setUsers([])
    } finally {
      if (mine === reqId.current) setLoading(false)
    }
  }, [roleFilter, page, sort, debouncedSearch])

  useEffect(() => { document.title = 'Users — Admin | HomeHive' }, [])

  // A new search or sort starts at the top of the list, not on whatever page
  // number happened to be showing.
  useEffect(() => { setPage(1) }, [debouncedSearch, sort])

  // No `getCurrentUser()` here any more. The shell already resolved who this
  // is before the page mounted, and the API re-checks the admin role server
  // side on every call — so a second client round trip bought nothing but a
  // place in the queue ahead of the data.
  useEffect(() => { fetchData() }, [fetchData])

  const handleSave = async (userId: string, fields: Partial<Profile>) => {
    await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: userId, ...fields }),
    })
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...fields } : u))
    setEditing(null)
  }

  // Filtering, sorting and slicing all happened here before, over every row on
  // the platform. The server does all three now, so this page renders exactly
  // what it was handed.
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

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
        {/* Tab navigation */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e8e4db', marginBottom: '20px' }}>
          {([
            { href: '/admin/users/tenants',   label: 'Tenants',    role: 'tenant'   },
            { href: '/admin/users/landlords', label: 'Landlords',  role: 'landlord' },
            { href: '/admin/users/admins',    label: 'Admin Team', role: 'admin'    },
          ] as { href: string; label: string; role: string }[]).map(t => (
            <Link
              key={t.role}
              href={t.href}
              prefetch
              style={{
                padding: '12px 20px',
                fontSize: '13px',
                fontWeight: roleFilter === t.role ? 700 : 500,
                color: roleFilter === t.role ? '#8C1D40' : '#6b6b6b',
                textDecoration: 'none',
                borderBottom: `2px solid ${roleFilter === t.role ? '#8C1D40' : 'transparent'}`,
                marginBottom: '-1px',
                whiteSpace: 'nowrap',
                transition: 'color 0.12s',
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              {t.label}
              {/* Counted over the whole table by the database, so the two tabs
                  this page is not showing still carry an honest number — they
                  used to count only the rows this tab happened to hold. */}
              {roleCounts[t.role] !== undefined && (
                <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: roleFilter === t.role ? '#8C1D40' : '#94a3b8' }}>
                  {roleCounts[t.role]}
                </span>
              )}
            </Link>
          ))}
        </div>

        {/* Summary stats — computed by `admin_user_directory_stats` over the whole
            filtered set, which is what used to force the page to download it. */}
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px', marginBottom: '18px' }}>
            {[
              { val: stats.total, lbl: `Total ${roleFilter === 'admin' ? 'admins' : roleFilter === 'landlord' ? 'landlords' : 'tenants'}` },
              ...(roleFilter === 'landlord' ? [
                { val: stats.paidPlans, lbl: 'Paid plans' },
                { val: stats.withListings, lbl: 'Active listings' },
              ] : []),
              { val: stats.activeUsers, lbl: 'Active users' },
              { val: stats.avgScore, lbl: 'Avg. score' },
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
          {/* Sorting is a database order, not a client sort of a full download —
              so every option here has to be a column the view can order by. */}
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            className="u-filter-btn"
            aria-label="Sort users"
            style={{ cursor: 'pointer' }}
          >
            {SORT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <span style={{ fontSize: '13px', color: '#9b9b9b', marginLeft: 'auto' }}>
            {total} user{total !== 1 ? 's' : ''}
          </span>
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
              ) : users.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: '60px 20px', textAlign: 'center', color: '#9b9b9b', fontSize: '14px' }}>
                  {search ? 'No users match your search' : 'No users found'}
                </td></tr>
              ) : users.map(u => {
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
                                  <span style={{ color: '#0b6336', fontWeight: 600 }}>💳 {planShortName(u.plan.plan_type)} plan</span>
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

        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#fff', border: '1px solid #e8e4db', borderTop: 'none', borderRadius: '0 0 12px 12px', fontFamily: 'DM Sans, sans-serif' }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total} users
            </span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
                style={{ padding: '5px 12px', border: '1.5px solid #e8e4db', borderRadius: 6, background: '#fff', fontSize: 12, fontWeight: 600, cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.4 : 1, color: '#4a4a4a' }}
              >← Prev</button>
              <span style={{ fontSize: 12, color: '#6b6b6b', fontWeight: 600 }}>Page {page} of {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                style={{ padding: '5px 12px', border: '1.5px solid #e8e4db', borderRadius: 6, background: '#fff', fontSize: 12, fontWeight: 600, cursor: page >= totalPages ? 'not-allowed' : 'pointer', opacity: page >= totalPages ? 0.4 : 1, color: '#4a4a4a' }}
              >Next →</button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export default function AdminUsersPageDefault() {
  return <AdminUsersPage initialRole="tenant" />
}
