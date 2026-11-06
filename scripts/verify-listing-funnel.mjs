/**
 * Proves the funnel names the right step, and the pace engine the right date.
 *
 * Worth a script rather than a reading, because every way of getting these
 * wrong produces a confident sentence that sends a landlord to spend money:
 *
 *   • drawing a click-through rate from nine impressions, then telling someone
 *     to re-shoot their photography over it
 *   • calling the conversion step the bottleneck when the real loss is a card
 *     nobody clicks — fixing a stage below the break changes nothing
 *   • counting events instead of people, so one student opening the gallery
 *     four times reads as four interested renters
 *   • showing a funnel that opens on "0 seen in search" for a listing whose
 *     impressions simply predate the tracking
 *   • benchmarking against a pool of two listings
 *   • counting down to an August move-in date that has already passed
 *   • quoting an inquiries-per-room ratio as if it were measured when it is
 *     the platform's assumption
 *
 * Run: npm run verify:funnel
 */
const {
  buildFunnel, buildBrowseClock, benchmark, median, phoenixParts,
  MIN_IMPRESSIONS_TO_JUDGE, MIN_STEP_PEOPLE, MIN_PEER_LISTINGS, MIN_VIEWS_FOR_CLOCK,
} = await import('../src/lib/listingFunnel.ts')
const {
  buildPace, nextAcademicMoveIn, ASSUMED_INQUIRIES_PER_ROOM, MIN_LEASES_FOR_RATIO,
} = await import('../src/lib/leasingPace.ts')

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

const NOW = new Date('2026-11-06T02:00:00Z')  // Thu 5 Nov, 19:00 Phoenix

let seq = 0
const ev = (type, person, over = {}) => ({
  id: `e${seq++}`,
  property_slug: 'mine',
  event_type: type,
  anonymous_id: person,
  session_id: null,
  created_at: '2026-11-05T20:00:00Z',
  surface: 'search',
  position: null,
  ...over,
})
const vw = (person, over = {}) => ({
  id: `v${seq++}`,
  property_slug: 'mine',
  anonymous_id: person,
  session_id: null,
  created_at: '2026-11-05T20:00:00Z',
  ...over,
})
const many = (n, f) => Array.from({ length: n }, (_, i) => f(i))

// ── People, not events ────────────────────────────────────────────────────
{
  const f = buildFunnel({
    events: [
      ev('gallery_open', 'anna'), ev('gallery_open', 'anna'),
      ev('gallery_open', 'anna'), ev('faq_open', 'anna'),
    ],
    views: [vw('anna')],
    inquiries: 0, tours: 0,
  })
  const engaged = f.stages.find(s => s.key === 'engaged')
  check('one person looking hard is one person', engaged.people, 1)
  check('but four events are still four events', engaged.count, 4)
}

// ── The funnel starts where the data starts ───────────────────────────────
{
  const noSearch = buildFunnel({ events: [ev('gallery_open', 'a')], views: [vw('a')], inquiries: 0, tours: 0 })
  check('with no impressions the funnel opens at the page view',
    noSearch.stages.map(s => s.key), ['views', 'engaged', 'inquiries', 'tours'])
  check('and says so', noSearch.hasSearchData, false)

  const withSearch = buildFunnel({ events: [ev('impression', 'a')], views: [], inquiries: 0, tours: 0 })
  check('with impressions it opens at search',
    withSearch.stages[0].key, 'impressions')
  check('and says so', withSearch.hasSearchData, true)
}

// ── Rates refuse to be quoted on noise ────────────────────────────────────
{
  const thin = buildFunnel({
    events: [...many(20, i => ev('impression', `p${i}`)), ev('card_click', 'p0')],
    views: [vw('p0')], inquiries: 0, tours: 0,
  })
  check('twenty impressions buy no click-through rate', thin.ctrPct, null)
  check('and no bottleneck is named from them', thin.bottleneck, null)

  const enough = buildFunnel({
    events: [...many(200, i => ev('impression', `p${i}`)), ...many(20, i => ev('card_click', `p${i}`))],
    views: many(20, i => vw(`p${i}`)), inquiries: 0, tours: 0,
  })
  check('two hundred do', enough.ctrPct, 10)
  check('the impression floor is the one documented', MIN_IMPRESSIONS_TO_JUDGE, 100)
  check('and the per-step floor is its own number', MIN_STEP_PEOPLE, 20)
}

