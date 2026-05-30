import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .gte('created_at', since)

  if (error) return Response.json({ tenant: 0, landlord: 0, admin: 0 })

  const counts = { tenant: 0, landlord: 0, admin: 0 } as Record<string, number>
  for (const row of data ?? []) {
    const r = row.role as string
    if (r in counts) counts[r]++
  }

  return Response.json(counts)
}
