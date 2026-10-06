'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import PlanPicker from '@/components/billing/PlanPicker'

/**
 * The paywall a new landlord lands on after signing up.
 *
 * It is deliberately not a dead end dressed as a sales page: the account
 * already exists, the only thing missing is a card, and the page says exactly
 * that. Everything below the fold answers the two questions a landlord has at
 * this moment — what do I get, and what happens if it does not work out.
 */

type PlanState = {
  planType: string | null
  hasAccess: boolean
  propertyCount: number
}

function SubscribeInner() {
  const router = useRouter()
  const params = useSearchParams()
  const canceled = params.get('canceled') === '1'

  const [state, setState] = useState<PlanState | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { document.title = 'Choose your plan — HomeHive' }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/login?next=/landlord/subscribe'); return }

      const res = await fetch('/api/landlord/plan')
      if (!res.ok) { if (!cancelled) setLoading(false); return }
      const data = await res.json()
      if (cancelled) return

      // Already paying — nothing to sell them here.
      if (data.hasAccess) { router.replace('/landlord/dashboard'); return }
      setState(data)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [router])

  if (loading) {
    return (
      <div style={{ padding: '80px 24px', textAlign: 'center', color: '#9b9b9b', fontFamily: "'DM Sans', sans-serif" }}>
        Loading…
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '36px 24px 80px', fontFamily: "'DM Sans', sans-serif" }}>

      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{
          display: 'inline-block', background: '#f0e6cc', color: '#92620a',
          fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase',
          padding: '5px 12px', borderRadius: 20, marginBottom: 16,
        }}>
          One last step
        </div>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, color: '#1a1a1a', letterSpacing: '-0.8px' }}>
          Choose your plan
        </h1>
        <p style={{ margin: '10px auto 0', fontSize: 14.5, color: '#6b6b6b', lineHeight: 1.65, maxWidth: 520 }}>
          Your account is ready. Pick the plan that matches how many properties you manage
          and the full landlord portal opens immediately — listings, leads, screening,
          leases and rent collection.
        </p>
      </div>

      {canceled && (
        <div style={{
          background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10,
          padding: '12px 16px', fontSize: 13, color: '#92400e', marginBottom: 20, textAlign: 'center',
        }}>
          Checkout was cancelled — nothing was charged. Pick a plan whenever you are ready.
        </div>
      )}

      {state && state.propertyCount > 0 && (
        <div style={{
          background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10,
          padding: '12px 16px', fontSize: 13, color: '#1d4ed8', marginBottom: 20, textAlign: 'center',
        }}>
          You already have {state.propertyCount} propert{state.propertyCount === 1 ? 'y' : 'ies'} on
          HomeHive — choose a plan that covers {state.propertyCount === 1 ? 'it' : 'them all'}.
        </div>
      )}

      <PlanPicker currentTier={null} propertyCount={state?.propertyCount ?? 0} />

      <div style={{
        marginTop: 28, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 12, fontSize: 12.5, color: '#6b6b6b',
      }}>
        {[
          ['Cancel any time', 'Month to month. Cancel from your billing page and you keep access until the period ends.'],
          ['Students pay nothing', 'Renters use HomeHive free. Your plan is the only fee on the platform.'],
          ['No per-lead charges', 'Every inquiry on your properties is yours — there is nothing to unlock.'],
        ].map(([title, body]) => (
          <div key={title} style={{ background: '#fff', border: '1px solid #e8e4db', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontWeight: 700, color: '#1a1a1a', marginBottom: 4, fontSize: 13 }}>{title}</div>
            <div style={{ lineHeight: 1.55 }}>{body}</div>
          </div>
        ))}
      </div>

      <div style={{ textAlign: 'center', marginTop: 26, fontSize: 13, color: '#9b9b9b' }}>
        Questions first?{' '}
        <a href="mailto:landlord@homehive.live" style={{ color: '#8C1D40', fontWeight: 600, textDecoration: 'none' }}>
          landlord@homehive.live
        </a>
      </div>
    </div>
  )
}

export default function SubscribePage() {
  return (
    <Suspense fallback={null}>
      <SubscribeInner />
    </Suspense>
  )
}
