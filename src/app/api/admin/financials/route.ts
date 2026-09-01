// The money the platform itself makes.
//
// /api/admin/payments answers "who is on which plan". This answers a different
// question: of everything that moved this month, how much did we keep once
// Stripe was paid? Those are separate enough — different tables, different
// arithmetic — that mixing them into one handler would make both harder to read.
//
// This file is only the gate and the fetch. The arithmetic is in
// src/lib/financials.ts, which takes rows and returns the report.

import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  buildFinancials,
  type PaymentRow, type PlanRow, type PayerRow,
  type SubRow, type UnlockRow, type ProfileRow,
} from '@/lib/financials'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: callerProfile } = await supabaseAdmin
    .from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'admin')
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  const [
    { data: scheduledRows },
    { data: specialRows },
    { data: planRows },
    { data: payerRows },
    { data: subRows },
    { data: unlockRows },
  ] = await Promise.all([
    supabaseAdmin.from('scheduled_payments')
      .select('id, plan_id, plan_tenant_id, due_date, amount, paid_amount, paid_date, status, payment_method, processing_fee, recorded_by, stripe_payment_intent_id, updated_at'),
    supabaseAdmin.from('special_payments')
      .select('id, plan_id, plan_tenant_id, category, label, amount, due_date, paid_date, status, payment_method, processing_fee, recorded_by, stripe_payment_intent_id, updated_at'),
    supabaseAdmin.from('payment_plans')
      .select('id, name, owner_id, property_id, property:properties ( id, name )'),
    supabaseAdmin.from('payment_plan_tenants').select('id, plan_id, name, email'),
    supabaseAdmin.from('landlord_plans')
      .select('id, landlord_id, plan_type, status, stripe_subscription_id, created_at, updated_at, current_period_end'),
    supabaseAdmin.from('lead_unlocks').select('id, landlord_id, unlock_type, created_at, stripe_payment_intent_id'),
  ])

  const plans = (planRows ?? []) as unknown as PlanRow[]
  const subs = (subRows ?? []) as SubRow[]
  const unlocks = (unlockRows ?? []) as UnlockRow[]

  // Names for the ledger and the subscription lines: one lookup, not one each.
  const landlordIds = [...new Set([
    ...plans.map(p => p.owner_id),
    ...subs.map(s => s.landlord_id),
    ...unlocks.map(u => u.landlord_id),
  ].filter(Boolean))]
  const { data: profiles } = landlordIds.length
    ? await supabaseAdmin.from('profiles').select('id, full_name, email').in('id', landlordIds)
    : { data: [] as ProfileRow[] }

  return Response.json(buildFinancials({
    scheduled: (scheduledRows ?? []) as PaymentRow[],
    specials: (specialRows ?? []) as PaymentRow[],
    plans,
    payers: (payerRows ?? []) as PayerRow[],
    subs,
    unlocks,
    profiles: (profiles ?? []) as ProfileRow[],
  }))
}
