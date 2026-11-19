// The admin user directory: one page at a time.
//
// This route used to return every profile on the platform in one array, and
// the page that called it then also downloaded every lead and every property
// (through the admin property select, which pulls `select *` plus five child
// tables) to work out how many each landlord had. Drawing twenty-five rows
// cost three full-table transfers and a join in the browser.
//
// Now the join, the score, the search and the sort all happen in Postgres —
// see `admin_user_directory` in
// supabase/migrations/20261119000000_admin_user_directory.sql — and this route
// asks for exactly the page being looked at. A page view is:
//
//   1. the page of rows (with an exact total, for the pager)
//   2. one scalar row of header figures and tab counts
//   3. the property names for the ≤25 owners on this page, for the expanders
//
// Three bounded round trips, none of which grows when the platform does.

import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { NextRequest } from 'next/server'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/**
 * Every handler here reads or writes the whole user table with contact
 * details attached, over a service-role client that ignores RLS. The gate is
 * therefore the *only* thing standing in front of it — and until now there
 * wasn't one: an unauthenticated GET returned every profile on the platform,
 * and an unauthenticated PATCH could make anyone an admin.
 */
async function requireAdmin(): Promise<{ ok: true } | { ok: false; res: Response }> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, res: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await admin
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin')
    return { ok: false, res: Response.json({ error: 'Forbidden' }, { status: 403 }) }

  return { ok: true }
}

/**
 * A row of the `admin_user_directory` view. Spelled out here because the
 * generated database types only cover tables, so without it PostgREST hands
 * back an untyped row.
 */
type DirectoryRow = {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  role: string
  company_name: string | null
  verified: boolean
  onboarded: boolean
  created_at: string
  plan_type: string | null
  plan_status: string | null
  plan_period_end: string | null
  property_count: number
  active_property_count: number
  total_leads: number
  latest_activity_at: string
  score: number
  properties: Array<{ name: string; slug: string; admin_status: string }>
}

const MAX_PAGE_SIZE = 100

/**
 * Makes a user's search box safe to drop into a LIKE pattern.
 *
 * `%` and `_` are LIKE wildcards, so searching for "50%" would otherwise match
 * everything; `,` and the bracket characters are PostgREST filter syntax, where
 * an unescaped one truncates the filter rather than failing it. Escaped, not
 * stripped, so a literal underscore in an email still matches itself.
 */
function likeLiteral(q: string): string {
  return q.replace(/[\\%_]/g, c => `\\${c}`).replace(/[,()]/g, ' ')
}

/** Sorts the database can actually do, so no sort forces a full download. */
const SORTS: Record<string, { column: string; ascending: boolean }> = {
  score:      { column: 'score',           ascending: false },
  newest:     { column: 'created_at',      ascending: false },
  oldest:     { column: 'created_at',      ascending: true  },
  name:       { column: 'full_name',       ascending: true  },
  properties: { column: 'property_count',  ascending: false },
  leads:      { column: 'total_leads',     ascending: false },
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const sp = req.nextUrl.searchParams
  const role = sp.get('role') ?? 'all'
  const q = (sp.get('q') ?? '').trim()
  const sortKey = sp.get('sort') ?? 'score'
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(sp.get('pageSize')) || 25))

  const sort = SORTS[sortKey] ?? SORTS.score
  // The same pattern goes to the rows and to the header figures, so the tiles
  // always count exactly the rows underneath them.
  const pattern = q ? likeLiteral(q) : null

  let query = admin
    .from('admin_user_directory')
    .select(
      'id, email, full_name, phone, role, company_name, verified, onboarded, created_at,' +
      'plan_type, plan_status, plan_period_end,' +
      'property_count, active_property_count, total_leads, latest_activity_at, score,' +
      // The owner's listings, aggregated into JSON by the view. This was a
      // second round trip — and so a second *wave*, since it could only start
      // once the page's owner ids were known. At today's size that wave cost
      // more than the whole old query did, which is the reminder that round
      // trips, not rows, are what this portal was slow on.
      'properties',
      { count: 'exact' }
    )

  if (role !== 'all') query = query.eq('role', role)
  // Matched against the view's prebuilt haystack (name, email, phone, company
  // and the owner's property names), which is what the browser used to filter
  // in memory over every row it had downloaded.
  if (pattern) query = query.ilike('search_text', `%${pattern}%`)

  const from = (page - 1) * pageSize

  const [rowsRes, statsRes] = await Promise.all([
    query
      // `id` is the tiebreaker so a page boundary can't show the same row
      // twice (or skip one) when many rows share a score.
      .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1),
    admin.rpc('admin_user_directory_stats', { p_role: role, p_q: pattern }).maybeSingle(),
  ])

  if (rowsRes.error)
    return Response.json({ error: rowsRes.error.message }, { status: 500 })

  const rows = (rowsRes.data ?? []) as unknown as DirectoryRow[]

  const s = statsRes.data as Record<string, number> | null

  return Response.json({
    users: rows,
    page,
    pageSize,
    total: rowsRes.count ?? 0,
    // Figures over the whole filtered set, not the page — the reason the old
    // version thought it needed every row.
    stats: {
      total: s?.total ?? 0,
      paidPlans: s?.paid_plans ?? 0,
      withListings: s?.with_listings ?? 0,
      activeUsers: s?.active_users ?? 0,
      avgScore: s?.avg_score ?? 0,
    },
    roleCounts: {
      tenant: s?.tenant_count ?? 0,
      landlord: s?.landlord_count ?? 0,
      admin: s?.admin_count ?? 0,
    },
  })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const body = await req.json()
  const { id, ...fields } = body
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })

  const allowed = ['full_name', 'phone', 'role', 'company_name', 'verified']
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in fields) update[key] = fields[key]
  }

  const { error } = await admin.from('profiles').update(update).eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
