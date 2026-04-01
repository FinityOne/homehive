import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { NextRequest } from 'next/server'

// Service-role client — bypasses RLS for admin reads/writes
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const VALID_PLAN_TYPES = ['single_listing', 'two_listing', 'lifetime'] as const
type OverridePlanType = typeof VALID_PLAN_TYPES[number] | 'free'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params

  const [profileRes, propertiesRes, planRes, unlocksRes] = await Promise.all([
    supabaseAdmin.from('profiles').select('*').eq('id', userId).single(),
    supabaseAdmin
      .from('properties')
      .select('id, name, slug, address, admin_status, is_active, created_at')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false }),
    supabaseAdmin.from('landlord_plans').select('*').eq('landlord_id', userId).maybeSingle(),
    supabaseAdmin
      .from('lead_unlocks')
      .select('id, lead_id, listing_id, unlock_type, stripe_payment_intent_id, created_at')
      .eq('landlord_id', userId)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  if (!profileRes.data) return Response.json({ error: 'User not found' }, { status: 404 })

  // Leads for their properties
  const slugs = (propertiesRes.data ?? []).map(p => p.slug)
  const leadsRes = slugs.length > 0
    ? await supabaseAdmin
        .from('leads')
        .select('id, property, status, created_at')
        .in('property', slugs)
        .order('created_at', { ascending: false })
    : { data: [] }

  // Audit log with admin profile names
  const auditRes = await supabaseAdmin
    .from('plan_audit_log')
    .select('*')
    .eq('landlord_id', userId)
    .order('created_at', { ascending: false })
    .limit(30)

  const auditEntries = auditRes.data ?? []
  let auditLog = auditEntries

  if (auditEntries.length > 0) {
    const adminIds = [...new Set(auditEntries.map((a: any) => a.admin_id))]
    const { data: adminProfiles } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email')
      .in('id', adminIds)
    const adminMap = Object.fromEntries((adminProfiles ?? []).map((p: any) => [p.id, p]))
    auditLog = auditEntries.map((entry: any) => ({
      ...entry,
      admin: adminMap[entry.admin_id] ?? null,
    }))
  }

  return Response.json({
    profile: profileRes.data,
    properties: propertiesRes.data ?? [],
    plan: planRes.data ?? null,
    unlocks: unlocksRes.data ?? [],
    leads: leadsRes.data ?? [],
    auditLog,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params

  // Identify the calling admin via their session cookie
  const supabaseServer = await createSupabaseServerClient()
  const { data: { user: adminUser } } = await supabaseServer.auth.getUser()
  if (!adminUser) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  if (body.action !== 'override_plan') {
    return Response.json({ error: 'Unknown action' }, { status: 400 })
  }

  const { plan_type, note } = body as { plan_type: OverridePlanType; note?: string }

  // Snapshot current plan for the audit delta
  const { data: currentPlan } = await supabaseAdmin
    .from('landlord_plans')
    .select('plan_type, status')
    .eq('landlord_id', userId)
    .maybeSingle()
  const fromPlanType = currentPlan?.status === 'active' ? currentPlan.plan_type : null

  // ── REVOKE ────────────────────────────────────────────────────────────────
  if (plan_type === 'free') {
    const { error } = await supabaseAdmin
      .from('landlord_plans')
      .update({ status: 'cancelled' })
      .eq('landlord_id', userId)
    if (error) return Response.json({ error: error.message }, { status: 500 })

    await supabaseAdmin.from('plan_audit_log').insert({
      landlord_id: userId,
      admin_id: adminUser.id,
      action: 'revoke',
      from_plan_type: fromPlanType,
      to_plan_type: null,
      note: note || null,
    })

    return Response.json({ ok: true, plan: null, fromPlanType, toPlanType: null })
  }

  // ── GRANT ─────────────────────────────────────────────────────────────────
  if (!VALID_PLAN_TYPES.includes(plan_type as any)) {
    return Response.json({ error: 'Invalid plan type. Only single_listing, two_listing, or lifetime may be granted.' }, { status: 400 })
  }

  // Lifetime = effectively never expires; monthly grants = 30 days (admin re-extends intentionally)
  const periodEnd = plan_type === 'lifetime'
    ? new Date(Date.now() + 100 * 365 * 86400000).toISOString()
    : new Date(Date.now() + 30 * 86400000).toISOString()

  const { data: newPlan, error: upsertErr } = await supabaseAdmin
    .from('landlord_plans')
    .upsert({
      landlord_id: userId,
      plan_type,
      status: 'active',
      stripe_subscription_id: 'admin_override',
      stripe_customer_id: null,
      current_period_end: periodEnd,
    }, { onConflict: 'landlord_id' })
    .select()
    .single()

  if (upsertErr) return Response.json({ error: upsertErr.message }, { status: 500 })

  const { data: auditEntry } = await supabaseAdmin
    .from('plan_audit_log')
    .insert({
      landlord_id: userId,
      admin_id: adminUser.id,
      action: 'grant',
      from_plan_type: fromPlanType,
      to_plan_type: plan_type,
      note: note || null,
    })
    .select()
    .single()

  // Attach admin profile to the returned audit entry for immediate UI update
  const { data: adminProfile } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, email')
    .eq('id', adminUser.id)
    .single()

  return Response.json({
    ok: true,
    plan: newPlan,
    auditEntry: auditEntry ? { ...auditEntry, admin: adminProfile } : null,
    fromPlanType,
    toPlanType: plan_type,
  })
}
