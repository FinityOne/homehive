/**
 * Proves the renewal engine's policy.
 *
 * Worth a script rather than a reading, because the ways of getting this wrong
 * are all silent and all expensive:
 *
 *   • treating a lapsed offer as still open, so nobody chases it
 *   • treating an accepted offer as finished before the lease exists, which is
 *     the easiest money in the portal to drop
 *   • a renewal term that starts after the old lease ended — a vacancy typed
 *     by accident
 *   • suggesting a rise large enough to make a settled tenant shop around
 *   • inventing a market rent when there are no comps
 *   • putting a demo lease, which has no real tenant, at the top of the list
 *
 * The breakeven arithmetic gets its own section. It is the number most likely
 * to change a landlord's mind, so it had better be right.
 *
 * Run: npm run verify:renewals
 */
const {
  renewalState, stageFor, daysUntil, daysBetweenDates, nextAction,
  buildPipeline, summarisePipeline, defaultTerms, suggestRenewalRent,
  turnoverMath, addDays, addMonths,
  WINDOW_OPENS_DAYS, URGENT_DAYS, CRITICAL_DAYS, SUGGESTED_INCREASE_CAP_PCT,
} = await import('../src/lib/renewals.ts')

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

// Noon UTC on 2 Nov 2026 is still 2 Nov in Phoenix, so "today" is unambiguous.
const NOW = new Date('2026-11-02T19:00:00Z')
/** A `YYYY-MM-DD` n days from NOW. */
const inDays = n => addDays('2026-11-02', n)

const lease = (over = {}) => ({
  id: 'l1', property_id: 'p1',
  start_date: '2026-08-01', end_date: inDays(90),
  rent_amount: 900, unit_number: null, is_demo: false,
  property: { id: 'p1', name: 'Palace', slug: 'palace' },
  tenants: [{ id: 't1', name: 'Maya Ortiz', email: 'maya@asu.edu' }],
  ...over,
})

const offer = (over = {}) => ({
  id: 'r1', lease_id: 'l1', owner_id: 'o1', property_id: 'p1',
  new_rent: 940, new_start_date: inDays(91), new_end_date: inDays(456),
  respond_by: inDays(21), message: null,
  status: 'sent', tenant_name: 'Maya Ortiz', tenant_email: 'maya@asu.edu',
  token: 'tok', sent_at: '2026-11-02T00:00:00Z',
  responded_at: null, response_note: null, renewal_lease_id: null,
  created_at: '2026-11-02T00:00:00Z', updated_at: '2026-11-02T00:00:00Z',
  ...over,
})

// ── Dates ─────────────────────────────────────────────────────────────────
check('days until counts from the Phoenix calendar day', daysUntil(inDays(90), NOW), 90)
check('a date already past is negative', daysUntil(inDays(-5), NOW), -5)
check('today is zero, not one', daysUntil('2026-11-02', NOW), 0)
check('date-to-date arithmetic ignores the clock',
  daysBetweenDates('2026-08-01', '2027-07-31'), 364)
check('adding months clamps to the end of a short month',
  addMonths('2027-01-31', 1), '2027-02-28')
check('and a leap February is honoured', addMonths('2028-01-31', 1), '2028-02-29')

// ── Stages ────────────────────────────────────────────────────────────────
check('well out is early', stageFor(inDays(200), NOW), 'early')
check('the window opens exactly on the threshold',
  stageFor(inDays(WINDOW_OPENS_DAYS), NOW), 'open')
check('a day earlier is still early',
  stageFor(inDays(WINDOW_OPENS_DAYS + 1), NOW), 'early')
check('urgent starts on its threshold', stageFor(inDays(URGENT_DAYS), NOW), 'urgent')
check('critical starts on its threshold', stageFor(inDays(CRITICAL_DAYS), NOW), 'critical')
check('the last day is still critical, not ended', stageFor(inDays(0), NOW), 'critical')
check('yesterday has ended', stageFor(inDays(-1), NOW), 'ended')

// ── State is derived, never stored ────────────────────────────────────────
check('no offer means nobody has asked', renewalState(null, NOW), 'none')
check('a live offer is awaiting', renewalState(offer(), NOW), 'awaiting')
check('a lapsed deadline is expired without anything having run',
  renewalState(offer({ respond_by: inDays(-1) }), NOW), 'expired')
check('the deadline day itself is still open',
  renewalState(offer({ respond_by: inDays(0) }), NOW), 'awaiting')
check('accepted but unsigned is accepted',
  renewalState(offer({ status: 'accepted' }), NOW), 'accepted')
check('accepted and signed is converted',
  renewalState(offer({ status: 'accepted', renewal_lease_id: 'l2' }), NOW), 'converted')
check('a past deadline cannot un-accept an acceptance',
  renewalState(offer({ status: 'accepted', respond_by: inDays(-30) }), NOW), 'accepted')
