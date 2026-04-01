import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function getStripe() { return new Stripe(process.env.STRIPE_SECRET_KEY!) }

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const { leadId } = await req.json()

  if (!leadId) return Response.json({ error: 'leadId is required' }, { status: 400 })

  // Auth check
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify listing ownership
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, property')
    .eq('id', leadId)
    .single()

  if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 })

  const { data: property } = await supabaseAdmin
    .from('properties')
    .select('id, owner_id')
    .eq('slug', lead.property)
    .single()

  if (!property) return Response.json({ error: 'Property not found' }, { status: 404 })
  if (property.owner_id !== user.id) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const stripe = getStripe()
  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount: 199, // $1.99
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: { leadId, landlordId: user.id, type: 'per_lead' },
    },
    { idempotencyKey: `lead_${leadId}_${user.id}` }
  )

  return Response.json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id })
}
