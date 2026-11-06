/**
 * Proves the Financials hierarchy and the dashboard model.
 *
 * The claims worth pinning down here are not arithmetic for its own sake. They
 * are the promises the redesign makes to a landlord, each of which a wrong
 * answer would make them act on:
 *
 *   • **One lease, however many plans.** The whole point of the hierarchy. Two
 *     payment plans written against one `lease_id` must come back as *one*
 *     tenancy whose rent, payers and arrears are the sum of both — not as two
 *     leases, which is what every money screen used to show and the reason a
 *     landlord could not find a tenant's payment plan.
 *   • **A plan with no lease is never dropped.** Older rows have no
 *     `lease_id`. They must still appear, keyed so they have a route.
 *   • **The levels add up.** property = Σ leases = Σ plans = Σ payers. If a
 *     level disagrees with its children, the tree is lying about which
 *     building is a problem.
 *   • **Owed means shortfall plus the fee assessed on it**, at every level,
 *     because that is the figure a tenant would be quoted.
 *   • **A waived fee is not owed.** A fee the landlord has written off must
 *     leave every figure, or the hierarchy and the collections page disagree
 *     about the same money.
 *   • **Aging buckets must partition the debt**, not overlap it and not lose
 *     any of it: the four buckets must sum to the arrears total exactly.
 *   • **A collection rate stays rent-against-rent.** Fold a late fee into the
 *     numerator and a tenant who pays a fee pushes the rate past 100%.
 *   • **Utilities are named, not buried.** The lease's monthly figure includes
 *     them, so the tree must be able to say how much of it they are.
 *
 * Pure functions over hand-built plans, so no database and no network.
 *
 * Run: node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/verify-financials-tree.mjs
 */
const { buildTree, findLease, leaseHref, planHref } =
  await import('../src/lib/financialsTree.ts')
const { buildDashboard, agingBuckets, trend, behaviour, bucketOf } =
  await import('../src/lib/financialsDashboard.ts')
const { arrears } = await import('../src/lib/financialsMonth.ts')

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

/** Early November, so October rent is a month overdue and November's is due. */
const NOW = new Date('2026-11-05T12:00:00-07:00')

const rent = over => ({
  id: over.id,
  plan_tenant_id: over.plan_tenant_id ?? 'payer-1',
  due_date: over.due_date ?? '2026-10-01',
  amount: over.amount ?? 800,
  paid_amount: over.paid_amount ?? 0,
  paid_date: over.paid_date ?? null,
  submitted_at: over.submitted_at ?? null,
  settled_at: over.settled_at ?? null,
  status: over.status ?? 'pending',
  late_fee_paid: over.late_fee_paid ?? 0,
  late_fees_applied: 0,
  payment_method: over.payment_method ?? null,
  processing_fee: 0,
  recorded_by: over.recorded_by ?? null,
  stripe_payment_intent_id: null,
  reminder_sent_at: null,
  reminder_count: over.reminder_count ?? 0,
  late_fee_reminder_sent_at: null,
  late_fee_reminder_count: 0,
  notes: null,
  void_reason: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  ...over,
})

const payer = over => ({
  id: over.id,
  plan_id: over.plan_id ?? 'plan-a',
  name: over.name,
  email: over.email ?? null,
  monthly_total: over.monthly_total ?? 800,
  created_at: '2026-08-01T00:00:00Z',
  line_items: over.line_items ?? [],
  start_date: null,
  end_date: null,
  status: over.status ?? 'active',
  termination_date: null,
  termination_reason: null,
})

const plan = over => ({
  id: over.id,
  owner_id: 'owner-1',
  property_id: over.property_id ?? 'prop-1',
  lease_id: over.lease_id ?? null,
  name: over.name ?? 'Unit 1',
  due_day: over.due_day ?? 1,
  notes: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  property: over.property ?? { id: 'prop-1', name: '1810 E Apache', slug: '1810-e-apache' },
  lease: over.lease ?? null,
  tenants: over.tenants ?? [],
  late_fee_rule: over.late_fee_rule ?? null,
  scheduled_payments: over.scheduled_payments ?? [],
  special_payments: over.special_payments ?? [],
  utilities: over.utilities ?? [],
})

