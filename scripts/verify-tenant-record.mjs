/**
 * Proves what a tenant's record says about them, and what a first notice is
 * allowed to claim.
 *
 * Worth a script rather than a careful reading, because the output of these two
 * modules is posted to a resident **and to their parent** under the landlord's
 * name, and every way of getting it wrong is both silent and humiliating:
 *
 *   • a notice sent on the morning rent is due — the tenant has the whole day,
 *     and the fee engine already knows that. The track record has to agree.
 *   • Phoenix. Midnight UTC on the 2nd is 5pm on the 1st in Tempe, so a naive
 *     `toISOString().slice(0,10)` posts a late-rent notice the afternoon the
 *     rent is due.
 *   • an ACH debit sent on the due date and cleared by the bank five days later
 *     recorded as "paid late", which is the clearing window being blamed on the
 *     tenant — the exact mistake `lateFeeAsOf` exists to prevent.
 *   • a cancelled month counted as a missed one, dragging an on-time record
 *     down for an early termination the landlord agreed to.
 *   • a fee on rent that has since been paid treated as grounds for a *late
 *     rent* notice. The rent arrived. That is a fee reminder, not a notice.
 *   • the co-signer's copy carrying a payment button that lands them on a login
 *     page they have no account for.
 *   • a co-signer whose screening was declined emailed someone else's debt.
 *
 * Run: npm run verify:tenant-record
 */
const {
  rentTimeline, tenantRecord, warningBasis, OUTCOME_META, STANDING_META, SERIOUS_DAYS,
} = await import('../src/lib/tenantRecord.ts')
const { buildLateWarningEmail, ruleLine } = await import('../src/lib/lateWarningEmails.ts')
const { cosignerIsOnTheHook } = await import('../src/lib/tenantDossierServer.ts')

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}
const ok = (name, cond) => { (cond ? pass : fail).push(name) }

// Noon UTC on 18 Nov 2026 is still 18 Nov in Phoenix, so "today" is unambiguous.
const NOW = new Date('2026-11-18T19:00:00Z')
// 00:30 UTC on 2 Nov is still *1* Nov in Phoenix — the half hour that breaks a
// UTC date and sends a notice on the day the rent is due.
const UTC_TRAP = new Date('2026-11-02T00:30:00Z')

const RULE = { grace_period_days: 0, fee_amount: 15, frequency_days: 1, max_total_fees: 60 }

const rent = (over = {}) => ({
  id: 'r1',
  due_date: '2026-11-01',
  amount: 900,
  status: 'pending',
  paid_amount: 0,
  paid_date: null,
  submitted_at: null,
  late_fee_paid: 0,
  late_fee_waived: 0,
  late_fee_waiver: null,
  ...over,
})

// ── 1. Late starts after the whole due day has passed ────────────────────────

const dueToday = [rent({ due_date: '2026-11-18' })]
check('rent due today reads as due, not overdue',
  rentTimeline(dueToday, RULE, NOW).map(s => s.outcome), ['due'])
check('rent due today is 0 days late',
  rentTimeline(dueToday, RULE, NOW).map(s => s.daysLate), [0])
ok('rent due today cannot be warned about',
  warningBasis(dueToday, [], RULE, NOW).sendable === false)

const dueYesterday = [rent({ due_date: '2026-11-17' })]
check('rent due yesterday is overdue by one day',
  rentTimeline(dueYesterday, RULE, NOW).map(s => [s.outcome, s.daysLate]), [['overdue', 1]])
ok('rent due yesterday can be warned about',
  warningBasis(dueYesterday, [], RULE, NOW).sendable === true)

// The Phoenix trap, stated as its own case: at 00:30 UTC on 2 November it is
// still 1 November where the rent is owed.
check('UTC midnight does not make the due day late',
  rentTimeline([rent({ due_date: '2026-11-01' })], RULE, UTC_TRAP).map(s => s.outcome), ['due'])
ok('UTC midnight does not unlock a notice',
  warningBasis([rent({ due_date: '2026-11-01' })], [], RULE, UTC_TRAP).sendable === false)

// ── 2. A payment is judged on when it was sent ───────────────────────────────

