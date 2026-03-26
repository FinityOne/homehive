'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getLeasesForOwner, getLeaseStatus, formatLeaseDate } from '@/lib/leases'
import type { Lease, LeaseStatus } from '@/lib/leases'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const STATUS_META: Record<LeaseStatus, { label: string; color: string; bg: string; border: string }> = {
  upcoming: { label: 'Upcoming', color: '#3b82f6', bg: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.25)' },
  current:  { label: 'Current',  color: '#10b981', bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.25)' },
  past:     { label: 'Past',     color: '#6b7280', bg: 'rgba(107,114,128,0.08)', border: 'rgba(107,114,128,0.25)' },
}

export default function LandlordLeasesPage() {
  const router = useRouter()
  const [leases, setLeases] = useState<Lease[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<LeaseStatus | 'all'>('all')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      getLeasesForOwner(user.id).then(data => {
        setLeases(data)
        setLoading(false)
      })
    })
  }, [router])

  const filtered = leases.filter(l => {
    if (statusFilter === 'all') return true
    return getLeaseStatus(l.start_date, l.end_date) === statusFilter
  })

  const counts = {
    all: leases.length,
    upcoming: leases.filter(l => getLeaseStatus(l.start_date, l.end_date) === 'upcoming').length,
    current:  leases.filter(l => getLeaseStatus(l.start_date, l.end_date) === 'current').length,
    past:     leases.filter(l => getLeaseStatus(l.start_date, l.end_date) === 'past').length,
  }

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: '#9b9b9b' }}>
        Loading...
      </div>
    )
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .leases-wrap { max-width: 960px; margin: 0 auto; padding: 32px 20px 80px; font-family: 'DM Sans', sans-serif; }
        .leases-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
        .leases-title { font-size: 22px; font-weight: 700; color: #0f172a; }
        .btn-new { background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; display: inline-block; }
        .btn-new:hover { background: #1e293b; }

        .filter-tabs { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
        .filter-tab { padding: 6px 14px; border-radius: 20px; border: 1.5px solid #e2e8f0; font-size: 13px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; background: #fff; color: #64748b; transition: all 0.15s; }
        .filter-tab:hover { border-color: #94a3b8; color: #0f172a; }
        .filter-tab.active { background: #0f172a; color: #34d399; border-color: #0f172a; }

        .leases-table { width: 100%; border-collapse: collapse; }
        .leases-table th { text-align: left; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 14px; border-bottom: 1.5px solid #e2e8f0; }
        .leases-table td { padding: 14px; border-bottom: 1px solid #f1f5f9; font-size: 14px; color: #0f172a; vertical-align: middle; }
        .leases-table tr:hover td { background: #f8fafc; cursor: pointer; }

        .status-badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; border: 1px solid; }
        .tenant-pill { display: inline-block; background: #f1f5f9; border-radius: 20px; padding: 2px 8px; font-size: 12px; color: #475569; margin: 2px 2px 2px 0; }
        .prop-name { font-weight: 500; }
        .unit-text { font-size: 12px; color: #94a3b8; margin-top: 2px; }
        .rent-text { font-size: 14px; font-weight: 500; color: #10b981; }

        .empty-state { text-align: center; padding: 60px 20px; color: #94a3b8; font-size: 15px; }
        .empty-state-sub { font-size: 13px; color: #cbd5e1; margin-top: 8px; }
      `}</style>

      <div className="leases-wrap">
        <div className="leases-header">
          <h1 className="leases-title">Leases</h1>
          <a href="/landlord/leases/new" className="btn-new">+ New Lease</a>
        </div>

        <div className="filter-tabs">
          {(['all', 'upcoming', 'current', 'past'] as const).map(f => (
            <button
              key={f}
              className={`filter-tab${statusFilter === f ? ' active' : ''}`}
              onClick={() => setStatusFilter(f)}
            >
              {f === 'all' ? 'All' : STATUS_META[f].label} ({counts[f]})
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">
            No leases found
            {statusFilter !== 'all' && <div className="empty-state-sub">Try switching to a different filter</div>}
            {statusFilter === 'all' && <div className="empty-state-sub"><a href="/landlord/leases/new" style={{ color: '#10b981' }}>Create your first lease →</a></div>}
          </div>
        ) : (
          <table className="leases-table">
            <thead>
              <tr>
                <th>Property</th>
                <th>Tenants</th>
                <th>Start</th>
                <th>End</th>
                <th>Rent/mo</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(lease => {
                const status = getLeaseStatus(lease.start_date, lease.end_date)
                const meta = STATUS_META[status]
                return (
                  <tr key={lease.id} onClick={() => router.push(`/landlord/leases/${lease.id}`)}>
                    <td>
                      <div className="prop-name">{lease.property?.name || '—'}</div>
                      {lease.unit_number && <div className="unit-text">Unit {lease.unit_number}</div>}
                    </td>
                    <td>
                      {lease.tenants.length === 0
                        ? <span style={{ color: '#cbd5e1' }}>—</span>
                        : lease.tenants.map(t => (
                            <span key={t.id} className="tenant-pill">{t.name || t.email || '?'}</span>
                          ))
                      }
                    </td>
                    <td>{formatLeaseDate(lease.start_date)}</td>
                    <td>{formatLeaseDate(lease.end_date)}</td>
                    <td>
                      {lease.rent_amount
                        ? <span className="rent-text">${lease.rent_amount.toLocaleString()}</span>
                        : <span style={{ color: '#cbd5e1' }}>—</span>
                      }
                    </td>
                    <td>
                      <span
                        className="status-badge"
                        style={{ color: meta.color, background: meta.bg, borderColor: meta.border }}
                      >
                        {meta.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
