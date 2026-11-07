'use client'

/**
 * One fetch of /api/landlord/pulse, for whoever is drawing it.
 *
 * Both the overview's compact traffic card and the full traffic page want the
 * same payload for the same scope, and the fetch has two details that are easy
 * to get subtly wrong when copied: the bearer token has to come from the live
 * session, and a window change must not blank the last good payload — swapping
 * 7d for 30d by emptying the panel first reads as a crash.
 */

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { DEFAULT_PULSE_WINDOW } from '@/lib/listingPulse'
import type { PulseWindow } from '@/lib/listingPulse'
import type { PulsePayload } from '@/lib/pulsePayload'

export type PulseState = {
  data: PulsePayload | null
  error: string | null
  loading: boolean
}

export function usePulse(slug: string | null, windowDays: PulseWindow = DEFAULT_PULSE_WINDOW): PulseState {
  const [data, setData] = useState<PulsePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { if (!cancelled) setLoading(false); return }
      const qs = new URLSearchParams({ days: String(windowDays) })
      if (slug) qs.set('slug', slug)
      const res = await fetch(`/api/landlord/pulse?${qs}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await res.json().catch(() => ({}))
      if (cancelled) return
      setLoading(false)
      if (!res.ok) { setError(json.error || 'Could not load your traffic.'); return }
      setError(null)
      setData(json as PulsePayload)
    })()
    return () => { cancelled = true }
  }, [windowDays, slug])

  return { data, error, loading }
}