// Submitted on the due date, released by the bank on the 6th.
const achOnTime = [rent({
  status: 'paid', paid_amount: 900,
  submitted_at: '2026-11-01T18:00:00Z', paid_date: '2026-11-06',
})]
check('an ACH debit sent on the due date is on time',
  rentTimeline(achOnTime, RULE, NOW).map(s => [s.outcome, s.daysLate]), [['on_time', 0]])

// Still clearing: sent, nothing landed.
check('an in-flight debit reads as clearing',
  rentTimeline([rent({ status: 'processing', submitted_at: '2026-11-17T18:00:00Z' })], RULE, NOW)
    .map(s => s.outcome), ['clearing'])

// Genuinely late: sent on the 9th.
check('a debit sent eight days late says so',
  rentTimeline([rent({
    status: 'paid', paid_amount: 900, submitted_at: '2026-11-09T18:00:00Z', paid_date: '2026-11-13',
  })], RULE, NOW).map(s => [s.outcome, s.daysLate]), [['late', 8]])

// Recorded by hand, no submission instant: the landlord's own date is all there is.
check('rent recorded by hand is judged on the date recorded',
  rentTimeline([rent({ status: 'paid', paid_amount: 900, paid_date: '2026-11-04' })], RULE, NOW)
    .map(s => [s.outcome, s.daysLate]), [['late', 3]])

// Settled with no date at all: an unprovable accusation is not made.
check('a settled charge with no date is not called late',
  rentTimeline([rent({ status: 'paid', paid_amount: 900 })], RULE, NOW).map(s => s.outcome), ['on_time'])

// ── 3. The track record ──────────────────────────────────────────────────────

const year = [
  rent({ id: 'a', due_date: '2026-06-01', status: 'paid', paid_amount: 900, submitted_at: '2026-06-01T17:00:00Z' }),
  rent({ id: 'b', due_date: '2026-07-01', status: 'paid', paid_amount: 900, submitted_at: '2026-07-05T17:00:00Z' }),
  rent({ id: 'c', due_date: '2026-08-01', status: 'paid', paid_amount: 900, submitted_at: '2026-08-01T17:00:00Z' }),
  rent({ id: 'd', due_date: '2026-09-01', status: 'paid', paid_amount: 900, submitted_at: '2026-09-01T17:00:00Z' }),
  rent({ id: 'e', due_date: '2026-10-01', status: 'voided', amount: 900 }),
  rent({ id: 'f', due_date: '2026-11-01' }),
  rent({ id: 'g', due_date: '2026-12-01' }),
]
const rec = tenantRecord(year, [], RULE, NOW)

// Five months have come due (June–November); October was cancelled and is not
// one of them, and December has not arrived.
check('months due excludes cancelled and future months', rec.monthsDue, 5)
check('on time counts the months sent on or before the due date', rec.onTime, 3)
check('paid late counts the one month that was', rec.paidLate, 1)
check('open counts the month nothing arrived for', rec.open, 1)
check('on-time rate is over the months that came due', rec.onTimeRate, 60)
check('average days late is over the late months only', rec.avgDaysLate, 4)
// August and September, since July broke the run before them.
check('the streak reaches the most recent payment', rec.streak, 2)
check('the oldest overdue charge is November', rec.oldestOverdue?.dueDate, '2026-11-01')
check('days late on the oldest overdue charge', rec.oldestOverdue?.daysLate, 17)
check('next due is December', rec.nextDue?.dueDate, '2026-12-01')
check('last payment is the most recent one sent', rec.lastPayment?.date, '2026-09-01')
check('billed counts only what came due', rec.billed, 4500)
check('collected counts the money in', rec.collected, 3600)

// 17 days past due on one month: behind, not yet serious.
check('one month 17 days past due is behind', rec.standing, 'behind')
ok('the serious threshold is a second month, roughly', SERIOUS_DAYS === 21)

const twoMonths = tenantRecord([
  rent({ id: 'f', due_date: '2026-10-01' }),
  rent({ id: 'g', due_date: '2026-11-01' }),
], [], RULE, NOW)
check('two months past due is serious', twoMonths.standing, 'serious')

check('nothing due yet reads as new',
  tenantRecord([rent({ due_date: '2026-12-01' })], [], RULE, NOW).standing, 'new')
