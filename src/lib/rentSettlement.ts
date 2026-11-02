// Applying a tenant rent payment to the rows it covers.
//
// Two things call this: the Stripe webhook, and the confirm step the browser
// makes as soon as it has a result. Either is enough on its own — the webhook
// is the source of truth in production, and the browser call is what makes a
// local run without `stripe listen` behave correctly. Both are safe to run,
// in any order, any number of times.

import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyRentPayment, rowsForIntent } from './rentPaymentNotify'
import { recordPaymentAttempt } from './rentPaymentAttempts'

/** Whichever service-role client the caller already has. */
type DB = SupabaseClient

/**
 * When the tenant pressed pay, from the intent itself.
 *
 * `created` is seconds since the epoch on every real PaymentIntent, but this
 * returns null rather than throwing if it is absent or nonsensical: settlement
 * must never fail over a date, and an invented one would mis-bill a late fee.
 */
function submissionInstant(pi: Stripe.PaymentIntent): string | null {
  const seconds = Number(pi.created)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  const d = new Date(seconds * 1000)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function idsFromMetadata(pi: Stripe.PaymentIntent) {
  const m = pi.metadata ?? {}
  return {
    scheduledIds: (m.scheduledIds ?? '').split(',').filter(Boolean),
    specialIds: (m.specialIds ?? '').split(',').filter(Boolean),
    feeDollars: Number(m.feeCents ?? 0) / 100,
    /**
     * Late fees the tenant was charged on this intent, in dollars — the whole
     * payment's total, for display and reconciliation only.
     *
     * Settlement deliberately does not apply this figure anywhere: it is the
     * sum of `lateFeeRows`, and that loop applies each fee to the charge that
     * actually owed it. Writing this onto a rent row instead (as it once did)
     * books the same money twice and credits the wrong month.
     */
    lateFeeDollars: Number(m.lateFeeCents ?? 0) / 100,
    /**
     * Late fees paid *on their own*, as [chargeId, dollars] pairs.
     *
     * Two parallel comma-separated lists rather than JSON, because a Stripe
     * metadata value is capped at 500 characters and a dozen uuids with their
     * amounts does not reliably fit in one. The route caps the count so both
     * lists stay well inside the limit.
     *
     * The amount is carried rather than recomputed at settlement time on
     * purpose: what gets recorded must be what the tenant was actually
     * charged, and for a fee on unpaid rent a recomputation minutes later is a
     * different number.
     */
    lateFeeRows: zipLateFees(m.lateFeeIds ?? '', m.lateFeeAmounts ?? ''),
    method: m.method === 'ach' ? ('ach' as const) : ('card' as const),
    userId: (m.userId ?? '') as string,
  }
}

export type LateFeeRow = { id: string; amount: number }

/** Pair the id and amount lists, dropping anything that does not line up. */
function zipLateFees(ids: string, amounts: string): LateFeeRow[] {
  const idList = ids.split(',').filter(Boolean)
  const amountList = amounts.split(',').filter(Boolean)
  const out: LateFeeRow[] = []
  for (let i = 0; i < idList.length; i++) {
    const amount = Number(amountList[i])
    // A malformed pair is skipped rather than guessed at. Charging money we
    // cannot attribute to a charge is worse than failing to record it.
    if (!Number.isFinite(amount) || amount <= 0) {
      console.error('[rent] late fee metadata malformed for charge', idList[i])
      continue
    }
    out.push({ id: idList[i], amount: Math.round(amount * 100) / 100 })
  }
  return out
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
 *
 * Emails go out only on the *transition* into the new status — a second run
 * finds every row already there and stays quiet — and even then the send is
 * claimed in the database, because the webhook and the browser's confirm call
 * can arrive at the same instant.
 */
export async function settleRentPayment(
  db: DB,
  pi: Stripe.PaymentIntent,
  status: 'paid' | 'processing'
): Promise<{
  scheduled: number
  special: number
  /** Fee-only collections applied by this run. */
  lateFees: number
  /** Their total, in dollars. */
  lateFeeTotal: number
  conflicts: string[]
}> {
  const { scheduledIds, specialIds, feeDollars, lateFeeRows, method } =
    idsFromMetadata(pi)
  const paidDate = new Date().toISOString().split('T')[0]
  // `paid_date` is a DATE, so it loses the time of day. A landlord reconciling
  // a bank statement needs the instant, so record it alongside — and only when
  // the money actually landed, never for an ACH debit still in flight.
  const settledAt = status === 'paid' ? new Date().toISOString() : null
  // When the tenant actually pressed pay. Stripe's `created` on the intent, not
  // this run's clock: this function runs again when an ACH debit clears days
  // later, and `new Date()` there is the bank's date, not the tenant's.
  //
  // This is the date every late fee is judged against — see `lateFeeAsOf`. It
  // is written on the `processing` pass as well, which is the point: the fee
  // freezes the moment the debit is sent instead of climbing while it clears.
  //
  // Guarded rather than trusted: if the instant is missing or unparseable we
  // write null and the row falls back to `paid_date`, which is the behaviour
  // from before this column existed. A wrong submission date is worse than
  // none — it would silently forgive or invent a late fee.
  const submittedAt = submissionInstant(pi)

  let feeApplied = false
  let scheduled = 0
  let special = 0
  // Rows already settled by a *different* intent: the tenant has been charged
  // twice for the same rent. We must not overwrite the first payment's record,
  // and somebody needs to refund the second — so say so rather than swallow it.
  const conflicts: string[] = []
  // Rows this run actually moved into `status`. Empty on a repeat run, which is
  // what keeps the landlord from being emailed twice for one payment.
  const movedScheduled: string[] = []
  const movedSpecial: string[] = []
  // `paid` is worth announcing even from `processing` — the ACH debit cleared.
  const isTransition = (prev: string | null) =>
    status === 'paid' ? prev !== 'paid' : prev !== 'processing' && prev !== 'paid'

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
      settled_at: settledAt,
      submitted_at: submittedAt,
      // Deliberately no late-fee column here. A rent row carries *no* fee money:
      // paying rent and paying a late fee have been separate selections since
      // fees became their own charge, so everything in `lateFeeCents` belongs to
      // the charges in `lateFeeRows` and is applied by that loop below.
      //
      // Writing it here as well counted the same money twice in the landlord's
      // collected total, and attributed it to a month that was never charged a
      // fee. Worse, it *overwrote* `late_fee_paid` — so settling a charge's rent
      // after its fee had already been paid wiped that collected fee, putting it
      // back on the tenant. `late_fee_paid` is the authoritative running total;
      // only the claim loop may touch it.
    }).eq('id', id)
    if (isTransition(row.status)) movedScheduled.push(id)
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
      settled_at: settledAt,
      submitted_at: submittedAt,
    }).eq('id', id)
    if (isTransition(row.status)) movedSpecial.push(id)
    feeApplied = true
    special++
  }

  // ── Late fees paid on their own ────────────────────────────────────────
  //
  // These charges are usually settled already — the fee froze when the rent
  // landed and was never asked for — so nothing about the rent may be touched
  // here. Only the fee moves.
  let lateFeesApplied = 0
  let lateFeeTotal = 0
  /** The fees this run applied, for the notification. Empty on a repeat run. */
  const appliedLateFees: { id: string; amount: number }[] = []
  // The surcharge rides on the first fee row when the payment carried no rent
  // at all, so a fee-only payment still records what it cost to send.
  let lateFeeSurchargeLeft = scheduled === 0 && special === 0 ? feeDollars : 0

  for (const row of lateFeeRows) {
    const { data: charge } = await db
      .from('scheduled_payments')
      .select('id, plan_id, late_fee_paid')
      .eq('id', row.id)
      .maybeSingle()
    if (!charge) continue

    // The claim. Unique on (charge, intent), so the webhook and the browser's
    // confirm call race safely: the loser's insert fails and it applies nothing.
    const { error: claimErr } = await db.from('late_fee_payments').insert({
      scheduled_payment_id: row.id,
      plan_id: charge.plan_id,
      stripe_payment_intent_id: pi.id,
      amount: row.amount,
      processing_fee: lateFeeSurchargeLeft,
      method,
      status,
      settled_at: settledAt,
    })

    if (claimErr) {
      // 23505 = unique violation: this charge/intent pair is already claimed.
      if (claimErr.code !== '23505') {
        console.error('[rent] late fee claim failed', row.id, claimErr.message)
        continue
      }

      // An ACH debit claims the fee while it is still clearing, and that claim
      // deliberately adds nothing to `late_fee_paid` — the money has not landed.
      // When it does land we arrive here, blocked by our own `processing` claim,
      // so the claim has to be *promoted* or the fee is never recorded at all:
      // Stripe has the money, the landlord's books do not, and the tenant keeps
      // being chased for a fee they already paid.
      //
      // The promotion is the claim: `.eq('status', 'processing')` means only one
      // caller can move the row, so the webhook and the browser's confirm call
      // still race safely and only the winner counts the money.
      if (status !== 'paid') continue
      const { data: promoted } = await db
        .from('late_fee_payments')
        .update({ status: 'paid', settled_at: settledAt })
        .eq('scheduled_payment_id', row.id)
        .eq('stripe_payment_intent_id', pi.id)
        .eq('status', 'processing')
        .select('id')
      if (!promoted || promoted.length === 0) continue
    } else {
      lateFeeSurchargeLeft = 0
    }

    // Only now is the money ours to count. `late_fee_paid` is the running
    // total every landlord total reads, so it is incremented rather than
    // overwritten — the row may already hold fee money from its own rent
    // payment.
    //
    // An ACH debit still clearing is deliberately *not* added: a fee that has
    // not landed must not read as collected. The bounce-or-clear webhook
    // revisits it.
    if (status === 'paid') {
      const next = Math.round((Number(charge.late_fee_paid ?? 0) + row.amount) * 100) / 100
      const { error: bumpErr } = await db
        .from('scheduled_payments')
        .update({ late_fee_paid: next })
        .eq('id', row.id)
      if (bumpErr) {
        console.error('[rent] late fee total not updated', row.id, bumpErr.message)
        continue
      }
    }

    lateFeesApplied++
    lateFeeTotal = Math.round((lateFeeTotal + row.amount) * 100) / 100
    appliedLateFees.push({ id: row.id, amount: row.amount })
  }

  if (conflicts.length > 0) {
    console.error('[rent] DUPLICATE PAYMENT — intent', pi.id, 'covers rows already paid:', conflicts)
  }

  // The landlord's payments log. Written on every pass, including the repeat
  // runs that move nothing, because the row is keyed on the intent and the
  // second pass is what turns "clearing" into "cleared".
  await recordPaymentAttempt({
    db, pi, status: status === 'paid' ? 'cleared' : 'processing',
    method, surcharge: feeDollars,
    scheduledIds, specialIds, lateFeeRows, submittedAt,
  })

  // A fee-only payment moves no rent row, so the old condition stayed silent
  // and the landlord was never told the money had arrived. The fees this run
  // actually applied count as news in their own right.
  const movedLateFees = appliedLateFees
  if (movedScheduled.length > 0 || movedSpecial.length > 0 || movedLateFees.length > 0) {
    await notifyRentPayment({
      db,
      pi,
      event: status,
      method,
      fee: feeDollars,
      rows: await rowsForIntent(db, movedScheduled, movedSpecial, movedLateFees),
    })
  }

  return { scheduled, special, lateFees: lateFeesApplied, lateFeeTotal, conflicts }
}

