/**
 * Proves the landlord Overview's figures are the same figures the rest of the
 * app would give.
 *
 * Worth a script rather than a reading, because the overview is the screen a
 * landlord trusts first and checks least, and every way of getting it wrong
 * produces a confident wrong number with no error at all. The version this
 * replaced got three of these wrong for months:
 *
 *   • **Voided charges counted as money.** A rent row a landlord voided was
 *     still summed into "billed" and into arrears, so cancelling a charge made
 *     the overdue figure go up.
 *   • **Demo leases counted as revenue.** A rehearsal lease is explicitly not
 *     income — the database refuses to put a payment plan on one — and it was
 *     being added to the monthly contracted figure all the same.
 *   • **Late was decided in the reader's timezone.** `isPastDue` is the app's
 *     one definition of late and it reads the calendar where the rent is owed;
 *     comparing a due date against the browser's midnight made a landlord
 *     abroad see different arrears here than on Financials.
 *
 * And two that would be new:
 *
 *   • **Collected keyed on the due date.** Rent paid two months late would
 *     vanish from the month it actually arrived in, which is the one month a
 *     landlord is looking for it.
 *   • **A month-over-month pill with no fair basis.** A running month against
 *     a finished one tells every landlord their collections collapsed on the
 *     3rd. The comparison is to the same elapsed portion of last month, or
 *     there is no comparison.
 *
 * Run: npm run verify:overview
 */
const { buildOverview, overviewSignals } = await import('../src/lib/overviewModel.ts')
const { billingToday } = await import('../src/lib/rentPayments.ts')

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

// Everything is anchored to the billing calendar's today, because `isPastDue`
// is, and a fixture pinned to a literal date would start failing on its own.
const TODAY = billingToday()
const shiftDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const YESTERDAY = shiftDays(TODAY, -1)
const TOMORROW = shiftDays(TODAY, 1)
const LONG_AGO = shiftDays(TODAY, -40)

let seq = 0
const charge = (over = {}) => ({
  id: `sp${seq++}`,
  plan_id: 'plan-1',
  plan_tenant_id: 'pt-1',
  due_date: TODAY,
  amount: 1000,
  status: 'pending',
  paid_amount: 0,
  paid_date: null,
  settled_at: null,
  submitted_at: null,
  late_fees_applied: 0,
  notes: null,
  void_reason: null,
  payment_method: null,
  recorded_by: null,
  ...over,
})

const plan = (payments, over = {}) => ({
  id: over.id ?? 'plan-1',
  owner_id: 'o1',
  property_id: 'p1',
  lease_id: 'l1',
  name: 'Rent',
  due_day: 1,
  notes: null,
  created_at: TODAY,
  updated_at: TODAY,
  property: { id: 'p1', name: 'Maple Street', slug: 'maple' },
  tenants: [{ id: 'pt-1', name: 'Ada Pell' }],
  scheduled_payments: payments,
  ...over,
})

const property = (over = {}) => ({
  id: 'p1', slug: 'maple', name: 'Maple Street', price: 900,
  total_rooms: 4, available: 1, images: [],
  admin_status: 'active', listing_status: 'active', owner_plan_active: true,
  ...over,
})

const lease = (over = {}) => ({
  id: 'l1', start_date: LONG_AGO, end_date: shiftDays(TODAY, 300),
  rent_amount: 1200, is_demo: false, tenants: [{ name: 'Ada Pell' }], documents: [],
  property: { id: 'p1', name: 'Maple Street', slug: 'maple' },
  ...over,
})

// ── Voided charges are not money ─────────────────────────────────────────────

{
  const o = buildOverview([property()], [], [], [plan([
    charge({ due_date: YESTERDAY, amount: 1000, status: 'voided' }),
    charge({ due_date: YESTERDAY, amount: 400 }),
  ])])
  check('a voided charge is not owed', o.owed, 400)
  check('a voided charge is not billed', o.monthBilled <= 400, true)
  check('only the live charge is counted overdue', o.owedCount, 1)
}

// ── Late is `isPastDue`, and the due day belongs to the tenant ───────────────

{
  const o = buildOverview([property()], [], [], [plan([
    charge({ due_date: TODAY, amount: 500 }),
  ])])
  check('rent due today is not late today', o.owed, 0)
}

{
  const o = buildOverview([property()], [], [], [plan([
    charge({ due_date: YESTERDAY, amount: 500 }),
  ])])
  check('rent due yesterday is late', o.owed, 500)
  check('and is one whole day late', o.worstDaysLate, 1)
}

{
  const o = buildOverview([property()], [], [], [plan([
    charge({ due_date: TOMORROW, amount: 500 }),
  ])])
  check('rent due tomorrow is not late', o.owed, 0)
}

// ── Part-paid rent owes only the remainder ───────────────────────────────────

{
  const o = buildOverview([property()], [], [], [plan([
    charge({ due_date: YESTERDAY, amount: 1000, paid_amount: 600, status: 'partial' }),
  ])])
  check('a part payment leaves only the shortfall owed', o.owed, 400)
}

{
  const o = buildOverview([property()], [], [], [plan([
    charge({ due_date: YESTERDAY, amount: 1000, paid_amount: 1000, status: 'paid', paid_date: YESTERDAY }),
  ])])
  check('rent paid in full owes nothing, however late it was', o.owed, 0)
}

// ── Demo leases are a rehearsal, not revenue ─────────────────────────────────

{
  const o = buildOverview([property()], [], [lease(), lease({ id: 'l2', rent_amount: 5000, is_demo: true })], [])
  check('a demo lease is not contracted rent', o.monthlyRevenue, 1200)
  check('nor is it an active lease', o.currentLeases.length, 1)
}

