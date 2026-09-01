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
 * `auth.getUser()` asks the Supabase server, so a dropped wifi connection or a
 * slow response comes back as `user: null` — indistinguishable, to a caller,
 * from being signed out. Pages read that and bounce to /login, which is what a
 * logout "every few minutes" actually looked like.
 *
 * `auth.getSession()` answers from the locally stored session instead, and
 * refreshes it if the access token has expired, returning null only when the
 * refresh itself fails. So it is the honest authority on "am I still signed in",
 * and we fall back to it whenever getUser() comes back empty.
 */
export async function getCurrentUser(): Promise<User | null> {
  const { data } = await supabase.auth.getUser()
  if (data.user) return data.user

  const { data: sessionData } = await supabase.auth.getSession()
  return sessionData.session?.user ?? null
}
