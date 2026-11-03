'use client'

import { useEffect, useState } from 'react'

/**
 * "What is this landlord allowed to do right now", read once per page load.
 *
 * Three surfaces need the same answer at the same time: the portal gate
 * decides whether to render a page, the sidebar decides which items wear a
 * lock, and the listings screen decides how hard to push a plan. Fetching it
 * three times would be three chances to disagree, so the in-flight promise is
 * cached at module scope and every caller gets the same object.
 *
 * The cache lives for the life of the document, which is exactly right: a plan
 * starts via Stripe, which returns through a full page load, so there is no
 * "subscribed but the nav still shows locks" state to worry about. `refresh()`
 * exists for the one place that changes a plan without navigating.
 */

export type LandlordPlan = {
  planType: string | null
  status: string | null
  /** Paying: the full portal, and listings students can see. */
  hasAccess: boolean
  propertyCount: number
  /** What their plan covers — 0 with no plan. */
  propertyLimit: number
  /** What they may build right now: plan allowance, or the free ceiling. */
  propertyAllowance: number
  canAddProperty: boolean
  canPublish: boolean
}

let cached: Promise<LandlordPlan | null> | null = null

function load(): Promise<LandlordPlan | null> {
  cached ??= fetch('/api/landlord/plan')
    .then(r => (r.ok ? (r.json() as Promise<LandlordPlan>) : null))
    // A blip must never read as "unpaid" — that would lock a paying landlord
    // out of their own tenants. Callers treat null as "do not gate".
    .catch(() => null)
  return cached
}

/**
 * Start the plan request now, before anyone knows they need it.
 *
 * The portal gate cannot render a page until it has a plan answer, and it used
 * to only *start* asking once the role lookup had come back — two round trips
 * nose to tail, with the page's own queries waiting behind both. The request
 * does not depend on the role, so there is no reason for it to wait on one.
 *
 * The cost is one cheap request for an admin, who is never gated by a plan and
 * therefore never reads the answer. That is a fair trade for taking a full
 * round trip off the critical path of every landlord page view.
 */
export function prefetchLandlordPlan(): void {
  void load()
}

/** Drop the cache so the next read hits the network. */
export function refreshLandlordPlan(): void {
  cached = null
}

/**
 * `undefined` while loading, `null` when unknown (request failed or not a
 * landlord). Both mean "do not show a paywall yet".
 */
export function useLandlordPlan(enabled = true): LandlordPlan | null | undefined {
  const [plan, setPlan] = useState<LandlordPlan | null | undefined>(undefined)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    load().then(p => { if (!cancelled) setPlan(p) })
    return () => { cancelled = true }
  }, [enabled])

  return enabled ? plan : undefined
}
