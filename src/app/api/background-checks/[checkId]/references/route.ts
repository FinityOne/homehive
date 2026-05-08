import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function getLandlordId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return null
  const token = authHeader.replace('Bearer ', '')
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  return user?.id ?? null
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ checkId: string }> }
) {
  const { checkId } = await params
  const landlordId = await getLandlordId(req)
  if (!landlordId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify ownership
  const { data: check } = await supabaseAdmin
    .from('background_checks').select('id').eq('id', checkId).eq('landlord_id', landlordId).single()
  if (!check) return Response.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const { type, name, phone, email, address, contact_date, status, notes, income_monthly } = body
  if (!type) return Response.json({ error: 'type required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('bg_check_references')
    .insert({ bg_check_id: checkId, type, name, phone, email, address, contact_date: contact_date || null, status: status || 'pending', notes, income_monthly: income_monthly || null })
    .select()
    .single()

  if (error) return Response.json({ error: 'Failed to create reference' }, { status: 500 })
  return Response.json({ reference: data })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ checkId: string }> }
) {
  const { checkId } = await params
  const landlordId = await getLandlordId(req)
  if (!landlordId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: check } = await supabaseAdmin
    .from('background_checks').select('id').eq('id', checkId).eq('landlord_id', landlordId).single()
  if (!check) return Response.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const { refId, ...updates } = body
  if (!refId) return Response.json({ error: 'refId required' }, { status: 400 })

  const allowed = ['name','phone','email','address','contact_date','status','notes','income_monthly']
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in updates) patch[key] = updates[key]
  }

  const { data, error } = await supabaseAdmin
    .from('bg_check_references')
    .update(patch)
    .eq('id', refId)
    .eq('bg_check_id', checkId)
    .select()
    .single()

  if (error) return Response.json({ error: 'Failed to update' }, { status: 500 })
  return Response.json({ reference: data })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ checkId: string }> }
) {
  const { checkId } = await params
  const landlordId = await getLandlordId(req)
  if (!landlordId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: check } = await supabaseAdmin
    .from('background_checks').select('id').eq('id', checkId).eq('landlord_id', landlordId).single()
  if (!check) return Response.json({ error: 'Not found' }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const refId = searchParams.get('refId')
  if (!refId) return Response.json({ error: 'refId required' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('bg_check_references').delete().eq('id', refId).eq('bg_check_id', checkId)

  if (error) return Response.json({ error: 'Failed to delete' }, { status: 500 })
  return Response.json({ success: true })
}