check('declined stays declined', renewalState(offer({ status: 'declined' }), NOW), 'declined')
check('withdrawn stays withdrawn', renewalState(offer({ status: 'withdrawn' }), NOW), 'withdrawn')

// ── The next action ───────────────────────────────────────────────────────
const act = (l, r) => nextAction(l, r, NOW)
check('an accepted offer outranks everything else',
  act(lease({ end_date: inDays(3) }), offer({ status: 'accepted' })).kind, 'convert')
check('and it is urgent, because the tenant is waiting',
  act(lease(), offer({ status: 'accepted' })).urgent, true)
check('a converted renewal needs nothing',
  act(lease(), offer({ status: 'accepted', renewal_lease_id: 'l2' })).kind, 'none')
check('a decline sends you to the market',
  act(lease(), offer({ status: 'declined' })).kind, 'relist')
check('a decline close to the end is urgent',
  act(lease({ end_date: inDays(20) }), offer({ status: 'declined' })).urgent, true)
check('a decline months out is not',
  act(lease({ end_date: inDays(110) }), offer({ status: 'declined' })).urgent, false)
check('a live offer with time left is just waiting',
  act(lease(), offer({ respond_by: inDays(10) })).kind, 'wait')
check('a live offer about to lapse is chased',
  act(lease(), offer({ respond_by: inDays(2) })).kind, 'chase')
check('an expired offer is re-sent, because silence is not a no',
  act(lease(), offer({ respond_by: inDays(-1) })).kind, 'resend')
check('a withdrawn offer leaves nothing in front of them',
  act(lease(), offer({ status: 'withdrawn' })).kind, 'resend')
check('inside the window with no offer, send one',
  act(lease({ end_date: inDays(90) }), null).kind, 'send')
check('and at six weeks that is urgent',
  act(lease({ end_date: inDays(30) }), null).urgent, true)
check('too early to ask is not an action',
  act(lease({ end_date: inDays(300) }), null).kind, 'none')
check('and neither is a lease that has already ended',
  act(lease({ end_date: inDays(-10) }), null).kind, 'none')

// ── The pipeline ──────────────────────────────────────────────────────────
{
  const leases = [
    lease({ id: 'far', end_date: inDays(300) }),
    lease({ id: 'accepted', end_date: inDays(80) }),
    lease({ id: 'unasked', end_date: inDays(20) }),
    lease({ id: 'demo', end_date: inDays(30), is_demo: true }),
  ]
  const renewals = [offer({ id: 'ra', lease_id: 'accepted', status: 'accepted' })]
  const rows = buildPipeline(leases, renewals, NOW)

  check('a demo lease never appears', rows.some(r => r.lease.id === 'demo'), false)
  check('every real lease does', rows.length, 3)
  check('an accepted offer waiting to be signed is first', rows[0].lease.id, 'accepted')
  check('the unasked lease nearly out of time is next', rows[1].lease.id, 'unasked')
  check('and the one months away is last', rows[2].lease.id, 'far')
  check('the offer is attached to the right lease', rows[0].renewal.id, 'ra')
}
{
  // The newest offer wins; the earlier one is history.
  const rows = buildPipeline(
    [lease()],
    [
      offer({ id: 'first', status: 'withdrawn', sent_at: '2026-10-01T00:00:00Z' }),
      offer({ id: 'second', sent_at: '2026-11-01T00:00:00Z' }),
    ],
    NOW
  )
  check('the latest offer is the one that counts', rows[0].renewal.id, 'second')
  check('so the state follows it', rows[0].state, 'awaiting')
}
{
  const rows = buildPipeline(
    [
      lease({ id: 'a', end_date: inDays(60), rent_amount: 900 }),
      lease({ id: 'b', end_date: inDays(60), rent_amount: 800 }),
      lease({ id: 'c', end_date: inDays(60), rent_amount: 700 }),
      lease({ id: 'far', end_date: inDays(300), rent_amount: 5000 }),
    ],
    [
      offer({ id: 'r2', lease_id: 'b', status: 'accepted', new_rent: 850 }),
      offer({ id: 'r3', lease_id: 'c', status: 'declined' }),
    ],
    NOW
  )
  const s = summarisePipeline(rows)
  check('only leases in the window are in the window', s.inWindow, 3)
  check('unanswered rent is at risk', s.rentAtRisk, 900)
  check('a decline is rent leaving', s.rentLeaving, 700)
  check('an acceptance secures the NEW rent, not the old one', s.rentSecured, 850)
  check('and it is counted as needing a lease', s.toConvert, 1)
  check('a lease months away is not counted as unasked', s.notAsked, 1)
}

