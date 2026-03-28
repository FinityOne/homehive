'use client'

import { useState, Suspense } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter, useSearchParams } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const registered = searchParams.get('registered')
  const next = searchParams.get('next')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  const handleLogin = async () => {
    if (!email || !password) { setError('Please fill in both fields.'); return }
    setLoading(true)
    setError('')

    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError || !data.user) {
      setError('Incorrect email or password. Try again.')
      setLoading(false)
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single()

    if (next) { router.push(next); return }
    const role = profile?.role || 'tenant'
    if (role === 'admin') router.push('/admin')
    else if (role === 'landlord') router.push('/landlord/dashboard')
    else router.push('/dashboard')
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,300;1,9..144,600&family=DM+Sans:wght@300;400;500;600&display=swap');

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .login-shell {
          min-height: calc(100svh - 58px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 16px 48px;
          background: #faf9f6;
          font-family: 'DM Sans', sans-serif;
        }

        .login-card {
          width: 100%;
          max-width: 400px;
          background: #fff;
          border: 1px solid #e8e4db;
          border-radius: 20px;
          padding: 36px 32px 32px;
          box-shadow: 0 4px 40px rgba(0,0,0,0.07);
          animation: fadeUp 0.28s ease both;
        }

        .login-input {
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
          -webkit-text-size-adjust: 100%;
        }
        .login-input:focus {
          border-color: #8C1D40;
          background: #fff;
          box-shadow: 0 0 0 3px rgba(140,29,64,0.08);
        }
        .login-input.has-toggle { padding-right: 56px; }

        .login-btn {
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
          letter-spacing: 0.1px;
        }
        .login-btn:hover:not(:disabled) { background: #7a1835; transform: translateY(-1px); }
        .login-btn:active:not(:disabled) { transform: translateY(0); }
        .login-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255,255,255,0.35);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.65s linear infinite;
          flex-shrink: 0;
        }

        .pw-toggle {
          position: absolute;
          right: 14px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          font-size: 12px;
          font-weight: 600;
          font-family: 'DM Sans', sans-serif;
          color: #9b9b9b;
          cursor: pointer;
          padding: 4px 2px;
          letter-spacing: 0.3px;
          text-transform: uppercase;
          transition: color 0.15s;
          user-select: none;
        }
        .pw-toggle:hover { color: #1a1a1a; }

        @media (max-width: 420px) {
          .login-card { padding: 28px 20px 24px; border-radius: 16px; }
        }
      `}</style>

      <div className="login-shell">
        <div className="login-card">

          {/* Logo */}
          <a href="/" style={{ display: 'inline-block', marginBottom: '22px', textDecoration: 'none' }}>
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '21px', fontWeight: 600, color: '#1a1a1a', letterSpacing: '-0.3px' }}>
              Home<em style={{ fontFamily: "'Fraunces', serif", fontStyle: 'italic', color: '#FFC627' }}>Hive</em>
            </span>
          </a>

          {/* Headline */}
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: '26px', fontWeight: 300, color: '#1a1a1a', letterSpacing: '-0.4px', lineHeight: 1.2, marginBottom: '7px' }}>
            Welcome back.
          </div>
          <div style={{ fontSize: '13px', color: '#9b9b9b', lineHeight: 1.55, marginBottom: '28px' }}>
            Your next home near ASU is waiting — sign in to pick up where you left off.
          </div>

          {/* Alerts */}
          {registered && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '11px 14px', fontSize: '13px', color: '#166534', marginBottom: '18px', lineHeight: 1.4 }}>
              Account created — you&apos;re all set. Sign in below.
            </div>
          )}
          {error && (
            <div style={{ background: '#fdf2f5', border: '1px solid #f5c6d0', borderRadius: '10px', padding: '11px 14px', fontSize: '13px', color: '#8C1D40', marginBottom: '18px', lineHeight: 1.4 }}>
              {error}
            </div>
          )}

          {/* Email */}
          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="login-email" style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              placeholder="you@asu.edu"
              value={email}
              onChange={e => { setEmail(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              className="login-input"
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: '6px' }}>
            <label htmlFor="login-password" style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="login-password"
                type={showPw ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                className={`login-input${showPw ? '' : ' has-toggle'}`}
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={() => setShowPw(v => !v)}
                tabIndex={-1}
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            className="login-btn"
            onClick={handleLogin}
            disabled={loading}
            style={{ marginTop: '22px', marginBottom: '20px' }}
          >
            {loading ? <><span className="spinner" />Signing in…</> : 'Sign in'}
          </button>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
            <div style={{ flex: 1, height: '1px', background: '#e8e4db' }} />
            <span style={{ fontSize: '12px', color: '#c5c0b5' }}>or</span>
            <div style={{ flex: 1, height: '1px', background: '#e8e4db' }} />
          </div>

          {/* Sign up CTA */}
          <div style={{ textAlign: 'center', fontSize: '13px', color: '#9b9b9b' }}>
            New to HomeHive?{' '}
            <a href={`/signup${next ? `?next=${encodeURIComponent(next)}&role=landlord` : ''}`} style={{ color: '#8C1D40', fontWeight: 600, textDecoration: 'none' }}>
              Create a free account →
            </a>
          </div>

          {/* Trust signals */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '12px', marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #f0ede6' }}>
            {['✓ Verified ASU housing', '✓ No broker fees', '✓ Flexible move-in'].map(t => (
              <span key={t} style={{ fontSize: '11px', color: '#b5b0a6' }}>{t}</span>
            ))}
          </div>

        </div>
      </div>
    </>
  )
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>
}
