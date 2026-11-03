/**
 * Proves what a tenant is shown they owe — `src/lib/tenantCharges.ts`.
 *
 * The landlord's ledger had been verified for a while; the tenant's half of the
 * same arithmetic had not, and it was wrong in three ways a tenant could see:
 *
 *   1. **The clock.** The dashboard tile read today from
 *      `new Date().toISOString()` — midnight in UTC, which in Tempe arrives at
 *      5pm the afternoon before. From 5pm on the 31st the tile counted the
 *      1st's rent as owed while the lease page, using `billingToday`, did not.
 *      One tenant, two balances, on the same screen.
 *
 *   2. **`submitted_at`.** `/api/tenant/lease` ships it and neither tenant
 *      surface passed it into the fee arithmetic, though `/api/tenant/pay`
 *      does. An ACH debit submitted on the due date and still clearing has no
 *      `paid_date`, so the fee was measured to *today* and grew every day the
 *      bank took, on rent already sent on time — and the portal quoted a
 *      figure larger than the card would be charged.
 *
 *   3. **One calculation.** Both surfaces had their own copy, which is how 1
 *      and 2 diverged. There is now one, and this file is what holds it.
 *
 * Every case is a real shape from the live rows. Pure functions: no database,
 * no network.
 *
 * Run: npm run verify:tenant-charges
 */
const { tenantCharges } = await import('../src/lib/tenantCharges.ts')

/** The rule every plan on this database uses: $15/day, no grace, no ceiling. */
const DAILY = { grace_period_days: 0, fee_amount: 15, frequency_days: 1, max_total_fees: null }

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

const rent = (over = {}) => ({
  id: 'sp1', due_date: '2026-11-01', amount: 900, status: 'pending',
  paid_amount: 0, paid_date: null, submitted_at: null,
  late_fee_paid: 0, late_fee_waived: 0, late_fee_waiver: null,
  ...over,
})

// ── 1. The deadline: the whole due day belongs to the tenant ───────────────
//
// Phoenix is UTC-7 year round, so 2026-11-02T05:00Z is 10pm on the 1st there.
// The old UTC reading called that the 2nd and charged a day's fee for it.
{
  const tenPmOnTheDueDate = new Date('2026-11-02T05:00:00Z')
  const c = tenantCharges([rent()], [], DAILY, tenPmOnTheDueDate)
  check('10pm on the due date: the day has not rolled over', c.today, '2026-11-01')
  check('…no late fee yet', c.lateFees.length, 0)
  check('…rent is owed, but not late', [c.owed.length, c.owed[0]?.daysLate], [1, 0])
  check('…and the balance is the rent alone', c.totalOwed, 900)

  // One minute past midnight on the 2nd, where the property is.
  const justAfter = new Date('2026-11-02T07:01:00Z')
  const d = tenantCharges([rent()], [], DAILY, justAfter)
  check('12:01am the next day: now it is late', d.today, '2026-11-02')
  check('…exactly one day of fee', d.lateFees[0]?.lateFee, 15)
  check('…and the row says one day late', d.lateFees[0]?.daysLate, 1)
  check('…the balance is rent + fee', d.totalOwed, 915)

  // The last UTC instant that is still the due day in Tempe, and the first
  // that is not. The fee may turn on between these two and nowhere else.
  check('11:59pm on the due date owes nothing',
    tenantCharges([rent()], [], DAILY, new Date('2026-11-02T06:59:00Z')).lateFeeTotal, 0)
  check('12:00am the day after owes one day',
    tenantCharges([rent()], [], DAILY, new Date('2026-11-02T07:00:00Z')).lateFeeTotal, 15)
}

