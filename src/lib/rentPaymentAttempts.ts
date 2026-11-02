// The history of a rent payment attempt, written beside the money it moved.
//
// Settlement already records *state*: the charge reads `paid`, or `processing`
// while an ACH debit clears. What it cannot record is a **story**, because a
// failure deletes itself — `revertRentPayment` resets the charge to pending and
// afterwards nothing says a payment was ever attempted (see the migration
// `20261102020000_rent_payment_attempts.sql` for why that matters).
//
// So every pass through settlement also writes one row per (plan, intent) here:
// submitted when the tenant pressed pay, cleared when the money landed, failed
// with the bank's own reason when it bounced. The landlord's payments log reads
// this; nothing here is a source of truth for a figure, so a write that fails
// is logged and swallowed — a missing log line must never cost a tenant their
// receipt or a landlord their rent.

import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'

type DB = SupabaseClient

export type AttemptStatus = 'processing' | 'cleared' | 'failed'

/** What one payment covered, as it was at the time. */
export type AttemptItem = {
  kind: 'rent' | 'charge' | 'late_fee'
  id: string
  label: string
  due_date: string | null
  amount: number
}

const money = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100

/** "October 2026 rent" — the label a landlord recognises on a statement. */
function rentLabel(dueDate: string): string {
  const d = new Date(dueDate + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return 'Rent'
  return `${d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} rent`
}

/**
 * Everything this intent was for, resolved from the rows it names.
 *
 * Read from the charges rather than from the intent's metadata because the
 * metadata carries ids and cents, and a log has to carry words: which month,
 * which charge, whose deposit.
 */
async function itemsForIntent(
  db: DB,
  ids: { scheduledIds: string[]; specialIds: string[]; lateFeeRows: { id: string; amount: number }[] },
): Promise<{ planId: string | null; items: AttemptItem[]; attempted: number }> {
  const items: AttemptItem[] = []
  let planId: string | null = null

  if (ids.scheduledIds.length > 0) {
    const { data } = await db
      .from('scheduled_payments')
      .select('id, plan_id, amount, due_date')
      .in('id', ids.scheduledIds)
    for (const r of data ?? []) {
      planId ??= r.plan_id as string
      items.push({
        kind: 'rent', id: r.id as string, label: rentLabel(r.due_date as string),
        due_date: r.due_date as string, amount: money(r.amount),
      })
    }
  }

  if (ids.specialIds.length > 0) {
    const { data } = await db
      .from('special_payments')
      .select('id, plan_id, amount, due_date, label')
      .in('id', ids.specialIds)
    for (const r of data ?? []) {
      planId ??= r.plan_id as string
      items.push({
        kind: 'charge', id: r.id as string, label: (r.label as string) || 'Charge',
        due_date: r.due_date as string, amount: money(r.amount),
      })
    }
  }

  if (ids.lateFeeRows.length > 0) {
    const { data } = await db
      .from('scheduled_payments')
      .select('id, plan_id, due_date')
      .in('id', ids.lateFeeRows.map(r => r.id))
    for (const r of data ?? []) {
      // The amount is what the tenant was actually charged, carried on the
      // intent — a late fee is derived and has no column to read it from.
      const paid = ids.lateFeeRows.find(x => x.id === r.id)
      if (!paid) continue
      planId ??= r.plan_id as string
      items.push({
        kind: 'late_fee', id: r.id as string,
        label: `Late fee — ${rentLabel(r.due_date as string)}`,
        due_date: r.due_date as string, amount: money(paid.amount),
      })
    }
  }

  const attempted = money(items.reduce((n, i) => n + i.amount, 0))
  return { planId, items, attempted }
}

/**
 * Record where this payment has got to.
 *
 * Idempotent by construction: the row is unique on (plan, intent), so the
 * webhook and the browser's confirm call write the same history whichever
 * arrives first, and the ACH pass that clears days later updates the row the
 * `processing` pass created rather than adding a second one.
 *
 * `cleared_at` and `failed_at` are only ever *set*, never cleared, because they
 * are observations. The one transition that rewrites status is processing →
 * cleared or processing → failed, which is the life of an ACH debit.
 */
export async function recordPaymentAttempt(input: {
  db: DB
  pi: Stripe.PaymentIntent
  status: AttemptStatus
  method: string
  /** Surcharge the tenant paid on top, in dollars. */
  surcharge: number
  scheduledIds: string[]
  specialIds: string[]
  lateFeeRows: { id: string; amount: number }[]
  /** When the tenant pressed pay, ISO. Null when the intent did not say. */
  submittedAt: string | null
}): Promise<void> {
  const { db, pi, status, method, surcharge, submittedAt } = input
  try {
    const { planId, items, attempted } = await itemsForIntent(db, input)
    // No rows means nothing to tell a story about — a stray webhook for an
    // intent whose charges have since been deleted.
    if (!planId || items.length === 0) return

    const now = new Date().toISOString()
    const failure = status === 'failed' ? pi.last_payment_error ?? null : null

    const { error } = await db
      .from('rent_payment_attempts')
      .upsert({
        plan_id: planId,
        payment_intent_id: pi.id,
        method,
        status,
        amount: attempted,
        surcharge: money(surcharge),
        submitted_at: submittedAt,
        cleared_at: status === 'cleared' ? now : null,
        failed_at: status === 'failed' ? now : null,
        failure_code: failure?.code ?? failure?.decline_code ?? null,
        failure_message: failure?.message ?? null,
        items,
        updated_at: now,
      }, {
        onConflict: 'plan_id,payment_intent_id',
        // A `processing` pass may arrive *after* the money landed — Stripe
        // retries webhooks, and the browser's confirm call races them — so it
        // only ever creates the row, never rewrites one. Clearing and failing
        // are terminal observations and do overwrite, which is how an ACH
        // debit's row moves from in-flight to its outcome.
        ignoreDuplicates: status === 'processing',
      })

    if (error) console.error('[rent] payment attempt not logged', pi.id, error.message)
  } catch (e) {
    // Never fatal. The money is already recorded on the charges; this is the
    // narrative beside it.
    console.error('[rent] payment attempt not logged', pi.id, e)
  }
}
