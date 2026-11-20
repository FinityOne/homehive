/**
 * Proves the tenant home page's action stack says the right thing, in the right
 * order, and never invents a figure.
 *
 * Worth a script because this is the first thing a renter sees and it is
 * assembled from five unrelated sources — rent, late fees, amendments, tours,
 * maintenance — any one of which can be absent. The failure modes are all
 * silent: a stack that puts a 90-day renewal note above rent that is nine days
 * past due is not an error, it is just a page that stops being read. And the
 * one genuinely dangerous case — telling a demo tenant they owe money that no
 * part of the system can take — looks completely normal on screen.
 *
 * Two invariants it defends in particular:
 *
 *   • **"Past due" is the billing calendar's decision, not the clock's.** A
 *     tenant in Phoenix on their due date is not late, whatever UTC says. The
 *     engine therefore routes every date comparison through `isPastDue` /
 *     `billingToday`, and the day-boundary cases below are the ones that broke
 *     the late-fee engine when it was written with `new Date()` arithmetic.
 *   • **A demo lease raises no money action.** Two triggers already stop a
 *     demo lease holding a payment plan; this stops the portal asking anyway.
 *
 * Run: npm run verify:tenant-actions
 */
const { tenantActions } = await import('../src/lib/tenantActions.ts')
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

/** Nothing owed, nothing pending, no lease — a renter who is only browsing. */
const base = {
  owed: 0,
  lateFeesOwed: 0,
  oldestDueDate: null,
  nextDueDate: null,
  nextDueAmount: null,
  pendingAmendments: [],
  tour: null,
  openMaintenance: 0,
  leaseEnd: null,
}

const ids = (input) => tenantActions({ ...base, ...input }).map(a => a.id)
const one = (input, id) => tenantActions({ ...base, ...input }).find(a => a.id === id)

// ── Nothing to do ───────────────────────────────────────────────────────────

check('a renter with nothing outstanding gets an empty stack', ids({}), [])

// ── Money ───────────────────────────────────────────────────────────────────

check('rent past its due date is urgent',
  one({ owed: 900, oldestDueDate: shift(-4) }, 'pay')?.urgency, 'now')

check('rent due today is not past due — the whole day is theirs',
  one({ owed: 900, oldestDueDate: TODAY }, 'pay')?.urgency, 'soon')

check('rent due tomorrow is not past due',
  one({ owed: 900, oldestDueDate: shift(1) }, 'pay')?.urgency, 'soon')

check('yesterday is past due',
  one({ owed: 900, oldestDueDate: shift(-1) }, 'pay')?.urgency, 'now')

check('the headline is the total, rent plus fees',
  one({ owed: 900, lateFeesOwed: 105, oldestDueDate: shift(-9) }, 'pay')?.title,
  '$1,005.00 is past due')

check('and the fee part is named, because it is why the total surprises them',
  one({ owed: 900, lateFeesOwed: 105, oldestDueDate: shift(-9) }, 'pay')?.body
    .includes('includes $105.00 in late fees'), true)

check('a fee owed on settled rent still raises the action',
  ids({ lateFeesOwed: 105, oldestDueDate: shift(-40) }), ['pay'])

check('the pay link brings the account up to date, not just the rent',
  one({ owed: 900, oldestDueDate: shift(-2) }, 'pay')?.cta.href,
  '/dashboard/lease?tab=payments&pay=1')

// Sub-cent balances are rounding noise, not a bill.
check('a half-cent balance is not a debt',
  ids({ owed: 0.004, oldestDueDate: shift(-3) }), [])

// ── The next rent, before it is due ─────────────────────────────────────────

check('rent a week out is worth saying',
  ids({ nextDueDate: shift(7), nextDueAmount: 900 }), ['pay-soon'])

check('rent eight days out is not — the stack must keep meaning "needs you"',
  ids({ nextDueDate: shift(8), nextDueAmount: 900 }), [])

check('and it is never shown next to a balance that is actually owed',
  ids({ owed: 900, oldestDueDate: shift(-1), nextDueDate: shift(3), nextDueAmount: 900 }),
  ['pay'])

check('"due today" is said as today, not "in 0 days"',
  one({ nextDueDate: TODAY, nextDueAmount: 900 }, 'pay-soon')?.title, '$900.00 due today')

check('and tomorrow as tomorrow',
  one({ nextDueDate: shift(1), nextDueAmount: 900 }, 'pay-soon')?.title, '$900.00 due tomorrow')

// ── A demo lease collects nothing ───────────────────────────────────────────

check('a demo tenancy is never asked for money',
  ids({ owed: 1800, lateFeesOwed: 105, oldestDueDate: shift(-30), isDemo: true }), [])

check('nor for the rent that is coming',
  ids({ nextDueDate: shift(2), nextDueAmount: 900, isDemo: true }), [])

check('and a demo lease raises no billing-setup warning either',
  ids({ unmatchedPlan: true, isDemo: true }), [])

