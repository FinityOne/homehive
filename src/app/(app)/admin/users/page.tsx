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

type UserSummary = {
  owner_id: string
  propertyCount: number
  activePropertyCount: number
  totalLeads: number
  latestActivityAt: string
  properties: Array<{ name: string; slug: string; admin_status: string }>
}

const ADMIN_STATUS_CFG: Record<AdminStatus, { label: string; color: string; bg: string; border: string }> = {
  active:   { label: 'Active',   color: '#166534', bg: '#f0fdf4', border: '#bbf7d0' },
  pending:  { label: 'Pending',  color: '#92400e', bg: '#fffbeb', border: '#fde68a' },
  inactive: { label: 'Inactive', color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
  test:     { label: 'Test',     color: '#5b21b6', bg: '#f5f3ff', border: '#ddd6fe' },
  flagged:  { label: 'Flagged',  color: '#9f1239', bg: '#fff1f2', border: '#fecdd3' },
}

function buildUserSummaries(properties: Property[], leads: Lead[]): UserSummary[] {
  const leadsBySlug = new Map<string, number>()
  for (const l of leads) {
    if (l.property) leadsBySlug.set(l.property, (leadsBySlug.get(l.property) ?? 0) + 1)
  }
  const byOwner = new Map<string, UserSummary>()
  for (const p of properties) {
    const oid = p.owner_id; if (!oid) continue
    const leadsForProp = leadsBySlug.get(p.slug) ?? 0
    const existing = byOwner.get(oid)
    if (!existing) {
      byOwner.set(oid, {
        owner_id: oid, propertyCount: 1,
        activePropertyCount: p.admin_status === 'active' ? 1 : 0,
        totalLeads: leadsForProp, latestActivityAt: p.created_at,
        properties: [{ name: p.name, slug: p.slug, admin_status: p.admin_status ?? 'pending' }],
      })
    } else {
      existing.propertyCount++
      if (p.admin_status === 'active') existing.activePropertyCount++
      existing.totalLeads += leadsForProp
      existing.properties.push({ name: p.name, slug: p.slug, admin_status: p.admin_status ?? 'pending' })
      if (p.created_at > existing.latestActivityAt) existing.latestActivityAt = p.created_at
    }
  }
  return Array.from(byOwner.values()).sort((a, b) => new Date(b.latestActivityAt).getTime() - new Date(a.latestActivityAt).getTime())
}

function StatusBadge({ status }: { status: string }) {
  const cfg = ADMIN_STATUS_CFG[status as AdminStatus] ?? ADMIN_STATUS_CFG.pending
  return (
    <span style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, fontSize: '11px', fontWeight: 600, padding: '2px 9px', borderRadius: '20px', whiteSpace: 'nowrap' }}>
      {cfg.label}
    </span>
  )
}

