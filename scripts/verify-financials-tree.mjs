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
const { arrears, allCharges } = await import('../src/lib/financialsMonth.ts')
const { signals, pulse, reliability } = await import('../src/lib/financialsSignals.ts')
const { forecast } = await import('../src/lib/financialsForecast.ts')
const { statement, statementCsv, statementMonths } =
  await import('../src/lib/financialsStatement.ts')

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


// ─── 8. THE JUDGEMENT LAYER ──────────────────────────────────────────────────
//
// Signals are the one part of this product that renders an opinion, so the
// claims worth pinning down are the ones a landlord would act on wrongly.
{
  const RULE = {
    id: 'r', plan_id: 'plan-s', grace_period_days: 0,
    fee_amount: 5, frequency_days: 1, max_total_fees: 40, created_at: '2026-08-01T00:00:00Z',
  }

  // A lease ending inside its deposit window, with money owed on it. This is
  // the most expensive mistake in the domain: once the deposit goes back the
  // leverage is gone, so it must outrank a larger but open-ended debt.
  const closing = plan({
    id: 'plan-s', lease_id: 'lease-s', name: 'Ending flat', late_fee_rule: RULE,
    lease: { id: 'lease-s', start_date: '2026-01-01', end_date: '2026-12-15', rent_amount: 800 },
    tenants: [payer({ id: 't-s', plan_id: 'plan-s', name: 'Noor' })],
    scheduled_payments: [
      rent({ id: 's-oct', plan_tenant_id: 't-s', due_date: '2026-10-01' }),
    ],
    special_payments: [{
      id: 'sp-dep', plan_id: 'plan-s', plan_tenant_id: 't-s', category: 'security_deposit',
      label: 'Deposit', amount: 900, due_date: '2026-01-01', status: 'paid',
      paid_date: '2026-01-01', settled_at: null, submitted_at: null, payment_method: 'card',
      processing_fee: 0, stripe_payment_intent_id: null, notes: null,
      reminder_sent_at: null, reminder_count: 0,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', utility_id: null,
    }],
  })

  const d = buildDashboard([closing], [], NOW)
  const list = signals(d)
  const ids = list.map(s2 => s2.id)

  check('a closing deposit window is reported', ids.includes('deposit-window-lease-s'), true)
  const dw = list.find(s2 => s2.id === 'deposit-window-lease-s')
  check('and is critical, because it has a deadline', dw.severity, 'critical')
  check('it names the deposit being held', dw.detail.includes('$900'), true)
  check('overdue-and-never-chased is reported too', ids.includes('never-chased'), true)

  // Severity ordering is the whole point of a ranked list.
  check('critical signals sort first',
    list[0].severity, 'critical')
  // Every signal must be actionable and evidenced, or it is a horoscope.
  check('every signal carries evidence', list.every(s2 => s2.evidence.length > 0), true)
  check('every signal links somewhere in the money area',
    list.every(s2 => s2.action.href.startsWith('/landlord/')), true)
  check('every signal has a label on its button', list.every(s2 => s2.action.label.length > 0), true)

  // The pulse is the page's one sentence.
  const pl = pulse(d, list)
  check('the pulse leads with the money owed', pl.headline.includes('overdue'), true)
  check('and is toned by the worst signal', pl.tone, 'critical')
  check('and offers the collections list', pl.action.href, '/landlord/financials/collections')
}

// A healthy portfolio must say so — a panel that only ever reports problems is
// one a landlord stops reading.
{
  const clean = plan({
    id: 'plan-h', lease_id: 'lease-h', lease: LEASE, name: 'Good flat',
    tenants: [payer({ id: 't-h', plan_id: 'plan-h', name: 'Ivy' })],
    scheduled_payments: [
      rent({ id: 'h-1', plan_tenant_id: 't-h', due_date: '2026-08-01', status: 'paid', paid_amount: 800, paid_date: '2026-08-01', payment_method: 'card', recorded_by: 'tenant' }),
      rent({ id: 'h-2', plan_tenant_id: 't-h', due_date: '2026-09-01', status: 'paid', paid_amount: 800, paid_date: '2026-09-01', payment_method: 'card', recorded_by: 'tenant' }),
      rent({ id: 'h-3', plan_tenant_id: 't-h', due_date: '2026-10-01', status: 'paid', paid_amount: 800, paid_date: '2026-10-01', payment_method: 'card', recorded_by: 'tenant' }),
      rent({ id: 'h-4', plan_tenant_id: 't-h', due_date: '2026-12-01' }),
    ],
  })
  const d = buildDashboard([clean], [], NOW)
  const list = signals(d)
  check('a clean portfolio gets a positive signal', list.some(s2 => s2.id === 'healthy'), true)
  check('and no critical ones', list.some(s2 => s2.severity === 'critical'), false)
  const pl = pulse(d, list)
  check('the pulse says everyone is up to date', pl.headline, 'Everyone is up to date')
  check('and is calm', pl.tone, 'calm')
}

