'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [showPw, setShowPw]       = useState(false)
  const [loading, setLoading]     = useState(false)
  const [ready, setReady]         = useState(false)
  const [done, setDone]           = useState(false)
  const [error, setError]         = useState('')

  // Wait for the recovery session to be established from the auth callback
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setReady(true)
      } else {
        // No session — recovery link was not used, redirect
        router.replace('/forgot-password')
      }
    })
  }, [router])

  const handleReset = async () => {
    if (!password) { setError('Please enter a new password.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords don\'t match.'); return }

    setLoading(true)
    setError('')

    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message || 'Failed to update password. Please try again.')
      setLoading(false)
      return
    }

    setDone(true)

    // Get role to redirect correctly
    const { data: { user } } = await supabase.auth.getUser()
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user!.id).single()
    const role = profile?.role || 'tenant'

    setTimeout(() => {
      if (role === 'admin') router.push('/admin')
      else if (role === 'landlord') router.push('/landlord/dashboard')
      else router.push('/dashboard')
    }, 2000)
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

        .rp-shell {
          min-height: calc(100svh - 58px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 16px 48px;
          background: #faf9f6;
          font-family: 'DM Sans', sans-serif;
        }
        .rp-card {
          width: 100%;
          max-width: 400px;
          background: #fff;
          border: 1px solid #e8e4db;
          border-radius: 20px;
          padding: 36px 32px 32px;
          box-shadow: 0 4px 40px rgba(0,0,0,0.07);
          animation: fadeUp 0.28s ease both;
        }
        .rp-input {
          width: 100%;
          height: 48px;
          padding: 0 56px 0 14px;
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
        .rp-input:focus {
          border-color: #8C1D40;
          background: #fff;
          box-shadow: 0 0 0 3px rgba(140,29,64,0.08);
        }
        .rp-btn {
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
        .rp-btn:hover:not(:disabled) { background: #7a1835; transform: translateY(-1px); }
        .rp-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .pw-toggle {
          position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
          background: none; border: none; font-size: 12px; font-weight: 600;
          font-family: 'DM Sans', sans-serif; color: #9b9b9b; cursor: pointer;
          padding: 4px 2px; letter-spacing: 0.3px; text-transform: uppercase;
          transition: color 0.15s; user-select: none;
        }
        .pw-toggle:hover { color: #1a1a1a; }
        .spinner {
          width: 16px; height: 16px;
          border: 2px solid rgba(255,255,255,0.35);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.65s linear infinite;
          flex-shrink: 0;
        }
        @media (max-width: 420px) {
          .rp-card { padding: 28px 20px 24px; border-radius: 16px; }
        }
      `}</style>

      <div className="rp-shell">
        <div className="rp-card">

          {/* Logo */}
          <a href="/" style={{ display: 'inline-block', marginBottom: '22px', textDecoration: 'none' }}>
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '21px', fontWeight: 600, color: '#1a1a1a', letterSpacing: '-0.3px' }}>
              Home<em style={{ fontFamily: "'Fraunces', serif", fontStyle: 'italic', color: '#FFC627' }}>Hive</em>
            </span>
          </a>

          {done ? (
            /* ── Success state ── */
            <>
              <div style={{ fontSize: '40px', marginBottom: '16px' }}>✅</div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: '24px', fontWeight: 300, color: '#1a1a1a', letterSpacing: '-0.4px', lineHeight: 1.2, marginBottom: '10px' }}>
                Password updated!
              </div>
              <div style={{ fontSize: '14px', color: '#6b6b6b', lineHeight: 1.6 }}>
                Your new password is set. Taking you to your dashboard…
              </div>
            </>
          ) : !ready ? (
            /* ── Loading state ── */
            <div style={{ textAlign: 'center', padding: '20px 0', color: '#9b9b9b', fontSize: '14px' }}>
              Verifying your reset link…
            </div>
          ) : (
            /* ── Password form ── */
            <>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: '26px', fontWeight: 300, color: '#1a1a1a', letterSpacing: '-0.4px', lineHeight: 1.2, marginBottom: '7px' }}>
                Set a new password.
              </div>
              <div style={{ fontSize: '13px', color: '#9b9b9b', lineHeight: 1.55, marginBottom: '28px' }}>
                Choose something strong that you don&apos;t use elsewhere.
              </div>

              {error && (
                <div style={{ background: '#fdf2f5', border: '1px solid #f5c6d0', borderRadius: '10px', padding: '11px 14px', fontSize: '13px', color: '#8C1D40', marginBottom: '18px', lineHeight: 1.4 }}>
                  {error}
                </div>
              )}

              {/* New password */}
              <div style={{ marginBottom: '14px' }}>
                <label htmlFor="rp-password" style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>
                  New password
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="rp-password"
                    type={showPw ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Min. 8 characters"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError('') }}
                    onKeyDown={e => e.key === 'Enter' && handleReset()}
                    className="rp-input"
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                  />
                  <button type="button" className="pw-toggle" onClick={() => setShowPw(v => !v)} tabIndex={-1}>
                    {showPw ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              {/* Confirm password */}
              <div style={{ marginBottom: '22px' }}>
                <label htmlFor="rp-confirm" style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>
                  Confirm password
                </label>
                <input
                  id="rp-confirm"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Repeat your password"
                  value={confirm}
                  onChange={e => { setConfirm(e.target.value); setError('') }}
                  onKeyDown={e => e.key === 'Enter' && handleReset()}
                  className="rp-input"
                  style={{ paddingRight: '14px' }}
                />
              </div>

              <button className="rp-btn" onClick={handleReset} disabled={loading}>
                {loading ? <><span className="spinner" />Updating…</> : 'Update password'}
              </button>
            </>
          )}

        </div>
      </div>
    </>
  )
}
