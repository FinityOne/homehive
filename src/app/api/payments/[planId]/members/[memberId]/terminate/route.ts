import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getUser(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// POST — terminate a tenant early and void all future pending payments
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string; memberId: string }> }
) {
  const { planId, memberId } = await params
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify plan ownership
  const { data: plan } = await supabaseAdmin
    .from('payment_plans')
    .select('id, owner_id')
    .eq('id', planId)
    .single()

  if (!plan || plan.owner_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json()
  const { termination_date, termination_reason } = body

  if (!termination_date) {
    return NextResponse.json({ error: 'termination_date is required' }, { status: 400 })
  }

  // Update tenant record
  const { error: updateErr } = await supabaseAdmin
    .from('payment_plan_tenants')
    .update({
      status: 'terminated',
      termination_date,
      termination_reason: termination_reason || null,
      end_date: termination_date,
    })
    .eq('id', memberId)
    .eq('plan_id', planId)

  if (updateErr) {
    return NextResponse.json({ error: 'Failed to update tenant' }, { status: 500 })
  }

  // Void all future pending/late payments after termination_date
  const { data: toVoid, error: fetchErr } = await supabaseAdmin
    .from('scheduled_payments')
    .select('id')
    .eq('plan_tenant_id', memberId)
    .eq('plan_id', planId)
    .in('status', ['pending', 'late'])
    .gt('due_date', termination_date)

  if (fetchErr) {
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 })
  }

  const ids = (toVoid || []).map((p: { id: string }) => p.id)
  let voided = 0

  if (ids.length > 0) {
    const { error: voidErr } = await supabaseAdmin
      .from('scheduled_payments')
      .update({
        status: 'voided',
        void_reason: termination_reason ? `Early termination: ${termination_reason}` : 'Early termination',
      })
      .in('id', ids)

    if (voidErr) {
      return NextResponse.json({ error: 'Failed to void payments' }, { status: 500 })
    }
    voided = ids.length
  }

  return NextResponse.json({ voided })
}
