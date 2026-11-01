/**
 * POST   /api/landlord/late-fees/waive   — write a fee off
 * DELETE /api/landlord/late-fees/waive   — put it back
 *
 * Body (both): { scheduledPaymentId, reason? }
 *
 * Waiving is not a cosmetic "hide this row". It is the landlord's recorded
 * decision not to collect, and it is what lets the pending-fee list reach zero
 * — a list that cannot reach zero is one a landlord learns to scroll past.
 *
 * The amount stored is **recomputed here**, not taken from the request, for the
 * same reason the reminder route recomputes: a stale tab must not be able to
 * decide how much was forgiven. Once written it is frozen, because it is
 * history — recomputing it later against today's date would quietly rewrite
 * what the landlord actually chose to forgive.
 */
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { lateFeeDue, type LateFeeRuleLike } from '@/lib/rentPayments'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

/** Resolve the caller and prove they own the plan this charge sits on. */
async function authorizeCharge(req: NextRequest, scheduledPaymentId: string) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: charge } = await supabaseAdmin
    .from('scheduled_payments')
    .select('id, plan_id, due_date, amount, paid_amount, paid_date, status, late_fee_paid')
    .eq('id', scheduledPaymentId)
    .maybeSingle()
  if (!charge) return { error: Response.json({ error: 'Charge not found' }, { status: 404 }) }

  const { data: plan } = await supabaseAdmin
    .from('payment_plans')
    .select('id, owner_id, rule:late_fee_rules ( grace_period_days, fee_amount, frequency_days, max_total_fees )')
    .eq('id', charge.plan_id)
    .maybeSingle()
  if (!plan) return { error: Response.json({ error: 'Plan not found' }, { status: 404 }) }
  if (plan.owner_id !== user.id) return { error: Response.json({ error: 'Unauthorized' }, { status: 403 }) }

  const raw = plan.rule as LateFeeRuleLike | LateFeeRuleLike[] | null
  const rule = Array.isArray(raw) ? (raw[0] ?? null) : raw
  return { user, charge, plan, rule }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const scheduledPaymentId: string | undefined = body.scheduledPaymentId
  const reason: string | null = typeof body.reason === 'string' && body.reason.trim()
    ? body.reason.trim().slice(0, 300)
    : null
  if (!scheduledPaymentId) {
    return Response.json({ error: 'scheduledPaymentId is required.' }, { status: 400 })
  }

  const auth = await authorizeCharge(req, scheduledPaymentId)
  if ('error' in auth) return auth.error
  const { user, charge, plan, rule } = auth

  const assessed = lateFeeDue(rule, {
    status: charge.status as string,
    due_date: charge.due_date as string,
    paid_date: (charge.paid_date ?? null) as string | null,
    amount: Number(charge.amount),
    paid_amount: Number(charge.paid_amount ?? 0),
  })
  // Only the part still owed can be forgiven. Fee money that already arrived
  // has arrived; "waiving" it would misreport collected income as written off.
  const outstanding = Math.round((assessed - Number(charge.late_fee_paid ?? 0)) * 100) / 100
  if (outstanding <= 0.005) {
    return Response.json({ error: 'There is no outstanding late fee on that charge.' }, { status: 409 })
  }

  const { error } = await supabaseAdmin
    .from('late_fee_waivers')
    .upsert(
      {
        scheduled_payment_id: scheduledPaymentId,
        plan_id: plan.id,
        amount: outstanding,
        reason,
        waived_by: user.id,
      },
      // Waiving twice is the same decision, so a repeat updates rather than
      // failing on the unique constraint.
      { onConflict: 'scheduled_payment_id' },
    )

  if (error) {
    console.error('late fee waive failed', scheduledPaymentId, error)
    return Response.json({ error: 'Could not record the waiver.' }, { status: 500 })
  }

  return Response.json({ waived: outstanding })
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const scheduledPaymentId: string | undefined = body.scheduledPaymentId
  if (!scheduledPaymentId) {
    return Response.json({ error: 'scheduledPaymentId is required.' }, { status: 400 })
  }

  const auth = await authorizeCharge(req, scheduledPaymentId)
  if ('error' in auth) return auth.error

  const { error } = await supabaseAdmin
    .from('late_fee_waivers')
    .delete()
    .eq('scheduled_payment_id', scheduledPaymentId)

  if (error) {
    console.error('late fee unwaive failed', scheduledPaymentId, error)
    return Response.json({ error: 'Could not undo the waiver.' }, { status: 500 })
  }

  // The fee is derived, so removing the waiver is all it takes for it to be
  // owed again at whatever the rule now says.
  return Response.json({ restored: true })
}
