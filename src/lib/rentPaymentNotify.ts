// Telling people that money moved.
//
// Server-only: imported by settleRentPayment/revertRentPayment, which only ever
// run inside route handlers (the Stripe webhook and the tenant's confirm call).
//
// Two things make this delicate:
//
//  1. Settlement is deliberately idempotent — the webhook and the browser both
//     call it, in either order, sometimes at the same moment. Emails are not
//     idempotent. So every send first *claims* a (payment_intent_id, kind) row;
//     the unique index means exactly one caller wins and the loser goes quiet.
//  2. Nothing here may break settlement. The rent rows are already written by
//     the time we're called, so every failure below is logged and swallowed.

import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { getSiteUrl } from './siteUrl'
import { amountDue, fmtMoney as fmtUsd, type PayMethod } from './rentPayments'
import { buildRentReceiptEmail, buildLandlordRentPaidEmail, buildAdminPaymentEmail, type PayEvent, type PaidRow, type ChargePart, type RowKind } from './rentPaymentEmails'
import { logPaymentEmail, type PaymentEmailItem } from './paymentEmailLog'
import { economics, STRIPE_RATES } from './platformFees'

/**
 * Just enough of a Stripe intent to build the emails. A manual resend has only
 * the id on file, so the sender must not demand a whole PaymentIntent.
 */
type IntentLike = { id: string; receipt_email?: string | null }

/** Who a send is for. A resend is often only wanted by one side. */
export type Audience = 'tenant' | 'landlord' | 'both'

const FROM = 'HomeHive <hello@homehive.live>'

/** Rows already settled, in the shape the emails want. */
export type SettledRow = {
  /**
   * `late_fee` is a fee collected on its own. Its `id` is still a
   * `scheduled_payments` id — the fee rides on the rent row it was assessed
   * against — so only the kind distinguishes it, and the plan lookup below
   * treats it like any other rent row.
   */
  kind: 'scheduled' | 'special' | 'late_fee'
  id: string
  amount: number
  label: string
}

/**
 * Work out what each settled charge was actually made of.
 *
 * Rent is billed as the payer's whole monthly obligation, so a $770.67 charge
 * is really $749 rent plus a $21.67 share of the house internet, and until now
 * every receipt showed only the total — which reads to a tenant like the rent
 * went up, and to a landlord like utility money is rent income.
 * `payment_line_items` holds the split, so it is read back here.
 *
 * Done at delivery time, in one place, so the automatic send, a manual resend
 * and the backfill script all describe a payment identically.
 *
 * The reconciliation guard matters: line items are the *current* composition of
 * the lease, so a charge from before the landlord last changed them may no
 * longer add up to it. When the parts don't reconcile to the amount, the
 * breakdown is dropped rather than shown — the email then says exactly what it
 * said before, which is honest, instead of contradicting its own total.
 */
/** Exported for `scripts/verify-payment-email-breakdown.mjs`, which pins the
 *  reconciliation guard — the one rule here that, if it broke, would produce a
 *  confidently wrong breakdown rather than none. */
export async function describeRows(db: SupabaseClient, rows: SettledRow[]): Promise<PaidRow[]> {
  const scheduledIds = rows.filter(r => r.kind === 'scheduled').map(r => r.id)
  const specialIds = rows.filter(r => r.kind === 'special').map(r => r.id)

  // payer per rent charge → that payer's line items
  const payerOf = new Map<string, string>()
  if (scheduledIds.length > 0) {
    const { data } = await db
      .from('scheduled_payments').select('id, plan_tenant_id').in('id', scheduledIds)
    for (const r of data ?? []) {
      if (r.plan_tenant_id) payerOf.set(r.id as string, r.plan_tenant_id as string)
    }
  }
  const partsByPayer = new Map<string, ChargePart[]>()
  const payerIds = [...new Set(payerOf.values())]
  if (payerIds.length > 0) {
    const { data, error } = await db
      .from('payment_line_items')
      .select('plan_tenant_id, category, label, amount, utility_id')
      .in('plan_tenant_id', payerIds)
    if (error) {
      // Not fatal: a receipt without a breakdown is still a correct receipt.
      console.error('[rent] could not read line items for the breakdown', error.message)
    }
    for (const li of data ?? []) {
      const list = partsByPayer.get(li.plan_tenant_id as string) ?? []
      list.push({
        label: (li.label as string) || (li.category as string) || 'Charge',
        amount: Number(li.amount),
        kind: li.category === 'rent' ? 'rent' : li.utility_id ? 'utility' : 'other',
      })
      partsByPayer.set(li.plan_tenant_id as string, list)
    }
  }

  // A one-off charge is a utility only when it came from a declared one — the
  // same rule the ledger uses, so the two can never disagree.
  const specialKind = new Map<string, RowKind>()
  if (specialIds.length > 0) {
    const { data } = await db
      .from('special_payments').select('id, utility_id').in('id', specialIds)
    for (const r of data ?? []) {
      specialKind.set(r.id as string, r.utility_id ? 'utility' : 'charge')
    }
  }

  return rows.map(r => {
    if (r.kind === 'late_fee') return { label: r.label, amount: r.amount, kind: 'late_fee' as RowKind }
    if (r.kind === 'special') {
      return { label: r.label, amount: r.amount, kind: specialKind.get(r.id) ?? 'charge' }
    }
    const parts = partsByPayer.get(payerOf.get(r.id) ?? '') ?? []
    const sum = Math.round(parts.reduce((s, p) => s + p.amount, 0) * 100) / 100
    const reconciles = parts.length > 0 && Math.abs(sum - r.amount) <= 0.01
    return {
      label: r.label,
      amount: r.amount,
      kind: 'rent' as RowKind,
      ...(reconciles ? { parts } : {}),
    }
  })
}