check('everything paid reads as up to date',
  tenantRecord([rent({
    due_date: '2026-11-01', status: 'paid', paid_amount: 900, submitted_at: '2026-11-01T17:00:00Z',
  })], [], RULE, NOW).standing, 'current')

// ── 4. A fee on settled rent is not grounds for a late-rent notice ───────────

// Rent arrived on the 9th. The fee froze there and was never collected.
const feeOnly = [rent({
  due_date: '2026-11-01', status: 'paid', paid_amount: 900,
  submitted_at: '2026-11-09T17:00:00Z', paid_date: '2026-11-09',
})]
const feeRec = tenantRecord(feeOnly, [], RULE, NOW)
ok('an outstanding fee on settled rent is still owed', feeRec.lateFeeOwed > 0)
check('rent paid late with a fee outstanding reads as fees only', feeRec.standing, 'fees_only')
ok('a fee alone cannot be warned about',
  warningBasis(feeOnly, [], RULE, NOW).sendable === false)
ok('but the fee is still reported on the basis, for the record',
  warningBasis(feeOnly, [], RULE, NOW).feeTotal > 0)

// ── 5. What a notice is entitled to chase ────────────────────────────────────

const basis = warningBasis(
  [
    rent({ id: 'f', due_date: '2026-10-01' }),           // unpaid, long overdue
    rent({ id: 'g', due_date: '2026-11-18', amount: 900 }), // due today — excluded
    rent({ id: 'h', due_date: '2026-12-01', amount: 900 }), // not due — excluded
  ],
  [
    { id: 's1', label: 'Security deposit', amount: 500, status: 'pending', due_date: '2026-11-10' },
    { id: 's2', label: 'Parking', amount: 60, status: 'pending', due_date: '2026-12-10' },  // not due
    { id: 's3', label: 'Cleaning', amount: 80, status: 'waived', due_date: '2026-10-01' },  // forgiven
  ],
  RULE, NOW,
)
check('only past-due rent is chased', basis.rent.map(r => r.id), ['f'])
check('only past-due charges are chased', basis.charges.map(r => r.id), ['s1'])
check('the rent line names its month', basis.rent[0].label, 'October 2026 rent')
check('rent and charges are summed apart', [basis.rentTotal, basis.chargeTotal], [900, 500])
// The rule caps at $60, and the October charge is well past that.
check('the fee comes from the rule, capped', basis.feeTotal, 60)
check('the total is rent plus charges plus fees', basis.total, 1460)
check('the oldest line drives how late this is', basis.oldestDaysLate, 48)
check('the basis is dated in Phoenix', basis.asOf, '2026-11-18')

// ── 6. The notice itself ─────────────────────────────────────────────────────

const shared = {
  level: 1,
  tenantName: 'Gauge Berkhahn',
  propertyName: 'Del Rio',
  unitLabel: 'Room 3',
  basis,
  payUrl: 'https://homehive.live/dashboard/lease?tab=payments&pay=1',
  respondBy: '2026-11-23',
  rule: RULE,
  landlordName: 'Heran Patel',
  landlordEmail: 'heran@finityone.com',
  customMessage: null,
}

const toTenant = buildLateWarningEmail({
  ...shared, audience: 'tenant', copiedTo: ['Patricia G Berkhahn'],
})
const toCosigner = buildLateWarningEmail({
  ...shared, audience: 'cosigner', recipientName: 'Patricia G Berkhahn', relationship: 'Guardian',
})

ok('the tenant copy names itself as the first notice',
  toTenant.subject.startsWith('First notice'))
ok('the tenant copy leads with the amount', toTenant.subject.includes('$1,460.00'))
ok('the tenant copy carries the pay link', toTenant.html.includes(shared.payUrl))
ok('the tenant copy addresses them by first name', toTenant.text.includes('Hi Gauge,'))
ok('the tenant copy says who was copied',
  toTenant.text.includes('Patricia G Berkhahn') && toTenant.text.includes('co-signed'))
ok('the tenant copy states the deadline', toTenant.text.includes('November 23, 2026'))
ok('the tenant copy allows for a crossed payment', toTenant.text.includes('ignore it'))
ok('the tenant copy offers a way to ask for time',
  toTenant.text.toLowerCase().includes('cannot pay the full amount'))

