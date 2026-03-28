'use client'

import { use, useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getPropertiesByOwner, Property } from '@/lib/properties'
import { getLeadsForOwner, Lead } from '@/lib/leads'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type CompletenessItem = { label: string; filled: boolean; weight: number }

function getCompleteness(p: Property): { items: CompletenessItem[]; pct: number } {
  const items: CompletenessItem[] = [
    { label: 'Property name',     filled: !!p.name,               weight: 1 },
    { label: 'Address',           filled: !!p.address,            weight: 1 },
    { label: 'Description',       filled: !!p.description,        weight: 2 },
    { label: 'Photos',            filled: p.images?.length > 0,   weight: 2 },
    { label: 'Price',             filled: (p.price || 0) > 0,     weight: 1 },
    { label: 'ASU distance',      filled: (p.asu_distance || 0) > 0, weight: 1 },
    { label: 'Map embed URL',     filled: !!p.map_embed_url,      weight: 1 },
    { label: 'Nearby places',     filled: p.nearby?.length > 0,   weight: 1 },
    { label: 'ASU highlights',    filled: p.asu_reasons?.length > 0, weight: 1 },
    { label: 'Tags',              filled: p.tags?.length > 0,     weight: 1 },
  ]
  const total = items.reduce((s, i) => s + i.weight, 0)
  const earned = items.filter(i => i.filled).reduce((s, i) => s + i.weight, 0)
  const pct = Math.round((earned / total) * 100)
  return { items, pct }
}

