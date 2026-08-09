// Server-side data for the public home + browse pages. Uses a plain anonymous
// client (no cookies/session) so the marketing pages can be statically rendered
// / ISR-cached instead of doing a per-request authed round-trip. Public listing
// rows are readable by anon under RLS, exactly like the client path.
import { createClient } from '@supabase/supabase-js'
import { PROPERTY_CARD_SELECT, PUBLIC_STATUS_FILTER, mapPropertyCard, type Property } from './properties'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

/**
 * Card feed for the public pages.
 * `marketingOnly` (homepage) drops listings whose landlord turned promotion off
 * and anything not currently Live; the browse page passes nothing and also gets
 * Rented-with-waitlist listings.
 */
export async function getHomeCardsServer(opts: { marketingOnly?: boolean } = {}): Promise<Property[]> {
  let query = supabase
    .from('properties')
    .select(PROPERTY_CARD_SELECT)
    .eq('is_active', true)
    .eq('admin_status', 'active')
    .eq('is_test', false)
    .is('archived_at', null)
    .or(PUBLIC_STATUS_FILTER)

  if (opts.marketingOnly) {
    query = query.eq('marketing_enabled', true).eq('listing_status', 'active')
  }

  const { data, error } = await query.order('created_at', { ascending: true })

  if (error || !data) {
    console.error('getHomeCardsServer error:', error)
    return []
  }
  return data.map(mapPropertyCard)
}
