import Stripe from 'stripe'
import { stripeSecretKey, stripeWebhookSecret } from '@/lib/stripeEnv'
import { createClient } from '@supabase/supabase-js'
import { settleRentPayment, revertRentPayment } from '@/lib/rentSettlement'
import { syncSubscription } from '@/lib/landlordPlanServer'
import { NextRequest } from 'next/server'

function getStripe() { return new Stripe(stripeSecretKey()) }

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

        if (metadata.type === 'rent_payment') {
          await settleRentPayment(supabaseAdmin, pi, 'paid')
        }
        break
      }

      // ACH sits in flight for a few business days. The tenant has paid, so the
      // landlord shouldn't chase them — but it isn't money in the bank either.
      case 'payment_intent.processing': {
        const pi = event.data.object as Stripe.PaymentIntent
        if (pi.metadata?.type === 'rent_payment') await settleRentPayment(supabaseAdmin, pi, 'processing')
        break
      }

      // A bounced ACH debit reverses the row so it shows as owing again.
      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent
        if (pi.metadata?.type === 'rent_payment') await revertRentPayment(supabaseAdmin, pi)
        break
      }

      // Checkout is how a landlord first pays. The success redirect confirms
      // the same session synchronously so the portal unlocks immediately; this
      // is the backstop for the landlord who closes the tab on the Stripe page
      // after paying.
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode !== 'subscription') break
        const landlordId = session.client_reference_id ?? session.metadata?.landlordId
        const plan = session.metadata?.plan
        const subId = typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id
        if (!landlordId || !plan || !subId) break
        const sub = await stripe.subscriptions.retrieve(subId)
        await syncSubscription(supabaseAdmin, landlordId, plan, sub)
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const landlordId = sub.metadata?.landlordId
        if (!landlordId) break
        // The tier lives on the subscription, set when it was created or last
        // changed. Falling back to what is already on the row keeps a renewal
        // from quietly demoting somebody.
        const { data: current } = await supabaseAdmin
          .from('landlord_plans').select('plan_type').eq('landlord_id', landlordId).maybeSingle()
        const plan = sub.metadata?.plan ?? current?.plan_type ?? 'starter'
        await syncSubscription(supabaseAdmin, landlordId, plan, sub)
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const landlordId = sub.metadata?.landlordId
        if (!landlordId) break
        await supabaseAdmin
          .from('landlord_plans').update({ status: 'cancelled' })
          .eq('landlord_id', landlordId).eq('stripe_subscription_id', sub.id)
        break
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err)
    return new Response('Internal error', { status: 500 })
  }

  return new Response('ok', { status: 200 })
}
