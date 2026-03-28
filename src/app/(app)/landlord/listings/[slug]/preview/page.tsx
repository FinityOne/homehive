'use client'

import { use, useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getPropertiesByOwner, Property } from '@/lib/properties'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const TAG_ICONS: Record<string, string> = {
  wifi: '⚡', internet: '⚡',
  washer: '🧺', laundry: '🧺',
  ac: '❄️', heat: '❄️',
  parking: '🚗', garage: '🚗',
  pet: '🐾', pets: '🐾',
  furnished: '🛋️',
  pool: '🏊', gym: '💪',
  yard: '🌿', balcony: '🏠', patio: '🏠',
  dishwasher: '🍽️',
}
function tagIcon(tag: string): string {
  const lower = tag.toLowerCase()
  for (const [key, icon] of Object.entries(TAG_ICONS)) {
    if (lower.includes(key)) return icon
  }
  return '✓'
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pending:  { label: 'Under Review',  color: '#92400e', bg: '#fffbeb', border: '#fde68a' },
  active:   { label: 'Live',          color: '#065f46', bg: '#d1fae5', border: '#6ee7b7' },
  rejected: { label: 'Not Approved',  color: '#9f1239', bg: '#fff1f2', border: '#fecdd3' },
  inactive: { label: 'Inactive',      color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' },
}

export default function ListingPreviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const router = useRouter()
  const [property, setProperty] = useState<Property | null>(null)
  const [loading, setLoading] = useState(true)
  const [activePhoto, setActivePhoto] = useState(0)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const props = await getPropertiesByOwner(user.id)
      const found = props.find(p => p.slug === slug)
      if (!found) { router.push('/landlord/listings'); return }
      setProperty(found)
      setLoading(false)
    }
    load()
  }, [slug, router])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: '#9b9b9b' }}>
        Loading preview…
      </div>
    )
  }

  if (!property) return null

  const allImages = (property.images || []).filter(Boolean)
  const mainImage = allImages[activePhoto] ?? ''
  const isPending = property.admin_status === 'pending'
  const statusCfg = STATUS_LABELS[property.admin_status] ?? STATUS_LABELS['inactive']
  const listingTypeCfg = property.listing_type === 'sublease'
    ? { label: 'Sublease', color: '#6d28d9', bg: '#f5f3ff', border: '#ddd6fe' }
    : property.listing_type === 'lease_transfer'
      ? { label: 'Lease Transfer', color: '#0f766e', bg: '#f0fdfa', border: '#99f6e4' }
      : { label: 'Whole Home', color: '#1e40af', bg: '#eff6ff', border: '#bfdbfe' }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .preview-banner {
          position: fixed; top: 0; left: 0; right: 0; z-index: 999;
          background: linear-gradient(90deg, #1a1a1a 0%, #2d2410 100%);
          border-bottom: 2px solid #f59e0b;
          padding: 10px 20px;
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          flex-wrap: wrap;
        }
        .preview-banner-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .preview-badge { background: #f59e0b; color: #1a1a1a; font-size: 11px; font-weight: 800; padding: 3px 10px; border-radius: 20px; letter-spacing: 0.5px; text-transform: uppercase; white-space: nowrap; }
        .preview-banner-msg { font-size: 13px; color: #fef3c7; font-family: 'DM Sans', sans-serif; }
        .preview-banner-msg strong { color: #fbbf24; }
        .preview-back { font-size: 12px; font-weight: 600; color: #fbbf24; text-decoration: none; white-space: nowrap; border: 1px solid rgba(251,191,36,0.4); border-radius: 20px; padding: 4px 12px; transition: background 0.15s; font-family: 'DM Sans', sans-serif; }
        .preview-back:hover { background: rgba(251,191,36,0.15); }

        body { font-family: 'DM Sans', sans-serif; background: #f5f4f0; color: #1a1a1a; }

        .prop-page  { max-width: 1200px; margin: 0 auto; padding: 80px 24px 120px; }

        .prop-split { display: grid; grid-template-columns: 1fr 360px; gap: 32px; align-items: start; margin-top: 24px; }
        .prop-left  { min-width: 0; }
        .prop-right { position: sticky; top: 80px; }

        /* Gallery */
        .gallery-hero { position: relative; border-radius: 16px; overflow: hidden; height: 440px; background: #1e293b; margin-bottom: 8px; }
        .gallery-hero img { width: 100%; height: 100%; object-fit: cover; filter: blur(14px); transform: scale(1.05); }
        .gallery-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: rgba(0,0,0,0.35); }
        .gallery-overlay-icon { font-size: 36px; line-height: 1; }
        .gallery-overlay-label { font-size: 13px; font-weight: 700; color: #fef3c7; background: rgba(245,158,11,0.85); border-radius: 20px; padding: 5px 16px; border: 1px solid rgba(251,191,36,0.6); letter-spacing: 0.3px; }
        .gallery-overlay-sub { font-size: 12px; color: rgba(255,255,255,0.75); }
        .gallery-strip { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
        .gallery-thumb { flex-shrink: 0; width: 90px; height: 66px; border-radius: 8px; overflow: hidden; border: 2px solid transparent; opacity: 0.6; }
        .gallery-thumb.active { border-color: #f59e0b; opacity: 0.8; }
        .gallery-thumb img { width: 100%; height: 100%; object-fit: cover; filter: blur(6px); transform: scale(1.1); }

        /* Section */
        .section { background: #fff; border-radius: 14px; padding: 24px; margin-top: 16px; border: 1px solid #e8e5de; }
        .section-label { font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: #d4a843; margin-bottom: 14px; }

        /* Stats row */
        .stats-row { display: flex; border: 1px solid #e8e5de; border-radius: 10px; overflow: hidden; margin-bottom: 16px; }
        .stat-item { flex: 1; padding: 14px 10px; text-align: center; border-right: 1px solid #e8e5de; }
        .stat-item:last-child { border-right: none; }
        .stat-num { font-family: 'DM Serif Display', serif; font-size: 22px; color: #1a1a1a; }
        .stat-lbl { font-size: 11px; color: #9b9b9b; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.4px; }

        .tags-wrap { display: flex; flex-wrap: wrap; gap: 8px; }
        .tag-pill { display: flex; align-items: center; gap: 6px; padding: 7px 13px; background: #faf9f6; border: 1px solid #e8e5de; border-radius: 20px; font-size: 13px; color: #3a3a3a; }

        .pain-list { display: flex; flex-direction: column; gap: 10px; }
        .pain-item { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; background: #faf9f6; border-radius: 8px; border: 1px solid #e8e5de; }
        .pain-dot { width: 7px; height: 7px; border-radius: 50%; background: #d4a843; flex-shrink: 0; margin-top: 7px; }
        .pain-text { font-size: 14px; color: #3a3a3a; line-height: 1.65; }

        .pricing-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f0ede6; font-size: 14px; }
        .pricing-row:last-of-type { border-bottom: none; }
        .pricing-label { color: #6b6b6b; }
        .pricing-val { font-weight: 500; }
        .pricing-val.green { color: #16a34a; }
        .pricing-total { display: flex; justify-content: space-between; padding-top: 13px; margin-top: 6px; border-top: 2px solid #1a1a1a; font-size: 16px; font-weight: 600; }

        .map-wrap { border-radius: 10px; overflow: hidden; border: 1px solid #e8e5de; margin-bottom: 12px; }
        .nearby-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .nearby-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #faf9f6; border-radius: 8px; border: 1px solid #e8e5de; }
        .nearby-place { font-size: 13px; color: #3a3a3a; }
        .nearby-time { font-size: 12px; color: #d4a843; font-weight: 500; }

        .testimonial { padding: 16px 18px; background: #faf9f6; border-radius: 10px; border: 1px solid #e8e5de; border-left: 3px solid #d4a843; margin-bottom: 10px; }
        .testimonial-quote { font-size: 14px; color: #3a3a3a; line-height: 1.65; font-style: italic; margin-bottom: 6px; filter: blur(4px); user-select: none; }
        .testimonial-author { font-size: 12px; color: #9b9b9b; font-weight: 500; filter: blur(3px); user-select: none; }

        /* Review overlay for certain sections */
        .review-overlay-wrap { position: relative; }
        .review-overlay { position: absolute; inset: 0; background: rgba(255,251,235,0.85); border-radius: 14px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; z-index: 2; backdrop-filter: blur(2px); border: 1.5px dashed #fde68a; }
        .review-overlay-text { font-size: 12px; font-weight: 700; color: #92400e; text-align: center; padding: 0 16px; }
        .review-overlay-badge { font-size: 11px; color: #92400e; background: #fef3c7; border: 1px solid #fde68a; border-radius: 20px; padding: 3px 12px; font-weight: 600; }

        /* Form card — preview state */
        .form-card { background: #fff; border-radius: 16px; border: 1px solid #e8e5de; box-shadow: 0 4px 24px rgba(0,0,0,0.06); overflow: hidden; }
        .form-card-preview-header { background: linear-gradient(135deg, #1a1a1a 0%, #2d2410 100%); padding: 18px 22px; border-bottom: 2px solid #f59e0b; }
        .form-card-body { padding: 22px; }
        .redacted-field { height: 44px; border-radius: 9px; background: #f1f5f9; border: 1.5px dashed #cbd5e1; margin-bottom: 10px; display: flex; align-items: center; padding: 0 14px; gap: 8px; }
        .redacted-dot { width: 8px; height: 8px; border-radius: 50%; background: #cbd5e1; }
        .redacted-line { height: 10px; border-radius: 4px; background: #e2e8f0; flex: 1; }
        .redacted-btn { width: 100%; height: 50px; border-radius: 9px; background: #f1f5f9; border: 1.5px dashed #cbd5e1; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; color: #94a3b8; font-family: 'DM Sans', sans-serif; margin-top: 4px; }

        /* Mobile sticky */
        .mobile-preview-bar {
          display: none;
          position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;
          background: #1a1a1a; border-top: 2px solid #f59e0b;
          padding: 12px 20px 20px;
        }

        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }

        @media (max-width: 860px) {
          .prop-split { grid-template-columns: 1fr; }
          .prop-right { display: none; }
          .mobile-preview-bar { display: block; }
          .gallery-hero { height: 300px; }
          .nearby-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 500px) {
          .prop-page { padding: 72px 16px 100px; }
          .gallery-hero { height: 240px; border-radius: 12px; }
        }
      `}</style>

      {/* FIXED PREVIEW BANNER */}
      <div className="preview-banner">
        <div className="preview-banner-left">
          <span className="preview-badge">Preview Mode</span>
          <span className="preview-banner-msg">
            {isPending
              ? <>This is how your listing will look to students. <strong>Images and contact info are hidden until approved.</strong></>
              : <>Previewing your listing as a student would see it. Status: <strong style={{ color: statusCfg.color === '#065f46' ? '#6ee7b7' : '#fbbf24' }}>{statusCfg.label}</strong></>
            }
          </span>
        </div>
        <a href={`/landlord/listings/${slug}`} className="preview-back">← Back to manage</a>
      </div>

      <div className="prop-page">

        {/* Back nav */}
        <a
          href={`/landlord/listings/${slug}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '13px', color: '#b0a898', textDecoration: 'none', marginBottom: '10px' }}
        >
          <span style={{ fontSize: '15px' }}>←</span> Back to listing manager
        </a>

        {/* Breadcrumb */}
        <div style={{ fontSize: '12px', color: '#9b9b9b', marginBottom: '16px' }}>
          HomeHive › Homes › <strong>{property.name}</strong>
        </div>

        {/* Title row */}
        <div>
          <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 'clamp(26px,4vw,38px)', color: '#1a1a1a', lineHeight: 1.15, marginBottom: '8px' }}>{property.name}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14px', color: '#6b6b6b' }}>📍 {property.address}</span>
            <span style={{ fontSize: '11px', fontWeight: 600, padding: '4px 10px', borderRadius: '6px', background: listingTypeCfg.bg, color: listingTypeCfg.color, border: `1px solid ${listingTypeCfg.border}`, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: listingTypeCfg.color, display: 'inline-block', flexShrink: 0 }} />
              {listingTypeCfg.label}
            </span>
            <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '20px', background: '#fdf4ff', color: '#7e22ce', border: '1px solid #e9d5ff' }}>✓ HomeHive Verified</span>
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', background: statusCfg.bg, color: statusCfg.color, border: `1px solid ${statusCfg.border}` }}>
              {statusCfg.label}
            </span>
          </div>
        </div>

        {/* SPLIT LAYOUT */}
        <div className="prop-split">

          {/* LEFT */}
          <div className="prop-left">

            {/* GALLERY — blurred */}
            <div style={{ marginTop: '20px' }}>
              <div className="gallery-hero">
                {mainImage
                  ? <img src={mainImage} alt={property.name} />
                  : <div style={{ width: '100%', height: '100%', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '48px' }}>🏠</div>
                }
                <div className="gallery-overlay">
                  <div className="gallery-overlay-icon">📸</div>
                  <div className="gallery-overlay-label">
                    {isPending ? 'Photos visible after approval' : 'Photo Preview'}
                  </div>
                  {isPending && (
                    <div className="gallery-overlay-sub">
                      {allImages.length} photo{allImages.length !== 1 ? 's' : ''} uploaded · revealed once your listing goes live
                    </div>
                  )}
                </div>
              </div>
              {allImages.length > 1 && (
                <div className="gallery-strip">
                  {allImages.map((img, i) => (
                    <div key={i} className={`gallery-thumb${activePhoto === i ? ' active' : ''}`} onClick={() => setActivePhoto(i)} style={{ cursor: 'pointer' }}>
                      <img src={img} alt={`Photo ${i + 1}`} />
                    </div>
                  ))}
                </div>
              )}
              {isPending && (
                <div style={{ marginTop: '8px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: '#92400e', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>⏳</span>
                  <span>Your {allImages.length} photo{allImages.length !== 1 ? 's' : ''} are uploaded and will be visible to students the moment your listing is approved.</span>
                </div>
              )}
            </div>

            {/* STATS */}
            <div className="section">
              <div className="section-label">Property Overview</div>
              <div className="stats-row">
                {([
                  [String(property.beds || '—'), 'Beds'],
                  [String(property.baths || '—'), 'Baths'],
                  ...(property.sqft?.trim() ? [[String(property.sqft), 'Sq Ft']] : []),
                  [`${property.asu_distance ?? '?'} mi`, 'To ASU'],
                ] as [string, string][]).map(([n, l]) => (
                  <div className="stat-item" key={l}>
                    <div className="stat-num">{n}</div>
                    <div className="stat-lbl">{l}</div>
                  </div>
                ))}
              </div>
              {property.tags && property.tags.length > 0 && (
                <div className="tags-wrap">
                  {property.tags.map(tag => (
                    <div key={tag} className="tag-pill">
                      <span>{tagIcon(tag)}</span>
                      <span>{tag}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* DESCRIPTION */}
            {property.description && (
              <div className="section">
                <div className="section-label">About this home</div>
                <p style={{ fontSize: '14px', color: '#3a3a3a', lineHeight: 1.75 }}>{property.description}</p>
              </div>
            )}

            {/* ASU HIGHLIGHTS */}
            {property.asu_reasons && property.asu_reasons.length > 0 && (
              <div className="section">
                <div className="section-label">Why ASU students love it</div>
                <div className="pain-list">
                  {property.asu_reasons.map((text, i) => (
                    <div className="pain-item" key={i}>
                      <div className="pain-dot" />
                      <p className="pain-text">{text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* PRICING */}
            <div className="section">
              <div className="section-label">Transparent Pricing</div>
              {[
                ['Monthly rent (per room)', `$${(property.price || 0).toLocaleString()}`, false],
                ['Utilities (water, electric, gas)', 'Included', true],
                ['High-speed WiFi', 'Included', true],
                ['Move-in fee', '$0', true],
                ['Broker / agency fee', '$0', true],
                ['Security deposit',
                  property.security_deposit === 0 ? '$0 — No deposit required' :
                  property.security_deposit != null ? `$${property.security_deposit.toLocaleString()} (refundable)` :
                  'Not set',
                  property.security_deposit === 0],
              ].map(([l, v, g]) => (
                <div className="pricing-row" key={String(l)}>
                  <span className="pricing-label">{l}</span>
                  <span className={`pricing-val${g ? ' green' : ''}`}>{v}</span>
                </div>
              ))}
              <div className="pricing-total">
                <span>Total to move in</span>
                <span>
                  {property.security_deposit === 0
                    ? `$${(property.price || 0).toLocaleString()}`
                    : `$${((property.price || 0) + (property.security_deposit ?? (property.price || 0))).toLocaleString()}`}
                </span>
              </div>
            </div>

            {/* LOCATION */}
            {property.map_embed_url && (
              <div className="section">
                <div className="section-label">Location</div>
                <div className="map-wrap">
                  <iframe src={property.map_embed_url} style={{ width: '100%', height: '220px', border: 'none', display: 'block' }} loading="lazy" />
                </div>
                {property.nearby && property.nearby.length > 0 && (
                  <div className="nearby-grid">
                    {property.nearby.map(n => (
                      <div className="nearby-item" key={n.place}>
                        <span className="nearby-place">{n.place}</span>
                        <span className="nearby-time">{n.travel_time}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TESTIMONIALS — blurred when pending */}
            <div className="section">
              <div className="section-label">What students say</div>
              {[
                { q: 'Found my roommates through HomeHive before I even moved in. So much less stressful than scrolling Facebook groups for weeks.', a: 'Sofia M. — ASU Junior, Psychology' },
                { q: "The price I saw was exactly what I paid. No surprise fees at signing — first time that's ever happened renting near campus.", a: 'Marcus T. — ASU Grad Student, Engineering' },
              ].map(({ q, a }) => (
                <div className="testimonial" key={a}>
                  <p className="testimonial-quote">"{q}"</p>
                  <p className="testimonial-author">— {a}</p>
                </div>
              ))}
              {isPending && (
                <div style={{ marginTop: '10px', fontSize: '11px', color: '#94a3b8', textAlign: 'center' }}>Student reviews will appear here after your listing goes live</div>
              )}
            </div>

          </div>{/* /prop-left */}

          {/* RIGHT — preview form card */}
          <div className="prop-right">
            <div className="form-card">
              <div className="form-card-preview-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#f59e0b' }}>Preview Mode</span>
                </div>
                <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: '16px', color: '#fff', lineHeight: 1.3 }}>
                  {isPending
                    ? 'Students will see this inquiry form once your listing is approved'
                    : 'This is the inquiry form students use to contact you'
                  }
                </div>
              </div>
              <div className="form-card-body">
                {/* Price (real) */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '2px' }}>
                    <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: '30px', color: '#1a1a1a', letterSpacing: '-0.5px' }}>${(property.price || 0).toLocaleString()}</span>
                    <span style={{ fontSize: '13px', color: '#9b9b9b' }}>/mo per room</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b6b6b' }}>Est. all-in: <strong style={{ color: '#1a1a1a' }}>${(property.price || 0) + 65}–${(property.price || 0) + 140}/mo</strong></div>
                </div>

                {/* Availability badge */}
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: statusCfg.bg, color: statusCfg.color, fontSize: '12px', fontWeight: 600, padding: '5px 12px', borderRadius: '20px', marginBottom: '16px', border: `1px solid ${statusCfg.border}` }}>
                  {isPending ? '⏳ Pending Review' : `${property.available} of ${property.total_rooms} rooms available`}
                </div>

                <div style={{ height: '1px', background: '#f0ede6', marginBottom: '16px' }} />

                {/* Redacted form fields */}
                <div style={{ marginBottom: '12px', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {isPending ? 'Form hidden until approved' : 'Inquiry Form'}
                </div>
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="redacted-field">
                    <div className="redacted-dot" />
                    <div className="redacted-line" style={{ width: `${[60, 80, 50, 70][i - 1]}%` }} />
                  </div>
                ))}
                <div className="redacted-btn">
                  <span>🔒</span>
                  <span>{isPending ? 'Unlocks when your listing goes live' : 'Inquiry form'}</span>
                </div>

                {isPending && (
                  <div style={{ marginTop: '16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '12px 14px', fontSize: '12px', color: '#92400e', lineHeight: 1.6 }}>
                    <strong>What happens when you get approved:</strong><br />
                    This form goes live, your images become visible, and interested students can submit inquiries directly — sent straight to your inbox.
                  </div>
                )}
              </div>
            </div>

            {/* HomeHive Promise */}
            <div style={{ background: '#1a1a1a', borderRadius: '14px', padding: '18px 20px', marginTop: '12px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: '#d4a843', marginBottom: '8px' }}>The HomeHive Promise</div>
              <p style={{ fontSize: '13px', color: '#c5c1b8', lineHeight: 1.65 }}>We match students with verified homes — your listing will reach hundreds of ASU students actively searching.</p>
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #333', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: '#d4a843', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0 }}>🏠</div>
                <div>
                  <div style={{ fontSize: '12px', color: '#fff', fontWeight: 500 }}>150+ Students Placed</div>
                  <div style={{ fontSize: '11px', color: '#6b6b6b' }}>Near ASU since 2022</div>
                </div>
              </div>
            </div>
          </div>

        </div>{/* /prop-split */}
      </div>

      {/* MOBILE STICKY PREVIEW BAR */}
      <div className="mobile-preview-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: '20px', color: '#fff', lineHeight: 1 }}>${(property.price || 0).toLocaleString()}<span style={{ fontSize: '12px', color: '#9b9b9b', fontFamily: 'DM Sans, sans-serif', fontWeight: 400 }}>/mo</span></div>
            <div style={{ fontSize: '11px', color: '#f59e0b', marginTop: '2px' }}>Preview Mode — {statusCfg.label}</div>
          </div>
          <a href={`/landlord/listings/${slug}`} style={{ background: '#f59e0b', color: '#1a1a1a', border: 'none', borderRadius: '10px', padding: '12px 18px', fontSize: '13px', fontWeight: 800, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", textDecoration: 'none', whiteSpace: 'nowrap' }}>
            ← Manage listing
          </a>
        </div>
      </div>
    </>
  )
}
