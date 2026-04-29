import { createClient } from '@supabase/supabase-js'

// Service role — bypasses RLS to read email_logs
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// POST { leadIds: string[] }
// Returns { [leadId]: ISO timestamp } for any lead emailed in the last 24h
export async function POST(req: Request) {
  const { leadIds } = await req.json()

  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return Response.json({})
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('email_logs')
    .select('lead_id, sent_at')
    .in('lead_id', leadIds)
    .in('type', ['prescreen_reminder', 'prescreen_done_followup'])
    .gte('sent_at', cutoff)
    .order('sent_at', { ascending: false })

  if (error) {
    console.error('recent-contacts error:', error)
    return Response.json({})
  }

  // Take only the most recent timestamp per lead
  const map: Record<string, string> = {}
  for (const log of data || []) {
    if (!map[log.lead_id]) map[log.lead_id] = log.sent_at
  }

  return Response.json(map)
}
