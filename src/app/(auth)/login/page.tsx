'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter, useSearchParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const RESEND_COOLDOWN = 30

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const ph = usePostHog()
  const registered = searchParams.get('registered')
  const next = searchParams.get('next')
  const prefillEmail = searchParams.get('email') || ''
  const oauthError = searchParams.get('error')

  const [step, setStep]       = useState<'email' | 'code'>('email')
  const [email, setEmail]     = useState(prefillEmail)
  const [code, setCode]       = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)

  // Resend cooldown ticker
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown(c => (c <= 1 ? 0 : c - 1)), 1000)
    return () => clearInterval(t)
  }, [cooldown])

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus()
  }, [step])

  const handleGoogleLogin = async () => {
    setLoading(true)
    const redirectTo = `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
  }

  const sendCode = async (isResend = false) => {
    if (!email) { setError('Please enter your email.'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Please enter a valid email address.'); return }
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, mode: 'login' }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        setLoading(false)
        return
      }

      ph?.capture(isResend ? 'login_code_resent' : 'login_code_sent')
      setStep('code')
      setCooldown(RESEND_COOLDOWN)
    } catch {
      setError('Network error. Please check your connection and try again.')
    }
    setLoading(false)
  }

  const handleVerify = async () => {
    if (code.length < 6) { setError('Enter the 6-digit code from your email.'); return }
    setLoading(true)
    setError('')

    const { data, error: authError } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    })

    if (authError || !data.user) {
      const msg = authError?.message?.toLowerCase() || ''
      let errorText = 'That code isn’t right. Double-check and try again.'
      if (msg.includes('expired') || msg.includes('invalid')) {
        errorText = 'That code is invalid or expired. Request a new one below.'
      } else if (msg.includes('too many') || msg.includes('rate limit')) {
        errorText = 'Too many attempts. Please wait a few minutes and try again.'
      }
      setError(errorText)
      ph?.capture('login_failed', { error: authError?.message || 'invalid_code' })
      setLoading(false)
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single()

    const role = profile?.role || 'tenant'
    ph?.capture('login_completed', { role })

    if (next) { router.push(next); return }
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

        .code-input {
          width: 100%;
          height: 64px;
          padding: 0 14px;
          border: 1.5px solid #e8e4db;
          border-radius: 12px;
          font-size: 30px;
          font-weight: 600;
          font-family: 'SF Mono', ui-monospace, Menlo, Consolas, monospace;
          text-align: center;
          letter-spacing: 12px;
          color: #1a1a1a;
          background: #faf9f6;
          outline: none;
          box-sizing: border-box;
          transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
        }
        .code-input::placeholder { letter-spacing: 8px; color: #d4cfc4; }
        .code-input:focus {
          border-color: #8C1D40;
          background: #fff;
          box-shadow: 0 0 0 3px rgba(140,29,64,0.08);
        }

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

        .text-link {
          background: none; border: none; cursor: pointer;
          font-family: 'DM Sans', sans-serif; font-weight: 600;
          color: #8C1D40; padding: 0;
        }
        .text-link:disabled { color: #c5c0b5; cursor: not-allowed; }

        .google-btn {
          width: 100%;
          height: 48px;
          background: #fff;
          border: 1.5px solid #e8e4db;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 600;
          font-family: 'DM Sans', sans-serif;
          color: #1a1a1a;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          transition: border-color 0.15s, box-shadow 0.15s;
          letter-spacing: 0.1px;
        }
        .google-btn:hover { border-color: #c5c1b8; box-shadow: 0 2px 8px rgba(0,0,0,0.07); }
        .google-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .or-divider {
          display: flex; align-items: center; gap: 10px; margin: 18px 0;
        }
        .or-divider-line { flex: 1; height: 1px; background: #e8e4db; }
        .or-divider-text { font-size: 12px; color: #c5c0b5; }

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
            {step === 'email' ? 'Welcome back.' : 'Check your email.'}
          </div>
          <div style={{ fontSize: '13px', color: '#9b9b9b', lineHeight: 1.55, marginBottom: '28px' }}>
            {step === 'email'
              ? 'Enter your email and we’ll send you a sign-in code — no password needed.'
              : <>We sent a 6-digit code to <strong style={{ color: '#1a1a1a' }}>{email}</strong>. Enter it below to sign in.</>}
          </div>

          {/* Alerts */}
          {registered && step === 'email' && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '11px 14px', fontSize: '13px', color: '#166534', marginBottom: '18px', lineHeight: 1.4 }}>
              Account created — you&apos;re all set. Sign in below.
            </div>
          )}
          {oauthError && !error && (
            <div style={{ background: '#fdf2f5', border: '1px solid #f5c6d0', borderRadius: '10px', padding: '11px 14px', fontSize: '13px', color: '#8C1D40', marginBottom: '18px', lineHeight: 1.4 }}>
              {oauthError === 'oauth_failed'
                ? 'Google sign-in failed. Please try again or use email below.'
                : 'Something went wrong. Please try signing in again.'}
            </div>
          )}
          {error && (
            <div style={{ background: '#fdf2f5', border: '1px solid #f5c6d0', borderRadius: '10px', padding: '11px 14px', fontSize: '13px', color: '#8C1D40', marginBottom: '18px', lineHeight: 1.4 }}>
              {error}
            </div>
          )}

          {step === 'email' ? (
            <>
              {/* Google */}
              <button className="google-btn" onClick={handleGoogleLogin} disabled={loading}>
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </button>

              <div className="or-divider">
                <div className="or-divider-line" />
                <span className="or-divider-text">or continue with email</span>
                <div className="or-divider-line" />
              </div>

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
                  placeholder="you@email.com"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError('') }}
                  onKeyDown={e => e.key === 'Enter' && sendCode()}
                  className="login-input"
                />
              </div>

              {/* Submit */}
              <button
                className="login-btn"
                onClick={() => sendCode()}
                disabled={loading}
                style={{ marginTop: '8px', marginBottom: '20px' }}
              >
                {loading ? <><span className="spinner" />Sending code…</> : 'Send sign-in code'}
              </button>
            </>
          ) : (
            <>
              {/* Code entry */}
              <div style={{ marginBottom: '16px' }}>
                <label htmlFor="login-code" style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px' }}>
                  6-digit code
                </label>
                <input
                  id="login-code"
                  ref={codeRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="······"
                  value={code}
                  onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
                  onKeyDown={e => e.key === 'Enter' && handleVerify()}
                  className="code-input"
                />
              </div>

              <button
                className="login-btn"
                onClick={handleVerify}
                disabled={loading || code.length < 6}
                style={{ marginTop: '8px', marginBottom: '16px' }}
              >
                {loading ? <><span className="spinner" />Verifying…</> : 'Sign in'}
              </button>

              <div style={{ textAlign: 'center', fontSize: '13px', color: '#9b9b9b', marginBottom: '4px' }}>
                Didn’t get it?{' '}
                <button
                  className="text-link"
                  onClick={() => sendCode(true)}
                  disabled={loading || cooldown > 0}
                  style={{ fontSize: '13px' }}
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </button>
              </div>
              <div style={{ textAlign: 'center', fontSize: '12px' }}>
                <button
                  className="text-link"
                  onClick={() => { setStep('email'); setCode(''); setError('') }}
                  style={{ color: '#9b9b9b', fontWeight: 500, fontSize: '12px' }}
                >
                  ← Use a different email
                </button>
              </div>
            </>
          )}

          {/* Sign up CTA */}
          {step === 'email' && (
            <div style={{ textAlign: 'center', fontSize: '13px', color: '#9b9b9b' }}>
              New to HomeHive?{' '}
              <a href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ''}`} style={{ color: '#8C1D40', fontWeight: 600, textDecoration: 'none' }}>
                Create a free account →
              </a>
            </div>
          )}

          {/* Trust signals */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '12px', marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #f0ede6' }}>
            {['✓ Verified listings', '✓ No broker fees', '✓ Flexible move-in'].map(t => (
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
