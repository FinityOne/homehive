import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

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

export async function GET(req: Request) {
  const landlordId = await getLandlordId(req)
  if (!landlordId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Top-level list shows primary applicants only — co-signer checks (is_cosigner)
  // are nested under their applicant and surfaced via a count + the detail page.
  const { data, error } = await supabaseAdmin
    .from('background_checks')
    .select(`
      *,
      leads(id, first_name, last_name, email, phone, property, status),
      bg_check_references(*),
      bg_check_emails(ref_type, status, sent_at)
    `)
    .eq('landlord_id', landlordId)
    .eq('is_cosigner', false)
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: 'Failed to fetch' }, { status: 500 })

  // Attach co-signers to their parent applicant (explicit query — self-referential
  // PostgREST embeds are direction-ambiguous, so we group manually).
  const checks = data || []
  const { data: cosigners } = await supabaseAdmin
    .from('background_checks')
    .select('id, status, decision, cosigner_for_check_id')
    .eq('landlord_id', landlordId)
    .eq('is_cosigner', true)

  const byParent = new Map<string, { id: string; status: string; decision: string | null }[]>()
  for (const cs of cosigners || []) {
    if (!cs.cosigner_for_check_id) continue
    const arr = byParent.get(cs.cosigner_for_check_id) || []
    arr.push({ id: cs.id, status: cs.status, decision: cs.decision })
    byParent.set(cs.cosigner_for_check_id, arr)
  }
  for (const c of checks) c.cosigners = byParent.get(c.id) || []

  return Response.json({ checks })
}

export async function POST(req: Request) {
  const landlordId = await getLandlordId(req)
  if (!landlordId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { lead_id } = body
  if (!lead_id) return Response.json({ error: 'lead_id required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('background_checks')
    .insert({ lead_id, landlord_id: landlordId })
    .select()
    .single()

  if (error) return Response.json({ error: 'Failed to create' }, { status: 500 })
  return Response.json({ check: data })
}
