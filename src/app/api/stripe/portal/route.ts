import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function getStripe() { return new Stripe(process.env.STRIPE_SECRET_KEY!) }

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  // Auth check
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const stripe = getStripe()
  const { data: plan } = await supabaseAdmin
    .from('landlord_plans')
    .select('stripe_customer_id')
    .eq('landlord_id', user.id)
    .single()

  if (!plan?.stripe_customer_id) {
    return Response.json({ error: 'No billing account found' }, { status: 404 })
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

  const session = await stripe.billingPortal.sessions.create({
    customer: plan.stripe_customer_id,
    return_url: `${siteUrl}/landlord/billing`,
  })

  return Response.json({ url: session.url })
}
