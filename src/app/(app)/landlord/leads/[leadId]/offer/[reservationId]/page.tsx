'use client'

import { useState, useEffect, use } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Reservation = {
  id: string
  accept_token: string
  status: 'pending' | 'accepted' | 'expired'
  expires_at: string
  original_price: number
  discount_amount: number | null
  discount_type: 'dollars' | 'percent' | null
  room_id: string | null
  room_name: string | null
  created_at: string
  accepted_at: string | null
  lead: { first_name: string | null; last_name: string | null; email: string } | null
  property: { name: string; address: string; heroImage: string }
  rooms: { name: string; price: number }[] // individual room prices for whole-property offers
  acceptUrl: string
}

function calcPrice(original: number, discountAmount: number | null, discountType: 'dollars' | 'percent' | null) {
  if (!discountAmount || !discountType) return null
  if (discountType === 'dollars') return Math.max(0, original - discountAmount)
  return Math.round(original * (1 - discountAmount / 100))
}

function fmtExpiry(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    timeZone: 'America/Phoenix',
  })
}

function fmtExpiryShort(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Phoenix',
  })
}

export default function OfferPreviewPage({
  params,
}: {
  params: Promise<{ leadId: string; reservationId: string }>
}) {
  const { leadId, reservationId } = use(params)
  const router = useRouter()

  const [res, setRes] = useState<Reservation | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // Edit modal
  const [editModal, setEditModal] = useState(false)
  const [editForm, setEditForm] = useState({
    discount_type: '' as '' | 'dollars' | 'percent',
    discount_amount: '',
    expires_mode: '24h' as '24h' | '48h' | '72h' | 'custom',
    custom_expires: '',
  })
  const [editSaving, setEditSaving] = useState(false)

  // Send email
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }

      const r = await fetch(`/api/leads/${leadId}/reserve/${reservationId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!r.ok) { setNotFound(true); setLoading(false); return }
      const data = await r.json()
      setRes(data)
      setEditForm({
        discount_type: data.discount_type || '',
        discount_amount: data.discount_amount ? String(data.discount_amount) : '',
        expires_mode: '24h',
        custom_expires: '',
      })
      setLoading(false)
    }
    load()
  }, [leadId, reservationId, router])

  const isExpired = res
    ? res.status === 'expired' || (res.status === 'pending' && new Date(res.expires_at) < new Date())
    : false
  const isAccepted = res?.status === 'accepted'

  const handleSendEmail = async () => {
    if (!res) return
    setSendingEmail(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`/api/leads/${leadId}/reserve/${reservationId}/send-email`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      const body = await r.json()
      if (r.ok) {
        setEmailSent(true)
        showToast(`Reservation email sent to ${res.lead?.email}! 🔒`)
      } else {
        showToast(body.error || 'Failed to send email', 'error')
      }
    } catch {
      showToast('Failed to send email', 'error')
    }
    setSendingEmail(false)
  }

  const handleEditSave = async () => {
    if (!res) return
    setEditSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()

      let expiresAt: string | undefined
      if (editForm.expires_mode !== 'custom') {
        const hours = editForm.expires_mode === '24h' ? 24 : editForm.expires_mode === '48h' ? 48 : 72
        expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString()
      } else if (editForm.custom_expires) {
        expiresAt = new Date(editForm.custom_expires).toISOString()
      }

      const payload: Record<string, unknown> = {}
      payload.discount_type = editForm.discount_type || null
      payload.discount_amount = editForm.discount_type && editForm.discount_amount
        ? parseInt(editForm.discount_amount, 10)
        : null
      if (expiresAt) payload.expires_at = expiresAt

      const r = await fetch(`/api/leads/${leadId}/reserve/${reservationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify(payload),
      })
      if (r.ok) {
        // Reload reservation
        const refreshed = await fetch(`/api/leads/${leadId}/reserve/${reservationId}`, {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        })
        if (refreshed.ok) setRes(await refreshed.json())
        setEditModal(false)
        setEmailSent(false) // may need re-send after edit
        showToast('Offer updated')
      } else {
        const body = await r.json()
        showToast(body.error || 'Failed to update offer', 'error')
      }
    } catch {
      showToast('Failed to update offer', 'error')
    }
    setEditSaving(false)
  }

  const openEditModal = () => {
    if (!res) return
    setEditForm({
      discount_type: res.discount_type || '',
      discount_amount: res.discount_amount ? String(res.discount_amount) : '',
      expires_mode: 'custom',
      custom_expires: new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 16),
    })
    setEditModal(true)
  }

  if (loading) {
    return (
      <div style={{ padding: '40px', fontFamily: "'DM Sans', sans-serif", background: '#f5f4f0', minHeight: '100vh' }}>
        <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ height: '80px', borderRadius: '10px', marginBottom: '12px', background: 'linear-gradient(90deg,#f0ede6 25%,#faf9f6 50%,#f0ede6 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s infinite' }} />
        ))}
      </div>
    )
  }

  if (notFound || !res) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ fontSize: '18px', fontWeight: 600, color: '#1a1a1a', marginBottom: '8px' }}>Offer not found</div>
        <button onClick={() => router.push(`/landlord/leads/${leadId}`)} style={{ color: '#8C1D40', background: 'none', border: 'none', fontSize: '14px', cursor: 'pointer' }}>← Back to Lead</button>
      </div>
    )
  }

  const discountedPrice = calcPrice(res.original_price, res.discount_amount, res.discount_type)
  const roomLabel = res.room_name || (res.room_id ? 'Room' : 'Entire Property')
  const leadName = [res.lead?.first_name, res.lead?.last_name].filter(Boolean).join(' ') || res.lead?.email || 'Lead'

  const savingsLabel = res.discount_amount && res.discount_type
    ? res.discount_type === 'dollars'
      ? `$${res.discount_amount} off/mo`
      : `${res.discount_amount}% off`
    : null

  const editBasePrice = res.original_price

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #f5f4f0; }

        .op-page { background: #f0ede8; min-height: 100vh; font-family: 'DM Sans', sans-serif; padding-bottom: 60px; }

        .op-topbar {
          background: #1a1a1a; padding: 14px 28px;
          display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
        }
        .op-back { background: none; border: none; color: #9b9b9b; font-size: 13px; cursor: pointer; font-family: 'DM Sans', sans-serif; display: flex; align-items: center; gap: 6px; }
        .op-back:hover { color: #fff; }
        .op-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

        .op-btn { padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; border: none; transition: opacity 0.15s; }
        .op-btn:hover { opacity: 0.85; }
        .op-btn-outline { background: rgba(255,255,255,0.08); color: #fff; border: 1.5px solid rgba(255,255,255,0.2); }
        .op-btn-primary { background: #8C1D40; color: #fff; }
        .op-btn-gold { background: #FFC627; color: #1a1a1a; }
        .op-btn-green { background: rgba(16,185,129,0.15); color: #10b981; border: 1.5px solid rgba(16,185,129,0.3); }
        .op-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .op-hint { font-size: 11px; color: #9b9b9b; margin-bottom: 6px; text-align: center; letter-spacing: 0.3px; }

        /* The printable card */
        .op-card-wrap { max-width: 560px; margin: 28px auto; padding: 0 16px; }

        .op-card {
          background: #fff;
          border-radius: 18px;
          overflow: hidden;
          box-shadow: 0 8px 40px rgba(0,0,0,0.12);
          border: 1px solid #e8e5de;
          position: relative;
        }

        .op-hero { width: 100%; height: 180px; object-fit: cover; display: block; }
        .op-hero-placeholder { width: 100%; height: 120px; background: linear-gradient(135deg,#8C1D40,#a02050); }

        .op-card-head {
          background: #1a1a1a; padding: 18px 28px;
          display: flex; align-items: center; justify-content: space-between;
        }
        .op-logo { font-size: 18px; font-weight: 800; color: #fff; letter-spacing: -0.3px; }
        .op-logo span { color: #FFC627; font-style: italic; }
        .op-doc-label { font-size: 10px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 1px; }

        .op-card-body { padding: 28px; }

        .op-title { font-size: 20px; font-weight: 800; color: #1a1a1a; letter-spacing: -0.3px; margin-bottom: 4px; }
        .op-subtitle { font-size: 13px; color: #9b9b9b; margin-bottom: 22px; line-height: 1.5; }

        .op-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        .op-table td { padding: 10px 0; border-bottom: 1px solid #f0ede6; vertical-align: middle; }
        .op-table tr:last-child td { border-bottom: none; }
        .op-table .col-label { font-size: 12px; color: #9b9b9b; width: 130px; }
        .op-table .col-value { font-size: 13px; font-weight: 600; color: #1a1a1a; text-align: right; }

        .op-divider { border: none; border-top: 2px solid #1a1a1a; margin: 16px 0 14px; }

        .op-price-row td { padding: 12px 0; }
        .op-price-label { font-size: 13px; font-weight: 700; color: #1a1a1a; }
        .op-price-value { font-size: 26px; font-weight: 800; color: #8C1D40; text-align: right; }
        .op-price-original { font-size: 14px; color: #9b9b9b; text-decoration: line-through; text-align: right; }
        .op-savings-badge {
          display: inline-block; background: #8C1D40; color: #fff;
          font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px;
          letter-spacing: 0.3px; margin-top: 4px;
        }

        .op-accept-box {
          background: #faf9f6; border: 1.5px solid #e8e5de; border-radius: 10px;
          padding: 14px 16px; margin-bottom: 20px;
        }
        .op-accept-label { font-size: 10px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 6px; }
        .op-accept-url { font-size: 11px; color: #4a4a4a; word-break: break-all; font-family: monospace; line-height: 1.5; }

        .op-footer { padding: 16px 28px; background: #faf9f6; border-top: 1px solid #f0ede6; display: flex; align-items: center; justify-content: space-between; }
        .op-footer-note { font-size: 11px; color: #b0a898; line-height: 1.5; }

        /* Expired overlay */
        .op-expired-overlay {
          position: absolute; inset: 0; background: rgba(0,0,0,0.6);
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          border-radius: 18px; z-index: 10;
        }
        .op-expired-badge {
          background: #ef4444; color: #fff; font-size: 22px; font-weight: 800;
          letter-spacing: 2px; text-transform: uppercase; padding: 14px 32px;
          border-radius: 10px; margin-bottom: 10px;
          border: 3px solid rgba(255,255,255,0.3);
        }
        .op-expired-sub { font-size: 13px; color: rgba(255,255,255,0.75); }

        /* Accepted overlay */
        .op-accepted-overlay {
          position: absolute; inset: 0; background: rgba(0,0,0,0.55);
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          border-radius: 18px; z-index: 10;
        }
        .op-accepted-badge {
          background: #10b981; color: #fff; font-size: 22px; font-weight: 800;
          letter-spacing: 1.5px; text-transform: uppercase; padding: 14px 32px;
          border-radius: 10px; margin-bottom: 10px;
          border: 3px solid rgba(255,255,255,0.3);
        }

        /* Edit modal */
        .op-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 100; display: flex; align-items: flex-end; justify-content: center; }
        .op-modal { background: #fff; border-radius: 20px 20px 0 0; width: 100%; max-width: 520px; padding: 0 0 32px; max-height: 90vh; overflow-y: auto; }
        .op-modal-handle { width: 36px; height: 4px; background: #e8e5de; border-radius: 2px; margin: 12px auto 0; }
        .op-modal-header { padding: 18px 22px 14px; border-bottom: 1px solid #f0ede6; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .op-modal-title { font-size: 17px; font-weight: 700; color: #1a1a1a; }
        .op-modal-body { padding: 18px 22px; display: flex; flex-direction: column; gap: 18px; }
        .op-modal-footer { padding: 0 22px; display: flex; gap: 10px; }
        .op-field-label { font-size: 11px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 6px; }
        .op-input { width: 100%; padding: 10px 12px; border: 1.5px solid #e8e5de; border-radius: 8px; font-size: 14px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; outline: none; }
        .op-input:focus { border-color: #8C1D40; }
        .op-toggle-row { display: flex; gap: 8px; }
        .op-toggle-opt { flex: 1; padding: 9px; border: 1.5px solid #e8e5de; border-radius: 8px; background: #fff; font-size: 13px; font-weight: 600; color: #3a3a3a; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; }
        .op-toggle-opt.selected { border-color: #8C1D40; background: rgba(140,29,64,0.06); color: #8C1D40; }
        .op-expires-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

        /* Toast */
        .op-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #1a1a1a; color: #fff; padding: 12px 22px; border-radius: 10px; font-size: 13px; font-weight: 600; font-family: 'DM Sans', sans-serif; z-index: 200; box-shadow: 0 4px 20px rgba(0,0,0,0.25); white-space: nowrap; }
        .op-toast.error { background: #ef4444; }
      `}</style>

      <div className="op-page">
        {/* Top bar */}
        <div className="op-topbar">
          <button className="op-back" onClick={() => router.push(`/landlord/leads/${leadId}`)}>
            ← Back to Lead
          </button>
          <div className="op-actions">
            {!isAccepted && (
              <button className="op-btn op-btn-outline" onClick={openEditModal}>
                ✏ Edit Offer
              </button>
            )}
            <button
              className="op-btn op-btn-outline"
              onClick={() => {
                navigator.clipboard.writeText(res.acceptUrl)
                setLinkCopied(true)
                setTimeout(() => setLinkCopied(false), 2000)
              }}
            >
              {linkCopied ? '✓ Copied!' : '⎘ Copy Accept Link'}
            </button>
            {!isExpired && !isAccepted && (
              <button
                className="op-btn op-btn-primary"
                disabled={sendingEmail}
                onClick={handleSendEmail}
              >
                {sendingEmail ? 'Sending…' : emailSent ? '✓ Resend Email' : '📧 Send Email to Lead'}
              </button>
            )}
            {isExpired && !isAccepted && (
              <button className="op-btn op-btn-outline" onClick={openEditModal}>
                🔄 Extend & Reactivate
              </button>
            )}
          </div>
        </div>

        <div className="op-card-wrap">
          {emailSent && !isExpired && (
            <div style={{ background: 'rgba(16,185,129,0.1)', border: '1.5px solid rgba(16,185,129,0.3)', borderRadius: '10px', padding: '12px 16px', marginBottom: '14px', fontSize: '13px', color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              ✓ Email sent to {res.lead?.email}
            </div>
          )}
          <p className="op-hint">
            Screenshot the card below to share as an image — action buttons above won&apos;t appear in your screenshot
          </p>

          {/* The card */}
          <div className="op-card">
            {/* Expired overlay */}
            {isExpired && (
              <div className="op-expired-overlay">
                <div className="op-expired-badge">⛔ Offer Expired</div>
                <div className="op-expired-sub">
                  Expired {fmtExpiryShort(res.expires_at)} · Edit offer to reactivate
                </div>
              </div>
            )}

            {/* Accepted overlay */}
            {isAccepted && (
              <div className="op-accepted-overlay">
                <div className="op-accepted-badge">✓ Offer Accepted</div>
                <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.75)', marginTop: '6px' }}>
                  Accepted {res.accepted_at ? fmtExpiryShort(res.accepted_at) : ''}
                </div>
              </div>
            )}

            {/* Hero */}
            {res.property.heroImage
              ? <img src={res.property.heroImage} alt={res.property.name} className="op-hero" />
              : <div className="op-hero-placeholder" />
            }

            {/* Header */}
            <div className="op-card-head">
              <div className="op-logo">Home<span>Hive</span></div>
              <div className="op-doc-label">Reservation Offer</div>
            </div>

            {/* Body */}
            <div className="op-card-body">
              <div className="op-title">🔒 Exclusive Offer</div>
              <div className="op-subtitle">
                For: <strong>{leadName}</strong> · {res.property.name}
                {res.property.address && <><br />📍 {res.property.address}</>}
              </div>

              <table className="op-table">
                <tbody>
                  {/* Whole-property with room breakdown */}
                  {!res.room_id && res.rooms && res.rooms.length > 0 ? (
                    <>
                      <tr>
                        <td className="col-label" style={{ paddingBottom: '4px' }}>Rooms Included</td>
                        <td className="col-value" style={{ paddingBottom: '4px' }}>
                          <span style={{ fontSize: '11px', color: '#9b9b9b', fontWeight: 400 }}>{res.rooms.length} bedrooms</span>
                        </td>
                      </tr>
                      {res.rooms.map((room, i) => (
                        <tr key={i} style={{ opacity: 0.85 }}>
                          <td style={{ paddingLeft: '14px', fontSize: '12px', color: '#6b6b6b', paddingTop: '5px', paddingBottom: '5px', borderBottom: '1px solid #f5f4f0' }}>
                            🛏 {room.name}
                          </td>
                          <td style={{ fontSize: '12px', color: '#4a4a4a', textAlign: 'right', paddingTop: '5px', paddingBottom: '5px', borderBottom: '1px solid #f5f4f0' }}>
                            ${room.price.toLocaleString()}/mo
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td className="col-label" style={{ paddingTop: '10px' }}>Subtotal ({res.rooms.length} rooms)</td>
                        <td className="col-value" style={{ paddingTop: '10px' }}>
                          ${res.rooms.reduce((s, r) => s + r.price, 0).toLocaleString()}/mo
                        </td>
                      </tr>
                    </>
                  ) : (
                    <tr>
                      <td className="col-label">Unit / Room</td>
                      <td className="col-value">{roomLabel}</td>
                    </tr>
                  )}

                  {/* Discount row */}
                  {savingsLabel && (
                    <tr>
                      <td className="col-label">Discount</td>
                      <td className="col-value" style={{ color: '#8C1D40' }}>− {savingsLabel}</td>
                    </tr>
                  )}

                  {/* Divider + final price */}
                  <tr>
                    <td colSpan={2}><hr className="op-divider" /></td>
                  </tr>
                  <tr className="op-price-row">
                    <td className="op-price-label">
                      {discountedPrice !== null ? 'Your Price' : 'Monthly Rent'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {discountedPrice !== null ? (
                        <>
                          <div className="op-price-original">${res.original_price.toLocaleString()}/mo</div>
                          <div className="op-price-value">${discountedPrice.toLocaleString()}/mo</div>
                          <div><span className="op-savings-badge">{savingsLabel} — exclusive</span></div>
                        </>
                      ) : (
                        <div className="op-price-value">${res.original_price.toLocaleString()}/mo</div>
                      )}
                    </td>
                  </tr>

                  <tr>
                    <td colSpan={2}><hr style={{ border: 'none', borderTop: '1px solid #f0ede6', margin: '4px 0' }} /></td>
                  </tr>
                  <tr>
                    <td className="col-label">
                      {isExpired ? 'Expired' : isAccepted ? 'Accepted' : 'Offer Expires'}
                    </td>
                    <td className="col-value" style={{ color: isExpired ? '#ef4444' : isAccepted ? '#10b981' : '#6b6b6b' }}>
                      {isAccepted && res.accepted_at
                        ? fmtExpiry(res.accepted_at)
                        : fmtExpiry(res.expires_at)
                      }
                    </td>
                  </tr>
                  <tr>
                    <td className="col-label">Created</td>
                    <td className="col-value" style={{ color: '#9b9b9b', fontWeight: 400 }}>
                      {new Date(res.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Accept link */}
              <div className="op-accept-box">
                <div className="op-accept-label">Accept Link</div>
                <div className="op-accept-url">{res.acceptUrl}</div>
              </div>
            </div>

            {/* Footer */}
            <div className="op-footer">
              <div className="op-footer-note">
                Prepared by HomeHive · homehive.live<br />
                This offer is exclusive and time-limited.
              </div>
              <div style={{ fontSize: '11px', color: '#9b9b9b', textAlign: 'right' }}>
                No payment required now<br />
                No commitment to lease
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Edit modal */}
      {editModal && (
        <div className="op-modal-overlay" onClick={() => setEditModal(false)}>
          <div className="op-modal" onClick={e => e.stopPropagation()}>
            <div className="op-modal-handle" />
            <div className="op-modal-header">
              <div>
                <div className="op-modal-title">Edit Offer</div>
                <div style={{ fontSize: '13px', color: '#9b9b9b', marginTop: '2px' }}>
                  Changes take effect immediately. Resend the email if you&apos;ve already sent it.
                </div>
              </div>
              <button onClick={() => setEditModal(false)} style={{ background: '#f0ede6', border: 'none', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', fontSize: '14px', color: '#6b6b6b', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
            </div>

            <div className="op-modal-body">
              {/* Discount */}
              <div>
                <div className="op-field-label">Discount (optional)</div>
                <div className="op-toggle-row" style={{ marginBottom: '8px' }}>
                  {(['', 'dollars', 'percent'] as const).map(t => (
                    <button
                      key={t}
                      className={`op-toggle-opt${editForm.discount_type === t ? ' selected' : ''}`}
                      onClick={() => setEditForm(f => ({ ...f, discount_type: t, discount_amount: '' }))}
                    >
                      {t === '' ? 'No discount' : t === 'dollars' ? '$ Off' : '% Off'}
                    </button>
                  ))}
                </div>
                {editForm.discount_type && (
                  <input
                    className="op-input"
                    type="number"
                    min="1"
                    max={editForm.discount_type === 'percent' ? '100' : undefined}
                    placeholder={editForm.discount_type === 'dollars' ? 'e.g. 100' : 'e.g. 10'}
                    value={editForm.discount_amount}
                    onChange={e => setEditForm(f => ({ ...f, discount_amount: e.target.value }))}
                  />
                )}
                {editForm.discount_type && editForm.discount_amount && (() => {
                  const disc = parseInt(editForm.discount_amount, 10)
                  const final = editForm.discount_type === 'dollars'
                    ? Math.max(0, editBasePrice - disc)
                    : Math.round(editBasePrice * (1 - disc / 100))
                  return (
                    <div style={{ marginTop: '6px', fontSize: '12px', color: '#8C1D40', fontWeight: 600 }}>
                      ${editBasePrice.toLocaleString()} → <strong>${final.toLocaleString()}/mo</strong>
                    </div>
                  )
                })()}
              </div>

              {/* Expiry */}
              <div>
                <div className="op-field-label">New Expiry Window</div>
                <div className="op-expires-grid" style={{ marginBottom: '8px' }}>
                  {(['24h', '48h', '72h', 'custom'] as const).map(opt => (
                    <button
                      key={opt}
                      className={`op-toggle-opt${editForm.expires_mode === opt ? ' selected' : ''}`}
                      onClick={() => setEditForm(f => ({ ...f, expires_mode: opt }))}
                    >
                      {opt === '24h' ? '24 hours' : opt === '48h' ? '48 hours' : opt === '72h' ? '72 hours' : '📅 Custom'}
                    </button>
                  ))}
                </div>
                {editForm.expires_mode === 'custom' && (
                  <input
                    className="op-input"
                    type="datetime-local"
                    value={editForm.custom_expires}
                    min={new Date().toISOString().slice(0, 16)}
                    onChange={e => setEditForm(f => ({ ...f, custom_expires: e.target.value }))}
                  />
                )}
              </div>

              {isExpired && (
                <div style={{ background: '#fff8e6', border: '1px solid #fde68a', borderRadius: '8px', padding: '12px 14px', fontSize: '12px', color: '#4a3800', lineHeight: 1.5 }}>
                  ⏰ Setting a new expiry will reactivate this offer as &quot;pending&quot;. Remember to resend the email to notify the lead.
                </div>
              )}
            </div>

            <div className="op-modal-footer">
              <button
                className="op-btn"
                style={{ flex: 1, background: '#f0ede6', color: '#3a3a3a', border: 'none', padding: '11px', borderRadius: '8px' }}
                onClick={() => setEditModal(false)}
              >
                Cancel
              </button>
              <button
                className="op-btn op-btn-gold"
                style={{ flex: 2, padding: '11px', borderRadius: '8px', fontSize: '14px' }}
                disabled={editSaving || (editForm.expires_mode === 'custom' && !editForm.custom_expires)}
                onClick={handleEditSave}
              >
                {editSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`op-toast${toast.type === 'error' ? ' error' : ''}`}>
          {toast.msg}
        </div>
      )}
    </>
  )
}
