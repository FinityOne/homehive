/**
 * Proves the two rules that decide *when* rent counts as late.
 *
 *   1. The fee starts after **midnight on the due date, where the property is**
 *      — not when UTC rolls over. The server runs in UTC, so before this was
 *      fixed a Tempe tenant was charged $15 at 5pm on the very day rent was
 *      due, and three of them were being charged it when this was written.
 *
 *   2. A payment **submitted** by the deadline is on time, however long it
 *      takes to clear. ACH settles three to ten days after it is sent, and
 *      measuring to the clearing date billed tenants for the banking system's
 *      clearing window at $15 a day — $585 of it on one lease.
 *
 * Every case below is a real shape from the live rows. Pure functions, so no
 * database and no network.
 *
 * Run: npm run verify:late-fees
 */
const {
  explainLateFee, lateFeeOutstanding, lateFeeAsOf, lateFeeFrozen, billingToday,
  BILLING_TIME_ZONE,
} = await import('../src/lib/rentPayments.ts')

// The rule every plan here uses: $15 a day, no grace, no ceiling.
const DAILY = { grace_period_days: 0, fee_amount: 15, frequency_days: 1, max_total_fees: null }

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

// ── 1. Midnight is local midnight ─────────────────────────────────────────
//
// Phoenix is UTC-7 year round. 2026-11-02T05:25Z is 2026-11-01 22:25 in Tempe:
// rent due on the 1st is NOT yet late, though the server's own date says the 2nd.
{
  check('billing timezone is Arizona', BILLING_TIME_ZONE, 'America/Phoenix')

  const lateEveningOfDueDate = new Date('2026-11-02T05:25:44Z')
  check('late evening on the due date is still the due date',
    billingToday(lateEveningOfDueDate), '2026-11-01')

  const unpaid = {
    status: 'pending', due_date: '2026-11-01', paid_date: null,
    amount: 870.66, paid_amount: 0, late_fee_paid: 0,
  }
  const x = explainLateFee(DAILY, unpaid, 0, lateEveningOfDueDate)
  check('unpaid rent owes nothing before local midnight', x.outstanding, 0)
  check('…and is not yet one day past due', x.daysPastDue, 0)

  // 00:05 local on the 2nd — one minute past the deadline, one day's fee.
  const justAfterMidnight = new Date('2026-11-02T07:05:00Z')
  check('local midnight has rolled over', billingToday(justAfterMidnight), '2026-11-02')
  const y = explainLateFee(DAILY, unpaid, 0, justAfterMidnight)
  check('one day accrues just after local midnight', [y.daysPastDue, y.outstanding], [1, 15])

  // The bug this replaces, stated directly: at 17:30 local on the due date the
  // server's own UTC date is already the 2nd, so the old code charged a day's
  // fee six and a half hours before the deadline.
  const eveningOfDueDate = new Date('2026-11-02T00:30:00Z') // 17:30 local on the 1st
  check('the server\'s UTC date is already tomorrow',
    eveningOfDueDate.toISOString().split('T')[0], '2026-11-02')
  check('…but the deadline has not passed where the rent is due',
    billingToday(eveningOfDueDate), '2026-11-01')
  check('…so nothing is owed yet',
    lateFeeOutstanding(DAILY, unpaid, 0, eveningOfDueDate), 0)
}

// ── 2. Submitted on the deadline, cleared days later ──────────────────────
//
// Abigail's October rent: ACH sent 2026-10-01 10:06 local, cleared the 7th.
// Measured to the clearing date it carried $90. It was on time.
{
  const achOnTime = {
    status: 'paid', due_date: '2026-10-01',
    paid_date: '2026-10-07',                    // when the bank released it
    submitted_at: '2026-10-01T17:06:05Z',       // 10:06 local, on the deadline
    amount: 766, paid_amount: 766, late_fee_paid: 0,
  }
  check('fee is measured to the submission date', lateFeeAsOf(achOnTime), '2026-10-01')
  const x = explainLateFee(DAILY, achOnTime, 0)
  check('six clearing days cost the tenant nothing', x.outstanding, 0)
  check('…and it reads as zero days late', x.daysPastDue, 0)

  // Without the submission instant this is the old, wrong answer — kept as a
  // case so a regression that drops the column from a `select` is visible.
  const { submitted_at: _omitted, ...noSubmission } = achOnTime
  check('dropping submitted_at reinstates the clearing-window bug',
    explainLateFee(DAILY, noSubmission, 0).outstanding, 90)
}

