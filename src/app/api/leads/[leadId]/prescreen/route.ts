import { savePrescreen, getLeadById } from '@/lib/leads'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params
  const body = await req.json()

  const { lease_length, budget, roommate_preference, lifestyle, notes } = body

  const { error } = await savePrescreen(leadId, {
    lease_length,
    budget,
    roommate_preference,
    lifestyle,
    notes: notes || '',
  })

  if (error) {
    console.error('Prescreen save error:', error)
    return Response.json({ error: 'Failed to save prescreen' }, { status: 500 })
  }

  return Response.json({ success: true })
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params

  const lead = await getLeadById(leadId)

  if (!lead) {
    return Response.json({ error: 'Lead not found' }, { status: 404 })
  }

  return Response.json({
    first_name: lead.first_name,
    property: lead.property,
    status: lead.status,
  })
}
