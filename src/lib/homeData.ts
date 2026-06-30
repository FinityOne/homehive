// Server-side data for the public home + browse pages. Uses a plain anonymous
// client (no cookies/session) so the marketing pages can be statically rendered
// / ISR-cached instead of doing a per-request authed round-trip. Public listing
// rows are readable by anon under RLS, exactly like the client path.
import { createClient } from '@supabase/supabase-js'
import { PROPERTY_CARD_SELECT, mapPropertyCard, type Property } from './properties'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

export async function getHomeCardsServer(): Promise<Property[]> {
  const { data, error } = await supabase
    .from('properties')
    .select(PROPERTY_CARD_SELECT)
    .eq('is_active', true)
    .eq('admin_status', 'active')
    .eq('is_test', false)
    .is('archived_at', null)
    .order('created_at', { ascending: true })

  if (error || !data) {
    console.error('getHomeCardsServer error:', error)
    return []
  }
  return data.map(mapPropertyCard)
}
