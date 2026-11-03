import { createBrowserClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'

// ONE browser Supabase client for the whole app.
//
// Every module that used to call createBrowserClient() at its own top level got
// its own GoTrueClient, each with its own auto-refresh timer and its own view of
// the session. Supabase rotates refresh tokens, so two of those timers firing
// together meant the second one replayed a token the first had already spent —
// Supabase revoked the family and the user was thrown back to /login mid-session.
// Importing this shared instance is what keeps refreshes serialised.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/**
 * The signed-in user, or null if there genuinely isn't one.
 *
 * `auth.getUser()` asks the Supabase server, so every caller paid a network
 * round trip before it could even start fetching its own data — and the
 * landlord portal has three callers deep in a chain (the app shell, the portal
 * gate, the page itself), so a page waited on that same request three times
 * over before its first query left the browser.
 *
 * `auth.getSession()` answers from the locally stored session instead, and
 * only touches the network when the access token has actually expired. It is
 * also the *more* honest authority on "am I still signed in": a dropped wifi
 * connection makes `getUser()` return `user: null`, indistinguishable to a
 * caller from being signed out, which is what a logout "every few minutes"
 * actually looked like. So the session is asked first and `getUser()` is kept
 * only as the fallback for the case where no session is stored at all.
 *
 * Nothing is trusted to this value that isn't also enforced server-side: it
 * supplies an id to scope queries with, and RLS (plus the API routes' own
 * `getUser()` checks) is what actually decides what that id may read.
 *
 * Concurrent callers share one in-flight promise, so the shell, the gate and
 * the page asking at once cost one answer rather than three.
 */
let inFlightUser: Promise<User | null> | null = null

export async function getCurrentUser(): Promise<User | null> {
  inFlightUser ??= resolveCurrentUser().finally(() => { inFlightUser = null })
  return inFlightUser
}

async function resolveCurrentUser(): Promise<User | null> {
  const { data: sessionData } = await supabase.auth.getSession()
  if (sessionData.session?.user) return sessionData.session.user

  const { data } = await supabase.auth.getUser()
  return data.user ?? null
}