const LEASE = { id: 'lease-1', start_date: '2026-08-01', end_date: '2027-07-31', rent_amount: 1600 }

// ─── 1. ONE LEASE, TWO PLANS ─────────────────────────────────────────────────
//
// The case the hierarchy exists for: a flat where two tenants are billed
// through separate plans against one lease. Every money screen used to show
// this as two unrelated leases.
{
  const a = plan({
    id: 'plan-a', lease_id: 'lease-1', lease: LEASE, name: 'Apache 2B',
    tenants: [payer({ id: 't-aleeya', plan_id: 'plan-a', name: 'Aleeya', monthly_total: 800 })],
    scheduled_payments: [
      rent({ id: 'a-sep', plan_tenant_id: 't-aleeya', due_date: '2026-09-01', status: 'paid', paid_amount: 800, paid_date: '2026-09-01', payment_method: 'card', recorded_by: 'tenant' }),
      rent({ id: 'a-oct', plan_tenant_id: 't-aleeya', due_date: '2026-10-01' }),  // overdue
      rent({ id: 'a-nov', plan_tenant_id: 't-aleeya', due_date: '2026-12-01' }),  // not due yet
    ],
  })
  const b = plan({
    id: 'plan-b', lease_id: 'lease-1', lease: LEASE, name: 'Apache 2B',
    tenants: [payer({ id: 't-mia', plan_id: 'plan-b', name: 'Mia', monthly_total: 800 })],
    scheduled_payments: [
      rent({ id: 'b-sep', plan_tenant_id: 't-mia', due_date: '2026-09-01', status: 'paid', paid_amount: 800, paid_date: '2026-09-03', payment_method: 'ach', recorded_by: 'tenant' }),
      rent({ id: 'b-oct', plan_tenant_id: 't-mia', due_date: '2026-10-01', status: 'paid', paid_amount: 800, paid_date: '2026-10-01', payment_method: 'ach', recorded_by: 'tenant' }),
      rent({ id: 'b-nov', plan_tenant_id: 't-mia', due_date: '2026-12-01' }),
    ],
  })

  const tree = buildTree([a, b], [], NOW)

  check('two plans on one lease are ONE tenancy', tree.leaseCount, 1)
  check('and one property', tree.propertyCount, 1)
  check('the tenancy knows it is split-billed', tree.leases[0].splitBilling, true)
  check('it holds both plans', tree.leases[0].plans.length, 2)
  check('its payers are the union of both plans', tree.leases[0].payers.map(p => p.name).sort(), ['Aleeya', 'Mia'])
  check('its monthly rent is the sum of its plans', tree.leases[0].monthly, 1600)
  check('the lease key is the lease id, so it has one route', tree.leases[0].key, 'lease-1')
  check('and that route is stable', leaseHref(tree.leases[0].key), '/landlord/financials/lease/lease-1')

  // The levels have to add up, or the tree is lying about which building is a
  // problem.
  const l = tree.leases[0]
  const p = tree.properties[0]
  check('property billed = Σ its leases', p.totals.billed, l.totals.billed)
  check('lease billed = Σ its plans', l.totals.billed, l.plans.reduce((n, x) => n + x.totals.billed, 0))
  check('lease collected = Σ its plans', l.totals.collected, l.plans.reduce((n, x) => n + x.totals.collected, 0))
  check('lease owed = Σ its plans', l.owed, l.plans.reduce((n, x) => n + x.owed, 0))
  check('plan owed = Σ its payers', l.plans[0].owed, l.plans[0].payers.reduce((n, x) => n + x.owed, 0))

  // Aleeya missed October; Mia did not. One tenancy, one of two payers behind.
  check('only the payer who missed is behind', l.payers.filter(x => x.owed > 0).map(x => x.name), ['Aleeya'])
  check('the tenancy owes exactly her shortfall', l.owed, 800)
  check('a paid month is not owed', tree.leases[0].payers.find(x => x.name === 'Mia').owed, 0)

  // Six charges of $800 across both plans, three of them settled.
  check('the tenancy bills both plans', l.totals.billed, 4800)
  check('and collects across both', l.totals.collected, 2400)
  check('collection rate counts only rent', l.totals.rate, 50)
}

