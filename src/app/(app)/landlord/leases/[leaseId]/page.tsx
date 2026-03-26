'use client'

import { useState, useEffect, use } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getLeaseById, getLeaseStatus, formatLeaseDate, getLeaseDocumentSignedUrl } from '@/lib/leases'
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

export default function ViewLeasePage({ params }: { params: Promise<{ leaseId: string }> }) {
  const { leaseId } = use(params)
  const router = useRouter()
  const [lease, setLease] = useState<Lease | null>(null)
  const [loading, setLoading] = useState(true)
  const [signedDocUrl, setSignedDocUrl] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      getLeaseById(leaseId).then(data => {
        if (!data || data.owner_id !== user.id) {
          router.push('/landlord/leases')
          return
        }
        setLease(data)
        if (data.document_url) {
          getLeaseDocumentSignedUrl(data.document_url).then(url => setSignedDocUrl(url))
        }
        setLoading(false)
      })
    })
  }, [leaseId, router])

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: '#9b9b9b' }}>
        Loading...
      </div>
    )
  }

  if (!lease) return null

  const status = getLeaseStatus(lease.start_date, lease.end_date)
  const meta = STATUS_META[status]

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .view-wrap { max-width: 680px; margin: 0 auto; padding: 32px 20px 80px; font-family: 'DM Sans', sans-serif; }
        .view-breadcrumb { font-size: 13px; color: #64748b; margin-bottom: 20px; }
        .view-breadcrumb a { color: #10b981; text-decoration: none; }
        .view-breadcrumb a:hover { text-decoration: underline; }

        .view-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 28px; gap: 12px; flex-wrap: wrap; }
        .view-title { font-size: 22px; font-weight: 700; color: #0f172a; }
        .view-subtitle { font-size: 14px; color: #64748b; margin-top: 4px; }

        .status-badge-lg { display: inline-block; padding: 5px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; border: 1px solid; }
        .btn-edit { background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; display: inline-block; }
        .btn-edit:hover { background: #1e293b; }

        .detail-card { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 16px; }
        .detail-card-title { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 16px; }
        .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .detail-field label { font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.4px; display: block; margin-bottom: 4px; }
        .detail-field .val { font-size: 15px; color: #0f172a; font-weight: 500; }
        .detail-field .val.muted { color: #cbd5e1; font-weight: 400; }

        .tenant-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
        .tenant-row:last-child { border-bottom: none; }
        .tenant-avatar { width: 36px; height: 36px; border-radius: 50%; background: rgba(16,185,129,0.15); color: #10b981; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; flex-shrink: 0; }
        .tenant-name { font-size: 14px; font-weight: 500; color: #0f172a; }
        .tenant-email { font-size: 12px; color: #94a3b8; }
        .tenant-lead-badge { font-size: 11px; color: #10b981; background: rgba(16,185,129,0.1); padding: 2px 7px; border-radius: 20px; font-weight: 500; }

        .notes-text { font-size: 14px; color: #334155; line-height: 1.6; white-space: pre-wrap; }
        .doc-link { display: inline-flex; align-items: center; gap: 6px; color: #3b82f6; font-size: 14px; font-weight: 500; text-decoration: none; }
        .doc-link:hover { text-decoration: underline; }

        @media (max-width: 480px) {
          .detail-grid { grid-template-columns: 1fr; }
          .view-header { flex-direction: column; }
        }
      `}</style>

      <div className="view-wrap">
        <div className="view-breadcrumb">
          <a href="/landlord/leases">Leases</a>
          {' › '}
          Lease Details
        </div>

        <div className="view-header">
          <div>
            <h1 className="view-title">{lease.property?.name || 'Lease'}</h1>
            {lease.unit_number && <div className="view-subtitle">Unit {lease.unit_number}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span
              className="status-badge-lg"
              style={{ color: meta.color, background: meta.bg, borderColor: meta.border }}
            >
              {meta.label}
            </span>
            <a href={`/landlord/leases/${leaseId}/edit`} className="btn-edit">Edit</a>
          </div>
        </div>

        {/* Core details */}
        <div className="detail-card">
          <div className="detail-card-title">Lease Details</div>
          <div className="detail-grid">
            <div className="detail-field">
              <label>Start Date</label>
              <div className="val">{formatLeaseDate(lease.start_date)}</div>
            </div>
            <div className="detail-field">
              <label>End Date</label>
              <div className="val">{formatLeaseDate(lease.end_date)}</div>
            </div>
            <div className="detail-field">
              <label>Monthly Rent</label>
              <div className={`val${lease.rent_amount ? '' : ' muted'}`}>
                {lease.rent_amount ? `$${lease.rent_amount.toLocaleString()}` : '—'}
              </div>
            </div>
            <div className="detail-field">
              <label>Unit / Room</label>
              <div className={`val${lease.unit_number ? '' : ' muted'}`}>
                {lease.unit_number || '—'}
              </div>
            </div>
            <div className="detail-field">
              <label>Property</label>
              <div className="val">
                {lease.property
                  ? <a href={`/landlord/listings/${lease.property.slug}`} style={{ color: '#10b981', textDecoration: 'none' }}>{lease.property.name}</a>
                  : '—'
                }
              </div>
            </div>
          </div>
        </div>

        {/* Tenants */}
        <div className="detail-card">
          <div className="detail-card-title">Tenants ({lease.tenants.length})</div>
          {lease.tenants.length === 0 ? (
            <div style={{ color: '#cbd5e1', fontSize: '14px' }}>No tenants assigned</div>
          ) : (
            lease.tenants.map(t => {
              const initials = (t.name || t.email || '?').slice(0, 2).toUpperCase()
              return (
                <div key={t.id} className="tenant-row">
                  <div className="tenant-avatar">{initials}</div>
                  <div style={{ flex: 1 }}>
                    <div className="tenant-name">{t.name || '—'}</div>
                    {t.email && <div className="tenant-email">{t.email}</div>}
                  </div>
                  {t.tenant_id && (
                    <a href="/landlord/tenants" className="tenant-lead-badge">View Tenant</a>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Notes */}
        {lease.notes && (
          <div className="detail-card">
            <div className="detail-card-title">Notes</div>
            <div className="notes-text">{lease.notes}</div>
          </div>
        )}

        {/* Document */}
        {lease.document_url && (
          <div className="detail-card">
            <div className="detail-card-title">Lease Document</div>
            {signedDocUrl
              ? <a href={signedDocUrl} target="_blank" rel="noopener noreferrer" className="doc-link">📄 Download / View Document</a>
              : <span style={{ color: '#94a3b8', fontSize: '14px' }}>Generating link...</span>
            }
          </div>
        )}
      </div>
    </>
  )
}