// ── Default terms ─────────────────────────────────────────────────────────
{
  const t = defaultTerms({ end_date: '2027-07-31' }, NOW)
  check('the new term starts the day after the old one ends', t.start, '2027-08-01')
  check('and runs twelve months to the day before', t.end, '2028-07-31')
  check('there is no gap between the terms',
    daysBetweenDates('2027-07-31', t.start), 1)
  check('the reply-by is three weeks out', t.respondBy, inDays(21))
}
check('the reply-by never lands after the lease it renews has ended',
  defaultTerms({ end_date: inDays(10) }, NOW).respondBy, inDays(10))

// ── The suggested rent ────────────────────────────────────────────────────
check('with no comps it holds rather than inventing a rise',
  suggestRenewalRent(900, null).rent, 900)
check('and says so', suggestRenewalRent(900, null).changePct, 0)
// Half of a $100 gap is $950, but 5% of $900 is $945 — so the cap bites first,
// and the cap is the point.
check('under market, it moves toward the gap but the cap wins',
  suggestRenewalRent(900, 1000).rent, 945)
check('a narrower gap is halved as described, with the cap slack',
  suggestRenewalRent(900, 940).rent, 920)
check('but never further than the cap',
  suggestRenewalRent(900, 5000).rent, Math.round(900 * (1 + SUGGESTED_INCREASE_CAP_PCT / 100)))
check('the cap really is 5%', suggestRenewalRent(900, 5000).changePct, 5)
check('and never past the market itself',
  suggestRenewalRent(900, 910).rent <= 910, true)
check('at market, hold', suggestRenewalRent(900, 900).rent, 900)
check('slightly over market, hold', suggestRenewalRent(900, 870).rent, 900)
check('well over market, meet them part way',
  suggestRenewalRent(1000, 800).rent, 900)
check('a lease with no rent on file suggests nothing confident',
  suggestRenewalRent(0, 900).changePct, 0)

// ── The breakeven, which is the number that changes minds ─────────────────
{
  // $40 more on a 12-month term = $480. At $900/mo, a day costs $29.56.
  const m = turnoverMath({
    currentRent: 900, proposedRent: 940,
    termStart: '2027-08-01', termEnd: '2028-07-31',
    marketRent: 900,
  })
  check('a twelve-month term is twelve months', m.termMonths, 12)
  check('the term gain is the rise times the term', m.termGain, 480)
  check('and 16 days empty erases it', m.breakevenVacancyDays, 16)
  check('the vacancy cost is the re-letting rent', m.monthlyVacancyCost, 900)
  check('16 days is called a fair trade, with the number stated',
    m.verdict.includes('16 days of vacancy'), true)
}
{
  // $20 more over 12 months is $240 — eight days empty and it is gone.
  const m = turnoverMath({
    currentRent: 900, proposedRent: 920,
    termStart: '2027-08-01', termEnd: '2028-07-31',
    marketRent: 900,
  })
  check('a very thin gain breaks even in days, not weeks', m.breakevenVacancyDays, 8)
  check('and is called out as a gamble', m.verdict.includes('gambling'), true)
}
{
  const m = turnoverMath({
    currentRent: 900, proposedRent: 900,
    termStart: '2027-08-01', termEnd: '2028-07-31',
  })
  check('no rise means no breakeven to state', m.breakevenVacancyDays, null)
  check('and the verdict is about what renewing avoids',
    m.verdict.includes('no vacancy'), true)
}
{
  const m = turnoverMath({
    currentRent: 900, proposedRent: 1200,
    termStart: '2027-08-01', termEnd: '2028-07-31',
    marketRent: 1200,
  })
  check('a large rise survives a long vacancy', m.breakevenVacancyDays > 45, true)
  check('and is told the rent is not the risk',
    m.verdict.includes('not what is at risk'), true)
}
{
  const m = turnoverMath({
    currentRent: 900, proposedRent: 850,
    termStart: '2027-08-01', termEnd: '2028-07-31',
  })
  check('a reduction is a negative term figure', m.termGain, -600)
  check('with no breakeven', m.breakevenVacancyDays, null)
}
{
  // The re-letting rent, not the current one, sets the cost of a day empty.
  const cheap = turnoverMath({
    currentRent: 900, proposedRent: 940,
    termStart: '2027-08-01', termEnd: '2028-07-31', marketRent: 600,
  })
  check('a weaker market makes a vacancy cheaper, so the rise survives longer',
    cheap.breakevenVacancyDays > 16, true)
  check('and the vacancy cost reflects the market, not the sitting rent',
    cheap.monthlyVacancyCost, 600)
}

// ── Report ────────────────────────────────────────────────────────────────
console.log(`\n${pass.length} passed`)
if (fail.length) {
  console.log(`\n${fail.length} FAILED:`)
  for (const f of fail) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(
  `✓ renewals open at ${WINDOW_OPENS_DAYS} days, derive expiry rather than ` +
  `storing it, leave no gap between terms, cap a suggested rise at ` +
  `${SUGGESTED_INCREASE_CAP_PCT}%, and state the vacancy that erases it\n`
)
