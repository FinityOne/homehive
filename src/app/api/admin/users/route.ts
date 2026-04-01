import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET() {
  const [profilesRes, plansRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, email, full_name, phone, role, company_name, verified, onboarded, created_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('landlord_plans')
      .select('landlord_id, plan_type, status, current_period_end'),
  ])

  if (profilesRes.error) return Response.json({ error: profilesRes.error.message }, { status: 500 })

  const plans: Record<string, { plan_type: string; status: string; current_period_end: string | null }> = {}
  for (const p of (plansRes.data ?? [])) {
    plans[p.landlord_id] = { plan_type: p.plan_type, status: p.status, current_period_end: p.current_period_end }
  }

  return Response.json({ profiles: profilesRes.data ?? [], plans })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, ...fields } = body
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })

  const allowed = ['full_name', 'phone', 'role', 'company_name', 'verified']
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in fields) update[key] = fields[key]
  }

  const { error } = await supabase.from('profiles').update(update).eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
