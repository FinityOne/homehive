import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  planPriceCents, planMonthlyCents, PLAN_ORDER, RETIRED_PLAN_TYPES,
} from '@/lib/landlordPlans'

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

  // ── 1. All plans ──────────────────────────────────────────────────────────
  const { data: rawPlans } = await supabaseAdmin
    .from('landlord_plans')
    .select('id, landlord_id, plan_type, status, stripe_customer_id, stripe_subscription_id, current_period_end, created_at, updated_at')
    .order('created_at', { ascending: false })

  const plans = rawPlans ?? []

  // Bulk-fetch profiles for all landlord_ids
  const landlordIds = [...new Set(plans.map(p => p.landlord_id))]
  const { data: profiles } = landlordIds.length
    ? await supabaseAdmin.from('profiles').select('id, full_name, email, role').in('id', landlordIds)
    : { data: [] }
  const profileMap: Record<string, { full_name: string | null; email: string; role: string }> =
    Object.fromEntries((profiles ?? []).map(p => [p.id, p]))

  const plansWithProfile = plans.map(p => ({
    ...p,
    profile: profileMap[p.landlord_id] ?? null,
  }))

  // ── 2. Lead unlocks ───────────────────────────────────────────────────────
  const { data: rawUnlocks } = await supabaseAdmin
    .from('lead_unlocks')
    .select('id, unlock_type, created_at, landlord_id, stripe_payment_intent_id')
    .order('created_at', { ascending: false })

  const unlocks = rawUnlocks ?? []

  // ── 3. Audit log (last 50) ────────────────────────────────────────────────
  const { data: rawAudit } = await supabaseAdmin
    .from('plan_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  const auditAdminIds = [...new Set((rawAudit ?? []).map((a: any) => a.admin_id))]
  const { data: adminProfiles } = auditAdminIds.length
    ? await supabaseAdmin.from('profiles').select('id, full_name, email').in('id', auditAdminIds)
    : { data: [] }
  const adminMap = Object.fromEntries((adminProfiles ?? []).map(p => [p.id, p]))
  const auditLog = (rawAudit ?? []).map((e: any) => ({ ...e, admin: adminMap[e.admin_id] ?? null }))

  // ── 4. Monthly breakdown (last 12 months) ────────────────────────────────
  const now = new Date()
  const months: string[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  // Prices come from `landlordPlans.ts` — the live tiers and the retired plans
  // in one map. This route used to carry its own copy, and it was never given
  // the self-serve tiers: every Starter/Growth/Unlimited subscriber priced at
  // zero, so MRR, ARR and the revenue chart all read $0 while landlords were
  // in fact being charged.
  const planDollars = (planType: string) => planPriceCents(planType) / 100

  // Revenue per month: subscriptions started + per-lead unlocks + lifetime purchases
  const revenueByMonth: Record<string, number> = {}
  const newSubsByMonth:  Record<string, number> = {}
  for (const m of months) { revenueByMonth[m] = 0; newSubsByMonth[m] = 0 }

  for (const p of plans) {
    if (!p.created_at) continue
    const m = p.created_at.slice(0, 7)
    if (!(m in revenueByMonth)) continue
    const isPaid = p.stripe_subscription_id && p.stripe_subscription_id !== 'admin_override'
    if (isPaid) {
      revenueByMonth[m] = +(revenueByMonth[m] + planDollars(p.plan_type)).toFixed(2)
      newSubsByMonth[m] = (newSubsByMonth[m] ?? 0) + 1
    }
  }

  for (const u of unlocks) {
    if (!u.created_at || u.unlock_type !== 'per_lead') continue
    const m = u.created_at.slice(0, 7)
    if (!(m in revenueByMonth)) continue
    revenueByMonth[m] = +(revenueByMonth[m] + planDollars('per_lead')).toFixed(2)
  }

  const monthlyRevenue = months.map(m => ({
    month: m,
    revenue: revenueByMonth[m] ?? 0,
    newSubs: newSubsByMonth[m] ?? 0,
  }))

  // ── 5. Top-level stats ────────────────────────────────────────────────────
  const activePaid = plans.filter(p =>
    p.status === 'active' &&
    p.stripe_subscription_id &&
    p.stripe_subscription_id !== 'admin_override' &&
    p.plan_type !== 'lifetime'
  )
  const activeAdminGrants = plans.filter(p =>
    p.status === 'active' && p.stripe_subscription_id === 'admin_override'
  )
  const lifetimePaid = plans.filter(p =>
    p.plan_type === 'lifetime' &&
    p.stripe_subscription_id !== 'admin_override'
  )
  const perLeadPaid = unlocks.filter(u => u.unlock_type === 'per_lead')

  // A lifetime row bills nothing monthly — `planMonthlyCents` answers 0 for it
  // and for per-lead, so neither can inflate MRR.
  const mrr = activePaid.reduce((sum, p) => sum + planMonthlyCents(p.plan_type) / 100, 0)

  const lifetimeRevenue = lifetimePaid.length * planDollars('lifetime')
  const perLeadRevenue  = perLeadPaid.length * planDollars('per_lead')
  const estimatedTotalRevenue = +(mrr + lifetimeRevenue + perLeadRevenue).toFixed(2)

  // Every plan type, live tiers first, then the retired ones — but only those
  // that actually have rows, so the chart is not padded with dead categories.
  const breakdownTypes = [
    ...PLAN_ORDER,
    ...RETIRED_PLAN_TYPES.filter(pt => plans.some(p => p.plan_type === pt)),
  ]
  const planTypeBreakdown = breakdownTypes.map(pt => ({
    plan_type: pt,
    active: plans.filter(p => p.plan_type === pt && p.status === 'active').length,
    total:  plans.filter(p => p.plan_type === pt).length,
  }))

  const unlockTypeBreakdown = ['per_lead', 'subscription', 'free', 'plan'].map(ut => ({
    type:  ut,
    count: unlocks.filter(u => u.unlock_type === ut).length,
  }))

  return Response.json({
    stats: {
      mrr: +mrr.toFixed(2),
      estimatedTotalRevenue,
      activePaidCount:      activePaid.length,
      adminGrantCount:      activeAdminGrants.length,
      lifetimePaidCount:    lifetimePaid.length,
      perLeadPaidCount:     perLeadPaid.length,
      totalPlans:           plans.length,
      totalUnlocks:         unlocks.length,
      cancelledCount:       plans.filter(p => p.status === 'cancelled').length,
    },
    plans:              plansWithProfile,
    unlocks:            unlocks.slice(0, 200),
    monthlyRevenue,
    planTypeBreakdown,
    unlockTypeBreakdown,
    auditLog,
  })
}
