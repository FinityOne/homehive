'use client'

import { use, useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Slot = {
  id: string
  date: string
  time_slot: string
  is_booked: boolean
}

type GroupedDay = {
  date: string
  label: string
  dayName: string
  slots: Slot[]
}

type TourInfo = {
  scheduled_date: string
  time_slot: string
}

type PropertyInfo = {
  name: string
  address: string
  heroImage: string
}

function formatDayLabel(dateStr: string): { dayName: string; label: string } {
  const d = new Date(dateStr + 'T12:00:00')
  const today = new Date(); today.setHours(12, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const dayName = d.toLocaleDateString('en-US', { weekday: 'short' })
  const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (d.toDateString() === today.toDateString()) return { dayName: 'Today', label }
  if (d.toDateString() === tomorrow.toDateString()) return { dayName: 'Tomorrow', label }
  return { dayName, label }
}

function formatTime(slot: string): string {
  const [h, m] = slot.split(':').map(Number)
  const suffix = h >= 12 ? 'pm' : 'am'
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

function groupByDay(slots: Slot[]): GroupedDay[] {
  const map = new Map<string, Slot[]>()
  for (const slot of slots) {
    if (!map.has(slot.date)) map.set(slot.date, [])
    map.get(slot.date)!.push(slot)
  }
  return Array.from(map.entries()).map(([date, slots]) => {
    const { dayName, label } = formatDayLabel(date)
    return { date, label, dayName, slots }
  })
}

export default function BookTourPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = use(params)
  const router = useRouter()

  const [phase, setPhase] = useState<'loading' | 'auth-needed' | 'booking' | 'booked' | 'error'>('loading')
  const [slots, setSlots] = useState<Slot[]>([])
  const [groupedDays, setGroupedDays] = useState<GroupedDay[]>([])
  const [property, setProperty] = useState<PropertyInfo | null>(null)
  const [existingTour, setExistingTour] = useState<TourInfo | null>(null)
  const [leadEmail, setLeadEmail] = useState('')
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [booking, setBooking] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [user, setUser] = useState<{ email: string } | null>(null)

  useEffect(() => {
    init()
  }, [leadId])

  async function init() {
    // Get auth state
    const { data: { session } } = await supabase.auth.getSession()
    const currentUser = session?.user || null
    if (currentUser) setUser({ email: currentUser.email || '' })

    // Fetch slots from public endpoint
    const res = await fetch(`/api/leads/${leadId}/tour-slots`)
    if (!res.ok) {
      const body = await res.json()
      setErrorMsg(body.error || 'This invitation link is not valid or has expired.')
      setPhase('error')
      return
    }

    const data = await res.json()

    if (data.alreadyBooked) {
      setExistingTour(data.tour)
      setProperty(data.property)
      setPhase('booked')
      return
    }

    setSlots(data.slots || [])
    setGroupedDays(groupByDay(data.slots || []))
    setProperty(data.property)

    // Fetch lead email for auth check (tour-slots endpoint returns lead status not email)
    // We'll get email from a public endpoint
    const leadRes = await fetch(`/api/leads/${leadId}/prescreen`)
    if (leadRes.ok) {
      const ld = await leadRes.json()
      setLeadEmail(ld.lead?.email || '')
    }

    if (!currentUser) {
      setPhase('auth-needed')
    } else {
      setPhase('booking')
    }
  }

  async function handleBook() {
    if (!selectedSlot || !user) return
    setBooking(true)
    setErrorMsg('')

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setPhase('auth-needed'); return }

    const res = await fetch(`/api/leads/${leadId}/book-tour`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ availability_id: selectedSlot.id }),
    })

    const body = await res.json()
    if (!res.ok) {
      setErrorMsg(body.error || 'Failed to book. Please try another slot.')
      setBooking(false)
      // Refresh slots in case it was taken
      const refreshRes = await fetch(`/api/leads/${leadId}/tour-slots`)
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json()
        if (!refreshData.alreadyBooked) {
          setSlots(refreshData.slots || [])
          setGroupedDays(groupByDay(refreshData.slots || []))
        }
      }
      return
    }

    setExistingTour(body.tour)
    setPhase('booked')
    setBooking(false)
  }

  function goLogin() {
    const returnUrl = `/book-tour/${leadId}`
    router.push(`/login?next=${encodeURIComponent(returnUrl)}${leadEmail ? `&email=${encodeURIComponent(leadEmail)}` : ''}`)
  }

  function goSignup() {
    const returnUrl = `/book-tour/${leadId}`
    router.push(`/signup?next=${encodeURIComponent(returnUrl)}${leadEmail ? `&email=${encodeURIComponent(leadEmail)}` : ''}`)
  }

  const propName = property?.name || 'the property'

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600;700;800&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body { background: #f5f4f0; }

        .bt-page {
          min-height: 100svh;
          background: #f5f4f0;
          font-family: 'DM Sans', sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        /* Minimal header */
        .bt-nav {
          width: 100%;
          background: #1a1a1a;
          padding: 14px 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .bt-logo {
          font-size: 20px;
          font-weight: 800;
          color: #fff;
          letter-spacing: -0.3px;
        }
        .bt-logo span { color: #FFC627; font-style: italic; }

        /* Hero strip */
        .bt-hero {
          width: 100%;
          max-width: 640px;
          margin: 0 auto;
        }
        .bt-hero-img {
          width: 100%;
          height: 200px;
          object-fit: cover;
          display: block;
        }

        /* Main card */
        .bt-card {
          width: 100%;
          max-width: 640px;
          background: #fff;
          border: 1px solid #e8e5de;
          border-top: none;
          border-radius: 0 0 20px 20px;
          padding: 32px 28px 40px;
          margin: 0 auto;
        }

        .bt-heading {
          font-size: 24px;
          font-weight: 800;
          color: #1a1a1a;
          letter-spacing: -0.4px;
          margin-bottom: 6px;
        }
        .bt-subheading {
          font-size: 15px;
          color: #6b6b6b;
          line-height: 1.6;
          margin-bottom: 28px;
        }

        /* Auth section */
        .bt-auth-box {
          background: #faf9f6;
          border: 1px solid #e8e5de;
          border-radius: 14px;
          padding: 28px;
          text-align: center;
        }
        .bt-auth-icon { font-size: 36px; margin-bottom: 12px; }
        .bt-auth-title { font-size: 17px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px; }
        .bt-auth-desc { font-size: 14px; color: #6b6b6b; line-height: 1.6; margin-bottom: 24px; }

        .bt-btn-primary {
          display: block;
          width: 100%;
          background: #1a1a1a;
          color: #FFC627;
          border: none;
          border-radius: 12px;
          padding: 16px;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          font-family: 'DM Sans', sans-serif;
          text-decoration: none;
          text-align: center;
          margin-bottom: 10px;
        }
        .bt-btn-secondary {
          display: block;
          width: 100%;
          background: #fff;
          color: #1a1a1a;
          border: 1.5px solid #e8e5de;
          border-radius: 12px;
          padding: 14px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          font-family: 'DM Sans', sans-serif;
          text-decoration: none;
          text-align: center;
        }
        .bt-btn-secondary:hover { border-color: #1a1a1a; }

        .bt-or { font-size: 12px; color: #9b9b9b; text-align: center; margin: 8px 0; }

        /* Day columns */
        .bt-days-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          color: #9b9b9b;
          margin-bottom: 16px;
        }

        .bt-days {
          display: flex;
          gap: 10px;
          overflow-x: auto;
          padding-bottom: 8px;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .bt-days::-webkit-scrollbar { display: none; }

        .bt-day-col {
          flex-shrink: 0;
          width: 92px;
        }
        .bt-day-header {
          text-align: center;
          margin-bottom: 8px;
        }
        .bt-day-name {
          font-size: 12px;
          font-weight: 700;
          color: #9b9b9b;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .bt-day-date {
          font-size: 11px;
          color: #b0a898;
          margin-top: 2px;
        }

        .bt-slot {
          display: block;
          width: 100%;
          padding: 10px 6px;
          text-align: center;
          font-size: 13px;
          font-weight: 600;
          color: #1a1a1a;
          background: #faf9f6;
          border: 1.5px solid #e8e5de;
          border-radius: 10px;
          cursor: pointer;
          font-family: 'DM Sans', sans-serif;
          margin-bottom: 8px;
          transition: all 0.15s;
        }
        .bt-slot:hover { border-color: #1a1a1a; background: #1a1a1a; color: #FFC627; }
        .bt-slot.selected { background: #1a1a1a; color: #FFC627; border-color: #1a1a1a; }

        /* Confirm bar */
        .bt-confirm-bar {
          margin-top: 24px;
          padding-top: 20px;
          border-top: 1px solid #f0ede6;
        }
        .bt-selected-info {
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          border-radius: 10px;
          padding: 14px 16px;
          font-size: 14px;
          color: #166534;
          margin-bottom: 14px;
          font-weight: 600;
        }

        .bt-book-btn {
          display: block;
          width: 100%;
          background: #1a1a1a;
          color: #FFC627;
          border: none;
          border-radius: 12px;
          padding: 18px;
          font-size: 16px;
          font-weight: 800;
          cursor: pointer;
          font-family: 'DM Sans', sans-serif;
          letter-spacing: -0.2px;
          transition: opacity 0.15s;
        }
        .bt-book-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        /* No slots state */
        .bt-no-slots {
          text-align: center;
          padding: 40px 20px;
        }

        /* Success state */
        .bt-success {
          text-align: center;
          padding: 8px 0;
        }
        .bt-success-icon { font-size: 56px; margin-bottom: 16px; }
        .bt-success-title { font-size: 24px; font-weight: 800; color: #1a1a1a; letter-spacing: -0.4px; margin-bottom: 10px; }
        .bt-success-desc { font-size: 15px; color: #6b6b6b; line-height: 1.7; }

        .bt-detail-card {
          background: #faf9f6;
          border: 1px solid #e8e5de;
          border-radius: 12px;
          padding: 20px;
          margin: 24px 0;
          text-align: left;
        }
        .bt-detail-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 8px 0;
          border-bottom: 1px solid #f0ede6;
          font-size: 14px;
        }
        .bt-detail-row:last-child { border-bottom: none; }
        .bt-detail-label { color: #6b6b6b; }
        .bt-detail-value { font-weight: 600; color: #1a1a1a; text-align: right; max-width: 65%; }

        .bt-error { background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 12px 16px; font-size: 14px; color: #dc2626; margin-bottom: 16px; }

        @media (max-width: 480px) {
          .bt-card { padding: 24px 20px 36px; }
          .bt-heading { font-size: 21px; }
        }
      `}</style>

      <div className="bt-page">
        {/* Nav */}
        <nav className="bt-nav">
          <div className="bt-logo">Home<span>Hive</span></div>
        </nav>

        <div className="bt-hero">
          {property?.heroImage && (
            <img src={property.heroImage} alt={propName} className="bt-hero-img" />
          )}
        </div>

        <div className="bt-card">
          {/* ── LOADING ── */}
          {phase === 'loading' && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: '#9b9b9b', fontSize: '15px' }}>
              Loading your invitation...
            </div>
          )}

          {/* ── ERROR ── */}
          {phase === 'error' && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>😔</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a1a', marginBottom: '8px' }}>Link not available</div>
              <div style={{ fontSize: '14px', color: '#6b6b6b', lineHeight: 1.6 }}>{errorMsg}</div>
            </div>
          )}

          {/* ── AUTH NEEDED ── */}
          {phase === 'auth-needed' && (
            <>
              <div className="bt-heading">You&apos;re invited to tour!</div>
              <div className="bt-subheading">
                {property ? `Schedule your 30-minute tour of ${propName}.` : 'Schedule your 30-minute tour.'} Sign in to choose a time.
              </div>
              <div className="bt-auth-box">
                <div className="bt-auth-icon">🔑</div>
                <div className="bt-auth-title">Sign in to book your tour</div>
                <div className="bt-auth-desc">
                  Use the same email address you applied with{leadEmail ? ` (${leadEmail})` : ''} to access your available time slots.
                </div>
                <button className="bt-btn-primary" onClick={goLogin}>Log in to book →</button>
                <div className="bt-or">or</div>
                <button className="bt-btn-secondary" onClick={goSignup}>Create an account</button>
              </div>
            </>
          )}

          {/* ── BOOKING ── */}
          {phase === 'booking' && (
            <>
              <div className="bt-heading">Choose your tour time</div>
              <div className="bt-subheading">
                Pick a 30-minute slot that works for you. {property ? `You&apos;ll be visiting <strong>${propName}</strong>.` : ''}
              </div>

              {property?.address && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#4a4a4a', background: '#faf9f6', border: '1px solid #e8e5de', borderRadius: '10px', padding: '12px 16px', marginBottom: '24px' }}>
                  <span>📍</span>
                  <span>{property.address}</span>
                </div>
              )}

              {errorMsg && <div className="bt-error">{errorMsg}</div>}

              {groupedDays.length === 0 ? (
                <div className="bt-no-slots">
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>📅</div>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', marginBottom: '6px' }}>No slots available right now</div>
                  <div style={{ fontSize: '14px', color: '#6b6b6b' }}>The landlord hasn't set availability yet. Check back soon!</div>
                </div>
              ) : (
                <>
                  <div className="bt-days-label">Available times — next 7 days</div>
                  <div className="bt-days">
                    {groupedDays.map(day => (
                      <div key={day.date} className="bt-day-col">
                        <div className="bt-day-header">
                          <div className="bt-day-name">{day.dayName}</div>
                          <div className="bt-day-date">{day.label}</div>
                        </div>
                        {day.slots.map(slot => (
                          <button
                            key={slot.id}
                            className={`bt-slot${selectedSlot?.id === slot.id ? ' selected' : ''}`}
                            onClick={() => setSelectedSlot(slot)}
                          >
                            {formatTime(slot.time_slot)}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>

                  {selectedSlot && (
                    <div className="bt-confirm-bar">
                      <div className="bt-selected-info">
                        ✓ Selected: {formatDayLabel(selectedSlot.date).dayName}, {formatDayLabel(selectedSlot.date).label} at {formatTime(selectedSlot.time_slot)}
                      </div>
                      <button
                        className="bt-book-btn"
                        onClick={handleBook}
                        disabled={booking}
                      >
                        {booking ? 'Booking...' : 'Confirm Tour →'}
                      </button>
                      <div style={{ marginTop: '10px', fontSize: '12px', color: '#9b9b9b', textAlign: 'center' }}>
                        A calendar invite will be sent to your email
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ── BOOKED ── */}
          {phase === 'booked' && (
            <div className="bt-success">
              <div className="bt-success-icon">🎉</div>
              <div className="bt-success-title">You&apos;re all set!</div>
              <div className="bt-success-desc">
                Your tour of <strong>{propName}</strong> is confirmed. Check your email for a calendar invite.
              </div>

              {existingTour && (
                <div className="bt-detail-card">
                  <div className="bt-detail-row">
                    <span className="bt-detail-label">Property</span>
                    <span className="bt-detail-value">{propName}</span>
                  </div>
                  <div className="bt-detail-row">
                    <span className="bt-detail-label">Date</span>
                    <span className="bt-detail-value">
                      {formatDayLabel(existingTour.scheduled_date).dayName}, {formatDayLabel(existingTour.scheduled_date).label}
                    </span>
                  </div>
                  <div className="bt-detail-row">
                    <span className="bt-detail-label">Time</span>
                    <span className="bt-detail-value">{formatTime(existingTour.time_slot)} MST</span>
                  </div>
                  {property?.address && (
                    <div className="bt-detail-row">
                      <span className="bt-detail-label">Address</span>
                      <span className="bt-detail-value">📍 {property.address}</span>
                    </div>
                  )}
                </div>
              )}

              <div style={{ fontSize: '13px', color: '#9b9b9b', marginTop: '8px' }}>
                We sent a calendar invite to your email. See you there!
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '32px 0 48px', fontSize: '12px', color: '#9b9b9b', textAlign: 'center' }}>
          HomeHive · <a href="mailto:hello@homehive.live" style={{ color: '#8C1D40', textDecoration: 'none' }}>hello@homehive.live</a>
        </div>
      </div>
    </>
  )
}
