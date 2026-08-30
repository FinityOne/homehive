/**
 * POST /api/tenant/pay
 *
 * Creates a Stripe PaymentIntent for rent the signed-in tenant owes.
 *
 * The client sends only which rows it wants to pay and by which method. Every
 * amount is recomputed here from the database — a client that asks to pay $1
 * against a $795 charge gets billed $795, and the surcharge is applied server
 * side so it can't be edited away in the browser.
 */
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { computeFee, amountDue, MIN_CHARGE_CENTS, type PayMethod } from '@/lib/rentPayments'
import { stripeSecretKey, stripeMode } from '@/lib/stripeEnv'

function getStripe() { return new Stripe(stripeSecretKey()) }

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

export async function POST(req: NextRequest) {
  // Resolve the key up front so a misconfigured environment fails as a clear
  // 503 rather than an opaque Stripe auth error mid-flow.
  try {
    stripeSecretKey()
  } catch (e) {
    console.error('[tenant/pay] stripe config', e)
    return Response.json(
      { error: 'Online payments aren\'t switched on yet. Ask your landlord to finish Stripe setup.' },
      { status: 503 }
    )
  }

  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const method: PayMethod = body.method === 'ach' ? 'ach' : 'card'
  const scheduledIds: string[] = Array.isArray(body.scheduledIds) ? body.scheduledIds.slice(0, 12) : []
  const specialIds: string[] = Array.isArray(body.specialIds) ? body.specialIds.slice(0, 12) : []

  if (scheduledIds.length === 0 && specialIds.length === 0) {
    return Response.json({ error: 'Nothing selected to pay.' }, { status: 400 })
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('email, full_name').eq('id', user.id).maybeSingle()
  const email = norm(profile?.email || user.email)
  if (!email) return Response.json({ error: 'No email on your account.' }, { status: 400 })

  // Establish which payer rows are this tenant's, by email then by lease name.
  // Match on the tenant's email first; a lease may also name them without an
  // email on the payer row, so their names on this lease are the fallback.
  // Both queries are filtered in Postgres — scanning the whole table would
  // silently stop matching once it passed Supabase's 1000-row response cap.
  const { data: leaseTenants } = await supabaseAdmin
    .from('lease_tenants').select('name, email').ilike('email', email)
  const myNames = [...new Set((leaseTenants ?? []).map(lt => norm(lt.name)).filter(Boolean))]

  const { data: byEmail } = await supabaseAdmin
    .from('payment_plan_tenants').select('id').ilike('email', email)
  const byName = myNames.length > 0
    ? (await supabaseAdmin
        .from('payment_plan_tenants').select('id, name').in('name', myNames)).data ?? []
    : []

  const mine = new Set([...(byEmail ?? []), ...byName].map(pt => pt.id))
  if (mine.size === 0) return Response.json({ error: 'No rent account found for you.' }, { status: 404 })

  // Load the rows and confirm every one belongs to this tenant.
  const rows: { kind: 'scheduled' | 'special'; id: string; due: number; label: string; dueDate: string | null }[] = []

  if (scheduledIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('scheduled_payments')
      .select('id, plan_tenant_id, amount, paid_amount, status, due_date')
      .in('id', scheduledIds)
    for (const r of data ?? []) {
      if (!mine.has(r.plan_tenant_id)) {
        return Response.json({ error: 'That payment isn\'t yours.' }, { status: 403 })
      }
      if (r.status === 'paid' || r.status === 'processing') continue
      const due = amountDue({ amount: Number(r.amount), paid_amount: Number(r.paid_amount ?? 0) })
      if (due > 0) rows.push({ kind: 'scheduled', id: r.id, due, label: `Rent due ${r.due_date}`, dueDate: r.due_date })
    }
  }

  if (specialIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('special_payments')
      .select('id, plan_tenant_id, amount, status, label, due_date')
      .in('id', specialIds)
    for (const r of data ?? []) {
      if (!r.plan_tenant_id || !mine.has(r.plan_tenant_id)) {
        return Response.json({ error: 'That charge isn\'t yours.' }, { status: 403 })
      }
      if (r.status !== 'pending') continue
      const due = Number(r.amount)
      if (due > 0) rows.push({ kind: 'special', id: r.id, due, label: r.label, dueDate: r.due_date ?? null })
    }
  }

  if (rows.length === 0) {
    return Response.json({ error: 'Those charges are already settled.' }, { status: 409 })
  }

  // Guard against a stale page billing an entire lease: a tenant is only ever
  // *required* to pay what has reached its due date. Paying ahead is allowed,
  // but it must be a deliberate selection of specific future months — never a
  // "pay everything" sweep, and never more than a year out.
  const today = new Date().toISOString().split('T')[0]
  const dueNow = rows.filter(r => !r.dueDate || r.dueDate <= today)
  const ahead = rows.filter(r => r.dueDate && r.dueDate > today)
  const YEAR_AHEAD = new Date(Date.now() + 365 * 86_400_000).toISOString().split('T')[0]

  if (ahead.some(r => r.dueDate! > YEAR_AHEAD)) {
    return Response.json({ error: 'You can only pay up to a year ahead.' }, { status: 400 })
  }
  if (dueNow.length === 0 && ahead.length === 0) {
    return Response.json({ error: 'Nothing is due right now.' }, { status: 409 })
  }

  const base = rows.reduce((s, r) => s + r.due, 0)
  const fee = computeFee(base, method)
  if (fee.totalCents < MIN_CHARGE_CENTS) {
    return Response.json({ error: 'Amount is below the minimum card payment.' }, { status: 400 })
  }

  const stripe = getStripe()
  const intent = await stripe.paymentIntents.create({
    amount: fee.totalCents,
    currency: 'usd',
    // ACH debit settles in days; card is instant. Restricting the type keeps the
    // surcharge honest — the tenant is charged the rate they were quoted.
    payment_method_types: method === 'ach' ? ['us_bank_account'] : ['card'],
    receipt_email: email,
    description: rows.map(r => r.label).join(', ').slice(0, 300),
    metadata: {
      type: 'rent_payment',
      userId: user.id,
      method,
      // Handy when reconciling a sandbox charge against a live one.
      stripeMode: stripeMode(),
      baseCents: String(fee.baseCents),
      feeCents: String(fee.feeCents),
      scheduledIds: rows.filter(r => r.kind === 'scheduled').map(r => r.id).join(','),
      specialIds: rows.filter(r => r.kind === 'special').map(r => r.id).join(','),
    },
  })

  return Response.json({
    clientSecret: intent.client_secret,
    base: fee.base,
    fee: fee.fee,
    total: fee.total,
    ratePct: fee.ratePct,
    method,
    items: rows.map(r => ({ label: r.label, amount: r.due })),
  })
}
