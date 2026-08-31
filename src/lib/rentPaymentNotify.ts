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
import { amountDue, type PayMethod } from './rentPayments'
import { buildRentReceiptEmail, buildLandlordRentPaidEmail, type PayEvent, type PaidRow } from './rentPaymentEmails'

const FROM = 'HomeHive <hello@homehive.live>'

/** Rows already settled, in the shape the emails want. */
type SettledRow = { kind: 'scheduled' | 'special'; id: string; amount: number; label: string }

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
  const scheduledIds = rows.filter(r => r.kind === 'scheduled').map(r => r.id)
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
    .select('id, owner_id, property:properties ( name )')
    .eq('id', planId)
    .maybeSingle()
  if (!plan) return null

  const { data: tenant } = planTenantId
    ? await db.from('payment_plan_tenants').select('id, name, email').eq('id', planTenantId).maybeSingle()
    : { data: null }

  const { data: profile } = await db
    .from('profiles').select('full_name, first_name, email').eq('id', plan.owner_id).maybeSingle()

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
    propertyName: (property as { name?: string } | null)?.name ?? 'your home',
    tenantName: tenant?.name ?? 'Your tenant',
    tenantEmail: tenant?.email?.trim() || null,
    landlordName: profile?.full_name || profile?.first_name || null,
    landlordEmail: profile?.email?.trim() || null,
    planOutstanding: Math.round(planOutstanding * 100) / 100,
    tenantOutstanding: Math.round(tenantOutstanding * 100) / 100,
  }
}

/** The rows an intent covered, read back for their labels and amounts. */
export async function rowsForIntent(
  db: SupabaseClient,
  scheduledIds: string[],
  specialIds: string[]
): Promise<SettledRow[]> {
  const out: SettledRow[] = []
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

  try {
    const ctx = await loadContext(db, rows)
    if (!ctx) {
      console.error('[rent] could not resolve plan for intent', pi.id, '— no emails sent')
      return
    }

    const rent = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100
    const paidOn = new Date()
    const emailRows: PaidRow[] = rows.map(r => ({ label: r.label, amount: r.amount }))
    const resend = new Resend(process.env.RESEND_API_KEY)

    // Tenant receipt. `receipt_email` on the intent is the address the tenant
    // signed in with, so it's the better fallback than nothing when the payer
    // row has no email on file.
    const to = ctx.tenantEmail || pi.receipt_email || null
    if (to) {
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
        payUrl: `${getSiteUrl()}/dashboard/lease`,
        landlordName: ctx.landlordName,
        landlordEmail: ctx.landlordEmail,
        reference: pi.id,
      })
      await resend.emails.send({
        from: FROM, to, subject, html, text,
        ...(ctx.landlordEmail ? { replyTo: ctx.landlordEmail } : {}),
      })
    }

    // Landlord notification.
    if (ctx.landlordEmail) {
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
        planUrl: `${getSiteUrl()}/landlord/payments/${ctx.planId}`,
        reference: pi.id,
      })
      await resend.emails.send({
        from: FROM, to: ctx.landlordEmail, subject, html, text,
        ...(to ? { replyTo: to } : {}),
      })
    } else {
      console.warn('[rent] landlord has no email on file — not notified about', pi.id)
    }
  } catch (e) {
    // The rent rows are already correct; a failed email must never undo that.
    console.error('[rent] payment notification failed for', pi.id, e)
  }
}
