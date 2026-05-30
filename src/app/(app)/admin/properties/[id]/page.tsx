'use client'
import { getSiteUrl } from '@/lib/siteUrl'

import { use, useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getPropertyByIdForAdmin, updatePropertyAdminStatus } from '@/lib/properties'
import type { Property, AdminStatus } from '@/lib/properties'
import { getAllLeads } from '@/lib/leads'
import type { Lead } from '@/lib/leads'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const STATUS_CFG: Record<AdminStatus, { label: string; color: string; bg: string; border: string; dot: string }> = {
  active:   { label: 'Active',   color: '#166534', bg: '#f0fdf4', border: '#bbf7d0', dot: '#16a34a' },
  pending:  { label: 'Pending',  color: '#92400e', bg: '#fffbeb', border: '#fde68a', dot: '#d97706' },
  inactive: { label: 'Inactive', color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb', dot: '#9ca3af' },
  test:     { label: 'Test',     color: '#5b21b6', bg: '#f5f3ff', border: '#ddd6fe', dot: '#7c3aed' },
  flagged:  { label: 'Flagged',  color: '#9f1239', bg: '#fff1f2', border: '#fecdd3', dot: '#e11d48' },
  rejected: { label: 'Rejected', color: '#9f1239', bg: '#fff1f2', border: '#fecdd3', dot: '#e11d48' },
}

const LISTING_TYPE_LABEL: Record<string, string> = {
  standard_rental: 'Standard Rental',
  sublease:        'Sublease',
  lease_transfer:  'Lease Transfer',
}

const LEAD_STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  new:            { label: 'New',           color: '#1d4ed8', bg: '#eff6ff' },
  contacted:      { label: 'Contacted',     color: '#c9973a', bg: '#fefce8' },
  engaged:        { label: 'In Convo',      color: '#7c3aed', bg: '#f5f3ff' },
  qualified:      { label: 'Qualified',     color: '#166534', bg: '#f0fdf4' },
  tour_scheduled: { label: 'Tour Sched.',   color: '#8C1D40', bg: '#fdf2f5' },
  closed:         { label: 'Closed',        color: '#6b7280', bg: '#f3f4f6' },
}

function InfoRow({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '9px 0', borderBottom: '1px solid #f5f4f0', gap: '16px' }}>
      <span style={{ fontSize: '12px', color: '#9b9b9b', flexShrink: 0, paddingTop: '1px' }}>{label}</span>
      <span style={{ fontSize: '13px', color: '#1a1a1a', textAlign: 'right', wordBreak: 'break-all', fontFamily: mono ? 'monospace' : 'inherit', lineHeight: 1.4 }}>{value}</span>
    </div>
  )
}

function SectionHead({ title }: { title: string }) {
  return (
    <div style={{ fontSize: '10px', fontWeight: 700, color: '#9b9b9b', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: '10px', marginTop: '2px' }}>
      {title}
    </div>
  )
}

