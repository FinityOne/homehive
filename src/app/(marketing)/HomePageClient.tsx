'use client'

import '@/styles/brand-tokens.css'
import { Suspense, useState, useEffect } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { getProperties, type Property } from '@/lib/properties'
import { PLANS, formatMonthly } from '@/lib/landlordPlans'
import {
  viewersRightNow,
  nextVisitTick,
  VISIT_TICK_MS,
  COUNT_UP_MS,
  COUNT_UP_RUNWAY,
} from '@/lib/heroActivity'
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
          <div className="ep-eyebrow">Handpicked · Near ASU</div>
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
          <div className="rm-eyebrow">Roommates · ASU students</div>
          <h2 className="rm-title">Find your <em>people,</em><br />not just your place.</h2>
          <p className="rm-desc">
            Verified ASU student profiles, real questionnaires, no swiping theater.
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
        <div className="trust-eyebrow">Why ASU students trust us</div>
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
    desc: 'Filter by distance to ASU, lease length, roommate fit. No fake listings — every host is ID-checked.',
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

// ─── HERO CONTENT ────────────────────────────────────────────────────────────
// The hero holds exactly three things the eye can land on: the headline, the
// one honey CTA, and the photo. The promises that used to be a four-item tick
// list are compressed into the CTA's note — a single quiet line, not a block
// of text competing with the home. If a claim needs a row of its own it goes
// in TrustSection, not here.

// Shortcuts, not calls to action — and they sit *under* the photo, so the
// first screen stays at three things. If one of these ever earns a fill, the
// hero no longer has a single CTA.
const LEAD_SHORTCUTS = [
  { href: '/homes?price_max=700', label: 'Under $700' },
  { href: '/homes?q=furnished',   label: 'Furnished'  },
  { href: '/homes?q=sublease',    label: 'Subleases'  },
  { href: '/homes?q=female',      label: 'Female-only' },
  { href: '/roommates',           label: 'Find roommates' },
]

// ─── HERO FEATURE ────────────────────────────────────────────────────────────
// 80% of this page's traffic is a student looking for a room, so the hero
// leads with one home shot properly: the first thing on the page is the thing
// they came for, at a size they can judge from. The second audience — someone
// with a place to lease — is served by the same band reading busy, which is
// what the activity strip underneath is for.

/**
 * The home the hero features.
 *
 * Pinned to the listing we have full photography for, but as a *preference*,
 * never a hard reference. `properties` has already been filtered to Live,
 * promotable, paid listings, so if that home is marked Rented or its
 * landlord's plan lapses it is simply not in the list and the hero falls back
 * to whatever is featured. Hard-coding a slug and then trusting it is the
 * mistake the listing schema in `page.tsx` was rewritten to stop making.
 */
const HERO_SLUG = 'delrio-house'

export function pickHeroHome(list: Property[]): Property | null {
  return list.find(p => p.slug === HERO_SLUG)
    ?? list.find(p => p.is_featured)
    ?? list[0]
    ?? null
}

/**
 * Visit counter: counts up on first paint, then drifts upward while the tab
 * is open.
 *
 * Renders `target` on the server and on the first client frame, so the figure
 * in the HTML — and the one a visitor with JS off sees — is the real one. The
 * animation only ever runs from just below it.
 */
function LiveVisitCounter({ target }: { target: number }) {
  const [shown, setShown] = useState(target)

  useEffect(() => {
    if (target <= 0) return

    let raf = 0
    let timer = 0
    let live = target

    const drift = () => {
      live = nextVisitTick(live, Math.random())
      setShown(live)
      timer = window.setTimeout(drift, VISIT_TICK_MS)
    }

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      // No count-up sweep, but the number still moves: that part is
      // information, not decoration, so it survives the motion preference.
      // The frame callback only matters if `target` changed after mount —
      // on first mount it is already the rendered value.
      raf = requestAnimationFrame(() => setShown(target))
      timer = window.setTimeout(drift, VISIT_TICK_MS)
    } else {
      const from = Math.max(0, target - COUNT_UP_RUNWAY)
      const begun = performance.now()
      const step = (now: number) => {
        const p = Math.min(1, (now - begun) / COUNT_UP_MS)
        const eased = 1 - Math.pow(1 - p, 3)
        setShown(Math.round(from + (target - from) * eased))
        if (p < 1) raf = requestAnimationFrame(step)
        else timer = window.setTimeout(drift, VISIT_TICK_MS)
      }
      raf = requestAnimationFrame(step)
    }

    return () => { cancelAnimationFrame(raf); window.clearTimeout(timer) }
  }, [target])

  return <span className="hh-live-num">{shown.toLocaleString('en-US')}</span>
}

/**
 * "N browsing now", over the photo.
 *
 * Mounts empty and fills in after hydration on purpose: the figure is modelled
 * from the viewer's local hour, so server-rendering it would both mismatch and
 * freeze one value into the ISR-cached HTML for a minute.
 */
function BrowsingNow() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    const read = () => setCount(viewersRightNow(new Date().getHours(), Math.random()))
    read()
    const id = window.setInterval(read, 9_000)
    return () => window.clearInterval(id)
  }, [])

  if (count === null) return null
  return (
    <span className="hh-now">
      <span className="hh-now-dot" aria-hidden="true" />
      {count} browsing now
    </span>
  )
}

/**
 * The hero's photo, as the backdrop for the whole band.
 *
 * It used to be a card *below* the headline: copy on cream, then a 21:9 shot.
 * That gave the page two focal points competing at the same size, and the one
 * thing a student actually came for — the home — was the one you had to scroll
 * to reach. So the photo is now the surface everything else sits on.
 *
 * Three things this has to get right, and they pull against each other:
 *
 *   1. **Legibility beats the photograph.** Hero shots here are bright skies
 *      and pale stucco, so white text straight onto one is a coin flip. The
 *      scrim is load-bearing, not decorative: a flat wash to hold the headline
 *      plus a heavier foot so the listing bar survives a sunlit pool. Both are
 *      tinted with the brand maroon rather than neutral black, which stops a
 *      cream page from suddenly reading grey.
 *   2. **It must not become a second button.** The band still has exactly ONE
 *      honey element, `.lead-cta`. The photo is loud but inert, and the only
 *      other interactive thing over it is the listing bar's own link — white
 *      glass, never gold.
 *   3. **It is still the LCP element.** Eager, `fetchPriority="high"`, and a
 *      raw `<img>` because these photos are served from an R2 bucket that is
 *      not in next.config's `remotePatterns` — next/image would reject it.
 */