// ─── 2. A PLAN WITH NO LEASE IS STILL REACHABLE ──────────────────────────────
{
  const orphan = plan({
    id: 'plan-orphan', lease_id: null, name: 'Old arrangement',
    tenants: [payer({ id: 't-old', plan_id: 'plan-orphan', name: 'Rae' })],
    scheduled_payments: [rent({ id: 'o-1', plan_tenant_id: 't-old', due_date: '2026-10-01' })],
  })
  const tree = buildTree([orphan], [], NOW)
  check('a plan with no lease is not dropped', tree.leaseCount, 1)
  check('and is keyed so it has a route', tree.leases[0].key, 'plan-plan-orphan')
  check('it is not reported as split-billed', tree.leases[0].splitBilling, false)
  check('findLease can reach it', findLease(tree, 'plan-plan-orphan') !== null, true)
  check('the plan route is unchanged', planHref('plan-orphan'), '/landlord/financials/plan/plan-orphan')
}

// ─── 3. OWED MEANS SHORTFALL PLUS THE FEE ON IT ──────────────────────────────
//
// A fee the rule has assessed is money owed, so it belongs in the total. The
// old page showed the rent half, which meant no figure anywhere was the number
// to put in front of a tenant.
{
  const RULE = {
    id: 'rule-1', plan_id: 'plan-f', grace_period_days: 0,
    fee_amount: 10, frequency_days: 1, max_total_fees: 50,
    created_at: '2026-08-01T00:00:00Z',
  }
  const withFee = plan({
    id: 'plan-f', lease_id: 'lease-f', lease: { ...LEASE, id: 'lease-f' }, name: 'Fee flat',
    late_fee_rule: RULE,
    tenants: [payer({ id: 't-f', plan_id: 'plan-f', name: 'Jonah' })],
    scheduled_payments: [rent({ id: 'f-oct', plan_tenant_id: 't-f', due_date: '2026-10-01' })],
  })

  const tree = buildTree([withFee], [], NOW)
  const l = tree.leases[0]
  check('the fee is capped by its rule', l.lateFees, 50)
  check('owed is the shortfall plus the fee', l.owed, 850)
  check('shortfall is reported separately', l.shortfall, 800)
  check('the payer carries the same split', l.payers[0].owed, 850)
  check('and the property rolls it up', tree.properties[0].owed, 850)
  check('the rule is quotable in words', typeof l.plans[0].feeRule, 'string')

  // A waived fee is not owed. Without this the hierarchy and the collections
  // page would disagree about the same money.
  const waived = buildTree([withFee], [
    { scheduled_payment_id: 'f-oct', amount: 50, reason: 'goodwill', created_at: '2026-11-02T00:00:00Z', tenant_note: null, tenant_notified_at: null, tenant_notified_email: null },
  ], NOW)
  check('a waived fee leaves the fee figure', waived.leases[0].lateFees, 0)
  check('and leaves what is owed', waived.leases[0].owed, 800)
  check('the rent it sat on is still owed', waived.leases[0].shortfall, 800)
}

// ─── 4. UTILITIES ARE NAMED, NOT BURIED ──────────────────────────────────────
//
// The monthly figure silently includes them, so a landlord who cannot see them
// cannot tell rent from the bills riding on it.
{
  const withUtils = plan({
    id: 'plan-u', lease_id: 'lease-u', lease: { ...LEASE, id: 'lease-u' }, name: 'Utility flat',
    tenants: [
      payer({ id: 't-u1', plan_id: 'plan-u', name: 'Ana', monthly_total: 850, line_items: [
        { id: 'li-1', plan_tenant_id: 't-u1', category: 'rent', label: 'Rent', amount: 800, notes: null, created_at: '2026-08-01T00:00:00Z', utility_id: null },
        { id: 'li-2', plan_tenant_id: 't-u1', category: 'water', label: 'Water', amount: 50, notes: null, created_at: '2026-08-01T00:00:00Z', utility_id: 'u-1' },
      ] }),
      payer({ id: 't-u2', plan_id: 'plan-u', name: 'Bo', monthly_total: 850, line_items: [] }),
    ],
    utilities: [
      { id: 'u-1', label: 'Water', category: 'water', amount: 50, cadence: 'monthly', split: 'per_payer' },
      { id: 'u-2', label: 'Trash', category: 'trash', amount: 40, cadence: 'monthly', split: 'even' },
    ],
  })

  const tree = buildTree([withUtils], [], NOW)
  const l = tree.leases[0]
  check('declared utilities are listed', l.utilities.map(u => u.label), ['Water', 'Trash'])
  // per_payer: each of the two payers owes $50. even: one $40 bill between them.
  check('a per-payer utility costs the house once per payer', l.utilities[0].houseMonthly, 100)
  check('an evenly split utility costs the house once', l.utilities[1].houseMonthly, 40)
  check('the lease can say what utilities add each month', l.utilitiesMonthly, 140)
  check('a payer line knows it came from a utility', l.payers[0].lines.find(x => x.label === 'Water').isUtility, true)
  check('and a rent line knows it did not', l.payers[0].lines.find(x => x.label === 'Rent').isUtility, false)
}