ok('the co-signer copy is about the tenant, not to them',
  toCosigner.subject.includes('co-signed') && toCosigner.text.includes("Gauge's lease"))
ok('the co-signer copy addresses the co-signer', toCosigner.text.includes('Hi Patricia,'))
ok('the co-signer copy names the relationship', toCosigner.text.includes('guardian'))
// The whole point: the pay flow is behind the resident's own login.
ok('the co-signer copy carries NO payment button',
  !toCosigner.html.includes(shared.payUrl) && !toCosigner.text.includes(shared.payUrl))
ok('the co-signer copy asks nothing of them yet',
  toCosigner.text.includes('Nothing is being asked of you yet'))
ok('both copies quote the same total',
  toTenant.text.includes('$1,460.00') && toCosigner.text.includes('$1,460.00'))
ok('both copies show the same lines',
  toTenant.text.includes('October 2026 rent') && toCosigner.text.includes('Security deposit'))
ok('the fee rule is quoted so the tenant can check it',
  toTenant.text.includes('$15.00 every day') && toTenant.text.includes('$60.00 in total'))

// A notice with nothing but a solo tenant copies nobody and says nothing about it.
const solo = buildLateWarningEmail({ ...shared, audience: 'tenant', copiedTo: [] })
ok('with no co-signer, nothing is said about copies', !solo.text.includes('co-signed your lease'))

// The escalation names itself differently at each level.
check('level 2 is the second notice',
  buildLateWarningEmail({ ...shared, level: 2, audience: 'tenant' }).subject.startsWith('Second notice'), true)
check('level 3 is the final notice',
  buildLateWarningEmail({ ...shared, level: 3, audience: 'tenant' }).subject.startsWith('Final notice'), true)

// The landlord's own words reach the recipient verbatim, and are escaped in HTML.
const withNote = buildLateWarningEmail({
  ...shared, audience: 'tenant', customMessage: 'Call me & we\'ll sort <it> out',
})
ok('the landlord\'s note reaches the tenant', withNote.text.includes("Call me & we'll sort <it> out"))
// `&`, `<` and `>` are the three that matter in a text node; an apostrophe is
// harmless there and is left as typed, so the note reads as written.
ok('the landlord\'s note is escaped in the HTML',
  withNote.html.includes("Call me &amp; we'll sort &lt;it&gt; out"))

check('the rule sentence reads as English',
  ruleLine({ grace_period_days: 5, fee_amount: 50, frequency_days: 7, max_total_fees: null }),
  'Your lease charges a late fee of $50.00 every 7 days once the 5 days grace period has passed.')

// ── 7. Who is on the hook ────────────────────────────────────────────────────

const cos = (over = {}) => ({
  id: 'c1', isCosigner: true, cosignerForCheckId: 'x', relationship: 'Parent',
  name: 'Arthur Buck', email: 'arthur@example.com', phone: null,
  status: 'approved', decision: 'passed', incomeMonthly: 6000, createdAt: '2026-06-01T00:00:00Z',
  ...over,
})
ok('an approved co-signer is copied by default', cosignerIsOnTheHook(cos()) === true)
ok('a declined co-signer is not',
  cosignerIsOnTheHook(cos({ status: 'declined', decision: 'failed' })) === false)
ok('an unfinished screening is not',
  cosignerIsOnTheHook(cos({ status: 'pending_verification', decision: null })) === false)
ok('a co-signer with no email is not',
  cosignerIsOnTheHook(cos({ email: null })) === false)

// ── 8. Every state has a word, not just a colour ─────────────────────────────

ok('every rent outcome carries a label and a hint',
  Object.values(OUTCOME_META).every(m => m.label.length > 0 && m.hint.length > 0))
ok('every standing carries a label and a sentence',
  Object.values(STANDING_META).every(m => m.label.length > 0 && m.line.length > 0))

// ── Report ───────────────────────────────────────────────────────────────────

console.log(`\n  Tenant record & late notices — ${pass.length} passed, ${fail.length} failed\n`)
for (const f of fail) console.log(`  ✗ ${f}`)
if (fail.length === 0) console.log('  ✓ all good\n')
else { console.log(''); process.exit(1) }
