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

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('Invalid email or password')
      setLoading(false)
    } else {
      router.push('/admin')
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#faf9f6', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ background: '#fff', border: '1px solid #e8e4db', borderRadius: '16px', padding: '40px', width: '100%', maxWidth: '420px' }}>

        <a href="/" style={{ display: 'inline-block', marginBottom: '6px', textDecoration: 'none' }}>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '20px', fontWeight: 600, color: '#1a1a1a', letterSpacing: '-0.3px' }}>
            Home<em style={{ fontFamily: "'Fraunces', serif", fontStyle: 'italic', color: '#FFC627' }}>Hive</em>
          </span>
        </a>
        <div style={{ fontSize: '14px', color: '#9b9b9b', marginBottom: '32px' }}>Admin dashboard</div>

        {registered && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#166534', marginBottom: '16px' }}>
            Account created — check your email to confirm, then sign in below.
          </div>
        )}

        {error && (
          <div style={{ background: '#fdf2f5', border: '1px solid #f5c6d0', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#8C1D40', marginBottom: '16px' }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: '14px' }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '5px' }}>Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e8e4db', borderRadius: '8px', fontSize: '14px', fontFamily: "'DM Sans', sans-serif", outline: 'none', boxSizing: 'border-box', color: '#1a1a1a' }}
          />
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '5px' }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e8e4db', borderRadius: '8px', fontSize: '14px', fontFamily: "'DM Sans', sans-serif", outline: 'none', boxSizing: 'border-box', color: '#1a1a1a' }}
          />
        </div>

        <button
          onClick={handleLogin}
          disabled={loading}
          style={{ width: '100%', background: '#8C1D40', color: '#fff', border: 'none', borderRadius: '8px', padding: '13px', fontSize: '14px', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif", opacity: loading ? 0.6 : 1, marginBottom: '16px' }}
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>

        <div style={{ textAlign: 'center', fontSize: '13px', color: '#9b9b9b' }}>
          Need an account?{' '}
          <a href="/admin/signup" style={{ color: '#8C1D40', fontWeight: 500, textDecoration: 'none' }}>Sign up</a>
        </div>

      </div>
    </div>
  )
}

export default function AdminLogin() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}