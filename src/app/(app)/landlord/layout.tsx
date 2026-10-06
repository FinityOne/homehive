'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

/**
 * The paywall on the landlord portal.
 *
 * Access to the portal *is* the product now, so this gate is the only place
 * that decides whether a landlord is let in. It deliberately renders nothing
 * while it checks: showing a dashboard and then yanking it away a tick later
 * reads as a bug, and worse, as a bait-and-switch.
 *
 * Admins pass through — they manage landlord accounts and are not customers of
 * this plan.
 */

/** Pages a landlord without a plan must still reach: how they get one. */
const OPEN_PATHS = ['/landlord/subscribe', '/landlord/billing']

export default function LandlordLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [allowed, setAllowed] = useState<boolean | null>(null)

  const isOpenPath = OPEN_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`))

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
      if (profile?.role === 'admin') { setAllowed(true); return }

      if (isOpenPath) { setAllowed(true); return }

      const res = await fetch('/api/landlord/plan')
      if (cancelled) return
      if (!res.ok) { setAllowed(true); return }  // never lock someone out on a blip

      const plan = await res.json()
      if (cancelled) return

      if (plan.hasAccess) setAllowed(true)
      else router.replace('/landlord/subscribe')
    })()

    return () => { cancelled = true }
  }, [pathname, isOpenPath, router])

  if (allowed === null) {
    return (
      <div style={{
        padding: '80px 24px', textAlign: 'center',
        fontFamily: "'DM Sans', sans-serif", color: '#9b9b9b', fontSize: 14,
      }}>
        Loading…
      </div>
    )
  }

  return <>{children}</>
}
