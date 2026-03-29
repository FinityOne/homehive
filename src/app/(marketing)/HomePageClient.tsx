'use client'

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Loader from '@/components/Loader'
import { getProperties, type Property } from '@/lib/properties'

function fmtDate(d: string | null | undefined) {
  if (!d) return null
  const dt = new Date(d)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/* ── Compact Airbnb-style card ─────────────────────────────────────── */
function HomeCard({ home, showDates }: { home: Property; showDates?: boolean }) {
  const startDate = fmtDate(home.sublease_start_date)
  const endDate   = fmtDate(home.sublease_end_date)
  return (
    <a href={`/homes/${home.slug}`} className="hc-card">
      <div className="hc-img-wrap">
        {home.images?.[0]
          ? <img src={home.images[0]} alt={home.name} className="hc-img" />
          : <div className="hc-img-placeholder" />
        }
        <div className="hc-price">${home.price}<span>/mo</span></div>
        {home.available === 1 && <div className="hc-badge-last">Last room</div>}
      </div>
      <div className="hc-body">
        <div className="hc-name">{home.name}</div>
        <div className="hc-meta">
          <span>📍 {home.asu_distance} mi to ASU</span>
          <span className="hc-sep" />
          <span>{home.beds}bd · {home.baths}ba</span>
        </div>
        {showDates && startDate && endDate && (
          <div className="hc-dates">{startDate} → {endDate}</div>
        )}
        <div className="hc-cta">Explore →</div>
      </div>
    </a>
  )
}

/* ── Listing row (horizontal scroll) ─────────────────────────────── */
function ListingRow({ title, sub, homes, showDates, viewAllHref }: {
  title: string
  sub: string
  homes: Property[]
  showDates?: boolean
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
        {homes.map(h => <HomeCard key={h.slug} home={h} showDates={showDates} />)}
      </div>
    </div>
  )
}

/* ── Blog validation banner ───────────────────────────────────────── */
function ResearchBadge() {
  return (
    <a href="/blog/homehive-rated-number-one-asu-platform" className="rb-wrap">
      <div className="rb-left">
        <div className="rb-eyebrow">Research Report · Spring 2026</div>
        <div className="rb-stat">#1</div>
        <div className="rb-stat-label">Rated platform for ASU off-campus housing</div>
      </div>
      <div className="rb-right">
        <div className="rb-badge">Research Report</div>
        <div className="rb-headline">HomeHive Rated #1 Off-Campus Housing Platform for ASU Students</div>
        <div className="rb-excerpt">An independent survey of 847 ASU students found HomeHive outperforming all platforms on lease speed, listing quality, and student satisfaction.</div>
        <div className="rb-metrics">
          <div className="rb-metric"><span>847</span> students surveyed</div>
          <div className="rb-metric-sep" />
          <div className="rb-metric"><span>4</span> ASU campuses</div>
          <div className="rb-metric-sep" />
          <div className="rb-metric"><span>6</span> platforms compared</div>
        </div>
        <div className="rb-read">Read the full report →</div>
      </div>
    </a>
  )
}

/* ── Skeleton loader ──────────────────────────────────────────────── */
function SkeletonRow() {
  return (
    <div style={{ marginBottom: '48px' }}>
      <div style={{ height: '20px', width: '180px', background: '#f0ede6', borderRadius: '6px', marginBottom: '6px' }} />
      <div style={{ height: '14px', width: '120px', background: '#f0ede6', borderRadius: '6px', marginBottom: '20px' }} />
      <div style={{ display: 'flex', gap: '16px', overflow: 'hidden' }}>
        {[1, 2, 3, 4].map(n => (
          <div key={n} style={{ flexShrink: 0, width: '220px', background: '#fff', border: '1px solid #e8e4db', borderRadius: '14px', overflow: 'hidden' }}>
            <div style={{ height: '150px', background: 'linear-gradient(90deg,#f0ede6 25%,#f9f7f3 50%,#f0ede6 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
            <div style={{ padding: '12px 14px' }}>
              <div style={{ height: '14px', background: '#f0ede6', borderRadius: '4px', marginBottom: '8px', width: '80%' }} />
              <div style={{ height: '11px', background: '#f0ede6', borderRadius: '4px', width: '55%' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Main component ───────────────────────────────────────────────── */
function HomePageInner() {
  const searchParams  = useSearchParams()
  const guestName     = searchParams.get('name') || ''
  const isPersonalized = !!guestName

  const [showLoader, setShowLoader]           = useState(false)
  const [properties, setProperties]           = useState<Property[]>([])
  const [loading, setLoading]                 = useState(true)
  const [showLandlordBanner, setShowLandlordBanner] = useState(false)

  useEffect(() => {
    getProperties().then(data => { setProperties(data); setLoading(false) })
    if (!localStorage.getItem('hh_loader_seen')) setShowLoader(true)
    if (!sessionStorage.getItem('hh_landlord_bar_dismissed')) setShowLandlordBanner(true)
  }, [])

  const handleLoaderComplete = () => {
    localStorage.setItem('hh_loader_seen', '1')
    setShowLoader(false)
  }

  const featured  = properties
    .filter(p => p.listing_type === 'standard_rental')
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  const subleases = properties
    .filter(p => p.listing_type === 'sublease' || p.listing_type === 'lease_transfer')
    .sort((a, b) => a.price - b.price)
    .slice(0, 5)

  // Fallback: if no type separation, just show top 5 in featured row
  const fallbackAll = properties.sort((a, b) => b.score - a.score).slice(0, 5)
  const featuredRow  = featured.length  ? featured  : fallbackAll
  const subleasesRow = subleases.length ? subleases : []

  return (
    <>
      {showLoader && <Loader onComplete={handleLoaderComplete} />}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,400;1,300;1,400;1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        body { font-family: 'DM Sans', sans-serif; background: #faf9f6; color: #1a1a1a; }

        .wrap { max-width: 1100px; margin: 0 auto; padding: 0 24px; }

        /* ── BANNERS ─────────────────────────────────────────────── */
        .landlord-bar { background: #f0fdf4; border-bottom: 1px solid #bbf7d0; padding: 9px 24px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; color: #166534; position: relative; }
        .landlord-bar a { color: #166534; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }
        .landlord-bar a:hover { color: #065f46; }
        .landlord-bar-close { position: absolute; right: 16px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: #6b6b6b; font-size: 16px; padding: 4px; line-height: 1; }
        .landlord-bar-close:hover { color: #1a1a1a; }
        .personal-bar { background: #1a1a1a; padding: 9px 24px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; color: #c5c1b8; }
        .personal-bar strong { color: #FFC627; font-weight: 500; }
        .pbar-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; animation: pulse 2s infinite; flex-shrink: 0; }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.3} }

        /* ── HERO ────────────────────────────────────────────────── */
        .hero { padding: 40px 0 28px; text-align: center; border-bottom: 1px solid #e8e4db; margin-bottom: 36px; }
        .hero-eyebrow { display: inline-flex; align-items: center; gap: 7px; background: #f0e6cc; color: #92620a; font-size: 11px; font-weight: 600; letter-spacing: 0.8px; text-transform: uppercase; padding: 5px 12px; border-radius: 20px; margin-bottom: 18px; }
        .hero-eyebrow-dot { width: 5px; height: 5px; border-radius: 50%; background: #c9973a; }
        .hero-title { font-family: 'Fraunces', serif; font-size: 48px; font-weight: 300; line-height: 1.06; color: #1a1a1a; letter-spacing: -2px; margin-bottom: 12px; }
        .hero-title em { font-style: italic; color: #8C1D40; }
        .hero-trust { display: flex; align-items: center; justify-content: center; gap: 18px; margin-top: 14px; flex-wrap: wrap; }
        .hero-trust-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #9b9b9b; }
        .trust-dot { width: 4px; height: 4px; border-radius: 50%; background: #FFC627; }

        /* ── RESEARCH BADGE ──────────────────────────────────────── */
        .rb-wrap { display: grid; grid-template-columns: 200px 1fr; background: #0f2035; border-radius: 16px; overflow: hidden; text-decoration: none; color: inherit; margin-bottom: 44px; transition: box-shadow 0.2s; }
        .rb-wrap:hover { box-shadow: 0 16px 48px rgba(15,32,53,0.35); }
        .rb-left { background: linear-gradient(160deg,#0a1828 0%,#1a3a5c 60%,#1e4976 100%); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 28px 20px; gap: 4px; }
        .rb-eyebrow { font-size: 9px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: rgba(255,255,255,0.4); text-align: center; font-family: 'DM Sans', sans-serif; }
        .rb-stat { font-family: 'Fraunces', serif; font-size: 56px; font-weight: 600; font-style: italic; color: #FFC627; letter-spacing: -2px; line-height: 1; }
        .rb-stat-label { font-size: 10px; color: rgba(255,255,255,0.5); text-align: center; font-family: 'DM Sans', sans-serif; line-height: 1.4; max-width: 100px; }
        .rb-right { padding: 28px 32px; display: flex; flex-direction: column; justify-content: center; }
        .rb-badge { display: inline-block; background: rgba(255,198,39,0.12); border: 1px solid rgba(255,198,39,0.3); color: #FFC627; font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; padding: 3px 10px; border-radius: 4px; margin-bottom: 12px; font-family: 'DM Sans', sans-serif; width: fit-content; }
        .rb-headline { font-family: 'Fraunces', serif; font-size: 18px; font-weight: 600; color: #fff; line-height: 1.3; margin-bottom: 8px; letter-spacing: -0.2px; }
        .rb-excerpt { font-size: 12px; color: rgba(255,255,255,0.55); line-height: 1.65; margin-bottom: 16px; }
        .rb-metrics { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
        .rb-metric { font-size: 11px; color: rgba(255,255,255,0.5); font-family: 'DM Sans', sans-serif; }
        .rb-metric span { color: #FFC627; font-weight: 700; }
        .rb-metric-sep { width: 3px; height: 3px; border-radius: 50%; background: rgba(255,255,255,0.2); }
        .rb-read { font-size: 13px; font-weight: 600; color: #FFC627; display: flex; align-items: center; gap: 5px; }

        /* ── LISTING ROW ─────────────────────────────────────────── */
        .lr-wrap { margin-bottom: 44px; }
        .lr-hdr { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 16px; gap: 12px; }
        .lr-title { font-family: 'Fraunces', serif; font-size: 22px; font-weight: 300; color: #1a1a1a; letter-spacing: -0.3px; margin-bottom: 2px; }
        .lr-sub { font-size: 12px; color: #9b9b9b; }
        .lr-view-all { font-size: 13px; font-weight: 600; color: #8C1D40; text-decoration: none; white-space: nowrap; flex-shrink: 0; }
        .lr-view-all:hover { color: #c9973a; }
        .lr-scroll { display: flex; gap: 14px; overflow-x: auto; padding-bottom: 8px; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
        .lr-scroll::-webkit-scrollbar { display: none; }

        /* ── HOME CARD ───────────────────────────────────────────── */
        .hc-card { flex-shrink: 0; width: 220px; background: #fff; border: 1px solid #e8e4db; border-radius: 14px; overflow: hidden; text-decoration: none; color: inherit; display: flex; flex-direction: column; scroll-snap-align: start; transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s; }
        .hc-card:hover { transform: translateY(-4px); box-shadow: 0 12px 36px rgba(0,0,0,0.1); border-color: #d4c9b0; }
        .hc-img-wrap { position: relative; height: 152px; overflow: hidden; background: #f0ede6; }
        .hc-img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.4s; display: block; }
        .hc-card:hover .hc-img { transform: scale(1.06); }
        .hc-img-placeholder { width: 100%; height: 100%; background: linear-gradient(135deg,#e8e4db,#f0ede6); }
        .hc-price { position: absolute; bottom: 9px; right: 9px; background: rgba(26,26,26,0.9); color: #fff; font-family: 'Fraunces', serif; font-size: 17px; font-weight: 300; padding: 4px 10px; border-radius: 7px; backdrop-filter: blur(6px); letter-spacing: -0.2px; line-height: 1.3; }
        .hc-price span { font-family: 'DM Sans', sans-serif; font-size: 10px; opacity: 0.65; font-weight: 400; }
        .hc-badge-last { position: absolute; top: 9px; left: 9px; background: rgba(254,249,195,0.95); color: #854d0e; font-size: 10px; font-weight: 700; padding: 3px 9px; border-radius: 20px; border: 1px solid rgba(253,224,71,0.6); }
        .hc-body { padding: 12px 13px 14px; flex: 1; display: flex; flex-direction: column; }
        .hc-name { font-family: 'Fraunces', serif; font-size: 14px; font-weight: 300; color: #1a1a1a; margin-bottom: 5px; letter-spacing: -0.1px; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .hc-meta { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #6b6b6b; margin-bottom: 4px; }
        .hc-sep { width: 3px; height: 3px; border-radius: 50%; background: #d4c9b0; flex-shrink: 0; }
        .hc-dates { font-size: 11px; color: #8C1D40; font-weight: 600; margin-bottom: 4px; background: #fdf2f5; border: 1px solid #f5c6d0; padding: 2px 8px; border-radius: 20px; display: inline-block; width: fit-content; }
        .hc-cta { margin-top: auto; padding-top: 10px; font-size: 12px; font-weight: 600; color: #8C1D40; }
        .hc-card:hover .hc-cta { color: #c9973a; }

        /* ── SHIMMER ─────────────────────────────────────────────── */
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

        /* ── LIST CTA ────────────────────────────────────────────── */
        .list-cta { background: #1a1a1a; border-radius: 16px; padding: 40px 40px; display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 56px; flex-wrap: wrap; }
        .list-cta-left {}
        .list-cta-eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: rgba(255,255,255,0.35); margin-bottom: 8px; }
        .list-cta-title { font-family: 'Fraunces', serif; font-size: 28px; font-weight: 300; color: #fff; letter-spacing: -0.5px; line-height: 1.15; }
        .list-cta-title em { font-style: italic; color: #FFC627; }
        .list-cta-sub { font-size: 13px; color: rgba(255,255,255,0.45); margin-top: 8px; }
        .list-cta-btn { background: #FFC627; color: #1a1a1a; font-size: 14px; font-weight: 700; padding: 14px 28px; border-radius: 9px; text-decoration: none; white-space: nowrap; font-family: 'DM Sans', sans-serif; transition: background 0.15s, transform 0.15s; flex-shrink: 0; }
        .list-cta-btn:hover { background: #e6b320; transform: translateY(-1px); }
        @media (max-width: 540px) {
          .list-cta { padding: 28px 24px; }
          .list-cta-title { font-size: 22px; }
          .list-cta-btn { width: 100%; text-align: center; }
        }

        /* ── RESPONSIVE ──────────────────────────────────────────── */
        @media (max-width: 860px) {
          .rb-wrap { grid-template-columns: 140px 1fr; }
          .rb-stat { font-size: 44px; }
          .rb-headline { font-size: 15px; }
          .rb-right { padding: 20px 20px; }
          .rb-excerpt { display: none; }
          .hc-card { width: 188px; }
          .hc-img-wrap { height: 128px; }
        }
        @media (max-width: 540px) {
          .hero-title { font-size: 36px; letter-spacing: -1.2px; }
          .rb-wrap { grid-template-columns: 1fr; }
          .rb-left { flex-direction: row; justify-content: flex-start; gap: 14px; padding: 18px 20px; }
          .rb-stat { font-size: 36px; }
          .rb-stat-label { font-size: 9px; max-width: 80px; }
          .rb-eyebrow { display: none; }
          .hc-card { width: 172px; }
          .hc-img-wrap { height: 116px; }
          .lr-title { font-size: 19px; }
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

        {/* HERO */}
        <div className="hero">
          <div className="hero-eyebrow">
            <span className="hero-eyebrow-dot" />
            Tempe, AZ · Near ASU Campus
          </div>
          <h1 className="hero-title">
            Off-campus housing<br />for <em>Sun Devils.</em>
          </h1>
          <div className="hero-trust">
            {['$0 broker fees', 'Verified landlords', 'No commitment to apply', 'Groups welcome'].map(t => (
              <div className="hero-trust-item" key={t}>
                <span className="trust-dot" />
                <span>{t}</span>
              </div>
            ))}
          </div>
        </div>

        {/* RESEARCH VALIDATION */}
        <ResearchBadge />

        {/* LISTINGS */}
        {loading ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : properties.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px', marginBottom: '80px' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>🏠</div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: '22px', fontWeight: 300, color: '#1a1a1a', marginBottom: '8px' }}>No listings right now</div>
            <div style={{ fontSize: '14px', color: '#9b9b9b' }}>Check back soon — new homes are added regularly.</div>
          </div>
        ) : (
          <>
            <ListingRow
              title="Available now"
              sub={`${featuredRow.length} home${featuredRow.length !== 1 ? 's' : ''} ready to move in`}
              homes={featuredRow}
              viewAllHref="/homes"
            />
            {subleasesRow.length > 0 && (
              <ListingRow
                title="Subleases & lease transfers"
                sub="Take over a lease — flexible dates, often below market"
                homes={subleasesRow}
                showDates
                viewAllHref="/homes"
              />
            )}
          </>
        )}

        {/* LIST YOUR PLACE CTA */}
        <div className="list-cta">
          <div className="list-cta-left">
            <div className="list-cta-eyebrow">For landlords & students subleasing</div>
            <div className="list-cta-title">Have a place to rent?<br /><em>List it free.</em></div>
            <div className="list-cta-sub">No fees. Student leads straight to your inbox.</div>
          </div>
          <a href="/for-landlords" className="list-cta-btn">List your place →</a>
        </div>

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
