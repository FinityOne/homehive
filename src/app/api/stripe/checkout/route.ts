import Stripe from 'stripe'
import { stripeSecretKey } from '@/lib/stripeEnv'
import { getSiteUrl } from '@/lib/siteUrl'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  supabaseAdmin,
  loadPlanState,
  ensurePrice,
  ensureCustomer,
  syncSubscription,
} from '@/lib/landlordPlanServer'
import { PLANS, isPlanTier, formatPropertyLimit } from '@/lib/landlordPlans'

/**
 * Start — or change — a landlord's subscription.
 *
 * Two shapes, one route, because from the landlord's side it is one action
 * ("put me on this plan") and which Stripe call it takes depends on state they
 * should not have to think about:
 *
 *   no subscription yet  → a Checkout Session; Stripe collects the card.
 *   already subscribed   → swap the price in place, prorated. No second card
 *                          entry, no second subscription to cancel later.
 */
export async function POST(req: Request) {
  const { plan } = (await req.json().catch(() => ({}))) as { plan?: string }

  if (!isPlanTier(plan)) {
    return Response.json({ error: 'Pick a valid plan.' }, { status: 400 })
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const db = supabaseAdmin()
  const state = await loadPlanState(db, user.id)
  const def = PLANS[plan]

  // Downgrading below what they already have would silently orphan listings.
  // Say so instead, and name the number — "archive 2 properties" is actionable
  // in a way that "plan limit exceeded" never is.
  if (state.propertyCount > def.propertyLimit) {
    return Response.json({
      error:
        `${def.name} covers ${formatPropertyLimit(def.propertyLimit)} ` +
        `propert${def.propertyLimit === 1 ? 'y' : 'ies'}, and you have ${state.propertyCount} live. ` +
        `Archive ${state.propertyCount - def.propertyLimit} first, or pick a larger plan.`,
    }, { status: 409 })
  }

  const stripe = new Stripe(stripeSecretKey())
  const siteUrl = getSiteUrl()

  let priceId: string
  try {
    priceId = await ensurePrice(stripe, plan)
  } catch (err) {
    console.error('[stripe] could not resolve price for', plan, err)
    return Response.json({ error: 'Billing is temporarily unavailable. Try again shortly.' }, { status: 502 })
  }

  // ── Already paying: swap the price on the live subscription ────────────────
  const existingSubId = state.hasAccess ? state.plan?.stripe_subscription_id : null
  if (existingSubId) {
    try {
      const current = await stripe.subscriptions.retrieve(existingSubId)
      if (current.status !== 'canceled' && current.status !== 'incomplete_expired') {
        if (current.items.data[0]?.price.id === priceId) {
          return Response.json({ alreadyOnPlan: true })
        }
        const updated = await stripe.subscriptions.update(existingSubId, {
          items: [{ id: current.items.data[0].id, price: priceId }],
          proration_behavior: 'always_invoice',
          cancel_at_period_end: false,
          metadata: { landlordId: user.id, plan },
        })
        await syncSubscription(db, user.id, plan, updated)
        return Response.json({ updated: true })
      }
    } catch (err) {
      // A subscription that Stripe no longer knows about (deleted in the
      // dashboard, or from the other mode's account) should not be a dead end —
      // fall through and sell them a new one.
      console.warn('[stripe] stale subscription on plan row, starting fresh:', err)
    }
  }

  // ── New subscription: hand off to Checkout ─────────────────────────────────
  const customerId = await ensureCustomer(stripe, db, user)

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: user.id,
    allow_promotion_codes: true,
    // On the subscription, not just the session: the webhook reads it on every
    // later renewal, cancellation and card failure.
    subscription_data: { metadata: { landlordId: user.id, plan } },
    metadata: { landlordId: user.id, plan },
    success_url: `${siteUrl}/landlord/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/landlord/subscribe?canceled=1`,
  })

  if (!session.url) {
    return Response.json({ error: 'Could not start checkout. Try again.' }, { status: 502 })
  }

  // Park the customer id now so a landlord who abandons checkout and comes back
  // is still the same Stripe customer rather than a duplicate.
  await db.from('landlord_plans').upsert({
    landlord_id: user.id,
    plan_type: state.plan?.plan_type ?? 'free',
    status: state.plan?.status ?? 'cancelled',
    stripe_customer_id: customerId,
    property_limit: state.plan?.property_limit ?? null,
  }, { onConflict: 'landlord_id' })

  return Response.json({ url: session.url })
}