// ── Signatures ──────────────────────────────────────────────────────────────

const amendment = { id: 'a1', title: 'Pet addendum', token: 'tok', respondBy: null }

check('an unsigned amendment is always urgent',
  one({ pendingAmendments: [amendment] }, 'amendment-a1')?.urgency, 'now')

check('it links straight to the document',
  one({ pendingAmendments: [amendment] }, 'amendment-a1')?.cta.href,
  '/dashboard/lease/amendments/tok')

check('a deadline still ahead is counted in days',
  one({ pendingAmendments: [{ ...amendment, respondBy: shift(5) }] }, 'amendment-a1')?.body
    .includes('5 days away'), true)

check('a deadline today says today',
  one({ pendingAmendments: [{ ...amendment, respondBy: TODAY }] }, 'amendment-a1')?.body,
  'Your landlord asked for an answer today.')

// A lapsed deadline does not make the document disappear: the signing page
// decides whether it can still be signed, and it says so there.
check('a lapsed deadline is reported as still open, not as gone',
  one({ pendingAmendments: [{ ...amendment, respondBy: shift(-3) }] }, 'amendment-a1')?.body
    .includes('It is still open'), true)

check('every pending amendment gets its own card',
  ids({ pendingAmendments: [amendment, { ...amendment, id: 'a2' }] }),
  ['amendment-a1', 'amendment-a2'])

// ── A lease we cannot bill ──────────────────────────────────────────────────

check('an unmatched rent schedule is urgent and fixable',
  one({ unmatchedPlan: true }, 'unmatched')?.urgency, 'now')

// ── Tours ───────────────────────────────────────────────────────────────────

const tour = { date: shift(4), propertySlug: 'del-rio', propertyName: 'Del Rio' }

check('a tour four days out is on the stack', ids({ tour }), ['tour'])
check('a tour tomorrow is urgent',
  one({ tour: { ...tour, date: shift(1) } }, 'tour')?.urgency, 'now')
check('a tour today is urgent and says so',
  one({ tour: { ...tour, date: TODAY } }, 'tour')?.title, 'Your tour is today')
check('a tour that has passed is gone', ids({ tour: { ...tour, date: shift(-1) } }), [])
check('a tour with no listing still gets a usable link',
  one({ tour: { ...tour, propertySlug: null } }, 'tour')?.cta.href, '/dashboard')

// The time and the host's note used to live on a tour card of their own on the
// dashboard. Folding that card into the stack must not lose them — they are
// what decides whether somebody turns up at the right place.
check('the booked time travels with the date',
  one({ tour: { ...tour, timeSlot: '14:30' } }, 'tour')?.body.includes('at 2:30 PM'), true)
check('midnight and noon are not confused',
  one({ tour: { ...tour, timeSlot: '12:00' } }, 'tour')?.body.includes('at 12:00 PM'), true)
check("the host's instructions are quoted",
  one({ tour: { ...tour, note: 'Park on the street' } }, 'tour')?.body
    .includes('They said: \u201cPark on the street\u201d'), true)
check('a malformed slot is dropped rather than printed as NaN',
  one({ tour: { ...tour, timeSlot: 'whenever' } }, 'tour')?.body.includes('NaN'), false)

// ── Renewal and maintenance: context, not tasks ─────────────────────────────

check('a lease ending in 60 days is information',
  one({ leaseEnd: shift(60) }, 'lease-ending')?.urgency, 'info')
check('a lease ending in 91 days is too far off to mention',
  ids({ leaseEnd: shift(91) }), [])
check('a lease that has already ended raises nothing',
  ids({ leaseEnd: shift(-1) }), [])
check('open maintenance is information',
  one({ openMaintenance: 2 }, 'maintenance')?.urgency, 'info')
check('and it is counted in the plural correctly',
  one({ openMaintenance: 1 }, 'maintenance')?.title, '1 open job on your home')

// ── Order. The whole point of the stack. ────────────────────────────────────

check('urgent money and a signature outrank a renewal note and a repair list',
  ids({
    owed: 900,
    oldestDueDate: shift(-9),
    pendingAmendments: [amendment],
    tour: { ...tour, date: shift(6) },
    leaseEnd: shift(30),
    openMaintenance: 3,
  }),
  ['pay', 'amendment-a1', 'tour', 'lease-ending', 'maintenance'])

check('and when rent is not yet late, the signature still comes first',
  ids({ owed: 900, oldestDueDate: TODAY, pendingAmendments: [amendment] }),
  ['amendment-a1', 'pay'])

// ── Report ──────────────────────────────────────────────────────────────────

for (const line of pass) console.log(`  ok   ${line}`)
if (fail.length) {
  console.log(`\n${pass.length} passed\n\n${fail.length} FAILED:`)
  for (const line of fail) console.log(`  ✗ ${line}`)
  process.exit(1)
}
console.log(`\n${pass.length} passed`)
console.log('✓ the tenant action stack is ranked, nothing is invented, and a demo lease is never billed')
