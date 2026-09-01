// What HomeHive actually earns on a payment.
//
// Three numbers get confused constantly, so they are named once here and never
// re-derived anywhere else:
//
//   volume  — everything that moved through Stripe. Mostly the landlord's rent.
//             It is not ours and it is not revenue.
//   fee     — the surcharge the payer paid on top (5% card / 2% ACH), or the
//             price of a plan or lead unlock. This is gross revenue.
//   net     — fee minus what Stripe charged us to move the money. This is the
//             only line that pays a salary.
//
// Stripe bills on the *whole* charge, not on our slice: a $2,000 rent payment
// costs us 2.9% of $2,100, not of the $100 surcharge. On card that is $61.20
// against a $100 fee — a 39% haircut. ACH is 0.8% capped at $5, so the same
// rent nets $35.16 of a $40 fee. Admins need to see that difference, which is
// why every aggregate below carries volume, fee, cost and net together.

function numEnv(name: string, fallback: number): number {
  const raw = typeof process !== 'undefined' ? process.env?.[name] : undefined
  const n = raw == null || raw === '' ? NaN : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

/** Stripe's US standard pricing, overridable once we negotiate a rate. */
export const STRIPE_RATES = {
  card: {
    /** 2.9% of the total charged… */
    pct: numEnv('STRIPE_COST_CARD_PCT', 0.029),
    /** …plus 30¢ per successful charge. */
    fixedCents: numEnv('STRIPE_COST_CARD_FIXED_CENTS', 30),
    capCents: null as number | null,
  },
  ach: {
    /** 0.8% of the total charged… */
    pct: numEnv('STRIPE_COST_ACH_PCT', 0.008),
    fixedCents: numEnv('STRIPE_COST_ACH_FIXED_CENTS', 0),
    /** …capped at $5.00 per charge. */
    capCents: numEnv('STRIPE_COST_ACH_CAP_CENTS', 500) as number | null,
  },
}

/** Every way money reaches us. The manual ones never touch Stripe. */
export type SettleMethod = 'card' | 'ach' | 'manual_zelle' | 'manual_other'

/** Where a dollar of gross revenue came from. */
export type RevenueSource = 'rent_card' | 'rent_ach' | 'subscription' | 'lifetime' | 'per_lead'

export const SOURCE_META: Record<RevenueSource, { label: string; short: string; color: string; group: 'rent' | 'saas' }> = {
  rent_card:    { label: 'Rent surcharge — card', short: 'Rent (card)', color: '#a78bfa', group: 'rent' },
  rent_ach:     { label: 'Rent surcharge — ACH',  short: 'Rent (ACH)',  color: '#38bdf8', group: 'rent' },
  subscription: { label: 'Landlord subscriptions', short: 'Subs',       color: '#10b981', group: 'saas' },
  lifetime:     { label: 'Lifetime deals',         short: 'Lifetime',   color: '#f59e0b', group: 'saas' },
  per_lead:     { label: 'Lead unlocks',           short: 'Unlocks',    color: '#3b82f6', group: 'saas' },
}

/**
 * What Stripe took out of one charge, in cents.
 *
 * `grossCents` is the full amount authorised — rent *plus* surcharge — because
 * that is what Stripe's percentage applies to. Anything settled off-platform
 * (Zelle, cash the landlord recorded) costs us nothing and earns us nothing.
 *
 * This is an estimate from published pricing, not a read of the balance
 * transaction. It is stable and instant, which is what a dashboard needs; the
 * monthly Stripe statement stays the number to reconcile against.
 */
export function stripeCostCents(grossCents: number, method: SettleMethod): number {
  if (method !== 'card' && method !== 'ach') return 0
  if (grossCents <= 0) return 0
  const r = STRIPE_RATES[method]
  const raw = Math.round(grossCents * r.pct) + r.fixedCents
  return r.capCents != null ? Math.min(raw, r.capCents) : raw
}

/** One settled payment, reduced to the numbers that matter. */
export type Economics = {
  /** Total that moved through the processor. */
  volumeCents: number
  /** Pass-through to the landlord — rent, deposits, late fees. Never ours. */
  passThroughCents: number
  /** Gross revenue: the surcharge, or the product price. */
  feeCents: number
  /** Estimated processor cost on the whole charge. */
  costCents: number
  /** feeCents − costCents. Goes negative on a tiny card charge. */
  netCents: number
}

export function economics(input: {
  passThroughCents: number
  feeCents: number
  method: SettleMethod
}): Economics {
  const volumeCents = input.passThroughCents + input.feeCents
  const costCents = stripeCostCents(volumeCents, input.method)
  return {
    volumeCents,
    passThroughCents: input.passThroughCents,
    feeCents: input.feeCents,
    costCents,
    netCents: input.feeCents - costCents,
  }
}

export const emptyEconomics = (): Economics => ({
  volumeCents: 0, passThroughCents: 0, feeCents: 0, costCents: 0, netCents: 0,
})

export function addEconomics(a: Economics, b: Economics): Economics {
  return {
    volumeCents:      a.volumeCents + b.volumeCents,
    passThroughCents: a.passThroughCents + b.passThroughCents,
    feeCents:         a.feeCents + b.feeCents,
    costCents:        a.costCents + b.costCents,
    netCents:         a.netCents + b.netCents,
  }
}

/** Share of processed volume we keep after Stripe. The headline health metric. */
export function takeRate(e: Economics): number {
  return e.volumeCents > 0 ? e.netCents / e.volumeCents : 0
}

/** Share of gross fees that survives Stripe. Card ≈ 0.4, ACH ≈ 0.85. */
export function margin(e: Economics): number {
  return e.feeCents > 0 ? e.netCents / e.feeCents : 0
}
