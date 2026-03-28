'use client'

import { useState, use, useEffect, useRef } from 'react'
import { usePostHog } from 'posthog-js/react'
import { createBrowserClient } from '@supabase/ssr'
import { getPropertyBySlug, Property } from '@/lib/properties'
import { notFound } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Platform-wide amenity icons mapped to common tag keywords
const TAG_ICONS: Record<string, string> = {
  wifi: '⚡', internet: '⚡', 'high-speed': '⚡',
  washer: '🧺', laundry: '🧺', 'in-unit': '🧺',
  ac: '❄️', 'air conditioning': '❄️', heat: '❄️',
  parking: '🚗', garage: '🚗',
  pet: '🐾', pets: '🐾', 'pet friendly': '🐾',
  furnished: '🛋️', furniture: '🛋️',
  pool: '🏊', jacuzzi: '🛁', hottub: '🛁',
  gym: '💪', fitness: '💪',
  yard: '🌿', garden: '🌿', backyard: '🌿',
  dishwasher: '🍽️',
  balcony: '🏠', patio: '🏠',
  study: '📚',
}

function tagIcon(tag: string): string {
  const lower = tag.toLowerCase()
  for (const [key, icon] of Object.entries(TAG_ICONS)) {
    if (lower.includes(key)) return icon
  }
  return '✓'
}

// Availability urgency config
function availabilityConfig(available: number, total: number) {
  if (available === 0) return { color: '#6b7280', bg: '#f3f4f6', text: 'Join waitlist', urgent: false }
  if (available === 1) return { color: '#dc2626', bg: '#fef2f2', text: '⚡ Last room — act fast', urgent: true }
  if (available === 2) return { color: '#d97706', bg: '#fffbeb', text: `⚠ Only 2 rooms left`, urgent: true }
  return { color: '#16a34a', bg: '#f0fdf4', text: `${available} of ${total} rooms available`, urgent: false }
}

