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

// POST — approve a background check and convert the lead into a tenant
export async function POST(
  req: Request,
  { params }: { params: Promise<{ checkId: string }> }
) {
  const { checkId } = await params
  const landlordId = await getLandlordId(req)
  if (!landlordId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify this check belongs to the landlord
  const { data: check } = await supabaseAdmin
    .from('background_checks')
    .select('id, landlord_id, lead_id, tenant_id, decision')
    .eq('id', checkId)
    .eq('landlord_id', landlordId)
    .single()

  if (!check) return Response.json({ error: 'Not found' }, { status: 404 })

  // If already converted, return the existing tenant
  if (check.tenant_id) {
    return Response.json({ tenantId: check.tenant_id, already_exists: true })
  }

  const body = await req.json()
  const { first_name, last_name, email, phone, notes } = body

  if (!first_name || !email) {
    return Response.json({ error: 'first_name and email are required' }, { status: 400 })
  }

  // Create tenant
  const { data: tenant, error: tenantErr } = await supabaseAdmin
    .from('tenants')
    .insert({
      owner_id:   landlordId,
      first_name: first_name.trim(),
      last_name:  last_name?.trim() || null,
      email:      email.toLowerCase().trim(),
      phone:      phone?.trim() || null,
      notes:      notes?.trim() || null,
      status:     'active',
      lead_id:    check.lead_id,
    })
    .select('id')
    .single()

  if (tenantErr || !tenant) {
    console.error('Failed to create tenant:', tenantErr)
    return Response.json({ error: 'Failed to create tenant' }, { status: 500 })
  }

  // Update background check: mark as passed and link tenant
  await supabaseAdmin
    .from('background_checks')
    .update({
      decision:   'passed',
      tenant_id:  tenant.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', checkId)

  return Response.json({ tenantId: tenant.id })
}
