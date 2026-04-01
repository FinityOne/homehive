import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getLeadContact(leadId: string) {
  const { data } = await supabaseAdmin
    .from('leads')
    .select('id, first_name, last_name, email, phone, move_in_date, status, created_at, pre_screens(*)')
    .eq('id', leadId).single()
  return data
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch lead + verify ownership
  const { data: lead } = await supabaseAdmin
    .from('leads').select('id, property').eq('id', leadId).single()
  if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 })

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
    const contact = await getLeadContact(leadId)
    return Response.json({ isUnlocked: true, unlockType: existingUnlock.unlock_type, contact })
  }

  // Active plan covers all leads?
  const { data: plan } = await supabaseAdmin
    .from('landlord_plans')
    .select('plan_type, status')
    .eq('landlord_id', user.id).eq('status', 'active')
    .maybeSingle()

  if (plan && ['single_listing', 'two_listing', 'lifetime'].includes(plan.plan_type)) {
    await supabaseAdmin.from('lead_unlocks').insert({
      lead_id: leadId, listing_id: property.id,
      landlord_id: user.id, unlock_type: 'subscription',
    })
    const contact = await getLeadContact(leadId)
    return Response.json({ isUnlocked: true, unlockType: 'subscription', contact })
  }

  // First lead on this listing = free
  const { count: unlockCount } = await supabaseAdmin
    .from('lead_unlocks')
    .select('id', { count: 'exact', head: true })
    .eq('listing_id', property.id).eq('landlord_id', user.id)

  if ((unlockCount ?? 0) === 0) {
    await supabaseAdmin.from('lead_unlocks').insert({
      lead_id: leadId, listing_id: property.id,
      landlord_id: user.id, unlock_type: 'free',
    })
    const contact = await getLeadContact(leadId)
    return Response.json({ isUnlocked: true, unlockType: 'free', contact })
  }

  return Response.json({ requiresPayment: true })
}