export default function PropertyPageClient({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ name?: string; msg?: string; from?: string }>
}) {
  const { slug } = use(params)
  const resolvedSearch = use(searchParams)

  // ── All hooks unconditionally at the top ─────────────────────────────────
  const [home, setHome] = useState<Property | null | undefined>(undefined)
  const [activePhoto, setActivePhoto] = useState(0)
  const [formData, setFormData] = useState({ first_name: '', email: '', phone: '', move_in_date: '' })
  const [loggedInUser, setLoggedInUser] = useState<{ name: string; email: string; phone: string; avatarUrl: string | null } | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [mobileFormOpen, setMobileFormOpen] = useState(false)
  const [showStickyBar, setShowStickyBar] = useState(false)
  const [badgeHover, setBadgeHover] = useState(false)
  const [landlordProfile, setLandlordProfile] = useState<{ first_name: string | null; avatar_url: string | null } | null>(null)
  const titleRef = useRef<HTMLDivElement>(null)

  const ph = usePostHog()

  const guestName   = resolvedSearch?.name || ''
  const customMsg   = resolvedSearch?.msg  || ''
  const fromName    = resolvedSearch?.from || 'Heran'
  const isPersonalized = !!guestName

  useEffect(() => {
    getPropertyBySlug(slug).then(p => setHome(p ?? null))
  }, [slug])

  useEffect(() => {
    if (!home?.owner_id) return
    fetch(`/api/profiles/${home.owner_id}/public`)
      .then(r => r.json())
      .then(data => { if (data.first_name) setLandlordProfile(data) })
      .catch(() => {})
  }, [home?.owner_id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!home) return
    ph?.capture('property_viewed', {
      property_slug: slug,
      property_name: home.name,
      property_price: home.price,
      beds: home.beds,
      baths: home.baths,
      available_rooms: home.available,
      is_personalized: isPersonalized,
    })
  }, [home]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (guestName) {
      setFormData(prev => ({ ...prev, first_name: guestName.trim().split(' ')[0] || '' }))
    }
  }, [guestName])

  // Pre-fill form for logged-in users
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, phone, avatar_url')
        .eq('id', session.user.id)
        .single()
      const fullName = profile?.full_name || session.user.user_metadata?.full_name || ''
      const firstName = fullName.trim().split(/\s+/)[0] || ''
      const phone = profile?.phone || ''
      const avatarUrl = profile?.avatar_url || null
      setLoggedInUser({ name: fullName, email: session.user.email || '', phone, avatarUrl })
      setFormData(prev => ({
        ...prev,
        first_name: firstName || prev.first_name,
        email: session.user.email || prev.email,
        phone: phone || prev.phone,
      }))
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Show sticky mobile bar once user scrolls past the title
  useEffect(() => {
    const onScroll = () => {
      const titleBottom = titleRef.current?.getBoundingClientRect().bottom ?? 0
      setShowStickyBar(titleBottom < 0)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // ── Loading / not-found guards ────────────────────────────────────────────
  if (home === undefined) {
    return (
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px 24px' }}>
        <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
        <div style={{ height: '28px', width: '30%', borderRadius: '6px', marginBottom: '20px', background: 'linear-gradient(90deg,#f0ede6 25%,#faf9f6 50%,#f0ede6 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s infinite' }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '28px' }}>
          <div style={{ height: '500px', borderRadius: '16px', background: 'linear-gradient(90deg,#f0ede6 25%,#faf9f6 50%,#f0ede6 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s infinite' }} />
          <div style={{ height: '460px', borderRadius: '16px', background: 'linear-gradient(90deg,#f0ede6 25%,#faf9f6 50%,#f0ede6 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s infinite' }} />
        </div>
      </div>
    )
  }

  if (home === null) return notFound()

  // ── Derived values ────────────────────────────────────────────────────────
  const allImages  = home.images.filter(Boolean)
  const mainImage  = allImages[activePhoto] ?? ''
  const avail      = availabilityConfig(home.available, home.total_rooms)
  const isPopular  = (home.asu_score ?? 0) >= 8
  const canSubmit  = formData.first_name.trim() !== '' && formData.email.trim() !== ''

  const listingTypeCfg = home.listing_type === 'sublease'
    ? { label: 'Sublease', color: '#6d28d9', bg: '#f5f3ff', border: '#ddd6fe' }
    : home.listing_type === 'lease_transfer'
      ? { label: 'Lease Transfer', color: '#0f766e', bg: '#f0fdfa', border: '#99f6e4' }
      : { label: 'Whole Home', color: '#1e40af', bg: '#eff6ff', border: '#bfdbfe' }
  const ctaCopy    = formData.first_name.trim()
    ? `Check availability for ${formData.first_name.trim().split(' ')[0]} →`
    : 'Check Availability →'

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, property: slug }),
      })
      if (res.ok) {
        ph?.capture('inquiry_submitted', {
          property_slug: slug,
          property_name: home?.name,
          move_in_date: formData.move_in_date,
          is_personalized: isPersonalized,
        })
        setSubmitted(true)
        setMobileFormOpen(false)
      }
    } catch (e) { console.error(e) }
    setSubmitting(false)
  }

  // ── Form JSX (shared between sidebar + mobile drawer) ────────────────────
  const FormContent = () => submitted ? (
    <div style={{ textAlign: 'center', padding: '28px 8px' }}>
      <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#f0fdf4', border: '2px solid #bbf7d0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', margin: '0 auto 16px' }}>✓</div>
      <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: '22px', color: '#1a1a1a', marginBottom: '8px' }}>You're on the list!</div>
      <p style={{ fontSize: '13px', color: '#6b6b6b', lineHeight: 1.6 }}>Check your email — we sent you next steps. We'll be in touch within a few hours.</p>
    </div>
  ) : (
    <>
      {/* Price header */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '2px' }}>
          <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: '30px', color: '#1a1a1a', letterSpacing: '-0.5px' }}>${home.price.toLocaleString()}</span>
          <span style={{ fontSize: '13px', color: '#9b9b9b' }}>/mo per room</span>
        </div>
        <div style={{ fontSize: '12px', color: '#6b6b6b' }}>Est. all-in: <strong style={{ color: '#1a1a1a' }}>${home.price + 65}–${home.price + 140}/mo</strong> <span style={{ color: '#c5c1b8' }}>incl. utilities</span></div>
      </div>

      {/* Availability badge */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: avail.bg, color: avail.color, fontSize: '12px', fontWeight: 600, padding: '5px 12px', borderRadius: '20px', marginBottom: '14px', animation: avail.urgent ? 'pulse 2s infinite' : 'none' }}>
        {avail.text}
      </div>

      {/* Social signals */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '18px' }}>
        {isPopular && (
          <div style={{ fontSize: '11px', color: '#92400e', background: '#fef3c7', padding: '3px 9px', borderRadius: '20px', fontWeight: 500 }}>
            🔥 Popular listing
          </div>
        )}
        <div style={{ fontSize: '11px', color: '#1d4ed8', background: '#eff6ff', padding: '3px 9px', borderRadius: '20px', fontWeight: 500 }}>
          ⚡ Replies within 2 hrs
        </div>
      </div>

      <div style={{ height: '1px', background: '#f0ede6', marginBottom: '18px' }} />

      {/* Form fields */}
      {loggedInUser ? (
        /* ── Logged-in: compact pre-filled form ── */
        <div style={{ marginBottom: '14px' }}>
          {/* Identity row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#f5f4f0', border: '1px solid #e8e5de', borderRadius: '10px', padding: '10px 14px', marginBottom: '12px' }}>
            {loggedInUser.avatarUrl ? (
              <img src={loggedInUser.avatarUrl} alt={loggedInUser.name} style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#8C1D40', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700, flexShrink: 0 }}>
                {(loggedInUser.name || loggedInUser.email)[0].toUpperCase()}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {loggedInUser.name || 'You'}
              </div>
              <div style={{ fontSize: '11px', color: '#9b9b9b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {loggedInUser.email}
              </div>
            </div>
            <span style={{ fontSize: '10px', fontWeight: 700, color: '#16a34a', background: '#dcfce7', padding: '2px 7px', borderRadius: '4px', flexShrink: 0 }}>Verified ✓</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Phone — only show if not on profile */}
            {!loggedInUser.phone && (
              <input
                name="phone"
                type="tel"
                placeholder="Phone number (optional)"
                value={formData.phone}
                onChange={handleChange}
                style={{ width: '100%', padding: '11px 14px', border: '1.5px solid #e8e5de', borderRadius: '9px', fontSize: '14px', fontFamily: "'DM Sans', sans-serif", outline: 'none', transition: 'border-color 0.15s', boxSizing: 'border-box' }}
                onFocus={e => e.target.style.borderColor = '#8C1D40'}
                onBlur={e => e.target.style.borderColor = '#e8e5de'}
              />
            )}
            {/* Move-in date — always shown */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b6b6b', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>When do you want to move in?</div>
              <input
                name="move_in_date"
                type="date"
                value={formData.move_in_date}
                onChange={handleChange}
                min={new Date().toISOString().split('T')[0]}
                style={{ width: '100%', padding: '11px 14px', border: '1.5px solid #e8e5de', borderRadius: '9px', fontSize: '14px', fontFamily: "'DM Sans', sans-serif", outline: 'none', color: formData.move_in_date ? '#1a1a1a' : '#a0a0a0', background: '#fff', boxSizing: 'border-box' }}
                onFocus={e => e.target.style.borderColor = '#8C1D40'}
                onBlur={e => e.target.style.borderColor = '#e8e5de'}
              />
            </div>
          </div>
        </div>
      ) : (
        /* ── Guest: full form ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
          <input
            name="first_name"
            placeholder="Your first name *"
            value={formData.first_name}
            onChange={handleChange}
            autoFocus={!isPersonalized}
            style={{ width: '100%', padding: '11px 14px', border: `1.5px solid ${formData.first_name ? '#1a1a1a' : '#e8e5de'}`, borderRadius: '9px', fontSize: '14px', fontFamily: "'DM Sans', sans-serif", outline: 'none', transition: 'border-color 0.15s', boxSizing: 'border-box' }}
            onFocus={e => e.target.style.borderColor = '#8C1D40'}
            onBlur={e => e.target.style.borderColor = formData.first_name ? '#1a1a1a' : '#e8e5de'}
          />
          <input
            name="email"
            type="email"
            placeholder="Email address *"
            value={formData.email}
            onChange={handleChange}
            style={{ width: '100%', padding: '11px 14px', border: `1.5px solid ${formData.email ? '#1a1a1a' : '#e8e5de'}`, borderRadius: '9px', fontSize: '14px', fontFamily: "'DM Sans', sans-serif", outline: 'none', transition: 'border-color 0.15s', boxSizing: 'border-box' }}
            onFocus={e => e.target.style.borderColor = '#8C1D40'}
            onBlur={e => e.target.style.borderColor = formData.email ? '#1a1a1a' : '#e8e5de'}
          />
          <input
            name="phone"
            type="tel"
            placeholder="Phone (optional)"
            value={formData.phone}
            onChange={handleChange}
            style={{ width: '100%', padding: '11px 14px', border: '1.5px solid #e8e5de', borderRadius: '9px', fontSize: '14px', fontFamily: "'DM Sans', sans-serif", outline: 'none', transition: 'border-color 0.15s', boxSizing: 'border-box' }}
            onFocus={e => e.target.style.borderColor = '#8C1D40'}
            onBlur={e => e.target.style.borderColor = '#e8e5de'}
          />
          <input
            name="move_in_date"
            type="date"
            value={formData.move_in_date}
            onChange={handleChange}
            min={new Date().toISOString().split('T')[0]}
            style={{ width: '100%', padding: '11px 14px', border: '1.5px solid #e8e5de', borderRadius: '9px', fontSize: '14px', fontFamily: "'DM Sans', sans-serif", outline: 'none', color: formData.move_in_date ? '#1a1a1a' : '#a0a0a0', background: '#fff', boxSizing: 'border-box' }}
            onFocus={e => e.target.style.borderColor = '#8C1D40'}
            onBlur={e => e.target.style.borderColor = '#e8e5de'}
          />
        </div>
      )}

      {/* CTA Button — gold always, never grey */}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        style={{
          width: '100%', padding: '15px', border: 'none', borderRadius: '9px',
          background: '#FFC627',
          color: '#1a1a1a', fontSize: '15px', fontWeight: 800,
          cursor: submitting ? 'wait' : 'pointer',
          fontFamily: "'DM Sans', sans-serif",
          transition: 'transform 0.1s, box-shadow 0.2s, opacity 0.2s',
          letterSpacing: '0.1px',
          opacity: canSubmit ? 1 : 0.72,
          boxShadow: canSubmit ? '0 4px 20px rgba(255,198,39,0.45)' : 'none',
          animation: canSubmit && !submitting ? 'goldPulse 2.8s ease-in-out infinite' : 'none',
        }}
        onMouseEnter={e => { if (!submitting) { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 28px rgba(255,198,39,0.55)' } }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = canSubmit ? '0 4px 20px rgba(255,198,39,0.45)' : 'none' }}
        onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(1px)' }}
        onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)' }}
      >
        {submitting ? 'Submitting…' : ctaCopy}
      </button>

      {/* Trust row */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', marginTop: '10px', flexWrap: 'wrap' }}>
        {['No spam', 'No commitment', 'Tours available'].map(t => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#9b9b9b' }}>
            <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#d4a843' }} />
            {t}
          </div>
        ))}
      </div>
    </>
  )

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; background: #f5f4f0; color: #1a1a1a; }

        .prop-page    { max-width: 1200px; margin: 0 auto; padding: 28px 24px 120px; }
        .breadcrumb   { font-size: 12px; color: #9b9b9b; margin-bottom: 16px; }
        .breadcrumb a { color: #9b9b9b; text-decoration: none; }
        .breadcrumb a:hover { color: #1a1a1a; }

        /* ── SPLIT LAYOUT ───────────────────────────────── */
        .prop-split   { display: grid; grid-template-columns: 1fr 360px; gap: 32px; align-items: start; margin-top: 24px; }
        .prop-left    { min-width: 0; }
        .prop-right   { position: sticky; top: 88px; }

        /* ── GALLERY ────────────────────────────────────── */
        .gallery-hero { position: relative; border-radius: 16px; overflow: hidden; height: 440px; cursor: pointer; background: #e8e4db; margin-bottom: 8px; }
        .gallery-hero img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.5s ease; }
        .gallery-hero:hover img { transform: scale(1.015); }
        .gallery-hero-overlay { position: absolute; inset: 0; background: linear-gradient(to bottom, transparent 60%, rgba(0,0,0,0.35)); pointer-events: none; }
        .gallery-count { position: absolute; bottom: 14px; right: 14px; background: rgba(0,0,0,0.65); color: #fff; font-size: 12px; font-weight: 600; padding: 5px 12px; border-radius: 20px; backdrop-filter: blur(4px); cursor: pointer; border: 1px solid rgba(255,255,255,0.2); transition: background 0.15s; }
        .gallery-count:hover { background: rgba(0,0,0,0.85); }

        .gallery-strip { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; scroll-snap-type: x mandatory; }
        .gallery-strip::-webkit-scrollbar { height: 3px; }
        .gallery-strip::-webkit-scrollbar-thumb { background: #d4c9b0; border-radius: 10px; }
        .gallery-thumb { flex-shrink: 0; width: 90px; height: 66px; border-radius: 8px; overflow: hidden; cursor: pointer; border: 2px solid transparent; transition: border-color 0.15s, opacity 0.15s; scroll-snap-align: start; opacity: 0.7; }
        .gallery-thumb.active { border-color: #8C1D40; opacity: 1; }
        .gallery-thumb:hover { opacity: 1; }
        .gallery-thumb img { width: 100%; height: 100%; object-fit: cover; }

        /* ── CONTENT SECTIONS ───────────────────────────── */
        .section      { background: #fff; border-radius: 14px; padding: 24px; margin-top: 16px; border: 1px solid #e8e5de; }
        .section-label{ font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: #d4a843; margin-bottom: 14px; }

        .stats-row    { display: flex; border: 1px solid #e8e5de; border-radius: 10px; overflow: hidden; margin-bottom: 16px; }
        .stat-item    { flex: 1; padding: 14px 10px; text-align: center; border-right: 1px solid #e8e5de; }
        .stat-item:last-child { border-right: none; }
        .stat-num     { font-family: 'DM Serif Display', serif; font-size: 22px; color: #1a1a1a; }
        .stat-lbl     { font-size: 11px; color: #9b9b9b; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.4px; }

        .tags-wrap     { display: flex; flex-wrap: wrap; gap: 8px; }
        .tag-pill      { display: flex; align-items: center; gap: 6px; padding: 7px 13px; background: #faf9f6; border: 1px solid #e8e5de; border-radius: 20px; font-size: 13px; color: #3a3a3a; }

        .pain-list    { display: flex; flex-direction: column; gap: 10px; }
        .pain-item    { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; background: #faf9f6; border-radius: 8px; border: 1px solid #e8e5de; }
        .pain-dot     { width: 7px; height: 7px; border-radius: 50%; background: #d4a843; flex-shrink: 0; margin-top: 7px; }
        .pain-text    { font-size: 14px; color: #3a3a3a; line-height: 1.65; }

        .pricing-row  { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f0ede6; font-size: 14px; }
        .pricing-row:last-of-type { border-bottom: none; }
        .pricing-label{ color: #6b6b6b; }
        .pricing-val  { font-weight: 500; }
        .pricing-val.green { color: #16a34a; }
        .pricing-total{ display: flex; justify-content: space-between; padding-top: 13px; margin-top: 6px; border-top: 2px solid #1a1a1a; font-size: 16px; font-weight: 600; }

        .map-wrap     { border-radius: 10px; overflow: hidden; border: 1px solid #e8e5de; margin-bottom: 12px; }
        .nearby-grid  { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .nearby-item  { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #faf9f6; border-radius: 8px; border: 1px solid #e8e5de; }
        .nearby-place { font-size: 13px; color: #3a3a3a; }
        .nearby-time  { font-size: 12px; color: #d4a843; font-weight: 500; }

        .testimonial  { padding: 16px 18px; background: #faf9f6; border-radius: 10px; border: 1px solid #e8e5de; border-left: 3px solid #d4a843; margin-bottom: 10px; }
        .testimonial-quote  { font-size: 14px; color: #3a3a3a; line-height: 1.65; font-style: italic; margin-bottom: 6px; }
        .testimonial-author { font-size: 12px; color: #9b9b9b; font-weight: 500; }

        /* ── FORM CARD (right column) ───────────────────── */
        .form-card    { background: #fff; border-radius: 16px; padding: 22px; border: 1px solid #e8e5de; box-shadow: 0 4px 24px rgba(0,0,0,0.06); }

        /* ── MOBILE STICKY BAR ──────────────────────────── */
        .mobile-sticky-bar {
          display: none;
          position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;
          background: #fff; border-top: 1px solid #e8e5de;
          padding: 12px 20px 20px;
          box-shadow: 0 -8px 32px rgba(0,0,0,0.1);
        }
        .mobile-bar-inner { display: flex; align-items: center; gap: 12px; }
        .mobile-bar-price { flex-shrink: 0; }
        .mobile-bar-cta { flex: 1; padding: 14px; background: #FFC627; color: #1a1a1a; border: none; border-radius: 10px; font-size: 15px; font-weight: 800; cursor: pointer; font-family: 'DM Sans', sans-serif; letter-spacing: 0.1px; box-shadow: 0 4px 16px rgba(255,198,39,0.4); }

        /* ── MOBILE FORM DRAWER ─────────────────────────── */
        .drawer-backdrop { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 200; backdrop-filter: blur(2px); }
        .drawer-backdrop.open { display: block; }
        .drawer { position: fixed; bottom: 0; left: 0; right: 0; z-index: 201; background: #fff; border-radius: 20px 20px 0 0; padding: 24px 20px 40px; max-height: 90vh; overflow-y: auto; transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.32,0.72,0,1); }
        .drawer.open { transform: translateY(0); }
        .drawer-handle { width: 36px; height: 4px; background: #e8e4db; border-radius: 10px; margin: 0 auto 20px; }

        /* ── ANIMATIONS ─────────────────────────────────── */
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes goldPulse { 0%,100%{box-shadow:0 4px 20px rgba(255,198,39,0.45)} 50%{box-shadow:0 4px 32px rgba(255,198,39,0.75)} }

        /* ── RESPONSIVE ─────────────────────────────────── */
        @media (max-width: 860px) {
          .prop-split { grid-template-columns: 1fr; }
          .prop-right { display: none; }
          .mobile-sticky-bar { display: block; }
          .gallery-hero { height: 300px; }
          .nearby-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 500px) {
          .prop-page { padding: 16px 16px 100px; }
          .gallery-hero { height: 240px; border-radius: 12px; }
          .stats-row { flex-wrap: wrap; }
          .stat-item { min-width: 50%; border-bottom: 1px solid #e8e5de; }
        }
      `}</style>

      <div className="prop-page">

        {/* PERSONALIZED BANNER */}
        {isPersonalized && (
          <div style={{ background: 'linear-gradient(135deg,#1a1a1a 0%,#2d2410 100%)', borderRadius: '14px', padding: '24px 28px', marginBottom: '24px', border: '1px solid #d4a843', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: '-40px', right: '-40px', width: '180px', height: '180px', borderRadius: '50%', background: 'radial-gradient(circle,rgba(212,168,67,0.15) 0%,transparent 70%)', pointerEvents: 'none' }} />
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(212,168,67,0.15)', border: '1px solid rgba(212,168,67,0.4)', borderRadius: '20px', padding: '4px 12px', marginBottom: '12px' }}>
              <span style={{ fontSize: '10px', color: '#d4a843', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' }}>✦ Picked for you</span>
            </div>
            <div style={{ fontFamily: 'DM Serif Display, serif', fontSize: '24px', color: '#fff', lineHeight: 1.2, marginBottom: '8px' }}>
              {guestName}, this one's yours.<br /><span style={{ color: '#d4a843' }}>{customMsg || 'Spots fill up fast — we saved it for you.'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginTop: '14px', paddingTop: '14px', borderTop: '1px solid rgba(212,168,67,0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#d4a843', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 600, color: '#1a1a1a', flexShrink: 0 }}>{fromName[0].toUpperCase()}</div>
                <div>
                  <div style={{ fontSize: '13px', color: '#fff', fontWeight: 500 }}>{fromName} from HomeHive</div>
                  <div style={{ fontSize: '11px', color: '#9b9b9b' }}>Sent this listing just for you</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(220,252,231,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '20px', padding: '5px 12px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'pulse 2s infinite' }} />
                <span style={{ fontSize: '12px', color: '#86efac', fontWeight: 500 }}>{home.available} room{home.available !== 1 ? 's' : ''} open</span>
              </div>
            </div>
          </div>
        )}

        {/* BACK LINK — subtle, won't compete with the form */}
        <a
          href="/homes"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '13px', color: '#b0a898', textDecoration: 'none', marginBottom: '10px', transition: 'color 0.15s' }}
          onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.color = '#6b6b6b'}
          onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.color = '#b0a898'}
        >
          <span style={{ fontSize: '15px', lineHeight: 1 }}>←</span> All homes
        </a>

        {/* BREADCRUMB */}
        <div className="breadcrumb">
          <a href="/">HomeHive</a> › <a href="/homes">Homes</a> › <strong>{home.name}</strong>
        </div>

        {/* TITLE ROW */}
        <div ref={titleRef}>
          <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 'clamp(26px,4vw,38px)', color: '#1a1a1a', lineHeight: 1.15, marginBottom: '8px' }}>{home.name}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14px', color: '#6b6b6b' }}>📍 {home.address}</span>
            <span style={{ fontSize: '11px', fontWeight: 600, padding: '4px 10px', borderRadius: '6px', background: listingTypeCfg.bg, color: listingTypeCfg.color, border: `1px solid ${listingTypeCfg.border}`, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: listingTypeCfg.color, display: 'inline-block', flexShrink: 0 }} />
              {listingTypeCfg.label}
            </span>
            <span
              style={{ position: 'relative', display: 'inline-block' }}
              onMouseEnter={() => setBadgeHover(true)}
              onMouseLeave={() => setBadgeHover(false)}
            >
              <span style={{ fontSize: '11px', fontWeight: 700, padding: '4px 11px', borderRadius: '20px', background: '#8C1D40', color: '#fff', border: '1px solid #7a1835', cursor: 'default', letterSpacing: '0.2px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                ✓ HomeHive Verified
              </span>
              {badgeHover && (
                <div style={{ position: 'absolute', top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', background: '#fff', border: '1px solid #e8e5de', borderRadius: '10px', padding: '12px 14px', boxShadow: '0 8px 28px rgba(0,0,0,0.12)', zIndex: 50, minWidth: '220px', pointerEvents: 'none' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#8C1D40', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px' }}>What this means</div>
                  {[
                    'Zero-tolerance scam policy',
                    'Every listing manually reviewed',
                    'Landlord identity verified',
                  ].map(item => (
                    <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', color: '#3a3a3a', marginBottom: '5px' }}>
                      <span style={{ color: '#16a34a', fontWeight: 700, flexShrink: 0 }}>✓</span>
                      {item}
                    </div>
                  ))}
                </div>
              )}
            </span>
            <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '20px', background: avail.bg, color: avail.color, animation: avail.urgent ? 'pulse 2s infinite' : 'none' }}>{avail.text}</span>
          </div>
        </div>

        {/* ── SPLIT LAYOUT ────────────────────────────────── */}
        <div className="prop-split">

          {/* LEFT — gallery + all details */}
          <div className="prop-left">

            {/* GALLERY */}
            <div style={{ marginTop: '20px' }}>
              <div className="gallery-hero">
                {mainImage && <img src={mainImage} alt={home.name} />}
                <div className="gallery-hero-overlay" />
                {allImages.length > 1 && (
                  <div className="gallery-count" onClick={() => {}}>
                    🖼 {allImages.length} photos
                  </div>
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
            <div className="section" style={{ marginTop: '20px' }}>
              <div className="section-label">Property Overview</div>
              <div className="stats-row">
                {([
                  [String(home.beds), 'Beds'],
                  [String(home.baths), 'Baths'],
                  ...(home.sqft?.trim() ? [[home.sqft, 'Sq Ft']] : []),
                  [`${home.asu_distance ?? '?'} mi`, 'To ASU'],
                ] as [string, string][]).map(([n, l]) => (
                  <div className="stat-item" key={l}>
                    <div className="stat-num">{n}</div>
                    <div className="stat-lbl">{l}</div>
                  </div>
                ))}
              </div>
              {/* Tags / features */}
              {home.tags.length > 0 && (
                <div className="tags-wrap">
                  {home.tags.map(tag => (
                    <div key={tag} className="tag-pill">
                      <span>{tagIcon(tag)}</span>
                      <span>{tag}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* SUBLEASE / LEASE TRANSFER DATES */}
            {(home.listing_type === 'sublease' || home.listing_type === 'lease_transfer') &&
              (home.sublease_start_date || home.sublease_end_date) && (
              <div className="section" style={{ background: listingTypeCfg.bg, border: `1px solid ${listingTypeCfg.border}` }}>
                <div className="section-label" style={{ color: listingTypeCfg.color }}>
                  {home.listing_type === 'lease_transfer' ? 'Lease Transfer Period' : 'Sublease Period'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {home.sublease_start_date && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: listingTypeCfg.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Available From</span>
                      <span style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', fontFamily: "'DM Serif Display', serif" }}>
                        {new Date(home.sublease_start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                  )}
                  {home.sublease_start_date && home.sublease_end_date && (
                    <span style={{ fontSize: '20px', color: listingTypeCfg.color, fontWeight: 300, margin: '0 4px' }}>→</span>
                  )}
                  {home.sublease_end_date && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: listingTypeCfg.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {home.listing_type === 'lease_transfer' ? 'Lease Ends' : 'Sublease Ends'}
                      </span>
                      <span style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', fontFamily: "'DM Serif Display', serif" }}>
                        {new Date(home.sublease_end_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* DESCRIPTION */}
            {home.description && (
              <div className="section">
                <div className="section-label">About this home</div>
                <p style={{ fontSize: '14px', color: '#3a3a3a', lineHeight: 1.75 }}>{home.description}</p>
              </div>
            )}

            {/* ASU HIGHLIGHTS */}
            {home.asu_reasons.length > 0 && (
              <div className="section">
                <div className="section-label">Why ASU students love it</div>
                <div className="pain-list">
                  {home.asu_reasons.map((text, i) => (
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
                ['Monthly rent (per room)', `$${home.price.toLocaleString()}`, false],
                ['Utilities (water, electric, gas)', 'Included', true],
                ['High-speed WiFi', 'Included', true],
                ['Move-in fee', '$0', true],
                ['Broker / agency fee', '$0', true],
                ['Security deposit',
                  home.security_deposit === 0 ? '$0 — No deposit required' :
                  home.security_deposit != null ? `$${home.security_deposit.toLocaleString()} (refundable)` :
                  `$${home.price.toLocaleString()} (refundable)`,
                  home.security_deposit === 0],
              ].map(([l, v, g]) => (
                <div className="pricing-row" key={String(l)}>
                  <span className="pricing-label">{l}</span>
                  <span className={`pricing-val${g ? ' green' : ''}`}>{v}</span>
                </div>
              ))}
              <div className="pricing-total">
                <span>Total to move in</span>
                <span>
                  {home.security_deposit === 0
                    ? `$${home.price.toLocaleString()}`
                    : `$${(home.price + (home.security_deposit ?? home.price)).toLocaleString()}`}
                </span>
              </div>
              <p style={{ fontSize: '12px', color: '#9b9b9b', marginTop: '10px', lineHeight: 1.5 }}>The price you see is the price you pay. No hidden charges at signing. Deposit fully refunded at move-out.</p>
            </div>

            {/* LOCATION */}
            {home.map_embed_url && (
              <div className="section">
                <div className="section-label">Location</div>
                <div className="map-wrap">
                  <iframe src={home.map_embed_url} style={{ width: '100%', height: '220px', border: 'none', display: 'block' }} loading="lazy" />
                </div>
                {home.nearby.length > 0 && (
                  <div className="nearby-grid">
                    {home.nearby.map(n => (
                      <div className="nearby-item" key={n.place}>
                        <span className="nearby-place">{n.place}</span>
                        <span className="nearby-time">{n.travel_time}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TESTIMONIALS — platform social proof, always shown */}
            <div className="section">
              <div className="section-label">What students say</div>
              {[
                { q: 'Found my roommates through HomeHive before I even moved in. So much less stressful than scrolling Facebook groups for weeks.', a: 'Sofia M. — ASU Junior, Psychology' },
                { q: 'The price I saw was exactly what I paid. No surprise fees at signing — first time that\'s ever happened renting near campus.', a: 'Marcus T. — ASU Grad Student, Engineering' },
              ].map(({ q, a }) => (
                <div className="testimonial" key={a}>
                  <p className="testimonial-quote">"{q}"</p>
                  <p className="testimonial-author">— {a}</p>
                </div>
              ))}
            </div>

          </div>{/* /prop-left */}

          {/* RIGHT — sticky form card */}
          <div className="prop-right">

            {/* Posted by landlord */}
            {landlordProfile && (
              <div style={{ background: '#fff', border: '1px solid #e8e5de', borderRadius: '12px', padding: '12px 16px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                {landlordProfile.avatar_url ? (
                  <img src={landlordProfile.avatar_url} alt={landlordProfile.first_name ?? ''} style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid #e8e5de' }} />
                ) : (
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#8C1D40', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                    {(landlordProfile.first_name ?? '?')[0].toUpperCase()}
                  </div>
                )}
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>Posted by {landlordProfile.first_name}</div>
                  <div style={{ fontSize: '11px', color: '#9b9b9b', marginTop: '1px' }}>HomeHive verified member</div>
                </div>
              </div>
            )}

            <div className="form-card">
              {FormContent()}
            </div>

            {/* HomeHive Promise */}
            <div style={{ background: '#1a1a1a', borderRadius: '14px', padding: '18px 20px', marginTop: '12px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: '#d4a843', marginBottom: '8px' }}>The HomeHive Promise</div>
              <p style={{ fontSize: '13px', color: '#c5c1b8', lineHeight: 1.65 }}>We match you with homes and housemates that fit your life — your schedule, your major, your vibe. No surprises, no runaround.</p>
              <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #2a2a2a', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <span style={{ fontSize: '14px', flexShrink: 0, marginTop: '1px' }}>🔍</span>
                <p style={{ fontSize: '12px', color: '#a09890', lineHeight: 1.6 }}>Every listing is manually reviewed — we verify ownership and check for red flags before it goes live. No ghost listings, no scams.</p>
              </div>
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
      </div>{/* /prop-page */}

      {/* ── MOBILE STICKY BAR ─────────────────────────── */}
      <div className="mobile-sticky-bar" style={{ transform: showStickyBar || mobileFormOpen ? 'translateY(0)' : 'translateY(100%)', transition: 'transform 0.3s cubic-bezier(0.32,0.72,0,1)' }}>
        {submitted ? (
          <div style={{ textAlign: 'center', padding: '8px 0', fontSize: '14px', fontWeight: 600, color: '#16a34a' }}>✓ You're on the list! Check your email.</div>
        ) : (
          <div className="mobile-bar-inner">
            <div className="mobile-bar-price">
              <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: '22px', color: '#1a1a1a', lineHeight: 1 }}>${home.price.toLocaleString()}</div>
              <div style={{ fontSize: '11px', color: '#9b9b9b' }}>/mo per room</div>
            </div>
            <button className="mobile-bar-cta" onClick={() => setMobileFormOpen(true)}>
              Check Availability →
            </button>
          </div>
        )}
      </div>

      {/* ── MOBILE FORM DRAWER ────────────────────────── */}
      <div className={`drawer-backdrop${mobileFormOpen ? ' open' : ''}`} onClick={() => setMobileFormOpen(false)} />
      <div className={`drawer${mobileFormOpen ? ' open' : ''}`}>
        <div className="drawer-handle" />
        <div style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>{home.name}</div>
        <div style={{ fontSize: '12px', color: '#9b9b9b', marginBottom: '20px' }}>📍 {home.address}</div>
        {FormContent()}
      </div>
    </>
  )
}
