'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { identifyVisitor } from '@/lib/visitorId'

// Soft, value-exchange email capture for visitors who aren't signed into Google
// (so One Tap can't fire). Slides in once per visitor on listing pages and
// offers price-drop / new-listing alerts. No dark patterns — always dismissible.
export default function EmailGate() {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)

  const onListing = !!pathname?.startsWith('/homes/')

  useEffect(() => {
    if (!onListing) return
    if (localStorage.getItem('hh_identified_email')) return // already known
    if (localStorage.getItem('hh_gate_dismissed')) return

    const t = setTimeout(() => setVisible(true), 22000) // after ~22s of browsing
    return () => clearTimeout(t)
  }, [onListing, pathname])

  function dismiss() {
    setVisible(false)
    localStorage.setItem('hh_gate_dismissed', '1')
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = email.trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return
    localStorage.setItem('hh_identified_email', value)
    identifyVisitor(value, null, 'email_gate')
    setDone(true)
    setTimeout(() => setVisible(false), 2200)
  }

  if (!visible) return null

  return (
    <div
      style={{
        position: 'fixed', bottom: 20, left: 20, zIndex: 1000, maxWidth: 340,
        background: '#fff', borderRadius: 14, padding: '18px 18px 16px',
        boxShadow: '0 12px 40px rgba(0,0,0,0.18)', border: '1px solid #ece9e2',
        fontFamily: 'inherit',
      }}
    >
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          position: 'absolute', top: 8, right: 10, border: 'none', background: 'none',
          fontSize: 20, lineHeight: 1, color: '#9b9b9b', cursor: 'pointer',
        }}
      >
        ×
      </button>

      {done ? (
        <p style={{ margin: 0, fontSize: 15, color: '#166534', fontWeight: 600 }}>
          ✓ You&apos;re on the list — we&apos;ll alert you about matching homes.
        </p>
      ) : (
        <>
          <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: '#1a1a1a' }}>
            Get alerts on homes like this
          </p>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6b6b6b', lineHeight: 1.4 }}>
            Price drops, new ASU-area listings, and tour openings — straight to your inbox.
          </p>
          <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@asu.edu"
              required
              style={{
                flex: 1, padding: '9px 11px', borderRadius: 9, border: '1px solid #d9d5cc',
                fontSize: 14, outline: 'none',
              }}
            />
            <button
              type="submit"
              style={{
                padding: '9px 14px', borderRadius: 9, border: 'none', cursor: 'pointer',
                background: 'var(--hh-primary, #8C1D40)', color: '#fff', fontSize: 14, fontWeight: 600,
              }}
            >
              Notify me
            </button>
          </form>
        </>
      )}
    </div>
  )
}
