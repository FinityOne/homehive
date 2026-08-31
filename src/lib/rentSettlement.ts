// Applying a tenant rent payment to the rows it covers.
//
// Two things call this: the Stripe webhook, and the confirm step the browser
// makes as soon as it has a result. Either is enough on its own — the webhook
// is the source of truth in production, and the browser call is what makes a
// local run without `stripe listen` behave correctly. Both are safe to run,
// in any order, any number of times.

import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Whichever service-role client the caller already has. */
type DB = SupabaseClient

export function idsFromMetadata(pi: Stripe.PaymentIntent) {
  const m = pi.metadata ?? {}
  return {
    scheduledIds: (m.scheduledIds ?? '').split(',').filter(Boolean),
    specialIds: (m.specialIds ?? '').split(',').filter(Boolean),
    feeDollars: Number(m.feeCents ?? 0) / 100,
    method: m.method === 'ach' ? ('ach' as const) : ('card' as const),
    userId: (m.userId ?? '') as string,
  }
}

/**
 * Apply a payment to its rows.
 *
 * The surcharge is recorded on the first row only — it's a processing cost the
 * tenant paid, not rent received, and spreading it would distort every row's
 * paid amount. `paid_amount` always equals the rent itself so the landlord's
 * ledger stays true.
 *
 * Writes are keyed on the payment intent so a repeat run rewrites the same
 * values rather than double-counting, and a row already settled by a *different*
 * intent is left alone.
 */
export async function settleRentPayment(
  db: DB,
  pi: Stripe.PaymentIntent,
  status: 'paid' | 'processing'
): Promise<{ scheduled: number; special: number; conflicts: string[] }> {
  const { scheduledIds, specialIds, feeDollars, method } = idsFromMetadata(pi)
  const paidDate = new Date().toISOString().split('T')[0]

  let feeApplied = false
  let scheduled = 0
  let special = 0
  // Rows already settled by a *different* intent: the tenant has been charged
  // twice for the same rent. We must not overwrite the first payment's record,
  // and somebody needs to refund the second — so say so rather than swallow it.
  const conflicts: string[] = []

  for (const id of scheduledIds) {
    const { data: row } = await db
      .from('scheduled_payments')
      .select('amount, paid_amount, status, stripe_payment_intent_id')
      .eq('id', id)
      .maybeSingle()
    if (!row) continue
    if (row.stripe_payment_intent_id && row.stripe_payment_intent_id !== pi.id) {
      conflicts.push(`scheduled_payments:${id} already settled by ${row.stripe_payment_intent_id}`)
      continue
    }

    await db.from('scheduled_payments').update({
      status,
      paid_amount: status === 'paid' ? Number(row.amount) : Number(row.paid_amount ?? 0),
      paid_date: status === 'paid' ? paidDate : null,
      payment_method: method,
      recorded_by: 'tenant',
      processing_fee: feeApplied ? 0 : feeDollars,
      stripe_payment_intent_id: pi.id,
    }).eq('id', id)
    feeApplied = true
    scheduled++
  }

  for (const id of specialIds) {
    const { data: row } = await db
      .from('special_payments')
      .select('status, stripe_payment_intent_id')
      .eq('id', id)
      .maybeSingle()
    if (!row) continue
    if (row.stripe_payment_intent_id && row.stripe_payment_intent_id !== pi.id) {
      conflicts.push(`special_payments:${id} already settled by ${row.stripe_payment_intent_id}`)
      continue
    }

    await db.from('special_payments').update({
      status,
      paid_date: status === 'paid' ? paidDate : null,
      payment_method: method,
      recorded_by: 'tenant',
      processing_fee: feeApplied ? 0 : feeDollars,
      stripe_payment_intent_id: pi.id,
    }).eq('id', id)
    feeApplied = true
    special++
  }

  if (conflicts.length > 0) {
    console.error('[rent] DUPLICATE PAYMENT — intent', pi.id, 'covers rows already paid:', conflicts)
  }

  return { scheduled, special, conflicts }
}

/** An ACH debit that fails after the fact puts the charge back on the tenant. */
export async function revertRentPayment(db: DB, pi: Stripe.PaymentIntent) {
  const { scheduledIds, specialIds } = idsFromMetadata(pi)

  for (const id of scheduledIds) {
    await db.from('scheduled_payments').update({
      status: 'pending', paid_amount: 0, paid_date: null,
      payment_method: null, recorded_by: null, processing_fee: 0,
    }).eq('id', id).eq('stripe_payment_intent_id', pi.id)
  }
  for (const id of specialIds) {
    await db.from('special_payments').update({
      status: 'pending', paid_date: null,
      payment_method: null, recorded_by: null, processing_fee: 0,
    }).eq('id', id).eq('stripe_payment_intent_id', pi.id)
  }
}

/** Stripe intent status → what the rent rows should read. */
export function statusForIntent(s: Stripe.PaymentIntent.Status): 'paid' | 'processing' | null {
  if (s === 'succeeded') return 'paid'
  if (s === 'processing') return 'processing'
  return null
}
