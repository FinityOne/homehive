import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function getLandlordId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization')
  if (!auth) return null
  const token = auth.replace('Bearer ', '')
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  return user?.id ?? null
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params
  const landlordId = await getLandlordId(req)
  if (!landlordId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: group, error } = await supabaseAdmin
    .from('roommate_groups')
    .select('*, share_token, gender_preference')
    .eq('id', groupId)
    .eq('landlord_id', landlordId)
    .single()

  if (error || !group) return Response.json({ error: 'Not found' }, { status: 404 })

  const { data: members } = await supabaseAdmin
    .from('roommate_group_members')
    .select('id, lead_id, notes, added_at, room_id, leads(id, first_name, last_name, email, phone, status, closed_reason, property, created_at, move_in_date)')
    .eq('group_id', groupId)
    .order('added_at', { ascending: true })

  const leadIds = (members || []).map((m: Record<string, unknown>) => (m.leads as { id: string } | null)?.id).filter(Boolean)

  let prescreens: Record<string, boolean> = {}
  if (leadIds.length > 0) {
    const { data: ps } = await supabaseAdmin
      .from('pre_screens')
      .select('lead_id')
      .in('lead_id', leadIds)
    prescreens = Object.fromEntries((ps || []).map((p: { lead_id: string }) => [p.lead_id, true]))
  }

  const enriched = (members || []).map((m: Record<string, unknown>) => ({
    ...m,
    has_prescreen: prescreens[(m.leads as { id: string } | null)?.id ?? ''] ?? false,
  }))

  return Response.json({ group, members: enriched })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params
  const landlordId = await getLandlordId(req)
  if (!landlordId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const allowed = ['name', 'description', 'property_slug', 'emoji', 'gender_preference']
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }

  const { error } = await supabaseAdmin
    .from('roommate_groups')
    .update(update)
    .eq('id', groupId)
    .eq('landlord_id', landlordId)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ success: true })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params
  const landlordId = await getLandlordId(req)
  if (!landlordId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabaseAdmin
    .from('roommate_groups')
    .delete()
    .eq('id', groupId)
    .eq('landlord_id', landlordId)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ success: true })
}
