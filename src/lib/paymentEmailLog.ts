// Server-only: records what payment requests we actually sent.
// Only import from API routes — it needs the service-role key.
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

/** One charge the email asked about, as the tenant was shown it. */
export type PaymentEmailItem = {
  /** Set for rent (scheduled_payments); leave null for a one-off charge. */
  scheduledPaymentId?: string | null
  /** Set for deposits and one-off charges (special_payments). */
  specialPaymentId?: string | null
  label: string
  dueDate: string
  amount: number
  kind: 'rent' | 'charge'
}

export type PaymentEmailRecord = {
  planId: string
  planTenantId: string | null
  recipientEmail: string
  recipientName: string | null
  subject: string
  kind?: string
  trigger?: 'manual' | 'auto'
  status: 'sent' | 'failed'
  error?: string | null
  providerId?: string | null
  customMessage?: string | null
  sentBy?: string | null
  items: PaymentEmailItem[]
}

/**
 * Write one request to the history, with the charges it covered.
 *
 * Never throws: an email that went out is a fact the landlord needs to see, and
 * losing the audit row is not a reason to fail their request or, worse, imply
 * the send failed when it did not.
 */
export async function logPaymentEmail(rec: PaymentEmailRecord): Promise<string | null> {
  try {
    const amountTotal = rec.items.reduce((s, i) => s + i.amount, 0)
    const { data, error } = await supabaseAdmin
      .from('payment_emails')
      .insert([{
        plan_id:        rec.planId,
        plan_tenant_id: rec.planTenantId,
        recipient_email: rec.recipientEmail,
        recipient_name:  rec.recipientName,
        subject:         rec.subject,
        kind:            rec.kind ?? 'rent_request',
        trigger:         rec.trigger ?? 'manual',
        status:          rec.status,
        error:           rec.error ?? null,
        provider_id:     rec.providerId ?? null,
        custom_message:  rec.customMessage ?? null,
        amount_total:    amountTotal,
        sent_by:         rec.sentBy ?? null,
      }])
      .select('id')
      .single()

    if (error || !data) {
      console.error('payment email log error:', error)
      return null
    }

    if (rec.items.length > 0) {
      const { error: itemErr } = await supabaseAdmin
        .from('payment_email_items')
        .insert(rec.items.map(i => ({
          email_id:             data.id,
          scheduled_payment_id: i.scheduledPaymentId ?? null,
          special_payment_id:   i.specialPaymentId ?? null,
          label:    i.label,
          due_date: i.dueDate,
          amount:   i.amount,
          kind:     i.kind,
        })))
      if (itemErr) console.error('payment email item log error:', itemErr)
    }
    return data.id
  } catch (e) {
    console.error('payment email log threw:', e)
    return null
  }
}