export default function AdminPropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [property, setProperty] = useState<Property | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [activePhoto, setActivePhoto] = useState(0)

  // Admin controls
  const [adminStatus, setAdminStatus] = useState<AdminStatus>('active')
  const [isTest, setIsTest] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [claimCopied, setClaimCopied] = useState(false)

  useEffect(() => { document.title = 'Property Details — Admin | HomeHive' }, [])

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const [prop, allLeads] = await Promise.all([
        getPropertyByIdForAdmin(id),
        getAllLeads(),
      ])

      if (!prop) { router.push('/admin/properties'); return }

      setProperty(prop)
      setAdminStatus((prop.admin_status as AdminStatus) ?? 'active')
      setIsTest(prop.is_test ?? false)
      setLeads(allLeads.filter(l => l.property === prop.slug))
      setLoading(false)
    }
    load()
  }, [id, router])

  const handleSave = async () => {
    if (!property) return
    setSaving(true)
    const { error } = await updatePropertyAdminStatus(property.id, adminStatus, isTest)
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
    setSaving(false)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: '#9b9b9b' }}>
        Loading...
      </div>
    )
  }

  if (!property) return null

  const siteUrl = getSiteUrl()
  const claimUrl = property.claim_token ? `${siteUrl}/claim/${property.claim_token}` : null
  const cfg = STATUS_CFG[adminStatus] ?? STATUS_CFG.active

  const leadCounts = Object.fromEntries(
    Object.keys(LEAD_STATUS_CFG).map(s => [s, leads.filter(l => l.status === s).length])
  )

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;1,9..144,300&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .apd-body { max-width: 1200px; margin: 0 auto; padding: 24px 24px 80px; font-family: 'DM Sans', sans-serif; }
        .apd-layout { display: grid; grid-template-columns: 1fr 320px; gap: 24px; align-items: start; }
        .apd-card { background: #fff; border: 1px solid #e8e4db; border-radius: 14px; overflow: hidden; margin-bottom: 16px; }
        .apd-card-head { padding: 16px 20px; border-bottom: 1px solid #f0ede6; display: flex; align-items: center; justify-content: space-between; }
        .apd-card-title { font-size: 11px; font-weight: 700; color: #9b9b9b; letter-spacing: 0.8px; text-transform: uppercase; }
        .apd-card-body { padding: 16px 20px; }
        .photos-thumb { display: flex; gap: 6px; flex-wrap: wrap; }
        .photo-thumb { width: 72px; height: 54px; border-radius: 6px; object-fit: cover; cursor: pointer; border: 2px solid transparent; transition: border-color 0.15s; }
        .photo-thumb.active { border-color: #8C1D40; }
        .chip { display: inline-flex; align-items: center; gap: 4px; background: #f5f4f0; border: 1px solid #e8e4db; border-radius: 20px; padding: 3px 10px; font-size: 12px; color: #3a3a3a; margin: 3px 3px 3px 0; }
        .nearby-row { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid #f5f4f0; gap: 12px; font-size: 13px; }
        .nearby-row:last-child { border-bottom: none; }
        .status-btn { border-radius: 20px; padding: 5px 13px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; border: 1.5px solid; transition: all 0.12s; }
        .toggle-wrap { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
        .toggle-track { width: 38px; height: 22px; border-radius: 11px; position: relative; flex-shrink: 0; transition: background 0.2s; }
        .toggle-thumb { position: absolute; top: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
        .apd-action-btn { display: inline-flex; align-items: center; gap: 5px; border-radius: 8px; padding: 8px 14px; font-size: 12px; font-weight: 600; text-decoration: none; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; border: none; }
        .apd-action-btn:hover { opacity: 0.85; }
        @media (max-width: 900px) {
          .apd-layout { grid-template-columns: 1fr; }
        }
        @media (max-width: 600px) { .apd-body { padding: 16px 16px 60px; } }
      `}</style>

      <div className="apd-body">

        {/* Breadcrumb + header */}
        <div style={{ marginBottom: '20px' }}>
          <a href="/admin/properties" style={{ fontSize: '12px', color: '#9b9b9b', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '10px' }}>
            ← All Properties
          </a>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: '26px', fontWeight: 300, color: '#1a1a1a', letterSpacing: '-0.4px', lineHeight: 1.2 }}>{property.name}</h1>
                <span style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, borderRadius: '20px', padding: '3px 11px', fontSize: '11px', fontWeight: 700 }}>
                  {cfg.label}
                </span>
                {property.is_test && (
                  <span style={{ background: '#f5f3ff', color: '#5b21b6', border: '1px solid #ddd6fe', borderRadius: '20px', padding: '3px 11px', fontSize: '11px', fontWeight: 700 }}>TEST</span>
                )}
              </div>
              <div style={{ fontSize: '13px', color: '#9b9b9b', marginTop: '4px' }}>{property.address}</div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flexShrink: 0 }}>
              <a href={`/admin/properties/${property.id}/edit`} className="apd-action-btn" style={{ background: '#18181b', color: '#fff' }}>
                Edit listing →
              </a>
              {property.admin_status === 'pending' && (
                <a href={`/admin/properties/review/${property.id}`} className="apd-action-btn" style={{ background: '#8C1D40', color: '#fff' }}>
                  Review →
                </a>
              )}
              <a href={`/homes/${property.slug}`} target="_blank" rel="noopener noreferrer" className="apd-action-btn" style={{ background: '#fff', color: '#1a1a1a', border: '1.5px solid #e8e4db' }}>
                Public listing ↗
              </a>
              <a href={`/landlord/listings/${property.slug}`} target="_blank" rel="noopener noreferrer" className="apd-action-btn" style={{ background: '#fff', color: '#1a1a1a', border: '1.5px solid #e8e4db' }}>
                Landlord view ↗
              </a>
            </div>
          </div>
        </div>

        <div className="apd-layout">

          {/* ── LEFT COLUMN ────────────────────────────────────── */}
          <div>

            {/* Photos */}
            {property.images && property.images.length > 0 && (
              <div className="apd-card" style={{ marginBottom: '16px' }}>
                <div style={{ height: '340px', overflow: 'hidden', background: '#f5f4f0' }}>
                  <img
                    src={property.images[activePhoto]}
                    alt={property.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </div>
                {property.images.length > 1 && (
                  <div style={{ padding: '12px 16px' }}>
                    <div className="photos-thumb">
                      {property.images.map((url, i) => (
                        <img
                          key={i}
                          src={url}
                          alt=""
                          className={`photo-thumb${activePhoto === i ? ' active' : ''}`}
                          onClick={() => setActivePhoto(i)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Core details */}
            <div className="apd-card">
              <div className="apd-card-head">
                <span className="apd-card-title">Listing Details</span>
                <a href={`/admin/properties/${property.id}/edit`} style={{ fontSize: '11px', color: '#8C1D40', fontWeight: 600, textDecoration: 'none' }}>Edit →</a>
              </div>
              <div className="apd-card-body">
                <InfoRow label="Listing type" value={LISTING_TYPE_LABEL[property.listing_type] ?? property.listing_type} />
                <InfoRow label="Unit type" value={property.unit_type} />
                <InfoRow label="Price" value={property.price ? `$${property.price.toLocaleString()}/mo` : undefined} />
                <InfoRow label="Security deposit" value={property.security_deposit ? `$${property.security_deposit.toLocaleString()}` : undefined} />
                <InfoRow label="Beds / Baths" value={(property.beds || property.baths) ? `${property.beds}bd / ${property.baths}ba` : undefined} />
                <InfoRow label="Sqft" value={property.sqft ?? undefined} />
                <InfoRow label="Rooms" value={property.total_rooms ? `${property.available} of ${property.total_rooms} available` : undefined} />
                <InfoRow label="ASU Distance" value={property.asu_distance != null ? `${property.asu_distance} min walk` : undefined} />
                <InfoRow label="ASU Score" value={property.asu_score != null ? `${property.asu_score}/100` : undefined} />
                <InfoRow label="Sublease start" value={property.sublease_start_date ?? undefined} />
                <InfoRow label="Sublease end" value={property.sublease_end_date ?? undefined} />
                <InfoRow label="Owner ID" value={property.owner_id ?? 'Unclaimed'} mono />
                <InfoRow label="Slug" value={property.slug} mono />
                <InfoRow label="Created" value={new Date(property.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} />
              </div>
            </div>

            {/* Description */}
            {property.description && (
              <div className="apd-card">
                <div className="apd-card-head"><span className="apd-card-title">Description</span></div>
                <div className="apd-card-body">
                  <p style={{ fontSize: '13px', color: '#3a3a3a', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{property.description}</p>
                </div>
              </div>
            )}

            {/* Special Offer */}
            {property.offer_amount && (
              <div className="apd-card" style={{ border: '1px solid #d4a843' }}>
                <div className="apd-card-head" style={{ background: 'linear-gradient(135deg, #1a1a1a, #2d2410)' }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: '#FFC627' }}>🎁 Special Offer Active</span>
                  <a href={`/admin/properties/${property.id}/edit`} style={{ fontSize: '11px', color: '#FFC627', fontWeight: 600, textDecoration: 'none' }}>Edit →</a>
                </div>
                <div className="apd-card-body">
                  <div style={{ fontSize: '22px', fontFamily: "'Fraunces', serif", fontWeight: 300, color: '#1a1a1a', letterSpacing: '-0.3px', marginBottom: '4px' }}>
                    ${property.offer_amount.toLocaleString()} lease credit
                  </div>
                  {property.offer_description && (
                    <p style={{ fontSize: '13px', color: '#6b6b6b', marginBottom: '6px' }}>{property.offer_description}</p>
                  )}
                  {property.offer_deadline && (
                    <span style={{ fontSize: '12px', color: '#92400e', fontWeight: 600 }}>
                      Sign by {new Date(property.offer_deadline + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Tags */}
            {property.tags && property.tags.length > 0 && (
              <div className="apd-card">
                <div className="apd-card-head"><span className="apd-card-title">Tags</span></div>
                <div className="apd-card-body">
                  {property.tags.map(t => <span key={t} className="chip">{t}</span>)}
                </div>
              </div>
            )}

            {/* ASU Reasons */}
            {property.asu_reasons && property.asu_reasons.length > 0 && (
              <div className="apd-card">
                <div className="apd-card-head"><span className="apd-card-title">Why ASU Students Love It</span></div>
                <div className="apd-card-body">
                  {property.asu_reasons.map((r, i) => (
                    <div key={i} style={{ display: 'flex', gap: '8px', padding: '6px 0', borderBottom: i < property.asu_reasons.length - 1 ? '1px solid #f5f4f0' : 'none' }}>
                      <span style={{ color: '#FFC627', fontWeight: 700, flexShrink: 0 }}>✓</span>
                      <span style={{ fontSize: '13px', color: '#3a3a3a' }}>{r}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Nearby */}
            {property.nearby && property.nearby.length > 0 && (
              <div className="apd-card">
                <div className="apd-card-head"><span className="apd-card-title">Nearby Places</span></div>
                <div className="apd-card-body">
                  {property.nearby.map((n, i) => (
                    <div key={i} className="nearby-row">
                      <span style={{ color: '#3a3a3a' }}>{n.place}</span>
                      <span style={{ fontSize: '12px', color: '#9b9b9b', flexShrink: 0 }}>{n.travel_time}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Leads for this property */}
            {leads.length > 0 && (
              <div className="apd-card">
                <div className="apd-card-head">
                  <span className="apd-card-title">Leads ({leads.length})</span>
                  <a href={`/admin/leads?property=${property.slug}`} style={{ fontSize: '11px', color: '#8C1D40', fontWeight: 600, textDecoration: 'none' }}>View all →</a>
                </div>
                <div className="apd-card-body" style={{ padding: '12px 20px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
                    {Object.entries(LEAD_STATUS_CFG).map(([s, c]) => {
                      const count = leadCounts[s] ?? 0
                      if (!count) return null
                      return (
                        <span key={s} style={{ background: c.bg, color: c.color, border: `1px solid ${c.color}22`, borderRadius: '20px', padding: '3px 10px', fontSize: '12px', fontWeight: 600 }}>
                          {c.label}: {count}
                        </span>
                      )
                    })}
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['Name', 'Email', 'Status', 'Move-in', 'Date'].map(h => (
                          <th key={h} style={{ textAlign: 'left', fontSize: '10px', fontWeight: 700, color: '#9b9b9b', letterSpacing: '0.6px', textTransform: 'uppercase', padding: '5px 8px 8px', borderBottom: '1px solid #e8e4db' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {leads.slice(0, 20).map(l => {
                        const lc = LEAD_STATUS_CFG[l.status] ?? LEAD_STATUS_CFG.new
                        return (
                          <tr key={l.id} style={{ borderBottom: '1px solid #f5f4f0' }}>
                            <td style={{ padding: '8px 8px', fontSize: '13px', fontWeight: 500 }}>{l.first_name || '—'}</td>
                            <td style={{ padding: '8px 8px', fontSize: '12px', color: '#6b6b6b', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.email}</td>
                            <td style={{ padding: '8px 8px' }}>
                              <span style={{ background: lc.bg, color: lc.color, borderRadius: '20px', padding: '2px 8px', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap' }}>{lc.label}</span>
                            </td>
                            <td style={{ padding: '8px 8px', fontSize: '12px', color: '#9b9b9b', whiteSpace: 'nowrap' }}>{l.move_in_date || '—'}</td>
                            <td style={{ padding: '8px 8px', fontSize: '12px', color: '#9b9b9b', whiteSpace: 'nowrap' }}>
                              {l.created_at ? new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {leads.length > 20 && (
                    <div style={{ textAlign: 'center', paddingTop: '12px', fontSize: '12px', color: '#9b9b9b' }}>
                      + {leads.length - 20} more — <a href="/admin/leads" style={{ color: '#8C1D40', fontWeight: 600, textDecoration: 'none' }}>view all leads</a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Rejection note */}
            {property.review_note && (
              <div className="apd-card" style={{ border: '1px solid #fecdd3' }}>
                <div className="apd-card-head" style={{ background: '#fff1f2' }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: '#9f1239', letterSpacing: '0.8px', textTransform: 'uppercase' }}>Rejection Note</span>
                </div>
                <div className="apd-card-body">
                  <p style={{ fontSize: '13px', color: '#3a3a3a', lineHeight: 1.6 }}>{property.review_note}</p>
                </div>
              </div>
            )}

          </div>

          {/* ── RIGHT SIDEBAR ──────────────────────────────────── */}
          <div style={{ position: 'sticky', top: '24px' }}>

            {/* Admin Status Controls */}
            <div className="apd-card" style={{ marginBottom: '12px' }}>
              <div className="apd-card-head"><span className="apd-card-title">Admin Status</span></div>
              <div className="apd-card-body">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
                  {(Object.keys(STATUS_CFG) as AdminStatus[]).map(s => {
                    const c = STATUS_CFG[s]; const active = adminStatus === s
                    return (
                      <button
                        key={s}
                        className="status-btn"
                        onClick={() => { setAdminStatus(s); if (s === 'test') setIsTest(true); else if (s === 'active') setIsTest(false) }}
                        style={{ background: active ? c.bg : '#fff', color: active ? c.color : '#9b9b9b', borderColor: active ? c.border : '#e8e4db', fontWeight: active ? 700 : 400 }}
                      >
                        {c.label}
                      </button>
                    )
                  })}
                </div>

                <div className="toggle-wrap" onClick={() => setIsTest(v => !v)} style={{ marginBottom: '16px' }}>
                  <div className="toggle-track" style={{ background: isTest ? '#7c3aed' : '#e5e7eb' }}>
                    <div className="toggle-thumb" style={{ left: isTest ? '19px' : '3px' }} />
                  </div>
                  <span style={{ fontSize: '13px', color: '#4a4a4a' }}>Test listing <span style={{ fontSize: '11px', color: '#9b9b9b' }}>(hidden from public)</span></span>
                </div>

                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{ width: '100%', background: saved ? '#16a34a' : '#18181b', color: '#fff', border: 'none', borderRadius: '8px', padding: '11px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'background 0.2s' }}
                >
                  {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save status'}
                </button>
              </div>
            </div>

            {/* Claim Link */}
            {claimUrl && (
              <div className="apd-card" style={{ marginBottom: '12px', border: '1px solid #fde68a' }}>
                <div className="apd-card-head" style={{ background: '#fffbeb' }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: '#92400e', letterSpacing: '0.8px', textTransform: 'uppercase' }}>Private Claim Link</span>
                </div>
                <div className="apd-card-body">
                  <div style={{ background: '#fff', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px', marginBottom: '8px' }}>
                    <span style={{ display: 'block', fontSize: '11px', fontFamily: 'monospace', color: '#1a1a1a', wordBreak: 'break-all', lineHeight: 1.5, marginBottom: '8px' }}>{claimUrl}</span>
                    <button
                      onClick={() => { navigator.clipboard.writeText(claimUrl); setClaimCopied(true); setTimeout(() => setClaimCopied(false), 2000) }}
                      style={{ width: '100%', background: claimCopied ? '#16a34a' : '#1a1a1a', color: '#fff', border: 'none', borderRadius: '6px', padding: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', transition: 'background 0.15s', fontFamily: "'DM Sans', sans-serif" }}
                    >
                      {claimCopied ? '✓ Copied!' : 'Copy link'}
                    </button>
                  </div>
                  <p style={{ fontSize: '11px', color: '#92400e', lineHeight: 1.5 }}>Share with landlord — link deactivates after claim.</p>
                </div>
              </div>
            )}

            {/* Quick Stats */}
            <div className="apd-card" style={{ marginBottom: '12px' }}>
              <div className="apd-card-head"><span className="apd-card-title">Lead Stats</span></div>
              <div className="apd-card-body" style={{ padding: '12px 20px' }}>
                {leads.length === 0 ? (
                  <p style={{ fontSize: '13px', color: '#9b9b9b' }}>No leads yet</p>
                ) : (
                  <>
                    <div style={{ fontSize: '28px', fontFamily: "'Fraunces', serif", fontWeight: 300, color: '#1a1a1a', letterSpacing: '-0.5px', marginBottom: '12px' }}>
                      {leads.length} <span style={{ fontSize: '14px', color: '#9b9b9b', fontFamily: "'DM Sans', sans-serif", fontWeight: 400 }}>total leads</span>
                    </div>
                    {Object.entries(LEAD_STATUS_CFG).map(([s, c]) => {
                      const count = leadCounts[s] ?? 0
                      if (!count) return null
                      return (
                        <div key={s} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f5f4f0', fontSize: '13px' }}>
                          <span style={{ color: c.color, fontWeight: 500 }}>{c.label}</span>
                          <span style={{ fontWeight: 600, color: '#1a1a1a' }}>{count}</span>
                        </div>
                      )
                    })}
                  </>
                )}
              </div>
            </div>

            {/* Quick Links */}
            <div className="apd-card">
              <div className="apd-card-head"><span className="apd-card-title">Quick Links</span></div>
              <div className="apd-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px 20px' }}>
                <a href={`/admin/properties/${property.id}/edit`} className="apd-action-btn" style={{ background: '#18181b', color: '#fff', justifyContent: 'center' }}>
                  Edit full listing →
                </a>
                {property.admin_status === 'pending' && (
                  <a href={`/admin/properties/review/${property.id}`} className="apd-action-btn" style={{ background: '#8C1D40', color: '#fff', justifyContent: 'center' }}>
                    Review listing →
                  </a>
                )}
                <a href={`/homes/${property.slug}`} target="_blank" rel="noopener noreferrer" className="apd-action-btn" style={{ background: '#fff', color: '#1a1a1a', border: '1.5px solid #e8e4db', justifyContent: 'center' }}>
                  View public listing ↗
                </a>
                <a href={`/landlord/listings/${property.slug}`} target="_blank" rel="noopener noreferrer" className="apd-action-btn" style={{ background: '#fff', color: '#1a1a1a', border: '1.5px solid #e8e4db', justifyContent: 'center' }}>
                  Landlord view ↗
                </a>
                <a href={`/admin/leads?property=${property.slug}`} className="apd-action-btn" style={{ background: '#fff', color: '#1a1a1a', border: '1.5px solid #e8e4db', justifyContent: 'center' }}>
                  View leads →
                </a>
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  )
}
