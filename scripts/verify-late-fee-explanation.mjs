/**
 * Proves `explainLateFee` — the function behind every figure a tenant is shown
 * and every dollar the payment API charges.
 *
 * The cases are the real shapes on this database, taken from the live rows:
 * a one-day slip, a five-day slip, a month overpaid by exactly the fee, a
 * 55-day arrears where an uncapped daily rule would exceed the rent, and rent
 * that is still outstanding and still accruing. A pure function, so no
 * database and no network.
 *
 * Run: npx tsx scripts/verify-late-fee-explanation.mjs
 */
const { explainLateFee, lateFeeOutstanding } = await import('../src/lib/rentPayments.ts')

// The rule every plan here uses: $15 a day, no grace, no ceiling.
const DAILY = { grace_period_days: 0, fee_amount: 15, frequency_days: 1, max_total_fees: null }

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

const charge = (over = {}) => ({
  status: 'paid', due_date: '2026-03-01', paid_date: '2026-03-02',
  amount: 741.96, paid_amount: 741.96, late_fee_paid: 0, ...over,
})

// ── 1. One day late ───────────────────────────────────────────────────────
{
  const x = explainLateFee(DAILY, charge(), 0)
  check('1 day: days past due', x.daysPastDue, 1)
  check('1 day: periods', x.periods, 1)
  check('1 day: accrued', x.accrued, 15)
  check('1 day: nothing capped', x.cappedBy, null)
  check('1 day: owed', x.outstanding, 15)
  check('1 day: rent reads as settled', x.rentSettled, true)
  check('1 day: fee is frozen', x.frozen, true)
}

// ── 2. Five days late ─────────────────────────────────────────────────────
{
  const x = explainLateFee(DAILY, charge({ paid_date: '2026-03-06' }), 0)
  check('5 days: periods x rate', [x.periods, x.accrued], [5, 75])
  check('5 days: owed', x.outstanding, 75)
}

// ── 3. Overpaid by exactly one day's fee (a real row) ─────────────────────
{
  // Nov 2025: three days late, $45 assessed, and $756.96 paid against $741.96
  // of rent. The $15 above the rent is fee money recorded as rent.
  const x = explainLateFee(
    DAILY, charge({ due_date: '2025-11-01', paid_date: '2025-11-04', paid_amount: 756.96 }), 0,
  )
  check('overpaid: assessed before credit', x.assessed, 45)
  check('overpaid: credit recognised', x.overpaymentCredit, 15)
  check('overpaid: owed is net of it', x.outstanding, 30)
}

// ── 4. Overpaid by four days' fee (the other real row) ────────────────────
{
  const x = explainLateFee(
    DAILY, charge({ due_date: '2026-01-01', paid_date: '2026-01-08', paid_amount: 801.96 }), 0,
  )
  check('overpaid x4: assessed', [x.periods, x.assessed], [7, 105])
  check('overpaid x4: credit', x.overpaymentCredit, 60)
  check('overpaid x4: owed', x.outstanding, 45)
}

// ── 5. An uncapped daily rule would exceed the rent ───────────────────────
{
  // 55 days at $15 is $825 against $741.96 of rent. The fee is held to the
  // charge, and the sheet has to be able to say so.
  const x = explainLateFee(
    DAILY, charge({ due_date: '2026-05-01', paid_date: '2026-06-25', paid_amount: 0 }), 0,
  )
  check('capped: accrued before the ceiling', x.accrued, 825)
  check('capped: ceiling named', x.cappedBy, 'charge')
  check('capped: ceiling value', x.capAmount, 741.96)
  check('capped: assessed held to the rent', x.assessed, 741.96)
  check('capped: owed', x.outstanding, 741.96)
}

// ── 6. A rule ceiling wins when the lease sets one ────────────────────────
{
  const x = explainLateFee(
    { ...DAILY, max_total_fees: 100 },
    charge({ paid_date: '2026-04-01' }), 0,
  )
  check('rule cap: ceiling named', x.cappedBy, 'rule')
  check('rule cap: assessed', x.assessed, 100)
}