// ── Collection history is keyed on when the money arrived ────────────────────

{
  const lastMonth = shiftDays(TODAY, -40).slice(0, 7)
  const o = buildOverview([property()], [], [], [plan([
    // Billed 40 days ago, paid today. Billed belongs to the old month;
    // collected belongs to this one.
    charge({ due_date: shiftDays(TODAY, -40), amount: 900, paid_amount: 900, status: 'paid', paid_date: TODAY }),
  ])])
  const thisKey = TODAY.slice(0, 7)
  const here = o.history.find(m => m.key === thisKey)
  const there = o.history.find(m => m.key === lastMonth)
  check('late rent is collected in the month it arrived', here.collected, 900)
  check('and billed in the month it was due', there.billed, 900)
  check('which leaves the month it was due showing nothing collected', there.collected, 0)
}

// ── The month-over-month comparison refuses to be unfair ─────────────────────

{
  const o = buildOverview([property()], [], [], [plan([
    charge({ due_date: TODAY, amount: 500, paid_amount: 500, status: 'paid', paid_date: TODAY }),
  ])])
  check('a first month has no basis to compare against', o.pace.comparable, false)
  check('so no percentage is offered', o.pace.deltaPct, null)
  check('and the figure itself is still right', o.pace.toDate, 500)
}

// ── A property is live only when all three axes agree ────────────────────────

{
  const states = [
    [{ owner_plan_active: false }, 'unpaid'],
    [{ admin_status: 'pending' }, 'pending'],
    [{ admin_status: 'rejected' }, 'rejected'],
    [{ admin_status: 'inactive' }, 'inactive'],
    [{ listing_status: 'rented' }, 'rented'],
    [{}, 'live'],
  ]
  for (const [over, want] of states) {
    const o = buildOverview([property(over)], [], [], [])
    check(`a ${want} listing reads as ${want}`, o.properties[0].state, want)
  }
  const o = buildOverview([property({ owner_plan_active: false })], [], [], [])
  check('an unpaid listing is not counted live', o.liveCount, 0)
}

// ── Signals name the worst thing first, and show their working ───────────────

{
  const o = buildOverview(
    [property({ owner_plan_active: false })],
    [{ id: 'L1', created_at: TODAY, email: 'a@b.c', first_name: 'Ada', last_name: 'Pell', status: 'new', property: 'maple' }],
    [lease()],
    [plan([charge({ due_date: YESTERDAY, amount: 700 })])],
  )
  const sigs = overviewSignals(o)
  check('an invisible listing outranks everything', sigs[0].id, 'unpublished')
  check('and every signal carries its evidence',
    sigs.every(s => s.evidence.length > 0 && s.action.href), true)
  check('nothing is reported twice', new Set(sigs.map(s => s.id)).size, sigs.length)
}

{
  const o = buildOverview([property({ available: 0 })], [], [lease()], [])
  const sigs = overviewSignals(o)
  check('a full, paid, current portfolio raises nothing', sigs.length, 0)
}

// ── An empty portfolio is empty, not a wall of zeroes ────────────────────────

{
  const o = buildOverview([], [], [], [])
  check('no listings means the empty state', o.empty, true)
  check('and no signals to act on', overviewSignals(o).length, 0)
}

// ── The funnel folds the legacy statuses into the stage they mean ────────────

{
  const leads = [
    { id: '1', created_at: TODAY, email: 'a@b.c', status: 'tour_scheduled', property: 'maple' },
    { id: '2', created_at: TODAY, email: 'd@e.f', status: 'qualified', property: 'maple' },
    { id: '3', created_at: TODAY, email: 'g@h.i', status: 'follow_up', property: 'maple' },
    { id: '4', created_at: TODAY, email: 'j@k.l', status: 'cold', property: 'maple' },
  ]
  const o = buildOverview([property()], leads, [], [])
  const stage = key => o.funnel.find(f => f.stage === key).count
  check('tour_scheduled is counted as qualified', stage('qualified'), 2)
  check('follow_up is counted as contacted', stage('contacted'), 1)
  check('a cold lead is in no funnel stage', o.funnel.reduce((n, f) => n + f.count, 0), 3)
  check('nor is it an open lead', o.activeLeads, 3)
  check('but it is in the status mix', o.statusMix.reduce((n, m) => n + m.count, 0), 4)
}

// ── A percentage needs a denominator worth dividing by ──────────────────────

{
  const made = (days, count) => Array.from({ length: count }, (_, i) => ({
    id: `x${days}-${i}`, created_at: new Date(Date.now() - days * 86400000).toISOString(),
    email: `x${days}${i}@asu.edu`, status: 'new', property: 'maple',
  }))
  // One lead last window, eleven this one: a true 1000%, and meaningless.
  const tiny = buildOverview([property()], [...made(45, 1), ...made(5, 11)], [], [])
  check('a one-lead prior window offers no percentage', tiny.leadDelta.pct, null)
  check('but the count itself is still reported', tiny.leadDelta.recent, 11)

  const real = buildOverview([property()], [...made(45, 8), ...made(5, 12)], [], [])
  check('a prior window with real volume does', real.leadDelta.pct, 50)
}

// ── Report ───────────────────────────────────────────────────────────────────

console.log(`\n${pass.length} passed`)
if (fail.length) {
  console.log(`\n${fail.length} FAILED:`)
  for (const f of fail) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(
  '✓ the overview drops voided charges and demo leases, judges late by the ' +
  'billing calendar, books collection in the month the money arrived, and ' +
  'offers no percentage it has no basis for\n'
)
