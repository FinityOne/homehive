'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

function ForgotPasswordForm() {
  const searchParams = useSearchParams()
  const prefillEmail = searchParams.get('email') || ''

  const [email, setEmail]     = useState(prefillEmail)
  const [loading, setLoading] = useState(false)
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState('')

  const handleSubmit = async () => {
    if (!email.trim()) { setError('Please enter your email address.'); return }
    setLoading(true)
    setError('')
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      setSent(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,300;1,9..144,600&family=DM+Sans:wght@300;400;500;600&display=swap');

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .fp-shell {
          min-height: calc(100svh - 58px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 16px 48px;
          background: #faf9f6;
          font-family: 'DM Sans', sans-serif;
        }
        .fp-card {
          width: 100%;
          max-width: 400px;
          background: #fff;
          border: 1px solid #e8e4db;
          border-radius: 20px;
          padding: 36px 32px 32px;
          box-shadow: 0 4px 40px rgba(0,0,0,0.07);
          animation: fadeUp 0.28s ease both;
        }
        .fp-input {
          width: 100%;
          height: 48px;
          padding: 0 14px;
          border: 1.5px solid #e8e4db;
          border-radius: 10px;
          font-size: 15px;
          font-family: 'DM Sans', sans-serif;
          color: #1a1a1a;
          background: #faf9f6;
          outline: none;
          box-sizing: border-box;
          transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
        }
        .fp-input:focus {
          border-color: #8C1D40;
          background: #fff;
          box-shadow: 0 0 0 3px rgba(140,29,64,0.08);
        }
        .fp-btn {
          width: 100%;
          height: 50px;
          background: #8C1D40;
          color: #fff;
          border: none;
          border-radius: 10px;
          font-size: 15px;
          font-weight: 600;
          font-family: 'DM Sans', sans-serif;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: background 0.15s, transform 0.1s, opacity 0.15s;
        }
        .fp-btn:hover:not(:disabled) { background: #7a1835; transform: translateY(-1px); }
        .fp-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .spinner {
          width: 16px; height: 16px;
          border: 2px solid rgba(255,255,255,0.35);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.65s linear infinite;
          flex-shrink: 0;
        }
        @media (max-width: 420px) {
          .fp-card { padding: 28px 20px 24px; border-radius: 16px; }
        }
      `}</style>

      <div className="fp-shell">
        <div className="fp-card">

          {/* Logo */}
          <a href="/" style={{ display: 'inline-block', marginBottom: '22px', textDecoration: 'none' }}>
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '21px', fontWeight: 600, color: '#1a1a1a', letterSpacing: '-0.3px' }}>
              Home<em style={{ fontFamily: "'Fraunces', serif", fontStyle: 'italic', color: '#FFC627' }}>Hive</em>
            </span>
          </a>

          {sent ? (
            /* ── Success state ── */
            <>
              <div style={{ fontSize: '40px', marginBottom: '16px' }}>📬</div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: '24px', fontWeight: 300, color: '#1a1a1a', letterSpacing: '-0.4px', lineHeight: 1.2, marginBottom: '10px' }}>
                Check your inbox.
              </div>
              <div style={{ fontSize: '14px', color: '#6b6b6b', lineHeight: 1.6, marginBottom: '24px' }}>
                If <strong style={{ color: '#1a1a1a' }}>{email}</strong> is registered with HomeHive, you&apos;ll receive a reset link shortly. Check your spam folder if you don&apos;t see it within a minute.
              </div>
              <div style={{ fontSize: '13px', color: '#9b9b9b', marginBottom: '20px' }}>
                The link expires in 1 hour.
              </div>
              <a href="/login" style={{ display: 'block', textAlign: 'center', fontSize: '14px', color: '#8C1D40', fontWeight: 600, textDecoration: 'none' }}>
                ← Back to sign in
              </a>
            </>
          ) : (
            /* ── Request form ── */
            <>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: '26px', fontWeight: 300, color: '#1a1a1a', letterSpacing: '-0.4px', lineHeight: 1.2, marginBottom: '7px' }}>
                Forgot your password?
              </div>
              <div style={{ fontSize: '13px', color: '#9b9b9b', lineHeight: 1.55, marginBottom: '28px' }}>
                Enter the email on your account and we&apos;ll send you a secure reset link.
              </div>

              {error && (
                <div style={{ background: '#fdf2f5', border: '1px solid #f5c6d0', borderRadius: '10px', padding: '11px 14px', fontSize: '13px', color: '#8C1D40', marginBottom: '18px', lineHeight: 1.4 }}>
                  {error}
                </div>
              )}

              <div style={{ marginBottom: '20px' }}>
                <label htmlFor="fp-email" style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>
                  Email
                </label>
                <input
                  id="fp-email"
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  placeholder="you@email.com"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError('') }}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  className="fp-input"
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                />
              </div>

              <button className="fp-btn" onClick={handleSubmit} disabled={loading}>
                {loading ? <><span className="spinner" />Sending…</> : 'Send reset link'}
              </button>

              <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px', color: '#9b9b9b' }}>
                <a href="/login" style={{ color: '#8C1D40', fontWeight: 600, textDecoration: 'none' }}>
                  ← Back to sign in
                </a>
              </div>
            </>
          )}

        </div>
      </div>
    </>
  )
}

export default function ForgotPasswordPage() {
  return <Suspense fallback={null}><ForgotPasswordForm /></Suspense>
}
