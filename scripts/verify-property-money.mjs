/**
 * Proves the cost side of the money area, and the rent roll.
 *
 * These models are new, and they carry the first figures in this product that
 * a landlord could act on in a way that loses them real money — "this property
 * makes $140 a month" is a decision input in a way that "you collected $2,400"
 * is not. So the claims pinned here are the ones a wrong answer would mislead
 * on:
 *
 *   • **Capital is never an expense.** A new roof must stay out of operating
 *     cost, out of NOI, out of cash flow and off every deductible tax line,
 *     and still be reported. Folding it in overstates what a property costs
 *     and understates what it is worth, and it is the single most likely
 *     mistake in this whole area.
 *   • **NOI excludes the mortgage; cash flow subtracts it.** Two figures, and
 *     conflating them is the classic small-landlord error. A property with no
 *     debt must have identical NOI and cash flow; one with debt must not.
 *   • **Cents survive.** Expenses are the first money in this product with
 *     decimals in it. Twelve $142.67 premiums must total $1,712.04 exactly —
 *     float drift here is wrong by real money at tax time.
 *   • **`incurred_on` decides the bucket, never `created_at`.** A premium
 *     entered today for last December belongs to December's month and to last
 *     year's tax summary.
 *   • **A part-year is flagged.** `running` must be true for the current year,
 *     so no surface can print a part-year total as a final one.
 *   • **The P&L series never reaches past today**, so no row can read as a
 *     profit forecast — and the running month, being partial, is in the totals
 *     but out of every average.
 *   • **Shared tax lines fold.** Management and letting fees are both
 *     Schedule E line 11 and must appear once, with both categories named.
 *   • **Occupancy never guesses.** With no room count on the listing it must
 *     report null rather than reading as exactly full — including on the rent
 *     roll, where counting such a property as one full unit would quietly drag
 *     the portfolio's occupancy towards 100%. With no asking price it must not
 *     price the vacancy.
 *   • **The rent roll emits a row per empty room.** This is the one thing that
 *     makes it a rent roll and not a lease list. It must also refuse to invent
 *     a unit count, and it must keep asking rent distinguishable from
 *     contracted rent in the total.
 *   • **Deposits are never income.** They must stay out of every rent total on
 *     the roll.
 *
 * Pure functions over hand-built rows, so no database and no network.
 *
 * Run: node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/verify-property-money.mjs
 */
const {
  CATEGORY_META, totalExpenses, expensesByMonth, noi, taxSummary,
  expensesCsv, inYear, expenseYears, isCapital,
} = await import('../src/lib/propertyExpenses.ts')
const {
  monthlyPnl, periodPnl, yearPnl, pnlYears, occupancy, askGap, windowMonths,
} = await import('../src/lib/propertyMoney.ts')
const { rentRoll, rentRollCsv } = await import('../src/lib/rentRoll.ts')
const { buildTree } = await import('../src/lib/financialsTree.ts')
const { allCharges } = await import('../src/lib/financialsMonth.ts')

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

/** Early November 2026, matching the other verify scripts in this repo. */
const NOW = new Date('2026-11-05T12:00:00-07:00')

/** Matches `PaymentPlanTenant`: the money is `monthly_total` and the liveness
 *  flag is `status`, not `share_amount`/`is_active`. */
const payer = over => ({
  id: over.id,
  plan_id: over.plan_id ?? 'plan-1',
  name: over.name ?? 'Aleeya',
  email: over.email ?? 'a@x.com',
  monthly_total: over.monthly_total ?? 1000,
  created_at: '2026-08-01T00:00:00Z',
  line_items: [],
  start_date: null,
  end_date: null,
  status: over.status ?? 'active',
  termination_date: null,
  termination_reason: null,
})

