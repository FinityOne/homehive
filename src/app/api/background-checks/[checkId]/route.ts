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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ checkId: string }> }
) {
  const { checkId } = await params
  const landlordId = await getLandlordId(req)
  if (!landlordId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('background_checks')
    .select(`*, leads(*), bg_check_references(*), bg_check_emails(*)`)
    .eq('id', checkId)
    .eq('landlord_id', landlordId)
    .single()

  if (error || !data) return Response.json({ error: 'Not found' }, { status: 404 })

  // The lead's `property` is a listing slug — resolve the real street address
  // for use in landlord-facing emails (e.g. conditional-approval template).
  let property_address: string | null = null
  const propRef = (data.leads as { property?: string | null } | null)?.property
  if (propRef) {
    const { data: prop } = await supabaseAdmin
      .from('properties')
      .select('address')
      .eq('slug', propRef)
      .maybeSingle()
    property_address = prop?.address
      ?? (await supabaseAdmin.from('properties').select('address').eq('name', propRef).maybeSingle()).data?.address
      ?? null
  }

  return Response.json({ check: { ...data, property_address } })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ checkId: string }> }
) {
  const { checkId } = await params
  const landlordId = await getLandlordId(req)
  if (!landlordId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const allowed = [
    'is_student','cosigner','credit','credit_score',
    'employment_check','current_residence_check',
    'criminal_check','eviction_check','notes','decision','status',
  ]
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  // Validate status and keep the legacy `decision` field in sync so the
  // list/score views and the convert flow stay consistent.
  if ('status' in updates) {
    const VALID = ['initiated','pending_verification','conditionally_approved','approved','declined']
    if (!VALID.includes(updates.status as string)) {
      return Response.json({ error: 'Invalid status' }, { status: 400 })
    }
    if (!('decision' in body)) {
      updates.decision =
        updates.status === 'approved' ? 'passed' :
        updates.status === 'declined' ? 'failed' :
        null
    }
  }

  const { data, error } = await supabaseAdmin
    .from('background_checks')
    .update(updates)
    .eq('id', checkId)
    .eq('landlord_id', landlordId)
    .select()
    .single()

  if (error) return Response.json({ error: 'Failed to update' }, { status: 500 })
  return Response.json({ check: data })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ checkId: string }> }
) {
  const { checkId } = await params
  const landlordId = await getLandlordId(req)
  if (!landlordId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabaseAdmin
    .from('background_checks')
    .delete()
    .eq('id', checkId)
    .eq('landlord_id', landlordId)

  if (error) return Response.json({ error: 'Failed to delete' }, { status: 500 })
  return Response.json({ success: true })
}
