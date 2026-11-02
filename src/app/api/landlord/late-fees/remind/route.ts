/**
 * POST /api/landlord/late-fees/remind
 *
 * Email one tenant about the late fees outstanding on their rent, with the
 * arithmetic shown. One email per call, covering however many charges — the
 * landlord picks the tenant, not the charge, because three separate emails
 * about three months of fees reads as harassment and gets filtered.
 *
 * Body: { planId, planTenantId, scheduledPaymentIds?: string[], message? }
 *   — omit `scheduledPaymentIds` to cover every fee outstanding for that payer.
 *
 * The fee is **recomputed here from the rule**, never taken from the request.
 * The browser's figures are a preview; a stale tab must not be able to bill a
 * tenant for a fee that has since been paid, waived, or capped differently.
 * That is the same rule `/api/tenant/pay` follows for the same reason.
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextRequest } from 'next/server'
import { getSiteUrl } from '@/lib/siteUrl'
import { buildLateFeeEmail, type LateFeeEmailRow } from '@/lib/lateFeeEmails'
import { lateFeeDue, lateFeeCappedByCharge, rentIsSettled, billingToday, type LateFeeRuleLike } from '@/lib/rentPayments'
import { logPaymentEmail, type PaymentEmailItem } from '@/lib/paymentEmailLog'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)
const resend = new Resend(process.env.RESEND_API_KEY!)

const DAY = 86_400_000
const round2 = (n: number) => Math.round(n * 100) / 100

const daysBetween = (from: string, to: string) =>
  Math.round((new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / DAY)

const monthLabel = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) + ' rent'

type PayerRow = { id: string; name: string; email: string | null }

/** A to-one relation Supabase may hand back as a single row or a one-row array. */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const planId: string | undefined = body.planId
  const planTenantId: string | undefined = body.planTenantId
  const requestedIds: string[] | null = Array.isArray(body.scheduledPaymentIds) && body.scheduledPaymentIds.length > 0
    ? body.scheduledPaymentIds
    : null
  const customMessage: string | null = typeof body.message === 'string' && body.message.trim()
    ? body.message.trim().slice(0, 500)
    : null

  if (!planId || !planTenantId) {
    return Response.json({ error: 'planId and planTenantId are required.' }, { status: 400 })
  }

  // The plan must belong to the caller, and it must have a rule — a fee with no
  // rule behind it is not a fee, and there would be nothing to explain.
  const { data: plan } = await supabaseAdmin
    .from('payment_plans')
    .select(`
      id, owner_id,
      property:properties ( name ),
      tenants:payment_plan_tenants ( id, name, email ),
      rule:late_fee_rules ( grace_period_days, fee_amount, frequency_days, max_total_fees )
    `)
    .eq('id', planId)
    .maybeSingle()

  if (!plan) return Response.json({ error: 'Plan not found' }, { status: 404 })
  if (plan.owner_id !== user.id) return Response.json({ error: 'Unauthorized' }, { status: 403 })

  const rule = one<LateFeeRuleLike>(plan.rule as LateFeeRuleLike | LateFeeRuleLike[] | null)
  if (!rule || rule.fee_amount <= 0) {
    return Response.json({ error: 'This lease has no late-fee rule, so there is no fee to ask for.' }, { status: 409 })
  }

  const tenant = ((plan.tenants as PayerRow[] | null) ?? []).find(t => t.id === planTenantId)
  if (!tenant) return Response.json({ error: 'That payer is not on this lease.' }, { status: 404 })
  const to = tenant.email?.trim()
  if (!to) return Response.json({ error: `${tenant.name} has no email address on file.` }, { status: 409 })

  let q = supabaseAdmin
    .from('scheduled_payments')
    .select('id, due_date, amount, paid_amount, paid_date, submitted_at, status, late_fee_paid, late_fee_reminder_count')
    .eq('plan_id', planId)
    .eq('plan_tenant_id', planTenantId)
    .neq('status', 'voided')
    .order('due_date')
  if (requestedIds) q = q.in('id', requestedIds)

  const { data: charges } = await q

  // Waived fees are the landlord's recorded decision not to collect. Emailing
  // one would contradict a choice they already made, so they are netted off
  // here exactly as the ledger nets them off on screen.
  const { data: waivers } = await supabaseAdmin
    .from('late_fee_waivers')
    .select('scheduled_payment_id, amount')
    .eq('plan_id', planId)
  const waivedBy = new Map<string, number>(
    (waivers ?? []).map(w => [w.scheduled_payment_id, Number(w.amount)])
  )

  const rows: LateFeeEmailRow[] = []
  const covered: { id: string; fee: number; dueDate: string; count: number }[] = []

  for (const c of charges ?? []) {
    const sp = {
      status: c.status as string,
      due_date: c.due_date as string,
      paid_date: (c.paid_date ?? null) as string | null,
      amount: Number(c.amount),
      paid_amount: Number(c.paid_amount ?? 0),
    }
    const assessed = lateFeeDue(rule, sp)
    const outstanding = round2(assessed - Number(c.late_fee_paid ?? 0) - (waivedBy.get(c.id) ?? 0))
    if (outstanding <= 0.005) continue

    const settled = rentIsSettled(sp)
    rows.push({
      label: monthLabel(sp.due_date),
      dueDate: sp.due_date,
      rentAmount: sp.amount,
      fee: outstanding,
      daysLate: Math.max(0, daysBetween(sp.due_date, settled && sp.paid_date ? sp.paid_date : billingToday())),
      rentOutstanding: Math.max(0, round2(sp.amount - sp.paid_amount)),
      paidOn: settled ? sp.paid_date : null,
      capped: lateFeeCappedByCharge(rule, sp),
    })
    covered.push({ id: c.id, fee: outstanding, dueDate: sp.due_date, count: Number(c.late_fee_reminder_count ?? 0) })
  }

  if (rows.length === 0) {
    return Response.json(
      { error: 'No late fees are outstanding for that tenant — they may have been paid or waived already.' },
      { status: 409 }
    )
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('full_name, email').eq('id', user.id).maybeSingle()
  const landlordName = profile?.full_name || null
  const landlordEmail = profile?.email || user.email || null

  // Only offer the payment page when it can actually take the money. The tenant
  // pay route collects a fee only as a rider on rent that is still owed, so for
  // a fee on settled rent there is nothing for it to attach to and the link
  // would dead-end. See the note at the top of `lateFeeEmails.ts`.
  const payable = rows.some(r => r.rentOutstanding > 0)
  const payUrl = payable ? `${getSiteUrl()}/dashboard/lease?tab=payments&pay=1` : null

  const { subject, html, text } = buildLateFeeEmail({
    tenantName: tenant.name,
    propertyName: one<{ name: string }>(plan.property as { name: string } | { name: string }[] | null)?.name ?? 'your home',
    rows,
    rule,
    payUrl,
    landlordName,
    landlordEmail,
    customMessage,
  })

  // What this email asked for, as the tenant was shown it. The amount recorded
  // is the fee, not the rent — this row is a request for the fee.
  const logItems: PaymentEmailItem[] = covered.map(c => ({
    scheduledPaymentId: c.id,
    specialPaymentId: null,
    label: `Late fee — ${monthLabel(c.dueDate)}`,
    dueDate: c.dueDate,
    amount: c.fee,
    kind: 'late_fee',
  }))

  try {
    const { data: sendData, error: sendErr } = await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to,
      subject,
      html,
      text,
      ...(landlordEmail ? { replyTo: landlordEmail } : {}),
    })
    // Resend reports a rejection in `error` rather than throwing, so without
    // this a bounced address would be logged and counted as delivered.
    if (sendErr) throw new Error(sendErr.message || 'Resend rejected the send')

    await logPaymentEmail({
      planId, planTenantId, recipientEmail: to, recipientName: tenant.name,
      subject, kind: 'late_fee_request', status: 'sent',
      providerId: sendData?.id ?? null, customMessage, sentBy: user.id, items: logItems,
    })
  } catch (e) {
    console.error('late fee reminder failed', planTenantId, e)
    // A failed request is history too — silence in the log reads as "never
    // chased" rather than "never arrived".
    await logPaymentEmail({
      planId, planTenantId, recipientEmail: to, recipientName: tenant.name,
      subject, kind: 'late_fee_request', status: 'failed',
      error: e instanceof Error ? e.message : String(e),
      customMessage, sentBy: user.id, items: logItems,
    })
    return Response.json({ error: 'The email could not be delivered.' }, { status: 502 })
  }

  // Bump each charge's own fee-reminder counter. Incremented one at a time so
  // the per-charge history of how often it has been raised stays intact, and
  // kept apart from `reminder_count`, which counts chases about the rent.
  const stamp = new Date().toISOString()
  for (const c of covered) {
    await supabaseAdmin
      .from('scheduled_payments')
      .update({ late_fee_reminder_sent_at: stamp, late_fee_reminder_count: c.count + 1 })
      .eq('id', c.id)
  }

  return Response.json({
    sent: 1,
    recipient: { name: tenant.name, email: to },
    total: round2(rows.reduce((s, r) => s + r.fee, 0)),
    charges: covered.length,
    payable,
  })
}
