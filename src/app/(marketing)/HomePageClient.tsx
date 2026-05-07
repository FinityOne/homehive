'use client'

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { getProperties, type Property } from '@/lib/properties'

function fmtDate(d: string | null | undefined) {
  if (!d) return null
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── TYPE CONFIG ─────────────────────────────────────────────────────────────
const TYPE_CONFIG = {
  standard_rental: { label: 'For Rent',      bg: 'rgba(220,252,231,0.95)', color: '#166534', border: 'rgba(187,247,208,0.9)' },
  sublease:        { label: 'Sublease',       bg: 'rgba(253,242,245,0.95)', color: '#8C1D40', border: 'rgba(245,198,208,0.9)' },
  lease_transfer:  { label: 'Lease Transfer', bg: 'rgba(239,246,255,0.95)', color: '#1d4ed8', border: 'rgba(191,219,254,0.9)' },
} as const

// ─── CARD ─────────────────────────────────────────────────────────────────────
function HomeCard({ home, wide = false, featured = false }: { home: Property; wide?: boolean; featured?: boolean }) {
  const tc    = TYPE_CONFIG[home.listing_type] ?? TYPE_CONFIG.standard_rental
  const start = fmtDate(home.sublease_start_date)
  const end   = fmtDate(home.sublease_end_date)
  const isSub = home.listing_type === 'sublease' || home.listing_type === 'lease_transfer'

  return (
    <a href={`/homes/${home.slug}`} className={`hc-card${wide ? ' hc-card--wide' : ''}${featured ? ' hc-card--featured' : ''}`}>
      <div className="hc-img-wrap">
        {home.images?.[0]
          ? <img src={home.images[0]} alt={home.name} className="hc-img" loading="lazy" />
          : <div className="hc-img-placeholder" />
        }
        {/* gradient makes price legible on any photo */}
        <div className="hc-grad" />

        {/* type badge */}
        <div className="hc-type-badge" style={{ background: tc.bg, color: tc.color, border: `1px solid ${tc.border}` }}>
          {tc.label}
        </div>

        {/* price — on image */}
        <div className="hc-price">
          ${home.price.toLocaleString()}<span>/mo</span>
        </div>

        {/* clickability arrow — fades in on hover */}
        <div className="hc-arrow">↗</div>

        {home.available === 1 && <div className="hc-last-badge">Last room</div>}
      </div>

      <div className="hc-body">
        <div className="hc-name">{home.name}</div>
        <div className="hc-meta">
          <span className="hc-bed-pill">{home.beds} bed · {home.baths} bath</span>
          {isSub && start && end && (
            <span className="hc-date-pill">{start} – {end}</span>
          )}
        </div>
      </div>
    </a>
  )
}

// ─── FEATURED GRID ───────────────────────────────────────────────────────────
function FeaturedGrid({ homes }: { homes: Property[] }) {
  if (homes.length === 0) return null
  const n = Math.min(homes.length, 4) as 1 | 2 | 3 | 4
  return (
    <div className="fg-section">
      <div className="fg-hdr">
        <div>
          <div className="fg-eyebrow">Handpicked</div>
          <div className="fg-title">Featured Picks</div>
        </div>
        <a href="/homes" className="fg-view-all">Browse all →</a>
      </div>
      <div className={`fg-grid fg-grid--${n}`}>
        {homes.slice(0, n).map((h) => (
          <HomeCard key={h.slug} home={h} featured />
        ))}
      </div>
    </div>
  )
}

// ─── RESEARCH BADGE (slim pill) ──────────────────────────────────────────────
function ResearchBadge() {
  return (
    <a href="/blog/homehive-rated-number-one-asu-platform" className="rb-pill">
      <span className="rb-pill-tag">#1 Rated</span>
      <span className="rb-pill-text">HomeHive rated #1 off-campus housing platform for ASU students — Spring 2026</span>
      <span className="rb-pill-arrow">→</span>
    </a>
  )
}

// ─── LISTING ROW (horizontal scroll) ─────────────────────────────────────────
function ListingRow({ title, sub, homes, viewAllHref }: {
  title: string
  sub: string
  homes: Property[]
  viewAllHref: string
}) {
  if (homes.length === 0) return null
  return (
    <div className="lr-wrap">
      <div className="lr-hdr">
        <div>
          <div className="lr-title">{title}</div>
          <div className="lr-sub">{sub}</div>
        </div>
        <a href={viewAllHref} className="lr-view-all">View all →</a>
      </div>
      <div className="lr-scroll">
        {homes.map(h => <HomeCard key={h.slug} home={h} />)}
      </div>
    </div>
  )
}

// ─── SKELETON ─────────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <div style={{ marginBottom: '52px' }}>
      <div style={{ height: '22px', width: '200px', background: '#f0ede6', borderRadius: '6px', marginBottom: '8px' }} />
      <div style={{ height: '13px', width: '140px', background: '#f0ede6', borderRadius: '6px', marginBottom: '22px' }} />
      <div style={{ display: 'flex', gap: '16px', overflow: 'hidden' }}>
        {[1, 2, 3, 4].map(n => (
          <div key={n} style={{ flexShrink: 0, width: '260px', background: '#fff', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ height: '200px', background: 'linear-gradient(90deg,#f0ede6 25%,#f9f7f3 50%,#f0ede6 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
            <div style={{ padding: '13px 14px 15px' }}>
              <div style={{ height: '15px', background: '#f0ede6', borderRadius: '4px', marginBottom: '10px', width: '75%' }} />
              <div style={{ height: '24px', background: '#f4f1eb', borderRadius: '20px', width: '50%' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
function HomePageInner() {
  const searchParams    = useSearchParams()
  const guestName       = searchParams.get('name') || ''
  const isPersonalized  = !!guestName

  const [properties, setProperties]                   = useState<Property[]>([])
  const [loading, setLoading]                         = useState(true)
  const [showLandlordBanner, setShowLandlordBanner]   = useState(false)

  useEffect(() => {
    getProperties().then(data => { setProperties(data); setLoading(false) })
    if (!sessionStorage.getItem('hh_landlord_bar_dismissed')) setShowLandlordBanner(true)
  }, [])

  const featuredPicks = properties.filter(p => p.is_featured)
  const rentals       = properties.filter(p => !p.is_featured && p.listing_type === 'standard_rental').sort((a, b) => b.asu_score - a.asu_score).slice(0, 8)
  const subleases     = properties.filter(p => !p.is_featured && p.listing_type === 'sublease').sort((a, b) => a.price - b.price).slice(0, 8)
  const transfers     = properties.filter(p => !p.is_featured && p.listing_type === 'lease_transfer').sort((a, b) => a.price - b.price).slice(0, 8)

  // Fallback: no type separation yet → show top-scored in rent row
  const rentRow      = rentals.length    ? rentals    : properties.sort((a, b) => b.asu_score - a.asu_score).slice(0, 8)
  const subleaseRow  = subleases.length  ? subleases  : []
  const transferRow  = transfers.length  ? transfers  : []

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,600;1,300;1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        body { font-family: 'DM Sans', sans-serif; background: #faf9f6; color: #1a1a1a; }

        .wrap { max-width: 1400px; margin: 0 auto; padding: 0 20px; }

        /* ── BANNERS ── */
        .landlord-bar { background: #f0fdf4; border-bottom: 1px solid #bbf7d0; padding: 9px 24px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; color: #166534; position: relative; }
        .landlord-bar a { color: #166534; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }
        .landlord-bar a:hover { color: #065f46; }
        .landlord-bar-close { position: absolute; right: 16px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: #6b6b6b; font-size: 16px; padding: 4px; line-height: 1; }
        .personal-bar { background: #1a1a1a; padding: 9px 24px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; color: #c5c1b8; }
        .personal-bar strong { color: #FFC627; font-weight: 500; }
        .pbar-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; animation: pulse 2s infinite; flex-shrink: 0; }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.3} }

        /* ── HERO ── */
        .hero { padding: 28px 0 24px; display: flex; align-items: center; gap: 16px; border-bottom: 1px solid #e8e4db; margin-bottom: 28px; flex-wrap: wrap; }
        .hero-left { flex: 1; min-width: 200px; }
        .hero-title { font-family: 'Fraunces', serif; font-size: 34px; font-weight: 300; line-height: 1.1; color: #1a1a1a; letter-spacing: -1.2px; white-space: nowrap; }
        .hero-title em { font-style: italic; color: #8C1D40; }
        .hero-search { display: flex; align-items: center; gap: 0; flex: 1; max-width: 480px; border: 1.5px solid #1a1a1a; border-radius: 10px; overflow: hidden; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,0.07); }
        .hero-search input { flex: 1; border: none; outline: none; padding: 12px 16px; font-size: 14px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; background: transparent; }
        .hero-search input::placeholder { color: #b0a898; }
        .hero-search-btn { background: #8C1D40; color: #fff; border: none; padding: 12px 20px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; white-space: nowrap; transition: background 0.15s; }
        .hero-search-btn:hover { background: #6c0030; }

        /* ── RESEARCH PILL ── */
        .rb-pill { display: inline-flex; align-items: center; gap: 10px; background: #1a1a1a; border-radius: 8px; padding: 8px 14px; text-decoration: none; color: inherit; margin-bottom: 32px; transition: background 0.15s; max-width: 100%; overflow: hidden; }
        .rb-pill:hover { background: #2a2a2a; }
        .rb-pill-tag { flex-shrink: 0; background: #FFC627; color: #1a1a1a; font-size: 10px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; padding: 3px 8px; border-radius: 4px; }
        .rb-pill-text { font-size: 12px; color: rgba(255,255,255,0.65); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .rb-pill-arrow { flex-shrink: 0; font-size: 12px; color: rgba(255,255,255,0.4); font-weight: 500; }

        /* ── FEATURED GRID SECTION ── */
        .fg-section {
          margin-bottom: 52px;
          padding-top: 36px;
          border-top: 1px solid #e8e4db;
        }
        .fg-hdr { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 20px; gap: 12px; }
        .fg-eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; color: #8C1D40; margin-bottom: 5px; }
        .fg-title { font-family: 'Fraunces', serif; font-size: 22px; font-weight: 300; color: #1a1a1a; letter-spacing: -0.3px; }
        .fg-view-all { font-size: 13px; font-weight: 500; color: #9b9b9b; text-decoration: none; white-space: nowrap; flex-shrink: 0; transition: color 0.15s; padding-bottom: 3px; }
        .fg-view-all:hover { color: #1a1a1a; }

        /* Featured grid — count-aware layouts */
        .fg-grid { display: grid; gap: 14px; }
        .fg-grid .hc-card { width: 100%; flex-shrink: unset; }

        /* 1 card — full-width */
        .fg-grid--1 { grid-template-columns: 1fr; }
        .fg-grid--1 .hc-card .hc-img-wrap { height: 360px; }

        /* 2 cards — equal split */
        .fg-grid--2 { grid-template-columns: 1fr 1fr; }
        .fg-grid--2 .hc-card .hc-img-wrap { height: 280px; }

        /* 3 cards — tall hero left, 2 stacked right */
        .fg-grid--3 { grid-template-columns: 1.4fr 1fr; }
        .fg-grid--3 .hc-card:first-child { grid-row: span 2; align-self: stretch; height: 100%; display: flex; flex-direction: column; }
        .fg-grid--3 .hc-card:first-child .hc-img-wrap { flex: 1; height: auto; min-height: 260px; }
        .fg-grid--3 .hc-card:not(:first-child) .hc-img-wrap { height: 190px; }

        /* 4 cards — 2×2 */
        .fg-grid--4 { grid-template-columns: 1fr 1fr; }
        .fg-grid--4 .hc-card .hc-img-wrap { height: 240px; }

        /* Featured card — just a touch more shadow than regular */
        .hc-card--featured {
          box-shadow: 0 2px 12px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.06);
        }
        .hc-card--featured:hover {
          transform: translateY(-4px);
          box-shadow: 0 16px 40px rgba(0,0,0,0.13), 0 4px 12px rgba(0,0,0,0.07);
        }

        /* ── LISTING ROW ── */
        .lr-wrap { margin-bottom: 52px; }
        .lr-hdr { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 18px; gap: 12px; }
        .lr-title { font-family: 'Fraunces', serif; font-size: 22px; font-weight: 300; color: #1a1a1a; letter-spacing: -0.3px; margin-bottom: 3px; }
        .lr-sub { font-size: 12px; color: #9b9b9b; }
        .lr-view-all { font-size: 13px; font-weight: 600; color: #8C1D40; text-decoration: none; white-space: nowrap; flex-shrink: 0; }
        .lr-view-all:hover { color: #c9973a; }
        .lr-scroll { display: flex; gap: 14px; overflow-x: auto; padding-bottom: 10px; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
        .lr-scroll::-webkit-scrollbar { display: none; }

        /* ── CARD ── */
        .hc-card {
          flex-shrink: 0; width: 230px;
          background: #fff; border-radius: 14px; overflow: hidden;
          text-decoration: none; color: inherit;
          scroll-snap-align: start;
          cursor: pointer;
          transition: transform 0.22s cubic-bezier(0.25,0.46,0.45,0.94), box-shadow 0.22s;
          box-shadow: 0 1px 4px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04);
        }
        .hc-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 20px 48px rgba(0,0,0,0.13), 0 6px 16px rgba(0,0,0,0.07);
        }
        /* Wide card spans 2 cols in featured grid */
        .hc-card--wide { width: 100%; grid-column: span 2; }
        .hc-card--wide .hc-img-wrap { height: 300px; }

        /* ── IMAGE ── */
        .hc-img-wrap { position: relative; height: 172px; overflow: hidden; background: #f0ede6; }
        .hc-img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.5s cubic-bezier(0.25,0.46,0.45,0.94); }
        .hc-card:hover .hc-img { transform: scale(1.07); }
        .hc-img-placeholder { width: 100%; height: 100%; background: linear-gradient(135deg,#e8e4db 0%,#f5f2ec 50%,#e8e4db 100%); }

        /* Image overlays */
        .hc-grad { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.42) 0%, transparent 55%); pointer-events: none; }
        .hc-type-badge { position: absolute; top: 11px; left: 11px; font-size: 10px; font-weight: 700; padding: 4px 10px; border-radius: 20px; backdrop-filter: blur(8px); letter-spacing: 0.3px; text-transform: uppercase; }
        .hc-price { position: absolute; bottom: 11px; left: 13px; color: #fff; font-family: 'Fraunces', serif; font-size: 20px; font-weight: 600; letter-spacing: -0.3px; text-shadow: 0 1px 4px rgba(0,0,0,0.25); line-height: 1.2; }
        .hc-price span { font-family: 'DM Sans', sans-serif; font-size: 11px; font-weight: 400; opacity: 0.85; }
        .hc-arrow {
          position: absolute; bottom: 11px; right: 13px;
          width: 30px; height: 30px; border-radius: 50%;
          background: rgba(255,255,255,0.18); backdrop-filter: blur(6px);
          border: 1px solid rgba(255,255,255,0.35);
          color: #fff; font-size: 14px;
          display: flex; align-items: center; justify-content: center;
          opacity: 0; transform: scale(0.8);
          transition: opacity 0.2s, transform 0.2s;
        }
        .hc-card:hover .hc-arrow { opacity: 1; transform: scale(1); }
        .hc-last-badge { position: absolute; top: 11px; right: 11px; background: rgba(254,249,195,0.95); color: #854d0e; font-size: 10px; font-weight: 700; padding: 3px 9px; border-radius: 20px; border: 1px solid rgba(253,224,71,0.6); }

        /* Card body */
        .hc-body { padding: 13px 14px 15px; }
        .hc-name { font-family: 'Fraunces', serif; font-size: 15px; font-weight: 300; color: #1a1a1a; margin-bottom: 7px; letter-spacing: -0.1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .hc-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .hc-bed-pill { font-size: 12px; font-weight: 500; color: #4a4a4a; background: #f4f1eb; padding: 3px 9px; border-radius: 20px; }
        .hc-date-pill { font-size: 11px; font-weight: 600; color: #8C1D40; background: #fdf2f5; border: 1px solid #f5c6d0; padding: 3px 9px; border-radius: 20px; }

        /* ── LIST CTA ── */
        .list-cta { background: #1a1a1a; border-radius: 16px; padding: 44px 44px; display: flex; align-items: center; justify-content: space-between; gap: 28px; margin-bottom: 64px; flex-wrap: wrap; }
        .list-cta-eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: rgba(255,255,255,0.35); margin-bottom: 10px; }
        .list-cta-title { font-family: 'Fraunces', serif; font-size: 30px; font-weight: 300; color: #fff; letter-spacing: -0.5px; line-height: 1.15; }
        .list-cta-title em { font-style: italic; color: #FFC627; }
        .list-cta-sub { font-size: 13px; color: rgba(255,255,255,0.45); margin-top: 8px; }
        .list-cta-btn { background: #FFC627; color: #1a1a1a; font-size: 14px; font-weight: 700; padding: 15px 30px; border-radius: 10px; text-decoration: none; white-space: nowrap; font-family: 'DM Sans', sans-serif; transition: background 0.15s, transform 0.15s; flex-shrink: 0; }
        .list-cta-btn:hover { background: #e6b320; transform: translateY(-1px); }

        /* ── SHIMMER ── */
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

        /* ── RESPONSIVE ── */
        @media (max-width: 860px) {
          .fg-grid--3 { grid-template-columns: 1fr; }
          .fg-grid--3 .hc-card:first-child { grid-row: span 1; height: auto; flex-direction: column; }
          .fg-grid--3 .hc-card:first-child .hc-img-wrap { flex: unset; height: 200px; min-height: unset; }
          .fg-grid--3 .hc-card:not(:first-child) .hc-img-wrap { height: 200px; }
          .fg-grid--4 .hc-card .hc-img-wrap { height: 200px; }
          .hc-card { width: 210px; }
          .hc-img-wrap { height: 158px; }
          .hc-arrow { opacity: 1; transform: scale(1); }
        }
        @media (max-width: 640px) {
          .hero { flex-direction: column; align-items: flex-start; gap: 12px; padding: 20px 0 18px; }
          .hero-title { font-size: 26px; letter-spacing: -0.8px; white-space: normal; }
          .hero-search { max-width: 100%; width: 100%; }
          .fg-grid--2,
          .fg-grid--4 { grid-template-columns: 1fr; }
          .fg-grid--2 .hc-card .hc-img-wrap,
          .fg-grid--4 .hc-card .hc-img-wrap { height: 200px; }
          .fg-grid--1 .hc-card .hc-img-wrap { height: 240px; }
          .hc-card { width: 78vw; }
          .hc-img-wrap { height: 172px; }
          .lr-title { font-size: 19px; }
          .rb-pill-text { font-size: 11px; }
          .list-cta { padding: 28px 24px; }
          .list-cta-title { font-size: 24px; }
          .list-cta-btn { width: 100%; text-align: center; }
        }
      `}</style>

      {/* LANDLORD BANNER */}
      {showLandlordBanner && (
        <div className="landlord-bar">
          🏠 Listing your place? Skip Zillow — get student leads on HomeHive.{' '}
          <a href="/for-landlords">List for free →</a>
          <button
            className="landlord-bar-close"
            onClick={() => { sessionStorage.setItem('hh_landlord_bar_dismissed', '1'); setShowLandlordBanner(false) }}
            aria-label="Dismiss"
          >×</button>
        </div>
      )}

      {/* PERSONALIZED BAR */}
      {isPersonalized && (
        <div className="personal-bar">
          <span className="pbar-dot" />
          <span>Hey <strong>{guestName}</strong> — we picked these homes for you near ASU. Spots go fast.</span>
        </div>
      )}

      <div className="wrap">

        {/* HERO — horizontal bar */}
        <div className="hero">
          <div className="hero-left">
            <h1 className="hero-title">
              Off-campus housing for <em>Sun Devils.</em>
            </h1>
          </div>
          <div className="hero-search">
            <input
              type="text"
              placeholder="Search by name or area…"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const q = (e.target as HTMLInputElement).value.trim()
                  window.location.href = q ? `/homes?q=${encodeURIComponent(q)}` : '/homes'
                }
              }}
            />
            <button
              className="hero-search-btn"
              onClick={e => {
                const input = (e.currentTarget.previousSibling as HTMLInputElement)
                const q = input?.value?.trim()
                window.location.href = q ? `/homes?q=${encodeURIComponent(q)}` : '/homes'
              }}
            >
              Find homes
            </button>
          </div>
        </div>

        {/* RESEARCH PILL */}
        <ResearchBadge />

        {/* LISTINGS */}
        {loading ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : properties.length === 0 ? (
          <>
            <div style={{ textAlign: 'center', padding: '80px 20px', marginBottom: '48px' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>🏠</div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: '22px', fontWeight: 300, color: '#1a1a1a', marginBottom: '8px' }}>No listings right now</div>
              <div style={{ fontSize: '14px', color: '#9b9b9b' }}>Check back soon — new homes are added regularly.</div>
            </div>
            <div className="list-cta">
              <div>
                <div className="list-cta-eyebrow">For landlords &amp; students subleasing</div>
                <div className="list-cta-title">Have a place to rent?<br /><em>List it free.</em></div>
                <div className="list-cta-sub">No fees. Student leads straight to your inbox.</div>
              </div>
              <a href="/landlord/signup" className="list-cta-btn">List your place →</a>
            </div>
          </>
        ) : (
          <>
            {/* Featured grid */}
            {featuredPicks.length > 0 && <FeaturedGrid homes={featuredPicks} />}

            {/* For Rent */}
            <ListingRow
              title="For Rent"
              sub={`${rentRow.length} home${rentRow.length !== 1 ? 's' : ''} ready to move in`}
              homes={rentRow}
              viewAllHref="/homes"
            />

            {/* Subleases */}
            {subleaseRow.length > 0 && (
              <ListingRow
                title="Subleases"
                sub="Take over a lease — flexible dates, often below market"
                homes={subleaseRow}
                viewAllHref="/homes"
              />
            )}

            {/* Lease Transfers */}
            {transferRow.length > 0 && (
              <ListingRow
                title="Lease Transfers"
                sub="Assume a full lease from a departing tenant"
                homes={transferRow}
                viewAllHref="/homes"
              />
            )}

            {/* LIST YOUR PLACE CTA */}
            <div className="list-cta">
              <div>
                <div className="list-cta-eyebrow">For landlords &amp; students subleasing</div>
                <div className="list-cta-title">Have a place to rent?<br /><em>List it free.</em></div>
                <div className="list-cta-sub">No fees. Student leads straight to your inbox.</div>
              </div>
              <a href="/landlord/signup" className="list-cta-btn">List your place →</a>
            </div>
          </>
        )}

      </div>

    </>
  )
}

export default function HomePageClient() {
  return (
    <Suspense fallback={null}>
      <HomePageInner />
    </Suspense>
  )
}
