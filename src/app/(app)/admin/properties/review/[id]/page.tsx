'use client'

import { use, useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getAllPropertiesForAdmin } from '@/lib/properties'
import type { Property } from '@/lib/properties'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const LISTING_TYPE_LABEL: Record<string, string> = {
  standard_rental: 'Standard Rental',
  sublease: 'Sublease',
  lease_transfer: 'Lease Transfer',
}

const UNIT_TYPE_LABEL: Record<string, string> = {
  room_in_house: 'Room in a house',
  apartment: 'Unit in apartment',
  condo: 'Condo',
  studio: 'Studio',
}

export default function ReviewListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [property, setProperty] = useState<Property | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [rejectNote, setRejectNote] = useState('')
  const [submitting, setSubmitting] = useState<'approve' | 'reject' | null>(null)
  const [done, setDone] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const all = await getAllPropertiesForAdmin()
      const found = all.find(p => p.id === id)
      if (!found) { setNotFound(true); setLoading(false); return }
      setProperty(found)
      setLoading(false)
    }
    load()
  }, [id, router])

  async function handleAction(action: 'approve' | 'reject') {
    if (!property) return
    if (action === 'reject' && !rejectNote.trim()) {
      setErrorMsg('Please provide a reason for rejection.')
      return
    }
    setSubmitting(action)
    setErrorMsg('')

    const res = await fetch(`/api/admin/listings/${property.id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, note: action === 'reject' ? rejectNote.trim() : undefined }),
    })

    if (!res.ok) {
      setErrorMsg('Something went wrong. Please try again.')
      setSubmitting(null)
      return
    }

    setDone(true)
    setTimeout(() => router.push('/admin/properties'), 1800)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', sans-serif", fontSize: '14px', color: '#9b9b9b' }}>
        Loading…
      </div>
    )
  }

  if (notFound || !property) {
    return (
      <div style={{ padding: '40px 24px', textAlign: 'center', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ fontSize: '18px', fontWeight: 600, color: '#1a1a1a', marginBottom: '8px' }}>Listing not found</div>
        <a href="/admin/properties" style={{ color: '#8C1D40', fontSize: '14px' }}>← Back to properties</a>
      </div>
    )
  }

  if (done) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', sans-serif", gap: '12px' }}>
        <div style={{ fontSize: '32px' }}>{submitting === 'approve' ? '✅' : '🚫'}</div>
        <div style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a1a' }}>
          {submitting === 'approve' ? 'Listing approved!' : 'Listing rejected'}
        </div>
        <div style={{ fontSize: '14px', color: '#9b9b9b' }}>Redirecting to properties…</div>
      </div>
    )
  }

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .rv-wrap { max-width: 1100px; margin: 0 auto; padding: 28px 24px 80px; font-family: 'Inter', sans-serif; }
        .rv-breadcrumb { font-size: 13px; color: #897174; margin-bottom: 20px; }
        .rv-breadcrumb a { color: #8C1D40; text-decoration: none; }
        .rv-breadcrumb a:hover { text-decoration: underline; }
        .rv-title { font-family: 'Manrope', sans-serif; font-size: 24px; font-weight: 800; color: #191c1d; letter-spacing: -0.02em; margin-bottom: 4px; }
        .rv-sub { font-size: 14px; color: #897174; margin-bottom: 28px; }

        .rv-grid { display: grid; grid-template-columns: 1fr 340px; gap: 24px; align-items: start; }
        @media (max-width: 900px) { .rv-grid { grid-template-columns: 1fr; } }

        .rv-card { background: #fff; border: 1.5px solid #ddbfc3; border-radius: 14px; overflow: hidden; margin-bottom: 16px; }
        .rv-card-header { padding: 16px 20px; border-bottom: 1px solid #f3f4f5; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.7px; color: #897174; }
        .rv-card-body { padding: 20px; }

        .rv-photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
        .rv-photo { width: 100%; aspect-ratio: 4/3; object-fit: cover; border-radius: 8px; display: block; border: 1px solid #ddbfc3; }
        .rv-photo-hero { grid-column: span 2; aspect-ratio: 16/7; }
        .rv-no-photo { background: #f8f9fa; border: 1.5px dashed #ddbfc3; border-radius: 8px; padding: 32px; text-align: center; color: #897174; font-size: 13px; }

        .rv-detail-row { display: flex; justify-content: space-between; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid #f3f4f5; gap: 16px; }
        .rv-detail-row:last-child { border-bottom: none; }
        .rv-detail-label { font-size: 12px; color: #897174; flex-shrink: 0; }
        .rv-detail-value { font-size: 13px; color: #191c1d; font-weight: 500; text-align: right; }

        .rv-desc { font-size: 14px; color: #191c1d; line-height: 1.7; white-space: pre-wrap; }
        .rv-tags { display: flex; flex-wrap: wrap; gap: 6px; }
        .rv-tag { background: #fdf2f5; color: #8C1D40; border: 1px solid #f4c9d5; border-radius: 20px; padding: 3px 10px; font-size: 12px; font-weight: 500; }

        /* Action panel */
        .rv-action-card { background: #fff; border: 1.5px solid #ddbfc3; border-radius: 14px; padding: 24px; position: sticky; top: 24px; }
        .rv-action-title { font-family: 'Manrope', sans-serif; font-size: 16px; font-weight: 700; color: #191c1d; margin-bottom: 6px; }
        .rv-action-sub { font-size: 13px; color: #897174; margin-bottom: 20px; line-height: 1.5; }

        .rv-status-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 20px; margin-bottom: 20px; }

        .rv-btn-approve { width: 100%; padding: 13px; background: #16a34a; color: #fff; border: none; border-radius: 9px; font-size: 14px; font-weight: 700; cursor: pointer; font-family: 'Inter', sans-serif; transition: background 0.15s; margin-bottom: 12px; }
        .rv-btn-approve:hover:not(:disabled) { background: #15803d; }
        .rv-btn-approve:disabled { opacity: 0.6; cursor: not-allowed; }

        .rv-reject-section { border: 1.5px solid #f4c9d5; border-radius: 10px; padding: 16px; background: #fdf2f5; }
        .rv-reject-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #8C1D40; margin-bottom: 8px; }
        .rv-reject-textarea { width: 100%; border: 1.5px solid #f4c9d5; border-radius: 8px; padding: 10px 12px; font-size: 13px; font-family: 'Inter', sans-serif; color: #191c1d; background: #fff; outline: none; resize: vertical; min-height: 80px; margin-bottom: 10px; transition: border-color 0.15s; }
        .rv-reject-textarea:focus { border-color: #8C1D40; }
        .rv-reject-textarea::placeholder { color: #ddbfc3; }
        .rv-btn-reject { width: 100%; padding: 11px; background: #8C1D40; color: #fff; border: none; border-radius: 9px; font-size: 14px; font-weight: 700; cursor: pointer; font-family: 'Inter', sans-serif; transition: opacity 0.15s; }
        .rv-btn-reject:hover:not(:disabled) { opacity: 0.88; }
        .rv-btn-reject:disabled { opacity: 0.6; cursor: not-allowed; }

        .rv-error { background: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #9f1239; margin-bottom: 12px; }
        .rv-cancel { display: block; text-align: center; font-size: 13px; color: #897174; text-decoration: none; margin-top: 14px; }
        .rv-cancel:hover { color: #191c1d; }
      `}</style>

      <div className="rv-wrap">
        <div className="rv-breadcrumb">
          <a href="/admin/properties">Properties</a> › Review Listing
        </div>
        <div className="rv-title">{property.name}</div>
        <p className="rv-sub">{property.address}</p>

        <div className="rv-grid">
          {/* Left: listing details */}
          <div>
            {/* Photos */}
            <div className="rv-card">
              <div className="rv-card-header">Photos</div>
              <div className="rv-card-body">
                {property.images && property.images.length > 0 ? (
                  <div className="rv-photos">
                    {property.images.map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt={`Photo ${i + 1}`}
                        className={`rv-photo${i === 0 ? ' rv-photo-hero' : ''}`}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rv-no-photo">No photos uploaded yet</div>
                )}
              </div>
            </div>

            {/* Core details */}
            <div className="rv-card">
              <div className="rv-card-header">Listing Details</div>
              <div className="rv-card-body">
                {[
                  { label: 'Listing type',  value: LISTING_TYPE_LABEL[property.listing_type] ?? property.listing_type },
                  { label: 'Unit type',     value: property.unit_type ? (UNIT_TYPE_LABEL[property.unit_type] ?? property.unit_type) : '—' },
                  { label: 'Monthly rent',  value: property.price ? `$${property.price.toLocaleString()}/mo` : '—' },
                  { label: 'Bedrooms',      value: property.beds ? String(property.beds) : '—' },
                  { label: 'Bathrooms',     value: property.baths ? String(property.baths) : '—' },
                  { label: 'Sqft',          value: property.sqft || '—' },
                  { label: 'Rooms renting', value: property.available ? `${property.available} of ${property.total_rooms}` : '—' },
                  { label: 'ASU distance',  value: property.asu_distance ? `${property.asu_distance} mi` : '—' },
                  { label: 'Owner ID',      value: property.owner_id },
                  { label: 'Submitted',     value: new Date(property.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) },
                ].map(row => (
                  <div key={row.label} className="rv-detail-row">
                    <span className="rv-detail-label">{row.label}</span>
                    <span className="rv-detail-value" style={{ fontFamily: row.label === 'Owner ID' ? 'monospace' : 'inherit', fontSize: row.label === 'Owner ID' ? '11px' : undefined }}>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Description */}
            {property.description && (
              <div className="rv-card">
                <div className="rv-card-header">Description</div>
                <div className="rv-card-body">
                  <p className="rv-desc">{property.description}</p>
                </div>
              </div>
            )}

            {/* Tags */}
            {property.tags && property.tags.length > 0 && (
              <div className="rv-card">
                <div className="rv-card-header">Tags</div>
                <div className="rv-card-body">
                  <div className="rv-tags">
                    {property.tags.map(tag => (
                      <span key={tag} className="rv-tag">{tag}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right: action panel */}
          <div>
            <div className="rv-action-card">
              <div className="rv-action-title">Review this listing</div>
              <p className="rv-action-sub">
                Approve to make it live for students, or reject with a note explaining what needs to change.
              </p>

              <div className="rv-status-pill" style={{
                background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a',
              }}>
                <span>⏳</span> Pending Review
              </div>

              {errorMsg && <div className="rv-error">{errorMsg}</div>}

              <button
                className="rv-btn-approve"
                disabled={!!submitting}
                onClick={() => handleAction('approve')}
              >
                {submitting === 'approve' ? 'Approving…' : '✓ Approve listing'}
              </button>

              <div className="rv-reject-section">
                <div className="rv-reject-label">Reject with reason</div>
                <textarea
                  className="rv-reject-textarea"
                  placeholder="e.g. Missing photos, incomplete address, price seems inaccurate…"
                  value={rejectNote}
                  onChange={e => { setRejectNote(e.target.value); setErrorMsg('') }}
                />
                <button
                  className="rv-btn-reject"
                  disabled={!!submitting}
                  onClick={() => handleAction('reject')}
                >
                  {submitting === 'reject' ? 'Rejecting…' : '✕ Reject listing'}
                </button>
              </div>

              <a href="/admin/properties" className="rv-cancel">← Back to properties</a>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
