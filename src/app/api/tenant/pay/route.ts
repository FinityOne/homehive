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
import { createHash } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { computeFee, amountDue, MIN_CHARGE_CENTS, type PayMethod } from '@/lib/rentPayments'
import { stripeSecretKey, stripeMode } from '@/lib/stripeEnv'
import { loadTenantIdentity, tenantNames, payerBelongsToTenant } from '@/lib/tenantIdentity'

function getStripe() { return new Stripe(stripeSecretKey()) }

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

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

  // Which payer rows are this tenant's? Resolved by the same rules the lease
  // view uses (src/lib/tenantIdentity.ts) so the two can never disagree about
  // who someone is.
  const identity = await loadTenantIdentity(supabaseAdmin, user)
  if (!identity) return Response.json({ error: 'No email on your account.' }, { status: 400 })

  const email = identity.email
  const myNames = tenantNames(identity)

  const { data: byEmail } = await supabaseAdmin
    .from('payment_plan_tenants').select('id, name, email').ilike('email', email)
  const byName = myNames.length > 0
    ? (await supabaseAdmin
        .from('payment_plan_tenants').select('id, name, email').in('name', myNames)).data ?? []
    : []

  const mine = new Set(
    [...(byEmail ?? []), ...byName]
      .filter(pt => payerBelongsToTenant(pt, identity, myNames))
      .map(pt => pt.id)
  )
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

  // Two tabs, or a double-click on a slow connection, would otherwise create two
  // intents for the same rent and charge the tenant twice. Keying on who is
  // paying, what they selected and how means a repeat of the *same* request
  // returns the *same* intent instead of a second charge. A genuinely different
  // selection hashes differently and is unaffected.
  //
  // Reusing the key on a declined intent is the behaviour we want too: Stripe
  // hands back that intent, and it can be confirmed again with another card.
  const idempotencyKey = 'rent_' + createHash('sha256').update([
    user.id,
    method,
    String(fee.totalCents),
    ...rows.map(r => `${r.kind}:${r.id}:${r.due}`).sort(),
  ].join('|')).digest('hex')

  const params: Stripe.PaymentIntentCreateParams = {
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
  }

  let intent: Stripe.PaymentIntent
  try {
    intent = await stripe.paymentIntents.create(params, { idempotencyKey })
  } catch (e) {
    // Stripe rejects a key replayed with different parameters. That means the
    // amount moved between attempts — a partial payment landed, say — so the
    // request is genuinely new and deserves its own intent.
    if (e instanceof Stripe.errors.StripeIdempotencyError) {
      intent = await stripe.paymentIntents.create(params)
    } else {
      throw e
    }
  }

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