const exp = over => ({
  id: over.id,
  owner_id: 'owner-1',
  property_id: over.property_id ?? 'prop-1',
  lease_id: over.lease_id ?? null,
  category: over.category ?? 'repairs',
  amount: over.amount ?? 100,
  incurred_on: over.incurred_on ?? '2026-10-15',
  vendor: over.vendor ?? null,
  memo: over.memo ?? null,
  receipt_url: null,
  work_item_id: over.work_item_id ?? null,
  created_at: '2026-11-05T00:00:00Z',
  updated_at: '2026-11-05T00:00:00Z',
  property: { id: over.property_id ?? 'prop-1', name: over.propName ?? 'Maple', slug: 'maple' },
})

// ── Capital is not an expense ────────────────────────────────────────────────
{
  const items = [
    exp({ id: 'e1', category: 'mortgage_interest', amount: 1200, incurred_on: '2026-10-01' }),
    exp({ id: 'e2', category: 'insurance', amount: 150, incurred_on: '2026-10-01' }),
    exp({ id: 'e3', category: 'repairs', amount: 300, incurred_on: '2026-10-10' }),
    exp({ id: 'e4', category: 'capital_improvement', amount: 9000, incurred_on: '2026-10-20' }),
  ]
  const t = totalExpenses(items)

  check('every dollar is in `all`', t.all, 10650)
  check('capital is reported on its own', t.capital, 9000)
  check('capital is out of the deductible total', t.deductible, 1650)
  check('operating excludes BOTH capital and the mortgage', t.operating, 450)
  check('financing is the mortgage alone', t.financing, 1200)

  const n = noi(3000, t)
  check('NOI subtracts operating only', n.noi, 2550)
  check('cash flow then subtracts the debt', n.cashFlow, 1350)
  check('capital rides alongside, in neither', n.capital, 9000)
  check('margin is NOI over income', n.margin, 85)

  check('isCapital is driven by the category', isCapital(items[3]), true)
  check('and nothing else is capital', items.slice(0, 3).some(isCapital), false)
}

// ── No debt means NOI and cash flow are the same number ──────────────────────
{
  const t = totalExpenses([exp({ id: 'f1', category: 'property_tax', amount: 500 })])
  const n = noi(2000, t)
  check('no mortgage recorded: NOI equals cash flow', n.noi === n.cashFlow, true)
  check('and the figure is income less the tax', n.noi, 1500)
}

// ── Cents survive a year of premiums ─────────────────────────────────────────
{
  const items = Array.from({ length: 12 }, (_, i) => exp({
    id: `p${i}`,
    category: 'insurance',
    amount: 142.67,
    incurred_on: `2026-${String(i + 1).padStart(2, '0')}-01`,
  }))
  const t = totalExpenses(items)
  check('twelve $142.67 premiums total exactly', t.all, 1712.04)
  check('and they are all operating cost', t.operating, 1712.04)
}

// ── `incurred_on` decides the bucket ─────────────────────────────────────────
{
  // Entered in November (created_at), incurred in December of the year before.
  const items = [exp({ id: 'd1', category: 'insurance', amount: 900, incurred_on: '2025-12-20' })]
  const byMonth = expensesByMonth(items)
  check('bucketed by the month it was incurred', byMonth.get('2025-12')?.all, 900)
  check('and not by the month it was typed', byMonth.has('2026-11'), false)
  check('nor does it reach the following tax year', inYear(items, '2026').length, 0)
  check('it is in its own year', inYear(items, '2025').length, 1)
  check('years are listed newest first', expenseYears([
    ...items, exp({ id: 'd2', incurred_on: '2026-03-01' }),
  ]), ['2026', '2025'])
}

