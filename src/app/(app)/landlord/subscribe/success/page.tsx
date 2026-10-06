'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { PLANS, isPlanTier } from '@/lib/landlordPlans'

/**
 * Where Stripe sends a landlord who just paid.
 *
 * The page's job is to turn the payment into access before they look at
 * anything else, so it confirms the session server-side rather than waiting on
 * the webhook. If Stripe is still settling it retries a few times instead of
 * showing a failure — the money has left their account, and an error screen at
 * this exact moment is the worst possible first impression.
 */

const MAX_TRIES = 6

function SuccessInner() {
  const router = useRouter()
  const params = useSearchParams()
  const sessionId = params.get('session_id')

  const [plan, setPlan] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => { document.title = 'Welcome to HomeHive' }, [])

  useEffect(() => {
    if (!sessionId) { router.replace('/landlord/subscribe'); return }

    let cancelled = false
    let tries = 0

    const attempt = async () => {
      tries += 1
      try {
        const res = await fetch('/api/stripe/checkout/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        })
        const data = await res.json().catch(() => ({}))
        if (cancelled) return

        if (res.ok && data.ok) {
          setPlan(data.plan)
          setTimeout(() => router.replace('/landlord/dashboard?welcome=1'), 1800)
          return
        }
        if (tries < MAX_TRIES) {
          setTimeout(attempt, 1500)
          return
        }
        setFailed(true)
      } catch {
        if (cancelled) return
        if (tries < MAX_TRIES) setTimeout(attempt, 1500)
        else setFailed(true)
      }
    }

    attempt()
    return () => { cancelled = true }
  }, [sessionId, router])

  const planName = isPlanTier(plan) ? PLANS[plan].name : null

  return (
    <div style={{
      maxWidth: 480, margin: '0 auto', padding: '96px 24px',
      textAlign: 'center', fontFamily: "'DM Sans', sans-serif",
    }}>
      {failed ? (
        <>
          <div style={{ fontSize: 40, marginBottom: 14 }}>⏳</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1a1a1a', margin: 0 }}>
            Your payment went through
          </h1>
          <p style={{ fontSize: 14, color: '#6b6b6b', lineHeight: 1.65, margin: '10px 0 24px' }}>
            Stripe is still confirming it on our side. This usually clears within a minute —
            open your dashboard and it will be active. If it is not, email{' '}
            <a href="mailto:landlord@homehive.live" style={{ color: '#8C1D40' }}>landlord@homehive.live</a>{' '}
            and we will sort it out straight away.
          </p>
          <a href="/landlord/dashboard" style={{
            display: 'inline-block', background: '#1a1a1a', color: '#fff',
            padding: '11px 24px', borderRadius: 8, fontSize: 14, fontWeight: 700, textDecoration: 'none',
          }}>
            Go to dashboard →
          </a>
        </>
      ) : planName ? (
        <>
          <div style={{ fontSize: 40, marginBottom: 14 }}>🎉</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1a1a1a', margin: 0 }}>
            You’re on {planName}
          </h1>
          <p style={{ fontSize: 14, color: '#6b6b6b', lineHeight: 1.65, margin: '10px 0 0' }}>
            Your landlord portal is open. Taking you there now…
          </p>
        </>
      ) : (
        <>
          <div style={{ fontSize: 40, marginBottom: 14 }}>💳</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1a1a1a', margin: 0 }}>
            Confirming your payment
          </h1>
          <p style={{ fontSize: 14, color: '#6b6b6b', lineHeight: 1.65, margin: '10px 0 0' }}>
            One moment — we’re activating your account.
          </p>
        </>
      )}
    </div>
  )
}

export default function SubscribeSuccessPage() {
  return (
    <Suspense fallback={null}>
      <SuccessInner />
    </Suspense>
  )
}
