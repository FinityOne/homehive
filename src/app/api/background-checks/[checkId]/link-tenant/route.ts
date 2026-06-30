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

// POST — link an approved co-signer to the primary applicant's tenant record
// (i.e. record them as the guarantor for that tenant). The primary applicant
// must already have been converted to a tenant.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ checkId: string }> }
) {
  const { checkId } = await params
  const landlordId = await getLandlordId(req)
  if (!landlordId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: check } = await supabaseAdmin
    .from('background_checks')
    .select('id, is_cosigner, cosigner_for_check_id, tenant_id')
    .eq('id', checkId)
    .eq('landlord_id', landlordId)
    .single()

  if (!check) return Response.json({ error: 'Not found' }, { status: 404 })
  if (!check.is_cosigner || !check.cosigner_for_check_id) {
    return Response.json({ error: 'Not a co-signer check' }, { status: 400 })
  }
  if (check.tenant_id) {
    return Response.json({ tenantId: check.tenant_id, already_exists: true })
  }

  // The primary applicant must have a tenant to link to.
  const { data: primary } = await supabaseAdmin
    .from('background_checks')
    .select('tenant_id')
    .eq('id', check.cosigner_for_check_id)
    .eq('landlord_id', landlordId)
    .single()

  if (!primary?.tenant_id) {
    return Response.json(
      { error: 'The primary applicant has no tenant yet. Create their tenant profile first.' },
      { status: 400 },
    )
  }

  const { error } = await supabaseAdmin
    .from('background_checks')
    .update({
      tenant_id: primary.tenant_id,
      status: 'approved',
      decision: 'passed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', checkId)
    .eq('landlord_id', landlordId)

  if (error) return Response.json({ error: 'Failed to link co-signer' }, { status: 500 })
  return Response.json({ tenantId: primary.tenant_id })
}