// ── Shared Schedule E lines fold, and name what is in them ───────────────────
{
  const items = [
    exp({ id: 't1', category: 'management', amount: 200, incurred_on: '2026-02-01' }),
    exp({ id: 't2', category: 'leasing', amount: 450, incurred_on: '2026-08-01' }),
    exp({ id: 't3', category: 'property_tax', amount: 1800, incurred_on: '2026-04-01' }),
    exp({ id: 't4', category: 'capital_improvement', amount: 6000, incurred_on: '2026-05-01' }),
  ]
  const s = taxSummary(items, '2026', 24000)
  const l11 = s.lines.find(l => l.line === 'Line 11')

  check('management and letting fold onto one line', l11?.amount, 650)
  check('and the line names both categories', l11?.categories, ['management', 'leasing'])
  check('lines read down the form, not by size', s.lines.map(l => l.line), ['Line 11', 'Line 16'])
  check('capital is reported outside the deductible total', s.capital, 6000)
  check('deductible is the lines only', s.deductible, 2450)
  check('income before depreciation is the arithmetic', s.taxableBeforeDepreciation, 21550)
}

// ── A part-year says so ──────────────────────────────────────────────────────
{
  const charges = []
  const y = yearPnl(charges, [exp({ id: 'y1', amount: 100, incurred_on: '2026-03-01' })], '2026', NOW)
  check('the current year is flagged as running', y.running, true)
  const past = yearPnl(charges, [exp({ id: 'y2', amount: 100, incurred_on: '2025-03-01' })], '2025', NOW)
  check('a finished year is not', past.running, false)
}

// ── Future months carry no cost, and never dilute an average ─────────────────
{
  const plan = {
    id: 'plan-1',
    owner_id: 'owner-1',
    property_id: 'prop-1',
    lease_id: 'lease-1',
    name: 'Maple',
    due_day: 1,
    notes: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    property: { id: 'prop-1', name: 'Maple', slug: 'maple' },
    lease: { id: 'lease-1', start_date: '2026-09-01', end_date: '2027-08-31', rent_amount: 1000 },
    tenants: [payer({ id: 'pt-1', plan_id: 'plan-1', name: 'Aleeya', monthly_total: 1000 })],
    scheduled_payments: [
      // Two settled months, then two still ahead.
      { id: 's1', plan_tenant_id: 'pt-1', due_date: '2026-09-01', amount: 1000, paid_amount: 1000, paid_date: '2026-09-01', submitted_at: '2026-09-01T10:00:00Z', settled_at: '2026-09-01T10:00:00Z', status: 'paid', late_fee_paid: 0, late_fees_applied: 0, payment_method: 'card', processing_fee: 0, recorded_by: 'tenant', stripe_payment_intent_id: null, notes: null },
      { id: 's2', plan_tenant_id: 'pt-1', due_date: '2026-10-01', amount: 1000, paid_amount: 1000, paid_date: '2026-10-01', submitted_at: '2026-10-01T10:00:00Z', settled_at: '2026-10-01T10:00:00Z', status: 'paid', late_fee_paid: 0, late_fees_applied: 0, payment_method: 'card', processing_fee: 0, recorded_by: 'tenant', stripe_payment_intent_id: null, notes: null },
      { id: 's3', plan_tenant_id: 'pt-1', due_date: '2026-12-01', amount: 1000, paid_amount: 0, paid_date: null, submitted_at: null, settled_at: null, status: 'pending', late_fee_paid: 0, late_fees_applied: 0, payment_method: null, processing_fee: 0, recorded_by: null, stripe_payment_intent_id: null, notes: null },
    ],
    special_payments: [],
    late_fee_rule: null,
    utilities: [],
  }

  const charges = allCharges([plan], NOW)
  const expenses = [
    exp({ id: 'm1', category: 'repairs', amount: 200, incurred_on: '2026-09-15' }),
    exp({ id: 'm2', category: 'mortgage_interest', amount: 700, incurred_on: '2026-10-05' }),
  ]
  const series = monthlyPnl(charges, expenses, 4, NOW)

  check('four months, oldest first', series.map(m => m.key), ['2026-08', '2026-09', '2026-10', '2026-11'])
  check('September carries its repair', series[1].expenses.all, 200)
  check('and its cash flow is net of it', series[1].cashFlow, 800)
  check('October carries the mortgage', series[2].expenses.financing, 700)
  check('October NOI ignores the mortgage', series[2].noi, 1000)
  check('October cash flow does not', series[2].cashFlow, 300)

  // The series is retrospective by construction: it ends at the running month
  // and December's contracted rent never appears, so no row can read as a
  // profit forecast.
  const wide = monthlyPnl(charges, expenses, 6, NOW)
  check('the series never reaches past the current month', wide.some(m => m.key > '2026-11'), false)
  check('and it ends on the month in progress', wide[wide.length - 1].position, 'current')
  check("December's contracted rent is not in it", wide.some(m => m.key === '2026-12'), false)

  const p = periodPnl(series, 'Last 4 months')
  check('totals count every month with money in it', p.months, 4)
  check('averages count only the finished ones', p.completedMonths, 3)
  check('billed is the two settled months', p.billed, 2000)
  check('collected is the two settled months', p.received, 2000)
  check('period cash flow nets both costs', p.pnl.cashFlow, 1100)
  // The running month is excluded from the divisor AND from the numerator, so
  // a partial November cannot drag the average down the moment it opens.
  check('per-month averages over finished months only', p.perMonth, Math.round((1100 / 3) * 100) / 100)

  check('pnlYears spans charges and costs', pnlYears(charges, expenses, NOW).includes('2026'), true)
  check('windowMonths maps the control', windowMonths('6m'), 6)
}

