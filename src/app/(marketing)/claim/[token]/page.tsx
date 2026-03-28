'use client'

import { useEffect, use, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { getPropertyByClaimToken } from '@/lib/properties'
import type { Property } from '@/lib/properties'
import type { User } from '@supabase/supabase-js'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const TAG_ICONS: Record<string, string> = {
  wifi: '⚡', internet: '⚡', washer: '🧺', laundry: '🧺',
  ac: '❄️', heat: '❄️', parking: '🚗', garage: '🚗',
  pet: '🐾', pets: '🐾', furnished: '🛋️', pool: '🏊',
  gym: '💪', yard: '🌿', balcony: '🏠', dishwasher: '🍽️',
}
function tagIcon(tag: string): string {
  const lower = tag.toLowerCase()
  for (const [key, icon] of Object.entries(TAG_ICONS)) {
    if (lower.includes(key)) return icon
  }
  return '✓'
}

export default function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)

  const [property, setProperty] = useState<Property | null | undefined>(undefined)
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [activePhoto, setActivePhoto] = useState(0)
  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState('')
  const [claimed, setClaimed] = useState(false)

  useEffect(() => {
    getPropertyByClaimToken(token).then(p => setProperty(p ?? null))
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null))
  }, [token])

  const handleClaim = async () => {
    setClaiming(true)
    setClaimError('')
    try {
      const res = await fetch(`/api/claim/${token}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setClaimError(data.error || 'Something went wrong. Please try again.')
        setClaiming(false)
        return
      }
      setClaimed(true)
      setTimeout(() => { window.location.href = `/landlord/listings/${data.slug}` }, 1800)
    } catch {
      setClaimError('Network error. Please try again.')
      setClaiming(false)
    }
  }

  // ── Loading ──
  if (property === undefined || user === undefined) {
    return (
      <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif", color: '#9b9b9b', fontSize: '14px' }}>
        Loading…
      </div>
    )
  }

  // ── Token spent or not found ──
  if (property === null || !property.is_claimable) {
    return (
      <>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@400;500;600&display=swap');`}</style>
        <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: "'DM Sans', sans-serif" }}>
          <div style={{ maxWidth: '400px', textAlign: 'center' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#f3f4f6', border: '1.5px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', margin: '0 auto 20px' }}>🔒</div>
            <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '26px', color: '#1a1a1a', marginBottom: '10px', lineHeight: 1.2 }}>
              This listing has been claimed
            </h1>
            <p style={{ fontSize: '14px', color: '#6b6b6b', lineHeight: 1.7, marginBottom: '24px' }}>
              This link is no longer active.
            </p>
            <a href="/" style={{ display: 'inline-block', background: '#1a1a1a', color: '#fff', borderRadius: '9px', padding: '12px 24px', fontSize: '14px', fontWeight: 600, textDecoration: 'none' }}>
              Browse all listings →
            </a>
          </div>
        </div>
      </>
    )
  }

  const allImages = (property.images ?? []).filter(Boolean)
  const mainImage = allImages[activePhoto] ?? ''
  const tags = property.tags ?? []
  const nearby = property.nearby ?? []
  const asuReasons = property.asu_reasons ?? []

  const listingTypeCfg = property.listing_type === 'sublease'
    ? { label: 'Sublease', color: '#6d28d9', bg: '#f5f3ff', border: '#ddd6fe' }
    : property.listing_type === 'lease_transfer'
      ? { label: 'Lease Transfer', color: '#0f766e', bg: '#f0fdfa', border: '#99f6e4' }
      : { label: 'Whole Home', color: '#1e40af', bg: '#eff6ff', border: '#bfdbfe' }

  const depositDisplay = property.security_deposit === 0
    ? '$0 — No deposit required'
    : property.security_deposit != null
      ? `$${property.security_deposit.toLocaleString()} (refundable)`
      : `$${property.price.toLocaleString()} (refundable)`
  const depositIsZero = property.security_deposit === 0
  const totalMoveIn = property.security_deposit === 0
    ? property.price
    : property.price + (property.security_deposit ?? property.price)

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; background: #f5f4f0; color: #1a1a1a; }

        .claim-notice {
          background: linear-gradient(90deg, #1a1a1a 0%, #2d2410 100%);
          border-bottom: 2px solid #FFC627;
          padding: 11px 20px;
        }
        .claim-notice-inner { max-width: 1200px; margin: 0 auto; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .claim-notice-badge { background: #FFC627; color: #1a1a1a; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; border-radius: 20px; padding: 3px 10px; white-space: nowrap; flex-shrink: 0; }
        .claim-notice-text { font-size: 13px; color: #fef3c7; flex: 1; min-width: 180px; }

        .prop-page  { max-width: 1200px; margin: 0 auto; padding: 28px 24px 120px; }
        .prop-split { display: grid; grid-template-columns: 1fr 360px; gap: 32px; align-items: start; margin-top: 24px; }
        .prop-left  { min-width: 0; }
        .prop-right { position: sticky; top: 88px; }

        /* Gallery */
        .gallery-hero { position: relative; border-radius: 16px; overflow: hidden; height: 440px; cursor: pointer; background: #e8e4db; margin-bottom: 8px; }
        .gallery-hero img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.5s ease; }
        .gallery-hero:hover img { transform: scale(1.015); }
        .gallery-hero-overlay { position: absolute; inset: 0; background: linear-gradient(to bottom, transparent 60%, rgba(0,0,0,0.3)); pointer-events: none; }
        .gallery-count { position: absolute; bottom: 14px; right: 14px; background: rgba(0,0,0,0.6); color: #fff; font-size: 12px; font-weight: 600; padding: 5px 12px; border-radius: 20px; backdrop-filter: blur(4px); border: 1px solid rgba(255,255,255,0.2); }
        .gallery-strip { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
        .gallery-strip::-webkit-scrollbar { height: 3px; }
        .gallery-strip::-webkit-scrollbar-thumb { background: #d4c9b0; border-radius: 10px; }
        .gallery-thumb { flex-shrink: 0; width: 90px; height: 66px; border-radius: 8px; overflow: hidden; cursor: pointer; border: 2px solid transparent; transition: border-color 0.15s; opacity: 0.7; }
        .gallery-thumb.active { border-color: #8C1D40; opacity: 1; }
        .gallery-thumb:hover { opacity: 1; }
        .gallery-thumb img { width: 100%; height: 100%; object-fit: cover; }

        /* Content */
        .section { background: #fff; border-radius: 14px; padding: 24px; margin-top: 16px; border: 1px solid #e8e5de; }
        .section-label { font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: #d4a843; margin-bottom: 14px; }
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
        .nearby-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .nearby-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #faf9f6; border-radius: 8px; border: 1px solid #e8e5de; }
        .nearby-place { font-size: 13px; color: #3a3a3a; }
        .nearby-time { font-size: 12px; color: #d4a843; font-weight: 500; }

        /* Claim card */
        .claim-card { background: #fff; border-radius: 16px; padding: 22px; border: 1px solid #e8e5de; box-shadow: 0 4px 24px rgba(0,0,0,0.06); }
        .redacted-field { height: 44px; border-radius: 9px; background: #f8f8f8; border: 1.5px dashed #e2e8f0; margin-bottom: 8px; display: flex; align-items: center; padding: 0 14px; gap: 8px; filter: blur(2px); pointer-events: none; user-select: none; }
        .redacted-dot { width: 8px; height: 8px; border-radius: 50%; background: #cbd5e1; flex-shrink: 0; }
        .redacted-line { height: 10px; border-radius: 4px; background: #e2e8f0; flex: 1; }
        .claim-btn { width: 100%; padding: 15px; border: none; border-radius: 9px; background: #FFC627; color: #1a1a1a; font-size: 15px; font-weight: 800; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.2s, transform 0.1s; letter-spacing: 0.1px; display: block; text-align: center; text-decoration: none; }
        .claim-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
        .claim-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .auth-btn { width: 100%; padding: 13px; border: 1.5px solid #e8e5de; border-radius: 9px; background: #fff; color: #1a1a1a; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; display: flex; align-items: center; justify-content: center; transition: border-color 0.15s; }
        .auth-btn:hover { border-color: #1a1a1a; }
        .error-msg { background: #fdf2f5; border: 1px solid #f5c6d0; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #8C1D40; margin-bottom: 12px; line-height: 1.5; }

        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes goldPulse { 0%,100%{box-shadow:0 4px 20px rgba(255,198,39,0.4)} 50%{box-shadow:0 4px 32px rgba(255,198,39,0.7)} }

        @media (max-width: 860px) {
          .prop-split { grid-template-columns: 1fr; }
          .prop-right { display: none; }
          .gallery-hero { height: 300px; }
          .nearby-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 500px) {
          .prop-page { padding: 16px 16px 100px; }
          .gallery-hero { height: 240px; border-radius: 12px; }
        }
      `}</style>

      {/* ── Claim notice banner ── */}
      <div className="claim-notice">
        <div className="claim-notice-inner">
          <span className="claim-notice-badge">Claim this listing</span>
          <span className="claim-notice-text">This listing was created for you. Sign in or create an account to manage it.</span>
        </div>
      </div>

      <div className="prop-page">

        {/* BREADCRUMB */}
        <div style={{ fontSize: '12px', color: '#9b9b9b', marginBottom: '16px' }}>
          <a href="/" style={{ color: '#9b9b9b', textDecoration: 'none' }}>HomeHive</a> › <a href="/homes" style={{ color: '#9b9b9b', textDecoration: 'none' }}>Homes</a> › <strong>{property.name}</strong>
        </div>

        {/* TITLE ROW */}
        <div>
          <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 'clamp(26px,4vw,38px)', color: '#1a1a1a', lineHeight: 1.15, marginBottom: '8px' }}>{property.name}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14px', color: '#6b6b6b' }}>📍 {property.address}</span>
            <span style={{ fontSize: '11px', fontWeight: 600, padding: '4px 10px', borderRadius: '6px', background: listingTypeCfg.bg, color: listingTypeCfg.color, border: `1px solid ${listingTypeCfg.border}`, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: listingTypeCfg.color, display: 'inline-block', flexShrink: 0 }} />
              {listingTypeCfg.label}
            </span>
          </div>
        </div>

        {/* SPLIT */}
        <div className="prop-split">

          {/* LEFT */}
          <div className="prop-left">

            {/* GALLERY — full clear photos */}
            <div style={{ marginTop: '20px' }}>
              <div className="gallery-hero">
                {mainImage
                  ? <img src={mainImage} alt={property.name} />
                  : <div style={{ width: '100%', height: '100%', background: '#e8e4db', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9b9b9b', fontSize: '14px' }}>No photos yet</div>
                }
                <div className="gallery-hero-overlay" />
                {allImages.length > 1 && (
                  <div className="gallery-count">🖼 {allImages.length} photos</div>
                )}
              </div>
              {allImages.length > 1 && (
                <div className="gallery-strip">
                  {allImages.map((img, i) => (
                    <div key={i} className={`gallery-thumb${activePhoto === i ? ' active' : ''}`} onClick={() => setActivePhoto(i)}>
                      <img src={img} alt={`Photo ${i + 1}`} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* STATS */}
            <div className="section">
              <div className="section-label">Property Overview</div>
              <div className="stats-row">
                {([
                  [String(property.beds), 'Beds'],
                  [String(property.baths), 'Baths'],
                  ...(property.sqft?.trim() ? [[property.sqft, 'Sq Ft']] : []),
                  [`${property.asu_distance ?? '?'} mi`, 'To ASU'],
                ] as [string, string][]).map(([n, l]) => (
                  <div className="stat-item" key={l}>
                    <div className="stat-num">{n}</div>
                    <div className="stat-lbl">{l}</div>
                  </div>
                ))}
              </div>
              {tags.length > 0 && (
                <div className="tags-wrap">
                  {tags.map(tag => (
                    <div key={tag} className="tag-pill">
                      <span>{tagIcon(tag)}</span>
                      <span>{tag}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* SUBLEASE / LEASE TRANSFER DATES */}
            {(property.listing_type === 'sublease' || property.listing_type === 'lease_transfer') &&
              (property.sublease_start_date || property.sublease_end_date) && (
              <div className="section" style={{ background: listingTypeCfg.bg, border: `1px solid ${listingTypeCfg.border}` }}>
                <div className="section-label" style={{ color: listingTypeCfg.color }}>
                  {property.listing_type === 'lease_transfer' ? 'Lease Transfer Period' : 'Sublease Period'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {property.sublease_start_date && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: listingTypeCfg.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Available From</span>
                      <span style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', fontFamily: "'DM Serif Display', serif" }}>
                        {new Date(property.sublease_start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                  )}
                  {property.sublease_start_date && property.sublease_end_date && (
                    <span style={{ fontSize: '20px', color: listingTypeCfg.color, fontWeight: 300, margin: '0 4px' }}>→</span>
                  )}
                  {property.sublease_end_date && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: listingTypeCfg.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {property.listing_type === 'lease_transfer' ? 'Lease Ends' : 'Sublease Ends'}
                      </span>
                      <span style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', fontFamily: "'DM Serif Display', serif" }}>
                        {new Date(property.sublease_end_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* DESCRIPTION */}
            {property.description && (
              <div className="section">
                <div className="section-label">About this home</div>
                <p style={{ fontSize: '14px', color: '#3a3a3a', lineHeight: 1.75 }}>{property.description}</p>
              </div>
            )}

            {/* ASU HIGHLIGHTS */}
            {asuReasons.length > 0 && (
              <div className="section">
                <div className="section-label">Why ASU students love it</div>
                <div className="pain-list">
                  {asuReasons.map((text, i) => (
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
                ['Monthly rent (per room)', `$${property.price.toLocaleString()}`, false],
                ['Move-in fee', '$0', true],
                ['Broker / agency fee', '$0', true],
                ['Security deposit', depositDisplay, depositIsZero],
              ].map(([l, v, g]) => (
                <div className="pricing-row" key={String(l)}>
                  <span className="pricing-label">{l}</span>
                  <span className={`pricing-val${g ? ' green' : ''}`}>{v}</span>
                </div>
              ))}
              <div className="pricing-total">
                <span>Total to move in</span>
                <span>${totalMoveIn.toLocaleString()}</span>
              </div>
            </div>

            {/* LOCATION */}
            {nearby.length > 0 && (
              <div className="section">
                <div className="section-label">Getting around</div>
                <div className="nearby-grid">
                  {nearby.map(n => (
                    <div className="nearby-item" key={n.place}>
                      <span className="nearby-place">{n.place}</span>
                      <span className="nearby-time">{n.travel_time}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>{/* /prop-left */}

          {/* RIGHT — Claim card */}
          <div className="prop-right">
            <div className="claim-card">
              {/* Price */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '2px' }}>
                  <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: '30px', color: '#1a1a1a', letterSpacing: '-0.5px' }}>${property.price.toLocaleString()}</span>
                  <span style={{ fontSize: '13px', color: '#9b9b9b' }}>/mo</span>
                </div>
                <div style={{ fontSize: '12px', color: '#9b9b9b' }}>
                  {property.available > 0 ? `${property.available} of ${property.total_rooms} rooms available` : 'Contact for availability'}
                </div>
              </div>

              <div style={{ height: '1px', background: '#f0ede6', margin: '14px 0' }} />

              {claimed ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ fontSize: '36px', marginBottom: '10px' }}>🎉</div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#16a34a', marginBottom: '6px' }}>Listing claimed!</div>
                  <div style={{ fontSize: '13px', color: '#6b6b6b' }}>Redirecting to your dashboard…</div>
                </div>
              ) : (
                <>
                  {/* Blurred form preview */}
                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px' }}>Inquiry form</div>
                    {[70, 55, 80, 45].map((w, i) => (
                      <div key={i} className="redacted-field">
                        <div className="redacted-dot" />
                        <div className="redacted-line" style={{ width: `${w}%` }} />
                      </div>
                    ))}
                  </div>

                  <div style={{ height: '1px', background: '#f0ede6', marginBottom: '14px' }} />

                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a', marginBottom: '5px' }}>
                    {user ? 'This listing is ready for you' : 'Claim this listing'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b6b6b', lineHeight: 1.6, marginBottom: '14px' }}>
                    {user
                      ? 'Claim it to start receiving student inquiries and manage it from your dashboard.'
                      : 'Create a free account or sign in — this listing will be added automatically.'
                    }
                  </div>

                  {claimError && <div className="error-msg">{claimError}</div>}

                  {user ? (
                    <button
                      className="claim-btn"
                      onClick={handleClaim}
                      disabled={claiming}
                      style={{ animation: !claiming ? 'goldPulse 2.8s ease-in-out infinite' : 'none', boxShadow: '0 4px 20px rgba(255,198,39,0.4)' }}
                    >
                      {claiming ? 'Claiming…' : 'Claim this listing →'}
                    </button>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <a
                        href={`/signup?next=/claim/${token}&role=landlord`}
                        className="claim-btn"
                        style={{ animation: 'goldPulse 2.8s ease-in-out infinite', boxShadow: '0 4px 20px rgba(255,198,39,0.4)' }}
                      >
                        Create free account →
                      </a>
                      <a href={`/login?next=/claim/${token}`} className="auth-btn">
                        Sign in
                      </a>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Mobile sticky CTA */}
      <div style={{ display: 'none', position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: '#fff', borderTop: '1px solid #e8e5de', padding: '12px 20px 20px', boxShadow: '0 -8px 32px rgba(0,0,0,0.1)' }}
        className="mobile-claim-bar">
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: '20px', color: '#1a1a1a' }}>${property.price.toLocaleString()}<span style={{ fontSize: '12px', color: '#9b9b9b', fontFamily: 'DM Sans, sans-serif', fontWeight: 400 }}>/mo</span></div>
          </div>
          {user
            ? <button onClick={handleClaim} disabled={claiming} style={{ flex: 1, background: '#FFC627', color: '#1a1a1a', border: 'none', borderRadius: '9px', padding: '13px', fontSize: '14px', fontWeight: 800, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                {claiming ? 'Claiming…' : 'Claim →'}
              </button>
            : <a href={`/signup?next=/claim/${token}&role=landlord`} style={{ flex: 1, background: '#FFC627', color: '#1a1a1a', borderRadius: '9px', padding: '13px', fontSize: '14px', fontWeight: 800, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif" }}>
                Claim →
              </a>
          }
        </div>
      </div>
      <style>{`@media (max-width: 860px) { .mobile-claim-bar { display: block !important; } }`}</style>
    </>
  )
}
