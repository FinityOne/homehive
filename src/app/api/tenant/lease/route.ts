/**
 * GET /api/tenant/lease
 *
 * Everything a signed-in tenant may see about their own tenancy: the lease,
 * their share of the rent broken down by line item, their payment history and
 * what they currently owe.
 *
 * Served through the service role rather than tenant-facing RLS: the payment
 * tables are landlord-owned, and a tenant must see exactly their own rows and
 * nothing about a housemate. That's a filter this route applies explicitly.
 */
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { loadTenantIdentity, tenantNames, payerBelongsToTenant } from '@/lib/tenantIdentity'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const identity = await loadTenantIdentity(supabaseAdmin, user)
  if (!identity) return Response.json({ tenancies: [] })

  const mine = identity.leaseTenants
  if (mine.length === 0) return Response.json({ tenancies: [] })

  const leaseIds = [...new Set(mine.map(lt => lt.lease_id))]

  const { data: leases } = await supabaseAdmin
    .from('leases')
    .select('id, property_id, start_date, end_date, rent_amount, unit_number, notes, property:properties ( id, name, address, slug )')
    .in('id', leaseIds)

  const { data: plans } = await supabaseAdmin
    .from('payment_plans')
    .select('id, lease_id, due_day, name, tenants:payment_plan_tenants ( id, name, email, monthly_total, start_date, end_date, status ), rule:late_fee_rules ( grace_period_days, fee_amount, frequency_days, max_total_fees )')
    .in('lease_id', leaseIds)

  const tenancies = []

  for (const lease of leases ?? []) {
    const plan = (plans ?? []).find((p: any) => p.lease_id === lease.id)

    // Which payer on this plan is *me*? Email, then an exact full-name match on
    // this lease. Nothing looser — see src/lib/tenantIdentity.ts.
    const myNames = tenantNames(identity, lease.id)
    const me = plan
      ? (plan.tenants ?? []).find((t: any) => payerBelongsToTenant(t, identity, myNames)) ?? null
      : null

    // A plan exists and names payers, but none of them is recognisably this
    // tenant. Saying "no lease" would send them off to browse listings; the
    // truth is their landlord has their details recorded differently.
    const unmatchedPlan = !!plan && (plan.tenants ?? []).length > 0 && !me

    let lineItems: any[] = []
    let scheduled: any[] = []
    let specials: any[] = []

    if (me) {
      const [li, sp, spec] = await Promise.all([
        supabaseAdmin.from('payment_line_items')
          .select('id, category, label, amount').eq('plan_tenant_id', me.id),
        supabaseAdmin.from('scheduled_payments')
          .select('id, due_date, amount, status, paid_amount, paid_date, late_fees_applied, payment_method, processing_fee, notes')
          .eq('plan_tenant_id', me.id).order('due_date'),
        supabaseAdmin.from('special_payments')
          .select('id, category, label, amount, due_date, status, paid_date, payment_method, processing_fee')
          .eq('plan_tenant_id', me.id).order('due_date'),
      ])
      lineItems = li.data ?? []
      scheduled = sp.data ?? []
      specials = spec.data ?? []
    }

    tenancies.push({
      lease: {
        id: lease.id,
        start_date: lease.start_date,
        end_date: lease.end_date,
        unit_number: lease.unit_number,
        rent_amount: lease.rent_amount,
        property: lease.property,
      },
      plan: plan ? { id: plan.id, due_day: plan.due_day, name: plan.name } : null,
      lateFeeRule: plan ? (Array.isArray(plan.rule) ? plan.rule[0] ?? null : plan.rule ?? null) : null,
      me: me ? { id: me.id, name: me.name, monthly_total: Number(me.monthly_total), status: me.status } : null,
      housemateCount: plan ? Math.max(0, (plan.tenants ?? []).length - 1) : 0,
      unmatchedPlan,
      lineItems: lineItems.map(l => ({ ...l, amount: Number(l.amount) })),
      scheduled: scheduled.map(s => ({
        ...s,
        amount: Number(s.amount),
        paid_amount: Number(s.paid_amount ?? 0),
        late_fees_applied: Number(s.late_fees_applied ?? 0),
        processing_fee: Number(s.processing_fee ?? 0),
      })),
      specials: specials.map(s => ({
        ...s,
        amount: Number(s.amount),
        processing_fee: Number(s.processing_fee ?? 0),
      })),
    })
  }

  return Response.json({ name: identity.fullName, tenancies })
}
