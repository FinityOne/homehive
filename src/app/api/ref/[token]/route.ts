import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const { data: ref } = await supabaseAdmin
    .from('bg_check_references')
    .select('id, type, name, address, status, responses, bg_check_id')
    .eq('public_token', token)
    .single()

  if (!ref) return Response.json({ error: 'Not found' }, { status: 404 })

  // Fetch the lead name via the bg_check
  const { data: bgCheck } = await supabaseAdmin
    .from('background_checks')
    .select('leads(first_name, last_name)')
    .eq('id', ref.bg_check_id)
    .single()

  const lead = (Array.isArray(bgCheck?.leads) ? bgCheck?.leads[0] : bgCheck?.leads) as { first_name: string | null; last_name: string | null } | null
  const leadName = lead?.first_name && lead?.last_name
    ? `${lead.first_name} ${lead.last_name}`
    : lead?.first_name || 'the applicant'

  return Response.json({
    ref: {
      id: ref.id,
      type: ref.type,
      name: ref.name,
      address: ref.address,
      status: ref.status,
      responses: ref.responses,
    },
    leadName,
  })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const { data: ref } = await supabaseAdmin
    .from('bg_check_references')
    .select('id, status')
    .eq('public_token', token)
    .single()

  if (!ref) return Response.json({ error: 'Not found' }, { status: 404 })

  const { responses } = await req.json()
  if (!responses || !Array.isArray(responses)) {
    return Response.json({ error: 'responses array required' }, { status: 400 })
  }
  // Sanitise — only keep known fields
  const clean = responses.map((r: { question?: string; answer?: string; detail?: string }) => ({
    question: String(r.question || ''),
    answer: String(r.answer || ''),
    ...(r.detail ? { detail: String(r.detail) } : {}),
  }))

  await supabaseAdmin
    .from('bg_check_references')
    .update({ responses: clean, status: 'verified', contact_date: new Date().toISOString().split('T')[0] })
    .eq('id', ref.id)

  return Response.json({ success: true })
}
