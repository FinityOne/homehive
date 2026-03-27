'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function LandlordSignupPage() {
  const router = useRouter()
  const [form, setForm] = useState({ firstName: '', email: '', phone: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
    setError('')
  }

  const handleSubmit = async () => {
    if (!form.firstName || !form.email || !form.phone || !form.password) {
      setError('All fields are required.')
      return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)
    if (!emailOk) { setError('Please enter a valid email address.'); return }

    setLoading(true)

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: {
          full_name: form.firstName,
          role: 'landlord',
          phone: form.phone,
        },
      },
    })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    // Update the profiles row to landlord role (trigger may have already set tenant)
    if (data.user) {
      await supabase
        .from('profiles')
        .update({ role: 'landlord', full_name: form.firstName, phone: form.phone })
        .eq('id', data.user.id)
    }

    if (data.session) {
      router.push('/landlord/dashboard')
    } else {
      router.push('/login?registered=1')
    }
    setLoading(false)
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; background: #faf9f6; }
        .f label { display: block; font-size: 11px; font-weight: 600; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px; }
        .f input { width: 100%; padding: 10px 14px; border: 1.5px solid #e8e4db; border-radius: 8px; font-size: 14px; font-family: 'DM Sans', sans-serif; outline: none; transition: border-color 0.15s; box-sizing: border-box; color: #1a1a1a; background: #fff; }
        .f input:focus { border-color: #8C1D40; }
      `}</style>

      <div style={{ minHeight: '100vh', background: '#faf9f6', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ background: '#fff', border: '1px solid #e8e4db', borderRadius: '16px', padding: '40px', width: '100%', maxWidth: '420px' }}>

          {/* Logo */}
          <a href="/" style={{ display: 'inline-block', marginBottom: '6px', textDecoration: 'none' }}>
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '20px', fontWeight: 600, color: '#1a1a1a', letterSpacing: '-0.3px' }}>
              Home<em style={{ fontFamily: "'Fraunces', serif", fontStyle: 'italic', color: '#FFC627' }}>Hive</em>
            </span>
          </a>

          <div style={{ marginBottom: '28px' }}>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>List your place</div>
            <div style={{ fontSize: '13px', color: '#9b9b9b' }}>Create your free landlord account — takes 30 seconds</div>
          </div>

          {/* Incentive pill */}
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: '#166534', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>🎉</span>
            <span><strong>Free forever</strong> for the first 100 landlords — no credit card needed</span>
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
              <label>First name</label>
              <input name="firstName" placeholder="Jordan" value={form.firstName} onChange={handleChange} />
            </div>
            <div>
              <label>Email</label>
              <input name="email" type="email" placeholder="you@email.com" value={form.email} onChange={handleChange} />
            </div>
            <div>
              <label>Phone</label>
              <input name="phone" type="tel" placeholder="(480) 000-0000" value={form.phone} onChange={handleChange} />
            </div>
            <div>
              <label>Password</label>
              <input name="password" type="password" placeholder="Min. 8 characters" value={form.password} onChange={handleChange} onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{ width: '100%', background: '#8C1D40', color: '#fff', border: 'none', borderRadius: '8px', padding: '13px', fontSize: '14px', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif", opacity: loading ? 0.6 : 1, marginBottom: '16px' }}
          >
            {loading ? 'Creating account…' : 'Create landlord account →'}
          </button>

          <div style={{ textAlign: 'center', fontSize: '13px', color: '#9b9b9b', marginBottom: '8px' }}>
            Already have an account?{' '}
            <a href="/login" style={{ color: '#8C1D40', fontWeight: 500, textDecoration: 'none' }}>Sign in</a>
          </div>
          <div style={{ textAlign: 'center', fontSize: '12px', color: '#c5c1b8' }}>
            Looking for student housing?{' '}
            <a href="/signup" style={{ color: '#9b9b9b', textDecoration: 'none' }}>Sign up as a student →</a>
          </div>

        </div>
      </div>
    </>
  )
}
