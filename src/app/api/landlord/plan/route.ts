import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin, loadPlanState } from '@/lib/landlordPlanServer'

/**
 * One answer to "what is this landlord allowed to do right now".
 *
 * The portal gate, the billing page and the new-listing wizard all need the
 * same three facts — plan, properties used, properties allowed — and reading
 * them from one endpoint is what keeps those three screens from disagreeing
 * with each other.
 */
export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const state = await loadPlanState(supabaseAdmin(), user.id)

  return Response.json({
    planType: state.plan?.plan_type ?? null,
    status: state.plan?.status ?? null,
    currentPeriodEnd: state.plan?.current_period_end ?? null,
    hasBillingAccount: !!state.plan?.stripe_customer_id,
    hasSubscription: !!state.plan?.stripe_subscription_id,
    hasAccess: state.hasAccess,
    propertyCount: state.propertyCount,
    propertyLimit: state.propertyLimit,
    canAddProperty: state.canAddProperty,
  })
}
