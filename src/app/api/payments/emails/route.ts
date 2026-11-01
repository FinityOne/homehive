/**
 * GET /api/payments/emails
 *
 * Every money email this landlord's leases have produced, newest first — the
 * feed behind `/landlord/reminders`.
 *
 * Scoped by plan ownership rather than by `sent_by`, which is the only reading
 * that works: the automatic reminders have no sender at all, and a request sent
 * by a co-manager still belongs to the person who owns the property.
 *
 * Query parameters, all optional:
 *   audience  tenant | landlord | admin | all   (default: tenant — this is a
 *             log of what reached *tenants*, and the landlord's own copies of
 *             receipts would otherwise pad it with mail they wrote themselves)
 *   state     all | delivered | opened | problem | pending
 *   kind      a kind prefix, e.g. `rent_request`, `late_fee_request`, `receipt`
 *   plan      one payment plan id
 *   q         substring of recipient name or email
 *   limit     up to 400, default 150
 *
 * Counts come back alongside the rows, computed over everything the audience,
 * kind and search filters matched — so the state tabs can show their own sizes
 * without a request each, while `emails` carries only the selected state.
 */
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { outcomeOf, matchesState, isProblem, type EmailState } from '@/lib/paymentEmails'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

const COLUMNS =
  'id, plan_id, plan_tenant_id, recipient_email, recipient_name, subject, kind, audience, ' +
  'trigger, status, error, custom_message, amount_total, created_at, ' +
  'delivered_at, opened_at, clicked_at, bounced_at, complained_at, delivery_detail, ' +
  'items:payment_email_items ( id, scheduled_payment_id, special_payment_id, label, due_date, amount, kind )'

type Row = {
  id: string
  plan_id: string
  status: 'sent' | 'failed'
  audience: string
  kind: string
  recipient_email: string
  recipient_name: string | null
  delivered_at: string | null
  opened_at: string | null
  bounced_at: string | null
  complained_at: string | null
}

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams
  const limit = Math.min(Number(q.get('limit')) || 150, 400)
  const audience = q.get('audience') ?? 'tenant'
  const state = (q.get('state') ?? 'all') as EmailState
  const kind = q.get('kind')
  const planFilter = q.get('plan')
  const search = (q.get('q') ?? '').trim().toLowerCase()

  const { data: plans } = await supabaseAdmin
    .from('payment_plans')
    .select('id, name, property:properties ( name )')
    .eq('owner_id', user.id)

  const owned = (plans ?? []).map(p => p.id)
  if (owned.length === 0) {
    return Response.json({ emails: [], counts: { all: 0, delivered: 0, opened: 0, problem: 0, pending: 0 }, leases: [] })
  }
  // A plan filter is still intersected with ownership: a planId in the query
  // string is a request, not an authorisation.
  const planIds = planFilter && owned.includes(planFilter) ? [planFilter] : owned

  let query = supabaseAdmin
    .from('payment_emails')
    .select(COLUMNS)
    .in('plan_id', planIds)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (audience !== 'all') query = query.eq('audience', audience)
  if (kind) query = query.like('kind', `${kind}%`)
  if (search) query = query.or(`recipient_email.ilike.%${search}%,recipient_name.ilike.%${search}%`)

  // Filtering on outcome is a filter on several columns at once, and the
  // precedence between them (a bounce beats a delivery) is logic, not SQL. So
  // the state filter is applied after the fetch, over the same `outcomeOf` the
  // page renders — one definition, no chance of the tab and the badge
  // disagreeing.
  const { data, error } = await query
  if (error) {
    console.error('portfolio email log error:', error)
    return Response.json({ error: 'Could not load email history' }, { status: 500 })
  }

  type Named = { name: string | null } | { name: string | null }[] | null
  const propName = (p: Named): string | null =>
    Array.isArray(p) ? (p[0]?.name ?? null) : (p?.name ?? null)
  const nameFor = new Map(
    (plans ?? []).map(p => [p.id, propName(p.property as Named) ?? p.name ?? 'Lease'])
  )

  const rows = (data ?? []) as unknown as Row[]
  const withOutcome = rows.map(e => ({
    ...e,
    plan_label: nameFor.get(e.plan_id) ?? 'Lease',
    outcome: outcomeOf(e),
  }))

  const counts = {
    all: withOutcome.length,
    delivered: withOutcome.filter(e => e.outcome === 'delivered' || e.outcome === 'opened').length,
    opened: withOutcome.filter(e => e.outcome === 'opened').length,
    problem: withOutcome.filter(e => isProblem(e.outcome)).length,
    pending: withOutcome.filter(e => e.outcome === 'pending').length,
  }

  return Response.json({
    emails: withOutcome.filter(e => matchesState(e.outcome, state)),
    counts,
    // The property picker is built from the leases that actually have history,
    // so it can never offer a filter that returns nothing.
    leases: [...new Set(withOutcome.map(e => e.plan_id))]
      .map(id => ({ id, label: nameFor.get(id) ?? 'Lease' }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  })
}
