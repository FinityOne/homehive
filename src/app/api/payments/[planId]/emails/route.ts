/**
 * GET /api/payments/[planId]/emails
 *
 * Every payment request sent on this lease, newest first, with the charges each
 * one covered. Feeds both the Activity tab and the per-row history in the
 * ledger — the ledger filters client-side rather than refetching per row, since
 * one lease's history is small and the rows are already on screen.
 */
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

export async function GET(req: NextRequest, ctx: { params: Promise<{ planId: string }> }) {
  const { planId } = await ctx.params

  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: plan } = await supabaseAdmin
    .from('payment_plans').select('id, owner_id').eq('id', planId).maybeSingle()
  if (!plan) return Response.json({ error: 'Plan not found' }, { status: 404 })
  if (plan.owner_id !== user.id) return Response.json({ error: 'Unauthorized' }, { status: 403 })

  const { data, error } = await supabaseAdmin
    .from('payment_emails')
    .select('id, plan_tenant_id, recipient_email, recipient_name, subject, kind, trigger, status, error, custom_message, amount_total, created_at, items:payment_email_items ( id, scheduled_payment_id, special_payment_id, label, due_date, amount, kind )')
    .eq('plan_id', planId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('payment email history error:', error)
    return Response.json({ error: 'Could not load email history' }, { status: 500 })
  }
  return Response.json({ emails: data ?? [] })
}
