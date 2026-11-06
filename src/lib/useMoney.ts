'use client'

/**
 * One load of the money data, shared by every tab in the money area.
 *
 * ── Why this is a cache and not just a fetch ───────────────────────────────
 *
 * The portfolio query is the heaviest read in the landlord portal: every
 * payment plan, its property, its lease, its payers, their line items, the
 * late-fee rule, the lease utilities, every scheduled rent row and every
 * one-off charge — in one statement. On a real portfolio that is thousands of
 * rows, and all six money screens need exactly the same set.
 *
 * Splitting Financials into tabs makes that a problem it was not before: a
 * landlord who checks the overview, opens collections, looks at a lease and
 * comes back has asked for the same query four times in thirty seconds. So the
 * result is held here, in the module, and every screen reads it. A tab press is
 * then free, which is the entire reason the tabs are usable at all.
 *
 * The cache is deliberately small-minded about correctness:
 *
 *   • It is keyed on the signed-in owner, so a different account never reads
 *     another's figures out of a stale cache.
 *   • It expires, because rent arrives while a landlord is looking at the page,
 *     and a money figure that is quietly five minutes old is worse than one
 *     that takes a moment to appear.
 *   • `reload()` is a hard refetch, and every mutation in the area calls it.
 *     Nothing in here tries to patch a row in place — money is exactly the
 *     wrong place to be clever about invalidation.
 *
 * Waivers ride along in the same load. They live in their own table but they
 * are meaningless without the plans — a waived fee has to be netted off the
 * derived fee it belongs to — so fetching them separately would only create a
 * window in which the page shows fees it knows have been written off.
 */

import { useCallback, useEffect, useState } from 'react'
import { getCurrentUser, supabase } from '@/lib/supabase'
import { getPlansForOwner, type PaymentPlan } from '@/lib/payments'
import type { LateFeeWaiver } from '@/lib/lateFees'

/** How long a load stays warm. Long enough to cover moving between tabs,
 *  short enough that a payment that lands mid-session shows up. */
const TTL_MS = 60_000

type Snapshot = {
  ownerId: string
  at: number
  plans: PaymentPlan[]
  waivers: LateFeeWaiver[]
  /** Emails to tenants that bounced, were refused or were marked as spam. */
  bounced: number
}

let cache: Snapshot | null = null
let inflight: Promise<Snapshot | null> | null = null
const subscribers = new Set<(s: Snapshot | null) => void>()

const publish = (s: Snapshot | null) => {
  cache = s
  for (const fn of subscribers) fn(s)
}

async function loadWaivers(): Promise<LateFeeWaiver[]> {
  // RLS keys this table on plan ownership, so no owner filter is needed here
  // and none would be trustworthy if it were.
  const { data } = await supabase
    .from('late_fee_waivers')
    .select('scheduled_payment_id, amount, reason, created_at, tenant_note, tenant_notified_at, tenant_notified_email')
  return (data ?? []).map(w => ({ ...w, amount: Number(w.amount) })) as LateFeeWaiver[]
}

async function loadBounced(): Promise<number> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/payments/emails?state=problem&limit=50', {
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    })
    const json = await res.json()
    return res.ok ? (json.counts?.problem ?? 0) : 0
  } catch {
    // A badge is not worth a visible error: the page's job is the money.
    return 0
  }
}

async function fetchAll(): Promise<Snapshot | null> {
  const user = await getCurrentUser()
  if (!user) return null
  const [plans, waivers, bounced] = await Promise.all([
    getPlansForOwner(user.id),
    loadWaivers(),
    loadBounced(),
  ])
  return { ownerId: user.id, at: Date.now(), plans, waivers, bounced }
}

/** Whether the held snapshot is still warm. Read outside render, always. */
const isFresh = () => cache !== null && Date.now() - cache.at < TTL_MS

/** Shared loader. Concurrent callers join the one request in flight. */
function ensure(force: boolean): Promise<Snapshot | null> {
  if (!force && isFresh()) return Promise.resolve(cache)
  if (inflight) return inflight
  inflight = fetchAll()
    .then(snap => { publish(snap); return snap })
    .catch(err => { console.error('useMoney:', err); return cache })
    .finally(() => { inflight = null })
  return inflight
}

export type Money = {
  plans: PaymentPlan[]
  waivers: LateFeeWaiver[]
  /** Emails that never reached a tenant — carried on the hub's Reminders tab. */
  bounced: number
  /** True only on the very first load, when there is nothing to show yet. */
  loading: boolean
  /** True while a refetch is in flight behind figures already on screen. */
  refreshing: boolean
  /** Hard refetch. Every mutation in the money area calls this. */
  reload: () => Promise<void>
}

/**
 * The money data, for any client screen in the area.
 *
 * Returns whatever is already cached immediately — so a tab press paints at
 * once — and refreshes behind it when the snapshot has gone cold.
 */
export function useMoney(): Money {
  const [snap, setSnap] = useState<Snapshot | null>(cache)
  const [refreshing, setRefreshing] = useState(false)
  /** Whether there is anything to render yet — either because a snapshot was
   *  already cached, or because a load has since finished (even empty, when
   *  nobody is signed in, which would otherwise spin forever).
   *
   *  Deliberately *not* a freshness check: freshness decides whether to
   *  refetch, which is the effect's job. Reading the clock during render makes
   *  a component's output depend on when React happened to call it. */
  const [settled, setSettled] = useState(cache !== null)

  useEffect(() => {
    const onChange = (s: Snapshot | null) => setSnap(s)
    subscribers.add(onChange)
    let live = true

    if (isFresh()) {
      // Already fresh: nothing to fetch, and nothing to set — the initial
      // state said so.
      return () => { live = false; subscribers.delete(onChange) }
    }

    // Figures already on screen stay there while a cold snapshot refreshes
    // behind them. Flagged in a microtask rather than in the effect body, so
    // the effect itself never triggers a render of its own.
    if (cache !== null) {
      Promise.resolve().then(() => { if (live) setRefreshing(true) })
    }
    ensure(false).finally(() => {
      if (!live) return
      setSettled(true)
      setRefreshing(false)
    })

    return () => { live = false; subscribers.delete(onChange) }
  }, [])

  const reload = useCallback(async () => {
    setRefreshing(true)
    await ensure(true)
    setRefreshing(false)
  }, [])

  return {
    plans: snap?.plans ?? [],
    waivers: snap?.waivers ?? [],
    bounced: snap?.bounced ?? 0,
    loading: snap === null && !settled,
    refreshing,
    reload,
  }
}

/** Drop the cache — for sign-out, so the next account never reads these. */
export function clearMoneyCache() {
  publish(null)
}
