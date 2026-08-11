import Stripe from 'stripe'
import { stripeSecretKey, stripeWebhookSecret } from '@/lib/stripeEnv'
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

function getStripe() { return new Stripe(stripeSecretKey()) }

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Apply a tenant rent payment to the rows it covers.
 *
 * The surcharge is recorded on the first row only — it's a processing cost the
 * tenant paid, not rent received, and spreading it would distort every row's
 * paid amount. `paid_amount` always equals the rent itself so the landlord's
 * ledger stays true.
 */
async function settleRentPayment(pi: Stripe.PaymentIntent, status: 'paid' | 'processing') {
  const m = pi.metadata ?? {}
  const scheduledIds = (m.scheduledIds ?? '').split(',').filter(Boolean)
  const specialIds = (m.specialIds ?? '').split(',').filter(Boolean)
  const feeDollars = Number(m.feeCents ?? 0) / 100
  const method = m.method === 'ach' ? 'ach' : 'card'
  const paidDate = new Date().toISOString().split('T')[0]

  let feeApplied = false

  for (const id of scheduledIds) {
    const { data: row } = await supabaseAdmin
      .from('scheduled_payments').select('amount, paid_amount').eq('id', id).maybeSingle()
    if (!row) continue
    await supabaseAdmin.from('scheduled_payments').update({
      status,
      paid_amount: status === 'paid' ? Number(row.amount) : Number(row.paid_amount ?? 0),
      paid_date: status === 'paid' ? paidDate : null,
      payment_method: method,
      recorded_by: 'tenant',
      processing_fee: feeApplied ? 0 : feeDollars,
      stripe_payment_intent_id: pi.id,
    }).eq('id', id)
    feeApplied = true
  }

  for (const id of specialIds) {
    await supabaseAdmin.from('special_payments').update({
      status,
      paid_date: status === 'paid' ? paidDate : null,
      payment_method: method,
      recorded_by: 'tenant',
      processing_fee: feeApplied ? 0 : feeDollars,
      stripe_payment_intent_id: pi.id,
    }).eq('id', id)
    feeApplied = true
  }
}

/** An ACH debit that fails after the fact puts the charge back on the tenant. */
async function revertRentPayment(pi: Stripe.PaymentIntent) {
  const m = pi.metadata ?? {}
  const scheduledIds = (m.scheduledIds ?? '').split(',').filter(Boolean)
  const specialIds = (m.specialIds ?? '').split(',').filter(Boolean)

  for (const id of scheduledIds) {
    await supabaseAdmin.from('scheduled_payments').update({
      status: 'pending', paid_amount: 0, paid_date: null,
      payment_method: null, recorded_by: null, processing_fee: 0,
    }).eq('id', id).eq('stripe_payment_intent_id', pi.id)
  }
  for (const id of specialIds) {
    await supabaseAdmin.from('special_payments').update({
      status: 'pending', paid_date: null,
      payment_method: null, recorded_by: null, processing_fee: 0,
    }).eq('id', id).eq('stripe_payment_intent_id', pi.id)
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const sig = req.headers.get('stripe-signature')
  if (!sig) return new Response('Missing signature', { status: 400 })

  const stripe = getStripe()
  let event: Stripe.Event
  try {
    // Signing secret differs per endpoint, so it follows the mode too — the
    // sandbox CLI listener and the production endpoint have different secrets.
    event = stripe.webhooks.constructEvent(rawBody, sig, stripeWebhookSecret())
  } catch (err: any) {
    console.error('Webhook signature failed:', err.message)
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  try {
    switch (event.type) {

      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent
        const { metadata } = pi

        if (metadata.type === 'per_lead') {
          const { leadId, landlordId } = metadata
          const { data: lead } = await supabaseAdmin
            .from('leads').select('id, property').eq('id', leadId).single()
          if (lead) {
            const { data: property } = await supabaseAdmin
              .from('properties').select('id').eq('slug', lead.property).single()
            if (property) {
              await supabaseAdmin.from('lead_unlocks').upsert({
                lead_id: leadId, listing_id: property.id,
                landlord_id: landlordId, unlock_type: 'per_lead',
                stripe_payment_intent_id: pi.id,
              }, { onConflict: 'lead_id,landlord_id' })
            }
          }
        }

        if (metadata.type === 'lifetime') {
          const { landlordId } = metadata
          const customerId = typeof pi.customer === 'string' ? pi.customer : (pi.customer as any)?.id ?? ''
          await supabaseAdmin.from('landlord_plans').upsert({
            landlord_id: landlordId, plan_type: 'lifetime',
            stripe_customer_id: customerId, status: 'active',
          }, { onConflict: 'landlord_id' })
        }

        if (metadata.type === 'rent_payment') {
          await settleRentPayment(pi, 'paid')
        }
        break
      }

      // ACH sits in flight for a few business days. The tenant has paid, so the
      // landlord shouldn't chase them — but it isn't money in the bank either.
      case 'payment_intent.processing': {
        const pi = event.data.object as Stripe.PaymentIntent
        if (pi.metadata?.type === 'rent_payment') await settleRentPayment(pi, 'processing')
        break
      }

      // A bounced ACH debit reverses the row so it shows as owing again.
      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent
        if (pi.metadata?.type === 'rent_payment') await revertRentPayment(pi)
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const landlordId = sub.metadata?.landlordId
        if (!landlordId) break
        const status = sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'past_due' : 'cancelled'
        await supabaseAdmin.from('landlord_plans').upsert({
          landlord_id: landlordId,
          plan_type: sub.metadata?.plan ?? 'single_listing',
          stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : (sub.customer as any).id,
          stripe_subscription_id: sub.id,
          status,
          current_period_end: new Date((sub as any).current_period_end * 1000).toISOString(),
        }, { onConflict: 'landlord_id' })
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const landlordId = sub.metadata?.landlordId
        if (!landlordId) break
        await supabaseAdmin
          .from('landlord_plans').update({ status: 'cancelled' })
          .eq('landlord_id', landlordId).eq('stripe_subscription_id', sub.id)
        // lead_unlock records are permanent — never removed on cancellation
        break
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err)
    return new Response('Internal error', { status: 500 })
  }

  return new Response('ok', { status: 200 })
}
