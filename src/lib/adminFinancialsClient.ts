// One fetch of /api/admin/financials, shared by everything that reads it.
//
// That route is the heaviest read in the product: seven tables in full, plus a
// profiles lookup, then both the revenue report and the per-landlord books
// built over the same rows. It is deliberately one route for exactly that
// reason — two routes would double the scans and let the two tabs disagree.
//
// The browser then undid the saving. The Revenue tab and the Landlords tab each
// called it from their own `useEffect`, so switching between them ran the whole
// thing again, and so did every remount — and because both tabs live on
// /admin/payments, "switching tabs" is something an admin does constantly while
// reading one month's numbers.
//
// So the fetch moves out of the components and behind this module:
//
//   • Concurrent callers share one in-flight request. Mounting both tabs at once
//     is one scan, not two.
//   • A completed answer is reused for `TTL_MS`. Tab switching inside that
//     window is free.
//   • A failure is never cached. The next caller tries again.
//
// `refresh()` is the escape hatch for a caller that must see writes it just
// made; nothing stale is ever served past the TTL without a round trip.

const TTL_MS = 60_000

type Cached = { at: number; value: unknown }

let cached: Cached | null = null
let inFlight: Promise<unknown> | null = null

async function request(): Promise<unknown> {
  const res = await fetch('/api/admin/financials')
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { error?: string }))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

/**
 * The financials payload, from cache, from a request already in the air, or
 * from a new one — in that order.
 */
export function loadAdminFinancials<T>(): Promise<T> {
  if (cached && Date.now() - cached.at < TTL_MS)
    return Promise.resolve(cached.value as T)

  if (inFlight) return inFlight as Promise<T>

  inFlight = request()
    .then(value => {
      cached = { at: Date.now(), value }
      return value
    })
    .finally(() => { inFlight = null })

  return inFlight as Promise<T>
}

/** Drop the cache so the next read hits the route. */
export function invalidateAdminFinancials(): void {
  cached = null
}

/** Force a fresh read, for a caller that has just written. */
export function refreshAdminFinancials<T>(): Promise<T> {
  invalidateAdminFinancials()
  return loadAdminFinancials<T>()
}