// ── 2. An ACH debit sent on time, still clearing ───────────────────────────
//
// The exact shape that cost six payments on the live lease $585 between them.
{
  const inFlight = rent({
    status: 'processing',
    submitted_at: '2026-11-01T18:00:00Z', // 11am on the 1st in Tempe
    paid_date: null,
    paid_amount: 0,
  })
  const fourDaysLater = new Date('2026-11-05T20:00:00Z')
  const c = tenantCharges([inFlight], [], DAILY, fourDaysLater)
  check('submitted on the due date, four days clearing: no fee', c.lateFeeTotal, 0)
  check('…and nothing is listed as owed', c.owed.length, 0)

  // Sent three days late: the fee is the three days, and only the three days —
  // the bank's clearing window afterwards adds nothing.
  const sentLate = rent({
    status: 'processing',
    submitted_at: '2026-11-04T18:00:00Z',
    paid_date: null, paid_amount: 0,
  })
  const l = tenantCharges([sentLate], [], DAILY, fourDaysLater)
  check('sent three days late: three days of fee', l.lateFees[0]?.lateFee, 45)
  const stillLater = tenantCharges([sentLate], [], DAILY, new Date('2026-11-12T20:00:00Z'))
  check('…and a week more of clearing adds nothing', stillLater.lateFees[0]?.lateFee, 45)

  // If the debit bounces, `revertRentPayment` clears `submitted_at`: failed
  // money never bought any grace, so the fee resumes from the due date.
  const bounced = rent({ status: 'pending', submitted_at: null, paid_date: null, paid_amount: 0 })
  check('a bounced debit owes the fee again',
    tenantCharges([bounced], [], DAILY, new Date('2026-11-07T20:00:00Z')).lateFees[0]?.lateFee, 90)
}

// ── 3. A fee is owed after the rent has settled ────────────────────────────
//
// Where every outstanding fee on this platform actually lives: rent accepted in
// full, the fee frozen on the day the money landed, never asked for.
{
  const settledLate = rent({
    status: 'paid', paid_amount: 900,
    paid_date: '2026-11-05', submitted_at: '2026-11-05T19:00:00Z',
  })
  const c = tenantCharges([settledLate], [], DAILY, new Date('2027-01-15T20:00:00Z'))
  check('settled four days late: the fee is still owed', c.lateFees[0]?.lateFee, 60)
  check('…frozen, not grown by the months since', c.lateFees[0]?.daysLate, 4)
  check('…the row knows the rent is paid', c.lateFees[0]?.rentSettled, true)
  check('…no rent is listed as owed', c.owed.length, 0)
  check('…and the balance is the fee alone', c.totalOwed, 60)

  // A fee is never folded into its rent line: it is its own payable charge, so
  // the tenant can settle the rent, the fees, or both.
  check('the fee carries no rent', c.lateFees[0]?.amount, 0)
  check('…and is its own kind', c.lateFees[0]?.kind, 'late_fee')
}

// ── 4. Fee money already paid, and money overpaid as rent ──────────────────
{
  const partPaid = rent({
    status: 'paid', paid_amount: 900, paid_date: '2026-11-05',
    submitted_at: '2026-11-05T19:00:00Z', late_fee_paid: 30,
  })
  check('a part-paid fee bills only the rest',
    tenantCharges([partPaid], [], DAILY, new Date('2026-12-01T20:00:00Z')).lateFees[0]?.lateFee, 30)

  // Two live charges were overpaid by exactly the daily fee: the tenant paid
  // the fee and it landed in `paid_amount`. Billing it again takes the same
  // money twice.
  const overpaid = rent({
    status: 'paid', paid_amount: 960, paid_date: '2026-11-05',
    submitted_at: '2026-11-05T19:00:00Z',
  })
  check('fee money recorded as rent is credited, not billed twice',
    tenantCharges([overpaid], [], DAILY, new Date('2026-12-01T20:00:00Z')).lateFees.length, 0)
}

// ── 5. A waived fee leaves the bill but not the page ───────────────────────
{
  const waived = rent({
    status: 'paid', paid_amount: 900, paid_date: '2026-11-05',
    submitted_at: '2026-11-05T19:00:00Z',
    late_fee_waived: 60,
    late_fee_waiver: { amount: 60, waivedOn: '2026-11-10T12:00:00Z', note: 'First time — no problem.' },
  })
  const c = tenantCharges([waived], [], DAILY, new Date('2026-12-01T20:00:00Z'))
  check('a waived fee is not payable', [c.lateFees.length, c.totalOwed], [0, 0])
  check('…but it is still shown as waived', c.waived[0]?.amount, 60)
  check('…with what the landlord told them', c.waived[0]?.note, 'First time — no problem.')

  // Waived in part: the remainder is still owed, and the write-off still shows.
  const half = rent({
    status: 'paid', paid_amount: 900, paid_date: '2026-11-05',
    submitted_at: '2026-11-05T19:00:00Z',
    late_fee_waived: 30,
    late_fee_waiver: { amount: 30, waivedOn: '2026-11-10T12:00:00Z', note: null },
  })
  const h = tenantCharges([half], [], DAILY, new Date('2026-12-01T20:00:00Z'))
  check('half waived: half still owed', h.lateFees[0]?.lateFee, 30)
  check('…and the waiver is visible too', h.waived.length, 1)
}