function HeroShotBackdrop({ home }: { home: Property }) {
  const img = home.images?.[0]
  const perRoom = home.rental_mode === 'by_room'
  // Only meaningful when the home is let by the room — a whole-home listing is
  // one unit, and "1 room open" on it reads like a bug.
  const openRooms = perRoom ? Number(home.available) || 0 : 0

  return (
    <div className="hh-shot-bg">
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={img}
          alt={`${home.name} — ${home.beds}-bedroom student home near ASU in Tempe, AZ`}
          fetchPriority="high"
          decoding="async"
        />
      ) : (
        <div className="hh-shot-ph" aria-hidden="true">🏠</div>
      )}

      {/* Rule 1. Two stops in one layer: one gradient cannot both hold a
          centred headline and a bottom bar without crushing the photo's
          midriff, so the wash is flat through the middle and deepens at the
          foot. */}
      <div className="hh-shot-scrim" aria-hidden="true" />

      {/* One row, not two anchored corners: on a phone the left pills and the
          live count were wide enough to sit on top of each other. */}
      <div className="hh-shot-chips">
        <span className="hh-glass">
          <span className="hh-glass-dot" aria-hidden="true" />
          Verified host
        </span>
        {openRooms > 0 && <span className="hh-glass">{openRooms} rooms open</span>}
        <BrowsingNow />
      </div>
    </div>
  )
}

/**
 * The featured listing's facts, along the foot of the hero.
 *
 * A link in its own right rather than making the whole hero clickable: the
 * block above it holds the page's primary CTA, and nesting a button inside an
 * anchor is invalid markup that swallows the tap on a phone.
 */
function HeroShotListing({ home }: { home: Property }) {
  const perRoom = home.rental_mode === 'by_room'
  const distance = Number(home.asu_distance)
  const dist = Number.isFinite(distance) && distance > 0
    ? (distance <= 0.4 ? 'Walk to campus' : `${distance.toFixed(1)} mi to campus`)
    : null
  const meta = [
    home.beds > 0 ? `${home.beds} bd` : null,
    home.baths > 0 ? `${home.baths} ba` : null,
    home.sqft ? `${home.sqft} sqft` : null,
  ].filter(Boolean).join(' · ')

  return (
    <Link href={`/homes/${home.slug}`} className="hh-shot-listing" aria-label={`See ${home.name}`}>
      <span className="hh-shot-listing-text">
        <span className="hh-shot-eyebrow">Featured now · Tempe{dist ? ` · ${dist}` : ''}</span>
        <span className="hh-shot-name">{home.name}</span>
        <span className="hh-shot-row">
          <span className="hh-shot-price">
            <strong>${home.price?.toLocaleString()}</strong>
            <span>/mo{perRoom ? ' per room' : ''}</span>
          </span>
          {meta && <span className="hh-shot-meta">{meta}</span>}
        </span>
      </span>
      <span className="hh-shot-btn">
        See this home
        <span className="lead-cta-arrow" aria-hidden="true">→</span>
      </span>
    </Link>
  )
}

/**
 * The buzz bar under the hero: one moving figure, two counted from live rows
 * (see `platformStats.ts`), and the landlord's way in.
 *
 * A zero means the aggregate could not be read, and a zero reads as "nobody
 * uses this platform", so a figure hides itself rather than printing one.
 * None of these are honey — the band still has exactly one filled CTA.
 */
function LiveActivityStrip({
  visitCount,
  inquiryCount,
  renterCount,
}: {
  visitCount: number
  inquiryCount: number
  renterCount: number
}) {
  const hasAny = visitCount > 0 || inquiryCount > 0 || renterCount > 0
  return (
    <div className="hh-live">
      {hasAny && (
        <div className="hh-live-figures">
          {visitCount > 0 && (
            <div className="hh-live-item">
              <LiveVisitCounter target={visitCount} />
              <span className="hh-live-label">
                <span className="hh-live-dot" aria-hidden="true" />
                visits to HomeHive
              </span>
            </div>
          )}
          {inquiryCount > 0 && (
            <div className="hh-live-item">
              <span className="hh-live-num">{inquiryCount.toLocaleString('en-US')}</span>
              <span className="hh-live-label">inquiries sent to hosts</span>
            </div>
          )}
          {renterCount > 0 && (
            <div className="hh-live-item">
              <span className="hh-live-num">{renterCount.toLocaleString('en-US')}</span>
              <span className="hh-live-label">ASU students house-hunting</span>
            </div>
          )}
        </div>
      )}
      <Link href="/for-landlords" className="hh-live-landlord">
        Own a place near ASU? Get in front of these students
        <span className="lead-cta-arrow" aria-hidden="true">→</span>
      </Link>
    </div>
  )
}

