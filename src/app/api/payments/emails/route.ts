/**
 * GET /api/payments/emails
 *
 * Every payment request this landlord has sent, across all their leases, newest
 * first — the portfolio-level answer to "what have I actually chased lately?".
 *
 * Scoped by plan ownership rather than by `sent_by`, so requests sent by an
 * automation (or, later, a co-manager) still show up for the person who owns
 * the property.
 */
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 100, 300)

  const { data: plans } = await supabaseAdmin
    .from('payment_plans')
    .select('id, name, property:properties ( name )')
    .eq('owner_id', user.id)

  const planIds = (plans ?? []).map(p => p.id)
  if (planIds.length === 0) return Response.json({ emails: [] })

  const { data, error } = await supabaseAdmin
    .from('payment_emails')
    .select('id, plan_id, recipient_email, recipient_name, subject, status, error, amount_total, created_at, items:payment_email_items ( label, due_date, amount, kind )')
    .in('plan_id', planIds)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('portfolio email log error:', error)
    return Response.json({ error: 'Could not load email history' }, { status: 500 })
  }

  // Attach a human label for the lease each request belongs to. Supabase types
  // an embedded one-to-one as an array, so unwrap either shape.
  type Named = { name: string | null } | { name: string | null }[] | null
  const propName = (p: Named): string | null =>
    Array.isArray(p) ? (p[0]?.name ?? null) : (p?.name ?? null)
  const nameFor = new Map(
    (plans ?? []).map(p => [p.id, propName(p.property as Named) ?? p.name ?? 'Lease'])
  )
  return Response.json({
    emails: (data ?? []).map(e => ({ ...e, plan_label: nameFor.get(e.plan_id) ?? 'Lease' })),
  })
}