// ── Occupancy refuses to guess ───────────────────────────────────────────────
{
  const tree = buildTree([{
    id: 'plan-o', owner_id: 'owner-1', property_id: 'prop-o', lease_id: 'lease-o',
    name: 'Oak', due_day: 1, notes: null, created_at: '2026-01-01', updated_at: '2026-01-01',
    property: { id: 'prop-o', name: 'Oak', slug: 'oak' },
    lease: { id: 'lease-o', start_date: '2026-08-01', end_date: '2027-07-31', rent_amount: 2400 },
    tenants: ['A', 'B', 'C', 'D'].map((n, i) => payer({
      id: `o${i + 1}`, plan_id: 'plan-o', name: n, monthly_total: 600,
    })),
    scheduled_payments: [], special_payments: [], late_fee_rule: null, utilities: [],
  }], [], NOW)
  const prop = tree.properties[0]

  const noRooms = occupancy({ id: 'prop-o', name: 'Oak', slug: 'oak', address: null, price: 700, total_rooms: null, beds: 6, baths: 2, security_deposit: null, listing_status: 'live', available_from: null }, prop)
  check('no room count: occupancy is null, not 100%', noRooms.pct, null)
  check('and the vacancy is not priced', noRooms.monthlyLoss, null)
  check('but the payers are still counted', noRooms.filled, 4)

  const sixBed = { id: 'prop-o', name: 'Oak', slug: 'oak', address: '1 Oak', price: 700, total_rooms: 6, beds: 6, baths: 2, security_deposit: null, listing_status: 'live', available_from: null }
  const o = occupancy(sixBed, prop)
  check('four of six rooms let', [o.filled, o.rooms, o.empty], [4, 6, 2])
  check('occupancy is two thirds', o.pct, 67)
  check('the empty rooms are priced at the ASKING rent', o.monthlyLoss, 1400)
  check('and the basis is stated', o.lossBasis, '2 empty × $700 asking rent')

  const unpriced = occupancy({ ...sixBed, price: null }, prop)
  check('no asking price: the loss is not invented', unpriced.monthlyLoss, null)
  check('though the empty count is still known', unpriced.empty, 2)

  // More payers than rooms is a data quirk, never negative loss.
  const tight = occupancy({ ...sixBed, total_rooms: 3 }, prop)
  check('more payers than rooms floors at zero empty', tight.empty, 0)
  check('and never reads as negative loss', tight.monthlyLoss, 0)
  check('nor over 100% full', tight.pct, 100)

  // ── Asking-rent gap ──
  const g = askGap(sixBed, prop)
  check('fully let at the ask is rooms × price', g.asking, 4200)
  check('contracted is what is signed', g.contracted, 2400)
  check('the gap is the difference', g.gap, 1800)
  check('and the basis names the arithmetic', g.basis, '6 rooms × $700 asking')

  const silent = askGap({ ...sixBed, price: null }, prop)
  check('no asking price: no gap is reported', silent.gap, null)
  check('no market figure is invented', silent.basis, null)

  // ── The rent roll ──
  const roll = rentRoll(tree, [sixBed], {})
  check('one row per tenancy plus one per empty room', roll.rows.length, 3)
  check('two of them are vacancies', roll.vacant, 2)
  check('the vacancies are named by their slot', roll.rows[1].unit, 'Vacant room 5 of 6')
  check('a vacancy carries asking rent, flagged as such', [roll.rows[1].rent, roll.rows[1].rentIsAsking], [700, true])
  check('contracted is the signed rent only', roll.contracted, 2400)
  check('fully let adds the asking rent', roll.potential, 3800)
  check('vacancy loss is the asking rent on the empties', roll.vacancyLoss, 1400)
  check('occupancy is rooms let over rooms, not rows', roll.occupancyPct, 67)

  const unknown = rentRoll(tree, [{ ...sixBed, total_rooms: null }], {})
  check('no room count: no vacancy rows are invented', unknown.vacant, 0)
  check('and the property is named as unknown', unknown.unknownUnitCounts, ['Oak'])
  // The subtle version of the mistake: counted as a full unit, an unknown
  // property drags occupancy to 100% and the roll reports a let portfolio.
  check('an unknown-unit property is excluded from occupancy, not called full', unknown.occupancyPct, null)

  const partial = rentRoll(tree, [{ ...sixBed, price: null }], {})
  check('unpriced vacancies are flagged', partial.vacancyLossPartial, true)
  check('and contribute nothing to the loss', partial.vacancyLoss, 0)

  const csv = rentRollCsv(roll)
  check('the CSV distinguishes asking from contracted', csv.includes('asking'), true)
  check('and carries a TOTAL row', csv.includes('TOTAL'), true)
  check('the roll has a header per column', csv.split('\n')[0].split(',').length, 11)
}

