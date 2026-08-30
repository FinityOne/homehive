/**
 * GET /api/stripe/health
 *
 * "Is rent collection actually wired up in this environment?" — answered by
 * calling Stripe rather than by reading env vars, because a key that is present
 * and a key that works are different things.
 *
 * Sandbox only. In live mode this returns 404: a public probe that confirms
 * which Stripe account a production site talks to is not worth the convenience.
 * No key material is ever returned — only whether each one resolved.
 */
import Stripe from 'stripe'
import { isLiveStripe, stripeMode, stripeSecretKey, stripeWebhookSecret, stripePublishableKey } from '@/lib/stripeEnv'

const ok = (fn: () => unknown) => { try { return !!fn() } catch { return false } }

export async function GET() {
  if (isLiveStripe()) return new Response('Not found', { status: 404 })

  const checks = {
    mode: stripeMode(),
    secretKey: ok(stripeSecretKey),
    webhookSecret: ok(stripeWebhookSecret),
    publishableKey: !!stripePublishableKey(),
    resendApiKey: !!process.env.RESEND_API_KEY,
    supabaseServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  }

  let account: { id: string; name: string | null; chargesEnabled: boolean } | null = null
  let stripeError: string | null = null
  let achEnabled: boolean | null = null

  if (checks.secretKey) {
    try {
      const stripe = new Stripe(stripeSecretKey())
      const acct = await stripe.accounts.retrieve()
      account = {
        id: acct.id,
        name: acct.settings?.dashboard?.display_name ?? acct.business_profile?.name ?? null,
        chargesEnabled: !!acct.charges_enabled,
      }
      // ACH is a per-account opt-in; a tenant picking "bank transfer" against an
      // account without it gets an error at confirm time, which is far too late.
      achEnabled = acct.capabilities?.us_bank_account_ach_payments === 'active'
    } catch (e) {
      stripeError = e instanceof Error ? e.message : 'Stripe call failed'
    }
  }

  const ready = checks.secretKey && checks.publishableKey && !!account && !stripeError

  return Response.json({
    ready,
    checks,
    account,
    achEnabled,
    stripeError,
    notes: [
      checks.webhookSecret
        ? 'Webhook secret set. Run: stripe listen --forward-to localhost:3100/api/stripe/webhook'
        : 'No webhook secret — payments still settle via /api/tenant/pay/confirm, but ACH status changes will not.',
      achEnabled === false
        ? 'ACH is not enabled on this Stripe account — bank transfer will fail; enable us_bank_account_ach_payments.'
        : null,
    ].filter(Boolean),
  })
}
