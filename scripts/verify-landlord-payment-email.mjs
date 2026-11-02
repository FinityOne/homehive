/**
 * Proves the landlord's payment notification says the true thing.
 *
 * This email is the only place most landlords ever see a payment, so the facts
 * it asserts have to survive the awkward shapes: rent paid early, rent cleared
 * weeks late, a payment that covers two months at once, a split plan where one
 * roommate is square and the other is not, an ACH debit that bounced, and a
 * late fee riding along with the rent it was charged on.
 *
 * Pure builders, so no database and no network.
 *
 * Run: npm run verify:landlord-email
 */
const { buildLandlordRentPaidEmail, daysOffDue, timingLabel } =
  await import('../src/lib/rentPaymentEmails.ts')

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}
const has = (name, hay, needle) => check(name, hay.includes(needle), true)
const hasnt = (name, hay, needle) => check(name, hay.includes(needle), false)

/** The settlement instant every case below is measured against. */
const PAID_ON = new Date(2026, 9, 6, 14, 30) // 6 Oct 2026, local

const base = {
  landlordName: 'Dana Whitfield',
  tenantName: 'Maya Osei',
  propertyName: 'Oakwood House',
  planName: 'Unit 2B · 2026–27',
  event: 'paid',
  rows: [{ label: 'Rent — October 2026', amount: 1200, dueDate: '2026-10-01', kind: 'rent' }],
  rent: 1200,
  method: 'card',
  paidOn: PAID_ON,
  tenantOutstanding: 0,
  planOutstanding: 0,
  planUrl: 'https://homehive.live/landlord/financials?plan=p1',
  reference: 'pi_123',
}

// ── 1. Timing arithmetic ──────────────────────────────────────────────────
{
  check('due date 5 days before settlement reads as 5 late', daysOffDue('2026-10-01', PAID_ON), 5)
  check('settled on the due date is 0', daysOffDue('2026-10-06', PAID_ON), 0)
  check('settled before the due date is negative', daysOffDue('2026-10-10', PAID_ON), -4)
  // An 11pm card on the due date must not read as late by a rounding error.
  check('late evening on the due date is still 0',
    daysOffDue('2026-10-06', new Date(2026, 9, 6, 23, 59)), 0)
  check('one day late is singular', timingLabel(1).text, '1 day late')
  check('one day early is singular', timingLabel(-1).text, '1 day early')
  check('exactly on time is not called early', timingLabel(0).text, 'on the due date')
}

// ── 2. Rent paid late ─────────────────────────────────────────────────────
{
  const e = buildLandlordRentPaidEmail(base)
  has('late: subject carries the timing', e.subject, '(5 days late)')
  has('late: subject still leads with the amount', e.subject, '$1,200.00 from Maya Osei')
  has('late: body says how late', e.html, '5 days late')
  has('late: row shows the due date', e.html, 'Due Oct 1')
  has('late: the lease is named, not just the property', e.html, 'Unit 2B · 2026–27')
  has('late: text part says it too', e.text, 'Timing: 5 days late')
}

// ── 3. Rent paid early ────────────────────────────────────────────────────
{
  const e = buildLandlordRentPaidEmail({
    ...base,
    rows: [{ label: 'Rent — November 2026', amount: 1200, dueDate: '2026-11-01', kind: 'rent' }],
  })
  has('early: subject says early', e.subject, '(26 days early)')
  hasnt('early: nothing reads as late', e.subject, 'late')
}

// ── 4. Two months at once — the worst one sets the tone ───────────────────
{
  const e = buildLandlordRentPaidEmail({
    ...base,
    rent: 2400,
    rows: [
      { label: 'Rent — September 2026', amount: 1200, dueDate: '2026-09-01', kind: 'rent' },
      { label: 'Rent — October 2026', amount: 1200, dueDate: '2026-10-01', kind: 'rent' },
    ],
  })
  // Clearing September 35 days late while paying October 5 late is not "5 late".
  has('catch-up: headline takes the worst charge', e.subject, '(35 days late)')
  has('catch-up: each month still shows its own timing', e.html, '5 days late')
  has('catch-up: and the older one', e.html, '35 days late')
}

// ── 5. A late fee rides along ─────────────────────────────────────────────
{
  const e = buildLandlordRentPaidEmail({
    ...base,
    rent: 1275,
    lateFeeCollected: 75,
    rows: [
      { label: 'Rent — October 2026', amount: 1200, dueDate: '2026-10-01', kind: 'rent' },
      { label: 'Late fee — October 2026 rent', amount: 75, dueDate: '2026-10-01', kind: 'late_fee' },
    ],
  })
  has('fee: called out as the landlord\'s money', e.html, 'that part is your money')
  has('fee: amount named', e.html, '<strong>$75.00</strong>')
  has('fee: text part says it', e.text, 'Includes $75.00 of late fees')
  // A fee is late by definition; saying so would be circular.
  check('fee: the fee row is not itself called late',
    e.html.split('Late fee — October 2026 rent')[1].slice(0, 220).includes('days late'), false)
}

