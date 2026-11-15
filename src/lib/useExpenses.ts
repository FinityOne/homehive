'use client'

/**
 * One load of the cost side, shared by every screen that shows it.
 *
 * The same shape and the same reasoning as `useMoney`, for the same reason:
 * the Expenses tab, the property money page, the portfolio comparison and the
 * owner statement all want the whole owner's expense ledger, and a landlord
 * moving between them in thirty seconds should not ask for it four times.
 *
 * Kept as its own cache rather than folded into `useMoney` deliberately. The
 * expense ledger is small and written constantly — recording a cost reloads it
 * on every save — while the portfolio query is the heaviest read in the portal
 * and must not be re-run because somebody typed in an insurance premium. Two
 * caches means a cost appears instantly and the rent data is left alone.
 */

import { useCallback, useEffect, useState } from 'react'
import { getCurrentUser } from '@/lib/supabase'
import { getExpenses, type Expense } from '@/lib/propertyExpenses'

/** Short, because this is the one money dataset the landlord edits by hand and
 *  then immediately expects to see. Every mutation calls `reload()` anyway. */
const TTL_MS = 30_000

type Snapshot = { ownerId: string; at: number; items: Expense[] }

let cache: Snapshot | null = null
let inflight: Promise<Snapshot | null> | null = null
const subscribers = new Set<(s: Snapshot | null) => void>()

const publish = (s: Snapshot | null) => {
  cache = s
  for (const fn of subscribers) fn(s)
}

async function fetchAll(): Promise<Snapshot | null> {
  const user = await getCurrentUser()
  if (!user) return null
  return { ownerId: user.id, at: Date.now(), items: await getExpenses(user.id) }
}

const isFresh = () => cache !== null && Date.now() - cache.at < TTL_MS

function ensure(force: boolean): Promise<Snapshot | null> {
  if (!force && isFresh()) return Promise.resolve(cache)
  if (inflight) return inflight
  inflight = fetchAll()
    .then(snap => { publish(snap); return snap })
    .catch(err => { console.error('useExpenses:', err); return cache })
    .finally(() => { inflight = null })
  return inflight
}

export type Expenses = {
  items: Expense[]
  /** True only on the first load, when there is nothing to show yet. */
  loading: boolean
  /** Hard refetch. Every write calls this. */
  reload: () => Promise<void>
}

export function useExpenses(): Expenses {
  const [snap, setSnap] = useState<Snapshot | null>(cache)
  const [settled, setSettled] = useState(cache !== null)

  useEffect(() => {
    const onChange = (s: Snapshot | null) => setSnap(s)
    subscribers.add(onChange)
    let live = true

    if (isFresh()) return () => { live = false; subscribers.delete(onChange) }

    ensure(false).finally(() => { if (live) setSettled(true) })
    return () => { live = false; subscribers.delete(onChange) }
  }, [])

  const reload = useCallback(async () => { await ensure(true) }, [])

  return {
    items: snap?.items ?? [],
    loading: snap === null && !settled,
    reload,
  }
}

/** Drop the cache — for sign-out, so the next account never reads these. */
export function clearExpenseCache() {
  publish(null)
}
