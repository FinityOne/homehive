'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── TYPES ────────────────────────────────────────────────────────────────────
type InterestStatus = 'inquired' | 'contacted' | 'tour_scheduled' | 'touring' | 'offer_sent'

const STATUS_CONFIG: Record<InterestStatus, { label: string; color: string; bg: string; border: string; icon: string }> = {
  inquired:       { label: 'Inquired',       color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe', icon: '📩' },
  contacted:      { label: 'Contacted',      color: '#c9973a', bg: '#fefce8', border: '#fde68a', icon: '📞' },
  tour_scheduled: { label: 'Tour Scheduled', color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', icon: '📅' },
  touring:        { label: 'Touring',        color: '#166534', bg: '#f0fdf4', border: '#bbf7d0', icon: '🏠' },
  offer_sent:     { label: 'Offer Sent',     color: '#fff',    bg: '#8C1D40', border: '#8C1D40', icon: '🎉' },
}

type InterestedHome = {
  slug: string
  name: string
  address: string
  price: number
  beds: number
  image: string
  status: InterestStatus
  submittedDate: string
  moveIn: string
  nextStep: string
}

// ─── FAKE DATA ────────────────────────────────────────────────────────────────
const FAKE_INTERESTS: InterestedHome[] = [
  {
    slug: 'palace-jacuzzi',
    name: 'University Dr Palace w/ Jacuzzi',
    address: '820 W 9th Street, Tempe, AZ 85281',
    price: 699,
    beds: 6,
    image: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80',
    status: 'tour_scheduled',
    submittedDate: '2 days ago',
    moveIn: 'Aug 2025',
    nextStep: 'Tour on Saturday, Mar 22 at 2:00 PM',
  },
  {
    slug: 'delrio-house',
    name: 'ASU Student Castle',
    address: '110 W Del Rio Dr, Tempe, AZ 85282',
    price: 599,
    beds: 5,
    image: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&q=80',
    status: 'contacted',
    submittedDate: '5 days ago',
    moveIn: 'Aug 2025',
    nextStep: 'We reached out — check your email for details.',
  },
]

const AVAILABLE_HOMES = [
  {
    slug: 'palace-jacuzzi',
    name: 'University Dr Palace w/ Jacuzzi',
    address: '820 W 9th St, Tempe',
    price: 699,
    beds: 6,
    baths: 4,
    available: 6,
    asuDistance: '0.2',
    tags: ['Jacuzzi', 'WiFi', 'Parking', 'Washer/Dryer'],
    image: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80',
  },
  {
    slug: 'delrio-house',
    name: 'ASU Student Castle',
    address: '110 W Del Rio Dr, Tempe',
    price: 599,
    beds: 5,
    baths: 2,
    available: 5,
    asuDistance: '1.1',
    tags: ['WiFi', 'Backyard', 'Pet Friendly', 'A/C'],
    image: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&q=80',
  },
]

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getGreeting(name: string) {
  const h = new Date().getHours()
  if (h < 12) return `Good morning, ${name}`
  if (h < 17) return `Good afternoon, ${name}`
  return `Good evening, ${name}`
}

// The "most urgent" item across inquiries — drives the action strip
const UPCOMING_TOUR = FAKE_INTERESTS.find(h => h.status === 'tour_scheduled')

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function TenantDashboard() {
  const router = useRouter()
  const [userName, setUserName] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/login'); return }
      const name = data.user.user_metadata?.full_name?.split(' ')[0] || 'there'
      setUserName(name)
      setLoading(false)
    })
  }, [router])

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: '#9b9b9b' }}>
        Loading...
      </div>
    )
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,300;1,9..144,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .db-wrap { max-width: 680px; margin: 0 auto; padding: 32px 16px 80px; font-family: 'DM Sans', sans-serif; }

        /* ── GREETING ── */
        .greeting-row { margin-bottom: 6px; }
        .greeting-text { font-family: 'Fraunces', serif; font-size: 30px; font-weight: 300; color: #1a1a1a; letter-spacing: -0.5px; line-height: 1.2; }
        .greeting-sub { font-size: 13px; color: #9b9b9b; margin-top: 5px; }

        /* ── ACTION STRIP ── */
        .action-strip { background: #fff; border: 1px solid #e8e4db; border-left: 3px solid #FFC627; border-radius: 10px; padding: 13px 16px; margin: 20px 0 32px; display: flex; align-items: center; gap: 12px; }
        .action-strip-icon { font-size: 18px; flex-shrink: 0; }
        .action-strip-body { flex: 1; min-width: 0; }
        .action-strip-title { font-size: 13px; font-weight: 600; color: #1a1a1a; }
        .action-strip-sub { font-size: 12px; color: #9b9b9b; margin-top: 2px; }
        .action-strip-cta { flex-shrink: 0; background: #8C1D40; color: #fff; border: none; border-radius: 7px; padding: 8px 14px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; white-space: nowrap; }

        /* ── SECTION ── */
        .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .section-title { font-size: 11px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.8px; }
        .section-link { font-size: 12px; color: #8C1D40; font-weight: 500; text-decoration: none; }
        .section-link:hover { text-decoration: underline; }

        /* ── INTEREST CARD ── */
        .icard { background: #fff; border: 1px solid #e8e4db; border-radius: 14px; overflow: hidden; margin-bottom: 10px; }
        .icard-inner { display: flex; flex-direction: column; }
        .icard-img { width: 100%; height: 150px; object-fit: cover; display: block; }
        .icard-body { padding: 14px 16px; }
        .icard-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 8px; }
        .icard-name { font-size: 14px; font-weight: 600; color: #1a1a1a; line-height: 1.3; }
        .icard-addr { font-size: 11px; color: #9b9b9b; margin-top: 2px; }
        .icard-price { font-size: 15px; font-weight: 700; color: #8C1D40; white-space: nowrap; }
        .icard-price span { font-size: 10px; font-weight: 400; color: #9b9b9b; }
        .status-pill { display: inline-flex; align-items: center; gap: 4px; border-radius: 20px; padding: 3px 9px; font-size: 11px; font-weight: 600; border: 1px solid; margin-bottom: 9px; }
        .next-step-box { background: #faf9f6; border-left: 3px solid #FFC627; border-radius: 0 7px 7px 0; padding: 9px 12px; font-size: 12px; color: #4a4a4a; line-height: 1.5; }
        .next-step-label { font-size: 10px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }
        .icard-actions { display: flex; gap: 8px; margin-top: 11px; }
        .btn-p { flex: 1; background: #8C1D40; color: #fff; border: none; border-radius: 8px; padding: 9px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; text-align: center; text-decoration: none; display: block; }
        .btn-s { flex: 1; background: #fff; color: #1a1a1a; border: 1.5px solid #e8e4db; border-radius: 8px; padding: 9px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; text-align: center; text-decoration: none; display: block; }

        /* ── HOME CARD ── */
        .hcard { background: #fff; border: 1px solid #e8e4db; border-radius: 14px; overflow: hidden; margin-bottom: 10px; }
        .hcard-img { width: 100%; height: 170px; object-fit: cover; display: block; }
        .hcard-body { padding: 14px 16px; }
        .hcard-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 7px; }
        .hcard-name { font-size: 14px; font-weight: 600; color: #1a1a1a; line-height: 1.3; }
        .hcard-addr { font-size: 11px; color: #9b9b9b; margin-top: 2px; }
        .hcard-price { font-size: 17px; font-weight: 700; color: #8C1D40; white-space: nowrap; }
        .hcard-price span { font-size: 10px; font-weight: 400; color: #9b9b9b; }
        .hcard-stats { display: flex; gap: 12px; margin-bottom: 9px; }
        .hcard-stat { font-size: 11px; color: #6b6b6b; }
        .hcard-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 11px; }
        .hcard-tag { background: #faf9f6; border: 1px solid #e8e4db; border-radius: 20px; padding: 2px 8px; font-size: 10px; color: #4a4a4a; }
        .avail-pill { display: inline-flex; align-items: center; gap: 4px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 20px; padding: 2px 8px; font-size: 10px; color: #166534; font-weight: 600; }
        .avail-dot { width: 5px; height: 5px; border-radius: 50%; background: #16a34a; }

        /* ── DIVIDER ── */
        .section-gap { margin-bottom: 32px; }

        @media (min-width: 560px) {
          .icard-inner { flex-direction: row; }
          .icard-img { width: 140px; height: auto; flex-shrink: 0; }
          .icard-body { flex: 1; }
          .greeting-text { font-size: 34px; }
        }
      `}</style>

      <div className="db-wrap">

        {/* ── GREETING ── */}
        <div className="greeting-row">
          <div className="greeting-text">{getGreeting(userName)} 👋</div>
          <div className="greeting-sub">
            {FAKE_INTERESTS.length > 0
              ? `You have ${FAKE_INTERESTS.length} active ${FAKE_INTERESTS.length === 1 ? 'inquiry' : 'inquiries'} · Fall 2025`
              : 'Start your housing search for Fall 2025'}
          </div>
        </div>

        {/* ── ACTION STRIP ── */}
        {UPCOMING_TOUR && (
          <div className="action-strip">
            <span className="action-strip-icon">📅</span>
            <div className="action-strip-body">
              <div className="action-strip-title">Upcoming tour — {UPCOMING_TOUR.name.split(' ').slice(0, 3).join(' ')}</div>
              <div className="action-strip-sub">{UPCOMING_TOUR.nextStep}</div>
            </div>
            <a href={`/homes/${UPCOMING_TOUR.slug}`} className="action-strip-cta">View listing</a>
          </div>
        )}

        {/* ── INQUIRIES ── */}
        <div className="section-gap">
          <div className="section-header">
            <span className="section-title">Your inquiries</span>
            <a href="/homes" className="section-link">Browse more →</a>
          </div>

          {FAKE_INTERESTS.length === 0 ? (
            <div style={{ background: '#fff', border: '1px dashed #e8e4db', borderRadius: '14px', padding: '36px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '28px', marginBottom: '10px' }}>🏠</div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a', marginBottom: '6px' }}>No inquiries yet</div>
              <div style={{ fontSize: '13px', color: '#9b9b9b', marginBottom: '16px', lineHeight: 1.5 }}>Submit an interest form on any property and it'll show up here with real-time status updates.</div>
              <a href="/homes" className="btn-p" style={{ display: 'inline-block', width: 'auto', padding: '10px 20px' }}>Browse homes</a>
            </div>
          ) : FAKE_INTERESTS.map(home => {
            const cfg = STATUS_CONFIG[home.status]
            return (
              <div key={home.slug} className="icard">
                <div className="icard-inner">
                  <img src={home.image} alt={home.name} className="icard-img" />
                  <div className="icard-body">
                    <div className="icard-top">
                      <div>
                        <div className="icard-name">{home.name}</div>
                        <div className="icard-addr">{home.address}</div>
                      </div>
                      <div className="icard-price">${home.price}<span>/mo</span></div>
                    </div>

                    <span className="status-pill" style={{ background: cfg.bg, color: cfg.color, borderColor: cfg.border }}>
                      {cfg.icon} {cfg.label}
                    </span>

                    <div>
                      <div className="next-step-label">What&apos;s next</div>
                      <div className="next-step-box">{home.nextStep}</div>
                    </div>

                    <div className="icard-actions">
                      <a href={`/homes/${home.slug}`} className="btn-p">View listing</a>
                      <a
                        href={`mailto:hp@homehive.live?subject=Question about ${home.name}`}
                        className="btn-s"
                      >
                        Message us
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* ── AVAILABLE HOMES ── */}
        <div>
          <div className="section-header">
            <span className="section-title">Available now</span>
            <a href="/homes" className="section-link">See all →</a>
          </div>

          {AVAILABLE_HOMES.map(home => (
            <div key={home.slug} className="hcard">
              <img src={home.image} alt={home.name} className="hcard-img" />
              <div className="hcard-body">
                <div className="hcard-top">
                  <div>
                    <div className="hcard-name">{home.name}</div>
                    <div className="hcard-addr">{home.address}</div>
                  </div>
                  <div className="hcard-price">${home.price}<span>/mo</span></div>
                </div>

                <div className="hcard-stats">
                  <span className="hcard-stat">🛏 {home.beds} beds</span>
                  <span className="hcard-stat">🚿 {home.baths} baths</span>
                  <span className="hcard-stat">📍 {home.asuDistance} mi to ASU</span>
                </div>

                <div className="hcard-tags">
                  <span className="avail-pill"><span className="avail-dot" />{home.available} room{home.available !== 1 ? 's' : ''} left</span>
                  {home.tags.slice(0, 3).map(t => <span key={t} className="hcard-tag">{t}</span>)}
                </div>

                <a href={`/homes/${home.slug}`} className="btn-p">View details</a>
              </div>
            </div>
          ))}
        </div>

      </div>
    </>
  )
}
