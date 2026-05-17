'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type UpgradeStatus = 'pending' | 'approved' | 'rejected'
type UpgradeRequest = { id: string; status: UpgradeStatus; admin_note: string | null }

export default function ListYourPlacePage() {
  const router = useRouter()

  const [userRole, setUserRole]           = useState('')
  const [upgradeRequest, setUpgradeRequest] = useState<UpgradeRequest | null>(null)
  const [loading, setLoading]             = useState(true)
  const [showForm, setShowForm]           = useState(false)
  const [message, setMessage]             = useState('')
  const [submitting, setSubmitting]       = useState(false)
  const [error, setError]                 = useState('')

  useEffect(() => { document.title = 'My Applications — My Portal | HomeHive' }, [])

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const [profileRes, upgradeRes] = await Promise.all([
        supabase.from('profiles').select('role').eq('id', user.id).single(),
        supabase.from('upgrade_requests').select('id, status, admin_note').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ])

      setUserRole(profileRes.data?.role || 'tenant')
      if (upgradeRes.data) setUpgradeRequest(upgradeRes.data as UpgradeRequest)
      setLoading(false)
    }
    load()
  }, [router])

  const handleSubmit = async () => {
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/upgrade-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      if (res.ok) {
        const data = await res.json()
        setUpgradeRequest({ id: data.id, status: 'pending', admin_note: null })
        setShowForm(false)
        setMessage('')
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || `Request failed (${res.status})`)
      }
    } catch (_) {
      setError('Network error — please try again.')
    }
    setSubmitting(false)
  }

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
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,300&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .lp-wrap { max-width: 520px; margin: 0 auto; padding: 36px 16px 72px; font-family: 'DM Sans', sans-serif; }

        .lp-status { border: 1px solid #e8e4db; border-radius: 12px; padding: 18px; margin-bottom: 20px; }
        .lp-status.pending  { background: #fffbeb; border-color: #fde68a; }
        .lp-status.rejected { background: #fff1f2; border-color: #fecdd3; }
        .lp-status.approved { background: #f0fdf4; border-color: #bbf7d0; }
        .lp-status-title { font-size: 15px; font-weight: 600; color: #1a1a1a; margin-bottom: 5px; }
        .lp-status-sub   { font-size: 13px; color: #6b6b6b; line-height: 1.55; }

        .lp-features { display: flex; flex-direction: column; gap: 11px; margin: 24px 0 28px; }
        .lp-feature  { display: flex; align-items: center; gap: 12px; font-size: 13px; color: #3a3a3a; }
        .lp-feat-icon { width: 32px; height: 32px; border-radius: 9px; background: #fdf2f5; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }

        .lp-textarea { width: 100%; padding: 11px 14px; border: 1.5px solid #e8e4db; border-radius: 9px; font-size: 13px; font-family: 'DM Sans', sans-serif; resize: none; height: 90px; outline: none; line-height: 1.6; transition: border-color 0.15s; color: #1a1a1a; background: #fff; }
        .lp-textarea:focus { border-color: #8C1D40; }
        .lp-textarea::placeholder { color: #c5c1b8; }

        .lp-btns { display: flex; gap: 8px; margin-top: 10px; }
        .lp-submit { background: #8C1D40; color: #fff; border: none; border-radius: 8px; padding: 12px 22px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; }
        .lp-submit:hover:not(:disabled) { opacity: 0.88; }
        .lp-submit:disabled { opacity: 0.5; cursor: not-allowed; }
        .lp-cancel { background: #f5f4f0; color: #6b6b6b; border: none; border-radius: 8px; padding: 12px 16px; font-size: 13px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .lp-cta { display: inline-flex; align-items: center; gap: 5px; background: #8C1D40; color: #fff; border: none; border-radius: 8px; padding: 12px 22px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; transition: opacity 0.15s; }
        .lp-cta:hover { opacity: 0.88; }
        .lp-cta-green { background: #16a34a; }
        .lp-cta-full  { width: 100%; justify-content: center; }
      `}</style>

      <div className="lp-wrap">

        {/* ── BACK ── */}
        <a href="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#9b9b9b', textDecoration: 'none', marginBottom: 24 }}>
          ← Dashboard
        </a>

        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 300, color: '#1a1a1a', letterSpacing: '-0.4px', marginBottom: 6 }}>
          List your place
        </div>
        <div style={{ fontSize: 14, color: '#9b9b9b', marginBottom: 28, lineHeight: 1.5 }}>
          Reach thousands of students near ASU — free to list, pre-screened leads.
        </div>

        {/* ── APPROVED ── */}
        {userRole === 'landlord' ? (
          <div className="lp-status approved">
            <div className="lp-status-title">🎉 You&apos;re approved as a landlord!</div>
            <div className="lp-status-sub" style={{ marginBottom: 14 }}>
              Create listings, manage leads, and track everything from your portal.
            </div>
            <a href="/landlord/dashboard" className="lp-cta lp-cta-green">Go to Landlord Portal →</a>
          </div>

        /* ── PENDING ── */
        ) : upgradeRequest?.status === 'pending' ? (
          <div className="lp-status pending">
            <div className="lp-status-title">⏳ Request under review</div>
            <div className="lp-status-sub">
              We received your request. Our team typically reviews within 24 hours — we&apos;ll email you once it&apos;s decided.
            </div>
          </div>

        /* ── REJECTED ── */
        ) : upgradeRequest?.status === 'rejected' ? (
          <>
            <div className="lp-status rejected" style={{ marginBottom: 20 }}>
              <div className="lp-status-title">Request not approved</div>
              {upgradeRequest.admin_note && (
                <div style={{ fontSize: 12, color: '#9f1239', marginBottom: 6 }}>
                  <strong>Reason:</strong> {upgradeRequest.admin_note}
                </div>
              )}
              <div className="lp-status-sub">
                Questions? <a href="mailto:hello@homehive.live" style={{ color: '#8C1D40' }}>hello@homehive.live</a>
              </div>
            </div>
            {!showForm ? (
              <button className="lp-cta" onClick={() => setShowForm(true)}>Submit a new request →</button>
            ) : (
              <>
                <textarea className="lp-textarea" placeholder="Tell us more about your property or situation (optional)…" value={message} onChange={e => setMessage(e.target.value)} />
                {error && <div style={{ fontSize: 12, color: '#8C1D40', marginTop: 6 }}>{error}</div>}
                <div className="lp-btns">
                  <button className="lp-cancel" onClick={() => setShowForm(false)}>Cancel</button>
                  <button className="lp-submit" disabled={submitting} onClick={handleSubmit}>
                    {submitting ? 'Sending…' : 'Submit request'}
                  </button>
                </div>
              </>
            )}
          </>

        /* ── NO REQUEST YET ── */
        ) : (
          <>
            <div className="lp-features">
              {([
                ['📋', 'Free to list — no upfront cost'],
                ['🎯', 'Pre-screened, qualified leads only'],
                ['📊', 'Track inquiries and tours in one dashboard'],
                ['🏡', 'Works for full rentals, rooms, and subleases'],
              ] as [string, string][]).map(([icon, text]) => (
                <div key={text} className="lp-feature">
                  <div className="lp-feat-icon">{icon}</div>
                  {text}
                </div>
              ))}
            </div>

            {!showForm ? (
              <button className="lp-cta lp-cta-full" onClick={() => setShowForm(true)}>
                Request landlord access →
              </button>
            ) : (
              <>
                <textarea className="lp-textarea" placeholder="Tell us about your property and why you'd like to list (optional)…" value={message} onChange={e => setMessage(e.target.value)} />
                {error && <div style={{ fontSize: 12, color: '#8C1D40', marginTop: 6 }}>{error}</div>}
                <div className="lp-btns">
                  <button className="lp-cancel" onClick={() => { setShowForm(false); setMessage('') }}>Cancel</button>
                  <button className="lp-submit" disabled={submitting} onClick={handleSubmit}>
                    {submitting ? 'Sending…' : 'Send request'}
                  </button>
                </div>
              </>
            )}
          </>
        )}

      </div>
    </>
  )
}