// ─── LIST-YOUR-PLACE CTA ─────────────────────────────────────────────────────
// Rendered in both the empty and populated branches, so it lives here rather
// than inline twice. The price comes from the landlord paywall's own source of
// truth — a hardcoded one drifted into claiming the product was free.
function ListYourPlaceCta() {
  return (
    <div className="list-cta">
      <div>
        <div className="list-cta-eyebrow">For landlords &amp; ASU students subleasing</div>
        <div className="list-cta-title">Have a place near ASU?<br /><em>Get it in front of ASU students.</em></div>
        <div className="list-cta-sub">
          Plans from {formatMonthly(PLANS.starter.priceCents)}. ASU student leads straight to your inbox.
        </div>
      </div>
      <a href="/landlord/signup" className="list-cta-btn">List your place →</a>
    </div>
  )
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
type HomePageProps = {
  initialProperties?: Property[]
  /** Real all-time visits lifted by the hero's floor — see heroActivity.ts. */
  visitCount?: number
  /** Inquiries ever sent through the platform. Counted, never floored. */
  inquiryCount?: number
  /** Distinct renters who have inquired. Counted, never floored. */
  renterCount?: number
}

function HomePageInner({ initialProperties, visitCount = 0, inquiryCount = 0, renterCount = 0 }: HomePageProps) {
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
      getProperties({ marketingOnly: true }).then(data => { setProperties(data); setLoading(false) })
    }
    if (!sessionStorage.getItem('hh_landlord_bar_dismissed')) setShowLandlordBanner(true)
  }, [hasInitial])

  // The hero already shows one home at full size; repeating it as the first
  // card below reads as a bug, so it comes out of the grid.
  const heroHome = pickHeroHome(properties)

  // Listings-first: surface featured, then closest/best-scored homes immediately.
  const gridHomes = properties
    .filter(p => p.slug !== heroHome?.slug)
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
        .landlord-bar { background: var(--hh-accent-wash); border-bottom: 1px solid var(--hh-accent-soft); padding: 9px 24px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: var(--hh-sz-small); color: var(--hh-text-2); position: relative; }
        .landlord-bar a { color: var(--hh-accent-strong); font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }
        .landlord-bar a:hover { color: var(--hh-ink-900); }
        .landlord-bar-close { position: absolute; right: 16px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: var(--hh-text-muted); font-size: 16px; padding: 4px; line-height: 1; }
        .personal-bar { background: var(--hh-surface-dark); padding: 9px 24px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: var(--hh-sz-small); color: var(--hh-ink-300); }
        .personal-bar strong { color: var(--hh-accent); font-weight: 500; }
        .pbar-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--hh-status-live); animation: pulse 2s infinite; flex-shrink: 0; }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.3} }

        /* ── SEARCH BAR ── */
        .search-section { padding: 32px 0 0; }
        .sf-bar { display: grid; grid-template-columns: 1.4fr 1fr 1.2fr 1fr auto; align-items: stretch; background: #fff; border: 1.5px solid var(--hh-border); border-radius: 14px; overflow: visible; box-shadow: 0 2px 16px rgba(31,21,23,0.07); }
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
        .sf-budget-popover { position: absolute; top: calc(100% + 8px); left: 0; min-width: 200px; background: #fff; border: 1.5px solid var(--hh-border); border-radius: 12px; padding: 16px; box-shadow: 0 8px 24px rgba(31,21,23,0.12); z-index: 100; }
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

        /* ── LEAD BAND (what sits under the hero photo) ───────────────────
           Hierarchy here is deliberate and load-bearing: exactly ONE honey
           element across the hero and this band (.lead-cta, up on the photo).
           Everything here — popular searches, the activity strip — is
           deliberately quiet. Don't give the chips a fill.

           The warm radial wash that used to live here is gone: it existed so
           cream-on-cream wouldn't read flat behind the headline, and the
           headline now sits on a photograph. Its cautionary tale is worth
           keeping though — it bled 10% past each edge, which on a phone
           pushed the document wider than the screen and let the whole page
           scroll sideways. That is why .hh-shot reaches full width by
           sitting outside .wrap rather than by any 100vw arithmetic. */
        .lead-band { position: relative; padding: 40px 0 30px; }
        .lead-inner { position: relative; z-index: 1; }

        /* Live inventory — social proof, reads as a status not a button. */
        .lead-live { display: inline-flex; align-items: center; gap: 8px; background: #fff; border: 1px solid var(--hh-border-faint);
          border-radius: 100px; padding: 6px 14px 6px 11px; font-size: 12px; font-weight: 600; letter-spacing: 0.01em;
          color: var(--hh-text-2); box-shadow: var(--hh-shadow-sm); margin-bottom: 18px; }
        .lead-live-dot { position: relative; width: 7px; height: 7px; border-radius: 50%; background: var(--hh-status-live); flex-shrink: 0; }
        .lead-live-dot::after { content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 1px solid var(--hh-status-live);
          animation: livePulse 2.4s ease-out infinite; }
        @keyframes livePulse { 0% { transform: scale(0.6); opacity: 0.9 } 70%,100% { transform: scale(1.5); opacity: 0 } }
        @media (prefers-reduced-motion: reduce) { .lead-live-dot::after { animation: none; opacity: 0.35 } }

        .lead-h1 { font-family: var(--hh-font-display); font-size: clamp(34px, 5vw, 60px); font-weight: 350; line-height: 1.03; letter-spacing: -0.03em; color: var(--hh-text); margin: 0 0 16px; }
        .lead-h1 em { font-style: italic; color: var(--hh-primary); }

        /* ── THE one call to action ── */
        .lead-cta-row { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
        .lead-cta { display: inline-flex; align-items: center; gap: 10px; background: var(--hh-accent); color: var(--hh-ink-900);
          font-family: var(--hh-font-ui); font-size: 16px; font-weight: 700; letter-spacing: -0.01em;
          padding: 16px 28px; border-radius: 100px; border: none; text-decoration: none; white-space: nowrap;
          box-shadow: var(--hh-shadow-cta); transition: background 0.16s, transform 0.16s, box-shadow 0.16s; }
        .lead-cta:hover { background: var(--hh-accent-strong); color: #fff; transform: translateY(-2px); box-shadow: 0 14px 32px -10px rgba(138,90,0,0.75); }
        .lead-cta:active { transform: translateY(0); box-shadow: var(--hh-shadow-sm); }
        .lead-cta:focus-visible { outline: none; box-shadow: var(--hh-ring-accent), var(--hh-shadow-cta); }
        .lead-cta-arrow { display: inline-block; transition: transform 0.16s; }
        .lead-cta:hover .lead-cta-arrow { transform: translateX(3px); }
        .lead-cta-note { font-size: 13px; color: var(--hh-text-muted); }

        /* Secondary action — outline teal, never honey. */
        .lead-cta--ghost { background: transparent; color: var(--hh-primary); border: 1.5px solid var(--hh-border);
          font-size: 15px; padding: 13px 26px; box-shadow: none; }
        .lead-cta--ghost:hover { background: var(--hh-hive-50); color: var(--hh-primary); border-color: var(--hh-primary); box-shadow: none; }

        /* Popular searches — shortcuts, intentionally lighter than the CTA. */
        .lead-jump { margin-top: 26px; display: flex; align-items: center; justify-content: center; gap: 14px; flex-wrap: wrap; }
        .lead-jump-label { font-size: var(--hh-sz-eyebrow); font-weight: var(--hh-wt-eyebrow); letter-spacing: var(--hh-ls-eyebrow); text-transform: uppercase; color: var(--hh-text-placeholder); white-space: nowrap; }
        .lead-chips { display: flex; flex-wrap: wrap; gap: 8px; }
        .lead-chip { display: inline-flex; align-items: center; font-size: 13px; font-weight: 500; color: var(--hh-text-2); background: transparent; border: 1px solid var(--hh-border-faint); border-radius: 100px; padding: 7px 14px; text-decoration: none; transition: color 0.15s, border-color 0.15s, background 0.15s; white-space: nowrap; }
        .lead-chip:hover { background: var(--hh-hive-50); border-color: var(--hh-primary); color: var(--hh-primary); }

        /* ── HERO SHOT (the photograph the pitch is written on) ───────────
           The photo is the hero's surface, not an item inside it. It runs the
           full width of the viewport, the copy sits on top, and the featured
           listing names itself along the foot.

           Everything drawn over it is white, glass, or the one honey CTA —
           nothing else in the band gets a fill, so "what do I click" has a
           single answer even with a loud photograph underneath. */
        .hh-shot { position: relative; isolation: isolate; overflow: hidden;
          /* Tall enough to dominate the first screen, capped so a short laptop
             viewport does not push the listings grid entirely out of sight. */
          min-height: min(78vh, 680px); display: flex; align-items: stretch;
          background: var(--hh-hive-900); }

        /* The photo layer. inset:0 rather than an aspect-ratio box: the
           section's height is set by its content plus the min-height above,
           and the image's job is to fill whatever that comes to. */
        .hh-shot-bg { position: absolute; inset: 0; z-index: 0; }
        .hh-shot-bg img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .hh-shot-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 52px;
          background: linear-gradient(135deg, #F6EBE4 0%, #E3D9D5 100%); }

        /* Load-bearing, not decoration — see HeroShotBackdrop. Maroon-tinted
           so a cream page never reads grey, flat through the middle so the
           photograph survives, heavier at the foot for the listing bar. */
        .hh-shot-scrim { position: absolute; inset: 0;
          background:
            linear-gradient(to top, rgba(28,8,16,0.88) 0%, rgba(28,8,16,0.44) 42%, rgba(28,8,16,0.30) 68%, rgba(28,8,16,0.52) 100%),
            linear-gradient(to right, rgba(28,8,16,0.42) 0%, rgba(28,8,16,0.10) 60%, rgba(28,8,16,0) 100%); }

        /* The 1200px column, re-established inside a full-bleed section. */
        .hh-shot-inner { position: relative; z-index: 2; width: 100%; max-width: 1200px; margin: 0 auto;
          padding: 92px 24px 26px; display: flex; flex-direction: column; justify-content: flex-end; gap: 34px; }
        .hh-shot-head { max-width: 680px; }

        /* Glass pills, top of the photo */
        .hh-shot-chips { position: absolute; top: 18px; left: 50%; transform: translateX(-50%);
          width: 100%; max-width: 1200px; padding: 0 24px; display: flex; gap: 7px; flex-wrap: wrap; z-index: 3; }
        /* Pushed to the far end, and onto its own line once the row wraps. */
        .hh-now { margin-left: auto; }
        .hh-glass, .hh-now { display: inline-flex; align-items: center; gap: 6px; background: rgba(22,32,30,0.72);
          backdrop-filter: blur(10px); color: #fff; font-size: 11.5px; font-weight: 600; letter-spacing: 0.01em;
          padding: 6px 12px; border-radius: 100px; border: 1px solid rgba(255,255,255,0.16); white-space: nowrap; }
        .hh-glass-dot, .hh-now-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--hh-status-live); flex-shrink: 0; }
        .hh-now-dot { position: relative; }
        .hh-now-dot::after { content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 1px solid var(--hh-status-live);
          animation: livePulse 2.4s ease-out infinite; }
        @media (prefers-reduced-motion: reduce) { .hh-now-dot::after { animation: none; opacity: 0.35 } }

        /* ── Copy ON the photograph ───────────────────────────────────────
           The cream-page defaults are dark-on-light and unreadable here, so
           each one gets an --onshot variant rather than being overridden
           globally — .lead-h1 and .lead-live are still used on cream bands
           further down the page. */
        .lead-live--onshot { background: rgba(255,255,255,0.94); border-color: rgba(255,255,255,0.55);
          color: var(--hh-ink-900); backdrop-filter: blur(8px); }
        .lead-h1--onshot { color: #fff; font-size: clamp(36px, 5vw, 64px); text-wrap: balance;
          margin-bottom: 26px; text-shadow: 0 2px 20px rgba(28,8,16,0.4); }
        /* Gold, not maroon. Maroon italic on a dark scrim is near-invisible;
           gold on this depth of scrim clears AA comfortably. The brand rule it
           must not break is the other direction — gold text never goes on a
           LIGHT band, where it is 1.6:1. */
        .lead-h1--onshot em { color: var(--hh-accent); }
        .lead-cta-note--onshot { color: rgba(255,255,255,0.86); }

        /* ── The featured listing, along the foot ─────────────────────────
           White glass, never gold: the honey CTA above it has to stay the
           only filled action in the band. */
        .hh-shot-listing { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px 24px;
          flex-wrap: wrap; text-decoration: none; color: #fff; padding-top: 20px;
          border-top: 1px solid rgba(255,255,255,0.22); transition: border-color 0.18s; }
        .hh-shot-listing:hover { border-top-color: rgba(255,255,255,0.45); }
        .hh-shot-listing:focus-visible { outline: none; box-shadow: var(--hh-ring-accent); border-radius: 10px; }
        .hh-shot-listing-text { display: flex; flex-direction: column; min-width: 0; }
        .hh-shot-eyebrow { font-size: 10.5px; font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase;
          color: rgba(255,255,255,0.78); margin-bottom: 7px; }
        .hh-shot-name { font-family: var(--hh-font-display); font-size: clamp(22px, 2.5vw, 32px); font-weight: 400;
          line-height: 1.12; letter-spacing: -0.02em; color: #fff; }
        .hh-shot-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 10px; }
        .hh-shot-price { font-size: 14px; color: rgba(255,255,255,0.82); }
        .hh-shot-price strong { font-size: 21px; font-weight: 700; color: #fff; letter-spacing: -0.02em; }
        .hh-shot-meta { font-size: 13px; color: rgba(255,255,255,0.78); }
        .hh-shot-btn { flex-shrink: 0; display: inline-flex; align-items: center; gap: 7px; background: rgba(255,255,255,0.95);
          color: var(--hh-ink-900); font-size: 13px; font-weight: 700; padding: 11px 19px; border-radius: 100px;
          transition: background 0.16s; }
        .hh-shot-listing:hover .hh-shot-btn { background: #fff; }
        .hh-shot-listing:hover .hh-shot-btn .lead-cta-arrow { transform: translateX(3px); }

        /* ── ACTIVITY STRIP — the "this place is busy" bar ── */
        .hh-live { display: flex; align-items: center; justify-content: space-between; gap: 20px 32px; flex-wrap: wrap;
          margin-top: 38px; padding-top: 22px; border-top: 1px solid var(--hh-border-faint); }
        .hh-live-figures { display: flex; align-items: flex-start; gap: 34px; flex-wrap: wrap; }
        .hh-live-item { display: flex; flex-direction: column; gap: 3px; }
        .hh-live-num { font-family: var(--hh-font-display); font-size: 27px; font-weight: 400; line-height: 1;
          letter-spacing: -0.03em; color: var(--hh-text); font-variant-numeric: tabular-nums; }
        .hh-live-label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--hh-text-muted); }
        .hh-live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--hh-status-live); flex-shrink: 0; }
        .hh-live-landlord { display: inline-flex; align-items: center; gap: 7px; font-size: 13.5px; font-weight: 600;
          color: var(--hh-primary); text-decoration: none; border-bottom: 1px solid transparent; transition: border-color 0.15s; }
        .hh-live-landlord:hover { border-bottom-color: var(--hh-primary); }
        .hh-live-landlord:hover .lead-cta-arrow { transform: translateX(3px); }

        /* ── LISTINGS GRID ── */
        .lc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 24px 20px; }
        .lc-card { text-decoration: none; color: inherit; display: flex; flex-direction: column; transition: transform 0.18s; }
        .lc-card:hover { transform: translateY(-3px); }
        .lc-media { position: relative; aspect-ratio: 4 / 3; border-radius: 16px; overflow: hidden; background: var(--hh-bg-alt); box-shadow: var(--hh-shadow-sm); transition: box-shadow 0.18s; }
        .lc-card:hover .lc-media { box-shadow: var(--hh-shadow-md); }
        .lc-media img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.4s ease; }
        .lc-card:hover .lc-media img { transform: scale(1.045); }
        .lc-media-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 40px; background: linear-gradient(135deg, #F6EBE4 0%, #E3D9D5 100%); }
        .lc-badge { position: absolute; left: 12px; bottom: 12px; background: rgba(74,15,34,0.84); backdrop-filter: blur(8px); color: #fff; font-size: 11px; font-weight: 600; padding: 5px 11px; border-radius: 100px; }
        .lc-type { position: absolute; top: 12px; left: 12px; background: var(--hh-accent); color: #1F1517; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; padding: 4px 9px; border-radius: 6px; }
        .lc-body { padding: 12px 4px 4px; }
        .lc-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
        .lc-name { font-size: 15px; font-weight: 600; color: var(--hh-text); line-height: 1.3; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: color 0.15s; }
        .lc-card:hover .lc-name { color: var(--hh-primary); }
        .lc-score { flex-shrink: 0; font-size: 13px; font-weight: 600; color: var(--hh-text); }
        .lc-meta { font-size: 13px; color: var(--hh-text-muted); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lc-price { font-size: 14px; color: var(--hh-text); margin-top: 8px; }
        .lc-price strong { font-size: 17px; font-weight: 700; }
        .lc-price span { color: var(--hh-text-muted); font-size: 13px; }
        @media (max-width: 600px) {
          .lc-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 18px 12px; }
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
        .ep-featured { text-decoration: none; color: inherit; display: flex; flex-direction: column; background: #fff; border-radius: 18px; overflow: hidden; border: 1px solid var(--hh-border-faint); box-shadow: 0 2px 12px rgba(31,21,23,0.07); transition: box-shadow 0.2s, transform 0.2s; }
        .ep-featured:hover { box-shadow: 0 12px 40px rgba(31,21,23,0.13); transform: translateY(-2px); }

        .ep-feat-img { position: relative; aspect-ratio: 4/3; overflow: hidden; background: #c8c5bc; }
        .ep-feat-img img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.5s; }
        .ep-featured:hover .ep-feat-img img { transform: scale(1.04); }
        .ep-feat-img-ph { width: 100%; height: 100%; background: linear-gradient(135deg, #C9BDBA 0%, #A8938F 50%, #C9BDBA 100%); display: flex; align-items: center; justify-content: center; }
        .ep-feat-img-ph span { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.5); font-weight: 500; }

        /* Badges */
        .ep-feat-badges { position: absolute; top: 16px; left: 16px; display: flex; gap: 8px; align-items: center; }
        .ep-verified-pill { display: inline-flex; align-items: center; gap: 5px; background: rgba(255,255,255,0.92); backdrop-filter: blur(8px); border-radius: 100px; padding: 5px 11px; font-size: 11px; font-weight: 600; color: #1F1517; border: 1px solid rgba(255,255,255,0.5); }
        .ep-verified-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--hh-accent-strong); flex-shrink: 0; }
        .ep-editors-pick { display: inline-flex; align-items: center; background: rgba(36,10,19,0.88); backdrop-filter: blur(8px); border-radius: 100px; padding: 5px 12px; font-size: 11px; font-weight: 600; color: #fff; }

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
        .ep-mini-card { text-decoration: none; color: inherit; background: #fff; border-radius: 14px; overflow: hidden; border: 1px solid var(--hh-border-faint); box-shadow: 0 1px 6px rgba(31,21,23,0.06); transition: box-shadow 0.2s, transform 0.2s; display: flex; flex-direction: column; }
        .ep-mini-card:hover { box-shadow: 0 8px 24px rgba(31,21,23,0.11); transform: translateY(-2px); }
        .ep-mini-img { position: relative; aspect-ratio: 4/3; overflow: hidden; background: #b8b5ae; }
        .ep-mini-img img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.4s; }
        .ep-mini-card:hover .ep-mini-img img { transform: scale(1.06); }
        .ep-mini-img-ph { width: 100%; height: 100%; background: linear-gradient(135deg, #A8938F 0%, #C9BDBA 100%); display: flex; align-items: center; justify-content: center; }
        .ep-mini-img-ph span { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.45); }
        .ep-mini-verified { position: absolute; top: 8px; left: 8px; display: inline-flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.88); backdrop-filter: blur(6px); border-radius: 100px; padding: 3px 9px; font-size: 10px; font-weight: 600; color: #1F1517; }
        .ep-mini-vdot { width: 6px; height: 6px; border-radius: 50%; background: var(--hh-accent-strong); flex-shrink: 0; }
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
        .ep-rm-badge { display: inline-block; font-size: 11px; font-weight: 700; background: rgba(255,198,39,0.15); color: var(--hh-accent); border: 1px solid rgba(255,198,39,0.3); border-radius: 100px; padding: 4px 12px; margin-bottom: 16px; }
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
        .list-cta { background: var(--hh-surface-dark); border-radius: 16px; padding: 44px; display: flex; align-items: center; justify-content: space-between; gap: 28px; margin-bottom: 64px; flex-wrap: wrap; }
        .list-cta-eyebrow { font-size: var(--hh-sz-eyebrow); font-weight: var(--hh-wt-eyebrow); letter-spacing: var(--hh-ls-eyebrow); text-transform: uppercase; color: rgba(255,255,255,0.35); margin-bottom: 10px; }
        .list-cta-title { font-family: var(--hh-font-display); font-size: 30px; font-weight: 300; color: #fff; letter-spacing: -0.5px; line-height: 1.15; }
        .list-cta-title em { font-style: italic; color: var(--hh-accent); }
        .list-cta-sub { font-size: var(--hh-sz-small); color: rgba(255,255,255,0.45); margin-top: 8px; }
        .list-cta-btn { background: var(--hh-accent); color: var(--hh-ink-900); font-size: 15px; font-weight: 700; padding: 15px 30px; border-radius: 100px; text-decoration: none; white-space: nowrap; font-family: var(--hh-font-ui); box-shadow: var(--hh-shadow-cta); transition: background 0.15s, transform 0.15s, box-shadow 0.15s; flex-shrink: 0; }
        .list-cta-btn:hover { background: var(--hh-accent-strong); color: #fff; transform: translateY(-1px); }

        /* ── SHIMMER ── */
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

        /* ── ROOMMATES SECTION ── */
        .rm-section { background: var(--hh-surface-tint); padding: 72px 24px; border-top: 1px solid rgba(140,29,64,0.10); }
        .rm-inner { max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1.6fr; gap: 64px; align-items: center; }
        .rm-eyebrow { font-size: var(--hh-sz-eyebrow); font-weight: var(--hh-wt-eyebrow); letter-spacing: var(--hh-ls-eyebrow); text-transform: uppercase; color: var(--hh-primary); margin-bottom: 16px; opacity: 0.8; }
        .rm-title { font-family: var(--hh-font-display); font-size: clamp(36px, 4.5vw, 58px); font-weight: 350; line-height: 1.05; letter-spacing: -0.03em; color: var(--hh-text); margin-bottom: 18px; }
        .rm-title em { font-style: italic; color: var(--hh-text); }
        .rm-desc { font-size: 15px; line-height: 1.7; color: var(--hh-text-muted); margin-bottom: 32px; max-width: 380px; }
        .rm-btns { display: flex; gap: 10px; flex-wrap: wrap; }
        .rm-btn-primary { display: inline-flex; align-items: center; background: var(--hh-surface-dark); color: #fff; font-size: 13px; font-weight: 600; padding: 11px 22px; border-radius: 100px; text-decoration: none; transition: background 0.15s, transform 0.15s; }
        .rm-btn-primary:hover { background: var(--hh-primary); transform: translateY(-1px); }
        .rm-btn-ghost { display: inline-flex; align-items: center; background: transparent; color: var(--hh-text-2); font-size: 13px; font-weight: 500; padding: 11px 22px; border-radius: 100px; border: 1.5px solid rgba(31,21,23,0.2); text-decoration: none; transition: border-color 0.15s, color 0.15s; }
        .rm-btn-ghost:hover { border-color: var(--hh-text); color: var(--hh-text); }

        /* Cards row */
        .rm-right { display: flex; gap: 12px; align-items: flex-start; padding-top: 16px; }
        .rm-card { background: #fff; border-radius: 18px; overflow: hidden; flex: 1; box-shadow: var(--hh-shadow-md); transition: transform 0.2s, box-shadow 0.2s; }
        .rm-card:hover { transform: translateY(-4px); box-shadow: var(--hh-shadow-lg); }
        .rm-card--featured { transform: translateY(-12px); box-shadow: var(--hh-shadow-lg); }
        .rm-card--featured:hover { transform: translateY(-16px); }

        /* Photo area */
        .rm-card-photo { position: relative; aspect-ratio: 3/4; display: flex; align-items: flex-end; justify-content: flex-start; padding: 12px; }
        .rm-card-photo-label { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.5); font-weight: 400; }
        .rm-verified-pill { position: absolute; top: 10px; right: 10px; display: inline-flex; align-items: center; gap: 5px; background: rgba(255,255,255,0.9); backdrop-filter: blur(6px); border-radius: 100px; padding: 4px 10px; font-size: 10px; font-weight: 600; color: #1F1517; }
        .rm-verified-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--hh-accent); flex-shrink: 0; }

        /* Card body */
        .rm-card-body { padding: 16px 16px 14px; }
        .rm-card-name { font-family: var(--hh-font-display); font-size: 18px; font-weight: 500; color: var(--hh-text); letter-spacing: -0.02em; margin-bottom: 4px; }
        .rm-card-meta { font-size: 11px; color: var(--hh-text-muted); margin-bottom: 10px; line-height: 1.4; }
        .rm-card-quote { font-size: 12px; line-height: 1.6; color: var(--hh-text-2); margin-bottom: 14px; }
        .rm-say-hi { display: block; text-align: center; background: #fff; border: 1.5px solid var(--hh-border); border-radius: 100px; padding: 8px 0; font-size: 13px; font-weight: 500; color: var(--hh-text); text-decoration: none; transition: background 0.15s, border-color 0.15s; }
        .rm-say-hi:hover { background: var(--hh-hive-50); border-color: var(--hh-primary); color: var(--hh-primary); }

        /* ── TRUST SECTION ── */
        .trust-section { display: grid; grid-template-columns: 1fr 1.4fr; gap: 64px; align-items: center; background: var(--hh-surface-dark); border-radius: 24px; padding: 56px 56px 56px 52px; margin-bottom: 72px; }
        .trust-eyebrow { font-size: var(--hh-sz-eyebrow); font-weight: var(--hh-wt-eyebrow); letter-spacing: var(--hh-ls-eyebrow); text-transform: uppercase; color: var(--hh-accent); margin-bottom: 18px; opacity: 0.9; }
        .trust-title { font-family: var(--hh-font-display); font-size: clamp(38px, 4.5vw, 60px); font-weight: 350; line-height: 1.05; letter-spacing: -0.03em; color: #fff; margin-bottom: 20px; }
        .trust-title em { font-style: italic; color: var(--hh-accent); }
        .trust-desc { font-size: 15px; line-height: 1.7; color: rgba(255,255,255,0.5); margin-bottom: 32px; max-width: 360px; }
        .trust-btns { display: flex; gap: 10px; flex-wrap: wrap; }
        .trust-btn-primary { display: inline-flex; align-items: center; background: var(--hh-accent); color: var(--hh-ink-900); font-size: 13px; font-weight: 700; padding: 11px 22px; border-radius: 100px; text-decoration: none; transition: background 0.15s, transform 0.15s; }
        .trust-btn-primary:hover { background: var(--hh-accent-strong); color: #fff; transform: translateY(-1px); }
        .trust-btn-ghost { display: inline-flex; align-items: center; background: transparent; color: rgba(255,255,255,0.7); font-size: 13px; font-weight: 500; padding: 11px 22px; border-radius: 100px; border: 1.5px solid rgba(255,255,255,0.18); text-decoration: none; transition: border-color 0.15s, color 0.15s; }
        .trust-btn-ghost:hover { border-color: rgba(255,255,255,0.4); color: #fff; }

        .trust-right { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .trust-card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 24px 22px 26px; transition: background 0.15s; }
        .trust-card:hover { background: rgba(255,255,255,0.08); }
        .trust-card-num { width: 32px; height: 32px; border-radius: 50%; background: rgba(255,198,39,0.15); border: 1px solid rgba(255,198,39,0.25); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: var(--hh-accent); margin-bottom: 16px; letter-spacing: 0.05em; }
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
        .hiw-card { background: var(--hh-bg-alt); border-radius: 20px; overflow: hidden; display: flex; flex-direction: column; border: 1px solid var(--hh-border-faint); transition: border-color 0.18s, box-shadow 0.18s; }
        .hiw-card:hover { border-color: var(--hh-accent-soft); box-shadow: var(--hh-shadow-sm); }
        .hiw-card-top { padding: 28px 28px 24px; flex: 1; }
        .hiw-step-label { display: flex; align-items: center; gap: 6px; margin-bottom: 16px; }
        .hiw-step-word { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--hh-accent-strong); }
        .hiw-step-dot { font-size: 11px; color: var(--hh-accent-strong); }
        .hiw-step-num { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: var(--hh-accent-strong); }
        .hiw-card-title { font-family: var(--hh-font-display); font-size: clamp(20px, 2vw, 26px); font-weight: 400; color: var(--hh-text); letter-spacing: -0.02em; line-height: 1.2; margin-bottom: 12px; }
        .hiw-card-desc { font-size: 14px; line-height: 1.65; color: var(--hh-text-muted); }
        .hiw-illustration { height: 120px; background: repeating-linear-gradient( -45deg, transparent, transparent 6px, rgba(31,21,23,0.04) 6px, rgba(31,21,23,0.04) 12px ); display: flex; align-items: center; justify-content: center; border-top: 1px solid var(--hh-border-faint); }
        .hiw-illustration-label { font-size: 10px; letter-spacing: 0.1em; text-transform: lowercase; color: var(--hh-ink-400); font-weight: 400; }

        /* ── RESPONSIVE ── */
        @media (max-width: 1000px) {
          .hh-shot { min-height: min(72vh, 600px); }
          .hh-shot-inner { gap: 26px; padding-top: 84px; }
          .hh-live-figures { gap: 26px; }
        }

        @media (max-width: 900px) {
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
          /* One CTA, full width — the easiest thing on the screen to hit. */
          .lead-band { padding: 30px 0 22px; }
          .lead-cta-row { gap: 12px; }
          .lead-cta { width: 100%; justify-content: center; font-size: 15px; padding: 15px 22px; }
          .lead-cta-note { width: 100%; text-align: center; }

          /* The hero keeps its full-bleed photo on a phone — it is the whole
             point of it — but the gutters come in to match .wrap and the
             scrim gets heavier: the copy covers proportionally more of a
             portrait crop, so there is less photograph left to protect. */
          .hh-shot { min-height: min(84vh, 620px); }
          .hh-shot-inner { padding: 72px 16px 22px; gap: 22px; }
          .hh-shot-chips { padding: 0 16px; top: 14px; }
          .hh-shot-scrim {
            background:
              linear-gradient(to top, rgba(28,8,16,0.90) 0%, rgba(28,8,16,0.60) 46%, rgba(28,8,16,0.46) 72%, rgba(28,8,16,0.60) 100%); }
          .lead-h1--onshot { font-size: 34px; margin-bottom: 20px; }
          .lead-cta-note--onshot { text-align: center; }

          /* Button under the facts, full width — a 13px pill pushed to the
             far end of a wrapped row is a thumb-sized miss on a phone. */
          .hh-shot-listing { align-items: stretch; gap: 16px; }
          .hh-shot-btn { width: 100%; justify-content: center; padding: 13px 19px; font-size: 14px; }
          .hh-shot-row { gap: 10px; }
          .hh-live { margin-top: 28px; gap: 16px 22px; }
          .hh-live-figures { gap: 18px; width: 100%; }
          .hh-live-num { font-size: 22px; }
          .hh-live-label { font-size: 11.5px; }
          .lead-jump { flex-direction: column; align-items: flex-start; gap: 10px; }
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
          /* This was a space-between row at every width, so on a phone the
             pitch and the full-width button fought over the same line. */
          .list-cta { padding: 28px 24px; flex-direction: column; align-items: stretch; gap: 20px; }
          .list-cta-title { font-size: 24px; }
          .list-cta-btn { width: 100%; text-align: center; }

          /* Announcement bars: let the copy wrap and keep the close button
             out of the text rather than centred on top of it. */
          .landlord-bar, .personal-bar { padding: 10px 40px 10px 16px; text-align: center; line-height: 1.45; }
          .landlord-bar { position: relative; flex-wrap: wrap; }
          .landlord-bar-close { position: absolute; top: 50%; right: 12px; transform: translateY(-50%); }

          /* Thumb-sized chips — 13px text in a hairline border is a 26px target. */
          .lead-chip { min-height: 40px; padding-left: 14px; padding-right: 14px; }
        }
      `}</style>

      {/* LANDLORD BANNER */}
      {showLandlordBanner && (
        <div className="landlord-bar">
          🏠 Listing your place? Skip Zillow — get ASU student leads on HomeHive.{' '}
          <a href="/for-landlords">Plans from {formatMonthly(PLANS.starter.priceCents)} →</a>
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

      {/* ── HERO — one photograph, with the pitch written on it ──
           Deliberately OUTSIDE `.wrap`, so the photo runs edge to edge
           instead of stopping at a 1200px column with cream either side. Its
           own content re-establishes that column inside (`.hh-shot-inner`),
           which is why this is a sibling of `.wrap` rather than a child
           escaping it with negative margins or `100vw` — that trick measures
           the viewport *including* the scrollbar and is exactly what once let
           this page scroll sideways on a phone. See `.lead-band`. */}
      <section className="hh-shot">
        {heroHome
          ? <HeroShotBackdrop home={heroHome} />
          /* No listing to show: the band keeps its shape and its gradient
             rather than collapsing the headline onto bare cream. */
          : <div className="hh-shot-bg"><div className="hh-shot-ph" aria-hidden="true">🏠</div><div className="hh-shot-scrim" aria-hidden="true" /></div>}

        <div className="hh-shot-inner">
          {/* The pitch and the single action, as one short block. Short on
              purpose: every line here is a line of photograph it covers. */}
          <div className="hh-shot-head">
            <div className="lead-live lead-live--onshot">
              <span className="lead-live-dot" aria-hidden="true" />
              {loading
                ? 'Verified homes for ASU students · Tempe'
                : `${properties.length} verified ${properties.length === 1 ? 'home' : 'homes'} live for ASU students`}
            </div>
            <h1 className="lead-h1 lead-h1--onshot">
              Housing near ASU,<br />
              <em>found in minutes.</em>
            </h1>

            <div className="lead-cta-row">
              <Link href="/homes" className="lead-cta">
                <span>{loading || properties.length === 0 ? 'Browse verified homes' : `Browse ${properties.length} verified homes`}</span>
                <span className="lead-cta-arrow" aria-hidden="true">→</span>
              </Link>
              <span className="lead-cta-note lead-cta-note--onshot">ID-verified hosts · no broker fees · free for students</span>
            </div>
          </div>

          {/* The home this photograph actually is, named at its foot. */}
          {heroHome && <HeroShotListing home={heroHome} />}
        </div>
      </section>

      <div className="wrap">

        <div className="lead-band">
          {/* Below the photo: navigation, then the busy bar. */}
          <div className="lead-inner">
            <div className="lead-jump">
              <span className="lead-jump-label">Popular right now</span>
              <div className="lead-chips">
                {LEAD_SHORTCUTS.map(c => (
                  <Link key={c.href} href={c.href} className="lead-chip">{c.label}</Link>
                ))}
              </div>
            </div>

            <LiveActivityStrip
              visitCount={visitCount}
              inquiryCount={inquiryCount}
              renterCount={renterCount}
            />
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
            <ListYourPlaceCta />
          </>
        ) : (
          <>
            <div className="lc-grid">
              {gridHomes.map(h => <ListingCard key={h.slug} h={h} />)}
            </div>
            <div style={{ textAlign: 'center', marginTop: 28 }}>
              <Link href="/homes" className="lead-cta lead-cta--ghost">
                <span>See all {properties.length} homes</span>
                <span className="lead-cta-arrow" aria-hidden="true">→</span>
              </Link>
            </div>

            <hr className="section-divider" />

            <TrustSection />

            <HowItWorks />

            <ListYourPlaceCta />
          </>
        )}

      </div>

      {/* Full-bleed roommates section */}
      <RoommatesSection />

    </>
  )
}

export default function HomePageClient(props: HomePageProps) {
  return (
    <Suspense fallback={null}>
      <HomePageInner {...props} />
    </Suspense>
  )
}
