import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function getLandlordId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization')
  if (!auth) return null
  const { data: { user } } = await supabaseAdmin.auth.getUser(auth.replace('Bearer ', ''))
  return user?.id ?? null
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params
  const landlordId = await getLandlordId(req)
  if (!landlordId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify ownership
  const { data: group } = await supabaseAdmin
    .from('roommate_groups')
    .select('id')
    .eq('id', groupId)
    .eq('landlord_id', landlordId)
    .single()
  if (!group) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { data: logs } = await supabaseAdmin
    .from('group_email_logs')
    .select('id, email_type, recipient_email, recipient_name, room_name, sent_at')
    .eq('group_id', groupId)
    .order('sent_at', { ascending: false })

  return Response.json({ logs: logs ?? [] })
}
