import Stripe from 'stripe'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  PLANS,
  type PlanTier,
  propertyLimitFor,
  planGrantsAccess,
} from '@/lib/landlordPlans'

/**
 * Server-side plumbing for landlord plans: reading the plan a landlord is on,
 * counting what they have, and making sure Stripe has a price to charge.
 *
 * Every plan decision in the app funnels through `loadPlanState` so the answer
 * is the same whether it is asked by the portal gate, the checkout route or the
 * property creator.
 */

export function supabaseAdmin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export type PlanRow = {
  plan_type: string
  status: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  current_period_end: string | null
  property_limit: number | null
}

export type PlanState = {
  plan: PlanRow | null
  /** True when the landlord may use the portal at all. */
  hasAccess: boolean
  /** Live (non-archived) properties they own right now. */
  propertyCount: number
  /** How many they are allowed. 0 when they have no plan. */
  propertyLimit: number
  /** Whether one more would fit. */
  canAddProperty: boolean
}

const PLAN_COLUMNS =
  'plan_type, status, stripe_customer_id, stripe_subscription_id, current_period_end, property_limit'

/** The same query without `property_limit`, for a database that predates it. */
const PLAN_COLUMNS_LEGACY =
  'plan_type, status, stripe_customer_id, stripe_subscription_id, current_period_end'

/**
 * Read the plan row, surviving a database that has not run the migration yet.
 *
 * If `property_limit` is missing, PostgREST fails the whole select — which
 * would read as "no plan" and bounce every landlord on the platform to the
 * paywall. One retry without that column turns a site-wide outage into a
 * missing override nobody has set anyway.
 */
async function readPlanRow(db: SupabaseClient, landlordId: string): Promise<PlanRow | null> {
  const { data, error } = await db
    .from('landlord_plans').select(PLAN_COLUMNS).eq('landlord_id', landlordId).maybeSingle()

  if (!error) return (data as PlanRow | null) ?? null

  if (error.code === '42703' || /property_limit/.test(error.message ?? '')) {
    console.warn('[plans] landlord_plans.property_limit is missing — run the self-serve migration')
    const { data: legacy } = await db
      .from('landlord_plans').select(PLAN_COLUMNS_LEGACY).eq('landlord_id', landlordId).maybeSingle()
    return legacy ? { ...(legacy as Omit<PlanRow, 'property_limit'>), property_limit: null } : null
  }

  console.error('[plans] could not read landlord_plans:', error)
  return null
}

export async function loadPlanState(db: SupabaseClient, landlordId: string): Promise<PlanState> {
  const [row, { count }] = await Promise.all([
    readPlanRow(db, landlordId),
    db.from('properties').select('id', { count: 'exact', head: true })
      .eq('owner_id', landlordId).is('archived_at', null),
  ])
  const hasAccess = planGrantsAccess(row?.plan_type, row?.status)
  const propertyCount = count ?? 0
  // No access means no allowance, even if an old row carries a stale limit.
  const propertyLimit = hasAccess ? propertyLimitFor(row?.plan_type, row?.property_limit) : 0

  return {
    plan: row,
    hasAccess,
    propertyCount,
    propertyLimit,
    canAddProperty: propertyCount < propertyLimit,
  }
}

/**
 * The Stripe Price for a tier, created on first use.
 *
 * Deriving the catalogue from `PLANS` rather than from four more environment
 * variables per mode is what makes this work in a fresh sandbox and in live
 * without anyone wiring price IDs by hand. `lookup_key` is unique per account,
 * so this is idempotent: the first call creates, every later call finds.
 */
export async function ensurePrice(stripe: Stripe, tier: PlanTier): Promise<string> {
  const def = PLANS[tier]

  const existing = await stripe.prices.list({
    lookup_keys: [def.lookupKey],
    active: true,
    limit: 1,
    expand: ['data.product'],
  })
  if (existing.data[0]) return existing.data[0].id

  // Reuse the product across price versions so a price change does not litter
  // the dashboard with near-identical products.
  const products = await stripe.products.search({
    query: `metadata['homehive_tier']:'${tier}'`,
    limit: 1,
  })
  const product =
    products.data[0] ??
    (await stripe.products.create({
      name: `HomeHive ${def.name}`,
      description: def.tagline,
      metadata: { homehive_tier: tier },
    }))

  const price = await stripe.prices.create({
    product: product.id,
    currency: 'usd',
    unit_amount: def.priceCents,
    recurring: { interval: 'month' },
    lookup_key: def.lookupKey,
    metadata: { homehive_tier: tier },
  })
  return price.id
}

/** The landlord's Stripe customer, reused across checkout, portal and upgrades. */
export async function ensureCustomer(
  stripe: Stripe,
  db: SupabaseClient,
  user: { id: string; email?: string | null }
): Promise<string> {
  const { data } = await db
    .from('landlord_plans')
    .select('stripe_customer_id')
    .eq('landlord_id', user.id)
    .maybeSingle()

  if (data?.stripe_customer_id) return data.stripe_customer_id

  const customer = await stripe.customers.create({
    email: user.email ?? undefined,
    metadata: { landlordId: user.id },
  })
  return customer.id
}

/**
 * Write a subscription's current state onto the landlord's plan row.
 *
 * Called from the webhook and from the post-checkout confirm, which is
 * deliberate belt-and-braces: a landlord who has just paid should see their
 * portal unlock on the redirect, not whenever the webhook lands.
 */
export async function syncSubscription(
  db: SupabaseClient,
  landlordId: string,
  tier: string,
  sub: Stripe.Subscription
): Promise<void> {
  const status =
    sub.status === 'active' || sub.status === 'trialing' ? 'active'
    : sub.status === 'past_due' || sub.status === 'unpaid' ? 'past_due'
    : 'cancelled'

  const periodEnd =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    sub.items.data[0]?.current_period_end

  await db.from('landlord_plans').upsert({
    landlord_id: landlordId,
    plan_type: tier,
    status,
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    stripe_subscription_id: sub.id,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    // A paid tier gets the tier's own allowance — this clears any grandfathered
    // override, which is the point of upgrading.
    property_limit: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'landlord_id' })
}
