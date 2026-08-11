import Stripe from 'stripe'
import { stripeSecretKey } from '@/lib/stripeEnv'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function getStripe() { return new Stripe(stripeSecretKey()) }

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(_req: Request) {
  // Auth check
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Check slot availability
  const { data: slots } = await supabaseAdmin
    .from('lifetime_slots')
    .select('total_slots, slots_used')
    .single()

  if (!slots) return Response.json({ error: 'Slot data unavailable' }, { status: 500 })

  if (slots.slots_used >= slots.total_slots) {
    return Response.json({ error: 'sold_out' }, { status: 409 })
  }

  const slotsRemaining = slots.total_slots - slots.slots_used

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

  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount: 29900, // $299
      currency: 'usd',
      customer: customerId,
      automatic_payment_methods: { enabled: true },
      metadata: { landlordId: user.id, type: 'lifetime' },
    },
    { idempotencyKey: `lifetime_${user.id}` }
  )

  return Response.json({ clientSecret: paymentIntent.client_secret, slotsRemaining })
}