export default function ManagePropertyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const router = useRouter()
  const [property, setProperty] = useState<Property | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [descExpanded, setDescExpanded] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const [props, lds] = await Promise.all([
        getPropertiesByOwner(user.id),
        getLeadsForOwner(user.id),
      ])

      const found = props.find(p => p.slug === slug)
      if (!found) { router.push('/landlord/listings'); return }

      setProperty(found)
      setLeads(lds.filter(l => l.property === slug))
      setLoading(false)
    }
    load()
  }, [slug, router])

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: '#9b9b9b' }}>
        Loading...
      </div>
    )
  }

  if (!property) return null

  const { items: completenessItems, pct } = getCompleteness(property)
  const missing = completenessItems.filter(i => !i.filled)

  const editBase = `/landlord/listings/${slug}/edit`

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,300;1,9..144,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .mp-wrap { max-width: 860px; margin: 0 auto; padding: 24px 20px 80px; font-family: 'DM Sans', sans-serif; }

        /* REVIEW BANNER */
        .review-banner { border-radius: 12px; padding: 18px 20px; margin-bottom: 20px; }
        .review-banner-title { font-size: 15px; font-weight: 700; margin-bottom: 6px; }
        .review-banner-body { font-size: 13px; line-height: 1.6; margin-bottom: 0; }
        .review-banner-note { font-size: 13px; font-style: italic; margin-top: 8px; padding: 8px 12px; border-radius: 8px; background: rgba(159,18,57,0.07); }
        .review-banner a { font-weight: 600; }
        .review-banner-tips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
        .review-banner-tip { background: rgba(245,158,11,0.12); border: 1px solid #fde68a; border-radius: 20px; padding: 3px 10px; font-size: 11px; color: #92400e; font-weight: 600; }
        .review-banner-cta { display: inline-block; margin-top: 14px; font-size: 13px; font-weight: 700; color: #92400e; text-decoration: none; border-bottom: 1.5px solid #f59e0b; padding-bottom: 1px; }

        /* TOP BAR */
        .mp-topbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 24px; }
        .mp-breadcrumb { font-size: 13px; color: #64748b; }
        .mp-breadcrumb a { color: #10b981; text-decoration: none; }
        .mp-breadcrumb a:hover { text-decoration: underline; }
        .mp-topbar-actions { margin-left: auto; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .btn-preview { background: #fff; color: #0f172a; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 7px 14px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; white-space: nowrap; }
        .btn-preview:hover { border-color: #10b981; color: #059669; }
        .leads-badge { background: rgba(16,185,129,0.15); color: #059669; border-radius: 20px; padding: 5px 12px; font-size: 12px; font-weight: 600; white-space: nowrap; }

        /* COMPLETENESS */
        .completeness-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
        .completeness-header { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
        .completeness-ring { width: 52px; height: 52px; flex-shrink: 0; }
        .completeness-info { flex: 1; }
        .completeness-pct { font-size: 20px; font-weight: 700; color: #0f172a; }
        .completeness-label { font-size: 12px; color: #64748b; margin-top: 2px; }
        .completeness-full { color: #10b981; font-weight: 600; font-size: 13px; margin-top: 4px; }
        .progress-bar-track { height: 8px; background: #e2e8f0; border-radius: 10px; overflow: hidden; margin-bottom: 12px; }
        .progress-bar-fill { height: 100%; border-radius: 10px; transition: width 0.4s; }
        .missing-list { display: flex; flex-wrap: wrap; gap: 6px; }
        .missing-pill { background: #fef9c3; color: #92400e; border: 1px solid #fde68a; border-radius: 20px; padding: 2px 10px; font-size: 11px; font-weight: 500; }

        /* SECTION CARD */
        .section-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 12px; overflow: hidden; }
        .section-card-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid #f1f5f9; }
        .section-card-title { font-size: 13px; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px; }
        .btn-edit { background: #f8fafc; color: #0f172a; border: 1.5px solid #e2e8f0; border-radius: 7px; padding: 6px 13px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; white-space: nowrap; }
        .btn-edit:hover { border-color: #10b981; color: #059669; }
        .section-card-body { padding: 14px 18px; }

        /* Content rows */
        .detail-row { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 6px; }
        .detail-item { display: flex; flex-direction: column; gap: 2px; }
        .detail-label { font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
        .detail-value { font-size: 13px; color: #0f172a; font-weight: 500; }
        .detail-value-muted { font-size: 13px; color: #94a3b8; }

        /* Badges */
        .badge { display: inline-flex; align-items: center; border-radius: 20px; padding: 3px 10px; font-size: 11px; font-weight: 600; }
        .badge-green { background: #d1fae5; color: #065f46; }
        .badge-grey { background: #e5e7eb; color: #6b7280; }
        .badge-teal { background: rgba(16,185,129,0.15); color: #059669; }

        /* Pills */
        .pill-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
        .pill { background: #f1f5f9; color: #334155; border-radius: 20px; padding: 3px 10px; font-size: 12px; }

        /* Description */
        .desc-text { font-size: 13px; color: #334155; line-height: 1.6; }
        .desc-clamped { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .desc-toggle { background: none; border: none; color: #10b981; font-size: 12px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; padding: 4px 0 0; }

        /* Photo thumb */
        .photo-thumb { width: 80px; height: 60px; object-fit: cover; border-radius: 6px; border: 1px solid #e2e8f0; }
        .photo-count { font-size: 12px; color: #64748b; margin-top: 6px; }

        /* Nearby list */
        .nearby-item { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
        .nearby-item:last-child { border-bottom: none; }
        .nearby-place { color: #0f172a; font-weight: 500; }
        .nearby-time { color: #64748b; }

        /* Reasons */
        .reason-item { display: flex; gap: 10px; padding: 5px 0; font-size: 13px; color: #334155; }
        .reason-num { width: 20px; height: 20px; border-radius: 50%; background: rgba(16,185,129,0.15); color: #10b981; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }

        /* Map placeholder */
        .map-placeholder { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; height: 80px; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #94a3b8; margin-top: 8px; }

        @media (max-width: 560px) {
          .mp-topbar { flex-direction: column; align-items: flex-start; }
          .mp-topbar-actions { margin-left: 0; }
        }
      `}</style>

      <div className="mp-wrap">

        {/* REVIEW STATUS BANNER */}
        {property.admin_status === 'pending' && (
          <div className="review-banner" style={{ background: 'linear-gradient(135deg, #fffbeb 0%, #fefce8 100%)', border: '1.5px solid #fde68a', borderLeft: '4px solid #f59e0b' }}>
            <div className="review-banner-title" style={{ color: '#92400e' }}>You&apos;re in the queue — review in progress!</div>
            <div className="review-banner-body" style={{ color: '#78350f' }}>
              The HomeHive team is personally reviewing your listing to verify it&apos;s accurate, legitimate, and a great fit for our students.
              We do this to protect renters from scams and ensure every listing on our platform is top quality — which means <strong>serious, high-intent leads</strong> for you once you&apos;re live.
              You&apos;ll receive an email notification the moment a decision is made. <strong>Most listings are reviewed within 24 hours.</strong>
            </div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#92400e', marginTop: '12px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Boost your approval odds &amp; get more leads
            </div>
            <div className="review-banner-tips">
              <span className="review-banner-tip">Upload clear, well-lit photos</span>
              <span className="review-banner-tip">Write a detailed description</span>
              <span className="review-banner-tip">Set your ASU distance</span>
              <span className="review-banner-tip">Add nearby places</span>
              <span className="review-banner-tip">Fill out all details below</span>
            </div>
            <a href={`/landlord/listings/${slug}/edit/basics`} className="review-banner-cta">Complete your listing now →</a>
          </div>
        )}
        {property.admin_status === 'rejected' && (
          <div className="review-banner" style={{ background: '#fff1f2', border: '1.5px solid #fecdd3', borderLeft: '4px solid #9f1239' }}>
            <div className="review-banner-title" style={{ color: '#9f1239' }}>Your listing needs some updates before going live</div>
            <div className="review-banner-body" style={{ color: '#7f1d1d' }}>
              Our team reviewed your listing and couldn&apos;t approve it in its current state. Don&apos;t worry — this is fixable.
              Update your listing based on the feedback below and reach out to us so we can get you live as quickly as possible.{' '}
              <a href="mailto:hello@homehive.live" style={{ color: '#9f1239' }}>hello@homehive.live</a>
            </div>
            {property.review_note && (
              <div className="review-banner-note" style={{ color: '#9f1239' }}>
                <strong>Reviewer note:</strong> &ldquo;{property.review_note}&rdquo;
              </div>
            )}
          </div>
        )}
        {(property.admin_status === 'inactive' || property.admin_status === 'test' || property.admin_status === 'flagged') && (
          <div className="review-banner" style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderLeft: '4px solid #cbd5e1' }}>
            <div className="review-banner-title" style={{ color: '#475569' }}>This listing is not publicly visible</div>
            <div className="review-banner-body" style={{ color: '#64748b' }}>
              Students cannot currently see this listing. Contact us at{' '}
              <a href="mailto:hello@homehive.live" style={{ color: '#475569' }}>hello@homehive.live</a>{' '}
              if you believe this is an error.
            </div>
          </div>
        )}

        {/* TOP BAR */}
        <div className="mp-topbar">
          <div className="mp-breadcrumb">
            <a href="/landlord/listings">Listings</a>
            <span> &rsaquo; {property.name}</span>
          </div>
          <div className="mp-topbar-actions">
            <a href={`/landlord/listings/${slug}/preview`} target="_blank" rel="noopener noreferrer" className="btn-preview">
              Preview as Tenant →
            </a>
            <span className="leads-badge">{leads.length} lead{leads.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {/* COMPLETENESS WIDGET */}
        <div className="completeness-card">
          <div className="completeness-header">
            <svg className="completeness-ring" viewBox="0 0 52 52">
              <circle cx="26" cy="26" r="22" fill="none" stroke="#e2e8f0" strokeWidth="5" />
              <circle
                cx="26" cy="26" r="22" fill="none"
                stroke={pct === 100 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444'}
                strokeWidth="5"
                strokeDasharray={`${2 * Math.PI * 22}`}
                strokeDashoffset={`${2 * Math.PI * 22 * (1 - pct / 100)}`}
                strokeLinecap="round"
                transform="rotate(-90 26 26)"
              />
              <text x="26" y="31" textAnchor="middle" fill="#0f172a" fontSize="12" fontFamily="DM Sans, sans-serif" fontWeight="700">
                {pct}%
              </text>
            </svg>
            <div className="completeness-info">
              <div className="completeness-pct">Listing Completeness</div>
              {pct === 100
                ? <div className="completeness-full">Listing is fully optimized!</div>
                : <div className="completeness-label">{missing.length} field{missing.length !== 1 ? 's' : ''} missing — complete them to attract more leads</div>
              }
            </div>
          </div>
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill"
              style={{
                width: `${pct}%`,
                background: pct === 100 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444',
              }}
            />
          </div>
          {missing.length > 0 && (
            <div className="missing-list">
              {missing.map(m => (
                <span key={m.label} className="missing-pill">Missing: {m.label}</span>
              ))}
            </div>
          )}
        </div>

        {/* SECTION A: STATUS & AVAILABILITY */}
        <div className="section-card">
          <div className="section-card-header">
            <span className="section-card-title">Status &amp; Availability</span>
            <a href={`${editBase}/availability`} className="btn-edit">Edit</a>
          </div>
          <div className="section-card-body">
            <div className="detail-row">
              <div className="detail-item">
                <div className="detail-label">Status</div>
                <span className={`badge ${property.is_active ? 'badge-green' : 'badge-grey'}`}>
                  {property.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="detail-item">
                <div className="detail-label">Available rooms</div>
                <div className="detail-value">{property.available} of {property.total_rooms}</div>
              </div>
              {property.is_featured && (
                <div className="detail-item">
                  <div className="detail-label">Featured</div>
                  <span className="badge badge-teal">Featured</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* SECTION B: CORE DETAILS */}
        <div className="section-card">
          <div className="section-card-header">
            <span className="section-card-title">Core Details</span>
            <a href={`${editBase}/basics`} className="btn-edit">Edit</a>
          </div>
          <div className="section-card-body">
            <div className="detail-row">
              <div className="detail-item" style={{ flex: '1 1 200px' }}>
                <div className="detail-label">Name</div>
                <div className="detail-value">{property.name || <span className="detail-value-muted">Not set</span>}</div>
              </div>
              <div className="detail-item" style={{ flex: '1 1 200px' }}>
                <div className="detail-label">Address</div>
                <div className="detail-value">{property.address || <span className="detail-value-muted">Not set</span>}</div>
              </div>
            </div>
            <div className="detail-row" style={{ marginTop: '10px' }}>
              <div className="detail-item">
                <div className="detail-label">Price</div>
                <div className="detail-value">${property.price?.toLocaleString()}/mo</div>
              </div>
              <div className="detail-item">
                <div className="detail-label">Beds</div>
                <div className="detail-value">{property.beds || <span className="detail-value-muted">—</span>}</div>
              </div>
              <div className="detail-item">
                <div className="detail-label">Baths</div>
                <div className="detail-value">{property.baths || <span className="detail-value-muted">—</span>}</div>
              </div>
              <div className="detail-item">
                <div className="detail-label">Sqft</div>
                <div className="detail-value">{property.sqft || <span className="detail-value-muted">—</span>}</div>
              </div>
              <div className="detail-item">
                <div className="detail-label">ASU Distance</div>
                <div className="detail-value">{property.asu_distance ? `${property.asu_distance} min` : <span className="detail-value-muted">—</span>}</div>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION C: DESCRIPTION */}
        <div className="section-card">
          <div className="section-card-header">
            <span className="section-card-title">Description</span>
            <a href={`${editBase}/basics`} className="btn-edit">Edit</a>
          </div>
          <div className="section-card-body">
            {property.description ? (
              <>
                <p className={`desc-text${descExpanded ? '' : ' desc-clamped'}`}>
                  {property.description}
                </p>
                {property.description.length > 120 && (
                  <button className="desc-toggle" onClick={() => setDescExpanded(e => !e)}>
                    {descExpanded ? 'Show less' : 'Read more'}
                  </button>
                )}
              </>
            ) : (
              <span className="detail-value-muted" style={{ fontSize: '13px' }}>No description yet — add one to attract more tenants.</span>
            )}
          </div>
        </div>

        {/* SECTION D: PHOTOS */}
        <div className="section-card">
          <div className="section-card-header">
            <span className="section-card-title">Photos</span>
            <a href={`${editBase}/media`} className="btn-edit">Edit</a>
          </div>
          <div className="section-card-body">
            {property.images?.[0]
              ? <img src={property.images[0]} alt="Hero" className="photo-thumb" />
              : <span className="detail-value-muted" style={{ fontSize: '13px' }}>No photos yet</span>
            }
            <div className="photo-count">
              {property.images?.length > 0
                ? `${property.images.length} photo${property.images.length !== 1 ? 's' : ''} · first is hero`
                : 'No photos yet'
              }
            </div>
          </div>
        </div>

        {/* SECTION E: LOCATION */}
        <div className="section-card">
          <div className="section-card-header">
            <span className="section-card-title">Location</span>
            <a href={`${editBase}/location`} className="btn-edit">Edit</a>
          </div>
          <div className="section-card-body">
            <div className="detail-row">
              <div className="detail-item">
                <div className="detail-label">ASU Distance</div>
                <div className="detail-value">{property.asu_distance ? `${property.asu_distance} min walk` : <span className="detail-value-muted">Not set</span>}</div>
              </div>
              <div className="detail-item">
                <div className="detail-label">Coordinates</div>
                <div className="detail-value">
                  {property.lat && property.lng
                    ? `${property.lat.toFixed(4)}, ${property.lng.toFixed(4)}`
                    : <span className="detail-value-muted">Not set</span>
                  }
                </div>
              </div>
            </div>
            {property.map_embed_url
              ? <div className="map-placeholder" style={{ marginTop: '10px' }}>Map embed configured ✓</div>
              : <div className="map-placeholder">No map embed URL set</div>
            }
          </div>
        </div>

        {/* SECTION F: NEARBY PLACES */}
        <div className="section-card">
          <div className="section-card-header">
            <span className="section-card-title">Nearby Places</span>
            <a href={`${editBase}/details`} className="btn-edit">Edit</a>
          </div>
          <div className="section-card-body">
            {property.nearby?.length > 0 ? (
              property.nearby.map((n, i) => (
                <div key={i} className="nearby-item">
                  <span className="nearby-place">{n.place}</span>
                  <span className="nearby-time">{n.travel_time}</span>
                </div>
              ))
            ) : (
              <span className="detail-value-muted" style={{ fontSize: '13px' }}>No nearby places added yet</span>
            )}
          </div>
        </div>

        {/* SECTION G: ASU HIGHLIGHTS */}
        <div className="section-card">
          <div className="section-card-header">
            <span className="section-card-title">ASU Highlights</span>
            <a href={`${editBase}/details`} className="btn-edit">Edit</a>
          </div>
          <div className="section-card-body">
            {property.asu_reasons?.length > 0 ? (
              property.asu_reasons.map((r, i) => (
                <div key={i} className="reason-item">
                  <span className="reason-num">{i + 1}</span>
                  <span>{r}</span>
                </div>
              ))
            ) : (
              <span className="detail-value-muted" style={{ fontSize: '13px' }}>No ASU highlights added yet</span>
            )}
          </div>
        </div>

        {/* SECTION H: TAGS */}
        <div className="section-card">
          <div className="section-card-header">
            <span className="section-card-title">Tags</span>
            <a href={`${editBase}/details`} className="btn-edit">Edit</a>
          </div>
          <div className="section-card-body">
            {property.tags?.length > 0 ? (
              <div className="pill-list">
                {property.tags.map((tag, i) => (
                  <span key={i} className="pill">{tag}</span>
                ))}
              </div>
            ) : (
              <span className="detail-value-muted" style={{ fontSize: '13px' }}>No tags added yet</span>
            )}
          </div>
        </div>

      </div>
    </>
  )
}