// ─── 5. AGING MUST PARTITION THE DEBT ────────────────────────────────────────
//
// Four buckets that overlap, or that lose a charge between them, make the
// aging report disagree with the arrears total it sits under.
{
  const aged = plan({
    id: 'plan-age', lease_id: 'lease-age', lease: { ...LEASE, id: 'lease-age' }, name: 'Aged',
    tenants: [
      payer({ id: 't-a', plan_id: 'plan-age', name: 'Fresh' }),
      payer({ id: 't-b', plan_id: 'plan-age', name: 'Month' }),
      payer({ id: 't-c', plan_id: 'plan-age', name: 'Severe' }),
    ],
    scheduled_payments: [
      rent({ id: 'g-1', plan_tenant_id: 't-a', due_date: '2026-11-01', amount: 100 }),  //   4 days
      rent({ id: 'g-2', plan_tenant_id: 't-b', due_date: '2026-10-10', amount: 200 }),  //  26 days
      rent({ id: 'g-3', plan_tenant_id: 't-c', due_date: '2026-07-01', amount: 300 }),  // 127 days
    ],
  })

  const a = arrears([aged], NOW)
  const buckets = agingBuckets(a)

  check('the buckets sum to the arrears total',
    Math.round(buckets.reduce((n, b) => n + b.amount, 0) * 100) / 100, a.total)
  check('every overdue charge lands in exactly one bucket',
    buckets.reduce((n, b) => n + b.count, 0), a.chargeCount)
  check('a 4-day debt is in the first bucket', buckets[0].amount, 100)
  check('a 26-day debt is in the second', buckets[1].amount, 200)
  check('nothing is in the 31–60 band', buckets[2].amount, 0)
  check('a 127-day debt is in the last', buckets[3].amount, 300)
  check('the boundaries are the industry ones',
    buckets.map(b => [b.from, b.to]), [[1, 15], [16, 30], [31, 60], [61, null]])
  check('bucketOf agrees at the boundaries',
    [bucketOf(1), bucketOf(15), bucketOf(16), bucketOf(30), bucketOf(31), bucketOf(60), bucketOf(61)],
    ['fresh', 'fresh', 'month', 'month', 'twoMonths', 'twoMonths', 'severe'])
}

