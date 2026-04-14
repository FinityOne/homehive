/**
 * Server-only helper — call from API routes to create landlord notifications.
 * Import only in route handlers, never in client components.
 */
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export type NotifType = 'lead_in' | 'prescreen_filled' | 'tour_booked'

export async function notifyLandlord(params: {
  landlordId: string
  type: NotifType
  leadId?: string
  title: string
  body?: string
  href?: string
}): Promise<void> {
  const { error } = await supabaseAdmin.from('notifications').insert([{
    landlord_id: params.landlordId,
    type: params.type,
    lead_id: params.leadId || null,
    title: params.title,
    body: params.body || null,
    href: params.href || null,
  }])
  if (error) console.error('notifyLandlord error:', error.message)
}
