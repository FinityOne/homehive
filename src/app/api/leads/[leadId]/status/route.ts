import { createClient } from '@supabase/supabase-js'
import type { Lead } from '@/lib/leads'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params
  const body = await req.json()

  const status: Lead['status'] = body.status
  const closedReason: 'leased' | 'lost' | undefined = body.closed_reason

  if (!status) {
    return Response.json({ error: 'status is required' }, { status: 400 })
  }

  const updatePayload: Record<string, unknown> = { status }
  if (status === 'closed' && closedReason) updatePayload.closed_reason = closedReason

  // Fetch lead to check for group membership
  const { data: lead } = await supabaseAdmin
    .from('leads').select('lead_group_id, property').eq('id', leadId).single()

  let error: unknown = null

  if (lead?.lead_group_id && lead?.property) {
    // Cascade to all leads in the same group + property
    const { error: e } = await supabaseAdmin
      .from('leads')
      .update(updatePayload)
      .eq('lead_group_id', lead.lead_group_id)
      .eq('property', lead.property)
    error = e
  } else {
    const { error: e } = await supabaseAdmin
      .from('leads').update(updatePayload).eq('id', leadId)
    error = e
  }

  if (error) {
    console.error('Status update error:', error)
    return Response.json({ error: 'Failed to update status' }, { status: 500 })
  }

  return Response.json({ success: true })
}
