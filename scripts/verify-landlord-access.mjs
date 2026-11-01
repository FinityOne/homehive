/**
 * Proves the line between the free landlord portal and the paid one.
 *
 * Worth a script rather than a reading: this one predicate decides whether a
 * landlord can work, and both ways of getting it wrong are expensive. Too
 * strict and a paying-customer-to-be hits a paywall before they have typed
 * anything; too loose and the whole product is free. The pure module is the
 * only place that decides, so proving it here proves the portal gate, the
 * sidebar locks and the paywall screen at once.
 *
 * Run: npm run verify:landlord-access
 */
const { isFreeLandlordPath, lockedFeature, navItemLocked, FREE_PROPERTY_LIMIT } =
  await import('../src/lib/landlordAccess.ts')

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

// ── Free: building and managing a property, and buying a plan ──────────────
for (const p of [
  '/landlord/listings',
  '/landlord/listings/new',
  '/landlord/listings/palm-ash-a1b2c',
  '/landlord/listings/palm-ash-a1b2c/edit/media',
  '/landlord/listings/palm-ash-a1b2c/edit/availability',
  '/landlord/listings/palm-ash-a1b2c/preview',
  '/landlord/subscribe',
  '/landlord/subscribe/success',
  '/landlord/billing',
]) {
  check(`free: ${p}`, isFreeLandlordPath(p), true)
  check(`free has no paywall copy: ${p}`, lockedFeature(p), null)
}

// ── Paid: everything that earns from the listing ───────────────────────────
for (const p of [
  '/landlord/dashboard',
  '/landlord/leads',
  '/landlord/leads/list',
  '/landlord/comments',
  '/landlord/calendar',
  '/landlord/roommates',
  '/landlord/background-checks',
  '/landlord/leases',
  '/landlord/leases/0a1b',
  '/landlord/tenants',
  '/landlord/financials',
  '/landlord/reminders',
  '/landlord/maintenance',
  '/landlord/inspections',
  '/landlord/automations',
  '/landlord/customizations',
]) {
  check(`paid: ${p}`, isFreeLandlordPath(p), false)
  check(`paid has copy: ${p}`, typeof lockedFeature(p)?.title, 'string')
  check(`paid has 3 points: ${p}`, lockedFeature(p)?.points.length, 3)
}

// ── Tours are paid wherever the route sits ─────────────────────────────────
check(
  'listing tour calendar is paid',
  isFreeLandlordPath('/landlord/listings/palm-ash-a1b2c/calendar'),
  false
)
check(
  'listing tour calendar borrows the Tours copy',
  lockedFeature('/landlord/listings/palm-ash-a1b2c/calendar')?.title,
  lockedFeature('/landlord/calendar')?.title
)
// ...but the listing itself is still free, so the prefix is not over-matched.
check(
  'the listing under it stays free',
  isFreeLandlordPath('/landlord/listings/palm-ash-a1b2c'),
  true
)
check(
  'a slug containing "calendar" is not a tour page',
  isFreeLandlordPath('/landlord/listings/calendar-court-9x8y7'),
  true
)

// ── A page nobody has classified yet defaults to paid ─────────────────────
check('unknown path is paid', isFreeLandlordPath('/landlord/some-new-thing'), false)
check('unknown path still gets copy', typeof lockedFeature('/landlord/some-new-thing')?.title, 'string')

// ── The nav lock agrees with the gate, item by item ───────────────────────
for (const href of ['/landlord/listings', '/landlord/billing']) {
  check(`nav unlocked: ${href}`, navItemLocked(href), false)
}
for (const href of ['/landlord/dashboard', '/landlord/leads', '/landlord/financials']) {
  check(`nav locked: ${href}`, navItemLocked(href), true)
}

// ── The ceiling has to be a real number, and mirror the migration ─────────
check('free ceiling matches the SQL in 20261101040000', FREE_PROPERTY_LIMIT, 3)

// ── Report ────────────────────────────────────────────────────────────────
console.log(`\n${pass.length} passed`)
if (fail.length) {
  console.log(`\n${fail.length} FAILED:`)
  for (const f of fail) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log('✓ the free/paid line holds\n')
