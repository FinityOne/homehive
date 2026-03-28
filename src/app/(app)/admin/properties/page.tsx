'use client'

import { useEffect, useState, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getAllPropertiesForAdmin, updatePropertyAdminStatus } from '@/lib/properties'
import type { Property, AdminStatus } from '@/lib/properties'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const ADMIN_STATUS_CFG: Record<AdminStatus, { label: string; color: string; bg: string; border: string }> = {
  active:   { label: 'Active',   color: '#166534', bg: '#f0fdf4', border: '#bbf7d0' },
  pending:  { label: 'Pending',  color: '#92400e', bg: '#fffbeb', border: '#fde68a' },
  inactive: { label: 'Inactive', color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
  test:     { label: 'Test',     color: '#5b21b6', bg: '#f5f3ff', border: '#ddd6fe' },
  flagged:  { label: 'Flagged',  color: '#9f1239', bg: '#fff1f2', border: '#fecdd3' },
  rejected: { label: 'Rejected', color: '#9f1239', bg: '#fff1f2', border: '#fecdd3' },
}
const ALL_STATUSES = Object.keys(ADMIN_STATUS_CFG) as AdminStatus[]

const LISTING_TYPE_LABEL: Record<string, string> = {
  standard_rental: 'Rental',
  sublease:        'Sublease',
  lease_transfer:  'Lease Transfer',
}

// ─── LISTING DETAIL PANEL ─────────────────────────────────────────────────────
function ListingPanel({ listing, onClose, onUpdate }: {
  listing: Property
  onClose: () => void
  onUpdate: (id: string, adminStatus: AdminStatus, isTest: boolean) => void
}) {
  const [adminStatus, setAdminStatus] = useState<AdminStatus>((listing.admin_status as AdminStatus) ?? 'active')
  const [isTest, setIsTest] = useState(listing.is_test ?? false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [claimCopied, setClaimCopied] = useState(false)

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
  const claimUrl = listing.claim_token ? `${siteUrl}/claim/${listing.claim_token}` : null

  const save = async () => {
    setSaving(true)
    const { error } = await updatePropertyAdminStatus(listing.id, adminStatus, isTest)
    if (!error) { onUpdate(listing.id, adminStatus, isTest); setSaved(true); setTimeout(() => setSaved(false), 2000) }
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex' }}>
      <div style={{ flex: 1, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)' }} onClick={onClose} />
      <div style={{ width: '440px', background: '#fff', height: '100%', overflowY: 'auto', borderLeft: '1px solid #e8e4db', display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans', sans-serif" }}>

        <div style={{ padding: '20px 24px', borderBottom: '1px solid #e8e4db', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0, paddingRight: '12px' }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#1a1a1a', marginBottom: '3px' }}>{listing.name}</div>
            <div style={{ fontSize: '12px', color: '#9b9b9b' }}>{listing.address}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', color: '#9b9b9b', cursor: 'pointer', padding: '4px', lineHeight: 1, flexShrink: 0 }}>✕</button>
        </div>

        {listing.images?.[0] && (
          <div style={{ height: '180px', overflow: 'hidden', flexShrink: 0 }}>
            <img src={listing.images[0]} alt={listing.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
        )}

        <div style={{ padding: '20px 24px', borderBottom: '1px solid #f0ede6' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: '12px' }}>Listing info</div>
          {[
            { label: 'Type',       value: LISTING_TYPE_LABEL[listing.listing_type] ?? listing.listing_type },
            { label: 'Price',      value: listing.price ? `$${listing.price.toLocaleString()}/mo` : '—' },
            { label: 'Beds/Baths', value: listing.beds || listing.baths ? `${listing.beds}bd / ${listing.baths}ba` : '—' },
            { label: 'Rooms',      value: listing.total_rooms ? `${listing.available} of ${listing.total_rooms} available` : '—' },
            { label: 'Owner ID',   value: listing.owner_id },
            { label: 'Created',    value: new Date(listing.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) },
            { label: 'Slug',       value: listing.slug },
          ].map(row => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid #f5f4f0', gap: '12px' }}>
              <span style={{ fontSize: '12px', color: '#9b9b9b', flexShrink: 0 }}>{row.label}</span>
              <span style={{ fontSize: '12px', color: '#1a1a1a', textAlign: 'right', wordBreak: 'break-all', fontFamily: row.label === 'Slug' || row.label === 'Owner ID' ? 'monospace' : 'inherit' }}>{row.value}</span>
            </div>
          ))}
        </div>

        <div style={{ padding: '20px 24px', borderBottom: '1px solid #f0ede6' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: '10px' }}>Admin status</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
            {ALL_STATUSES.map(s => {
              const cfg = ADMIN_STATUS_CFG[s]; const active = adminStatus === s
              return (
                <button key={s} onClick={() => { setAdminStatus(s); if (s === 'test') setIsTest(true); else if (s === 'active') setIsTest(false) }}
                  style={{ background: active ? cfg.bg : '#fff', color: active ? cfg.color : '#9b9b9b', border: `1.5px solid ${active ? cfg.border : '#e8e4db'}`, borderRadius: '20px', padding: '4px 12px', fontSize: '12px', fontWeight: active ? 600 : 400, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                  {cfg.label}
                </button>
              )
            })}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
            <div onClick={() => setIsTest(v => !v)}
              style={{ width: '36px', height: '20px', borderRadius: '10px', position: 'relative', flexShrink: 0, background: isTest ? '#7c3aed' : '#e5e7eb', transition: 'background 0.2s', cursor: 'pointer' }}>
              <div style={{ position: 'absolute', top: '2px', left: isTest ? '18px' : '2px', width: '16px', height: '16px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
            </div>
            <span style={{ fontSize: '13px', color: '#4a4a4a' }}>Mark as test listing <span style={{ fontSize: '11px', color: '#9b9b9b' }}>(hidden from public)</span></span>
          </label>
        </div>

        {listing.review_note && (
          <div style={{ padding: '16px 24px', borderBottom: '1px solid #f0ede6', background: '#fff1f2' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#9f1239', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: '6px' }}>Rejection note</div>
            <p style={{ fontSize: '13px', color: '#3a3a3a', lineHeight: 1.6, margin: 0 }}>{listing.review_note}</p>
          </div>
        )}

        <div style={{ padding: '20px 24px', borderBottom: '1px solid #f0ede6' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: '10px' }}>Quick actions</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <a href={`/admin/properties/${listing.id}/edit`}
              style={{ background: '#18181b', color: '#fff', border: 'none', borderRadius: '7px', padding: '7px 14px', fontSize: '12px', fontWeight: 700, textDecoration: 'none', fontFamily: "'DM Sans', sans-serif" }}>
              Edit listing →
            </a>
            {listing.admin_status === 'pending' && (
              <a href={`/admin/properties/review/${listing.id}`}
                style={{ background: '#8C1D40', color: '#fff', border: 'none', borderRadius: '7px', padding: '7px 14px', fontSize: '12px', fontWeight: 700, textDecoration: 'none', fontFamily: "'DM Sans', sans-serif" }}>
                Review listing →
              </a>
            )}
            <a href={`/listing/${listing.slug}`} target="_blank" rel="noopener noreferrer"
              style={{ background: '#fff', color: '#1a1a1a', border: '1.5px solid #e8e4db', borderRadius: '7px', padding: '7px 14px', fontSize: '12px', fontWeight: 500, textDecoration: 'none', fontFamily: "'DM Sans', sans-serif" }}>
              View public listing ↗
            </a>
            <a href={`/landlord/listings/${listing.slug}`} target="_blank" rel="noopener noreferrer"
              style={{ background: '#fff', color: '#1a1a1a', border: '1.5px solid #e8e4db', borderRadius: '7px', padding: '7px 14px', fontSize: '12px', fontWeight: 500, textDecoration: 'none', fontFamily: "'DM Sans', sans-serif" }}>
              Landlord page ↗
            </a>
          </div>
        </div>

        {claimUrl && (
          <div style={{ padding: '16px 24px', borderBottom: '1px solid #f0ede6', background: '#fffbeb' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#92400e', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: '8px' }}>Private Claim Link</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', background: '#fff', border: '1px solid #fde68a', borderRadius: '7px', padding: '8px 10px' }}>
              <span style={{ flex: 1, fontSize: '11px', fontFamily: 'monospace', color: '#1a1a1a', wordBreak: 'break-all', lineHeight: 1.4 }}>{claimUrl}</span>
              <button
                onClick={() => { navigator.clipboard.writeText(claimUrl); setClaimCopied(true); setTimeout(() => setClaimCopied(false), 2000) }}
                style={{ background: claimCopied ? '#16a34a' : '#1a1a1a', color: '#fff', border: 'none', borderRadius: '5px', padding: '5px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 0.15s', fontFamily: "'DM Sans', sans-serif" }}>
                {claimCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div style={{ fontSize: '11px', color: '#92400e', marginTop: '6px', lineHeight: 1.5 }}>
              Share with the landlord — link deactivates after claim.
            </div>
          </div>
        )}

        <div style={{ padding: '16px 24px', marginTop: 'auto', flexShrink: 0 }}>
          <button onClick={save} disabled={saving}
            style={{ width: '100%', background: saved ? '#16a34a' : '#18181b', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'background 0.2s' }}>
            {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function AdminPropertiesPage() {
  const router = useRouter()
  const [listings, setListings] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Property | null>(null)
  const [statusFilter, setStatusFilter] = useState<AdminStatus | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    const data = await getAllPropertiesForAdmin()
    setListings(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (!data.user) router.push('/login') })
    load()
  }, [load, router])

  const updateListing = (id: string, adminStatus: AdminStatus, isTest: boolean) => {
    setListings(prev => prev.map(l => l.id === id ? { ...l, admin_status: adminStatus, is_test: isTest, is_active: adminStatus === 'active' } : l))
    setSelected(prev => prev?.id === id ? { ...prev, admin_status: adminStatus, is_test: isTest, is_active: adminStatus === 'active' } : prev)
  }

  const counts = {
    all:      listings.length,
    active:   listings.filter(l => l.admin_status === 'active').length,
    pending:  listings.filter(l => l.admin_status === 'pending').length,
    inactive: listings.filter(l => l.admin_status === 'inactive').length,
    test:     listings.filter(l => l.admin_status === 'test').length,
    flagged:  listings.filter(l => l.admin_status === 'flagged').length,
    rejected: listings.filter(l => l.admin_status === 'rejected').length,
  }

  const filtered = listings.filter(l => {
    if (statusFilter !== 'all' && l.admin_status !== statusFilter) return false
    if (typeFilter !== 'all' && l.listing_type !== typeFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return l.name?.toLowerCase().includes(q) || l.address?.toLowerCase().includes(q) || l.slug?.toLowerCase().includes(q) || l.owner_id?.toLowerCase().includes(q)
    }
    return true
  })

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .p-body { max-width: 1200px; margin: 0 auto; padding: 28px 24px 80px; font-family: 'DM Sans', sans-serif; }
        .p-stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 16px; }
        .p-stat { background: #fff; border: 1px solid #e8e4db; border-radius: 10px; padding: 14px 16px; }
        .p-stat-label { font-size: 10px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 4px; }
        .p-stat-num { font-family: 'Fraunces', serif; font-size: 26px; font-weight: 300; letter-spacing: -0.8px; line-height: 1; }
        .p-filters { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
        .p-filter { padding: 5px 13px; border-radius: 20px; border: 1.5px solid #e8e4db; font-size: 12px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; background: #fff; color: #6b6b6b; transition: all 0.15s; }
        .p-filter:hover { border-color: #9b9b9b; color: #1a1a1a; }
        .p-filter.active { background: #18181b; color: #fff; border-color: #18181b; }
        .p-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
        .p-search { display: flex; align-items: center; gap: 8px; background: #fff; border: 1.5px solid #e8e4db; border-radius: 8px; padding: 0 12px; height: 36px; flex: 1; min-width: 200px; }
        .p-search input { border: none; background: none; outline: none; font-size: 13px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; width: 100%; }
        .p-search input::placeholder { color: #c5c1b8; }
        .p-type-sel { height: 36px; border: 1.5px solid #e8e4db; border-radius: 8px; padding: 0 10px; font-size: 13px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; background: #fff; cursor: pointer; outline: none; }
        .p-count { font-size: 13px; color: #9b9b9b; white-space: nowrap; }
        .p-table-wrap { background: #fff; border: 1px solid #e8e4db; border-radius: 12px; overflow: hidden; }
        .p-table { width: 100%; border-collapse: collapse; }
        .p-table th { background: #faf9f6; padding: 10px 14px; text-align: left; font-size: 10px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.6px; border-bottom: 1px solid #e8e4db; white-space: nowrap; }
        .p-table td { padding: 12px 14px; border-bottom: 1px solid #f5f4f0; vertical-align: middle; font-size: 13px; color: #1a1a1a; }
        .p-table tr:last-child td { border-bottom: none; }
        .p-table tbody tr { cursor: pointer; transition: background 0.1s; }
        .p-table tbody tr:hover { background: #faf9f6; }
        .p-name { font-size: 13px; font-weight: 600; color: #1a1a1a; margin-bottom: 2px; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .p-addr { font-size: 11px; color: #9b9b9b; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .p-slug { font-family: monospace; font-size: 11px; color: #6b6b6b; max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .test-pill { display: inline-block; background: #f5f3ff; color: #5b21b6; border: 1px solid #ddd6fe; border-radius: 4px; font-size: 10px; font-weight: 700; padding: 1px 5px; margin-left: 5px; vertical-align: middle; }
        .p-status-sel { border: none; background: transparent; font-family: 'DM Sans', sans-serif; font-size: 12px; cursor: pointer; outline: none; padding: 0; }
        @media (max-width: 900px) {
          .p-stats { grid-template-columns: repeat(3, 1fr); }
          .col-type, .col-price, .col-slug { display: none; }
        }
        @media (max-width: 600px) { .p-body { padding: 20px 16px; } .p-stats { grid-template-columns: 1fr 1fr; } }
      `}</style>

      {selected && (
        <ListingPanel listing={selected} onClose={() => setSelected(null)} onUpdate={updateListing} />
      )}

      <div className="p-body">
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: '28px', fontWeight: 300, color: '#1a1a1a', letterSpacing: '-0.5px', marginBottom: '4px' }}>Properties</h1>
          <p style={{ fontSize: '13px', color: '#9b9b9b' }}>All listings · manage status, visibility, and test flags</p>
        </div>

        {!loading && (
          <div className="p-stats">
            {(['active', 'pending', 'test', 'flagged', 'inactive'] as AdminStatus[]).map(s => {
              const cfg = ADMIN_STATUS_CFG[s]
              return (
                <div key={s} className="p-stat" style={{ borderLeft: `3px solid ${cfg.border}` }}>
                  <div className="p-stat-label">{cfg.label}</div>
                  <div className="p-stat-num" style={{ color: cfg.color }}>{counts[s]}</div>
                </div>
              )
            })}
          </div>
        )}

        <div className="p-filters">
          {(['all', 'active', 'pending', 'rejected', 'test', 'flagged', 'inactive'] as const).map(f => (
            <button key={f} className={`p-filter${statusFilter === f ? ' active' : ''}`} onClick={() => setStatusFilter(f)}>
              {f === 'all' ? 'All' : ADMIN_STATUS_CFG[f as AdminStatus].label} ({f === 'all' ? counts.all : counts[f as keyof typeof counts] ?? 0})
            </button>
          ))}
        </div>

        <div className="p-toolbar">
          <div className="p-search">
            <span style={{ color: '#9b9b9b', fontSize: '14px', flexShrink: 0 }}>⌕</span>
            <input placeholder="Search name, address, slug, owner ID..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="p-type-sel" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            <option value="standard_rental">Rental</option>
            <option value="sublease">Sublease</option>
            <option value="lease_transfer">Lease Transfer</option>
          </select>
          <span className="p-count">{filtered.length} listing{filtered.length !== 1 ? 's' : ''}</span>
          <a href="/admin/properties/new"
            style={{ height: '36px', background: 'linear-gradient(135deg, #6c002a, #8c1d40)', color: '#fff', borderRadius: '8px', padding: '0 16px', fontSize: '13px', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap', fontFamily: "'DM Sans', sans-serif" }}>
            + New listing
          </a>
        </div>

        <div className="p-table-wrap">
          <table className="p-table">
            <thead>
              <tr>
                <th>Property</th>
                <th className="col-slug">Slug</th>
                <th className="col-type">Type</th>
                <th className="col-price">Rent/mo</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#9b9b9b', fontSize: '14px' }}>Loading listings...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '60px 20px', textAlign: 'center', color: '#9b9b9b', fontSize: '14px' }}>No listings match your filters</td></tr>
              ) : filtered.map(l => {
                const adminStatus = (l.admin_status ?? 'active') as AdminStatus
                const cfg = ADMIN_STATUS_CFG[adminStatus] ?? ADMIN_STATUS_CFG.active
                return (
                  <tr key={l.id} onClick={() => setSelected(l)}>
                    <td>
                      <div className="p-name">{l.name}{l.is_test && <span className="test-pill">TEST</span>}</div>
                      <div className="p-addr">{l.address}</div>
                    </td>
                    <td className="col-slug"><span className="p-slug">{l.slug}</span></td>
                    <td className="col-type"><span style={{ fontSize: '12px', color: '#6b6b6b' }}>{LISTING_TYPE_LABEL[l.listing_type] ?? l.listing_type}</span></td>
                    <td className="col-price">
                      {l.price ? <span style={{ color: '#16a34a', fontWeight: 600 }}>${l.price.toLocaleString()}</span> : <span style={{ color: '#c5c1b8' }}>—</span>}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <select className="p-status-sel" value={adminStatus} style={{ color: cfg.color }}
                        onChange={async e => {
                          const next = e.target.value as AdminStatus
                          const nextIsTest = next === 'test' ? true : next === 'active' ? false : l.is_test
                          await updatePropertyAdminStatus(l.id, next, nextIsTest ?? false)
                          updateListing(l.id, next, nextIsTest ?? false)
                        }}>
                        {ALL_STATUSES.map(s => <option key={s} value={s}>{ADMIN_STATUS_CFG[s].label}</option>)}
                      </select>
                    </td>
                    <td style={{ color: '#9b9b9b', fontSize: '12px', whiteSpace: 'nowrap' }}>
                      {new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                      {l.admin_status === 'pending' && (
                        <a href={`/admin/properties/review/${l.id}`} onClick={e => e.stopPropagation()}
                          style={{ display: 'block', marginTop: '4px', fontSize: '11px', fontWeight: 600, color: '#8C1D40', textDecoration: 'none' }}>
                          Review →
                        </a>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
