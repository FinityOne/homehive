import Stripe from 'stripe'
import { stripeSecretKey } from '@/lib/stripeEnv'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin, syncSubscription } from '@/lib/landlordPlanServer'
import { isPlanTier } from '@/lib/landlordPlans'

/**
 * Activate the plan the moment the landlord lands back from Stripe.
 *
 * The webhook does this too, and the webhook is the source of truth for
 * everything that happens later. But a landlord who has just typed in a card
 * number should not watch a spinner until an async event arrives — so the
 * redirect reads the session itself and writes the same row. Both paths upsert
 * the same key, so whichever lands second is a no-op.
 */
export async function POST(req: Request) {
  const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string }
  if (!sessionId) return Response.json({ error: 'Missing session' }, { status: 400 })

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const stripe = new Stripe(stripeSecretKey())

  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] })
  } catch {
    return Response.json({ error: 'That checkout session could not be found.' }, { status: 404 })
  }

  // A session id is a bearer-ish string that ends up in a URL. Refuse to act on
  // one that belongs to somebody else.
  if (session.client_reference_id !== user.id && session.metadata?.landlordId !== user.id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (session.payment_status !== 'paid' && session.status !== 'complete') {
    return Response.json({ pending: true })
  }

  const sub = session.subscription as Stripe.Subscription | null
  if (!sub || typeof sub === 'string') {
    return Response.json({ pending: true })
  }

  const tier = sub.metadata?.plan ?? session.metadata?.plan
  if (!isPlanTier(tier)) {
    console.error('[stripe] checkout session without a recognisable tier:', sessionId, tier)
    return Response.json({ error: 'Plan could not be identified.' }, { status: 500 })
  }

  await syncSubscription(supabaseAdmin(), user.id, tier, sub)

  return Response.json({ ok: true, plan: tier })
}