export default function AdminUsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState<UserSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const fetchData = useCallback(async () => {
    const [leadsRes, propsData] = await Promise.all([
      supabase.from('leads').select('property, status').order('created_at', { ascending: false }),
      getAllPropertiesForAdmin(),
    ])
    const leads = (leadsRes.data ?? []) as Lead[]
    setUsers(buildUserSummaries(propsData, leads))
    setLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (!data.user) router.push('/login') })
    fetchData()
  }, [fetchData, router])

  const filtered = users.filter(u =>
    !search ||
    u.owner_id.toLowerCase().includes(search.toLowerCase()) ||
    u.properties.some(p => p.name.toLowerCase().includes(search.toLowerCase()) || p.slug.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .u-body { max-width: 1200px; margin: 0 auto; padding: 28px 24px 80px; font-family: 'DM Sans', sans-serif; }
        .u-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
        .u-search { display: flex; align-items: center; gap: 8px; background: #fff; border: 1.5px solid #e8e4db; border-radius: 8px; padding: 0 12px; height: 36px; flex: 1; max-width: 400px; }
        .u-search input { border: none; background: none; outline: none; font-size: 13px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; width: 100%; }
        .u-search input::placeholder { color: #c5c1b8; }
        .u-count { font-size: 13px; color: #9b9b9b; }
        .u-table-wrap { background: #fff; border: 1px solid #e8e4db; border-radius: 12px; overflow: hidden; }
        .u-table { width: 100%; border-collapse: collapse; }
        .u-table th { background: #faf9f6; padding: 10px 16px; text-align: left; font-size: 11px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.6px; border-bottom: 1px solid #e8e4db; white-space: nowrap; }
        .u-table td { padding: 13px 16px; border-bottom: 1px solid #f5f4f0; vertical-align: middle; font-size: 13px; }
        .u-table tr:last-child td { border-bottom: none; }
        .u-table tbody tr { cursor: pointer; transition: background 0.1s; }
        .u-table tbody tr:hover { background: #faf9f6; }
        .u-expand { background: #faf9f6; }
        .u-expand td { padding: 12px 16px 14px 36px; border-bottom: 1px solid #f5f4f0; }
        @media (max-width: 600px) { .u-body { padding: 20px 16px; } .col-active { display: none; } }
      `}</style>

      <div className="u-body">
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: '28px', fontWeight: 300, color: '#1a1a1a', letterSpacing: '-0.5px', marginBottom: '4px' }}>Users</h1>
          <p style={{ fontSize: '13px', color: '#9b9b9b' }}>Landlords · derived from property ownership</p>
        </div>

        <div className="u-toolbar">
          <div className="u-search">
            <span style={{ color: '#9b9b9b', fontSize: '14px', flexShrink: 0 }}>⌕</span>
            <input placeholder="Search owner ID, property name or slug..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <span className="u-count">{filtered.length} landlord{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="u-table-wrap">
          <table className="u-table">
            <thead>
              <tr>
                <th>Owner ID</th>
                <th>Properties</th>
                <th className="col-active">Active</th>
                <th>Total leads</th>
                <th>Last activity</th>
                <th style={{ width: '32px' }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#9b9b9b', fontSize: '14px' }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '60px 20px', textAlign: 'center', color: '#9b9b9b', fontSize: '14px' }}>
                  {search ? 'No users match your search' : 'No landlord accounts found'}
                </td></tr>
              ) : filtered.map(u => (
                <>
                  <tr key={u.owner_id} onClick={() => setExpanded(expanded === u.owner_id ? null : u.owner_id)}>
                    <td><span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#4a4a4a' }}>{u.owner_id.slice(0, 8)}…{u.owner_id.slice(-4)}</span></td>
                    <td><span style={{ fontWeight: 600, color: '#1a1a1a' }}>{u.propertyCount}</span></td>
                    <td className="col-active"><span style={{ color: u.activePropertyCount > 0 ? '#166534' : '#9b9b9b', fontWeight: u.activePropertyCount > 0 ? 600 : 400 }}>{u.activePropertyCount}</span></td>
                    <td><span style={{ color: u.totalLeads > 0 ? '#8C1D40' : '#9b9b9b', fontWeight: u.totalLeads > 0 ? 600 : 400 }}>{u.totalLeads}</span></td>
                    <td><span style={{ fontSize: '12px', color: '#9b9b9b' }}>{new Date(u.latestActivityAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</span></td>
                    <td style={{ textAlign: 'center', color: '#9b9b9b', fontSize: '11px' }}>{expanded === u.owner_id ? '▲' : '▼'}</td>
                  </tr>
                  {expanded === u.owner_id && (
                    <tr key={`${u.owner_id}-exp`} className="u-expand">
                      <td colSpan={6}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                          {u.properties.map(p => (
                            <div key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                              <StatusBadge status={p.admin_status} />
                              <span style={{ fontWeight: 500, color: '#1a1a1a' }}>{p.name}</span>
                              <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#9b9b9b' }}>{p.slug}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
