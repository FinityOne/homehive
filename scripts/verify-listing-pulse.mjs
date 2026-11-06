/**
 * Proves the overview's traffic pulse counts people honestly.
 *
 * Worth a script rather than a reading, because every way of getting this
 * wrong produces a confident wrong number and no error at all:
 *
 *   • summing the daily uniques, which counts one student once per day they
 *     came back and inflates "unique visitors" by exactly the amount that
 *     makes a quiet listing look busy
 *   • bucketing by UTC, which files a Phoenix evening view under tomorrow and
 *     moves a fifth of the traffic into the wrong column of a 7-day chart
 *   • measuring the previous window from `now` minus 2×days, which truncates
 *     its oldest day and makes every delta read high
 *   • quoting a conversion rate over nine visitors
 *   • telling a landlord to fix a listing nobody can see, or to fix the price
 *     of a listing nobody has opened
 *   • saying "1 person viewed this home" on a public listing page, which is an
 *     anti-recommendation wearing a social-proof costume
 *
 * Run: npm run verify:pulse
 */
const {
  buildPulse, buildInsights, visitorKey, sourceOf, phoenixDay, windowDayKeys,
  describeSocialProof,
  MIN_VIEWS_TO_JUDGE, SOCIAL_PROOF_MIN_VIEWERS, MARKET_INQUIRY_RATE,
} = await import('../src/lib/listingPulse.ts')

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

// Thursday 5 Nov 2026, 19:00 Phoenix (= 02:00Z on the 6th).
const NOW = new Date('2026-11-06T02:00:00Z')

const listing = (over = {}) => ({ slug: 'mine', name: 'Mine', isLive: true, isUnpublished: false, ...over })

let seq = 0
const view = (over = {}) => ({
  id: `v${seq++}`,
  property_slug: 'mine',
  anonymous_id: null,
  session_id: null,
  created_at: '2026-11-05T20:00:00Z',
  utm_source: null,
  referrer: null,
  device_type: 'desktop',
  ...over,
})

const pulse = (over = {}) => buildPulse({
  windowDays: 7, now: NOW, listings: [listing()], views: [], leads: [], tours: [], ...over,
})

// ── Day boundaries ────────────────────────────────────────────────────────
// 19:00 Phoenix on the 5th is already the 6th in UTC. Bucketing by UTC would
// put this view on a day the 7-day window may not even contain.
check('a Phoenix evening belongs to the Phoenix day',
  phoenixDay(new Date('2026-11-06T02:00:00Z')), '2026-11-05')
check('and Phoenix midnight is not yesterday',
  phoenixDay(new Date('2026-11-05T07:00:00Z')), '2026-11-05')
check('the window ends today and runs back 7 calendar days',
  windowDayKeys(NOW, 7), [
    '2026-10-30', '2026-10-31', '2026-11-01',
    '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05',
  ])
check('and the previous window is the 7 days before that, whole',
  windowDayKeys(NOW, 7, 7)[0], '2026-10-23')
check('with no gap and no overlap between them',
  windowDayKeys(NOW, 7, 7).at(-1), '2026-10-29')

// ── Identity ──────────────────────────────────────────────────────────────
check('the cookie id wins, because it is the one that means a person',
  visitorKey(view({ anonymous_id: 'a1', session_id: 's1' })), 'a:a1')
check('the session id is the fallback for rows older than the column',
  visitorKey(view({ anonymous_id: null, session_id: 's1' })), 's:s1')
check('and a row with neither identity is its own person, not nobody',
  visitorKey(view({ id: 'v9', anonymous_id: null, session_id: null })), 'r:v9')

// ── Uniques are people, not day-people ────────────────────────────────────
{
  // One student, four views, spread over three different days.
  const p = pulse({
    views: [
      view({ anonymous_id: 'anna', created_at: '2026-11-03T18:00:00Z' }),
      view({ anonymous_id: 'anna', created_at: '2026-11-04T18:00:00Z' }),
      view({ anonymous_id: 'anna', created_at: '2026-11-04T19:00:00Z' }),
      view({ anonymous_id: 'anna', created_at: '2026-11-05T18:00:00Z' }),
    ],
  })
  check('four views are four views', p.views.value, 4)
  check('but one person is one unique visitor across the whole window', p.visitors.value, 1)
  check('summing the daily uniques would have said three',
    p.days.reduce((s, d) => s + d.visitors, 0), 3)
  check('and she is counted as returning', p.returningVisitors, 1)
  check('views per visitor exposes the repeat interest', p.viewsPerVisitor, 4)
}

