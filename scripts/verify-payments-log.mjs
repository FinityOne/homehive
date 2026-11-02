/**
 * Proves the payments log: the table a landlord reconciles against their bank.
 *
 * The promises worth pinning down are not arithmetic, they are claims about
 * money that a wrong answer would make the landlord act on:
 *
 *   • An ACH debit still clearing must never be counted as collected. It is
 *     the tenant's money until the bank releases it, and a landlord who reads
 *     it as banked has been told they are richer than they are.
 *   • A bounced payment must appear, with its charges, and must not add to any
 *     collected figure. This is the state the charge rows cannot remember at
 *     all, which is the reason the attempts table exists.
 *   • "Late" must be judged on when the tenant *sent* the money, never on when
 *     the bank released it. Six ACH payments on this database were sent before
 *     their due date and landed days later; charging that lag to the tenant is
 *     the bug this rule exists to prevent.
 *   • Filtering must never silently change a total: the figures are computed
 *     from the rows in view, and the row count must say what was narrowed.
 *   • The export must be exactly the rows on screen, in the order on screen.
 *
 * Pure functions over hand-built plans, so no database and no network.
 *
 * Run: node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/verify-payments-log.mjs
 */
const {
  paymentLog, filterPayments, paymentTotals, stateCounts, leaseOptions, paymentsCsv,
} = await import('../src/lib/paymentsLog.ts')
const { isPastDue, daysPastDue, daysPastDueOn, lateFeeDue } =
  await import('../src/lib/rentPayments.ts')

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

const NOW = new Date('2026-11-02T12:00:00Z')

/** One rent charge, with only the columns the log reads. */
const rent = over => ({
  id: over.id,
  plan_tenant_id: 'payer-1',
  due_date: '2026-10-01',
  amount: 800,
  paid_amount: 0,
  paid_date: null,
  submitted_at: null,
  settled_at: null,
  status: 'pending',
  late_fee_paid: 0,
  late_fees_applied: 0,
  payment_method: null,
  processing_fee: 0,
  recorded_by: null,
  stripe_payment_intent_id: null,
  reminder_sent_at: null,
  reminder_count: 0,
  late_fee_reminder_sent_at: null,
  late_fee_reminder_count: 0,
  notes: null,
  ...over,
})

const plan = scheduled => ({
  id: 'plan-1',
  owner_id: 'owner-1',
  property_id: 'prop-1',
  lease_id: 'lease-1',
  name: 'Unit 4 — 2026/27',
  due_day: 1,
  notes: null,
  created_at: '2026-08-01T00:00:00Z',
  property: { id: 'prop-1', name: 'Palo Verde', slug: 'palo-verde' },
  lease: { id: 'lease-1', start_date: '2026-08-01', end_date: '2027-07-31', rent_amount: 800 },
  tenants: [{ id: 'payer-1', name: 'Dana Reyes', email: 'dana@example.com', monthly_total: 800, status: 'active', line_items: [] }],
  late_fee_rule: null,
  utilities: [],
  scheduled_payments: scheduled,
  special_payments: [],
})

// A card payment that landed the day it was sent; an ACH debit sent on the 1st
// and released by the bank on the 6th; and an ACH debit still in flight.
const plans = [plan([
  rent({
    id: 'card-oct', status: 'paid', paid_amount: 800, paid_date: '2026-10-01',
    submitted_at: '2026-10-01T17:07:15Z', settled_at: '2026-10-01T17:07:15Z',
    payment_method: 'card', processing_fee: 40, recorded_by: 'tenant',
    stripe_payment_intent_id: 'pi_card',
  }),
  rent({
    id: 'ach-oct', due_date: '2026-10-01', status: 'paid', paid_amount: 800,
    paid_date: '2026-10-06', submitted_at: '2026-10-01T09:00:00Z',
    settled_at: '2026-10-06T13:00:00Z', payment_method: 'ach', processing_fee: 16,
    recorded_by: 'tenant', stripe_payment_intent_id: 'pi_ach_cleared',
  }),
  rent({
    id: 'ach-nov', due_date: '2026-11-01', status: 'processing', amount: 870,
    paid_amount: 0, submitted_at: '2026-11-02T01:08:04Z', payment_method: 'ach',
    processing_fee: 17.4, recorded_by: 'tenant', stripe_payment_intent_id: 'pi_ach_flight',
  }),
  // Recorded by hand, off-platform: no submission instant, and the landlord's
  // own date is the only fact about when it arrived.
  rent({
    id: 'manual-sep', due_date: '2026-09-01', status: 'paid', paid_amount: 800,
    paid_date: '2026-09-03', payment_method: 'manual_zelle', recorded_by: 'landlord',
  }),
])]

