// The owner picker on the admin property forms.
//
// This used to collect the distinct `owner_id`s and then call
// `auth.admin.getUserById` once per owner, in a sequential `for` loop — so a
// platform with twenty landlords made twenty round trips to the Auth admin
// API, one after another, before the dropdown on /admin/properties/new could
// render. Every one of them was asking for a name and an email that
// `public.profiles` already holds.
//
// It is now two queries, neither of which grows a round trip per owner.

import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET() {
  // A list of every landlord's name and email is not public.
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json([], { status: 401 })

  const { data: caller } = await admin
    .from('profiles').select('role').eq('id', user.id).single()
  if (caller?.role !== 'admin') return Response.json([], { status: 403 })

  // Distinct owner_ids from properties (null = an unowned listing).
  const { data: rows, error } = await admin
    .from('properties')
    .select('owner_id')
    .not('owner_id', 'is', null)

  if (error || !rows) return Response.json([], { status: 200 })

  const unique = [...new Set(rows.map(r => r.owner_id as string))]
  if (!unique.length) return Response.json([])

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, email, full_name')
    .in('id', unique)

  // An owner whose profile row is missing is dropped, exactly as an owner
  // whose auth lookup came back without an email used to be.
  const owners = (profiles ?? [])
    .filter(p => p.email)
    .map(p => ({
      id: p.id as string,
      email: p.email as string,
      name: (p.full_name as string | null) || (p.email as string),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return Response.json(owners)
}
