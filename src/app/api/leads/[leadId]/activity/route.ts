import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params

  const [prescreenRes, emailsRes] = await Promise.all([
    supabase.from('pre_screens').select('*').eq('lead_id', leadId).single(),
    supabase.from('email_logs').select('*').eq('lead_id', leadId).order('sent_at', { ascending: false }),
  ])

  return Response.json({
    prescreen: prescreenRes.data || null,
    emails: emailsRes.data || [],
  })
}