// ── 6. A split plan ───────────────────────────────────────────────────────
{
  const e = buildLandlordRentPaidEmail({
    ...base,
    planOutstanding: 600,
    tenantBalances: [
      { name: 'Maya Osei', outstanding: 0, isPayer: true },
      { name: 'Tom Reyes', outstanding: 600, isPayer: false },
    ],
    nextCharge: { label: 'Rent — November 2026', dueDate: '2026-11-01', amount: 1200 },
  })
  has('split: the roommate who still owes is named', e.html, 'Tom Reyes')
  has('split: with their balance', e.html, '$600.00')
  has('split: next charge is previewed', e.html, 'Next due · Nov 1')
  has('split: text part lists the roommate', e.text, 'of which Tom Reyes owes $600.00')
  has('split: text part previews next', e.text, 'Next due: Rent — November 2026 — $1,200.00 on Nov 1')

  // A single-payer plan must not print the same number twice under two labels,
  // so a lone payer adds no breakdown row at all.
  const solo = buildLandlordRentPaidEmail({
    ...base,
    tenantBalances: [{ name: 'Maya Osei', outstanding: 0, isPayer: true }],
  })
  const noBalances = buildLandlordRentPaidEmail(base)
  check('solo: renders exactly as a plan with no breakdown at all',
    solo.html === noBalances.html, true)
  check('solo: and so does the text part', solo.text === noBalances.text, true)
}

// ── 7. Track record ───────────────────────────────────────────────────────
{
  const e = buildLandlordRentPaidEmail({
    ...base,
    payerHistory: { settled: 6, onTime: 5, streak: 3 },
  })
  has('history: the ratio is stated', e.html, '5 of their last 6')
  has('history: the streak is stated', e.html, '3 in a row')

  // One payment is not a habit.
  const thin = buildLandlordRentPaidEmail({
    ...base,
    payerHistory: { settled: 1, onTime: 1, streak: 1 },
  })
  hasnt('history: a single data point says nothing', thin.html, 'of their last')

  // A streak of one is a fact, not an achievement worth a clause.
  const nostreak = buildLandlordRentPaidEmail({
    ...base,
    payerHistory: { settled: 4, onTime: 2, streak: 1 },
  })
  has('history: thin streak still reports the ratio', nostreak.html, '2 of their last 4')
  hasnt('history: but claims no run', nostreak.html, 'in a row')
}

// ── 8. A bounced debit claims nothing ─────────────────────────────────────
{
  const e = buildLandlordRentPaidEmail({
    ...base,
    event: 'failed',
    method: 'ach',
    lateFeeCollected: 0,
  })
  has('failed: says it was returned', e.html, 'Returned')
  // Nothing was collected, so "5 days late" would be a claim about a payment
  // that never happened.
  hasnt('failed: no timing in the subject', e.subject, 'days late')
  hasnt('failed: no timing on the row', e.html, 'days late')
  has('failed: the due date is still shown', e.html, 'Due Oct 1')
}

// ── 9. Rows with no due date degrade quietly ──────────────────────────────
{
  const e = buildLandlordRentPaidEmail({
    ...base,
    rows: [{ label: 'Security deposit', amount: 1200, kind: 'charge' }],
  })
  has('undated: the charge is still listed', e.html, 'Security deposit')
  hasnt('undated: no invented due date', e.html, 'Due ')
  hasnt('undated: no timing in the subject', e.subject, 'late')
  check('undated: builds without throwing', typeof e.html, 'string')
}

// ── 10. Nothing unescaped reaches the HTML ────────────────────────────────
{
  const e = buildLandlordRentPaidEmail({
    ...base,
    tenantName: 'Mal <script>alert(1)</script>',
    propertyName: 'A & B "House"',
    planName: '<b>unit</b>',
  })
  hasnt('escaping: no raw script tag', e.html, '<script>')
  has('escaping: ampersand escaped', e.html, 'A &amp; B')
  hasnt('escaping: no raw bold from the plan name', e.html, '<b>unit</b>')
}

console.log(`${pass.length} passed`)
for (const p of pass) console.log('  ok   ' + p)
if (fail.length) {
  console.log(`\n${fail.length} FAILED`)
  for (const f of fail) console.log('  FAIL ' + f)
  process.exit(1)
}
console.log('\nall good')
