import { updateLeadStatus } from '@/lib/leads'
import type { Lead } from '@/lib/leads'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params
  const body = await req.json()

  const status: Lead['status'] = body.status
  const closedReason: 'leased' | 'lost' | undefined = body.closed_reason

  if (!status) {
    return Response.json({ error: 'status is required' }, { status: 400 })
  }

  const { error } = await updateLeadStatus(leadId, status, closedReason)

  if (error) {
    console.error('Status update error:', error)
    return Response.json({ error: 'Failed to update status' }, { status: 500 })
  }

  return Response.json({ success: true })
}
