'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { getAnonId, getSessionId } from '@/lib/visitorId'

// Logs one server-side hit per page view. The server reads the real IP from the
// request headers; we only supply the cookie id, session, path and attribution.
export default function VisitTracker() {
  const pathname = usePathname()

  useEffect(() => {
    if (!pathname) return

    // A listing page is /homes/<slug>.
    const slugMatch = pathname.match(/^\/homes\/([^/]+)/)

    // Prefer this navigation's ?utm=, fall back to the values UtmCapture stored.
    // Read from window (not useSearchParams) so pages stay statically renderable.
    const params = new URLSearchParams(window.location.search)
    const utm = (key: string) =>
      params.get(key) || localStorage.getItem(key) || undefined

    const knownEmail =
      localStorage.getItem('hh_identified_email') || undefined

    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anonymous_id: getAnonId(),
        session_id: getSessionId(),
        path: pathname,
        property_slug: slugMatch ? slugMatch[1] : undefined,
        referrer: document.referrer || localStorage.getItem('utm_referrer') || undefined,
        utm_source: utm('utm_source'),
        utm_medium: utm('utm_medium'),
        utm_campaign: utm('utm_campaign'),
        utm_content: utm('utm_content'),
        device_type: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
        email: knownEmail,
        identified_via: knownEmail ? 'known' : undefined,
      }),
      keepalive: true,
    }).catch(() => {})
    // Re-fire on every path change.
  }, [pathname])

  return null
}
