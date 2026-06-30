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

// Resolve a listing's street address + monthly rent from its slug (or name).
// The lead's `property` field stores the listing slug.
async function resolveProperty(propRef: string | null | undefined): Promise<{ address: string | null; rent: number | null }> {
  if (!propRef) return { address: null, rent: null }
  const bySlug = await supabaseAdmin.from('properties').select('address, price').eq('slug', propRef).maybeSingle()
  if (bySlug.data) return { address: bySlug.data.address ?? null, rent: bySlug.data.price ?? null }
  const byName = await supabaseAdmin.from('properties').select('address, price').eq('name', propRef).maybeSingle()
  return { address: byName.data?.address ?? null, rent: byName.data?.price ?? null }
}

// Columns of the slim co-signer summary the primary's detail page renders.
const COSIGNER_SUMMARY_COLS =
  'id, subject_first_name, subject_last_name, subject_email, subject_phone, ' +
  'cosigner_relationship, status, decision, tenant_id, credit, credit_score, ' +
  'criminal_check, eviction_check, employment_check, current_residence_check, ' +
  'income_monthly, welcome_email_sent_at, created_at'

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

  // Attach this applicant's co-signers (explicit query — avoids the direction
  // ambiguity of a self-referential PostgREST embed).
  if (!data.is_cosigner) {
    const { data: kids } = await supabaseAdmin
      .from('background_checks')
      .select(COSIGNER_SUMMARY_COLS)
      .eq('cosigner_for_check_id', checkId)
      .eq('landlord_id', landlordId)
      .order('created_at', { ascending: true })
    data.cosigners = kids || []
  } else {
    data.cosigners = []
  }

  let property_address: string | null = null
  let property_rent: number | null = null
  let cosigner_context: {
    primary_check_id: string
    primary_lead_id: string | null
    primary_name: string
    primary_tenant_id: string | null
    relationship: string | null
  } | null = null

  if (data.is_cosigner && data.cosigner_for_check_id) {
    // Co-signer: identity lives on the row; the home + linked applicant come from
    // the PRIMARY applicant's check. Synthesize a `leads`-shaped object so the
    // shared detail UI renders the co-signer as the subject.
    const { data: primary } = await supabaseAdmin
      .from('background_checks')
      .select('id, lead_id, tenant_id, leads(first_name, last_name, email, property)')
      .eq('id', data.cosigner_for_check_id)
      .eq('landlord_id', landlordId)
      .single()

    const rawLead = (primary?.leads as unknown)
    const pLead = (Array.isArray(rawLead) ? rawLead[0] : rawLead) as
      { first_name: string | null; last_name: string | null; email: string | null; property: string | null } | null

    const resolved = await resolveProperty(pLead?.property)
    property_address = resolved.address
    property_rent = resolved.rent

    cosigner_context = {
      primary_check_id: data.cosigner_for_check_id,
      primary_lead_id: primary?.lead_id ?? null,
      primary_name: pLead?.first_name && pLead?.last_name
        ? `${pLead.first_name} ${pLead.last_name}`
        : pLead?.first_name || pLead?.email || 'the applicant',
      primary_tenant_id: primary?.tenant_id ?? null,
      relationship: data.cosigner_relationship ?? null,
    }

    data.leads = {
      id: null,
      first_name: data.subject_first_name,
      last_name: data.subject_last_name,
      email: data.subject_email,
      phone: data.subject_phone,
      property: pLead?.property ?? null,
      status: null,
      move_in_date: null,
      created_at: data.created_at,
    }
  } else {
    const propRef = (data.leads as { property?: string | null } | null)?.property
    const resolved = await resolveProperty(propRef)
    property_address = resolved.address
    property_rent = resolved.rent
  }

  return Response.json({ check: { ...data, property_address, property_rent, cosigner_context } })
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
    // co-signer + income fields
    'income_monthly','cosigner_relationship',
    'subject_first_name','subject_last_name','subject_email','subject_phone',
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