// ── 7. Rent still unpaid — the fee is live, not frozen ────────────────────
{
  const now = new Date('2026-03-11T12:00:00Z')
  const x = explainLateFee(
    DAILY, charge({ status: 'pending', paid_date: null, paid_amount: 0 }), 0, now,
  )
  check('unpaid: not frozen', x.frozen, false)
  check('unpaid: measured to today', x.asOfDate, '2026-03-11')
  check('unpaid: 10 days accrued', [x.periods, x.accrued], [10, 150])
  check('unpaid: owed', x.outstanding, 150)
}

// ── 8. Grace period delays the first charge ───────────────────────────────
{
  const x = explainLateFee(
    { ...DAILY, grace_period_days: 5 }, charge({ paid_date: '2026-03-09' }), 0,
  )
  check('grace: grace end reported', x.graceEndDate, '2026-03-06')
  check('grace: 8 days late but only 3 chargeable', [x.daysPastDue, x.periods], [8, 3])
  check('grace: owed', x.outstanding, 45)
}

// ── 9. Inside the grace period — no fee at all ────────────────────────────
{
  const x = explainLateFee(
    { ...DAILY, grace_period_days: 5 }, charge({ paid_date: '2026-03-04' }), 0,
  )
  check('within grace: nothing assessed', [x.periods, x.assessed, x.outstanding], [0, 0, 0])
}

// ── 10. Paid and waived fees both reduce what is owed ─────────────────────
{
  const partPaid = explainLateFee(DAILY, charge({ paid_date: '2026-03-06', late_fee_paid: 30 }), 0)
  check('part-paid fee: owed', partPaid.outstanding, 45)
  const waivedOff = explainLateFee(DAILY, charge({ paid_date: '2026-03-06' }), 75)
  check('fully waived: owed', waivedOff.outstanding, 0)
  check('fully waived: waiver reported', waivedOff.waived, 75)
  const overWaived = explainLateFee(DAILY, charge({ paid_date: '2026-03-06' }), 500)
  check('waiver cannot exceed the fee', overWaived.waived, 75)
}

// ── 11. Weekly rules, no rule, and cancelled rent ─────────────────────────
{
  const weekly = explainLateFee(
    { grace_period_days: 0, fee_amount: 50, frequency_days: 7, max_total_fees: null },
    charge({ paid_date: '2026-03-18' }), 0,
  )
  check('weekly: 17 days is 2 whole weeks', [weekly.daysPastDue, weekly.periods], [17, 2])
  check('weekly: owed', weekly.outstanding, 100)

  check('no rule: nothing owed', explainLateFee(null, charge(), 0).outstanding, 0)
  check('voided rent: nothing owed',
    explainLateFee(DAILY, charge({ status: 'voided', paid_date: null, paid_amount: 0 }), 0).outstanding, 0)
}

// ── 12. The wrapper and the explanation can never disagree ────────────────
{
  const cases = [
    charge(),
    charge({ paid_date: '2026-03-06', paid_amount: 756.96 }),
    charge({ due_date: '2026-05-01', paid_date: '2026-06-25', paid_amount: 0 }),
    charge({ status: 'pending', paid_date: null, paid_amount: 0 }),
  ]
  const now = new Date('2026-07-01T12:00:00Z')
  const agree = cases.every(
    c => lateFeeOutstanding(DAILY, c, 0, now) === explainLateFee(DAILY, c, 0, now).outstanding,
  )
  check('lateFeeOutstanding is explainLateFee().outstanding', agree, true)
}

console.log(`${pass.length} passed`)
for (const p of pass) console.log('  ok   ' + p)
if (fail.length) {
  console.log(`\n${fail.length} FAILED`)
  for (const f of fail) console.log('  FAIL ' + f)
  process.exit(1)
}
console.log('\nall good')