// ─── 6. THE DASHBOARD'S OWN PROMISES ─────────────────────────────────────────
{
  const RULE = {
    id: 'r', plan_id: 'plan-d', grace_period_days: 0,
    fee_amount: 10, frequency_days: 1, max_total_fees: 30, created_at: '2026-08-01T00:00:00Z',
  }
  const p1 = plan({
    id: 'plan-d', lease_id: 'lease-d', lease: LEASE, name: 'Dash flat', late_fee_rule: RULE,
    tenants: [payer({ id: 't-d', plan_id: 'plan-d', name: 'Dana', monthly_total: 800 })],
    scheduled_payments: [
      rent({ id: 'd-sep', plan_tenant_id: 't-d', due_date: '2026-09-01', status: 'paid', paid_amount: 800, paid_date: '2026-09-05', payment_method: 'card', recorded_by: 'tenant', late_fee_paid: 20 }),
      rent({ id: 'd-oct', plan_tenant_id: 't-d', due_date: '2026-10-01' }),
      rent({ id: 'd-nov', plan_tenant_id: 't-d', due_date: '2026-11-30' }),
    ],
    special_payments: [{
      id: 'sp-1', plan_id: 'plan-d', plan_tenant_id: 't-d', category: 'security_deposit',
      label: 'Deposit', amount: 500, due_date: '2026-08-01', status: 'paid',
      paid_date: '2026-08-01', settled_at: null, submitted_at: null, payment_method: 'card',
      processing_fee: 0, stripe_payment_intent_id: null, notes: null,
      reminder_sent_at: null, reminder_count: 0,
      created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', utility_id: null,
    }],
  })

  const d = buildDashboard([p1], [], NOW)

  check('the dashboard names its month', d.thisMonth.label, 'November 2026')
  check('and the month before it', d.lastMonth.label, 'October 2026')
  check('deposits held are standing, not windowed', d.depositsHeld, 500)
  check('overdue is the October shortfall plus its capped fee', d.owed, 830)
  check('one person is behind', d.owedPayers, 1)

  // The fee cap is **per charge**, not per lease, and the two buckets are
  // genuinely different decisions. October's rent is unpaid, so its fee is
  // still growing and is already at the rule's $30 ceiling. September's rent
  // settled four days late, which froze its fee at the same $30 — of which
  // $20 was actually paid, leaving $10 the landlord may bill or write off.
  check('the accruing bucket is the unpaid month', d.fees.accruing, 30)
  check('the frozen bucket is what was never collected', d.fees.uncollected, 10)
  check('fees that genuinely arrived are reported apart', d.fees.collected, 20)
  check('and the ledger total is the two owed buckets', d.fees.total, 40)
  // Only the accruing part is arrears: a fee on rent that has already settled
  // is not an overdue charge, which is exactly why they are separate sections.
  check('arrears carries only the fee on unpaid rent', d.arrears.lateFees, 30)

  // A rate is rent against rent. September took $800 of rent and $20 of fee;
  // the rate must read 100%, not 102.5%.
  const sep = d.trend.find(t => t.key === '2026-09')
  check('September collected its rent in full', sep.rate, 100)
  check('the fee is reported beside the rate, not inside it', sep.feesCollected, 20)
  check('money-in includes the fee', sep.received, 820)

  // Late arrival is a different fact from arrears, and the one that predicts
  // next month. Dana paid September four days late and has since settled.
  check('a late arrival is remembered after it settles', d.behaviour.late, 1)
  check('with its lateness', d.behaviour.avgDaysLate, 4)
  check('the on-time rate is over settled charges only', d.behaviour.settled, 2)

  // The trend window is a full year, ending this month, and future months are
  // marked rather than drawn as a collection failure.
  check('the trend is twelve months', d.trend.length, 12)
  check('ending with this one', d.trend[11].key, '2026-11')
  check('and starting a year back', d.trend[0].key, '2025-12')
  check('this month is marked current', d.trend[11].position, 'current')
  check('a month with nothing billed has no rate', d.trend[0].rate, null)

  // The look-ahead is knowable, not forecast: November's second charge is in it.
  check('the look-ahead starts at this month', d.upcoming[0].key, '2026-11')
  check('and reaches six months', d.upcoming.length, 6)

  const t12 = trend([], 12, NOW)
  check('an empty portfolio still produces a full window', t12.length, 12)
  check('with no rate anywhere', t12.every(x => x.rate === null), true)
  check('and behaviour says so rather than dividing by zero', behaviour([], 12, NOW).rate, null)
}

// ─── 7. AN EMPTY PORTFOLIO ───────────────────────────────────────────────────
{
  const tree = buildTree([], [], NOW)
  check('an empty tree has no properties', tree.propertyCount, 0)
  check('and owes nothing', tree.owed, 0)
  const d = buildDashboard([], [], NOW)
  check('the dashboard says it is empty', d.empty, true)
  check('with no rate rather than a zero', d.rate12, null)
  check('and no action list', d.todo.length, 0)
}

console.log(`${pass.length} passed`)
for (const p of pass) console.log('  ok   ' + p)
if (fail.length) {
  console.log(`\n${fail.length} FAILED`)
  for (const f of fail) console.log('  FAIL ' + f)
  process.exit(1)
}
console.log('\nall good')