// ── Deposits are a liability, never rent ─────────────────────────────────────
{
  const csv = expensesCsv([
    exp({ id: 'c1', category: 'capital_improvement', amount: 1000, vendor: 'Roofer, Inc', memo: 'New roof' }),
    exp({ id: 'c2', category: 'repairs', amount: 50.5 }),
  ])
  const lines = csv.split('\n')
  check('a comma in a vendor name is quoted', lines[1].includes('"Roofer, Inc"'), true)
  check('capital is flagged in its own column', lines[1].includes(',yes,'), true)
  check('an expense is not', lines[2].includes(',no,'), true)
  check('rows are oldest first', lines.length, 3)
  check('amounts carry cents', lines[2].includes('50.50'), true)
}

// ── Every category declares a group and a tax line ───────────────────────────
{
  const missing = Object.entries(CATEGORY_META)
    .filter(([, m]) => !m.group || (!m.capital && !m.taxLine))
    .map(([k]) => k)
  check('no category is missing a group or a tax line', missing, [])
  const capitals = Object.entries(CATEGORY_META).filter(([, m]) => m.capital).map(([k]) => k)
  check('exactly one category is capital', capitals, ['capital_improvement'])
}

console.log(`${pass.length} passed`)
for (const p of pass) console.log('  ok   ' + p)
if (fail.length) {
  console.log(`\n${fail.length} FAILED`)
  for (const f of fail) console.log('  FAIL ' + f)
  process.exit(1)
}
console.log('\nall good')
