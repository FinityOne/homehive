import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// GET — fetch recent notifications for the authenticated landlord
export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select('*')
    .eq('landlord_id', user.id)
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ notifications: data || [] })
}

// PATCH — mark notifications as read
export async function PATCH(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  // If ids provided, mark those; otherwise mark all
  const ids: string[] | undefined = body.ids

  let query = supabaseAdmin
    .from('notifications')
    .update({ is_read: true })
    .eq('landlord_id', user.id)

  if (ids && ids.length > 0) query = query.in('id', ids)

  const { error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
