import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET() {
  // Get distinct owner_ids from properties (excludes null = unowned listings)
  const { data: rows, error } = await supabase
    .from('properties')
    .select('owner_id')
    .not('owner_id', 'is', null)

  if (error || !rows) return Response.json([], { status: 200 })

  const unique = [...new Set(rows.map(r => r.owner_id as string))]

  const owners: { id: string; email: string; name: string }[] = []
  for (const id of unique) {
    try {
      const { data: { user } } = await supabase.auth.admin.getUserById(id)
      if (user?.email) {
        owners.push({
          id,
          email: user.email,
          name: user.user_metadata?.full_name || user.email,
        })
      }
    } catch (_) {}
  }

  return Response.json(owners)
}
