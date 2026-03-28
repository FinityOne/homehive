// Server-only email logging helper — only import from API routes
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export type EmailType =
  | 'lead_welcome'
  | 'prescreen_reminder'
  | 'lead_qualified_landlord'
  | 'new_lead_landlord'
  | 'listing_submitted'
  | 'listing_approved'
  | 'listing_rejected'

export async function logEmail(
  leadId: string,
  type: EmailType,
  subject: string,
  recipient: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from('email_logs').insert([{
    lead_id: leadId,
    type,
    subject,
    recipient,
    metadata: metadata || {},
  }])
  if (error) console.error('Email log error:', error)
}
