// Client-side funnel instrumentation for listings.
//
// Three rules keep this honest and cheap, and all three exist because the
// numbers feed a landlord's leasing decisions rather than a growth dashboard:
//
//   • An impression means the card was actually ON SCREEN. Counting rendered
//     cards would inflate impressions by everything below the fold and turn
//     click-through — the one metric that isolates a cover-photo problem —
//     into a number that only measures how long the result list was.
//   • Each (listing, event) fires at most once per browser session. A student
//     scrolling the same card past the viewport four times is one impression,
//     not four, and a per-session cap is what makes the funnel's stages
//     comparable to each other.
//   • Events batch and flush on an animation frame, with `keepalive` so the
//     last flush survives the navigation that a `card_click` causes. A click
//     that loses its own event makes click-through read low forever.
//
// Identity is the same pair `property_page_views` uses — the 1-year cookie
// first, the per-tab id as fallback — so a person's impression, click, view
// and inquiry stitch into one journey.

import { getAnonId, getSessionId } from './visitorId'

/** Mirrors the check constraint on `listing_events.event_type`. */
export const LISTING_EVENT_KINDS = [
  'impression',
  'card_click',
  'gallery_open',
  'faq_open',
  'form_start',
  'form_abandon',
  'save',
  'tour_click',
  'share',
] as const

export type ListingEventKind = (typeof LISTING_EVENT_KINDS)[number]

/** Where the event happened. Lets search traffic be read apart from the rest. */
export type ListingSurface = 'search' | 'listing' | 'saved' | 'home'

export type ListingEvent = {
  property_slug: string
  event_type: ListingEventKind
  surface?: ListingSurface
  /** 1-based rank in the result list. Only meaningful for impressions. */
  position?: number
}

const SENT_KEY = 'hh_listing_events_sent'

let queue: ListingEvent[] = []
let scheduled = false

/** What this tab has already reported, so a scroll-back is not a new impression. */
function sentSet(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SENT_KEY) || '[]') as string[])
  } catch {
    return new Set()
  }
}

function remember(keys: string[]) {
  if (typeof window === 'undefined' || !keys.length) return
  try {
    const all = sentSet()
    for (const k of keys) all.add(k)
    sessionStorage.setItem(SENT_KEY, JSON.stringify([...all]))
  } catch {
    // Private mode or a full quota: the cap is a nicety, the event is not.
  }
}

function deviceType(): string {
  if (typeof navigator === 'undefined') return 'unknown'
  return /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop'
}

function flush() {
  scheduled = false
  const batch = queue
  queue = []
  if (!batch.length || typeof window === 'undefined') return

  const body = JSON.stringify({
    anonymous_id: getAnonId(),
    session_id: getSessionId(),
    device_type: deviceType(),
    referrer: (() => {
      try { return localStorage.getItem('utm_referrer') || document.referrer || null } catch { return null }
    })(),
    utm_source: (() => {
      try { return localStorage.getItem('utm_source') } catch { return null }
    })(),
    events: batch,
  })

  // keepalive, because the most important event in this system — the click on
  // a search card — is immediately followed by the page being torn down.
  fetch('/api/listing-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {})
}

/**
 * Record one funnel event. Fire-and-forget, deduped per session, never throws.
 *
 * `dedupe: false` is for events a person can genuinely repeat in one session
 * and where each repeat is its own fact — opening the gallery twice is two
 * looks at the photos.
 */
export function trackListingEvent(e: ListingEvent, opts: { dedupe?: boolean } = {}) {
  if (typeof window === 'undefined' || !e.property_slug) return
  const dedupe = opts.dedupe ?? true
  const key = `${e.event_type}:${e.property_slug}`

  if (dedupe) {
    const seen = sentSet()
    if (seen.has(key)) return
    remember([key])
  }

  queue.push(e)
  if (!scheduled) {
    scheduled = true
    // An animation frame, not a timeout: a list scrolling into view fires a
    // burst of impressions, and they should leave as one request.
    requestAnimationFrame(flush)
  }
}

/**
 * Watch listing cards and report an impression when one is genuinely seen.
 *
 * Returns a `ref` callback to attach to each card and a teardown. "Seen" is
 * half the card visible for 400ms — a card that flies past during a fast
 * scroll to the bottom was not read, and counting it would quietly depress
 * every click-through rate on the page.
 */
export function createImpressionTracker(surface: ListingSurface) {
  if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
    return { observe: () => {}, disconnect: () => {} }
  }

  const timers = new Map<Element, ReturnType<typeof setTimeout>>()
  const meta = new WeakMap<Element, { slug: string; position: number }>()

  const io = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        const info = meta.get(entry.target)
        if (!info) continue
        if (entry.isIntersecting) {
          if (timers.has(entry.target)) continue
          timers.set(entry.target, setTimeout(() => {
            trackListingEvent({
              property_slug: info.slug,
              event_type: 'impression',
              surface,
              position: info.position,
            })
            io.unobserve(entry.target)
            timers.delete(entry.target)
          }, 400))
        } else {
          const t = timers.get(entry.target)
          if (t) { clearTimeout(t); timers.delete(entry.target) }
        }
      }
    },
    { threshold: 0.5 }
  )

  return {
    observe(el: Element | null, slug: string, position: number) {
      if (!el || !slug) return
      meta.set(el, { slug, position })
      io.observe(el)
    },
    disconnect() {
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
      io.disconnect()
    },
  }
}
