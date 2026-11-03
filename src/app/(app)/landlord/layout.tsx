'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { loadCurrentProfile } from '@/lib/currentProfile'
import { useLandlordPlan, prefetchLandlordPlan } from '@/lib/useLandlordPlan'
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

  // Fired as the portal mounts, in parallel with the role lookup below rather
  // than behind it. Both answers are needed before a gated page may render.
  useEffect(() => { prefetchLandlordPlan() }, [])

  const isFree = isFreeLandlordPath(pathname)
  // Admins are not gated, so they never read the answer (the prefetch above
  // asks for it anyway — see why there).
  const plan = useLandlordPlan(auth === 'landlord')

  // Where to send someone who isn't signed in — read through a ref so the
  // check itself does not depend on the pathname. Keying it on the pathname is
  // what made every click inside the portal re-run the whole gate before the
  // page under it could start loading; the answer is the same on all of them.
  const pathRef = useRef(pathname)
  useEffect(() => { pathRef.current = pathname }, [pathname])

  useEffect(() => {
    let cancelled = false

    // Shared with the app shell and cached for the life of the document, so
    // this costs one lookup per session rather than one per page view.
    loadCurrentProfile().then(profile => {
      if (cancelled) return
      if (!profile) {
        router.replace(`/login?next=${encodeURIComponent(pathRef.current)}`)
        return
      }
      setAuth(profile.role === 'admin' ? 'admin' : 'landlord')
    })

    return () => { cancelled = true }
  }, [router])

  // The front door: an unpaid landlord starts where they can work.
  const bounceHome = auth === 'landlord' && plan?.hasAccess === false && pathname === '/landlord/dashboard'
  useEffect(() => {
    if (bounceHome) router.replace(FREE_LANDLORD_HOME)
  }, [bounceHome, router])

  // A free path is never gated — not on a plan, and not on the role either,
  // since nothing below uses the role except the lock. So it renders at once
  // and its own queries start immediately, instead of idling behind a check
  // whose answer it will not read. Listings is a free path and the portal's
  // front door for an unpaid landlord, which makes this the first screen most
  // new landlords ever wait on.
  const waiting =
    !isFree && (
      auth === 'checking' ||
      bounceHome ||
      // A paid path must not flash before its plan answer arrives.
      (auth === 'landlord' && plan === undefined)
    )

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
