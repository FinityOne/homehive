'use client'

import { useState, useEffect, Suspense } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter, useSearchParams } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Role = 'student' | 'landlord'
type Step = 'pick' | 'form'

// ─── ROLE PICKER ─────────────────────────────────────────────────────────────

function RolePicker({ onPick }: { onPick: (role: Role) => void }) {
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
            <button className="pick-card" onClick={() => onPick('student')}>
              <div className="pick-card-label" style={{ color: '#8C1D40' }}>For renters</div>
              <div className="pick-card-title">Find a place</div>
              <div className="pick-card-desc">
                Browse student-friendly housing near ASU, contact landlords directly, and secure your next home — all in one place.
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
            <button className="pick-card" onClick={() => onPick('landlord')}>
              <div className="pick-card-label" style={{ color: '#0369a1' }}>For landlords &amp; subleases</div>
              <div className="pick-card-title">List a place</div>
              <div className="pick-card-desc">
                Whether you own a property or are a student subleasing for the summer, reach thousands of renters actively looking near ASU.
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

function SignupForm({ initialRole, onBack }: { initialRole: Role; onBack: () => void }) {
  const router = useRouter()

  const [role, setRole] = useState<Role>(initialRole)
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Reset role-specific fields when toggling
  useEffect(() => {
    setForm(prev => ({ ...prev, phone: '', confirm: '' }))
    setError('')
  }, [role])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
    setError('')
  }

  const handleSubmit = async () => {
    if (!form.name || !form.email || !form.password) {
      setError('All fields are required.')
      return
    }
    if (role === 'landlord' && !form.phone) {
      setError('All fields are required.')
      return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (form.password !== form.confirm) {
      setError('Passwords do not match.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError('Please enter a valid email address.')
      return
    }

    setLoading(true)

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: {
          full_name: form.name,
          role: role === 'landlord' ? 'landlord' : 'tenant',
          ...(role === 'landlord' && form.phone ? { phone: form.phone } : {}),
        },
      },
    })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    if (role === 'landlord' && data.user) {
      await supabase
        .from('profiles')
        .update({ role: 'landlord', full_name: form.name, phone: form.phone })
        .eq('id', data.user.id)
    }

    if (data.session) {
      router.push(role === 'landlord' ? '/landlord/dashboard' : '/dashboard')
    } else {
      router.push('/login?registered=1')
    }

    setLoading(false)
  }

  const isLandlord = role === 'landlord'
  const confirmTouched = form.confirm.length > 0
  const passwordsMatch = form.password === form.confirm
  const confirmBorderColor = confirmTouched ? (passwordsMatch ? '#16a34a' : '#e8e4db') : '#e8e4db'

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
          transition: color 0.15s; margin-bottom: '20px';
        }
        .back-btn:hover { color: #1a1a1a; }
        .pw-match-hint {
          display: flex; align-items: center; gap: 5px;
          font-size: 11px; margin-top: 5px;
        }
        .pw-match-dot {
          width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
          transition: background 0.2s;
        }
      `}</style>

      <div style={{ minHeight: '100vh', background: '#faf9f6', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ background: '#fff', border: '1px solid #e8e4db', borderRadius: '16px', padding: '40px', width: '100%', maxWidth: '420px' }}>

          {/* Back + Logo */}
          <div style={{ marginBottom: '20px' }}>
            <button className="back-btn" onClick={onBack}>
              &larr; Back
            </button>
          </div>
          <a href="/" style={{ display: 'inline-block', marginBottom: '6px', textDecoration: 'none' }}>
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '20px', fontWeight: 600, color: '#1a1a1a', letterSpacing: '-0.3px' }}>
              Home<em style={{ fontFamily: "'Fraunces', serif", fontStyle: 'italic', color: '#FFC627' }}>Hive</em>
            </span>
          </a>
          <div style={{ fontSize: '14px', color: '#9b9b9b', marginBottom: '28px' }}>
            {isLandlord ? 'List your place near ASU' : 'Find your perfect place near ASU'}
          </div>

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

          {/* Error */}
          {error && (
            <div style={{ background: '#fdf2f5', border: '1px solid #f5c6d0', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#8C1D40', marginBottom: '20px' }}>
              {error}
            </div>
          )}

          {/* Fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '24px' }} className="f">
            <div>
              <label>Full name</label>
              <input name="name" placeholder="Your name" value={form.name} onChange={handleChange} />
            </div>
            <div>
              <label>{isLandlord ? 'Email' : 'ASU email'}</label>
              <input name="email" type="email" placeholder={isLandlord ? 'you@email.com' : 'you@asu.edu'} value={form.email} onChange={handleChange} />
            </div>
            {isLandlord && (
              <div>
                <label>Phone</label>
                <input name="phone" type="tel" placeholder="(480) 000-0000" value={form.phone} onChange={handleChange} />
              </div>
            )}
            <div>
              <label>Password</label>
              <input name="password" type="password" placeholder="Min. 8 characters" value={form.password} onChange={handleChange} />
            </div>
            <div>
              <label>Confirm password</label>
              <input
                name="confirm" type="password" placeholder="Repeat your password"
                value={form.confirm} onChange={handleChange}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                style={{ borderColor: confirmBorderColor }}
              />
              {confirmTouched && (
                <div className="pw-match-hint">
                  <span className="pw-match-dot" style={{ background: passwordsMatch ? '#16a34a' : '#d1d5db' }} />
                  <span style={{ color: passwordsMatch ? '#16a34a' : '#9b9b9b' }}>
                    {passwordsMatch ? 'Passwords match' : 'Passwords do not match yet'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{ width: '100%', background: '#8C1D40', color: '#fff', border: 'none', borderRadius: '8px', padding: '13px', fontSize: '14px', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif", opacity: loading ? 0.6 : 1, marginBottom: '16px' }}
          >
            {loading ? 'Creating account...' : 'Create account'}
          </button>

          <div style={{ textAlign: 'center', fontSize: '13px', color: '#9b9b9b' }}>
            Already have an account?{' '}
            <a href="/login" style={{ color: '#8C1D40', fontWeight: 500, textDecoration: 'none' }}>Sign in</a>
          </div>

        </div>
      </div>
    </>
  )
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

function SignupFlow() {
  const searchParams = useSearchParams()
  const roleParam = searchParams.get('role')

  // If a role is pre-set via URL (e.g. from landlord CTA links), skip the picker
  const [step, setStep] = useState<Step>(roleParam === 'landlord' || roleParam === 'student' ? 'form' : 'pick')
  const [role, setRole] = useState<Role>(roleParam === 'landlord' ? 'landlord' : 'student')

  const handlePick = (picked: Role) => {
    setRole(picked)
    setStep('form')
  }

  if (step === 'pick') return <RolePicker onPick={handlePick} />
  return <SignupForm initialRole={role} onBack={() => setStep('pick')} />
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupFlow />
    </Suspense>
  )
}