/** Just the month and year, for a late-fee line. */
const feeMonthLabel = (due: string) =>
  new Date(due + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

const monthLabel = (due: string) =>
  `Rent — ${new Date(due + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`

/**
 * Claim the right to send. Returns false when someone else already has it —
 * the unique index on (payment_intent_id, kind) is what makes the double call
 * safe, not any check we could do in application code.
 */
async function claim(db: SupabaseClient, intentId: string, kind: PayEvent): Promise<boolean> {
  const { error } = await db
    .from('rent_payment_notifications')
    .insert([{ payment_intent_id: intentId, kind }])
  if (!error) return true
  // 23505 = unique violation: already sent. Anything else is a real problem,
  // and we'd rather stay silent than risk emailing the landlord on every retry.
  if (error.code !== '23505') {
    console.error('[rent] notification claim failed', intentId, kind, error.message)
  }
  return false
}

/** Everything the two emails need, or null when the rows can't be resolved. */
async function loadContext(db: SupabaseClient, rows: SettledRow[]) {
  // A fee row is a rent row for the purposes of finding the plan and the payer.
  const scheduledIds = rows
    .filter(r => r.kind === 'scheduled' || r.kind === 'late_fee')
    .map(r => r.id)
  const specialIds = rows.filter(r => r.kind === 'special').map(r => r.id)

  // Any one row identifies the plan and the payer — a single intent never spans
  // two tenants, because the tenant portal only ever offers its own charges.
  let planId: string | null = null
  let planTenantId: string | null = null

  if (scheduledIds.length > 0) {
    const { data } = await db
      .from('scheduled_payments').select('plan_id, plan_tenant_id').eq('id', scheduledIds[0]).maybeSingle()
    planId = data?.plan_id ?? null
    planTenantId = data?.plan_tenant_id ?? null
  }
  if (!planId && specialIds.length > 0) {
    const { data } = await db
      .from('special_payments').select('plan_id, plan_tenant_id').eq('id', specialIds[0]).maybeSingle()
    planId = data?.plan_id ?? null
    planTenantId = data?.plan_tenant_id ?? null
  }
  if (!planId) return null

  const { data: plan } = await db
    .from('payment_plans')
    .select('id, name, owner_id, property:properties ( name )')
    .eq('id', planId)
    .maybeSingle()
  if (!plan) return null

  const { data: tenant } = planTenantId
    ? await db.from('payment_plan_tenants').select('id, name, email').eq('id', planTenantId).maybeSingle()
    : { data: null }

  // Only columns `profiles` actually has. Asking PostgREST for one it does not
  // is not a null field — it fails the whole row, which is how the landlord's
  // copy of every rent receipt went missing without a single error surfacing.
  // The error is logged for the same reason: a landlord who cannot be looked up
  // is a landlord who gets no email, and that must never be quiet again.
  const { data: profile, error: profileErr } = await db
    .from('profiles').select('full_name, email').eq('id', plan.owner_id).maybeSingle()
  if (profileErr) {
    console.error('[rent] could not read the landlord profile', plan.owner_id, profileErr.message)
  }

  // Outstanding *after* this settlement — the writes have already landed, so a
  // fresh read is the honest number. 'processing' counts as settled here: an
  // ACH debit in flight isn't something to chase the tenant for.
  const { data: openScheduled } = await db
    .from('scheduled_payments')
    .select('plan_tenant_id, amount, paid_amount')
    .eq('plan_id', planId)
    .not('status', 'in', '(paid,processing,voided)')
  const { data: openSpecial } = await db
    .from('special_payments')
    .select('plan_tenant_id, amount')
    .eq('plan_id', planId)
    .eq('status', 'pending')

  let planOutstanding = 0
  let tenantOutstanding = 0
  for (const r of openScheduled ?? []) {
    const due = amountDue({ amount: Number(r.amount), paid_amount: Number(r.paid_amount ?? 0) })
    planOutstanding += due
    if (r.plan_tenant_id === planTenantId) tenantOutstanding += due
  }
  for (const r of openSpecial ?? []) {
    const due = Number(r.amount)
    planOutstanding += due
    if (r.plan_tenant_id === planTenantId) tenantOutstanding += due
  }

  const rawProperty = (plan as { property?: unknown }).property
  const property = Array.isArray(rawProperty) ? rawProperty[0] : rawProperty

  return {
    planId,
    planName: (plan as { name?: string }).name ?? null,
    propertyName: (property as { name?: string } | null)?.name ?? 'your home',
    tenantName: tenant?.name ?? 'Your tenant',
    tenantEmail: tenant?.email?.trim() || null,
    landlordName: profile?.full_name || null,
    landlordEmail: profile?.email?.trim() || null,
    planOutstanding: Math.round(planOutstanding * 100) / 100,
    tenantOutstanding: Math.round(tenantOutstanding * 100) / 100,
  }
}

/** The rows an intent covered, read back for their labels and amounts. */
export async function rowsForIntent(
  db: SupabaseClient,
  scheduledIds: string[],
  specialIds: string[],
  /** Fees collected on their own: the charge they sat on, and what was paid. */
  lateFeeRows: { id: string; amount: number }[] = []
): Promise<SettledRow[]> {
  const out: SettledRow[] = []
  if (lateFeeRows.length > 0) {
    const { data } = await db
      .from('scheduled_payments')
      .select('id, due_date')
      .in('id', lateFeeRows.map(r => r.id))
    for (const r of data ?? []) {
      const paid = lateFeeRows.find(x => x.id === r.id)
      if (!paid) continue
      // The amount is what was actually charged, not anything on the row — a
      // late fee is derived and has no column of its own.
      out.push({
        kind: 'late_fee',
        id: r.id,
        amount: paid.amount,
        label: 'Late fee — ' + feeMonthLabel(r.due_date) + ' rent',
      })
    }
  }
  if (scheduledIds.length > 0) {
    const { data } = await db
      .from('scheduled_payments').select('id, amount, due_date').in('id', scheduledIds)
    for (const r of data ?? []) {
      out.push({ kind: 'scheduled', id: r.id, amount: Number(r.amount), label: monthLabel(r.due_date) })
    }
  }
  if (specialIds.length > 0) {
    const { data } = await db
      .from('special_payments').select('id, amount, label').in('id', specialIds)
    for (const r of data ?? []) {
      out.push({ kind: 'special', id: r.id, amount: Number(r.amount), label: r.label })
    }
  }
  return out
}

/**
 * Email the tenant a receipt and the landlord a heads-up, once per intent per
 * event. Safe to call from an idempotent settlement path: the claim decides.
 */
export async function notifyRentPayment(input: {
  db: SupabaseClient
  pi: Stripe.PaymentIntent
  event: PayEvent
  method: PayMethod
  /** Surcharge from the intent metadata, in dollars. */
  fee: number
  rows: SettledRow[]
}): Promise<void> {
  const { db, pi, event, method, fee, rows } = input
  if (rows.length === 0) return

  if (!process.env.RESEND_API_KEY) {
    console.warn('[rent] RESEND_API_KEY missing — no payment emails sent for', pi.id)
    return
  }
  if (!(await claim(db, pi.id, event))) return

  const result = await deliverRentPaymentEmails({
    db, intent: pi, event, method, fee, rows, audience: 'both', trigger: 'auto',
  })

  // The claim is taken before sending, because two callers can race. But if the
  // send then failed outright, holding the claim would mean this payment is
  // never announced again — the webhook's own retry would find the claim taken
  // and go quiet. Release it so a retry can do the job properly.
  if (result.sent.length === 0) {
    const { error } = await db
      .from('rent_payment_notifications')
      .delete()
      .eq('payment_intent_id', pi.id)
      .eq('kind', event)
    if (error) {
      console.error('[rent] could not release notification claim for', pi.id, event, error.message)
    } else {
      console.warn('[rent] no payment email delivered for', pi.id, event, '— claim released for retry:', result.skipped.join(' · '))
    }
  }
}

/**
 * Send the receipt and/or the landlord notification for a payment that already
 * settled — no claim, because the landlord asked for this on purpose.
 *
 * The automatic path claims a (intent, event) row so the webhook and the
 * browser cannot both send. That guard is exactly wrong for a manual resend:
 * the landlord is asking *because* the first one never arrived, and a claim
 * already taken would silently do nothing.
 */
export async function resendRentPaymentEmails(input: {
  db: SupabaseClient
  intent: IntentLike
  event: PayEvent
  method: PayMethod
  fee: number
  rows: SettledRow[]
  audience: Audience
  sentBy?: string | null
  /** When the money actually moved. Defaults to now; pass it when sending for a
   *  payment that settled earlier, so the email doesn't date itself today. */
  paidOn?: Date
}): Promise<{ sent: { to: string; role: 'tenant' | 'landlord' }[]; skipped: string[] }> {
  return deliverRentPaymentEmails({ ...input, trigger: 'manual' })
}

async function deliverRentPaymentEmails(input: {
  db: SupabaseClient
  intent: IntentLike
  event: PayEvent
  method: PayMethod
  fee: number
  rows: SettledRow[]
  audience: Audience
  trigger: 'auto' | 'manual'
  sentBy?: string | null
  paidOn?: Date
}): Promise<{ sent: { to: string; role: 'tenant' | 'landlord' }[]; skipped: string[] }> {
  const { db, intent: pi, event, method, fee, rows, audience, trigger, sentBy } = input
  const sent: { to: string; role: 'tenant' | 'landlord' }[] = []
  const skipped: string[] = []

  if (rows.length === 0) return { sent, skipped: ['nothing to send about'] }
  if (!process.env.RESEND_API_KEY) {
    console.warn('[rent] RESEND_API_KEY missing — no payment emails sent for', pi.id)
    return { sent, skipped: ['email is not configured'] }
  }

  try {
    const ctx = await loadContext(db, rows)
    if (!ctx) {
      console.error('[rent] could not resolve plan for intent', pi.id, '— no emails sent')
      return { sent, skipped: ['could not resolve the lease for this payment'] }
    }

    const rent = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100
    const paidOn = input.paidOn ?? new Date()
    const emailRows: PaidRow[] = await describeRows(db, rows)
    const resend = new Resend(process.env.RESEND_API_KEY)

    // Tenant receipt. `receipt_email` on the intent is the address the tenant
    // signed in with, so it's the better fallback than nothing when the payer
    // row has no email on file.
    const to = ctx.tenantEmail || pi.receipt_email || null
    // The same rows, in the shape the email history wants.
    const logItems: PaymentEmailItem[] = rows.map(r => ({
      scheduledPaymentId: r.kind === 'special' ? null : r.id,
      specialPaymentId:   r.kind === 'special' ? r.id : null,
      label: r.label,
      dueDate: new Date().toISOString().slice(0, 10),
      amount: r.amount,
      kind: r.kind === 'special' ? 'charge' : r.kind === 'late_fee' ? 'late_fee' : 'rent',
    }))

    if (audience !== 'landlord' && !to) skipped.push('tenant has no email address on file')
    if (audience !== 'landlord' && to) {
      const { subject, html, text } = buildRentReceiptEmail({
        tenantName: ctx.tenantName,
        propertyName: ctx.propertyName,
        event,
        rows: emailRows,
        rent,
        // A failed debit collected nothing, fee included.
        fee: event === 'failed' ? 0 : fee,
        method,
        remaining: ctx.tenantOutstanding,
        paidOn,
        // A bounced debit needs a retry, not a read: send those straight into
        // the payment flow. A receipt just wants the lease page.
        payUrl: `${getSiteUrl()}/dashboard/lease${event === 'failed' ? '?tab=payments&pay=1' : ''}`,
        landlordName: ctx.landlordName,
        landlordEmail: ctx.landlordEmail,
        reference: pi.id,
      })
      // Resend reports a rejected send in `error` rather than throwing, so an
      // unchecked call reports success for mail that never left.
      const { data: sendData, error: sendErr } = await resend.emails.send({
        from: FROM, to, subject, html, text,
        ...(ctx.landlordEmail ? { replyTo: ctx.landlordEmail } : {}),
      })
      if (sendErr) {
        skipped.push(`tenant receipt failed: ${sendErr.message}`)
        console.error('[rent] tenant receipt failed for', pi.id, sendErr.message)
      } else {
        sent.push({ to, role: 'tenant' })
      }
      await logPaymentEmail({
        planId: ctx.planId, planTenantId: null,
        recipientEmail: to, recipientName: ctx.tenantName,
        subject, kind: `receipt_tenant_${event}`, trigger,
        status: sendErr ? 'failed' : 'sent',
        error: sendErr?.message ?? null,
        providerId: sendData?.id ?? null,
        sentBy: sentBy ?? null, items: logItems,
      })
    }

    // Landlord notification.
    if (audience !== 'tenant' && !ctx.landlordEmail) {
      // A payment nobody told the landlord about is the thing this module
      // exists to prevent, so say so where it will be seen rather than only
      // returning it to a caller that may not read `skipped`.
      console.error('[rent] no landlord email on file for plan', ctx.planId, '— landlord copy not sent for', pi.id)
      skipped.push('no landlord email on file')
    }
    if (audience !== 'tenant' && ctx.landlordEmail) {
      const { subject, html, text } = buildLandlordRentPaidEmail({
        landlordName: ctx.landlordName,
        tenantName: ctx.tenantName,
        propertyName: ctx.propertyName,
        event,
        rows: emailRows,
        rent,
        method,
        paidOn,
        tenantOutstanding: ctx.tenantOutstanding,
        planOutstanding: ctx.planOutstanding,
        planUrl: `${getSiteUrl()}/landlord/financials?plan=${ctx.planId}`,
        reference: pi.id,
      })
      const { data: sendData, error: sendErr } = await resend.emails.send({
        from: FROM, to: ctx.landlordEmail, subject, html, text,
        ...(to ? { replyTo: to } : {}),
      })
      if (sendErr) {
        skipped.push(`landlord copy failed: ${sendErr.message}`)
        console.error('[rent] landlord notification failed for', pi.id, sendErr.message)
      } else {
        sent.push({ to: ctx.landlordEmail, role: 'landlord' })
      }
      await logPaymentEmail({
        planId: ctx.planId, planTenantId: null,
        recipientEmail: ctx.landlordEmail, recipientName: ctx.landlordName,
        subject, kind: `receipt_landlord_${event}`, audience: 'landlord', trigger,
        status: sendErr ? 'failed' : 'sent',
        error: sendErr?.message ?? null,
        providerId: sendData?.id ?? null,
        sentBy: sentBy ?? null, items: logItems,
      })
    }

    // Admin copy — the same payment, re-cut as platform economics.
    //
    // Only on the automatic path. A manual resend is the landlord asking for
    // *their* copy because it never arrived; re-sending the business email
    // would just add noise to the admin inbox for a payment already reported.
    //
    // Never logged to payment_email_log: that history is shown to landlords on
    // the plan page, and what HomeHive earns is not theirs to read.
    const adminEmail = process.env.ADMIN_EMAIL
    if (trigger === 'auto' && adminEmail) {
      // Stripe bills on the whole charge, rent included — not on our slice.
      const econ = economics({
        passThroughCents: Math.round(rent * 100),
        feeCents: Math.round(fee * 100),
        method,
      })
      const r = STRIPE_RATES[method]
      const rateLabel = method === 'card'
        ? `${(r.pct * 100).toFixed(1)}% + ${r.fixedCents}¢`
        : `${(r.pct * 100).toFixed(1)}%${r.capCents != null ? `, capped at ${fmtUsd(r.capCents / 100)}` : ''}`

      const { subject, html, text } = buildAdminPaymentEmail({
        event,
        tenantName: ctx.tenantName,
        landlordName: ctx.landlordName,
        landlordEmail: ctx.landlordEmail,
        propertyName: ctx.propertyName,
        planName: ctx.planName,
        rows: emailRows,
        rent,
        fee: event === 'failed' ? 0 : fee,
        method,
        stripeCost: econ.costCents / 100,
        rateLabel,
        paidOn,
        planUrl: `${getSiteUrl()}/landlord/financials?plan=${ctx.planId}`,
        reference: pi.id,
      })
      const { error: adminErr } = await resend.emails.send({
        from: FROM, to: adminEmail, subject, html, text,
      })
      if (adminErr) console.error('[rent] admin copy failed for', pi.id, adminErr.message)
    }
  } catch (e) {
    // The rent rows are already correct; a failed email must never undo that.
    console.error('[rent] payment notification failed for', pi.id, e)
    skipped.push(e instanceof Error ? e.message : String(e))
  }
  return { sent, skipped }
}
