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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params
  const landlordId = await getLandlordId(req)
  if (!landlordId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { lead_id, notes } = await req.json()
  if (!lead_id) return Response.json({ error: 'lead_id is required' }, { status: 400 })

  // Verify group belongs to landlord
  const { data: group } = await supabaseAdmin
    .from('roommate_groups')
    .select('id')
    .eq('id', groupId)
    .eq('landlord_id', landlordId)
    .single()

  if (!group) return Response.json({ error: 'Group not found' }, { status: 404 })

  const { error } = await supabaseAdmin
    .from('roommate_group_members')
    .upsert([{ group_id: groupId, lead_id, notes: notes || null }], { onConflict: 'group_id,lead_id' })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ success: true })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params
  const landlordId = await getLandlordId(req)
  if (!landlordId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { lead_id, room_id } = await req.json()
  if (!lead_id) return Response.json({ error: 'lead_id is required' }, { status: 400 })

  const { data: group } = await supabaseAdmin
    .from('roommate_groups')
    .select('id')
    .eq('id', groupId)
    .eq('landlord_id', landlordId)
    .single()

  if (!group) return Response.json({ error: 'Group not found' }, { status: 404 })

  const { error } = await supabaseAdmin
    .from('roommate_group_members')
    .update({ room_id: room_id || null })
    .eq('group_id', groupId)
    .eq('lead_id', lead_id)

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

  const { lead_id } = await req.json()
  if (!lead_id) return Response.json({ error: 'lead_id is required' }, { status: 400 })

  // Verify group belongs to landlord
  const { data: group } = await supabaseAdmin
    .from('roommate_groups')
    .select('id')
    .eq('id', groupId)
    .eq('landlord_id', landlordId)
    .single()

  if (!group) return Response.json({ error: 'Group not found' }, { status: 404 })

  const { error } = await supabaseAdmin
    .from('roommate_group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('lead_id', lead_id)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ success: true })
}
