// What a landlord pays to be on HomeHive.
//
// One axis only: how many properties you can have live. Not leads, not rooms
// filled, not a percentage of rent. A landlord deciding whether to sign up has
// to hold exactly one number in their head — the number of doors they manage —
// and the price follows from it. Every tier is the whole product; paying more
// never unlocks a feature, only more properties.
//
// This file is the single source of truth for tier → price → limit. The Stripe
// product catalogue is derived from it at runtime (see api/stripe/checkout),
// the database mirrors the limits in `landlord_property_limit()`, and the UI
// reads the labels straight from here. Changing a price means changing it here
// and bumping the lookup key, nothing else.

export type PlanTier = 'starter' | 'growth' | 'unlimited'

/**
 * Plans sold before the self-serve launch. Nobody can buy these any more, but
 * the rows still exist and those landlords keep what they paid for.
 */
export type LegacyPlanType = 'per_lead' | 'single_listing' | 'two_listing' | 'lifetime' | 'legacy_free'

/** Everything `landlord_plans.plan_type` can legally hold, new tiers and old. */
export type PlanType = PlanTier | LegacyPlanType

export type PlanStatus = 'active' | 'past_due' | 'cancelled'

/** Stands in for "no ceiling". Large enough to never bind, small enough for int4. */
export const UNLIMITED_PROPERTIES = 2_147_483_647

export type PlanDefinition = {
  tier: PlanTier
  name: string
  /** Monthly price in cents — the number Stripe charges. */
  priceCents: number
  /** Properties a landlord on this tier may have at once. */
  propertyLimit: number
  /** The one-line reason to pick this tier over the one below it. */
  tagline: string
  /** Who this is for, in their own words. */
  audience: string
  features: string[]
  /**
   * Stripe `lookup_key`. Versioned: a price is immutable once created, so a
   * price change needs a new key rather than an edit.
   */
  lookupKey: string
  highlight?: boolean
}

export const PLANS: Record<PlanTier, PlanDefinition> = {
  starter: {
    tier: 'starter',
    name: 'Starter',
    priceCents: 1999,
    propertyLimit: 1,
    tagline: 'One property, fully managed.',
    audience: 'You own a single house, condo, or unit near campus.',
    lookupKey: 'homehive_landlord_starter_v1',
    features: [
      'One live property listing',
      'Unlimited inquiries and leads',
      'Tenant screening and background checks',
      'Tours, calendar, and messaging',
      'Leases, documents, and e-signature',
      'Online rent collection',
      'Maintenance and move-out tracking',
    ],
  },
  growth: {
    tier: 'growth',
    name: 'Growth',
    priceCents: 4999,
    propertyLimit: 5,
    tagline: 'Up to five properties on one account.',
    audience: 'You run a small portfolio and want it all in one dashboard.',
    lookupKey: 'homehive_landlord_growth_v1',
    highlight: true,
    features: [
      'Up to 5 live property listings',
      'Everything in Starter',
      'Portfolio-wide leads and financials',
      'Per-property performance reporting',
      'Bulk tenant and lease management',
      'Priority placement in search results',
    ],
  },
  unlimited: {
    tier: 'unlimited',
    name: 'Unlimited',
    priceCents: 19999,
    propertyLimit: UNLIMITED_PROPERTIES,
    tagline: 'Every property you own, no ceiling.',
    audience: 'You manage a real portfolio and never want to think about a cap.',
    lookupKey: 'homehive_landlord_unlimited_v1',
    features: [
      'Unlimited live property listings',
      'Everything in Growth',
      'Unlimited team seats on your account',
      'Automations and custom branding',
      'Priority support',
    ],
  },
}

/** Display order — cheapest first, which is how the pricing page reads. */
export const PLAN_ORDER: PlanTier[] = ['starter', 'growth', 'unlimited']

export const isPlanTier = (v: unknown): v is PlanTier =>
  typeof v === 'string' && v in PLANS

/**
 * How many properties a plan row allows.
 *
 * `override` is `landlord_plans.property_limit` — set for landlords who were on
 * the platform before it was paid, so going paid never took away a listing they
 * already had. It wins over the tier default when present.
 */
export function propertyLimitFor(planType: string | null | undefined, override?: number | null): number {
  if (override != null) return override
  if (!planType) return 0
  if (isPlanTier(planType)) return PLANS[planType].propertyLimit
  // Legacy plans, priced per listing before the tiers existed.
  switch (planType) {
    case 'lifetime':       return UNLIMITED_PROPERTIES
    case 'two_listing':    return 2
    case 'single_listing': return 1
    default:               return 0   // per_lead was never a listing plan
  }
}

/** A plan only grants portal access while it is being paid for. */
export function planGrantsAccess(planType: string | null | undefined, status: string | null | undefined): boolean {
  if (!planType) return false
  if (planType === 'per_lead') return false
  // past_due still gets in: the card failed, the landlord has not left. Locking
  // them out of their own tenants is how you turn a retry into a cancellation.
  return status === 'active' || status === 'past_due'
}

export function planDisplayName(planType: string | null | undefined): string {
  if (!planType) return 'No plan'
  if (isPlanTier(planType)) return PLANS[planType].name
  switch (planType) {
    case 'lifetime':       return 'Founding Member'
    case 'two_listing':    return 'Legacy — 2 listings'
    case 'single_listing': return 'Legacy — 1 listing'
    case 'legacy_free':    return 'Grandfathered'
    case 'per_lead':       return 'Pay per lead'
    default:               return planType
  }
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

/** "$19.99/mo" — the string the whole product uses so it never disagrees. */
export function formatMonthly(cents: number): string {
  return `${formatUsd(cents)}/mo`
}

export function formatPropertyLimit(limit: number): string {
  if (limit >= UNLIMITED_PROPERTIES) return 'Unlimited'
  return String(limit)
}

/** The cheapest tier that fits a landlord who already has `count` properties. */
export function smallestTierFor(count: number): PlanTier {
  return PLAN_ORDER.find(t => PLANS[t].propertyLimit >= count) ?? 'unlimited'
}
