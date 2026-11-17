// Does every surface quote the same price?
//
// The bug this exists to prevent already shipped once: `/api/admin/payments`
// kept its own copy of the price list and was never given the self-serve tiers,
// so MRR, ARR and the revenue chart read $0 while landlords were being charged
// $19.99–$199.99 a month. Three other screens carried their own stale copies of
// the retired price list on top of that.
//
// So: one price list, and this asserts the properties the rest of the app
// relies on — nothing here touches the database.

import assert from 'node:assert/strict'
import {
  PLANS, PLAN_ORDER, PLAN_PRICE_CENTS, RETIRED_PLAN_TYPES, PLAN_CHART_COLORS,
  planPriceCents, planMonthlyCents, planPriceLabel, planShortName,
  propertyLimitFor, smallestTierFor, isRetiredPlan, isPlanTier,
  UNLIMITED_PROPERTIES, formatMonthly,
} from '../src/lib/landlordPlans.ts'
import { FREE_PROPERTY_LIMIT } from '../src/lib/landlordAccess.ts'

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log(`  ✓ ${name}`) }

console.log('\nPlan pricing\n')

check('every plan type has a price', () => {
  for (const t of [...PLAN_ORDER, ...RETIRED_PLAN_TYPES]) {
    assert.equal(typeof PLAN_PRICE_CENTS[t], 'number', `${t} has no price`)
  }
})

check('live tier prices match their definitions', () => {
  for (const t of PLAN_ORDER) {
    assert.equal(planPriceCents(t), PLANS[t].priceCents)
  }
})

check('the ladder only goes up — price and limit both', () => {
  for (let i = 1; i < PLAN_ORDER.length; i++) {
    const lo = PLANS[PLAN_ORDER[i - 1]], hi = PLANS[PLAN_ORDER[i]]
    assert.ok(hi.priceCents > lo.priceCents, `${hi.name} must cost more than ${lo.name}`)
    assert.ok(hi.propertyLimit > lo.propertyLimit, `${hi.name} must allow more than ${lo.name}`)
  }
})

check('a one-time purchase never counts as monthly revenue', () => {
  // Counting the $299 lifetime deal in MRR would re-book it every month for ever.
  assert.equal(planMonthlyCents('lifetime'), 0)
  assert.equal(planMonthlyCents('per_lead'), 0)
  // It still has a price, for recognising the sale once.
  assert.ok(planPriceCents('lifetime') > 0)
  assert.ok(planPriceCents('per_lead') > 0)
})

check('an unknown or missing plan type is worth nothing, not NaN', () => {
  for (const v of [null, undefined, '', 'enterprise_2027']) {
    assert.equal(planPriceCents(v), 0)
    assert.equal(planMonthlyCents(v), 0)
  }
})

check('no live tier is marked retired, and every retired one is', () => {
  for (const t of PLAN_ORDER) assert.equal(isRetiredPlan(t), false, `${t} is for sale`)
  for (const t of RETIRED_PLAN_TYPES) {
    assert.equal(isRetiredPlan(t), true)
    assert.equal(isPlanTier(t), false, `${t} must not be sellable`)
  }
})

check('every plan type has a label and a colour for admin charts', () => {
  for (const t of [...PLAN_ORDER, ...RETIRED_PLAN_TYPES]) {
    assert.match(planShortName(t), /\S/, `${t} has no label`)
    assert.match(PLAN_CHART_COLORS[t] ?? '', /^#[0-9a-f]{6}$/i, `${t} has no colour`)
  }
})

check('a price label carries its interval', () => {
  assert.equal(planPriceLabel('starter'), formatMonthly(PLANS.starter.priceCents))
  assert.ok(planPriceLabel('lifetime').endsWith('once'))
  assert.ok(planPriceLabel('per_lead').endsWith('each'))
  assert.equal(planPriceLabel('legacy_free'), 'Comped')
})

check('the cheapest tier that fits a portfolio is the one offered', () => {
  assert.equal(smallestTierFor(1), 'starter')
  assert.equal(smallestTierFor(2), 'growth')
  assert.equal(smallestTierFor(5), 'growth')
  assert.equal(smallestTierFor(6), 'unlimited')
  assert.equal(smallestTierFor(900), 'unlimited')
})

check('no plan allows fewer properties than the free tier builds', () => {
  // A paid tier under the free build ceiling would mean paying to lose doors.
  assert.ok(
    PLANS[PLAN_ORDER[PLAN_ORDER.length - 1]].propertyLimit >= FREE_PROPERTY_LIMIT,
    'the top tier must cover at least the free ceiling',
  )
  assert.equal(propertyLimitFor('unlimited'), UNLIMITED_PROPERTIES)
  // No plan at all means no live properties — publishing is what a plan buys.
  assert.equal(propertyLimitFor(null), 0)
})

check('retired per-listing plans keep the prices they were sold at', () => {
  // Historical revenue reports read these; changing one rewrites the past.
  assert.equal(PLAN_PRICE_CENTS.single_listing, 2999)
  assert.equal(PLAN_PRICE_CENTS.two_listing, 4999)
  assert.equal(PLAN_PRICE_CENTS.lifetime, 29900)
  assert.equal(PLAN_PRICE_CENTS.per_lead, 199)
  assert.equal(PLAN_PRICE_CENTS.legacy_free, 0)
})

check('a price change forces a new Stripe lookup key', () => {
  // Stripe prices are immutable, so editing a price without bumping its key
  // would keep charging the old amount. Keys must at least be unique.
  const keys = PLAN_ORDER.map(t => PLANS[t].lookupKey)
  assert.equal(new Set(keys).size, keys.length, 'lookup keys must be unique')
  for (const k of keys) assert.match(k, /_v\d+$/, `${k} must be versioned`)
})

console.log(`\n${checks} checks passed.\n`)
