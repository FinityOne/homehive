'use client'

import { useState, useEffect, use } from 'react'

const RESIDENCE_QUESTIONS = [
  'Can you confirm this person resided at your property, and for approximately how long?',
  'Did they pay rent on time consistently throughout their tenancy?',
  'Were there any noise complaints, lease violations, or damage to the property during their stay?',
  'Did they leave the unit in good condition upon move-out?',
  'Was the security deposit returned in full? If not, please briefly explain why.',
  'Would you rent to this person again?',
]

type RefData = {
  id: string
  type: 'employer' | 'residence'
  name: string | null
  address: string | null
  status: string
  responses: { question: string; answer: string }[] | null
}

export default function RefFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [ref, setRef] = useState<RefData | null>(null)
  const [leadName, setLeadName] = useState('')
  const [answers, setAnswers] = useState<string[]>(RESIDENCE_QUESTIONS.map(() => ''))
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/ref/${token}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) { setNotFound(true); setLoading(false); return }
        setRef(data.ref)
        setLeadName(data.leadName)
        if (data.ref.responses?.length) {
          setAnswers(data.ref.responses.map((r: { answer: string }) => r.answer))
          setSubmitted(true)
        }
        setLoading(false)
      })
  }, [token])

  const handleSubmit = async () => {
    if (answers.every(a => !a.trim())) {
      setError('Please answer at least one question before submitting.')
      return
    }
    setSubmitting(true)
    setError('')
    const responses = RESIDENCE_QUESTIONS.map((q, i) => ({ question: q, answer: answers[i] }))
    const res = await fetch(`/api/ref/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ responses }),
    })
    if (res.ok) {
      setSubmitted(true)
    } else {
      setError('Something went wrong. Please try again.')
    }
    setSubmitting(false)
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#f5f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');`}</style>
      <div style={{ fontSize: '14px', color: '#9b9b9b' }}>Loading…</div>
    </div>
  )

  if (notFound || !ref) return (
    <div style={{ minHeight: '100vh', background: '#f5f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif", padding: '24px' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');`}</style>
      <div style={{ textAlign: 'center', maxWidth: '400px' }}>
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔍</div>
        <div style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a1a', marginBottom: '8px' }}>Link not found</div>
        <div style={{ fontSize: '14px', color: '#9b9b9b', lineHeight: 1.6 }}>This reference link is invalid or has expired. Please contact the property management team if you believe this is a mistake.</div>
      </div>
    </div>
  )

  const alreadySubmitted = submitted || ref.status === 'verified'

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #f5f4f0; }

        .ref-page { min-height: 100vh; background: #f5f4f0; font-family: 'DM Sans', sans-serif; padding: 32px 16px 64px; }
        .ref-wrap { max-width: 600px; margin: 0 auto; }

        .hive-logo { font-size: 22px; font-weight: 800; color: #1a1a1a; letter-spacing: -0.5px; margin-bottom: 28px; }
        .hive-logo span { color: #FFC627; font-style: italic; }

        .context-card { background: #1a1a1a; border-radius: 14px; padding: 22px 24px; margin-bottom: 20px; }
        .context-label { font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
        .context-name { font-size: 22px; font-weight: 800; color: #fff; margin-bottom: 6px; line-height: 1.2; }
        .context-sub { font-size: 14px; color: rgba(255,255,255,0.55); line-height: 1.6; }
        .context-addr { display: inline-block; margin-top: 10px; font-size: 12px; font-weight: 600; color: #FFC627; }

        .intro-card { background: #fff; border: 1px solid #e8e5de; border-radius: 14px; padding: 20px 24px; margin-bottom: 24px; }
        .intro-text { font-size: 14px; color: #3a3a3a; line-height: 1.75; }

        .form-section { background: #fff; border: 1px solid #e8e5de; border-radius: 14px; padding: 24px; margin-bottom: 16px; }
        .q-label { font-size: 13px; font-weight: 600; color: #1a1a1a; margin-bottom: 8px; line-height: 1.5; }
        .q-num { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: #8C1D40; color: #fff; font-size: 10px; font-weight: 700; margin-right: 8px; flex-shrink: 0; }
        .q-row { display: flex; align-items: flex-start; margin-bottom: 18px; }
        .q-row:last-child { margin-bottom: 0; }
        .q-body { flex: 1; }
        .q-textarea { width: 100%; border: 1.5px solid #e8e5de; border-radius: 10px; padding: 10px 13px; font-size: 13px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; resize: vertical; min-height: 72px; outline: none; background: #faf9f6; line-height: 1.6; transition: border-color 0.15s; }
        .q-textarea:focus { border-color: #8C1D40; background: #fff; }
        .q-textarea:disabled { opacity: 0.65; cursor: not-allowed; }

        .submit-btn { width: 100%; background: #8C1D40; color: #fff; border: none; border-radius: 11px; padding: 14px; font-size: 15px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; }
        .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .submit-btn:hover:not(:disabled) { opacity: 0.88; }

        .error-msg { background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.25); border-radius: 9px; padding: 10px 14px; font-size: 13px; color: '#dc2626'; margin-bottom: 12px; }

        .success-card { background: #fff; border: 1px solid #e8e5de; border-radius: 14px; padding: 32px 24px; text-align: center; }
        .success-icon { font-size: 40px; margin-bottom: 14px; }
        .success-title { font-size: 20px; font-weight: 800; color: '#1a1a1a'; margin-bottom: 8px; }
        .success-sub { font-size: 14px; color: #6b6b6b; line-height: 1.7; }

        .footer-note { text-align: center; font-size: 11px; color: #b0a898; margin-top: 28px; line-height: 1.7; }

        @media (max-width: 480px) {
          .ref-page { padding: 20px 12px 48px; }
          .context-card { padding: 18px 16px; }
          .form-section { padding: 18px 16px; }
        }
      `}</style>

      <div className="ref-page">
        <div className="ref-wrap">

          {/* Logo */}
          <div className="hive-logo">Home<span>Hive</span></div>

          {/* Context header */}
          <div className="context-card">
            <div className="context-label">Rental Reference Request</div>
            <div className="context-name">{leadName}</div>
            <div className="context-sub">
              {leadName} has applied to rent a property managed by our team
              {ref.name ? ` and has listed you — ${ref.name} — as their previous landlord` : ' and has listed you as their previous landlord'}.
            </div>
            {ref.address && (
              <div className="context-addr">📍 {ref.address}</div>
            )}
          </div>

          {/* Intro */}
          <div className="intro-card">
            <p className="intro-text">
              As part of our standard tenant screening, we'd appreciate a few minutes of your time to answer the questions below. Your responses are confidential and will only be used for this rental application review. There are no right or wrong answers — honest feedback helps us make the best decision for everyone involved.
            </p>
          </div>

          {alreadySubmitted && submitted ? (
            <div className="success-card">
              <div className="success-icon">✅</div>
              <div className="success-title" style={{ fontSize: '20px', fontWeight: 800, color: '#1a1a1a', marginBottom: '8px' }}>Thank you!</div>
              <div className="success-sub">
                Your reference for <strong>{leadName}</strong> has been submitted successfully.<br />
                We genuinely appreciate you taking the time — it means a lot.
              </div>
            </div>
          ) : alreadySubmitted ? (
            <div className="success-card">
              <div className="success-icon">✅</div>
              <div className="success-title" style={{ fontSize: '20px', fontWeight: 800, color: '#1a1a1a', marginBottom: '8px' }}>Already submitted</div>
              <div className="success-sub">
                A reference for <strong>{leadName}</strong> has already been received through this link. Thank you for your time.
              </div>
            </div>
          ) : (
            <>
              <div className="form-section">
                {RESIDENCE_QUESTIONS.map((q, i) => (
                  <div key={i} className="q-row">
                    <span className="q-num">{i + 1}</span>
                    <div className="q-body">
                      <div className="q-label">{q}</div>
                      <textarea
                        className="q-textarea"
                        placeholder="Your answer…"
                        value={answers[i]}
                        onChange={e => {
                          const next = [...answers]
                          next[i] = e.target.value
                          setAnswers(next)
                        }}
                        disabled={submitting}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {error && (
                <div className="error-msg" style={{ color: '#dc2626' }}>{error}</div>
              )}

              <button
                className="submit-btn"
                disabled={submitting}
                onClick={handleSubmit}
              >
                {submitting ? 'Submitting…' : 'Submit Reference'}
              </button>
            </>
          )}

          <div className="footer-note">
            This reference request was sent securely via HomeHive.<br />
            Your response is confidential and protected.
          </div>

        </div>
      </div>
    </>
  )
}
