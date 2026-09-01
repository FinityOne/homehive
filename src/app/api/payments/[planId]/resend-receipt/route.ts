/**
 * POST /api/payments/[planId]/resend-receipt
 *
 * Send a payment confirmation again — to the tenant, the landlord, or both.
 *
 * The automatic receipt claims a (payment_intent_id, kind) row so the webhook
 * and the browser's confirm call cannot both send. A manual resend deliberately
 * skips that claim: the landlord is asking precisely because the first one did
 * not arrive, and a claim already taken would make this a silent no-op.
 *
 * Body: {
 *   scheduledIds?: string[], specialIds?: string[],
 *   audience?: 'tenant' | 'landlord' | 'both'
 * }
 *
 * Only settled rows can be confirmed — resending a "receipt" for money that has
 * not arrived tells the tenant they are square when they are not.
 */
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { resendRentPaymentEmails, type Audience } from '@/lib/rentPaymentNotify'
import type { PayEvent } from '@/lib/rentPaymentEmails'
import type { PayMethod } from '@/lib/rentPayments'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

const monthLabel = (due: string) =>
  `Rent — ${new Date(due + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`

export async function POST(req: NextRequest, ctx: { params: Promise<{ planId: string }> }) {
  const { planId } = await ctx.params

  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: plan } = await supabaseAdmin
    .from('payment_plans').select('id, owner_id').eq('id', planId).maybeSingle()
  if (!plan) return Response.json({ error: 'Plan not found' }, { status: 404 })
  if (plan.owner_id !== user.id) return Response.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const scheduledIds: string[] = Array.isArray(body.scheduledIds) ? body.scheduledIds : []
  const specialIds:   string[] = Array.isArray(body.specialIds)   ? body.specialIds   : []
  const audience: Audience =
    body.audience === 'tenant' || body.audience === 'landlord' ? body.audience : 'both'

  if (scheduledIds.length === 0 && specialIds.length === 0) {
    return Response.json({ error: 'Nothing selected to confirm.' }, { status: 400 })
  }

  // Scoped to this plan, so an id from someone else's ledger cannot be smuggled in.
  const [schedRes, specRes] = await Promise.all([
    scheduledIds.length
      ? supabaseAdmin.from('scheduled_payments')
          .select('id, amount, due_date, status, payment_method, processing_fee, stripe_payment_intent_id')
          .eq('plan_id', planId).in('id', scheduledIds)
      : Promise.resolve({ data: [] as never[] }),
    specialIds.length
      ? supabaseAdmin.from('special_payments')
          .select('id, amount, label, status, payment_method, processing_fee, stripe_payment_intent_id')
          .eq('plan_id', planId).in('id', specialIds)
      : Promise.resolve({ data: [] as never[] }),
  ])

  type Row = {
    id: string; amount: number; label: string; status: string
    payment_method: string | null; processing_fee: number | null
    stripe_payment_intent_id: string | null
    kind: 'scheduled' | 'special'
  }
  const rows: Row[] = [
    ...((schedRes.data ?? []) as Record<string, unknown>[]).map(r => ({
      id: r.id as string, amount: Number(r.amount), label: monthLabel(r.due_date as string),
      status: r.status as string, payment_method: (r.payment_method as string) ?? null,
      processing_fee: r.processing_fee as number | null,
      stripe_payment_intent_id: (r.stripe_payment_intent_id as string) ?? null,
      kind: 'scheduled' as const,
    })),
    ...((specRes.data ?? []) as Record<string, unknown>[]).map(r => ({
      id: r.id as string, amount: Number(r.amount), label: r.label as string,
      status: r.status as string, payment_method: (r.payment_method as string) ?? null,
      processing_fee: r.processing_fee as number | null,
      stripe_payment_intent_id: (r.stripe_payment_intent_id as string) ?? null,
      kind: 'special' as const,
    })),
  ]

  if (rows.length === 0) {
    return Response.json({ error: 'Those charges are not on this lease.' }, { status: 404 })
  }

  // A confirmation is only true for money that actually arrived.
  const settled = rows.filter(r => r.status === 'paid' || r.status === 'processing')
  if (settled.length === 0) {
    return Response.json(
      { error: 'Only settled payments can be confirmed. Mark it paid first, or send a payment request instead.' },
      { status: 409 }
    )
  }

  // The first settled row carries how the payment was made; a single intent
  // never spans two tenants, so one set of details covers the whole receipt.
  const lead = settled[0]
  const event: PayEvent = lead.status === 'processing' ? 'processing' : 'paid'
  const method: PayMethod = lead.payment_method === 'ach' ? 'ach' : 'card'

  const result = await resendRentPaymentEmails({
    db: supabaseAdmin,
    // Offline payments have no Stripe intent; the receipt still needs a
    // reference the landlord and tenant can quote at each other.
    intent: { id: lead.stripe_payment_intent_id ?? `manual-${lead.id.slice(0, 8)}`, receipt_email: null },
    event,
    method,
    fee: Number(lead.processing_fee ?? 0),
    rows: settled.map(r => ({ kind: r.kind, id: r.id, amount: r.amount, label: r.label })),
    audience,
    sentBy: user.id,
  })

  return Response.json({
    sent: result.sent,
    skipped: result.skipped,
    // Nothing delivered is a failure the landlord must see, not a quiet success.
    ok: result.sent.length > 0,
  }, { status: result.sent.length > 0 ? 200 : 502 })
}
