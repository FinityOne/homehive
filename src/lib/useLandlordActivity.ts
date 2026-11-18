'use client'

import { useEffect, useState, useCallback, useSyncExternalStore } from 'react'
import type { ActivityEvent } from './landlordActivity'

/**
 * The feed, fetched once per document and shared by everything that shows it.
 *
 * Three things in the shell want this at the same moment — the bell's count,
 * the sidebar badge, and the bell's own list when it opens — and the Activity
 * page wants it immediately after. Fetching per component is how the portal
 * got slow last time: the shell asked for the same answer three times on every
 * page view, and the gate blocked rendering behind all of them.
 *
 * So there is one store at module scope with subscribers, which also settles a
 * correctness question: marking read in the bell must clear the sidebar badge
 * in the same tick. With three independent fetches it would not, and a badge
 * that survives being cleared is worse than no badge.
 *
 * The page's own filtered views are computed from this list in the client
 * (`filterEvents` in `landlordActivity.ts`) rather than refetched per tab —
 * a tab that costs a round trip is a tab nobody explores.
 */

export type ActivityState = {
  events: ActivityEvent[]
  lastReadAt: string | null
  unreadCount: number
  hasMore: boolean
  nextBefore: string | null
  /** Undefined until the first response lands. */
  loaded: boolean
}

const EMPTY: ActivityState = {
  events: [], lastReadAt: null, unreadCount: 0,
  hasMore: false, nextBefore: null, loaded: false,
}

/** The bell shows a page; the Activity page asks for more as you scroll. */
export const PAGE_SIZE = 50

let state: ActivityState = EMPTY
let inflight: Promise<void> | null = null
const subscribers = new Set<() => void>()

function publish(next: ActivityState) {
  state = next
  for (const fn of subscribers) fn()
}

/** The three `useSyncExternalStore` needs. State is replaced, never mutated,
 *  so an identity check is a correct and cheap "did anything change". */
function subscribe(onChange: () => void): () => void {
  subscribers.add(onChange)
  return () => { subscribers.delete(onChange) }
}
const getSnapshot = () => state
// The server has no feed and must not try to fetch one; it renders the empty
// shape, and the first client read fills it in.
const getServerSnapshot = () => EMPTY

type FeedResponse = {
  events?: ActivityEvent[]
  lastReadAt?: string | null
  unreadCount?: number
  hasMore?: boolean
  nextBefore?: string | null
}

function load(): Promise<void> {
  inflight ??= fetch(`/api/landlord/activity?limit=${PAGE_SIZE}`)
    .then(r => (r.ok ? (r.json() as Promise<FeedResponse>) : null))
    .then(data => {
      if (!data) {
        // A blip must not read as "nothing has happened". `loaded` flips so the
        // UI stops spinning, and the list stays whatever we last knew.
        publish({ ...state, loaded: true })
        return
      }
      publish({
        events: data.events ?? [],
        lastReadAt: data.lastReadAt ?? null,
        unreadCount: data.unreadCount ?? 0,
        hasMore: !!data.hasMore,
        nextBefore: data.nextBefore ?? null,
        loaded: true,
      })
    })
    .catch(() => { publish({ ...state, loaded: true }) })
  return inflight
}

/** Kick the request off before any component has mounted. */
export function prefetchActivity(): void {
  void load()
}

/** Drop the cache and refetch — after something the landlord just did. */
export function refreshActivity(): Promise<void> {
  inflight = null
  return load()
}

/** Append the next page. Resolves to false when there is nothing more. */
export async function loadMoreActivity(): Promise<boolean> {
  if (!state.hasMore || !state.nextBefore) return false
  const res = await fetch(
    `/api/landlord/activity?limit=${PAGE_SIZE}&before=${encodeURIComponent(state.nextBefore)}`,
  ).catch(() => null)
  if (!res?.ok) return false
  const data = (await res.json()) as FeedResponse
  const seen = new Set(state.events.map(e => e.id))
  publish({
    ...state,
    // Deduped on id: two readers paginating at once, or an event syncing in
    // mid-scroll, must not print the same row twice.
    events: [...state.events, ...(data.events ?? []).filter(e => !seen.has(e.id))],
    hasMore: !!data.hasMore,
    nextBefore: data.nextBefore ?? null,
  })
  return true
}

