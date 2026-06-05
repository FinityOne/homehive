import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getRecentVisits, groupVisitors } from '@/lib/visits'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(req: Request) {
  // site_visits holds visitor IPs + emails (PII), so this endpoint is admin-only.
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const limit = Number(new URL(req.url).searchParams.get('limit') || 1500)
  const visits = await getRecentVisits(limit)
  const visitors = groupVisitors(visits)

  const stats = {
    totalHits: visits.length,
    uniqueVisitors: visitors.length,
    identified: visitors.filter(v => v.email).length,
    last24h: visits.filter(v => Date.now() - new Date(v.created_at).getTime() < 86400000).length,
  }

  return Response.json({ visitors, stats })
}
