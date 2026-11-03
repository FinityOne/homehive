'use client'

import { supabase, getCurrentUser } from '@/lib/supabase'

/**
 * "Who is signed in, and what are they", read once per document.
 *
 * Two surfaces need exactly this answer at exactly the same moment: the app
 * shell (to draw the right nav and badges) and the landlord portal gate (to
 * decide whether a page may render at all). They used to ask independently,
 * so every landlord page load issued the same `profiles` row lookup twice —
 * and, because the gate renders a spinner instead of its children until it has
 * an answer, the page's own queries did not even start until the slower of the
 * two came back.
 *
 * Worse, the gate re-ran on every pathname change, so moving between two
 * portal pages paid for the whole lookup again before the second page could
 * begin loading. A role does not change while someone clicks around their own
 * portal; it changes when the session changes. So the promise is cached at
 * module scope and dropped on `onAuthStateChange`, which is the only event
 * that can actually invalidate it.
 */

export type CurrentProfile = {
  userId: string
  email: string
  fullName: string
  role: string
  avatarUrl: string | null
}

let cached: Promise<CurrentProfile | null> | null = null

export function loadCurrentProfile(): Promise<CurrentProfile | null> {
  cached ??= resolve()
  return cached
}

/** Drop the cache so the next read hits the network. */
export function refreshCurrentProfile(): void {
  cached = null
}

async function resolve(): Promise<CurrentProfile | null> {
  const user = await getCurrentUser()
  if (!user) return null

  const { data } = await supabase
    .from('profiles')
    .select('role, avatar_url')
    .eq('id', user.id)
    .maybeSingle()

  return {
    userId: user.id,
    email: user.email || '',
    fullName: (user.user_metadata?.full_name as string) || '',
    // A failed lookup must not silently promote or demote anyone; 'tenant' is
    // what the shell has always fallen back to and is the least-privileged
    // answer, and the portal gate treats a non-landlord role as "not gated by
    // a plan" rather than as access.
    role: data?.role || 'tenant',
    avatarUrl: data?.avatar_url || null,
  }
}

// A new session means a new person: everything derived from the old one goes.
if (typeof window !== 'undefined') {
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
      cached = null
    }
  })
}