/**
 * Mark everything up to `until` read — by default, everything we have.
 *
 * The count is updated optimistically because this is the one interaction
 * where latency is felt: a badge that sits there for half a second after you
 * explicitly cleared it reads as a bug. The server's answer then replaces the
 * guess, and the server is the one that refuses to move the mark backwards.
 */
export async function markActivityRead(until?: string): Promise<void> {
  const target = until ?? state.events[0]?.occurred_at ?? new Date().toISOString()
  const optimistic = state.events.filter(
    e => new Date(e.occurred_at).getTime() > new Date(target).getTime(),
  ).length
  publish({ ...state, lastReadAt: target, unreadCount: optimistic })

  const res = await fetch('/api/landlord/activity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'mark_all_read', until: target }),
  }).catch(() => null)

  if (!res?.ok) { void refreshActivity(); return }
  const data = (await res.json()) as { lastReadAt?: string; unreadCount?: number | null }
  publish({
    ...state,
    lastReadAt: data.lastReadAt ?? target,
    unreadCount: data.unreadCount ?? optimistic,
  })
}

/**
 * The shared feed. `enabled` is false for tenants and on public pages.
 *
 * Subscribed through `useSyncExternalStore` rather than copied into component
 * state: this store lives outside React and is written to by the mark-read
 * call, so the subscription must be the thing React tears from — otherwise the
 * bell and the sidebar badge can render from two different snapshots of it.
 */
export function useLandlordActivity(enabled = true): ActivityState {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  useEffect(() => { if (enabled) void load() }, [enabled])

  return snapshot
}

/**
 * A scoped slice, for the feeds embedded on a property, lease or tenant.
 *
 * It asks the server rather than filtering the shared list, because the shared
 * list is only the most recent page — a property with no activity this week
 * would otherwise show "nothing yet" while its history sat two pages back.
 */
export function useScopedActivity(
  scope: { propertyId?: string | null; planId?: string | null; email?: string | null },
  limit = 8,
): { events: ActivityEvent[]; lastReadAt: string | null; loaded: boolean } {
  const [result, setResult] = useState<{
    events: ActivityEvent[]; lastReadAt: string | null; loaded: boolean
  }>({ events: [], lastReadAt: null, loaded: false })

  const { propertyId, planId, email } = scope
  // Nothing to scope by is a finished answer, not a pending one — and it is
  // derived rather than written into state, so the effect below never has to
  // set state synchronously just to say "there was nothing to ask".
  const unscoped = !propertyId && !planId && !email

  useEffect(() => {
    if (unscoped) return
    let cancelled = false
    const params = new URLSearchParams({ limit: String(limit) })
    if (propertyId) params.set('property', propertyId)
    if (planId) params.set('plan', planId)
    if (email) params.set('email', email)

    fetch(`/api/landlord/activity?${params}`)
      .then(r => (r.ok ? (r.json() as Promise<FeedResponse>) : null))
      .then(data => {
        if (cancelled) return
        setResult({
          events: data?.events ?? [],
          lastReadAt: data?.lastReadAt ?? null,
          loaded: true,
        })
      })
      .catch(() => { if (!cancelled) setResult(r => ({ ...r, loaded: true })) })

    return () => { cancelled = true }
  }, [propertyId, planId, email, limit, unscoped])

  return unscoped ? { events: [], lastReadAt: null, loaded: true } : result
}

/** For a component that wants the count without subscribing to the list. */
export function useActivityUnread(enabled = true): number {
  const { unreadCount } = useLandlordActivity(enabled)
  return unreadCount
}

/** Reset — used by tests and on sign-out. */
export function clearActivityCache(): void {
  inflight = null
  publish(EMPTY)
}

export const __testing = {
  get state() { return state },
  publish,
}

export const useMarkActivityRead = () =>
  useCallback((until?: string) => markActivityRead(until), [])
