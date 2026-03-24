import posthog from 'posthog-js'

export function initPostHog() {
  if (typeof window !== 'undefined') {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      api_host: 'https://app.posthog.com',
      capture_pageview: true,
      capture_pageleave: true,
    })
  }
}

export { posthog }