// ── 6. Cancelled rent charges nothing at all ───────────────────────────────
{
  const voided = rent({ status: 'voided', paid_amount: 0, paid_date: null })
  const c = tenantCharges([voided], [], DAILY, new Date('2027-01-15T20:00:00Z'))
  check('voided rent: no fee', c.lateFees.length, 0)
  check('…not owed', c.owed.length, 0)
  check('…not upcoming', c.upcoming.length, 0)
  check('…and not in the balance', c.totalOwed, 0)
}

// ── 7. A lease is scheduled a year ahead; only what is due is owed ─────────
{
  const months = ['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01'].map((d, i) => rent({
    id: `sp${i}`, due_date: d,
  }))
  const now = new Date('2026-11-20T20:00:00Z')
  const c = tenantCharges(months, [], DAILY, now)
  check('two months have come due', c.owed.map(r => r.id), ['sp0', 'sp1'])
  check('…two have not', c.upcoming.map(r => r.id), ['sp2', 'sp3'])
  check('…the balance is only what is due', c.totalOwed > 1800, true)
  check('…and future months carry no fee',
    c.lateFees.map(r => r.id).includes('sp2'), false)

  // Oldest month first: a backlog reads as a story.
  check('fees are listed chronologically', c.lateFees.map(r => r.id), ['sp0', 'sp1'])
}

// ── 8. No rule means no fee, ever ─────────────────────────────────────────
{
  const c = tenantCharges([rent()], [], null, new Date('2027-01-15T20:00:00Z'))
  check('no late-fee rule: nothing is assessed', c.lateFeeTotal, 0)
  check('…the rent is still owed', c.totalOwed, 900)
}

// ── 9. The uncapped-rule safeguard reaches the tenant too ─────────────────
//
// A forgotten $1 charge sat 66 days past due under $15/day. Billing $990 on $1
// of rent is indefensible, so an uncapped rule is held to the charge itself —
// and the tenant must be quoted the capped figure, not the raw accrual.
{
  const forgotten = rent({ id: 'tiny', amount: 1, paid_amount: 0, due_date: '2026-09-01' })
  const c = tenantCharges([forgotten], [], DAILY, new Date('2026-11-07T20:00:00Z'))
  check('an uncapped fee is held to the size of its charge', c.lateFees[0]?.lateFee, 1)
  check('…so the whole bill is $2, not $991', c.totalOwed, 2)
}

// ── 10. One-off charges ───────────────────────────────────────────────────
{
  const dueNow = { id: 'x1', label: 'Security deposit', amount: 500, status: 'pending', due_date: '2026-11-01' }
  const later = { id: 'x2', label: 'Parking', amount: 50, status: 'pending', due_date: '2027-02-01' }
  const settled = { id: 'x3', label: 'Cleaning', amount: 75, status: 'paid', due_date: '2026-10-01' }
  const undated = { id: 'x4', label: 'Key replacement', amount: 25, status: 'pending', due_date: null }
  const c = tenantCharges([], [dueNow, later, settled, undated], DAILY, new Date('2026-11-20T20:00:00Z'))
  check('a one-off that has come due is owed', c.owed.map(r => r.id), ['x1', 'x4'])
  check('…a future one is not', c.upcoming.map(r => r.id), ['x2'])
  check('…a paid one is gone', c.owed.concat(c.upcoming).some(r => r.id === 'x3'), false)
  check('…and no fee is written against a one-off', c.lateFeeTotal, 0)
  check('the balance is the two due now', c.totalOwed, 525)
}

console.log(`${pass.length} passed`)
for (const p of pass) console.log('  ok   ' + p)
if (fail.length) {
  console.log(`\n${fail.length} FAILED`)
  for (const f of fail) console.log('  FAIL ' + f)
  process.exit(1)
}
console.log('\nall good')
