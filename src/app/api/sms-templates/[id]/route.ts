import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function getAuthedUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) return null
  return user
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const user = await getAuthedUser(req)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const updates: Record<string, string> = {}
  if (typeof body.name === 'string') updates.name = body.name.trim()
  if (typeof body.body === 'string') updates.body = body.body.trim()
  if (Object.keys(updates).length === 0) return Response.json({ error: 'Nothing to update' }, { status: 400 })

  updates.updated_at = new Date().toISOString()

  const { error } = await supabaseAdmin
    .from('sms_templates')
    .update(updates)
    .eq('id', id)
    .eq('landlord_id', user.id)

  if (error) return Response.json({ error: 'Failed to update template' }, { status: 500 })
  return Response.json({ success: true })
}
