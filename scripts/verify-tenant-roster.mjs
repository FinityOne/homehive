/**
 * Proves the tenant roster says who is actually a tenant, and whose money is
 * whose.
 *
 * Worth a script because both answers come out of a join that is not a join.
 * A `tenants` row points at nothing: it reaches a lease through
 * `lease_tenants`, which may or may not carry a `tenant_id`, and it reaches
 * money through `payment_plan_tenants`, which never does. Email is the only
 * thread, and it is typed by hand twice. Get the join wrong in the loose
 * direction and a landlord is shown somebody else's arrears under this
 * tenant's name; get it wrong in the strict direction and a tenant paying
 * $900 a month reads "No plan".
 *
 * The other thing it pins down is the word "active". The old page read
 * `tenants.status`, a label nothing maintains — so the roster derives it from
 * the lease instead, and these checks are what stop that quietly drifting back
 * to the column.
 *
 * Run: npm run verify:roster
 */
const {
  buildTenantRoster, applyFilter, matchesQuery,
} = await import('../src/lib/tenantRoster.ts')
const { billingToday } = await import('../src/lib/rentPayments.ts')

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

const TODAY = billingToday()
const shift = (days) => {
  const d = new Date(`${TODAY}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const tenant = (over = {}) => ({
  id: 't1', owner_id: 'o1', first_name: 'Ada', last_name: 'Bell',
  email: 'ada@asu.edu', phone: null, notes: null, status: 'active',
  rating: null, lead_id: null, created_at: shift(-200), updated_at: shift(-200),
  ...over,
})

const lease = (over = {}) => ({
  id: 'l1', created_at: shift(-200), updated_at: shift(-200),
  property_id: 'p1', owner_id: 'o1',
  start_date: shift(-100), end_date: shift(200),
  rent_amount: 900, unit_number: 'Room 3', notes: null, is_demo: false,
  document_url: null,
  tenants: [{ id: 'lt1', lease_id: 'l1', tenant_id: null, lead_id: null, name: 'Ada Bell', email: 'ada@asu.edu' }],
  documents: [],
  property: { id: 'p1', name: 'Del Rio', slug: 'del-rio' },
  ...over,
})

/** A rent row. Unpaid by default. */
const rent = (over = {}) => ({
  id: 'sp' + Math.random().toString(36).slice(2, 8),
  plan_id: 'pl1', plan_tenant_id: 'pt1',
  due_date: shift(-10), amount: 900, status: 'pending',
  paid_amount: 0, paid_date: null, settled_at: null, submitted_at: null,
  late_fees_applied: 0, notes: null, void_reason: null,
  payment_method: null, recorded_by: null, late_fee_paid: 0, processing_fee: 0,
  stripe_payment_intent_id: null,
  reminder_sent_at: null, reminder_count: 0,
  late_fee_reminder_sent_at: null, late_fee_reminder_count: 0,
  created_at: shift(-40), updated_at: shift(-40),
  ...over,
})

const plan = (over = {}) => ({
  id: 'pl1', owner_id: 'o1', property_id: 'p1', lease_id: 'l1',
  name: 'Del Rio · Room 3', due_day: 1, notes: null,
  created_at: shift(-150), updated_at: shift(-150),
  property: { id: 'p1', name: 'Del Rio', slug: 'del-rio' },
  lease: { id: 'l1', start_date: shift(-100), end_date: shift(200), rent_amount: 900, is_demo: false },
  tenants: [{
    id: 'pt1', plan_id: 'pl1', name: 'Ada Bell', email: 'ada@asu.edu',
    monthly_total: 900, created_at: shift(-150), line_items: [],
    start_date: null, end_date: null, status: 'active',
    termination_date: null, termination_reason: null,
  }],
  late_fee_rule: null,
  utilities: [],
  scheduled_payments: [],
  special_payments: [],
  ...over,
})

const only = (r) => r.active[0]

// ── The lease join ──────────────────────────────────────────────────────────

{
  const r = buildTenantRoster([tenant()], [lease()], [])
  check('a lease carrying the tenant\'s email is theirs', only(r).lead.leaseId, 'l1')
  check('and the match is reported as by email', only(r).lead.linkage, 'email')
}

{
  // The only real reference, and it must win: an email can be edited on either
  // side, the id cannot.
  const l = lease({ tenants: [{ id: 'lt1', lease_id: 'l1', tenant_id: 't1', lead_id: null, name: 'A. Bell', email: 'old@asu.edu' }] })
  const r = buildTenantRoster([tenant()], [l], [])
  check('a tenant_id reference beats a stale email', only(r).lead.linkage, 'reference')
}

{
  // The landlord typed the name into the lease and never the address. Still
  // their tenancy — but the page must be able to say how it knows.
  const l = lease({ tenants: [{ id: 'lt1', lease_id: 'l1', tenant_id: null, lead_id: null, name: 'Ada Bell', email: null }] })
  const r = buildTenantRoster([tenant()], [l], [])
  check('a name-only lease still matches', only(r).lead.linkage, 'name')
}

{
  const l = lease({ tenants: [{ id: 'lt1', lease_id: 'l1', tenant_id: null, lead_id: null, name: 'Someone Else', email: 'else@asu.edu' }] })
  const r = buildTenantRoster([tenant()], [l], [])
  check('somebody else\'s lease is not theirs', r.active.length, 0)
  check('and they are listed as unplaced rather than dropped', r.unplaced.length, 1)
}

{
  const r = buildTenantRoster([tenant()], [lease({ tenants: [
    { id: 'lt1', lease_id: 'l1', tenant_id: null, lead_id: null, name: 'Ada Bell', email: 'ADA@ASU.EDU' },
  ] })], [])
  check('the email match ignores case', only(r).lead.linkage, 'email')
}

// ── What "active" means ─────────────────────────────────────────────────────

{
  const r = buildTenantRoster([tenant({ status: 'former' })], [lease()], [])
  check('a running lease outranks a stale "former" label', r.active.length, 1)
}

{
  const ended = lease({ start_date: shift(-400), end_date: shift(-30) })
  const r = buildTenantRoster([tenant({ status: 'active' })], [ended], [])
  check('a finished lease outranks a stale "active" label', r.active.length, 0)
  check('and they read as moved out, not as a contact with no lease', only({ active: r.past }).standing, 'ended')
}

{
  const soon = lease({ start_date: shift(14), end_date: shift(380) })
  const r = buildTenantRoster([tenant()], [soon], [])
  check('a lease starting inside a month is already being managed', r.active.length, 1)
}

{
  const later = lease({ start_date: shift(90), end_date: shift(450) })
  const r = buildTenantRoster([tenant()], [later], [])
  check('a lease starting in three months is not yet active', r.active.length, 0)
}

{
  const r = buildTenantRoster([tenant()], [lease({ is_demo: true })], [])
  check('a demo lease is a rehearsal, not a tenancy', r.active.length, 0)
}

// ── The payer join, and the money ───────────────────────────────────────────

{
  const p = plan({ scheduled_payments: [rent({ due_date: shift(-10) })] })
  const e = only(buildTenantRoster([tenant()], [lease()], [p]))
  check('the payer on the lease\'s plan is matched by email', e.lead.money.planTenantId, 'pt1')
  check('their monthly figure comes from the plan', e.monthly, 900)
  check('an unpaid charge past its due date is overdue', e.overdue, 900)
  check('and the standing says so', e.standing, 'overdue')
}

{
  // The dossier's rule, kept: a name is only trusted on a plan sitting on a
  // lease this tenant is already on. Across the portfolio it would hand one
  // landlord's "Chris" the arrears of another.
  const p = plan({
    lease_id: 'l9',
    tenants: [{ ...plan().tenants[0], email: null }],
    scheduled_payments: [rent()],
  })
  const e = only(buildTenantRoster([tenant()], [lease()], [p]))
  check('a plan on a lease they are not on carries no money here', e.lead.money, null)
  check('and the standing names the gap rather than claiming they are paid up', e.standing, 'no_plan')
}

{
  const p = plan({
    tenants: [{ ...plan().tenants[0], email: null }],
    scheduled_payments: [rent()],
  })
  const e = only(buildTenantRoster([tenant()], [lease()], [p]))
  check('a name match on their own lease\'s plan is allowed', e.lead.money.matchedBy, 'name')
}

{
  // Two payers sharing a house. Each card must show one person's rent, not the
  // household's — this is the bug that makes a roommate look two months behind.
  const p = plan({
    tenants: [
      { ...plan().tenants[0] },
      { ...plan().tenants[0], id: 'pt2', name: 'Gauge Berkhahn', email: 'gauge@asu.edu', monthly_total: 800 },
    ],
    scheduled_payments: [
      rent({ plan_tenant_id: 'pt1', amount: 900, due_date: shift(-10) }),
      rent({ plan_tenant_id: 'pt2', amount: 800, due_date: shift(-10) }),
    ],
  })
  const l = lease({ tenants: [
    { id: 'lt1', lease_id: 'l1', tenant_id: 't1', lead_id: null, name: 'Ada Bell', email: 'ada@asu.edu' },
    { id: 'lt2', lease_id: 'l1', tenant_id: 't2', lead_id: null, name: 'Gauge Berkhahn', email: 'gauge@asu.edu' },
  ] })
  const r = buildTenantRoster([tenant(), tenant({ id: 't2', first_name: 'Gauge', last_name: 'Berkhahn', email: 'gauge@asu.edu' })], [l], [p])
  const ada = r.active.find(e => e.tenant.id === 't1')
  check('a shared lease owes each payer their own rent', ada.overdue, 900)
  check('and names the housemate rather than merging them', ada.lead.housemates, ['Gauge Berkhahn'])
  check('the portfolio figure is the sum of both', r.totals.overdue, 1700)
}

{
  const p = plan({ scheduled_payments: [
    rent({ due_date: shift(-40), status: 'paid', amount: 900, paid_amount: 900, paid_date: shift(-38) }),
    rent({ due_date: shift(20), amount: 900 }),
  ] })
  const e = only(buildTenantRoster([tenant()], [lease()], [p]))
  check('nothing past due reads as paid up', e.standing, 'current')
  check('the next charge is the soonest unpaid one', e.nextDue.date, shift(20))
  check('and rent that arrived late is remembered after it is paid', e.lateCount, 1)
}

{
  // The bug this pins: a twelve-month schedule has eleven unpaid rows in it on
  // day one, so a whole-term "outstanding" is the rest of the contract rather
  // than a balance — and it told a landlord their best tenant owed $9,900.
  const p = plan({ scheduled_payments: [
    rent({ due_date: shift(-30), status: 'paid', amount: 900, paid_amount: 900, paid_date: shift(-30) }),
    rent({ due_date: shift(30), amount: 900 }),
    rent({ due_date: shift(60), amount: 900 }),
  ] })
  const e = only(buildTenantRoster([tenant()], [lease()], [p]))
  check('rent not yet asked for is not a balance', e.totalDue, 0)
  check('and the pay rate is of what has come due, not of the contract', e.payRate, 100)
  check('the whole contract is still known, separately', e.lead.money.term.billed, 2700)
}

{
  // ACH in flight. The landlord does not have the money, but chasing it would
  // be chasing a payment the tenant has already made.
  const p = plan({ scheduled_payments: [
    rent({ due_date: shift(-3), status: 'processing', amount: 900, submitted_at: shift(-3) }),
  ] })
  const e = only(buildTenantRoster([tenant()], [lease()], [p]))
  check('a clearing payment is not overdue', e.overdue, 0)
  check('and it is called clearing, not unpaid', e.standing, 'clearing')
}

{
  // A voided charge was cancelled, not collected.
  const p = plan({ scheduled_payments: [rent({ status: 'voided', due_date: shift(-10) })] })
  const e = only(buildTenantRoster([tenant()], [lease()], [p]))
  check('a voided charge is not money owed', e.totalDue, 0)
}

{
  // The late fee is derived from the rule, never read from the corrupt
  // `late_fees_applied` column — and it is part of what the tenant owes.
  const p = plan({
    late_fee_rule: { id: 'r1', plan_id: 'pl1', grace_period_days: 0, fee_amount: 50, frequency_days: 0, max_total_fees: 50, created_at: shift(-150) },
    scheduled_payments: [rent({ due_date: shift(-10), amount: 900, late_fees_applied: 9999 })],
  })
  const e = only(buildTenantRoster([tenant()], [lease()], [p]))
  check('the fee comes from the rule, not the column', e.lateFeesDue, 50)
  check('and what they owe is the shortfall plus the fee', e.totalDue, 950)
}

{
  const p = plan({ tenants: [{ ...plan().tenants[0], status: 'terminated' }], scheduled_payments: [rent()] })
  const r = buildTenantRoster([tenant()], [lease()], [p])
  check('a payer terminated off the plan is no longer an active tenancy', r.active.length, 0)
}

// ── Ranking and filters ─────────────────────────────────────────────────────

{
  const owing = plan({ scheduled_payments: [rent({ due_date: shift(-10), amount: 900 })] })
  const paid = plan({
    id: 'pl2', lease_id: 'l2',
    lease: { id: 'l2', start_date: shift(-100), end_date: shift(200), rent_amount: 700, is_demo: false },
    tenants: [{ ...plan().tenants[0], id: 'pt2', name: 'Beth Cole', email: 'beth@asu.edu', monthly_total: 700 }],
    scheduled_payments: [rent({ plan_id: 'pl2', plan_tenant_id: 'pt2', due_date: shift(-10), amount: 700, status: 'paid', paid_amount: 700, paid_date: shift(-11) })],
  })
  const l2 = lease({ id: 'l2', tenants: [{ id: 'lt2', lease_id: 'l2', tenant_id: 't2', lead_id: null, name: 'Beth Cole', email: 'beth@asu.edu' }] })
  const r = buildTenantRoster(
    [tenant({ id: 't2', first_name: 'Beth', last_name: 'Cole', email: 'beth@asu.edu' }), tenant()],
    [lease(), l2], [owing, paid],
  )
  check('the person in arrears sorts first, whatever order they arrived in', r.active[0].tenant.id, 't1')
  check('the owing filter keeps only them', applyFilter(r.active, 'arrears').map(e => e.tenant.id), ['t1'])
  check('the collection rate is rent collected over rent billed', r.totals.collectionRate, 44)
}

{
  const ending = lease({ start_date: shift(-320), end_date: shift(20) })
  const r = buildTenantRoster([tenant()], [ending], [plan({ lease: { id: 'l1', start_date: shift(-320), end_date: shift(20), rent_amount: 900, is_demo: false } })])
  check('a term inside its last two months is ending soon', r.totals.endingSoon, 1)
  check('and the filter finds it', applyFilter(r.active, 'ending').length, 1)
}

{
  const r = buildTenantRoster([tenant()], [lease()], [])
  check('a tenancy with no plan is counted', r.totals.withoutPlan, 1)
  check('and found by its filter', applyFilter(r.active, 'no_plan').length, 1)
}

// ── Search ──────────────────────────────────────────────────────────────────

{
  const e = only(buildTenantRoster([tenant()], [lease()], [plan()]))
  check('search finds a name', matchesQuery(e, 'ada'), true)
  check('search finds an email', matchesQuery(e, 'ASU.EDU'), true)
  check('search finds the property they live in', matchesQuery(e, 'del rio'), true)
  check('search finds the room', matchesQuery(e, 'room 3'), true)
  check('and misses what is not there', matchesQuery(e, 'tempe'), false)
  check('an empty query matches everyone', matchesQuery(e, '   '), true)
}

// ── Report ──────────────────────────────────────────────────────────────────

for (const line of pass) console.log(`  ok   ${line}`)
if (fail.length) {
  console.log(`\n${pass.length} passed\n\n${fail.length} FAILED:`)
  for (const line of fail) console.log(`  ✗ ${line}`)
  process.exit(1)
}
console.log(`\n${pass.length} passed`)
console.log('✓ the roster derives "active" from the lease, joins payers by email before name, and owes what the money engine says')