// ── Windows and deltas ────────────────────────────────────────────────────
{
  const p = pulse({
    views: [
      view({ anonymous_id: 'a', created_at: '2026-11-05T18:00:00Z' }),
      view({ anonymous_id: 'b', created_at: '2026-11-04T18:00:00Z' }),
      // Previous window — counted as the baseline, never in the total.
      view({ anonymous_id: 'c', created_at: '2026-10-26T18:00:00Z' }),
      // Older than both windows: ignored entirely.
      view({ anonymous_id: 'd', created_at: '2026-09-01T18:00:00Z' }),
    ],
  })
  check('the window holds only its own days', p.views.value, 2)
  check('the baseline holds only the window before it', p.views.prev, 1)
  check('and the delta is measured between them', p.views.deltaPct, 1)
  check('a zero baseline yields no delta rather than infinity',
    pulse({ views: [view({ anonymous_id: 'a' })] }).views.deltaPct, null)
}

// ── Zero-filled series ────────────────────────────────────────────────────
{
  const p = pulse({ views: [view({ anonymous_id: 'a', created_at: '2026-11-05T18:00:00Z' })] })
  check('the chart always has one point per day', p.days.length, 7)
  check('quiet days are zeros, not gaps', p.days.map(d => d.views), [0, 0, 0, 0, 0, 0, 1])
  check('and the last point is today', p.days.at(-1).date, '2026-11-05')
  check('the busiest day is named', p.busiestDay.date, '2026-11-05')
  check('a week with no views has no busiest day', pulse().busiestDay, null)
}

// ── Rates refuse to be quoted on noise ────────────────────────────────────
{
  const few = pulse({
    views: Array.from({ length: 9 }, (_, i) => view({ anonymous_id: `p${i}` })),
    leads: [{ property: 'mine', created_at: '2026-11-05T18:00:00Z', status: 'contacted' }],
  })
  check('nine visitors buy no conversion rate', few.conversionPct, null)
  check('and the pulse says so out loud', few.tooQuietToJudge, true)

  const many = pulse({
    views: Array.from({ length: 40 }, (_, i) => view({ anonymous_id: `p${i}` })),
    leads: Array.from({ length: 2 }, () => ({ property: 'mine', created_at: '2026-11-05T18:00:00Z', status: 'contacted' })),
  })
  check('forty visitors do', many.conversionPct, 5)
  check('counted against people, not pageviews', many.visitors.value, 40)
  check('and the judging floor is shared with the performance page', MIN_VIEWS_TO_JUDGE, 25)
}

// ── Scoping ───────────────────────────────────────────────────────────────
{
  const p = pulse({
    views: [view({ anonymous_id: 'a' }), view({ anonymous_id: 'b', property_slug: 'someone-else' })],
    leads: [{ property: 'someone-else', created_at: '2026-11-05T18:00:00Z', status: 'new' }],
  })
  check('a view of a listing that is not theirs is not counted', p.views.value, 1)
  check('nor is the inquiry', p.inquiries.value, 0)
  check('and no phantom row appears for it', p.listings.map(l => l.slug), ['mine'])
}

// ── Sources ───────────────────────────────────────────────────────────────
check('a tagged link reports its campaign',
  sourceOf({ utm_source: 'instagram', referrer: 'https://google.com' }), 'instagram')
check('an untagged one reports the referring host',
  sourceOf({ utm_source: null, referrer: 'https://www.google.com/search?q=asu' }), 'google.com')
check('www is stripped so one channel is not two',
  sourceOf({ utm_source: null, referrer: 'https://google.com/x' }), 'google.com')
check('and nothing at all is Direct',
  sourceOf({ utm_source: null, referrer: null }), 'Direct')
check('a referrer that is not a URL is Direct, not a crash',
  sourceOf({ utm_source: null, referrer: 'android-app' }), 'Direct')

