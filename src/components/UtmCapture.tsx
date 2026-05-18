'use client'

import { useEffect } from 'react'

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const
const TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export default function UtmCapture() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const hasUtm = UTM_KEYS.some(k => params.get(k))

    if (hasUtm) {
      const expires = new Date(Date.now() + TTL_MS).toUTCString()
      UTM_KEYS.forEach(key => {
        const val = params.get(key) || ''
        localStorage.setItem(key, val)
        // Persist as cookie so server-side can also read if needed
        document.cookie = `${key}=${encodeURIComponent(val)}; expires=${expires}; path=/; SameSite=Lax`
      })
      localStorage.setItem('utm_landing_page', window.location.pathname + window.location.search)
      localStorage.setItem('utm_referrer', document.referrer || '')
    }
  }, [])

  return null
}
