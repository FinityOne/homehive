/**
 * Proves the listing-performance engine's judgement calls.
 *
 * Worth a script rather than a reading, because every way of getting this
 * wrong tells a landlord to do something expensive and none of them raises an
 * error:
 *
 *   • diagnosing a listing nobody can see (the fix is the plan, not the price)
 *   • drawing a verdict from nine views, which is noise in a confident sentence
 *   • telling someone to cut the rent on a listing with no traffic
 *   • comparing a six-bedroom house to a single room on the headline price
 *   • letting a $0 or a weekly rate into the comp median
 *   • pricing a listing against the landlord's own other listings
 *
 * Run: npm run verify:listing-perf
 */
const {
  perBedPrice, buildCompSet, diagnose, priceAdvice, buildFunnel, buildReport,
  sortReports, summarise, askedFromPerBed, daysListed, median,
  MIN_VIEWS_TO_JUDGE, WINDOW_DAYS, GRACE_DAYS,
} = await import('../src/lib/listingPerformance.ts')

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

const NOW = new Date('2026-11-02T12:00:00Z')
const old = '2026-01-01T00:00:00Z'

/** A healthy, visible, whole-home listing. */
const listing = (over = {}) => ({
  slug: 'mine', name: 'Mine',
  created_at: old, status_changed_at: null,
  listing_status: 'active',
  marketing_enabled: true, accepting_inquiries: true, show_when_rented: false,
  admin_status: 'active', archived_at: null, owner_plan_active: true,
  price: 3600, beds: 6, rental_mode: 'whole_home', asu_distance: 0.5,
  total_rooms: 6, available: 2, photoCount: 10, hasDescription: true,
  ...over,
})

const activity = (over = {}) => ({
  viewsTotal: 400, views: 200, viewers: 180, viewsPrev: 100,
  inquiries: 8, inquiriesTotal: 20, tours: 3, questions: 1,
  daily: [], sources: [], devices: [], lastViewAt: null, lastInquiryAt: null,
  ...over,
})

/** Comps at $500–$700 per bed, median $600. */
const comps = [
  { slug: 'a', name: 'A', price: 500, beds: 1, rental_mode: 'by_room', asu_distance: 0.5, isOwn: false },
  { slug: 'b', name: 'B', price: 550, beds: 1, rental_mode: 'by_room', asu_distance: 0.6, isOwn: false },
  { slug: 'c', name: 'C', price: 650, beds: 1, rental_mode: 'by_room', asu_distance: 0.7, isOwn: false },
  { slug: 'd', name: 'D', price: 700, beds: 1, rental_mode: 'by_room', asu_distance: 0.8, isOwn: false },
]

// ── Per-bedroom normalisation ─────────────────────────────────────────────
check('a whole home divides by bedrooms',
  perBedPrice({ price: 3600, beds: 6, rental_mode: 'whole_home' }), 600)
check('a by-room listing is already per bed',
  perBedPrice({ price: 600, beds: 6, rental_mode: 'by_room' }), 600)
check('and so the two are directly comparable',
  perBedPrice({ price: 3600, beds: 6, rental_mode: 'whole_home' }) ===
  perBedPrice({ price: 600, beds: 6, rental_mode: 'by_room' }), true)
check('no price is not a comp of anything',
  perBedPrice({ price: 0, beds: 4, rental_mode: 'whole_home' }), null)
check('and neither is a whole home with no bedrooms',
  perBedPrice({ price: 2000, beds: 0, rental_mode: 'whole_home' }), null)
check('round-tripping a per-bed figure restores the asked price',
  askedFromPerBed({ rental_mode: 'whole_home', beds: 6 }, 600), 3600)
check('and leaves a by-room price alone',
  askedFromPerBed({ rental_mode: 'by_room', beds: 6 }, 600), 600)