// ── 3. Submitted at the last moment of the due date ───────────────────────
//
// Elise's November rent: card at 17:02 local on the 1st. Settlement recorded
// paid_date 2026-11-02 because the server was already on the next UTC day.
{
  const lastMinuteCard = {
    status: 'paid', due_date: '2026-11-01',
    paid_date: '2026-11-02',                    // the UTC date, not hers
    submitted_at: '2026-11-02T00:03:46Z',       // 17:03 local on the 1st
    amount: 720.67, paid_amount: 720.67, late_fee_paid: 0,
  }
  check('a card paid on the due date owes nothing',
    lateFeeOutstanding(DAILY, lastMinuteCard, 0), 0)
  check('…measured to her date, not the server\'s',
    lateFeeAsOf(lastMinuteCard), '2026-11-01')
}

// ── 4. An in-flight debit stops the clock ─────────────────────────────────
//
// `processing` with no paid_date used to be measured against *today*, so the
// fee climbed every day the bank took on rent the tenant had already sent.
{
  const inFlight = {
    status: 'processing', due_date: '2026-11-01', paid_date: null,
    submitted_at: '2026-11-02T03:54:51Z',       // 20:54 local on the 1st
    amount: 770.67, paid_amount: 0, late_fee_paid: 0,
  }
  const fourDaysLater = new Date('2026-11-06T12:00:00Z')
  check('an in-flight debit owes nothing four days on',
    lateFeeOutstanding(DAILY, inFlight, 0, fourDaysLater), 0)
  check('its fee counts as frozen though the rent has not landed',
    lateFeeFrozen(inFlight), true)

  // A debit sent two days late freezes at two days — it does not keep growing.
  const lateButSubmitted = { ...inFlight, submitted_at: '2026-11-03T18:00:00Z' }
  check('a late submission freezes at the day it was sent',
    lateFeeOutstanding(DAILY, lateButSubmitted, 0, fourDaysLater), 30)
}

// ── 5. A bounce withdraws the grace ───────────────────────────────────────
//
// `revertRentPayment` clears `submitted_at`, so a failed debit stops being
// evidence of anything and the fee resumes from the due date.
{
  const bounced = {
    status: 'pending', due_date: '2026-11-01', paid_date: null,
    submitted_at: null, amount: 770.67, paid_amount: 0, late_fee_paid: 0,
  }
  const sixDaysLater = new Date('2026-11-07T12:00:00Z')
  check('a bounced debit accrues again from the due date',
    lateFeeOutstanding(DAILY, bounced, 0, sixDaysLater), 90)
  check('…and is no longer frozen', lateFeeFrozen(bounced), false)
}

// ── 6. Manual rent still falls back to paid_date ───────────────────────────
//
// A Zelle transfer the landlord typed in has no submission instant, and
// inventing one would be a lie. Their verdict about when it arrived stands.
{
  const manual = {
    status: 'paid', due_date: '2026-09-01', paid_date: '2026-09-04',
    submitted_at: null, payment_method: 'manual_zelle',
    amount: 736, paid_amount: 736, late_fee_paid: 0,
  }
  check('manual rent is judged on paid_date', lateFeeAsOf(manual), '2026-09-04')
  check('…and owes three days', lateFeeOutstanding(DAILY, manual, 0), 45)
}

// ── 7. Genuinely late is still genuinely late ─────────────────────────────
//
// The fix must not forgive everything. Gina's October rent was submitted on the
// 3rd — two days after the deadline — and owes exactly those two days.
{
  const reallyLate = {
    status: 'paid', due_date: '2026-10-01', paid_date: '2026-10-08',
    submitted_at: '2026-10-03T21:11:33Z',       // 14:11 local on the 3rd
    amount: 766, paid_amount: 766, late_fee_paid: 0,
  }
  const x = explainLateFee(DAILY, reallyLate, 0)
  check('two days late owes two days', [x.daysPastDue, x.outstanding], [2, 30])
  check('…not the seven days it took to clear', x.asOfDate, '2026-10-03')
}

console.log(`${pass.length} passed`)
for (const p of pass) console.log('  ok   ' + p)
if (fail.length) {
  console.log(`\n${fail.length} FAILED`)
  for (const f of fail) console.log('  FAIL ' + f)
  process.exit(1)
}
console.log('\nall good')