// ─── 9. RELIABILITY ─────────────────────────────────────────────────────────
//
// The figure arrears cannot give you: a tenant who always pays, three weeks
// late, is invisible in every arrears total the moment their money lands.
{
  const chronic = plan({
    id: 'plan-c', lease_id: 'lease-c', lease: LEASE, name: 'Chronic flat',
    tenants: [
      payer({ id: 't-late', plan_id: 'plan-c', name: 'Late Larry' }),
      payer({ id: 't-good', plan_id: 'plan-c', name: 'Prompt Pat' }),
      payer({ id: 't-new', plan_id: 'plan-c', name: 'New Nia' }),
    ],
    scheduled_payments: [
      // Late on three of four, by 10, 12 and 30 days. Median of the late ones
      // is 12 — the mean would be 17 and would describe nobody.
      rent({ id: 'c-1', plan_tenant_id: 't-late', due_date: '2026-07-01', status: 'paid', paid_amount: 800, paid_date: '2026-07-11', payment_method: 'ach', recorded_by: 'tenant' }),
      rent({ id: 'c-2', plan_tenant_id: 't-late', due_date: '2026-08-01', status: 'paid', paid_amount: 800, paid_date: '2026-08-13', payment_method: 'ach', recorded_by: 'tenant' }),
      rent({ id: 'c-3', plan_tenant_id: 't-late', due_date: '2026-09-01', status: 'paid', paid_amount: 800, paid_date: '2026-10-01', payment_method: 'ach', recorded_by: 'tenant' }),
      rent({ id: 'c-4', plan_tenant_id: 't-late', due_date: '2026-10-01', status: 'paid', paid_amount: 800, paid_date: '2026-10-01', payment_method: 'ach', recorded_by: 'tenant' }),
      rent({ id: 'c-5', plan_tenant_id: 't-good', due_date: '2026-09-01', status: 'paid', paid_amount: 800, paid_date: '2026-09-01', payment_method: 'card', recorded_by: 'tenant' }),
      rent({ id: 'c-6', plan_tenant_id: 't-good', due_date: '2026-10-01', status: 'paid', paid_amount: 800, paid_date: '2026-09-28', payment_method: 'card', recorded_by: 'tenant' }),
      rent({ id: 'c-7', plan_tenant_id: 't-new', due_date: '2026-12-01' }),
    ],
  })

  const charges = allCharges([chronic], NOW)
  const rel = reliability(charges)
  const byName = new Map(rel.map(r => [r.name, r]))

  check('a chronically late payer is banded as such', byName.get('Late Larry').band, 'chronic')
  check('and the typical lateness is the median, not the mean',
    byName.get('Late Larry').medianDaysLate, 12)
  check('the worst month is kept separately', byName.get('Late Larry').worstDaysLate, 30)
  check('late on three of four', [byName.get('Late Larry').late, byName.get('Late Larry').settled], [3, 4])
  check('a prompt payer is banded reliable', byName.get('Prompt Pat').band, 'reliable')
  check('paying early is not late', byName.get('Prompt Pat').late, 0)
  check('and their note says so', byName.get('Prompt Pat').note.includes('on time'), true)
  check('a payer with no history is not ranked as perfect',
    byName.get('New Nia').score < byName.get('Prompt Pat').score, true)
  check('and says there is no pattern yet',
    byName.get('New Nia').note.includes('no pattern'), true)
  check('the worst record sorts first', rel[0].name, 'Late Larry')
}

// Owing money today outranks any history: that is a different conversation.
{
  const owing = plan({
    id: 'plan-o', lease_id: 'lease-o', lease: LEASE, name: 'Owing flat',
    tenants: [payer({ id: 't-o', plan_id: 'plan-o', name: 'Owen' })],
    scheduled_payments: [
      rent({ id: 'o-1', plan_tenant_id: 't-o', due_date: '2026-09-01', status: 'paid', paid_amount: 800, paid_date: '2026-09-01', payment_method: 'card', recorded_by: 'tenant' }),
      rent({ id: 'o-2', plan_tenant_id: 't-o', due_date: '2026-10-01' }),
    ],
  })
  const rel = reliability(allCharges([owing], NOW))
  check('a payer in arrears is banded delinquent', rel[0].band, 'delinquent')
  check('even with a clean settled record', rel[0].late, 0)
  check('and the band is in words, not only a colour', rel[0].bandLabel, 'In arrears now')
}