// ── The bottleneck is the FIRST broken step, not the worst-looking ────────
{
  // Terrible click-through AND terrible conversion. The click-through is what
  // must be named: every stage below it is small because of it.
  const f = buildFunnel({
    events: [
      ...many(1000, i => ev('impression', `p${i}`)),
      ...many(10, i => ev('card_click', `p${i}`)),
      ...many(10, i => ev('gallery_open', `p${i}`)),
    ],
    views: many(40, i => vw(`p${i}`)),
    inquiries: 0, tours: 0,
    peers: { ctrPct: 10, engagedPct: 50, inquiryPct: 20 },
  })
  check('a card nobody clicks is the bottleneck', f.bottleneck.key, 'clicks')
  check('and it is reported against the peer rate', f.bottleneck.peerPct, 10)

  // Healthy click-through, dead page.
  const g = buildFunnel({
    events: [
      ...many(1000, i => ev('impression', `p${i}`)),
      ...many(120, i => ev('card_click', `p${i}`)),
      ...many(2, i => ev('gallery_open', `p${i}`)),
    ],
    views: many(120, i => vw(`p${i}`)),
    inquiries: 0, tours: 0,
    peers: { ctrPct: 10, engagedPct: 50, inquiryPct: 20 },
  })
  check('a clicked card with a dead page blames the page', g.bottleneck.key, 'engaged')

  // Everything healthy: say nothing.
  const h = buildFunnel({
    events: [
      ...many(1000, i => ev('impression', `p${i}`)),
      ...many(120, i => ev('card_click', `p${i}`)),
      ...many(80, i => ev('gallery_open', `p${i}`)),
    ],
    views: many(120, i => vw(`p${i}`)),
    inquiries: 20, inquiryPeople: 20, tours: 4,
    peers: { ctrPct: 10, engagedPct: 50, inquiryPct: 20 },
  })
  check('a healthy funnel is left alone', h.bottleneck, null)
}

// ── Abandoned forms are their own finding ─────────────────────────────────
{
  const f = buildFunnel({
    events: [
      ...many(1000, i => ev('impression', `p${i}`)),
      ...many(150, i => ev('card_click', `p${i}`)),
      ...many(100, i => ev('form_start', `p${i}`)),
      ...many(90, i => ev('form_abandon', `p${i}`)),
    ],
    views: many(150, i => vw(`p${i}`)),
    inquiries: 10, inquiryPeople: 10, tours: 0,
    peers: { ctrPct: 10, engagedPct: 50, inquiryPct: 20 },
  })
  check('abandonment is measured', f.engagement.abandonPct, 90)
  check('and surfaced as the thing to fix', f.bottleneck.key, 'inquiries')
  check('named for what it is', f.bottleneck.title.includes('started writing'), true)
}

// ── Benchmarks ────────────────────────────────────────────────────────────
check('a pool of four is not a market', benchmark('v', 'Views', 10, [1, 2, 3, 4], 'count').verdict, 'unknown')
check('a pool of five is', benchmark('v', 'Views', 10, [1, 2, 3, 4, 5], 'count').verdict, 'ahead')
check('the floor is the documented one', MIN_PEER_LISTINGS, 5)
check('being near the median is typical, not a failure',
  benchmark('v', 'Views', 3, [2, 3, 3, 3, 4], 'count').verdict, 'typical')
check('and being under it is named plainly',
  benchmark('v', 'Views', 1, [4, 4, 4, 4, 4], 'count').verdict, 'behind')
check('no own-data means no comparison',
  benchmark('v', 'Views', null, [1, 2, 3, 4, 5], 'count').verdict, 'unknown')
check('the median of an even sample is the midpoint', median([1, 2, 3, 4]), 2.5)

// ── The browse clock ──────────────────────────────────────────────────────
{
  // 19:00 Phoenix on Thursday 5 Nov 2026 = 02:00Z Friday 6 Nov.
  const p = phoenixParts('2026-11-06T02:00:00Z')
  check('a Phoenix evening stays on its own weekday', p.dow, 4)   // Thursday
  check('and its own hour', p.hour, 19)

  const quiet = buildBrowseClock(many(10, () => ({ created_at: '2026-11-06T02:00:00Z' })))
  check('ten views is a scatter, not a pattern', quiet.readable, false)

  const busy = buildBrowseClock([
    ...many(50, () => ({ created_at: '2026-11-06T02:00:00Z' })),   // Thu 7pm
    ...many(10, () => ({ created_at: '2026-11-07T17:00:00Z' })),   // Sat 10am
  ])
  check('sixty is', busy.readable, true)
  check('the peak block is named', busy.peakLabel, 'Thursday 6–9pm')
  check('evening share is counted in Phoenix hours', busy.eveningPct, 83)
  check('and so is the weekend share', busy.weekendPct, 17)
  check('the clock floor is the documented one', MIN_VIEWS_FOR_CLOCK, 40)
}

