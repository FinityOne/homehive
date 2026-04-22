'use client'

import { useState, useEffect, use } from 'react'

type ReservationState =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'expired' }
  | { status: 'accepted'; accepted_at: string }
  | {
      status: 'pending'
      property_name: string
      property_address: string
      room_name: string | null
      original_price: number
      discount_amount: number | null
      discount_type: 'dollars' | 'percent' | null
      expires_at: string
    }

export default function ReservationAcceptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [state, setState] = useState<ReservationState>({ status: 'loading' })
  const [accepting, setAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    fetch(`/api/reserve/${token}`)
      .then(r => r.json())
      .then(({ reservation, error }) => {
        if (error || !reservation) { setState({ status: 'not_found' }); return }

        const r = reservation
        if (r.status === 'accepted') {
          setState({ status: 'accepted', accepted_at: r.accepted_at })
          return
        }
        if (r.status === 'expired') {
          setState({ status: 'expired' })
          return
        }

        setState({
          status: 'pending',
          property_name: r.properties?.name || '',
          property_address: r.properties?.address || '',
          room_name: r.room_name || null,
          original_price: r.original_price,
          discount_amount: r.discount_amount,
          discount_type: r.discount_type,
          expires_at: r.expires_at,
        })
      })
      .catch(() => setState({ status: 'not_found' }))
  }, [token])

  const handleAccept = async () => {
    setAccepting(true)
    try {
      const res = await fetch(`/api/reserve/${token}`, { method: 'POST' })
      if (res.ok) {
        setAccepted(true)
        setState(prev => prev.status === 'pending' ? { ...prev, status: 'accepted', accepted_at: new Date().toISOString() } : prev)
      } else {
        const body = await res.json()
        if (body.error?.includes('expired')) setState({ status: 'expired' })
      }
    } catch (_) {}
    setAccepting(false)
  }

  const getDiscountedPrice = (original: number, amount: number | null, type: string | null) => {
    if (!amount || !type) return null
    if (type === 'dollars') return Math.max(0, original - amount)
    return Math.round(original * (1 - amount / 100))
  }

  const getSavingsLabel = (amount: number | null, type: string | null) => {
    if (!amount || !type) return ''
    return type === 'dollars' ? `$${amount} off` : `${amount}% off`
  }

  const fmtExpiry = (iso: string) =>
    new Date(iso).toLocaleString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      timeZone: 'America/Phoenix',
    })

  const containerStyle: React.CSSProperties = {
    minHeight: '100vh',
    background: '#f5f4f0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
    fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif",
  }

  const cardStyle: React.CSSProperties = {
    background: '#fff',
    borderRadius: '20px',
    border: '1px solid #e8e5de',
    maxWidth: '480px',
    width: '100%',
    overflow: 'hidden',
    boxShadow: '0 8px 48px rgba(0,0,0,0.10)',
  }

  if (state.status === 'loading') {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, padding: '48px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔒</div>
          <div style={{ fontSize: '16px', color: '#9b9b9b' }}>Loading your reservation…</div>
        </div>
      </div>
    )
  }

  if (state.status === 'not_found') {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, padding: '48px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: '40px', marginBottom: '14px' }}>🔍</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', marginBottom: '8px' }}>Reservation Not Found</div>
          <div style={{ fontSize: '14px', color: '#9b9b9b', lineHeight: 1.6 }}>This reservation link is invalid or has been removed.</div>
        </div>
      </div>
    )
  }

  if (state.status === 'expired') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ background: '#1a1a1a', padding: '22px 32px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#fff' }}>
              Home<span style={{ color: '#FFC627', fontStyle: 'italic' }}>Hive</span>
            </div>
          </div>
          <div style={{ padding: '48px 32px', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏰</div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#1a1a1a', marginBottom: '10px', letterSpacing: '-0.3px' }}>
              Reservation Expired
            </div>
            <div style={{ fontSize: '15px', color: '#6b6b6b', lineHeight: 1.7, marginBottom: '24px' }}>
              Unfortunately, this reservation window has closed. Contact the landlord directly to see if the spot is still available.
            </div>
            <a href="/" style={{ display: 'inline-block', background: '#8C1D40', color: '#fff', textDecoration: 'none', fontSize: '14px', fontWeight: 700, padding: '13px 32px', borderRadius: '10px' }}>
              Browse Available Homes →
            </a>
          </div>
        </div>
      </div>
    )
  }

  if (state.status === 'accepted' || accepted) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ background: '#1a1a1a', padding: '22px 32px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#fff' }}>
              Home<span style={{ color: '#FFC627', fontStyle: 'italic' }}>Hive</span>
            </div>
          </div>
          <div style={{ padding: '48px 32px', textAlign: 'center' }}>
            <div style={{ display: 'inline-flex', width: '72px', height: '72px', borderRadius: '50%', background: 'rgba(16,185,129,0.1)', border: '2px solid rgba(16,185,129,0.3)', alignItems: 'center', justifyContent: 'center', fontSize: '32px', marginBottom: '20px' }}>
              ✓
            </div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#1a1a1a', marginBottom: '10px', letterSpacing: '-0.4px' }}>
              You&apos;re all set!
            </div>
            <div style={{ fontSize: '15px', color: '#6b6b6b', lineHeight: 1.75, marginBottom: '28px' }}>
              Your reservation is confirmed. The landlord has been notified of your intent and will be in touch shortly with next steps.
            </div>
            <div style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: '12px', padding: '16px 20px', marginBottom: '28px', textAlign: 'left' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>What happens next</div>
              {['The landlord will reach out to discuss next steps', 'You&apos;ll go through the formal application process', 'No payment or commitment is required yet'].map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: '10px', marginBottom: '6px' }}>
                  <div style={{ color: '#10b981', fontWeight: 700, fontSize: '13px', flexShrink: 0 }}>✓</div>
                  <div style={{ fontSize: '13px', color: '#3a3a3a', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: item }} />
                </div>
              ))}
            </div>
            <a href="/" style={{ display: 'inline-block', color: '#8C1D40', textDecoration: 'none', fontSize: '13px', fontWeight: 600 }}>
              ← Back to HomeHive
            </a>
          </div>
        </div>
      </div>
    )
  }

  // Pending — main accept view
  const discountedPrice = getDiscountedPrice(state.original_price, state.discount_amount, state.discount_type)
  const savingsLabel = getSavingsLabel(state.discount_amount, state.discount_type)
  const roomLabel = state.room_name || (state.room_name === null && state.discount_type ? 'Entire Property' : 'Entire Property')

  // Calculate countdown
  const expiresMs = new Date(state.expires_at).getTime() - Date.now()
  const expiresHours = Math.max(0, Math.floor(expiresMs / 3600000))
  const expiresMinutes = Math.max(0, Math.floor((expiresMs % 3600000) / 60000))
  const urgencyColor = expiresHours < 4 ? '#ef4444' : expiresHours < 12 ? '#f97316' : '#8C1D40'

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        {/* Header */}
        <div style={{ background: '#1a1a1a', padding: '22px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#fff' }}>
            Home<span style={{ color: '#FFC627', fontStyle: 'italic' }}>Hive</span>
          </div>
        </div>

        {/* Urgency banner */}
        <div style={{ background: `linear-gradient(135deg, ${urgencyColor}, ${urgencyColor}dd)`, padding: '16px 28px', textAlign: 'center' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>
            Time-Sensitive Offer
          </div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: '#fff' }}>
            🔒 Reserved exclusively for you
          </div>
          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.85)', marginTop: '4px' }}>
            Expires {fmtExpiry(state.expires_at)}
            {expiresMs > 0 && (
              <span style={{ fontWeight: 700 }}>
                {' '}({expiresHours > 0 ? `${expiresHours}h ` : ''}{expiresMinutes}m left)
              </span>
            )}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '36px 32px 40px', textAlign: 'center' }}>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#1a1a1a', marginBottom: '8px', letterSpacing: '-0.4px', lineHeight: 1.2 }}>
            Your spot is being held
          </div>
          <div style={{ fontSize: '15px', color: '#6b6b6b', lineHeight: 1.75, marginBottom: '28px' }}>
            The landlord has personally selected you as a top candidate for{' '}
            <strong>{state.property_name}</strong>. Accept below to confirm your intent and keep your spot.
          </div>

          {/* Reservation details */}
          <div style={{ background: '#faf9f6', border: '1.5px solid #e8e5de', borderRadius: '14px', padding: '22px 24px', marginBottom: '28px', textAlign: 'left' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '14px' }}>
              Reservation Details
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #f0ede6' }}>
              <div style={{ fontSize: '13px', color: '#9b9b9b' }}>Property</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{state.property_name}</div>
            </div>
            {state.room_name && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #f0ede6' }}>
                <div style={{ fontSize: '13px', color: '#9b9b9b' }}>Room</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{state.room_name}</div>
              </div>
            )}
            {state.property_address && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #f0ede6' }}>
                <div style={{ fontSize: '13px', color: '#9b9b9b' }}>Address</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a', textAlign: 'right', maxWidth: '60%' }}>{state.property_address}</div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
              <div style={{ fontSize: '13px', color: '#9b9b9b' }}>Monthly Rent</div>
              <div style={{ textAlign: 'right' }}>
                {discountedPrice !== null ? (
                  <>
                    <div>
                      <span style={{ fontSize: '13px', color: '#9b9b9b', textDecoration: 'line-through', marginRight: '6px' }}>${state.original_price.toLocaleString()}/mo</span>
                      <span style={{ fontSize: '20px', fontWeight: 800, color: '#8C1D40' }}>${discountedPrice.toLocaleString()}/mo</span>
                    </div>
                    <div style={{ display: 'inline-block', background: '#8C1D40', color: '#fff', fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', marginTop: '4px' }}>
                      {savingsLabel} — exclusive offer
                    </div>
                  </>
                ) : (
                  <span style={{ fontSize: '20px', fontWeight: 800, color: '#1a1a1a' }}>${state.original_price.toLocaleString()}/mo</span>
                )}
              </div>
            </div>
          </div>

          {/* Accept CTA */}
          <button
            onClick={handleAccept}
            disabled={accepting}
            style={{
              display: 'block', width: '100%',
              background: accepting ? '#9b9b9b' : '#8C1D40',
              color: '#fff', border: 'none',
              fontSize: '17px', fontWeight: 800,
              padding: '20px 32px', borderRadius: '12px',
              letterSpacing: '-0.2px', marginBottom: '12px',
              boxShadow: accepting ? 'none' : '0 6px 28px rgba(140,29,64,0.35)',
              cursor: accepting ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}
          >
            {accepting ? 'Confirming…' : '✓ Accept My Reservation →'}
          </button>

          <div style={{ fontSize: '12px', color: '#b0a898', lineHeight: 1.7, marginBottom: '24px' }}>
            Accepting confirms your <strong>intent to move forward</strong> — no payment or commitment required yet.<br />
            The landlord will follow up with next steps.
          </div>

          {/* Trust signals */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', flexWrap: 'wrap' }}>
            {['🔒 Secure', '✓ No payment now', '📞 Landlord will call'].map((item, i) => (
              <div key={i} style={{ fontSize: '12px', color: '#9b9b9b', fontWeight: 500 }}>{item}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
