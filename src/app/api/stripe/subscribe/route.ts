import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function getStripe() { return new Stripe(process.env.STRIPE_SECRET_KEY!) }

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PRICE_MAP = {
  single_listing: process.env.STRIPE_PRICE_SINGLE_LISTING!,
  two_listing: process.env.STRIPE_PRICE_TWO_LISTING!,
}

export async function POST(req: Request) {
  const { plan, listingIds } = await req.json() as {
    plan: 'single_listing' | 'two_listing'
    listingIds: string[]
  }

  if (!plan || !PRICE_MAP[plan]) return Response.json({ error: 'Invalid plan' }, { status: 400 })

  // Auth check
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify all listings belong to this landlord
  if (listingIds && listingIds.length > 0) {
    const { data: owned } = await supabaseAdmin
      .from('properties')
      .select('id')
      .in('id', listingIds)
      .eq('owner_id', user.id)
    if (!owned || owned.length !== listingIds.length) {
      return Response.json({ error: 'Forbidden: listing mismatch' }, { status: 403 })
    }
  }

  const stripe = getStripe()

  // Get or create Stripe customer
  const { data: existingPlan } = await supabaseAdmin
    .from('landlord_plans')
    .select('stripe_customer_id')
    .eq('landlord_id', user.id)
    .maybeSingle()

  let customerId: string

  if (existingPlan?.stripe_customer_id) {
    customerId = existingPlan.stripe_customer_id
  } else {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { landlordId: user.id, email: user.email ?? '' },
    })
    customerId = customer.id
  }

  // Create subscription
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: PRICE_MAP[plan] }],
    payment_behavior: 'default_incomplete',
    expand: ['latest_invoice.payment_intent'],
  })

  // latest_invoice is expanded — access payment_intent via cast
  const invoice = subscription.latest_invoice as Stripe.Invoice & { payment_intent?: Stripe.PaymentIntent }
  const paymentIntent = invoice.payment_intent as Stripe.PaymentIntent

  // Upsert landlord_plans
  await supabaseAdmin.from('landlord_plans').upsert({
    landlord_id: user.id,
    plan_type: plan,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    covered_listing_ids: listingIds ?? [],
    status: 'active',
    current_period_end: new Date((subscription as any).current_period_end * 1000).toISOString(),
  }, { onConflict: 'landlord_id' })

  return Response.json({
    subscriptionId: subscription.id,
    clientSecret: paymentIntent.client_secret,
  })
}