// ── Insights: the diagnosis the section exists for ────────────────────────
{
  const unseen = pulse()
  check('no traffic is named a reach problem', unseen.insights[0].key, 'no-traffic')

  const seenNotAsked = pulse({
    views: Array.from({ length: 30 }, (_, i) => view({ anonymous_id: `p${i}` })),
  })
  check('traffic with no inquiries is named a listing problem',
    seenNotAsked.insights[0].key, 'traffic-no-leads')
  check('and it sends the landlord to the page that says what to change',
    seenNotAsked.insights[0].href, '/landlord/performance')

  const thin = pulse({ views: [view({ anonymous_id: 'a' })] })
  check('one view with no inquiry is not a verdict', thin.insights[0].key, 'early-days')

  const invisible = buildInsights(pulse(), [listing({ isLive: false, isUnpublished: true })])
  check('an unpublished listing outranks every traffic observation',
    invisible[0].key, 'unpublished')
  check('and that is the only thing said about it', invisible.length, 1)

  const waiting = pulse({
    views: Array.from({ length: 30 }, (_, i) => view({ anonymous_id: `p${i}` })),
    leads: [{ property: 'mine', created_at: '2026-11-03T18:00:00Z', status: 'new' }],
  })
  check('an unanswered inquiry outranks everything else', waiting.insights[0].key, 'unanswered')
  check('it is counted', waiting.unanswered, 1)
  check('and its age is in hours, so the copy can say how late it is',
    waiting.oldestUnansweredHours, 56)
  check('an answered one is not waiting on anybody',
    pulse({ leads: [{ property: 'mine', created_at: '2026-11-03T18:00:00Z', status: 'contacted' }] }).unanswered, 0)

  check('at most three insights ever show', waiting.insights.length <= 3, true)
}

// ── Silent listings ───────────────────────────────────────────────────────
{
  const p = buildPulse({
    windowDays: 7, now: NOW,
    listings: [listing(), listing({ slug: 'quiet', name: 'Quiet House' })],
    views: Array.from({ length: 30 }, (_, i) => view({ anonymous_id: `p${i}` })),
    leads: [], tours: [],
  })
  check('a live listing nobody opened is surfaced', p.silentListings.map(l => l.slug), ['quiet'])
  check('the busy one leads the leaderboard', p.listings[0].slug, 'mine')
  check('and the quiet one still gets a row, because the zero is the finding',
    p.listings.map(l => l.views), [30, 0])
  check('share of traffic adds up', p.listings[0].sharePct, 100)
}

// ── Public social proof ───────────────────────────────────────────────────
check('four people is not a crowd, so the listing page says nothing',
  describeSocialProof({ viewers: SOCIAL_PROOF_MIN_VIEWERS - 1, inquiries: 0, availableRooms: 3 }), null)
check('five is',
  describeSocialProof({ viewers: 5, inquiries: 0, availableRooms: 3 }).text,
  '5 people viewed this home this week')
check('competition outranks scarcity for urgency',
  describeSocialProof({ viewers: 20, inquiries: 3, availableRooms: 1 }).urgency, '3 already inquired')
check('and is flagged as competition, which the page styles differently',
  describeSocialProof({ viewers: 20, inquiries: 3, availableRooms: 1 }).competitive, true)
check('one inquiry is not competition',
  describeSocialProof({ viewers: 20, inquiries: 1, availableRooms: 3 }).urgency, null)
check('the last room is scarcity',
  describeSocialProof({ viewers: 20, inquiries: 0, availableRooms: 1 }).urgency, 'one room left')

// ── Report ────────────────────────────────────────────────────────────────
console.log(`\n${pass.length} passed`)
if (fail.length) {
  console.log(`\n${fail.length} FAILED:`)
  for (const f of fail) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(
  `✓ the pulse counts people over the whole window, buckets by Phoenix day, ` +
  `refuses a rate under ${MIN_VIEWS_TO_JUDGE} visitors (market ` +
  `${Math.round(MARKET_INQUIRY_RATE * 1000) / 10}%), and says nothing in public ` +
  `under ${SOCIAL_PROOF_MIN_VIEWERS} viewers\n`
)
