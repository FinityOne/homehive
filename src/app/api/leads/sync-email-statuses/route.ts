import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Status to advance to when a reminder email was sent from Insights
function insightNextStatus(current: string): string | null {
  const map: Record<string, string> = {
    new:       'contacted',
    contacted: 'follow_up',
    follow_up: 'cold',
    engaged:   'follow_up',
    cold:      'follow_up',
  }
  return map[current] ?? null
}

// POST { leadIds: string[] }
// For each lead that has a reminder email in email_logs but whose status hasn't
// been advanced, advance it now. Idempotent — safe to call on every page load.
export async function POST(req: Request) {
  const { leadIds } = await req.json()

  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return Response.json({ updated: 0 })
  }

  // Fetch current lead statuses for the supplied IDs
  const { data: leads, error: leadsErr } = await supabase
    .from('leads')
    .select('id, status')
    .in('id', leadIds)
    .in('status', ['new', 'contacted', 'follow_up', 'engaged', 'cold'])

  if (leadsErr || !leads?.length) {
    return Response.json({ updated: 0 })
  }

  // Find which of these leads have ever received a reminder email
  const { data: emailLogs, error: logErr } = await supabase
    .from('email_logs')
    .select('lead_id')
    .in('lead_id', leads.map(l => l.id))
    .in('type', ['prescreen_reminder', 'prescreen_done_followup'])

  if (logErr || !emailLogs?.length) {
    return Response.json({ updated: 0 })
  }

  const emailedIds = new Set(emailLogs.map(e => e.lead_id))

  // Build and run batched updates
  const toUpdate: { id: string; status: string }[] = []
  for (const lead of leads) {
    if (!emailedIds.has(lead.id)) continue
    const nextStatus = insightNextStatus(lead.status)
    if (!nextStatus) continue
    toUpdate.push({ id: lead.id, status: nextStatus })
  }

  for (const item of toUpdate) {
    await supabase.from('leads').update({ status: item.status }).eq('id', item.id)
  }

  return Response.json({ updated: toUpdate.length })
}
