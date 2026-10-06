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
  | 'admin_new_lead'
  | 'listing_submitted'
  | 'listing_approved'
  | 'listing_awaiting_plan'
  | 'listing_rejected'
  | 'admin_new_signup'
  | 'admin_claim_notify'
  | 'admin_daily_digest'
  | 'tour_invitation'
  | 'tour_confirmation_tenant'
  | 'tour_confirmation_landlord'
  | 'tour_reminder'
  | 'tour_cancellation_tenant'
  | 'tour_cancellation_landlord'
  | 'prescreen_done_followup'
  | 'reservation_sent'

/**
 * Record an email we sent.
 *
 * `leadId` is empty for everything that is not about a specific lead — admin
 * digests, signup notices, listing approvals. `email_logs.lead_id` is a uuid,
 * and Postgres rejects `''` for a uuid outright, so every one of those callers
 * was failing its insert with `22P02 invalid input syntax for type uuid` and
 * logging nothing. The error was caught and printed, so sends kept working and
 * the log quietly stayed empty for all non-lead mail.
 *
 * Normalising here rather than at seven call sites: "no lead" is a property of
 * the data, not something each caller should have to spell as null correctly.
 */
export async function logEmail(
  leadId: string | null | undefined,
  type: EmailType,
  subject: string,
  recipient: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from('email_logs').insert([{
    lead_id: leadId?.trim() ? leadId.trim() : null,
    type,
    subject,
    recipient,
    metadata: metadata || {},
  }])
  if (error) console.error('Email log error:', error)
}
