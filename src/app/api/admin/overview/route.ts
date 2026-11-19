// The admin overview's four charts, as six kilobytes of finished series.
//
// The page used to build these in the browser from two downloads: every lead
// row, and every property through `getAllPropertiesForAdmin()` — `select *`
// plus five joined child tables — of which it read three columns. This route
// asks for those three columns, and `buildOverviewData` turns them into the
// series the charts consume. The arithmetic itself is unchanged and lives in
// src/lib/adminOverview.ts.

import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  buildOverviewData,
  type OverviewLeadRow,
  type OverviewPropertyRow,
} from '@/lib/adminOverview'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await admin
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin')
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  const [leadsRes, propsRes] = await Promise.all([
    // No `order` on either: both results are aggregated into counts and day
    // buckets, so sorting them was work the database did and nobody read.
    admin.from('leads').select('created_at, status, closed_reason'),
    admin.from('properties').select('created_at, admin_status, is_test'),
  ])

  if (leadsRes.error || propsRes.error)
    return Response.json(
      { error: leadsRes.error?.message ?? propsRes.error?.message },
      { status: 500 },
    )

  return Response.json(
    buildOverviewData(
      (leadsRes.data ?? []) as OverviewLeadRow[],
      (propsRes.data ?? []) as OverviewPropertyRow[],
    ),
  )
}
