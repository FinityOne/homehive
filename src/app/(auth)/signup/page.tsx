'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { DEFAULT_CODE_LENGTH, normalizeCodeLength, sanitizeCode } from '@/lib/authCode'

const RESEND_COOLDOWN = 30

type Role = 'student' | 'landlord'
type Step = 'pick' | 'form'

// ─── ROLE PICKER ─────────────────────────────────────────────────────────────

function RolePicker({ onPick }: { onPick: (role: Role) => void }) {
  const ph = usePostHog()

  const handlePick = (role: Role) => {
    ph?.capture('signup_role_selected', { role })
    onPick(role)
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; background: #faf9f6; }
        .pick-card {
          background: #fff; border: 1.5px solid #e8e4db; border-radius: 14px;
          padding: 28px 28px 24px; cursor: pointer; text-align: left;
          transition: border-color 0.15s, box-shadow 0.15s;
          width: 100%;
        }
        .pick-card:hover {
          border-color: #8C1D40;
          box-shadow: 0 4px 20px rgba(140,29,64,0.08);
        }
        .pick-card-label {
          font-size: 10px; font-weight: 700; letter-spacing: 0.7px; text-transform: uppercase;
          margin-bottom: 10px;
        }
        .pick-card-title {
          font-size: 19px; font-weight: 600; color: #1a1a1a; margin-bottom: 8px; letter-spacing: -0.3px;
        }
        .pick-card-desc {
          font-size: 13px; color: #6b6b6b; line-height: 1.55; margin-bottom: 18px;
        }
        .pick-card-features {
          display: flex; flex-direction: column; gap: 6px; margin-bottom: 22px;
        }
        .pick-card-feature {
          display: flex; align-items: flex-start; gap: 9px; font-size: 12.5px; color: #4a4a4a; line-height: 1.4;
        }
        .pick-card-feature-dot {
          width: 5px; height: 5px; border-radius: 50%; background: #8C1D40;
          flex-shrink: 0; margin-top: 5px;
        }
        .pick-cta {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 13px; font-weight: 600; font-family: 'DM Sans', sans-serif;
          color: #8C1D40; background: none; border: none; cursor: pointer; padding: 0;
        }
        .pick-divider {
          display: flex; align-items: center; gap: 12px;
          font-size: 11px; color: #c5c1b8; font-weight: 500;
        }
        .pick-divider-line { flex: 1; height: 1px; background: #e8e4db; }
      `}</style>

      <div style={{ minHeight: '100vh', background: '#faf9f6', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ width: '100%', maxWidth: '460px' }}>

          {/* Logo */}
          <div style={{ marginBottom: '36px' }}>
            <a href="/" style={{ display: 'inline-block', textDecoration: 'none', marginBottom: '4px' }}>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '20px', fontWeight: 600, color: '#1a1a1a', letterSpacing: '-0.3px' }}>
                Home<em style={{ fontFamily: "'Fraunces', serif", fontStyle: 'italic', color: '#FFC627' }}>Hive</em>
              </span>
            </a>
            <div style={{ fontSize: '22px', fontWeight: 600, color: '#1a1a1a', letterSpacing: '-0.4px', marginTop: '16px' }}>
              What brings you here?
            </div>
            <div style={{ fontSize: '14px', color: '#9b9b9b', marginTop: '4px' }}>
              Choose the account type that fits your needs.
            </div>
          </div>

          {/* Cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

            {/* Find a place */}
            <button className="pick-card" onClick={() => handlePick('student')}>
              <div className="pick-card-label" style={{ color: '#8C1D40' }}>For renters</div>
              <div className="pick-card-title">Find a place</div>
              <div className="pick-card-desc">
                Browse quality housing, contact landlords directly, and secure your next home — all in one place.
              </div>
              <div className="pick-card-features">
                <div className="pick-card-feature"><span className="pick-card-feature-dot" />Browse verified listings near campus</div>
                <div className="pick-card-feature"><span className="pick-card-feature-dot" />Contact landlords and schedule tours</div>
                <div className="pick-card-feature"><span className="pick-card-feature-dot" />Save and compare your favorite places</div>
              </div>
              <span className="pick-cta">Get started &rarr;</span>
            </button>

            <div className="pick-divider">
              <span className="pick-divider-line" />
              or
              <span className="pick-divider-line" />
            </div>

            {/* List a place */}
            <button className="pick-card" onClick={() => handlePick('landlord')}>
              <div className="pick-card-label" style={{ color: '#0369a1' }}>For landlords &amp; subleases</div>
              <div className="pick-card-title">List a place</div>
              <div className="pick-card-desc">
                Whether you own a property or are subleasing for the summer, reach thousands of renters actively looking for their next home.
              </div>
              <div className="pick-card-features">
                <div className="pick-card-feature"><span className="pick-card-feature-dot" />Create and manage your listing for free</div>
                <div className="pick-card-feature"><span className="pick-card-feature-dot" />Receive and track inquiries in one dashboard</div>
                <div className="pick-card-feature"><span className="pick-card-feature-dot" />Works for full rentals, rooms, and subleases</div>
              </div>
              <span className="pick-cta" style={{ color: '#0369a1' }}>Get started &rarr;</span>
            </button>

          </div>

          <div style={{ textAlign: 'center', marginTop: '24px', fontSize: '13px', color: '#9b9b9b' }}>
            Already have an account?{' '}
            <a href="/login" style={{ color: '#8C1D40', fontWeight: 500, textDecoration: 'none' }}>Sign in</a>
          </div>

        </div>
      </div>
    </>
  )
}

// ─── SIGNUP FORM ─────────────────────────────────────────────────────────────

function SignupForm({ initialRole, onBack, next = '', prefillEmail = '' }: { initialRole: Role; onBack: () => void; next?: string; prefillEmail?: string }) {
  const router = useRouter()
  const ph = usePostHog()

  const [role, setRole] = useState<Role>(initialRole)
  const [stage, setStage] = useState<'form' | 'code'>('form')
  const [form, setForm] = useState({ name: '', email: prefillEmail, phone: '' })
  const [code, setCode] = useState('')
  // Digits in the emailed code — reported by /api/auth/send-code so the input
  // always fits the code we actually sent (see src/lib/authCode.ts).
  const [codeLength, setCodeLength] = useState(DEFAULT_CODE_LENGTH)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)

  // Reset role-specific fields when toggling
  useEffect(() => {
    setForm(prev => ({ ...prev, phone: '' }))
    setError('')
  }, [role])

  // Resend cooldown ticker
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown(c => (c <= 1 ? 0 : c - 1)), 1000)
    return () => clearInterval(t)
  }, [cooldown])

  useEffect(() => {
    if (stage === 'code') codeRef.current?.focus()
  }, [stage])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
    setError('')
  }

  const sendCode = async (isResend = false) => {
    if (!form.name || !form.email) { setError('All fields are required.'); return }
    if (role === 'landlord' && !form.phone) { setError('All fields are required.'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) { setError('Please enter a valid email address.'); return }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          mode: 'signup',
          name: form.name,
          role: role === 'landlord' ? 'landlord' : 'tenant',
          ...(role === 'landlord' ? { phone: form.phone } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.status === 409 || data.error === 'exists') {
        setError('DUPLICATE_EMAIL')
        ph?.capture('signup_failed', { role, error: 'duplicate_email' })
        setLoading(false)
        return
      }
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        ph?.capture('signup_failed', { role, error: data.error || 'send_code_failed' })
        setLoading(false)
        return
      }

      const len = normalizeCodeLength(data.codeLength)
      setCodeLength(len)
      setCode(c => sanitizeCode(c, len))
      ph?.capture(isResend ? 'signup_code_resent' : 'signup_code_sent', { role })
      setStage('code')
      setCooldown(RESEND_COOLDOWN)
    } catch {
      setError('Network error. Please check your connection and try again.')
    }
    setLoading(false)
  }

  const handleVerify = async () => {
    if (code.length < codeLength) { setError(`Enter the ${codeLength}-digit code from your email.`); return }
    setLoading(true)
    setError('')

    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email: form.email,
      token: code,
      type: 'email',
    })

    if (verifyError || !data.user) {
      const msg = verifyError?.message?.toLowerCase() || ''
      let errorText = 'That code isn’t right. Double-check and try again.'
      if (msg.includes('expired') || msg.includes('invalid')) {
        errorText = 'That code is invalid or expired. Request a new one below.'
      } else if (msg.includes('too many') || msg.includes('rate limit')) {
        errorText = 'Too many attempts. Please wait a few minutes and try again.'
      }
      setError(errorText)
      setLoading(false)
      return
    }

    // Landlords: persist phone (the new-user trigger only sets role + name)
    if (role === 'landlord' && form.phone) {
      await supabase
        .from('profiles')
        .update({ phone: form.phone, full_name: form.name })
        .eq('id', data.user.id)
    }

    // Notify admin of new signup (fire-and-forget)
    fetch('/api/auth/notify-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name, email: form.email, role }),
    }).catch(() => {})

    ph?.capture('signup_completed', { role, has_session: !!data.session })

    router.push(next || (role === 'landlord' ? '/landlord/dashboard' : '/dashboard'))
  }

  const handleGoogleSignup = async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('role', role === 'landlord' ? 'landlord' : 'tenant')
    if (next) params.set('next', next)
    const redirectTo = `${window.location.origin}/auth/callback?${params.toString()}`
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
  }

  const isLandlord = role === 'landlord'

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; background: #faf9f6; }
        .f label { display: block; font-size: 11px; font-weight: 600; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px; }
        .f input {
          width: 100%; padding: 10px 14px; border: 1.5px solid #e8e4db; border-radius: 8px;
          font-size: 14px; font-family: 'DM Sans', sans-serif; outline: none;
          transition: border-color 0.15s; color: #1a1a1a; background: #fff;
        }
        .f input:focus { border-color: #8C1D40; }
        .code-input {
          width: 100%; height: 64px; padding: 0 14px; border: 1.5px solid #e8e4db;
          border-radius: 10px; font-size: 30px; font-weight: 600;
          font-family: 'SF Mono', ui-monospace, Menlo, Consolas, monospace;
          text-align: center; letter-spacing: 12px; color: #1a1a1a; background: #faf9f6;
          outline: none; box-sizing: border-box; transition: border-color 0.15s, background 0.15s;
        }
        .code-input::placeholder { letter-spacing: 8px; color: #d4cfc4; }
        .code-input:focus { border-color: #8C1D40; background: #fff; }
        .text-link {
          background: none; border: none; cursor: pointer;
          font-family: 'DM Sans', sans-serif; font-weight: 600; color: #8C1D40; padding: 0;
        }
        .text-link:disabled { color: #c5c0b5; cursor: not-allowed; }
        .google-btn {
          width: 100%; height: 46px; background: #fff; border: 1.5px solid #e8e4db;
          border-radius: 8px; font-size: 14px; font-weight: 600;
          font-family: 'DM Sans', sans-serif; color: #1a1a1a; cursor: pointer;
          display: flex; align-items: center; justify-content: center; gap: 10px;
          transition: border-color 0.15s, box-shadow 0.15s; margin-bottom: 16px;
        }
        .google-btn:hover { border-color: #c5c1b8; box-shadow: 0 2px 8px rgba(0,0,0,0.07); }
        .google-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .or-divider { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
        .or-divider-line { flex: 1; height: 1px; background: #e8e4db; }
        .or-divider-text { font-size: 12px; color: #c5c1b8; }
        .role-toggle { display: flex; background: #f5f4f0; border-radius: 10px; padding: 3px; gap: 2px; }
        .role-btn {
          flex: 1; padding: 9px 12px; border-radius: 8px; border: none; cursor: pointer;
          font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500;
          transition: all 0.15s; background: transparent; color: #9b9b9b;
        }
        .role-btn.active {
          background: #fff; color: #1a1a1a; font-weight: 600;
          box-shadow: 0 1px 4px rgba(0,0,0,0.10);
        }
        .back-btn {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 13px; color: #9b9b9b; background: none; border: none;
          cursor: pointer; padding: 0; font-family: 'DM Sans', sans-serif;
          transition: color 0.15s;
        }
        .back-btn:hover { color: #1a1a1a; }
      `}</style>

      <div style={{ minHeight: '100vh', background: '#faf9f6', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ background: '#fff', border: '1px solid #e8e4db', borderRadius: '16px', padding: '40px', width: '100%', maxWidth: '420px' }}>

          {/* Back + Logo */}
          <div style={{ marginBottom: '20px' }}>
            <button className="back-btn" onClick={stage === 'code' ? () => { setStage('form'); setCode(''); setError('') } : onBack}>
              &larr; Back
            </button>
          </div>
          <a href="/" style={{ display: 'inline-block', marginBottom: '6px', textDecoration: 'none' }}>
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '20px', fontWeight: 600, color: '#1a1a1a', letterSpacing: '-0.3px' }}>
              Home<em style={{ fontFamily: "'Fraunces', serif", fontStyle: 'italic', color: '#FFC627' }}>Hive</em>
            </span>
          </a>
          <div style={{ fontSize: '14px', color: '#9b9b9b', marginBottom: '28px' }}>
            {stage === 'code'
              ? <>Enter the {codeLength}-digit code we sent to <strong style={{ color: '#1a1a1a' }}>{form.email}</strong>.</>
              : isLandlord ? 'List your place on HomeHive' : 'Find your perfect place on HomeHive'}
          </div>

          {/* Error */}
          {error && (
            <div style={{ background: '#fdf2f5', border: '1px solid #f5c6d0', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#8C1D40', marginBottom: '20px' }}>
              {error === 'DUPLICATE_EMAIL' ? (
                <>
                  An account with this email already exists.{' '}
                  <a href={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`} style={{ color: '#8C1D40', fontWeight: 700, textDecoration: 'underline' }}>
                    Sign in instead →
                  </a>
                </>
              ) : error}
            </div>
          )}

          {stage === 'form' ? (
            <>
              {/* Role toggle */}
              <div style={{ marginBottom: '28px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>I want to</div>
                <div className="role-toggle">
                  <button className={`role-btn${role === 'student' ? ' active' : ''}`} onClick={() => setRole('student')}>
                    Find a place
                  </button>
                  <button className={`role-btn${role === 'landlord' ? ' active' : ''}`} onClick={() => setRole('landlord')}>
                    List a place
                  </button>
                </div>
              </div>

              {/* Google */}
              <button className="google-btn" onClick={handleGoogleSignup} disabled={loading}>
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
                <span className="or-divider-text">or sign up with email</span>
                <div className="or-divider-line" />
              </div>

              {/* Fields */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '24px' }} className="f">
                <div>
                  <label>Full name</label>
                  <input name="name" placeholder="Your name" value={form.name} onChange={handleChange} />
                </div>
                <div>
                  <label>Email</label>
                  <input
                    name="email" type="email" placeholder="you@email.com"
                    value={form.email} onChange={handleChange}
                    autoComplete="email" autoCapitalize="none"
                    onKeyDown={e => e.key === 'Enter' && sendCode()}
                  />
                </div>
                {isLandlord && (
                  <div>
                    <label>Phone</label>
                    <input
                      name="phone" type="tel" placeholder="(480) 000-0000"
                      value={form.phone} onChange={handleChange}
                      onKeyDown={e => e.key === 'Enter' && sendCode()}
                    />
                  </div>
                )}
              </div>

              {/* Submit */}
              <button
                onClick={() => sendCode()}
                disabled={loading}
                style={{ width: '100%', background: '#8C1D40', color: '#fff', border: 'none', borderRadius: '8px', padding: '13px', fontSize: '14px', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif", opacity: loading ? 0.6 : 1, marginBottom: '16px' }}
              >
                {loading ? 'Sending code…' : 'Send verification code'}
              </button>

              <div style={{ textAlign: 'center', fontSize: '13px', color: '#9b9b9b' }}>
                Already have an account?{' '}
                <a href="/login" style={{ color: '#8C1D40', fontWeight: 500, textDecoration: 'none' }}>Sign in</a>
              </div>
            </>
          ) : (
            <>
              {/* Code entry */}
              <div className="f" style={{ marginBottom: '20px' }}>
                <label>{codeLength}-digit code</label>
                <input
                  ref={codeRef}
                  className="code-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={codeLength}
                  placeholder={'·'.repeat(codeLength)}
                  value={code}
                  onChange={e => { setCode(sanitizeCode(e.target.value, codeLength)); setError('') }}
                  onKeyDown={e => e.key === 'Enter' && handleVerify()}
                />
              </div>

              <button
                onClick={handleVerify}
                disabled={loading || code.length < codeLength}
                style={{ width: '100%', background: '#8C1D40', color: '#fff', border: 'none', borderRadius: '8px', padding: '13px', fontSize: '14px', fontWeight: 600, cursor: loading || code.length < codeLength ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif", opacity: loading || code.length < codeLength ? 0.6 : 1, marginBottom: '16px' }}
              >
                {loading ? 'Verifying…' : 'Create account'}
              </button>

              <div style={{ textAlign: 'center', fontSize: '13px', color: '#9b9b9b' }}>
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
            </>
          )}

        </div>
      </div>
    </>
  )
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

function SignupFlow() {
  const searchParams = useSearchParams()
  const roleParam = searchParams.get('role')
  const next = searchParams.get('next') || ''
  const prefillEmail = searchParams.get('email') || ''

  // If a role is pre-set via URL (e.g. from landlord CTA links), skip the picker
  const [step, setStep] = useState<Step>(roleParam === 'landlord' || roleParam === 'student' ? 'form' : 'pick')
  const [role, setRole] = useState<Role>(roleParam === 'landlord' ? 'landlord' : 'student')

  const handlePick = (picked: Role) => {
    setRole(picked)
    setStep('form')
  }

  if (step === 'pick') return <RolePicker onPick={handlePick} />
  return <SignupForm initialRole={role} onBack={() => setStep('pick')} next={next} prefillEmail={prefillEmail} />
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupFlow />
    </Suspense>
  )
}
