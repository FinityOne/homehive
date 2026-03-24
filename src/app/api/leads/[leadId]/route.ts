import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params
  const body = await req.json()

  const allowed = ['first_name', 'last_name', 'email', 'phone', 'move_in_date', 'property']
  const updates: Record<string, string | null> = {}

  for (const key of allowed) {
    if (key in body) {
      updates[key] = body[key] === '' ? null : body[key]
    }
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { error } = await supabase
    .from('leads')
    .update(updates)
    .eq('id', leadId)

  if (error) {
    console.error('Lead update error:', error)
    return Response.json({ error: 'Failed to update lead' }, { status: 500 })
  }

  return Response.json({ success: true })
}