// The bounce. Its charges were reset to pending by `revertRentPayment`, so the
// only record of it is here.
const attempts = [{
  plan_id: 'plan-1',
  payment_intent_id: 'pi_bounced',
  method: 'ach',
  status: 'failed',
  amount: 800,
  submitted_at: '2026-08-31T18:00:00Z',
  cleared_at: null,
  failed_at: '2026-09-05T11:00:00Z',
  failure_code: 'insufficient_funds',
  failure_message: 'The bank account has insufficient funds, so the debit was returned.',
  items: [{ kind: 'rent', id: 'bounced-aug', label: 'August 2026 rent', due_date: '2026-08-01', amount: 800 }],
}]

const rows = paymentLog(plans, attempts)
const byKey = k => rows.find(r => r.key === k)

// ── What each payment is ───────────────────────────────────────────────────
check('every payment is listed once', rows.length, 5)
check('newest first', rows[0].key, 'rent-ach-nov')
check('the card payment cleared', byKey('rent-card-oct').state, 'cleared')
check('the ACH debit in flight is clearing', byKey('rent-ach-nov').state, 'clearing')
check('the bounce is listed as failed', rows.filter(r => r.state === 'failed').length, 1)
check('a bounced payment keeps what it was for',
  rows.find(r => r.state === 'failed').label, 'August 2026 rent')
check('a bounced payment keeps the bank\'s reason',
  rows.find(r => r.state === 'failed').failureReason,
  'The bank account has insufficient funds, so the debit was returned.')
check('a hand-recorded payment says so', byKey('rent-manual-sep').byHand, true)

// ── The bank's lag is the bank's, not the tenant's ─────────────────────────
check('the clearing lag is reported', byKey('rent-ach-oct').clearingDays, 5)
check('a card payment has no lag', byKey('rent-card-oct').clearingDays, 0)
// Sent on the 1st, released on the 6th. Judged on the 1st, so: on time.
check('ACH is judged on the day it was sent, not the day it landed',
  byKey('rent-ach-oct').daysLate, 0)
// Submitted 2026-11-02T01:08Z — which is 6:08pm on 1 November in Phoenix, the
// day it was due. On time. Reading that instant in UTC (as this did before)
// called it a day late, which is precisely what the whole-due-day rule forbids;
// the three ACH debits in flight on the live database all look like this.
check('an in-flight debit sent on the evening of the due date is on time',
  byKey('rent-ach-nov').daysLate, 0)

// A debit that genuinely missed the day: 12:30am Phoenix on 3 November against
// rent due on the 1st.
{
  const late = paymentLog([plan([rent({
    id: 'truly-late', due_date: '2026-11-01', status: 'processing', amount: 800,
    paid_amount: 0, submitted_at: '2026-11-03T07:30:00Z', payment_method: 'ach',
    processing_fee: 16, recorded_by: 'tenant', stripe_payment_intent_id: 'pi_late',
  })])], [])[0]
  check('a debit sent two days after the due date says two days', late.daysLate, 2)
}

// ── Money ──────────────────────────────────────────────────────────────────
const t = paymentTotals(rows)
check('collected counts only what landed', t.cleared, 2400)
check('money in flight is reported apart', t.clearing, 870)
check('a bounced payment is never collected', t.failed, 800)
check('no processor surcharge reaches the landlord\'s books', 'surcharges' in t, false)
// One cleared ACH debit, held five days. Card payments are deliberately not in
// the average: they have no lag to average.
check('the average ACH lag', t.avgClearingDays, 5)
check('late arrivals are counted', t.lateCount, 1)

// ── Filters ────────────────────────────────────────────────────────────────
const counts = stateCounts(rows)
check('the state badges add up', [counts.all, counts.cleared, counts.clearing, counts.failed], [5, 3, 1, 1])

const f = { state: 'all', method: 'all', range: 'all', planId: '', query: '' }
check('filtering to failures shows only the bounce',
  filterPayments(rows, { ...f, state: 'failed' }, NOW).map(r => r.label), ['August 2026 rent'])
check('filtering to bank transfers excludes the card and the manual entry',
  filterPayments(rows, { ...f, method: 'ach' }, NOW).length, 3)
check('filtering to hand-recorded finds the Zelle payment',
  filterPayments(rows, { ...f, method: 'manual' }, NOW).map(r => r.key), ['rent-manual-sep'])
// The window is measured on when the money *moved* — landed, or was sent and is
// on its way — not on the due date. So October's rent, released by the bank on
// the 6th, is inside a 30-day window read on November 2nd, and August's bounce
// and September's hand-recorded payment are outside it.
check('a window is measured on when the money moved',
  filterPayments(rows, { ...f, range: '30' }, NOW).map(r => r.key),
  ['rent-ach-nov', 'rent-ach-oct'])
check('searching matches the payer', filterPayments(rows, { ...f, query: 'dana' }, NOW).length, 4)
check('searching matches the property', filterPayments(rows, { ...f, query: 'palo verde' }, NOW).length, 5)
check('searching something absent narrows to nothing',
  filterPayments(rows, { ...f, query: 'no such tenant' }, NOW).length, 0)
check('an unrelated lease filter hides everything',
  filterPayments(rows, { ...f, planId: 'plan-other' }, NOW).length, 0)

