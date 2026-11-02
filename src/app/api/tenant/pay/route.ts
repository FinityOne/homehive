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
import {
  computeFee, amountDue, MIN_CHARGE_CENTS, lateFeeOutstanding, billingToday,
  type PayMethod, type LateFeeRuleLike,
} from '@/lib/rentPayments'
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
  /**
   * Charges whose *late fee* is being paid, without the rent.
   *
   * Capped at 10 rather than 12 so the id and amount lists both stay inside
   * Stripe's 500-character metadata limit — settlement reads them from there.
   */
  const lateFeeIds: string[] = Array.isArray(body.lateFeeIds) ? body.lateFeeIds.slice(0, 10) : []

  if (scheduledIds.length === 0 && specialIds.length === 0 && lateFeeIds.length === 0) {
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

  // Charges on a demo lease are never payable, whatever a stale page offers.
  // The database forbids a plan on such a lease, so this normally finds
  // nothing — but a lease flagged after its plan existed must not be chargeable
  // for the minutes before someone deletes the plan.
  const { data: demoLeases } = await supabaseAdmin
    .from('leases').select('id').eq('is_demo', true)
  const demoPlanIds = new Set<string>()
  if ((demoLeases ?? []).length > 0) {
    const { data: demoPlans } = await supabaseAdmin
      .from('payment_plans').select('id').in('lease_id', (demoLeases ?? []).map(l => l.id))
    for (const p of demoPlans ?? []) demoPlanIds.add(p.id)
  }
  const demoRefusal = () => Response.json(
    { error: 'That lease is a demo lease — nothing is charged on it.' },
    { status: 409 }
  )

  // Load the rows and confirm every one belongs to this tenant.
  const rows: {
    kind: 'scheduled' | 'special' | 'late_fee'
    id: string
    due: number
    lateFee: number
    label: string
    dueDate: string | null
  }[] = []

  if (scheduledIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('scheduled_payments')
      .select('id, plan_id, plan_tenant_id, amount, paid_amount, status, due_date, paid_date, submitted_at, late_fee_paid')
      .in('id', scheduledIds)

    for (const r of data ?? []) {
      if (!mine.has(r.plan_tenant_id)) {
        return Response.json({ error: 'That payment isn\'t yours.' }, { status: 403 })
      }
      if (demoPlanIds.has(r.plan_id)) return demoRefusal()
      // A voided row is rent that was *cancelled* — the terminate flow writes it
      // on every future month when a tenant leaves early. Every landlord surface
      // and every reminder query already excludes it; billing it here would take
      // money for a tenancy that no longer exists.
      if (r.status === 'voided') continue
      if (r.status === 'paid' || r.status === 'processing') continue
      const due = amountDue({ amount: Number(r.amount), paid_amount: Number(r.paid_amount ?? 0) })
      // Rent only. A late fee is never folded into its rent line any more: it
      // is its own selectable charge, sent in `lateFeeIds`, so a tenant can
      // settle the rent, settle the fees, or settle everything — which is not
      // expressible if paying the month silently drags the fee along with it.
      // Anything the client leaves out simply is not charged.
      if (due > 0) rows.push({ kind: 'scheduled', id: r.id, due, lateFee: 0, label: `Rent due ${r.due_date}`, dueDate: r.due_date })
    }
  }

  if (specialIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('special_payments')
      .select('id, plan_id, plan_tenant_id, amount, status, label, due_date')
      .in('id', specialIds)
    for (const r of data ?? []) {
      if (!r.plan_tenant_id || !mine.has(r.plan_tenant_id)) {
        return Response.json({ error: 'That charge isn\'t yours.' }, { status: 403 })
      }
      if (demoPlanIds.has(r.plan_id)) return demoRefusal()
      if (r.status !== 'pending') continue
      const due = Number(r.amount)
      // One-off charges carry no late fee: the rule is written against rent.
      if (due > 0) rows.push({ kind: 'special', id: r.id, due, lateFee: 0, label: r.label, dueDate: r.due_date ?? null })
    }
  }

  // ── Late fees being paid on their own ──────────────────────────────────
  //
  // Nearly always on rent that is already settled: the fee froze on the day the
  // money landed and nobody ever asked for it. So this block must not care what
  // `status` says about the rent — only what the fee arithmetic says is still
  // owed. `lateFeeOutstanding` is the same figure the portal quoted and the
  // same one the landlord's ledger shows.
  if (lateFeeIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('scheduled_payments')
      .select('id, plan_id, plan_tenant_id, amount, paid_amount, status, due_date, paid_date, submitted_at, late_fee_paid')
      .in('id', lateFeeIds)

    const planIds = [...new Set((data ?? []).map(r => r.plan_id).filter(Boolean))]
    const { data: ruleRows } = planIds.length
      ? await supabaseAdmin
          .from('late_fee_rules')
          .select('plan_id, grace_period_days, fee_amount, frequency_days, max_total_fees')
          .in('plan_id', planIds)
      : { data: [] as (LateFeeRuleLike & { plan_id: string })[] }
    const feeRuleByPlan = new Map<string, LateFeeRuleLike>(
      (ruleRows ?? []).map(r => [r.plan_id, r as LateFeeRuleLike])
    )

    const { data: waiverRows } = await supabaseAdmin
      .from('late_fee_waivers')
      .select('scheduled_payment_id, amount')
      .in('scheduled_payment_id', lateFeeIds)
    const feeWaivedBy = new Map<string, number>(
      (waiverRows ?? []).map(w => [w.scheduled_payment_id, Number(w.amount ?? 0)])
    )

    for (const r of data ?? []) {
      if (!mine.has(r.plan_tenant_id)) {
        return Response.json({ error: 'That late fee isn\'t yours.' }, { status: 403 })
      }
      if (demoPlanIds.has(r.plan_id)) return demoRefusal()
      // Cancelled rent assesses no fee, and `lateFeeDue` already returns zero
      // for it — but skip it explicitly rather than relying on that.
      if (r.status === 'voided') continue
      // Don't let one request pay the same fee twice, once attached to its rent
      // and once on its own.
      if (scheduledIds.includes(r.id)) continue

      const owed = lateFeeOutstanding(
        feeRuleByPlan.get(r.plan_id),
        {
          status: r.status,
          due_date: r.due_date,
          paid_date: r.paid_date ?? null,
          // The date the fee is judged against. Omitting it here would bill the
          // tenant for however long their bank took to clear a debit they sent
          // on time — this is the figure the card is actually charged.
          submitted_at: r.submitted_at ?? null,
          amount: Number(r.amount),
          paid_amount: Number(r.paid_amount ?? 0),
          late_fee_paid: Number(r.late_fee_paid ?? 0),
        },
        feeWaivedBy.get(r.id) ?? 0,
      )

      if (owed > 0) {
        rows.push({
          kind: 'late_fee',
          id: r.id,
          // A fee-only row carries no rent. Keeping the two apart all the way
          // through is what lets the tenant be shown, and the landlord be
          // credited, for the right thing.
          due: 0,
          lateFee: owed,
          label: `Late fee — rent due ${r.due_date}`,
          // A fee is owed now, whatever its rent's due date was. Dating it
          // forward would push it into the pay-ahead branch below and have it
          // refused as not yet due.
          dueDate: null,
        })
      }
    }
  }

  if (rows.length === 0) {
    return Response.json(
      { error: 'Those charges are already settled.' },
      { status: 409 }
    )
  }

  // Guard against a stale page billing an entire lease: a tenant is only ever
  // *required* to pay what has reached its due date. Paying ahead is allowed,
  // but it must be a deliberate selection of specific future months — never a
  // "pay everything" sweep, and never more than a year out.
  const today = billingToday()
  const dueNow = rows.filter(r => !r.dueDate || r.dueDate <= today)
  const ahead = rows.filter(r => r.dueDate && r.dueDate > today)
  const YEAR_AHEAD = new Date(Date.now() + 365 * 86_400_000).toISOString().split('T')[0]

  if (ahead.some(r => r.dueDate! > YEAR_AHEAD)) {
    return Response.json({ error: 'You can only pay up to a year ahead.' }, { status: 400 })
  }
  if (dueNow.length === 0 && ahead.length === 0) {
    return Response.json({ error: 'Nothing is due right now.' }, { status: 409 })
  }

  const feeOnlyRows = rows.filter(r => r.kind === 'late_fee')

  // Late fees are part of what is owed, so they are inside the base the
  // surcharge is computed on — the processor bills on the whole charge.
  const rentBase = rows.reduce((s, r) => s + r.due, 0)
  const lateFeeTotal = Math.round(rows.reduce((s, r) => s + r.lateFee, 0) * 100) / 100
  const base = Math.round((rentBase + lateFeeTotal) * 100) / 100
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
    // The fee is in the key as well as the rent: paying a charge's rent and
    // paying its late fee are different payments on the same id, and a key that
    // ignored the fee would hand back the wrong intent for the second one.
    ...rows.map(r => `${r.kind}:${r.id}:${r.due}:${r.lateFee}`).sort(),
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
      // Split out so settlement can credit the late fee to the landlord rather
      // than silently folding it into rent — and so the figure the tenant was
      // actually charged is the one recorded, not a later recomputation.
      lateFeeCents: String(Math.round(lateFeeTotal * 100)),
      scheduledIds: rows.filter(r => r.kind === 'scheduled').map(r => r.id).join(','),
      specialIds: rows.filter(r => r.kind === 'special').map(r => r.id).join(','),
      // Fees paid on their own, with the amount charged for each. Settlement
      // applies these to `late_fee_payments` without touching the rent, which
      // on these rows was settled long ago by a different payment.
      lateFeeIds: feeOnlyRows.map(r => r.id).join(','),
      lateFeeAmounts: feeOnlyRows.map(r => r.lateFee.toFixed(2)).join(','),
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
    // Itemised so the sheet can show rent and late fees as separate lines; a
    // tenant asked for more than their rent is owed an explanation of why.
    rent: rentBase,
    lateFee: lateFeeTotal,
    fee: fee.fee,
    total: fee.total,
    ratePct: fee.ratePct,
    method,
    items: rows.map(r => ({
      label: r.label,
      // A fee-only line's money is in `lateFee`, not `due`.
      amount: r.kind === 'late_fee' ? r.lateFee : r.due,
      kind: r.kind,
    })),
  })
}