// ─── 10. THE CASH PROJECTION ────────────────────────────────────────────────
//
// The most dangerous number this product could print is a forecast that
// quietly assumes overdue money arrives. These assertions exist to stop that.
{
  const RULE = null
  const fc = plan({
    id: 'plan-fc', lease_id: 'lease-fc', lease: LEASE, name: 'Forecast flat', late_fee_rule: RULE,
    tenants: [
      payer({ id: 't-slip', plan_id: 'plan-fc', name: 'Slips Sam' }),
      payer({ id: 't-ontime', plan_id: 'plan-fc', name: 'Onthe Dot' }),
      payer({ id: 't-behind', plan_id: 'plan-fc', name: 'Behind Bea' }),
    ],
    scheduled_payments: [
      // Sam is reliably 8 days late: two settled charges, both 8 days late.
      rent({ id: 'f-s1', plan_tenant_id: 't-slip', due_date: '2026-08-01', status: 'paid', paid_amount: 800, paid_date: '2026-08-09', payment_method: 'ach', recorded_by: 'tenant' }),
      rent({ id: 'f-s2', plan_tenant_id: 't-slip', due_date: '2026-09-01', status: 'paid', paid_amount: 800, paid_date: '2026-09-09', payment_method: 'ach', recorded_by: 'tenant' }),
      // ...and owes one due 15 Nov, which should land in the week of the 23rd.
      rent({ id: 'f-s3', plan_tenant_id: 't-slip', due_date: '2026-11-15' }),

      // Dot has two on-time settlements and one due 15 Nov, which stays put.
      rent({ id: 'f-d1', plan_tenant_id: 't-ontime', due_date: '2026-08-01', status: 'paid', paid_amount: 800, paid_date: '2026-08-01', payment_method: 'card', recorded_by: 'tenant' }),
      rent({ id: 'f-d2', plan_tenant_id: 't-ontime', due_date: '2026-09-01', status: 'paid', paid_amount: 800, paid_date: '2026-09-01', payment_method: 'card', recorded_by: 'tenant' }),
      rent({ id: 'f-d3', plan_tenant_id: 't-ontime', due_date: '2026-11-15' }),

      // Bea is already overdue, and also has a future charge.
      rent({ id: 'f-b1', plan_tenant_id: 't-behind', due_date: '2026-10-01' }),
      rent({ id: 'f-b2', plan_tenant_id: 't-behind', due_date: '2026-11-15' }),

      // An ACH debit in flight: the tenant has sent it, so it is the one
      // certainty in the whole projection.
      rent({ id: 'f-clear', plan_tenant_id: 't-ontime', due_date: '2026-11-01', status: 'processing', paid_amount: 0, payment_method: 'ach', recorded_by: 'tenant' }),
    ],
  })

  const charges = allCharges([fc], NOW)
  const f = forecast(charges, 13, NOW)

  // The central promise.
  check('existing arrears never enter a week',
    f.weeks.every(w => w.onTime + w.slipping + w.clearing >= 0), true)
  check('overdue money is reported apart, unscheduled', f.overdueUnscheduled, 800)
  check('and is not counted as expected',
    f.expected < f.contracted + 800, true)

  // Weeks run from today: 5 Nov is week 0, 12 Nov week 1, 19 Nov week 2.
  check('the window starts today', f.weeks[0].start, '2026-11-05')
  check('and runs thirteen weeks', f.weeks.length, 13)

  const wk = (d2) => f.weeks.findIndex(w => d2 >= w.start && d2 <= w.end)
  const onTimeWeek = wk('2026-11-15')
  const slipWeek = wk('2026-11-23')
  check('a punctual payer is projected on the due date',
    f.weeks[onTimeWeek].onTime, 800)
  check('a reliably late payer is projected late',
    f.weeks[slipWeek].slipping, 800)
  check('and that is a different week from the due date',
    slipWeek > onTimeWeek, true)

  check('money in flight lands in the first week', f.weeks[0].clearing, 800)
  check('a charge owed by someone already behind is at risk, not expected',
    f.weeks[onTimeWeek].atRisk, 800)
  check('at risk is excluded from the week it sits in',
    f.weeks[onTimeWeek].expected, 800)
  check('expected is clearing plus on-time plus slipping',
    f.expected,
    Math.round(f.weeks.reduce((n, w) => n + w.clearing + w.onTime + w.slipping, 0) * 100) / 100)
  check('slippage is never negative', f.slippage >= 0, true)
  check('payers modelled from their own history are counted', f.modelledPayers, 1)

  const empty = forecast([], 13, NOW)
  check('an empty portfolio forecasts nothing', empty.empty, true)
  check('and offers no weeks to misread', empty.weeks.length, 0)
}

