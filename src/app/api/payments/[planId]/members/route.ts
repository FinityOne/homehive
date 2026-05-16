import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { generateScheduleDates, computeProration } from '@/lib/payments'

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

// POST — add a sub-tenant to an existing plan with optional date range and schedule generation
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const { planId } = await params
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify plan ownership
  const { data: plan } = await supabaseAdmin
    .from('payment_plans')
    .select('id, owner_id, due_day, lease:leases(start_date, end_date)')
    .eq('id', planId)
    .single()

  if (!plan || plan.owner_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json()
  const {
    name,
    email,
    monthly_total,
    line_items = [],
    start_date,
    end_date,
    generate_schedule,
    include_proration,
  } = body

  if (!name || !monthly_total) {
    return NextResponse.json({ error: 'name and monthly_total are required' }, { status: 400 })
  }

  // Insert tenant
  const { data: tenant, error: tenantErr } = await supabaseAdmin
    .from('payment_plan_tenants')
    .insert({
      plan_id: planId,
      name,
      email: email || null,
      monthly_total,
      start_date: start_date || null,
      end_date: end_date || null,
      status: 'active',
    })
    .select('id')
    .single()

  if (tenantErr || !tenant) {
    return NextResponse.json({ error: 'Failed to create tenant' }, { status: 500 })
  }

  // Insert line items
  if (line_items.length > 0) {
    await supabaseAdmin.from('payment_line_items').insert(
      line_items.map((li: { category: string; label: string; amount: number }) => ({
        plan_tenant_id: tenant.id,
        category: li.category,
        label: li.label,
        amount: li.amount,
      }))
    )
  }

  // Generate payment schedule if requested
  if (generate_schedule) {
    const lease = Array.isArray(plan.lease) ? plan.lease[0] : plan.lease
    const effectiveStart = start_date || lease?.start_date
    const effectiveEnd   = end_date   || lease?.end_date

    if (effectiveStart && effectiveEnd) {
      const dueDay = plan.due_day
      const dates  = generateScheduleDates(effectiveStart, effectiveEnd, dueDay)

      const payments: { plan_id: string; plan_tenant_id: string; due_date: string; amount: number; status: string }[] = []

      if (include_proration && dates.length > 0) {
        const proration = computeProration(monthly_total, effectiveStart, dueDay)
        // First entry is prorated
        payments.push({
          plan_id:       planId,
          plan_tenant_id: tenant.id,
          due_date:      dates[0],
          amount:        proration.proratedAmount,
          status:        'pending',
        })
        // Rest are full amount
        for (let i = 1; i < dates.length; i++) {
          payments.push({
            plan_id:       planId,
            plan_tenant_id: tenant.id,
            due_date:      dates[i],
            amount:        monthly_total,
            status:        'pending',
          })
        }
      } else {
        for (const due_date of dates) {
          payments.push({
            plan_id:       planId,
            plan_tenant_id: tenant.id,
            due_date,
            amount:        monthly_total,
            status:        'pending',
          })
        }
      }

      if (payments.length > 0) {
        const { error: schedErr } = await supabaseAdmin
          .from('scheduled_payments')
          .insert(payments)
        if (schedErr) {
          return NextResponse.json({ error: 'Failed to create schedule' }, { status: 500 })
        }
      }

      return NextResponse.json({ tenantId: tenant.id, payments_created: payments.length })
    }
  }

  return NextResponse.json({ tenantId: tenant.id, payments_created: 0 })
}