/**
 * An ACH debit that fails after the fact puts the charge back on the tenant.
 *
 * A bounce is its own news: the landlord was told the money was on its way, so
 * they need to hear that it isn't. Only rows that were actually showing as
 * settled count — reverting an already-pending row is a no-op and says nothing.
 */
export async function revertRentPayment(db: DB, pi: Stripe.PaymentIntent) {
  const { scheduledIds, specialIds, feeDollars, lateFeeRows, method } = idsFromMetadata(pi)

  const revertedScheduled: string[] = []
  const revertedSpecial: string[] = []

  // A fee paid on its own, now bounced. Take it back off the running total and
  // drop the claim, so the fee shows as outstanding again and a later retry can
  // be applied afresh. Keyed on this intent, so a fee collected by some *other*
  // payment on the same charge is untouched.
  for (const row of lateFeeRows) {
    const { data: claim } = await db
      .from('late_fee_payments')
      .select('id, amount, status')
      .eq('scheduled_payment_id', row.id)
      .eq('stripe_payment_intent_id', pi.id)
      .maybeSingle()
    if (!claim) continue

    // Only money that was actually counted comes back off. A claim still in
    // `processing` never reached `late_fee_paid` in the first place.
    if (claim.status === 'paid') {
      const { data: charge } = await db
        .from('scheduled_payments')
        .select('late_fee_paid')
        .eq('id', row.id)
        .maybeSingle()
      if (charge) {
        const next = Math.max(
          0,
          Math.round((Number(charge.late_fee_paid ?? 0) - Number(claim.amount)) * 100) / 100,
        )
        await db.from('scheduled_payments').update({ late_fee_paid: next }).eq('id', row.id)
      }
    }

    await db.from('late_fee_payments').delete().eq('id', claim.id)
    console.warn('[rent] late fee payment reverted', row.id, 'intent', pi.id)
  }

  for (const id of scheduledIds) {
    const { data } = await db.from('scheduled_payments').update({
      status: 'pending', paid_amount: 0, paid_date: null,
      payment_method: null, recorded_by: null, processing_fee: 0,
      settled_at: null,
      // The grace the submission bought is withdrawn with it. While the debit
      // was in flight its late fee was frozen at the day the tenant sent it;
      // the money never arrived, so there is nothing to have been on time, and
      // the fee resumes accruing from the due date as if it had never been
      // submitted. Leaving this set would hand a tenant a permanent amnesty for
      // a payment that bounced.
      submitted_at: null,
      // `late_fee_paid` is deliberately left alone. This payment's rent is what
      // bounced; no rent payment records fee money any more, so there is nothing
      // of this intent's to take back here. Any fee money sitting on the row was
      // collected by a *separate* fee payment, and zeroing it destroyed that
      // record — the landlord lost the money from their books and the tenant was
      // billed for the fee a second time. Fees this intent did collect are
      // reversed by the claim loop above, by their own recorded amount.
    }).eq('id', id).eq('stripe_payment_intent_id', pi.id)
      .in('status', ['paid', 'processing'])
      .select('id')
    if (data && data.length > 0) revertedScheduled.push(id)
  }
  for (const id of specialIds) {
    const { data } = await db.from('special_payments').update({
      status: 'pending', paid_date: null,
      payment_method: null, recorded_by: null, processing_fee: 0,
      settled_at: null,
      submitted_at: null,
    }).eq('id', id).eq('stripe_payment_intent_id', pi.id)
      .in('status', ['paid', 'processing'])
      .select('id')
    if (data && data.length > 0) revertedSpecial.push(id)
  }

  // The bounce, recorded where the landlord can read it. Written even when no
  // row moved — a repeat webhook for a payment already reverted still belongs
  // in the log, and the row is keyed on the intent so it cannot be doubled.
  // This is the only record that the attempt ever happened: the charges it
  // touched have just been wiped clean of it.
  await recordPaymentAttempt({
    db, pi, status: 'failed', method, surcharge: feeDollars,
    scheduledIds, specialIds, lateFeeRows, submittedAt: submissionInstant(pi),
  })

  if (revertedScheduled.length > 0 || revertedSpecial.length > 0) {
    await notifyRentPayment({
      db,
      pi,
      event: 'failed',
      method,
      fee: feeDollars,
      rows: await rowsForIntent(db, revertedScheduled, revertedSpecial),
    })
  }
}

/** Stripe intent status → what the rent rows should read. */
export function statusForIntent(s: Stripe.PaymentIntent.Status): 'paid' | 'processing' | null {
  if (s === 'succeeded') return 'paid'
  if (s === 'processing') return 'processing'
  return null
}