// ─── 11. THE OWNER STATEMENT ────────────────────────────────────────────────
//
// The only document here that leaves the building, and the only surface that
// has to balance. A statement that silently does not add up is worse than no
// statement: it will be forwarded to an accountant who trusts it.
{
  const stmt = plan({
    id: 'plan-st', lease_id: 'lease-st', lease: LEASE, name: 'Statement flat',
    property: { id: 'prop-st', name: '42 Mill Ave', slug: '42-mill-ave' },
    property_id: 'prop-st',
    tenants: [payer({ id: 't-st', plan_id: 'plan-st', name: 'Sara' })],
    scheduled_payments: [
      // September's rent went unpaid until 10 October — so it is October's
      // opening arrears AND October's recovery, which is the case a naive
      // statement gets wrong.
      rent({ id: 'st-sep', plan_tenant_id: 't-st', due_date: '2026-09-01', status: 'paid', paid_amount: 800, paid_date: '2026-10-10', payment_method: 'ach', recorded_by: 'tenant' }),
      rent({ id: 'st-oct', plan_tenant_id: 't-st', due_date: '2026-10-01' }),
    ],
    special_payments: [{
      id: 'st-dep', plan_id: 'plan-st', plan_tenant_id: 't-st', category: 'security_deposit',
      label: 'Deposit', amount: 500, due_date: '2026-10-05', status: 'paid',
      paid_date: '2026-10-05', settled_at: null, submitted_at: null, payment_method: 'card',
      processing_fee: 0, stripe_payment_intent_id: null, notes: null,
      reminder_sent_at: null, reminder_count: 0,
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', utility_id: null,
    }],
  })

  const s2 = statement([stmt], 'prop-st', '2026-10', NOW)

  check('the statement names the property', s2.propertyName, '42 Mill Ave')
  check('and the period by name', s2.monthLabel, 'October 2026')
  check('and carries the day it was produced', s2.producedOn, '2026-11-05')

  // The identity: opening + billed − collected − recovered = closing.
  check('September is October’s opening arrears', s2.openingArrears, 800)
  check('and paying it in October is recovery', s2.recovered, 800)
  check('October’s own rent is what was billed', s2.billed, 800)
  check('nothing was collected against October itself', s2.collected, 0)
  check('so the closing balance is October’s unpaid rent', s2.closingArrears, 800)
  check('and the statement balances', s2.balances, true)
  check('the identity actually holds',
    Math.round((s2.openingArrears + s2.billed - s2.collected - s2.recovered) * 100) / 100,
    s2.closingArrears)

  // A deposit is not income. Rolling it into collected rent is the most common
  // error in small-landlord bookkeeping and this must never do it.
  check('a deposit is not billed rent', s2.billed, 800)
  check('nor collected rent', s2.collected, 0)
  check('it is reported in its own figure', s2.depositsReceived, 500)
  check('and as a held liability', s2.depositsHeld, 500)

  // A rate on the page stays rent against rent.
  check('the collection rate ignores deposits and fees', s2.rate, 0)

  const csv = statementCsv(s2)
  check('the export names the property', csv.includes('42 Mill Ave'), true)
  check('and carries the closing balance', csv.includes('Closing arrears'), true)
  check('and keeps deposits out of the rent block',
    csv.includes('Deposits held (liability)'), true)

  const months = statementMonths([stmt], 'prop-st', NOW)
  check('the month picker offers the months with activity',
    months.includes('2026-09') && months.includes('2026-10'), true)
  check('and always offers the current one', months.includes('2026-11'), true)
  check('newest first', months[0], months.slice().sort((a, b) => b.localeCompare(a))[0])

  const quiet = statement([stmt], 'prop-st', '2025-01', NOW)
  check('a month with no activity says it is empty', quiet.empty, true)
}


console.log(`${pass.length} passed`)
for (const p of pass) console.log('  ok   ' + p)
if (fail.length) {
  console.log(`\n${fail.length} FAILED`)
  for (const f of fail) console.log('  FAIL ' + f)
  process.exit(1)
}
console.log('\nall good')
