/**
 * POST /api/tenant/pay/confirm
 *
 * The browser tells us it finished a payment; we ask Stripe what actually
 * happened and update the rent rows to match.
 *
 * The webhook remains the source of truth — this route exists because the
 * webhook is asynchronous, and a tenant who has just paid should not reload
 * their page into "still owing". It also covers two cases the webhook can't:
 * a local run with no `stripe listen` forwarding, and a card that came back
 * through a 3-D Secure redirect.
 *
 * Nothing here trusts the client beyond the intent id. The amount, the status
 * and the rows covered all come from Stripe's copy of the intent, and the
 * intent must carry this tenant's user id in its metadata.
 *
 * Body: { paymentIntentId?: string, clientSecret?: string }
 */
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { stripeSecretKey } from '@/lib/stripeEnv'
import { settleRentPayment, revertRentPayment, statusForIntent, idsFromMetadata } from '@/lib/rentSettlement'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  // A client secret is `pi_xxx_secret_yyy` — the id is everything before it.
  const id: string =
    body.paymentIntentId ||
    (typeof body.clientSecret === 'string' ? body.clientSecret.split('_secret_')[0] : '')
  if (!id.startsWith('pi_')) {
    return Response.json({ error: 'No payment to confirm.' }, { status: 400 })
  }

  let pi: Stripe.PaymentIntent
  try {
    pi = await new Stripe(stripeSecretKey()).paymentIntents.retrieve(id)
  } catch (e) {
    console.error('[tenant/pay/confirm] retrieve failed', e)
    return Response.json({ error: 'Could not check that payment.' }, { status: 502 })
  }

  if (pi.metadata?.type !== 'rent_payment') {
    return Response.json({ error: 'Not a rent payment.' }, { status: 400 })
  }
  // The intent records who it was created for; only they may settle it.
  if (idsFromMetadata(pi).userId !== user.id) {
    return Response.json({ error: 'That payment isn\'t yours.' }, { status: 403 })
  }

  const status = statusForIntent(pi.status)

  if (status) {
    const applied = await settleRentPayment(supabaseAdmin, pi, status)
    // Every row was already paid by another intent — this is a second charge
    // for rent that is settled. The tenant is owed a refund.
    if (applied.conflicts.length > 0 && applied.scheduled === 0 && applied.special === 0) {
      return Response.json({
        status: 'duplicate',
        // Logged as an error server-side; there is no landlord alert yet
        // (MAH-40), so don't promise the tenant one.
        message: 'This rent was already paid — this looks like a duplicate charge. Contact your landlord for a refund.',
      })
    }
    return Response.json({ status, applied: { scheduled: applied.scheduled, special: applied.special } })
  }

  // `requires_payment_method` after an attempt means the charge was declined or
  // an ACH debit bounced — put the rows back so they read as owing again.
  if (pi.status === 'requires_payment_method' || pi.status === 'canceled') {
    await revertRentPayment(supabaseAdmin, pi)
    return Response.json({ status: 'failed' })
  }

  // Still mid-flow (3DS pending, etc.) — leave the rows alone.
  return Response.json({ status: 'pending', stripeStatus: pi.status })
}
