import { createClient } from '@supabase/supabase-js'
import { getPlatformStats } from '@/lib/platformStats'

/**
 * Real demand numbers for the landlord pitch.
 *
 * Public and unauthenticated on purpose — these are the figures we are willing
 * to put in front of anyone deciding whether to pay, and the subscribe page
 * renders in the browser. The underlying tables stay private: everything comes
 * back through a `security definer` aggregate that can only ever return seven
 * integers, so there is no row here to leak.
 *
 * Cached for an hour. The numbers move slowly, a landlord reading the page does
 * not need them to the second, and the aggregate scans `leads` and
 * `site_visits` in full — not something to run on every page view.
 */

const anon = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

export const revalidate = 3600

export async function GET() {
  const stats = await getPlatformStats(anon())

  return Response.json(stats, {
    headers: {
      // Serve stale while refreshing so a cold cache never makes the pitch
      // render empty — zeros read as "nobody uses this platform".
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
