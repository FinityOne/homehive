'use client'

import '@/styles/brand-tokens.css'
import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { getProperties, type Property } from '@/lib/properties'
import SaveButton from '@/components/SaveButton'

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

// ─── QUICK FILTERS ────────────────────────────────────────────────────────────
// ─── EDITORIAL PICKS ─────────────────────────────────────────────────────────
type EditorialTab = 'rent' | 'sublets' | 'roommates'

function fmtDist(d: number) {
  if (!d) return null
  return `${d.toFixed(1)} mi to campus`
}

function fmtLease(start: string | null, end: string | null) {
  const s = fmtDate(start)
  const e = fmtDate(end)
  if (s && e) return `Lease ${s} → ${e}`
  return null
}

function EditorialPicks({ rentals, sublets }: { rentals: Property[]; sublets: Property[] }) {
  const [tab, setTab] = useState<EditorialTab>('rent')

  const listings = tab === 'sublets' ? sublets : rentals
  const featured  = listings[0] ?? null
  const gridCards = listings.slice(1, 5)

  const TABS: { id: EditorialTab; label: string }[] = [
    { id: 'rent',      label: 'For rent' },
    { id: 'sublets',   label: 'Sublets'  },
    { id: 'roommates', label: 'Roommates' },
  ]

  return (
    <div className="ep-section">
      {/* Header */}
      <div className="ep-header">
        <div>
          <div className="ep-eyebrow">Handpicked · Tempe</div>
          <h2 className="ep-title">This week&rsquo;s <em>editorial picks.</em></h2>
        </div>
        <div className="ep-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`ep-tab${tab === t.id ? ' ep-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Roommates tab — CTA */}
      {tab === 'roommates' ? (
        <div className="ep-roommates">
          <div className="ep-rm-left">
            <div className="ep-rm-badge">🏠 New</div>
            <div className="ep-rm-headline">Find your people,<br /><em>then find your place.</em></div>
            <p className="ep-rm-desc">
              Form a roommate group, set your vibe, and let landlords pitch you — not the other way around.
            </p>
            <a href="/roommates" className="ep-rm-cta">Browse roommate groups →</a>
          </div>
          <div className="ep-rm-right">
            {rentals.slice(0, 3).map(h => (
              <a key={h.slug} href={`/homes/${h.slug}`} className="ep-rm-card">
                <div className="ep-rm-card-img">
                  {h.images?.[0]
                    ? <img src={h.images[0]} alt={h.name} />
                    : <div className="ep-rm-card-img-ph" />}
                </div>
                <div className="ep-rm-card-body">
                  <div className="ep-rm-card-name">{h.name}</div>
                  <div className="ep-rm-card-sub">{h.beds}B/{h.baths}B · {h.asu_distance ? `${h.asu_distance.toFixed(1)} mi` : 'Tempe'}</div>
                </div>
                <div className="ep-rm-card-price">${h.price.toLocaleString()}<span>/mo</span></div>
              </a>
            ))}
          </div>
        </div>
      ) : listings.length === 0 ? (
        <div className="ep-empty">No listings in this category yet — check back soon.</div>
      ) : (
        <div className="ep-grid">
          {/* Left — featured card */}
          {featured && (
            <a href={`/homes/${featured.slug}`} className="ep-featured">
              {/* Image */}
              <div className="ep-feat-img">
                {featured.images?.[0]
                  ? <img src={featured.images[0]} alt={featured.name} />
                  : <div className="ep-feat-img-ph"><span>listing photo</span></div>}
                {/* Top badges */}
                <div className="ep-feat-badges">
                  <span className="ep-verified-pill">
                    <span className="ep-verified-dot" />
                    Verified host
                  </span>
                  {featured.is_featured && (
                    <span className="ep-editors-pick">Editor&rsquo;s pick</span>
                  )}
                </div>
                {/* Bottom name overlay */}
                <div className="ep-feat-overlay">
                  <div className="ep-feat-overlay-eyebrow">
                    Tempe{featured.asu_distance ? ` · ${featured.asu_distance.toFixed(1)} MI TO CAMPUS` : ''}
                  </div>
                  <div className="ep-feat-overlay-name">{featured.name}</div>
                </div>
              </div>
              {/* Details bar */}
              <div className="ep-feat-details">
                <div className="ep-feat-details-left">
                  <div className="ep-feat-meta">
                    {featured.beds}B/{featured.baths}B
                    {featured.asu_distance ? ` · ${featured.asu_distance.toFixed(1)} mi to campus` : ''}
                    {fmtLease(featured.sublease_start_date, featured.sublease_end_date)
                      ? ` · ${fmtLease(featured.sublease_start_date, featured.sublease_end_date)}`
                      : ''}
                  </div>
                  {featured.tags?.length > 0 && (
                    <div className="ep-feat-tags">
                      {featured.tags.slice(0, 5).map(t => (
                        <span key={t} className="ep-tag">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="ep-feat-details-right">
                  <div className="ep-feat-price">
                    <span className="ep-feat-price-num">${featured.price.toLocaleString()}</span>
                    <span className="ep-feat-price-per">/mo</span>
                  </div>
                  <span className="ep-feat-view-btn">View home</span>
                </div>
              </div>
            </a>
          )}

          {/* Right — compact grid */}
          {gridCards.length > 0 && (
            <div className="ep-right-grid">
              {gridCards.map(h => (
                <a key={h.slug} href={`/homes/${h.slug}`} className="ep-mini-card">
                  <div className="ep-mini-img">
                    {h.images?.[0]
                      ? <img src={h.images[0]} alt={h.name} />
                      : <div className="ep-mini-img-ph"><span>listing photo</span></div>}
                    <span className="ep-mini-verified">
                      <span className="ep-mini-vdot" />Verified
                    </span>
                    <span className="ep-mini-count">
                      1/{Math.max(h.images?.length || 1, 1)}
                    </span>
                  </div>
                  <div className="ep-mini-body">
                    <div className="ep-mini-top">
                      <div className="ep-mini-name">{h.name}</div>
                      <div className="ep-mini-price">
                        ${h.price.toLocaleString()}<span>/mo</span>
                      </div>
                    </div>
                    <div className="ep-mini-sub">
                      {h.beds}B/{h.baths}B
                      {h.asu_distance ? ` · ${h.asu_distance.toFixed(1)} mi to campus` : ''}
                    </div>
                    {h.tags?.[0] && (
                      <div className="ep-mini-tags">
                        <span className="ep-tag">{h.tags[0]}</span>
                      </div>
                    )}
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* View all link */}
      <div className="ep-view-all-row">
        <a href="/homes" className="ep-view-all">
          Browse all homes →
        </a>
      </div>
    </div>
  )
}

// ─── ROOMMATES SECTION ────────────────────────────────────────────────────────
const ROOMMATE_PROFILES = [
  {
    name: 'Maya R.',
    year: "ASU '27",
    major: 'Bio',
    subject: 'Environmental design',
    quote: '"Quiet weeknights, cooks Sundays"',
    gradient: 'linear-gradient(160deg, #b5a98c 0%, #8a7f62 100%)',
  },
  {
    name: 'Jordan T.',
    year: "ASU '26",
    major: 'Eng',
    subject: 'Computer science',
    quote: '"Early riser, gym, board games"',
    gradient: 'linear-gradient(160deg, #7a9580 0%, #556e5e 100%)',
    featured: true,
  },
  {
    name: 'Sade L.',
    year: "ASU '28",
    major: 'Bus',
    subject: 'Marketing',
    quote: '"Plants, jazz, hates dishes left out"',
    gradient: 'linear-gradient(160deg, #a88c8c 0%, #7d6060 100%)',
  },
]

function RoommatesSection() {
  return (
    <section className="rm-section">
      <div className="rm-inner">
        <div className="rm-left">
          <div className="rm-eyebrow">Roommates · Community</div>
          <h2 className="rm-title">Find your <em>people,</em><br />not just your place.</h2>
          <p className="rm-desc">
            Verified student profiles, real questionnaires, no swiping theater.
            Match on sleep schedules, cleanliness, and what you actually want from a home.
          </p>
          <div className="rm-btns">
            <a href="/roommates" className="rm-btn-primary">Browse roommates</a>
            <a href="/roommates" className="rm-btn-ghost">Take the match quiz</a>
          </div>
        </div>
        <div className="rm-right">
          {ROOMMATE_PROFILES.map((p) => (
            <div key={p.name} className={`rm-card${p.featured ? ' rm-card--featured' : ''}`}>
              <div className="rm-card-photo" style={{ background: p.gradient }}>
                <span className="rm-card-photo-label">Student Photo</span>
                <span className="rm-verified-pill">
                  <span className="rm-verified-dot" />
                  Verified
                </span>
              </div>
              <div className="rm-card-body">
                <div className="rm-card-name">{p.name}</div>
                <div className="rm-card-meta">{p.year} · {p.major} · {p.subject}</div>
                <div className="rm-card-quote">{p.quote}</div>
                <a href="/roommates" className="rm-say-hi">Say hi</a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── TRUST SECTION ────────────────────────────────────────────────────────────
const TRUST_ITEMS = [
  {
    n: '01',
    title: 'ID-verified hosts',
    desc: 'Government ID + proof of ownership before any home goes live.',
  },
  {
    n: '02',
    title: 'Photos from this month',
    desc: 'No bait-and-switch. We require fresh imagery every 60 days.',
  },
  {
    n: '03',
    title: 'No-ghost policy',
    desc: 'Hosts who go silent get delisted. Period.',
  },
  {
    n: '04',
    title: 'Real reviews only',
    desc: 'Reviews come from verified lease signers. No bots, no astroturf.',
  },
]

function TrustSection() {
  return (
    <div className="trust-section">
      <div className="trust-left">
        <div className="trust-eyebrow">Why students trust us</div>
        <h2 className="trust-title">The anti-scam<br /><em>marketplace.</em></h2>
        <p className="trust-desc">
          Facebook groups and Craigslist gave us deposit scams and ghost landlords.
          HomeHive is built so that can&rsquo;t happen.
        </p>
        <div className="trust-btns">
          <a href="/how-it-works#trust" className="trust-btn-primary">Read our trust policy</a>
          <a href="/how-it-works#verification" className="trust-btn-ghost">How verification works</a>
        </div>
      </div>
      <div className="trust-right">
        {TRUST_ITEMS.map(item => (
          <div key={item.n} className="trust-card">
            <div className="trust-card-num">{item.n}</div>
            <div className="trust-card-title">{item.title}</div>
            <div className="trust-card-desc">{item.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── HOW IT WORKS ─────────────────────────────────────────────────────────────
const HIW_STEPS = [
  {
    n: '01',
    title: 'Search verified homes',
    desc: 'Filter by campus, lease length, roommate fit. No fake listings — every host is ID-checked.',
  },
  {
    n: '02',
    title: 'Tour without the awkward',
    desc: 'Self-guided video tours and in-person slots in one place. No "DM me on Instagram."',
  },
  {
    n: '03',
    title: 'Sign and split rent',
    desc: 'Lease, deposit, and roommate splits all in HomeHive. No Venmo chasing.',
  },
]

function HowItWorks() {
  return (
    <div className="hiw-section">
      <div className="hiw-header">
        <div>
          <div className="hiw-eyebrow">How HomeHive Works</div>
          <h2 className="hiw-title">The whole search,<br /><em>in one calm place.</em></h2>
        </div>
        <a href="/how-it-works" className="hiw-guide-link">See the full guide →</a>
      </div>
      <div className="hiw-grid">
        {HIW_STEPS.map(s => (
          <div key={s.n} className="hiw-card">
            <div className="hiw-card-top">
              <div className="hiw-step-label">
                <span className="hiw-step-word">Step</span>
                <span className="hiw-step-dot">·</span>
                <span className="hiw-step-num">{s.n}</span>
              </div>
              <h3 className="hiw-card-title">{s.title}</h3>
              <p className="hiw-card-desc">{s.desc}</p>
            </div>
            <div className="hiw-illustration">
              <span className="hiw-illustration-label">illustration · step {s.n}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── SKELETON ─────────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <div style={{ marginBottom: '52px' }}>
      <div style={{ height: '22px', width: '200px', background: 'var(--hh-bg-alt)', borderRadius: '6px', marginBottom: '8px' }} />
      <div style={{ height: '13px', width: '140px', background: 'var(--hh-bg-alt)', borderRadius: '6px', marginBottom: '22px' }} />
      <div style={{ display: 'flex', gap: '16px', overflow: 'hidden' }}>
        {[1, 2, 3, 4].map(n => (
          <div key={n} style={{ flexShrink: 0, width: '260px', background: '#fff', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ height: '200px', background: 'linear-gradient(90deg,var(--hh-bg-alt) 25%,var(--hh-bg) 50%,var(--hh-bg-alt) 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
            <div style={{ padding: '13px 14px 15px' }}>
              <div style={{ height: '15px', background: 'var(--hh-bg-alt)', borderRadius: '4px', marginBottom: '10px', width: '75%' }} />
              <div style={{ height: '24px', background: 'var(--hh-border-faint)', borderRadius: '20px', width: '50%' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── BUDGET POPOVER ───────────────────────────────────────────────────────────
// ─── LISTING CARD ───────────────────────────────────────────────────────────
function ListingCard({ h }: { h: Property }) {
  const img = h.images?.[0]
  const dist = typeof h.asu_distance === 'number'
    ? (h.asu_distance <= 0.4 ? 'Walk to ASU' : `${h.asu_distance} mi to ASU`)
    : null
  const typeLabel = h.listing_type === 'sublease' ? 'Sublease' : h.listing_type === 'lease_transfer' ? 'Lease transfer' : null
  return (
    <a href={`/homes/${h.slug}`} className="lc-card">
      <div className="lc-media">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {img ? <img src={img} alt={h.name} loading="lazy" /> : <div className="lc-media-ph">🏠</div>}
        <SaveButton slug={h.slug} />
        {typeLabel && <span className="lc-type">{typeLabel}</span>}
        {dist && <span className="lc-badge">📍 {dist}</span>}
      </div>
      <div className="lc-body">
        <div className="lc-top">
          <span className="lc-name">{h.name}</span>
          {h.asu_score ? <span className="lc-score">★ {h.asu_score.toFixed(1)}</span> : null}
        </div>
        <div className="lc-meta">
          {[h.beds > 0 ? `${h.beds} bd` : null, h.baths > 0 ? `${h.baths} ba` : null, h.tags?.[0] || null]
            .filter(Boolean).join(' · ')}
        </div>
        <div className="lc-price"><strong>${h.price?.toLocaleString()}</strong> <span>/mo</span></div>
      </div>
    </a>
  )
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
function HomePageInner({ initialProperties }: { initialProperties?: Property[] }) {
  const searchParams    = useSearchParams()
  const guestName       = searchParams.get('name') || ''
  const isPersonalized  = !!guestName

  const hasInitial = !!(initialProperties && initialProperties.length > 0)
  const [properties, setProperties]                 = useState<Property[]>(initialProperties ?? [])
  const [loading, setLoading]                       = useState(!hasInitial)
  const [showLandlordBanner, setShowLandlordBanner] = useState(false)

  useEffect(() => {
    // Listings are server-rendered into the initial HTML; only fetch on the
    // client as a fallback when they weren't provided (e.g. dev/edge cases).
    if (!hasInitial) {
      getProperties().then(data => { setProperties(data); setLoading(false) })
    }
    if (!sessionStorage.getItem('hh_landlord_bar_dismissed')) setShowLandlordBanner(true)
  }, [hasInitial])

  // Listings-first: surface featured, then closest/best-scored homes immediately.
  const gridHomes = [...properties]
    .sort((a, b) => (b.is_featured ? 1 : 0) - (a.is_featured ? 1 : 0) || (b.asu_score || 0) - (a.asu_score || 0))
    .slice(0, 12)

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..700&family=Geist:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        body { font-family: var(--hh-font-ui); background: var(--hh-bg); color: var(--hh-text); }

        .wrap { max-width: 1200px; margin: 0 auto; padding: 0 24px; }

        /* ── BANNERS ── */
        .landlord-bar { background: #f0fdf4; border-bottom: 1px solid #bbf7d0; padding: 9px 24px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: var(--hh-sz-small); color: #166534; position: relative; }
        .landlord-bar a { color: #166534; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }
        .landlord-bar-close { position: absolute; right: 16px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: var(--hh-text-muted); font-size: 16px; padding: 4px; line-height: 1; }
        .personal-bar { background: var(--hh-ink-900); padding: 9px 24px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: var(--hh-sz-small); color: var(--hh-ink-300); }
        .personal-bar strong { color: var(--hh-accent); font-weight: 500; }
        .pbar-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; animation: pulse 2s infinite; flex-shrink: 0; }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.3} }

        /* ── HERO ── */
        .hero { padding: 52px 0 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center; }

        /* Left column */
        .hero-eyebrow { font-size: var(--hh-sz-eyebrow); font-weight: var(--hh-wt-eyebrow); letter-spacing: var(--hh-ls-eyebrow); text-transform: uppercase; color: var(--hh-text-muted); margin-bottom: 18px; }
        .hero-eyebrow-dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--hh-accent); margin: 0 6px 1px; vertical-align: middle; }
        .hero-h1 { font-family: var(--hh-font-display); font-size: clamp(44px, 5.5vw, 72px); font-weight: 350; line-height: 1.02; letter-spacing: -0.03em; color: var(--hh-text); margin-bottom: 0; }
        .hero-h1-italic { font-style: italic; color: var(--hh-primary); display: block; }
        .hero-desc { font-size: 15px; line-height: 1.65; color: var(--hh-text-muted); max-width: 420px; margin-top: 22px; }

        /* Stats row */
        .hero-stats { display: flex; align-items: flex-start; gap: 32px; margin-top: 32px; padding-top: 28px; border-top: 1px solid var(--hh-border-faint); }
        .hero-stat-num { font-family: var(--hh-font-display); font-size: 28px; font-weight: 400; line-height: 1; letter-spacing: -0.03em; color: var(--hh-text); }
        .hero-stat-label { font-size: 11px; color: var(--hh-text-muted); margin-top: 4px; line-height: 1.3; }

        /* Right column — featured property card */
        .hero-right { position: relative; }
        .hero-img-card { position: relative; border-radius: 20px; overflow: hidden; aspect-ratio: 4/3; background: var(--hh-bg-alt); box-shadow: 0 4px 32px rgba(34,40,16,0.12), 0 1px 4px rgba(0,0,0,0.06); }
        .hero-img-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .hero-img-placeholder { width: 100%; height: 100%; background: linear-gradient(135deg, #ede9e0 0%, #e5dfd2 40%, #d9d2c5 100%); display: flex; align-items: center; justify-content: center; }
        .hero-img-placeholder-label { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--hh-ink-400); font-weight: 500; }

        /* Dark badge top-right */
        .hero-badge-card { position: absolute; top: 16px; right: 16px; background: rgba(22,24,16,0.92); backdrop-filter: blur(12px); border-radius: 12px; padding: 14px 18px; max-width: 220px; }
        .hero-badge-eyebrow { font-size: 9px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--hh-accent); margin-bottom: 6px; }
        .hero-badge-text { font-family: var(--hh-font-display); font-size: 17px; font-weight: 400; line-height: 1.25; color: #fff; letter-spacing: -0.02em; }

        /* Review card bottom */
        .hero-review-card { position: absolute; bottom: -16px; left: 16px; right: 16px; background: #fff; border-radius: 14px; padding: 14px 16px; box-shadow: 0 8px 32px rgba(34,40,16,0.14), 0 1px 4px rgba(0,0,0,0.06); display: flex; align-items: center; gap: 12px; }
        .hero-review-photo { width: 38px; height: 38px; border-radius: 50%; background: var(--hh-bg-alt); flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 18px; border: 1.5px solid var(--hh-border); }
        .hero-review-body { flex: 1; min-width: 0; }
        .hero-review-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
        .hero-verified-pill { display: inline-flex; align-items: center; gap: 4px; background: rgba(42,125,79,0.08); border: 1px solid rgba(42,125,79,0.2); border-radius: 100px; padding: 2px 8px; font-size: 10px; font-weight: 700; color: #2a7d4f; }
        .hero-verified-dot { width: 5px; height: 5px; border-radius: 50%; background: #2a7d4f; }
        .hero-review-updated { font-size: 10px; color: var(--hh-text-muted); }
        .hero-review-quote { font-size: 12px; line-height: 1.5; color: var(--hh-text); font-style: italic; }
        .hero-review-attr { font-size: 11px; color: var(--hh-text-muted); margin-top: 2px; }

        /* ── SEARCH BAR ── */
        .search-section { padding: 32px 0 0; }
        .sf-bar { display: grid; grid-template-columns: 1.4fr 1fr 1.2fr 1fr auto; align-items: stretch; background: #fff; border: 1.5px solid var(--hh-border); border-radius: 14px; overflow: visible; box-shadow: 0 2px 16px rgba(34,40,16,0.07); }
        .sf-field { padding: 14px 20px; cursor: pointer; position: relative; border-right: 1px solid var(--hh-border-faint); transition: background 0.12s; }
        .sf-field:hover { background: var(--hh-bg-alt); }
        .sf-field:last-of-type { border-right: none; }
        .sf-label { font-size: 9px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--hh-text-muted); margin-bottom: 5px; }
        .sf-value { font-size: 14px; font-weight: 500; color: var(--hh-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .sf-value-muted { color: var(--hh-text-muted); font-weight: 400; }

        /* Campus field */
        .sf-field--campus .sf-value { font-weight: 600; }

        /* Move-in field */
        .sf-field--movein { position: relative; }
        .sf-movein-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; border: none; }

        /* Budget popover */
        .sf-field--budget { user-select: none; }
        .sf-budget-popover { position: absolute; top: calc(100% + 8px); left: 0; min-width: 200px; background: #fff; border: 1.5px solid var(--hh-border); border-radius: 12px; padding: 16px; box-shadow: 0 8px 24px rgba(34,40,16,0.12); z-index: 100; }
        .sf-budget-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
        .sf-budget-row:last-child { margin-bottom: 0; }
        .sf-budget-row label { font-size: 12px; color: var(--hh-text-muted); font-weight: 500; min-width: 28px; }
        .sf-budget-input { border: 1.5px solid var(--hh-border); border-radius: 8px; padding: 6px 10px; font-size: 13px; font-family: var(--hh-font-ui); color: var(--hh-text); width: 120px; outline: none; }
        .sf-budget-input:focus { border-color: var(--hh-primary); }

        /* Roommates field */
        .sf-field--roommates { display: flex; flex-direction: column; }
        .sf-roommates-ctrl { display: flex; align-items: center; gap: 10px; margin-top: 5px; }
        .sf-rm-btn { width: 24px; height: 24px; border-radius: 50%; border: 1.5px solid var(--hh-border); background: #fff; cursor: pointer; font-size: 14px; line-height: 1; display: flex; align-items: center; justify-content: center; color: var(--hh-text); transition: border-color 0.12s; flex-shrink: 0; }
        .sf-rm-btn:hover { border-color: var(--hh-primary); }
        .sf-rm-val { font-size: 14px; font-weight: 500; color: var(--hh-text); min-width: 16px; text-align: center; }

        /* Search button */
        .sf-search-btn { background: var(--hh-ink-900); color: #fff; border: none; padding: 0 28px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: var(--hh-font-ui); white-space: nowrap; transition: background 0.15s, transform 0.15s; border-radius: 0 12px 12px 0; margin: -1px -1px -1px 0; }
        .sf-search-btn:hover { background: var(--hh-primary); transform: translateX(1px); }

        /* ── QUICK FILTERS ── */
        .qf-row { display: flex; align-items: center; gap: 8px; padding: 16px 0 0; overflow-x: auto; scrollbar-width: none; flex-wrap: nowrap; }
        .qf-row::-webkit-scrollbar { display: none; }
        .qf-chip { flex-shrink: 0; display: inline-flex; align-items: center; gap: 5px; background: #fff; border: 1.5px solid var(--hh-border); border-radius: 100px; padding: 6px 14px; font-size: 12px; font-weight: 500; color: var(--hh-text-2); cursor: pointer; transition: all 0.12s; white-space: nowrap; }
        .qf-chip:hover { border-color: var(--hh-primary); color: var(--hh-text); background: var(--hh-bg-alt); }
        .qf-chip.active { background: var(--hh-ink-900); border-color: var(--hh-ink-900); color: #fff; }

        /* ── DIVIDER ── */
        .section-divider { border: none; border-top: 1px solid var(--hh-border-faint); margin: 40px 0; }

        /* ── LEAD BAND (compact, listings-first) ── */
        .lead-band { padding: 38px 0 24px; }
        .lead-eyebrow { font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--hh-text-muted); display: inline-flex; align-items: center; gap: 8px; margin-bottom: 14px; }
        .lead-eyebrow-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; animation: livePulse 2.4s ease-in-out infinite; }
        .lead-h1 { font-family: var(--hh-font-display); font-size: clamp(32px, 4.8vw, 56px); font-weight: 350; line-height: 1.04; letter-spacing: -0.03em; color: var(--hh-text); margin: 0 0 14px; }
        .lead-h1 em { font-style: italic; color: var(--hh-primary); }
        .lead-sub { font-size: 15px; line-height: 1.6; color: var(--hh-text-muted); max-width: 560px; margin: 0 0 22px; }
        .lead-chips { display: flex; flex-wrap: wrap; gap: 9px; }
        .lead-chip { display: inline-flex; align-items: center; font-size: 13px; font-weight: 500; color: var(--hh-text-2); background: var(--hh-bg-alt); border: 1px solid var(--hh-border); border-radius: 100px; padding: 8px 15px; text-decoration: none; transition: color 0.15s, border-color 0.15s, transform 0.15s, background 0.15s; white-space: nowrap; }
        .lead-chip:hover { border-color: var(--hh-primary); color: var(--hh-primary); transform: translateY(-1px); }
        .lead-chip--all { background: var(--hh-ink-900); color: #fff; border-color: var(--hh-ink-900); font-weight: 600; }
        .lead-chip--all:hover { background: var(--hh-hive-800); color: #fff; border-color: var(--hh-hive-800); }

        /* ── LISTINGS GRID ── */
        .lc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 24px 20px; }
        .lc-card { text-decoration: none; color: inherit; display: flex; flex-direction: column; transition: transform 0.18s; }
        .lc-card:hover { transform: translateY(-3px); }
        .lc-media { position: relative; aspect-ratio: 4 / 3; border-radius: 16px; overflow: hidden; background: var(--hh-bg-alt); box-shadow: 0 1px 3px rgba(34,40,16,0.06); }
        .lc-media img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.4s ease; }
        .lc-card:hover .lc-media img { transform: scale(1.045); }
        .lc-media-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 40px; background: linear-gradient(135deg, #ede9e0 0%, #d9d2c5 100%); }
        .lc-badge { position: absolute; left: 12px; bottom: 12px; background: rgba(22,24,16,0.82); backdrop-filter: blur(8px); color: #fff; font-size: 11px; font-weight: 600; padding: 5px 11px; border-radius: 100px; }
        .lc-type { position: absolute; top: 12px; left: 12px; background: var(--hh-accent); color: #1a1a1a; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; padding: 4px 9px; border-radius: 6px; }
        .lc-body { padding: 12px 4px 4px; }
        .lc-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
        .lc-name { font-size: 15px; font-weight: 600; color: var(--hh-text); line-height: 1.3; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lc-score { flex-shrink: 0; font-size: 13px; font-weight: 600; color: var(--hh-text); }
        .lc-meta { font-size: 13px; color: var(--hh-text-muted); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lc-price { font-size: 14px; color: var(--hh-text); margin-top: 8px; }
        .lc-price strong { font-size: 17px; font-weight: 700; }
        .lc-price span { color: var(--hh-text-muted); font-size: 13px; }
        @media (max-width: 600px) {
          .lc-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 18px 12px; }
          .lead-band { padding: 26px 0 18px; }
        }

        /* ── EDITORIAL PICKS ── */
        .ep-section { margin-bottom: 64px; }

        .ep-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 28px; flex-wrap: wrap; }
        .ep-eyebrow { font-size: var(--hh-sz-eyebrow); font-weight: var(--hh-wt-eyebrow); letter-spacing: var(--hh-ls-eyebrow); text-transform: uppercase; color: var(--hh-text-muted); margin-bottom: 8px; }
        .ep-title { font-family: var(--hh-font-display); font-size: clamp(28px, 3.5vw, 44px); font-weight: 350; line-height: 1.05; letter-spacing: -0.025em; color: var(--hh-text); }
        .ep-title em { font-style: italic; color: var(--hh-primary); }

        /* Tabs */
        .ep-tabs { display: flex; align-items: center; gap: 4px; background: #fff; border: 1.5px solid var(--hh-border); border-radius: 100px; padding: 4px; flex-shrink: 0; }
        .ep-tab { border: none; background: transparent; padding: 7px 18px; border-radius: 100px; font-size: 13px; font-weight: 500; cursor: pointer; font-family: var(--hh-font-ui); color: var(--hh-text-muted); transition: all 0.15s; white-space: nowrap; }
        .ep-tab:hover { color: var(--hh-text); background: var(--hh-bg-alt); }
        .ep-tab--active { background: var(--hh-ink-900); color: #fff; font-weight: 600; }
        .ep-tab--active:hover { background: var(--hh-primary); }

        /* Main grid */
        .ep-grid { display: grid; grid-template-columns: 1.5fr 1fr; gap: 16px; align-items: start; }

        /* Featured card (left) */
        .ep-featured { text-decoration: none; color: inherit; display: flex; flex-direction: column; background: #fff; border-radius: 18px; overflow: hidden; border: 1px solid var(--hh-border-faint); box-shadow: 0 2px 12px rgba(34,40,16,0.07); transition: box-shadow 0.2s, transform 0.2s; }
        .ep-featured:hover { box-shadow: 0 12px 40px rgba(34,40,16,0.13); transform: translateY(-2px); }

        .ep-feat-img { position: relative; aspect-ratio: 4/3; overflow: hidden; background: #c8c5bc; }
        .ep-feat-img img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.5s; }
        .ep-featured:hover .ep-feat-img img { transform: scale(1.04); }
        .ep-feat-img-ph { width: 100%; height: 100%; background: linear-gradient(135deg, #bab5a8 0%, #a8a49a 50%, #bab5a8 100%); display: flex; align-items: center; justify-content: center; }
        .ep-feat-img-ph span { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.5); font-weight: 500; }

        /* Badges */
        .ep-feat-badges { position: absolute; top: 16px; left: 16px; display: flex; gap: 8px; align-items: center; }
        .ep-verified-pill { display: inline-flex; align-items: center; gap: 5px; background: rgba(255,255,255,0.92); backdrop-filter: blur(8px); border-radius: 100px; padding: 5px 11px; font-size: 11px; font-weight: 600; color: #1a1a1a; border: 1px solid rgba(255,255,255,0.5); }
        .ep-verified-dot { width: 7px; height: 7px; border-radius: 50%; background: #D9A14A; flex-shrink: 0; }
        .ep-editors-pick { display: inline-flex; align-items: center; background: rgba(22,24,16,0.88); backdrop-filter: blur(8px); border-radius: 100px; padding: 5px 12px; font-size: 11px; font-weight: 600; color: #fff; }

        /* Bottom overlay */
        .ep-feat-overlay { position: absolute; bottom: 0; left: 0; right: 0; padding: 40px 20px 20px; background: linear-gradient(to top, rgba(20,24,16,0.78) 0%, transparent 100%); }
        .ep-feat-overlay-eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.6); margin-bottom: 6px; }
        .ep-feat-overlay-name { font-family: var(--hh-font-display); font-size: clamp(22px, 2.5vw, 32px); font-weight: 400; color: #fff; letter-spacing: -0.02em; line-height: 1.1; }

        /* Details bar */
        .ep-feat-details { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 20px; flex-wrap: wrap; }
        .ep-feat-details-left { flex: 1; min-width: 0; }
        .ep-feat-meta { font-size: 12px; color: var(--hh-text-muted); margin-bottom: 10px; line-height: 1.4; }
        .ep-feat-tags { display: flex; flex-wrap: wrap; gap: 6px; }
        .ep-tag { font-size: 11px; font-weight: 500; color: var(--hh-text-2); background: var(--hh-bg-alt); border: 1px solid var(--hh-border-faint); border-radius: 100px; padding: 3px 10px; white-space: nowrap; }
        .ep-feat-details-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
        .ep-feat-price { display: flex; align-items: baseline; gap: 2px; }
        .ep-feat-price-num { font-family: var(--hh-font-display); font-size: 26px; font-weight: 400; color: var(--hh-text); letter-spacing: -0.03em; }
        .ep-feat-price-per { font-size: 12px; color: var(--hh-text-muted); }
        .ep-feat-view-btn { background: var(--hh-ink-900); color: #fff; font-size: 13px; font-weight: 600; padding: 10px 20px; border-radius: 100px; white-space: nowrap; transition: background 0.15s; }
        .ep-featured:hover .ep-feat-view-btn { background: var(--hh-primary); }

        /* Right grid */
        .ep-right-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

        /* Mini card */
        .ep-mini-card { text-decoration: none; color: inherit; background: #fff; border-radius: 14px; overflow: hidden; border: 1px solid var(--hh-border-faint); box-shadow: 0 1px 6px rgba(34,40,16,0.06); transition: box-shadow 0.2s, transform 0.2s; display: flex; flex-direction: column; }
        .ep-mini-card:hover { box-shadow: 0 8px 24px rgba(34,40,16,0.11); transform: translateY(-2px); }
        .ep-mini-img { position: relative; aspect-ratio: 4/3; overflow: hidden; background: #b8b5ae; }
        .ep-mini-img img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.4s; }
        .ep-mini-card:hover .ep-mini-img img { transform: scale(1.06); }
        .ep-mini-img-ph { width: 100%; height: 100%; background: linear-gradient(135deg, #a8a49a 0%, #bab5a8 100%); display: flex; align-items: center; justify-content: center; }
        .ep-mini-img-ph span { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.45); }
        .ep-mini-verified { position: absolute; top: 8px; left: 8px; display: inline-flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.88); backdrop-filter: blur(6px); border-radius: 100px; padding: 3px 9px; font-size: 10px; font-weight: 600; color: #1a1a1a; }
        .ep-mini-vdot { width: 6px; height: 6px; border-radius: 50%; background: #D9A14A; flex-shrink: 0; }
        .ep-mini-count { position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.45); backdrop-filter: blur(4px); border-radius: 6px; padding: 2px 7px; font-size: 10px; font-weight: 600; color: #fff; }
        .ep-mini-body { padding: 12px 13px 14px; flex: 1; display: flex; flex-direction: column; gap: 4px; }
        .ep-mini-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; }
        .ep-mini-name { font-family: var(--hh-font-display); font-size: 14px; font-weight: 500; color: var(--hh-text); letter-spacing: -0.01em; line-height: 1.25; flex: 1; min-width: 0; }
        .ep-mini-price { font-size: 14px; font-weight: 700; color: var(--hh-text); white-space: nowrap; flex-shrink: 0; }
        .ep-mini-price span { font-size: 10px; font-weight: 400; color: var(--hh-text-muted); }
        .ep-mini-sub { font-size: 11px; color: var(--hh-text-muted); line-height: 1.4; }
        .ep-mini-tags { display: flex; gap: 5px; margin-top: 4px; }

        /* Roommates tab */
        .ep-roommates { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; background: var(--hh-ink-900); border-radius: 20px; padding: 40px; align-items: center; }
        .ep-rm-badge { display: inline-block; font-size: 11px; font-weight: 700; background: rgba(217,161,74,0.15); color: var(--hh-accent); border: 1px solid rgba(217,161,74,0.3); border-radius: 100px; padding: 4px 12px; margin-bottom: 16px; }
        .ep-rm-headline { font-family: var(--hh-font-display); font-size: clamp(24px, 2.5vw, 36px); font-weight: 350; color: #fff; letter-spacing: -0.025em; line-height: 1.1; margin-bottom: 14px; }
        .ep-rm-headline em { font-style: italic; color: var(--hh-accent); }
        .ep-rm-desc { font-size: 14px; color: rgba(255,255,255,0.55); line-height: 1.65; margin-bottom: 24px; max-width: 380px; }
        .ep-rm-cta { display: inline-flex; align-items: center; gap: 8px; background: #fff; color: var(--hh-ink-900); font-size: 13px; font-weight: 700; padding: 11px 22px; border-radius: 100px; text-decoration: none; transition: background 0.15s; }
        .ep-rm-cta:hover { background: var(--hh-bg-alt); }
        .ep-rm-right { display: flex; flex-direction: column; gap: 10px; }
        .ep-rm-card { display: flex; align-items: center; gap: 12px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 12px; text-decoration: none; color: inherit; transition: background 0.15s; }
        .ep-rm-card:hover { background: rgba(255,255,255,0.1); }
        .ep-rm-card-img { width: 48px; height: 48px; border-radius: 8px; overflow: hidden; flex-shrink: 0; background: rgba(255,255,255,0.08); }
        .ep-rm-card-img img { width: 100%; height: 100%; object-fit: cover; }
        .ep-rm-card-img-ph { width: 100%; height: 100%; }
        .ep-rm-card-body { flex: 1; min-width: 0; }
        .ep-rm-card-name { font-size: 13px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ep-rm-card-sub { font-size: 11px; color: rgba(255,255,255,0.45); margin-top: 2px; }
        .ep-rm-card-price { font-size: 13px; font-weight: 700; color: var(--hh-accent); flex-shrink: 0; }
        .ep-rm-card-price span { font-size: 10px; font-weight: 400; color: rgba(255,255,255,0.4); }

        .ep-empty { padding: 80px 24px; text-align: center; font-size: 14px; color: var(--hh-text-muted); background: var(--hh-bg-alt); border-radius: 16px; }

        .ep-view-all-row { display: flex; justify-content: center; margin-top: 28px; }
        .ep-view-all { font-size: 13px; font-weight: 600; color: var(--hh-text-muted); text-decoration: none; padding: 8px 20px; border: 1.5px solid var(--hh-border); border-radius: 100px; transition: all 0.15s; }
        .ep-view-all:hover { color: var(--hh-text); border-color: var(--hh-text); }

        /* ── LIST CTA ── */
        .list-cta { background: var(--hh-ink-900); border-radius: 16px; padding: 44px; display: flex; align-items: center; justify-content: space-between; gap: 28px; margin-bottom: 64px; flex-wrap: wrap; }
        .list-cta-eyebrow { font-size: var(--hh-sz-eyebrow); font-weight: var(--hh-wt-eyebrow); letter-spacing: var(--hh-ls-eyebrow); text-transform: uppercase; color: rgba(255,255,255,0.35); margin-bottom: 10px; }
        .list-cta-title { font-family: var(--hh-font-display); font-size: 30px; font-weight: 300; color: #fff; letter-spacing: -0.5px; line-height: 1.15; }
        .list-cta-title em { font-style: italic; color: var(--hh-accent); }
        .list-cta-sub { font-size: var(--hh-sz-small); color: rgba(255,255,255,0.45); margin-top: 8px; }
        .list-cta-btn { background: var(--hh-accent); color: var(--hh-ink-900); font-size: 14px; font-weight: 700; padding: 15px 30px; border-radius: 100px; text-decoration: none; white-space: nowrap; font-family: var(--hh-font-ui); transition: background 0.15s, transform 0.15s; flex-shrink: 0; }
        .list-cta-btn:hover { background: #c48e40; transform: translateY(-1px); }

        /* ── SHIMMER ── */
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

        /* ── ROOMMATES SECTION ── */
        .rm-section { background: #dfe8e0; padding: 72px 24px; }
        .rm-inner { max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1.6fr; gap: 64px; align-items: center; }
        .rm-eyebrow { font-size: var(--hh-sz-eyebrow); font-weight: var(--hh-wt-eyebrow); letter-spacing: var(--hh-ls-eyebrow); text-transform: uppercase; color: var(--hh-primary); margin-bottom: 16px; opacity: 0.8; }
        .rm-title { font-family: var(--hh-font-display); font-size: clamp(36px, 4.5vw, 58px); font-weight: 350; line-height: 1.05; letter-spacing: -0.03em; color: var(--hh-text); margin-bottom: 18px; }
        .rm-title em { font-style: italic; color: var(--hh-text); }
        .rm-desc { font-size: 15px; line-height: 1.7; color: var(--hh-text-muted); margin-bottom: 32px; max-width: 380px; }
        .rm-btns { display: flex; gap: 10px; flex-wrap: wrap; }
        .rm-btn-primary { display: inline-flex; align-items: center; background: var(--hh-ink-900); color: #fff; font-size: 13px; font-weight: 600; padding: 11px 22px; border-radius: 100px; text-decoration: none; transition: background 0.15s, transform 0.15s; }
        .rm-btn-primary:hover { background: var(--hh-primary); transform: translateY(-1px); }
        .rm-btn-ghost { display: inline-flex; align-items: center; background: transparent; color: var(--hh-text-2); font-size: 13px; font-weight: 500; padding: 11px 22px; border-radius: 100px; border: 1.5px solid rgba(34,40,16,0.2); text-decoration: none; transition: border-color 0.15s, color 0.15s; }
        .rm-btn-ghost:hover { border-color: var(--hh-text); color: var(--hh-text); }

        /* Cards row */
        .rm-right { display: flex; gap: 12px; align-items: flex-start; padding-top: 16px; }
        .rm-card { background: #fff; border-radius: 18px; overflow: hidden; flex: 1; box-shadow: 0 2px 16px rgba(34,40,16,0.09); transition: transform 0.2s, box-shadow 0.2s; }
        .rm-card:hover { transform: translateY(-4px); box-shadow: 0 12px 40px rgba(34,40,16,0.14); }
        .rm-card--featured { transform: translateY(-12px); box-shadow: 0 8px 28px rgba(34,40,16,0.13); }
        .rm-card--featured:hover { transform: translateY(-16px); }

        /* Photo area */
        .rm-card-photo { position: relative; aspect-ratio: 3/4; display: flex; align-items: flex-end; justify-content: flex-start; padding: 12px; }
        .rm-card-photo-label { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.5); font-weight: 400; }
        .rm-verified-pill { position: absolute; top: 10px; right: 10px; display: inline-flex; align-items: center; gap: 5px; background: rgba(255,255,255,0.9); backdrop-filter: blur(6px); border-radius: 100px; padding: 4px 10px; font-size: 10px; font-weight: 600; color: #1a1a1a; }
        .rm-verified-dot { width: 7px; height: 7px; border-radius: 50%; background: #D9A14A; flex-shrink: 0; }

        /* Card body */
        .rm-card-body { padding: 16px 16px 14px; }
        .rm-card-name { font-family: var(--hh-font-display); font-size: 18px; font-weight: 500; color: var(--hh-text); letter-spacing: -0.02em; margin-bottom: 4px; }
        .rm-card-meta { font-size: 11px; color: var(--hh-text-muted); margin-bottom: 10px; line-height: 1.4; }
        .rm-card-quote { font-size: 12px; line-height: 1.6; color: var(--hh-text-2); margin-bottom: 14px; }
        .rm-say-hi { display: block; text-align: center; background: #fff; border: 1.5px solid var(--hh-border); border-radius: 100px; padding: 8px 0; font-size: 13px; font-weight: 500; color: var(--hh-text); text-decoration: none; transition: background 0.15s, border-color 0.15s; }
        .rm-say-hi:hover { background: var(--hh-bg-alt); border-color: var(--hh-text); }

        /* ── TRUST SECTION ── */
        .trust-section { display: grid; grid-template-columns: 1fr 1.4fr; gap: 64px; align-items: center; background: #1a1c12; border-radius: 24px; padding: 56px 56px 56px 52px; margin-bottom: 72px; }
        .trust-eyebrow { font-size: var(--hh-sz-eyebrow); font-weight: var(--hh-wt-eyebrow); letter-spacing: var(--hh-ls-eyebrow); text-transform: uppercase; color: var(--hh-accent); margin-bottom: 18px; opacity: 0.9; }
        .trust-title { font-family: var(--hh-font-display); font-size: clamp(38px, 4.5vw, 60px); font-weight: 350; line-height: 1.05; letter-spacing: -0.03em; color: #fff; margin-bottom: 20px; }
        .trust-title em { font-style: italic; color: var(--hh-accent); }
        .trust-desc { font-size: 15px; line-height: 1.7; color: rgba(255,255,255,0.5); margin-bottom: 32px; max-width: 360px; }
        .trust-btns { display: flex; gap: 10px; flex-wrap: wrap; }
        .trust-btn-primary { display: inline-flex; align-items: center; background: var(--hh-accent); color: #1a1c12; font-size: 13px; font-weight: 700; padding: 11px 22px; border-radius: 100px; text-decoration: none; transition: background 0.15s, transform 0.15s; }
        .trust-btn-primary:hover { background: #c48e40; transform: translateY(-1px); }
        .trust-btn-ghost { display: inline-flex; align-items: center; background: transparent; color: rgba(255,255,255,0.7); font-size: 13px; font-weight: 500; padding: 11px 22px; border-radius: 100px; border: 1.5px solid rgba(255,255,255,0.18); text-decoration: none; transition: border-color 0.15s, color 0.15s; }
        .trust-btn-ghost:hover { border-color: rgba(255,255,255,0.4); color: #fff; }

        .trust-right { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .trust-card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 24px 22px 26px; transition: background 0.15s; }
        .trust-card:hover { background: rgba(255,255,255,0.08); }
        .trust-card-num { width: 32px; height: 32px; border-radius: 50%; background: rgba(217,161,74,0.15); border: 1px solid rgba(217,161,74,0.25); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: var(--hh-accent); margin-bottom: 16px; letter-spacing: 0.05em; }
        .trust-card-title { font-family: var(--hh-font-display); font-size: 18px; font-weight: 400; color: #fff; letter-spacing: -0.02em; line-height: 1.25; margin-bottom: 10px; }
        .trust-card-desc { font-size: 13px; line-height: 1.65; color: rgba(255,255,255,0.45); }

        /* ── HOW IT WORKS ── */
        .hiw-section { margin-bottom: 72px; }
        .hiw-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 36px; flex-wrap: wrap; }
        .hiw-eyebrow { font-size: var(--hh-sz-eyebrow); font-weight: var(--hh-wt-eyebrow); letter-spacing: var(--hh-ls-eyebrow); text-transform: uppercase; color: var(--hh-text-muted); margin-bottom: 10px; }
        .hiw-title { font-family: var(--hh-font-display); font-size: clamp(36px, 5vw, 62px); font-weight: 350; line-height: 1.05; letter-spacing: -0.03em; color: var(--hh-text); }
        .hiw-title em { font-style: italic; color: var(--hh-primary); }
        .hiw-guide-link { font-size: 14px; font-weight: 500; color: var(--hh-text-muted); text-decoration: none; white-space: nowrap; flex-shrink: 0; padding-bottom: 4px; border-bottom: 1px solid var(--hh-border); transition: color 0.15s, border-color 0.15s; }
        .hiw-guide-link:hover { color: var(--hh-text); border-color: var(--hh-text); }

        .hiw-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
        .hiw-card { background: var(--hh-bg-alt); border-radius: 20px; overflow: hidden; display: flex; flex-direction: column; border: 1px solid var(--hh-border-faint); }
        .hiw-card-top { padding: 28px 28px 24px; flex: 1; }
        .hiw-step-label { display: flex; align-items: center; gap: 6px; margin-bottom: 16px; }
        .hiw-step-word { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--hh-accent); }
        .hiw-step-dot { font-size: 11px; color: var(--hh-accent); }
        .hiw-step-num { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: var(--hh-accent); }
        .hiw-card-title { font-family: var(--hh-font-display); font-size: clamp(20px, 2vw, 26px); font-weight: 400; color: var(--hh-text); letter-spacing: -0.02em; line-height: 1.2; margin-bottom: 12px; }
        .hiw-card-desc { font-size: 14px; line-height: 1.65; color: var(--hh-text-muted); }
        .hiw-illustration { height: 120px; background: repeating-linear-gradient( -45deg, transparent, transparent 6px, rgba(34,40,16,0.04) 6px, rgba(34,40,16,0.04) 12px ); display: flex; align-items: center; justify-content: center; border-top: 1px solid var(--hh-border-faint); }
        .hiw-illustration-label { font-size: 10px; letter-spacing: 0.1em; text-transform: lowercase; color: var(--hh-ink-400); font-weight: 400; }

        /* ── RESPONSIVE ── */
        @media (max-width: 900px) {
          .hero { grid-template-columns: 1fr; gap: 32px; padding: 36px 0 32px; }
          .hero-right { display: none; }
          .sf-bar { grid-template-columns: 1fr 1fr; }
          .sf-field--roommates { border-right: none; }
          .sf-search-btn { grid-column: span 2; border-radius: 0 0 12px 12px; padding: 14px; }
          .ep-grid { grid-template-columns: 1fr; }
          .ep-right-grid { grid-template-columns: 1fr 1fr; }
          .ep-roommates { grid-template-columns: 1fr; gap: 24px; padding: 28px; }
          .hiw-grid { grid-template-columns: 1fr; gap: 12px; }
          .trust-section { grid-template-columns: 1fr; gap: 36px; padding: 36px; }
          .trust-right { grid-template-columns: 1fr 1fr; }
          .rm-inner { grid-template-columns: 1fr; gap: 36px; }
          .rm-card--featured { transform: translateY(0); }
        }
        @media (max-width: 640px) {
          .wrap { padding: 0 16px; }
          .hero-h1 { font-size: 42px; }
          .hero-stats { gap: 20px; }
          .sf-bar { grid-template-columns: 1fr; }
          .sf-field { border-right: none; border-bottom: 1px solid var(--hh-border-faint); }
          .sf-field:last-of-type { border-bottom: none; }
          .sf-search-btn { grid-column: 1; border-radius: 0 0 12px 12px; padding: 14px; }
          .ep-header { flex-direction: column; align-items: flex-start; }
          .ep-right-grid { grid-template-columns: 1fr; }
          .ep-feat-details { flex-direction: column; align-items: flex-start; }
          .trust-right { grid-template-columns: 1fr; }
          .trust-section { padding: 28px 24px; }
          .rm-right { overflow-x: auto; padding-bottom: 12px; scroll-snap-type: x mandatory; }
          .rm-card { min-width: 220px; scroll-snap-align: start; flex-shrink: 0; }
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

        {/* ── LEAD BAND — tight, direct, then straight into listings ── */}
        <div className="lead-band">
          <div className="lead-eyebrow">
            <span className="lead-eyebrow-dot" />
            ASU Tempe · {loading ? '…' : `${properties.length} verified ${properties.length === 1 ? 'home' : 'homes'} live now`}
          </div>
          <h1 className="lead-h1">
            Your next place near ASU —<br />
            <em>found in minutes, not weeks.</em>
          </h1>
          <p className="lead-sub">ID-verified hosts. Real photos. No broker fees. Tap a home to apply in two minutes.</p>
          <div className="lead-chips">
            <a href="/homes" className="lead-chip lead-chip--all">Browse all homes →</a>
            <a href="/homes?price_max=700" className="lead-chip">Under $700</a>
            <a href="/homes?q=furnished" className="lead-chip">Furnished</a>
            <a href="/homes?q=sublease" className="lead-chip">Subleases</a>
            <a href="/homes?q=female" className="lead-chip">Female-only</a>
            <a href="/roommates" className="lead-chip">Find roommates</a>
          </div>
        </div>

        {/* ── LISTINGS GRID — the whole point of the page ── */}
        {loading ? (
          <SkeletonRow />
        ) : properties.length === 0 ? (
          <>
            <div style={{ textAlign: 'center', padding: '80px 20px', marginBottom: '48px' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>🏠</div>
              <div style={{ fontFamily: 'var(--hh-font-display)', fontSize: '22px', fontWeight: 300, color: 'var(--hh-text)', marginBottom: '8px' }}>No listings right now</div>
              <div style={{ fontSize: '14px', color: 'var(--hh-text-muted)' }}>Check back soon — new homes are added regularly.</div>
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
            <div className="lc-grid">
              {gridHomes.map(h => <ListingCard key={h.slug} h={h} />)}
            </div>
            <div style={{ textAlign: 'center', marginTop: 28 }}>
              <a href="/homes" className="lead-chip lead-chip--all">See all {properties.length} homes →</a>
            </div>

            <hr className="section-divider" />

            <TrustSection />

            <HowItWorks />

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

      {/* Full-bleed roommates section */}
      <RoommatesSection />

    </>
  )
}

export default function HomePageClient({ initialProperties }: { initialProperties?: Property[] }) {
  return (
    <Suspense fallback={null}>
      <HomePageInner initialProperties={initialProperties} />
    </Suspense>
  )
}
