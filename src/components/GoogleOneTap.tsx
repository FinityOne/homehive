'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { identifyVisitor } from '@/lib/visitorId'

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID

function decodeJwt(token: string): { email?: string; name?: string } {
  try {
    const payload = token.split('.')[1]
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json)
  } catch {
    return {}
  }
}

// Google "One Tap": for visitors already signed into Google, shows a small
// top-right prompt. One click shares their VERIFIED name + email with us — the
// only legitimate way to capture an email without a full form. We then stitch
// that email onto all of this visitor's prior anonymous hits.
export default function GoogleOneTap() {
  useEffect(() => {
    if (!CLIENT_ID) return // not configured — silently no-op

    let cancelled = false

    async function init() {
      // Don't prompt people who are already authenticated.
      const { data } = await supabase.auth.getSession()
      if (data.session || cancelled) return
      // Respect a recent dismissal so we don't nag on every page.
      const snoozed = localStorage.getItem('hh_onetap_snooze')
      if (snoozed && Date.now() < Number(snoozed)) return

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const google = (window as any).google
      if (!google?.accounts?.id) return

      google.accounts.id.initialize({
        client_id: CLIENT_ID,
        auto_select: false,
        cancel_on_tap_outside: true,
        use_fedcm_for_prompt: true, // required by current Chrome; legacy path is deprecated
        callback: async (response: { credential: string }) => {
          const { email, name } = decodeJwt(response.credential)
          if (email) {
            localStorage.setItem('hh_identified_email', email)
            identifyVisitor(email, name || null, 'one_tap')
          }
          // Best-effort: also sign them into Supabase so the session carries over.
          try {
            await supabase.auth.signInWithIdToken({
              provider: 'google',
              token: response.credential,
            })
          } catch {
            /* sign-in is a bonus; identification already succeeded */
          }
        },
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      google.accounts.id.prompt((notification: any) => {
        // Snooze for 24h whenever the prompt is dismissed/skipped so we don't nag.
        // Under FedCM the moment helpers can throw, so guard them.
        try {
          if (notification?.isSkippedMoment?.() || notification?.isDismissedMoment?.()) {
            localStorage.setItem('hh_onetap_snooze', String(Date.now() + 24 * 60 * 60 * 1000))
          }
        } catch {
          /* FedCM mode — moment helpers unavailable; ignore */
        }
      })
    }

    // Load the Google Identity Services script once, then init.
    const existing = document.getElementById('google-gsi')
    if (existing) {
      init()
    } else {
      const s = document.createElement('script')
      s.src = 'https://accounts.google.com/gsi/client'
      s.async = true
      s.defer = true
      s.id = 'google-gsi'
      s.onload = init
      document.head.appendChild(s)
    }

    return () => { cancelled = true }
  }, [])

  return null
}
