// Which Stripe account are we talking to?
//
// Live keys belong on Vercel production and nowhere else. Local development and
// preview deploys use the sandbox, so a mistake while building costs nothing —
// the failure this prevents is charging a real card while testing a form.
//
// Configure by suffixing the mode onto each variable:
//
//   STRIPE_SECRET_KEY_TEST / STRIPE_SECRET_KEY_LIVE
//   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST / ..._LIVE
//   STRIPE_WEBHOOK_SECRET_TEST / ..._LIVE
//   STRIPE_PRICE_PER_LEAD_TEST / ..._LIVE          (and the other three)
//
// Unsuffixed variables still work as a fallback, so nothing breaks before the
// split is finished — but a live-looking key is refused off production.

export type StripeMode = 'test' | 'live'

/**
 * Live only on Vercel production. Preview deploys and localhost stay on test,
 * which means a branch deploy can never take a real payment.
 *
 * `VERCEL_ENV` is set by Vercel on the server; `NEXT_PUBLIC_VERCEL_ENV` is the
 * build-time copy the browser can see. Anything else — localhost, CI, a
 * self-hosted box — is treated as test.
 */
export function stripeMode(): StripeMode {
  const env =
    process.env.VERCEL_ENV ||
    process.env.NEXT_PUBLIC_VERCEL_ENV ||
    ''
  if (env === 'production') return 'live'
  // Explicit override for the rare case of pointing a local run at live keys
  // deliberately (e.g. reproducing a production-only bug).
  if (process.env.STRIPE_FORCE_LIVE === 'true') return 'live'
  return 'test'
}

export const isLiveStripe = () => stripeMode() === 'live'

const looksLive = (key: string | undefined) => !!key && /_live_/.test(key)

/**
 * Server-side key resolution. Throws rather than silently falling back, because
 * a missing key surfacing as a confusing Stripe auth error is worse than a
 * clear one — and using a live key off production is refused outright.
 */
function resolve(name: string, testVal?: string, liveVal?: string, fallback?: string): string {
  const mode = stripeMode()
  const chosen = (mode === 'live' ? liveVal : testVal) ?? fallback

  if (!chosen) {
    throw new Error(
      `Stripe ${mode} mode: ${name}_${mode.toUpperCase()} is not set (and no ${name} fallback). ` +
      `Add it to ${mode === 'live' ? 'the Vercel production environment' : '.env.local'}.`
    )
  }
  if (mode === 'test' && looksLive(chosen)) {
    throw new Error(
      `Refusing to use a live Stripe key outside production (${name}). ` +
      `Put your sandbox key in ${name}_TEST, or set STRIPE_FORCE_LIVE=true if this is deliberate.`
    )
  }
  return chosen
}

export function stripeSecretKey(): string {
  return resolve(
    'STRIPE_SECRET_KEY',
    process.env.STRIPE_SECRET_KEY_TEST,
    process.env.STRIPE_SECRET_KEY_LIVE,
    process.env.STRIPE_SECRET_KEY
  )
}

export function stripeWebhookSecret(): string {
  return resolve(
    'STRIPE_WEBHOOK_SECRET',
    process.env.STRIPE_WEBHOOK_SECRET_TEST,
    process.env.STRIPE_WEBHOOK_SECRET_LIVE,
    process.env.STRIPE_WEBHOOK_SECRET
  )
}

export function stripePrices() {
  const live = isLiveStripe()
  const pick = (t?: string, l?: string, f?: string) => (live ? l : t) ?? f ?? ''
  return {
    perLead: pick(process.env.STRIPE_PRICE_PER_LEAD_TEST, process.env.STRIPE_PRICE_PER_LEAD_LIVE, process.env.STRIPE_PRICE_PER_LEAD),
    singleListing: pick(process.env.STRIPE_PRICE_SINGLE_LISTING_TEST, process.env.STRIPE_PRICE_SINGLE_LISTING_LIVE, process.env.STRIPE_PRICE_SINGLE_LISTING),
    twoListing: pick(process.env.STRIPE_PRICE_TWO_LISTING_TEST, process.env.STRIPE_PRICE_TWO_LISTING_LIVE, process.env.STRIPE_PRICE_TWO_LISTING),
    lifetime: pick(process.env.STRIPE_PRICE_LIFETIME_TEST, process.env.STRIPE_PRICE_LIFETIME_LIVE, process.env.STRIPE_PRICE_LIFETIME),
  }
}

/**
 * Publishable key for the browser.
 *
 * Every branch references `process.env.NEXT_PUBLIC_*` statically — Next.js
 * inlines these at build time and cannot resolve a computed name, so all three
 * are baked in and the choice happens at runtime.
 */
export function stripePublishableKey(): string | null {
  const live = isLiveStripe()
  const chosen = live
    ? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_LIVE
    : process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST
  const fallback = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  const key = chosen ?? fallback ?? null

  // Client-side we warn instead of throwing — a broken key shouldn't blank the
  // page, and the payment UI already handles a missing key gracefully.
  if (!live && key && /_live_/.test(key)) {
    console.warn('[stripe] live publishable key in test mode — check NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST')
  }
  return key
}