// ── The comp set ──────────────────────────────────────────────────────────
{
  // `beds: 1` on the by-room comps keeps them inside the ±1 band of a 1-bed.
  const l = listing({ beds: 1, price: 600, rental_mode: 'by_room' })
  const c = buildCompSet(l, comps)
  check('four comps within a mile is a tight band', c.band, 'tight')
  check('and is not thin', c.thin, false)
  check('the median is the median', c.median, 600)
  check('your own price is read back', c.yourPerBed, 600)
  check('sitting at the median is a 0% delta', c.deltaPct, 0)
}
{
  const l = listing({ beds: 1, price: 600, rental_mode: 'by_room' })
  const junk = [
    ...comps,
    { slug: 'z', name: 'Zero', price: 0, beds: 1, rental_mode: 'by_room', asu_distance: 0.5, isOwn: false },
    { slug: 'w', name: 'Weekly', price: 150, beds: 1, rental_mode: 'by_room', asu_distance: 0.5, isOwn: false },
    { slug: 'h', name: 'Huge', price: 9000, beds: 1, rental_mode: 'by_room', asu_distance: 0.5, isOwn: false },
  ]
  const c = buildCompSet(l, junk)
  check('a $0 price, a weekly rate and a nonsense rent are all excluded', c.count, 4)
  check('so the median is unmoved by them', c.median, 600)
}
{
  const l = listing({ beds: 1, price: 600, rental_mode: 'by_room' })
  const mineToo = comps.map(c => ({ ...c, isOwn: true }))
  const c = buildCompSet(l, mineToo)
  check('your own listings never count in the maths', c.count, 0)
  check('which makes the set thin, and says so', c.thin, true)
  check('but they are still shown for context', c.comps.length, 4)
}
{
  // Nothing nearby, so the band has to widen to find anything at all.
  const far = comps.map((c, i) => ({ ...c, asu_distance: 8 + i }))
  const l = listing({ beds: 1, price: 600, rental_mode: 'by_room' })
  const c = buildCompSet(l, far)
  check('no near comps widens the band to the whole market', c.band, 'market')
  check('and still finds them', c.count, 4)
}
check('the median of an even set averages the middle two', median([500, 550, 650, 700]), 600)

// ── The diagnosis, in priority order ──────────────────────────────────────
const diag = (l, a, candidates = comps, opts = {}) =>
  diagnose(l, a, buildCompSet(l, candidates), { now: NOW, ...opts }).code

check('no plan beats every other finding',
  diag(listing({ owner_plan_active: false, views: 0 }), activity({ views: 0, inquiries: 0 })), 'not_public')
check('archived is invisible too',
  diag(listing({ archived_at: '2026-10-01T00:00:00Z' }), activity()), 'not_public')
check('unapproved is invisible too',
  diag(listing({ admin_status: 'pending' }), activity()), 'not_public')
check('inactive is invisible too',
  diag(listing({ listing_status: 'inactive' }), activity()), 'not_public')
check('rented without a waitlist is invisible too',
  diag(listing({ listing_status: 'rented', show_when_rented: false }), activity()), 'not_public')
check('visible but unpromoted is its own finding',
  diag(listing({ marketing_enabled: false }), activity()), 'not_promoted')
check('a closed inquiry form is its own finding',
  diag(listing({ accepting_inquiries: false }), activity()), 'inquiries_closed')
check('a full house is told it is full, not that it failed',
  diag(listing({ available: 0 }), activity()), 'full')
check('a listing younger than the grace period is not judged',
  diag(listing({ created_at: NOW.toISOString(), status_changed_at: null }), activity()), 'too_new')
check('a relist restarts that clock',
  diag(listing({ created_at: old, status_changed_at: NOW.toISOString() }), activity()), 'too_new')

check('no views at all is a reach problem',
  diag(listing(), activity({ views: 0, viewers: 0, inquiries: 0, tours: 0 })), 'no_views')
check('and below the floor nothing is claimed either way',
  diag(listing(), activity({ views: 9, viewers: 9, inquiries: 0, tours: 0 })), 'too_quiet')
check('real traffic, no inquiries, priced high → the price is named',
  diag(listing({ price: 4800 }), activity({ inquiries: 0, tours: 0 })), 'views_no_inquiries_price')
check('real traffic, no inquiries, priced fairly → the page is named',
  diag(listing({ price: 3000 }), activity({ inquiries: 0, tours: 0 })), 'views_no_inquiries_listing')
check('inquiries with no tours is a response problem',
  diag(listing(), activity({ tours: 0 })), 'inquiries_no_tours')
check('tours with rooms still open is a closing problem',
  diag(listing(), activity()), 'tours_no_lease')
check('tours and nothing left to fill is healthy',
  diag(listing({ available: 0, total_rooms: 0 }), activity()), 'healthy')