// Narrowing must move the totals *with* the rows, never leave a stale figure.
const clearedOnly = paymentTotals(filterPayments(rows, { ...f, state: 'cleared' }, NOW))
check('totals follow the filter', [clearedOnly.cleared, clearedOnly.clearing, clearedOnly.failed],
  [2400, 0, 0])

check('the lease picker names the property and the lease',
  leaseOptions(rows), [{ id: 'plan-1', label: 'Palo Verde — Unit 4 — 2026/27' }])

// ── Export ─────────────────────────────────────────────────────────────────
const csv = paymentsCsv(filterPayments(rows, { ...f, state: 'failed' }, NOW))
const lines = csv.split('\n')
check('the export is exactly the rows in view', lines.length, 2)
check('the export names the state', lines[1].startsWith('Failed,Rent,'), true)
check('the export quotes a reason containing a comma',
  csv.includes('"The bank account has insufficient funds, so the debit was returned."'), true)

// ── Nothing is late until the whole due day has passed ────────────────────
//
// Rent due on 1 November is on time at 11:59pm on 1 November and late at
// 12:01am on 2 November — judged in America/Phoenix, where the properties are.
// Two ways this was wrong before, both of which showed a tenant as late while
// they still had time: comparing the due date's midnight to `now` (red all
// through the due day), and reading the day in UTC or in the landlord's own
// timezone (which in Tempe rolls over at 5pm the day before).
{
  const DUE = '2026-11-01'
  // Phoenix is UTC-7 with no daylight saving, so these are 1 Nov local.
  const dueDayMorning = new Date('2026-11-01T15:00:00Z') //  8:00am Phoenix, 1 Nov
  const dueDayEvening = new Date('2026-11-02T01:00:00Z') //  6:00pm Phoenix, 1 Nov
  const dueDayLastMin = new Date('2026-11-02T06:58:00Z') // 11:58pm Phoenix, 1 Nov
  const justAfter     = new Date('2026-11-02T07:02:00Z') // 12:02am Phoenix, 2 Nov

  check('not late on the morning rent is due',       isPastDue(DUE, dueDayMorning), false)
  // The one that mattered: UTC has already rolled over to the 2nd here.
  check('not late at 6pm on the due date',           isPastDue(DUE, dueDayEvening), false)
  check('not late one minute before midnight',       isPastDue(DUE, dueDayLastMin), false)
  check('late just after midnight the day after',    isPastDue(DUE, justAfter),     true)

  check('no days late during the due day',           daysPastDue(DUE, dueDayEvening), 0)
  check('one day late the day after',                daysPastDue(DUE, justAfter),     1)
  check('a payment sent on the due date is on time', daysPastDueOn(DUE, '2026-11-01'), 0)
  check('a payment sent the next day is one day late', daysPastDueOn(DUE, '2026-11-02'), 1)

  // And the money follows the same line: no fee may exist during the due day.
  const DAILY = { grace_period_days: 0, fee_amount: 15, frequency_days: 1, max_total_fees: null }
  const unpaid = {
    status: 'pending', due_date: DUE, paid_date: null, submitted_at: null,
    amount: 800, paid_amount: 0,
  }
  check('no late fee at 6pm on the due date',   lateFeeDue(DAILY, unpaid, dueDayEvening), 0)
  check('no late fee one minute before midnight', lateFeeDue(DAILY, unpaid, dueDayLastMin), 0)
  check('one period of fee the day after',      lateFeeDue(DAILY, unpaid, justAfter),     15)

  // A tenant who paid at 6pm on the due date: on time, and no fee, even though
  // UTC calls it the 2nd.
  const sentOnDueDay = {
    status: 'paid', due_date: DUE, paid_date: '2026-11-01',
    submitted_at: '2026-11-02T01:00:00Z', amount: 800, paid_amount: 800,
  }
  check('paying at 6pm on the due date owes nothing',
    lateFeeDue(DAILY, sentOnDueDay, justAfter), 0)

  // The payments log itself, on the same facts.
  const evening = paymentLog([plan([rent({
    id: 'evening', due_date: DUE, status: 'paid', paid_amount: 800,
    paid_date: '2026-11-01', submitted_at: '2026-11-02T01:00:00Z',
    settled_at: '2026-11-02T01:00:00Z', payment_method: 'card',
    processing_fee: 40, recorded_by: 'tenant', stripe_payment_intent_id: 'pi_eve',
  })])], [])[0]
  check('the log reads a 6pm due-day payment as on time', evening.daysLate, 0)
  check('and does not count it among late arrivals',
    paymentTotals([evening]).lateCount, 0)
}

console.log(`${pass.length} passed`)
for (const p of pass) console.log('  ok   ' + p)
if (fail.length) {
  console.log(`\n${fail.length} FAILED`)
  for (const f2 of fail) console.log('  FAIL ' + f2)
  process.exit(1)
}
console.log('\nall good')
