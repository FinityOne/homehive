// Client-side helpers for the persistent visitor identity used to stitch
// anonymous hits to a real email once the visitor identifies themselves.
// Safe to import anywhere; every function guards on `window`.

const ANON_KEY = 'hh_anon_id'
const SESSION_KEY = 'hh_session_id'
const ONE_YEAR = 365 * 24 * 60 * 60

// Stable per-browser id, persisted in both a 1-year cookie and localStorage.
export function getAnonId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem(ANON_KEY)
  if (!id) {
    const cookieMatch = document.cookie.match(/(?:^|; )hh_anon_id=([^;]+)/)
    id = cookieMatch ? decodeURIComponent(cookieMatch[1]) : crypto.randomUUID()
    localStorage.setItem(ANON_KEY, id)
  }
  document.cookie = `${ANON_KEY}=${encodeURIComponent(id)}; max-age=${ONE_YEAR}; path=/; SameSite=Lax`
  return id
}

// Per-tab/session id (resets when the browser session ends).
export function getSessionId(): string {
  if (typeof window === 'undefined') return ''
  let id = sessionStorage.getItem(SESSION_KEY)
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem(SESSION_KEY, id)
  }
  return id
}

// Fire-and-forget: attach an email to all of this visitor's past + future hits.
export function identifyVisitor(
  email: string,
  fullName: string | null,
  via: 'one_tap' | 'lead_form' | 'login' | 'email_gate'
) {
  if (typeof window === 'undefined' || !email) return
  fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'identify',
      anonymous_id: getAnonId(),
      email,
      full_name: fullName,
      identified_via: via,
    }),
    keepalive: true,
  }).catch(() => {})
}