// ── Leasing pace ──────────────────────────────────────────────────────────
check('the academic deadline is always ahead of today',
  nextAcademicMoveIn(NOW), '2027-08-01')
check('and does not roll over before it arrives',
  nextAcademicMoveIn(new Date('2027-03-02T12:00:00Z')), '2027-08-01')
check('rolling only once it is past',
  nextAcademicMoveIn(new Date('2027-08-02T12:00:00Z')), '2028-08-01')

{
  const full = buildPace({ now: NOW, roomsOpen: 0, inquiries: 5, windowDays: 7 })
  check('no vacancy is not a pace problem', full.verdict, 'no_vacancy')
  check('and it is not dressed up as one', full.deadline, null)
}

{
  // 3 rooms, 38 weeks to August, 8 inquiries a week: comfortably ahead.
  const good = buildPace({ now: NOW, roomsOpen: 3, inquiries: 8, windowDays: 7 })
  check('a healthy rate against a far deadline is on track', good.verdict, 'on_track')
  check('the ratio is the platform assumption until proven otherwise', good.assumed, true)
  check('which is the documented constant', good.inquiriesPerRoom, ASSUMED_INQUIRIES_PER_ROOM)

  const dead = buildPace({ now: NOW, roomsOpen: 3, inquiries: 0, windowDays: 7 })
  check('nothing fills at a rate of zero', dead.verdict, 'behind')
  check('and the copy says exactly that', dead.detail.includes('rate of zero'), true)
}

{
  // A listing's own date beats the academic calendar.
  const own = buildPace({ now: NOW, roomsOpen: 2, availableFrom: '2026-12-01', inquiries: 1, windowDays: 7 })
  check('the listing\'s own move-in date wins', own.deadline, '2026-12-01')
  check('and the copy knows where it came from', own.deadlineSource, 'listing')
  check('a tight deadline with a thin rate is behind', own.verdict, 'behind')

  const stale = buildPace({ now: NOW, roomsOpen: 2, availableFrom: '2026-01-01', inquiries: 1, windowDays: 7 })
  check('a move-in date already past is ignored, not counted down to',
    stale.deadlineSource, 'academic_year')
}

{
  // A healthy rate against a deadline nine months out multiplies out to an
  // absurd projection ("346 inquiries against the 8 you need"), which reads as
  // a joke and costs the whole page its credibility. On-pace copy must talk
  // about how long filling takes, not about a projected total.
  const comfortable = buildPace({ now: NOW, roomsOpen: 2, inquiries: 9, windowDays: 7, history: { inquiries: 20, roomsSigned: 5 } })
  check('a comfortable pace is on track', comfortable.verdict, 'on_track')
  check('and is expressed as time to fill', comfortable.detail.includes('of traffic'), true)
  check('never as a nine-month projection',
    comfortable.detail.includes(String(comfortable.projectedInquiries)), false)
  check('the time to fill is exposed for the bar label', comfortable.weeksToFill, 0.9)

  // Grammar: a single inquiry a week is not "1 inquiries a week".
  const one = buildPace({ now: NOW, roomsOpen: 3, availableFrom: '2027-01-05', inquiries: 1, windowDays: 7 })
  check('one inquiry a week reads as one inquiry', one.detail.includes('1 inquiry a week'), true)
  check('and never as "1 inquiries"', one.detail.includes('1 inquiries'), false)
}

{
  // Measured history replaces the assumption.
  const measured = buildPace({
    now: NOW, roomsOpen: 1, inquiries: 2, windowDays: 7,
    history: { inquiries: 12, roomsSigned: 4 },
  })
  check('a landlord\'s own conversion is used when they have one', measured.inquiriesPerRoom, 3)
  check('and is no longer flagged as an assumption', measured.assumed, false)

  const tooThin = buildPace({
    now: NOW, roomsOpen: 1, inquiries: 2, windowDays: 7,
    history: { inquiries: 12, roomsSigned: MIN_LEASES_FOR_RATIO - 1 },
  })
  check('two signed rooms is not a conversion rate', tooThin.assumed, true)
}

// ── Report ────────────────────────────────────────────────────────────────
console.log(`\n${pass.length} passed`)
if (fail.length) {
  console.log(`\n${fail.length} FAILED:`)
  for (const f of fail) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(
  `✓ the funnel counts people, starts where its data starts, names the FIRST ` +
  `broken step, refuses a rate under ${MIN_IMPRESSIONS_TO_JUDGE} impressions ` +
  `or a market under ${MIN_PEER_LISTINGS} listings, and the pace engine never ` +
  `counts down to a date that has passed\n`
)
