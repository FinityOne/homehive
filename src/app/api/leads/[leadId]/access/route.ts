import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch the lead's property slug
  const { data: lead } = await supabaseAdmin
    .from('leads').select('id, property').eq('id', leadId).single()
  if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 })

  // Verify ownership
  const { data: property } = await supabaseAdmin
    .from('properties').select('id, owner_id').eq('slug', lead.property).single()
  if (!property) return Response.json({ error: 'Property not found' }, { status: 404 })
  if (property.owner_id !== user.id) return Response.json({ error: 'Forbidden' }, { status: 403 })

  // Already unlocked?
  const { data: existingUnlock } = await supabaseAdmin
    .from('lead_unlocks')
    .select('unlock_type')
    .eq('lead_id', leadId).eq('landlord_id', user.id)
    .maybeSingle()

  if (existingUnlock) {
    return Response.json({ isUnlocked: true, unlockType: existingUnlock.unlock_type, requiresPayment: false })
  }

  // Active plan?
  const { data: plan } = await supabaseAdmin
    .from('landlord_plans')
    .select('plan_type, status')
    .eq('landlord_id', user.id).eq('status', 'active')
    .maybeSingle()

  // Count prior unlocks for this listing (determines free eligibility)
  const { count: unlockCount } = await supabaseAdmin
    .from('lead_unlocks')
    .select('id', { count: 'exact', head: true })
    .eq('listing_id', property.id).eq('landlord_id', user.id)

  const isFreeLeadAvailable = (unlockCount ?? 0) === 0

  const planActive = plan && ['single_listing', 'two_listing', 'lifetime'].includes(plan.plan_type)

  return Response.json({
    isUnlocked: false,
    unlockType: null,
    isFreeLeadAvailable,
    requiresPayment: !isFreeLeadAvailable && !planActive,
  })
}