// The expensive mistake, stated as its own assertion.
{
  const d = diagnose(
    listing({ price: 4800 }),
    activity({ views: 9, viewers: 9, inquiries: 0, tours: 0 }),
    buildCompSet(listing({ price: 4800 }), comps),
    { now: NOW }
  )
  check('an over-priced listing with no traffic is NOT told to cut the rent',
    d.code === 'views_no_inquiries_price', false)
  check('it is told to work on traffic instead', d.code, 'too_quiet')
}

// ── Price advice ──────────────────────────────────────────────────────────
const advise = (l, a) => {
  const c = buildCompSet(l, comps)
  const d = diagnose(l, a, c, { now: NOW })
  const adv = priceAdvice(l, a, c, d)
  return adv ? adv.direction : null
}
check('priced high and being skipped → come down',
  advise(listing({ price: 4800 }), activity({ inquiries: 0, tours: 0 })), 'lower')
check('cheap and in demand → room to raise',
  advise(listing({ price: 2400 }), activity({ inquiries: 8 })), 'raise')
check('mid-market and leasing → hold',
  advise(listing({ price: 3600 }), activity()), 'hold')
{
  const l = listing({ beds: 1, price: 600, rental_mode: 'by_room' })
  const thin = buildCompSet(l, [])
  const d = diagnose(l, activity({ inquiries: 0 }), thin, { now: NOW })
  check('with no comps there is no number to suggest', priceAdvice(l, activity(), thin, d), null)
}
{
  // The advice must come down TO the market, never below it.
  const l = listing({ price: 4800 })
  const a = activity({ inquiries: 0, tours: 0 })
  const c = buildCompSet(l, comps)
  const adv = priceAdvice(l, a, c, diagnose(l, a, c, { now: NOW }))
  check('a cut lands at the median, not under it', adv.lowPerBed >= c.median, true)
  check('and the asked range is in whole-home dollars', adv.lowAsked, 3600)
  check('the monthly delta is signed downward', adv.monthlyDelta < 0, true)
}

// ── Funnel arithmetic ─────────────────────────────────────────────────────
{
  const f = buildFunnel(activity({ views: 200, viewers: 100, inquiries: 5, tours: 2, viewsPrev: 100 }))
  check('the inquiry rate is per viewer, not per view', f.inquiryRate, 5)
  check('the tour rate is per inquiry', f.tourRate, 40)
  check('doubled views reads as +100%', f.trendPct, 100)
  check('views per day divides by the window', f.viewsPerDay, Math.round((200 / WINDOW_DAYS) * 10) / 10)
}
check('below the floor there is no rate at all',
  buildFunnel(activity({ views: 10, viewers: 10, inquiries: 0 })).inquiryRate, null)

// ── Ordering and totals ───────────────────────────────────────────────────
{
  const mk = (slug, over, act) => buildReport(
    listing({ slug, name: slug, ...over }), activity(act), comps, { now: NOW }
  )
  const rs = sortReports([
    mk('ok', { available: 0, total_rooms: 0 }, {}),
    mk('dead', { owner_plan_active: false }, { views: 0, viewers: 0, inquiries: 0 }),
    mk('warn', { marketing_enabled: false }, {}),
  ])
  check('the listing costing money is first', rs[0].listing.slug, 'dead')
  check('and the working one is last', rs[2].listing.slug, 'ok')

  const s = summarise(rs)
  check('attention counts criticals and warnings only', s.needsAttention, 2)
  check('empty rooms are summed across the portfolio', s.openRooms, 4)
  check('and priced at the per-bed rent', s.vacantRent, 2400)
}

// ── Dates ─────────────────────────────────────────────────────────────────
check('days listed counts from the status change when there is one',
  daysListed(listing({ created_at: old, status_changed_at: '2026-10-03T00:00:00Z' }), NOW), 30)
check('and from creation when there is not',
  daysListed(listing({ created_at: '2026-10-03T00:00:00Z', status_changed_at: null }), NOW), 30)

// ── Report ────────────────────────────────────────────────────────────────
console.log(`\n${pass.length} passed`)
if (fail.length) {
  console.log(`\n${fail.length} FAILED:`)
  for (const f of fail) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(
  `✓ listing performance names the right problem, refuses to judge under ` +
  `${MIN_VIEWS_TO_JUDGE} viewers or inside ${GRACE_DAYS} days, and never ` +
  `prices a listing against its owner's own\n`
)
