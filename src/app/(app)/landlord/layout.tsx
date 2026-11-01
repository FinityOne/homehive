'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useLandlordPlan } from '@/lib/useLandlordPlan'
import { isFreeLandlordPath, lockedFeature, FREE_LANDLORD_HOME } from '@/lib/landlordAccess'
import PlanLockedScreen from '@/components/billing/PlanLockedScreen'

/**
 * The paywall on the landlord portal.
 *
 * It used to be a door: no plan, no portal. Now it is a line drawn through the
 * middle of the portal — building properties is free, everything that earns
 * from them is paid (the line itself lives in `landlordAccess.ts`).
 *
 * Two behaviours worth keeping straight:
 *
 *   • A locked page *renders*, as a screen that names the feature and asks for
 *     the plan. Redirecting everything to pricing threw away the only piece of
 *     information we had about intent — which feature they wanted.
 *   • Overview is the one exception. It is the portal's front door and the
 *     first URL after login, so an unpaid landlord is sent to Listings
 *     instead: landing on a paywall before seeing the product is how a signup
 *     becomes a bounce, and Listings is where their work actually is.
 *
 * It renders nothing while it checks: showing a dashboard and then yanking it
 * away a tick later reads as a bug, and worse, as a bait-and-switch. Admins
 * pass through — they manage landlord accounts and are not customers of this
 * plan.
 */

export default function LandlordLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [auth, setAuth] = useState<'checking' | 'admin' | 'landlord'>('checking')

  const isFree = isFreeLandlordPath(pathname)
  // Admins are not gated, so they are not made to wait on a plan lookup.
  const plan = useLandlordPlan(auth === 'landlord')

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return
      if (!user) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`)
        return
      }

      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', user.id).maybeSingle()
      if (cancelled) return
      setAuth(profile?.role === 'admin' ? 'admin' : 'landlord')
    })()

    return () => { cancelled = true }
  }, [pathname, router])

  // The front door: an unpaid landlord starts where they can work.
  const bounceHome = auth === 'landlord' && plan?.hasAccess === false && pathname === '/landlord/dashboard'
  useEffect(() => {
    if (bounceHome) router.replace(FREE_LANDLORD_HOME)
  }, [bounceHome, router])

  const waiting =
    auth === 'checking' ||
    bounceHome ||
    // A free path needs no plan answer; a paid one must not flash before it.
    (auth === 'landlord' && !isFree && plan === undefined)

  if (waiting) {
    return (
      <div style={{
        padding: '80px 24px', textAlign: 'center',
        fontFamily: "'DM Sans', sans-serif", color: '#9b9b9b', fontSize: 14,
      }}>
        Loading…
      </div>
    )
  }

  // `plan === null` means the lookup failed — never lock someone out on a blip.
  const locked =
    auth === 'landlord' && !isFree && plan != null && !plan.hasAccess
      ? lockedFeature(pathname)
      : null

  if (locked) {
    return <PlanLockedScreen feature={locked} propertyCount={plan?.propertyCount ?? 0} />
  }

  return <>{children}</>
}
