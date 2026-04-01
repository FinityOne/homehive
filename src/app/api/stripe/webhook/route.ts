import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

function getStripe() { return new Stripe(process.env.STRIPE_SECRET_KEY!) }

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
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!)
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
