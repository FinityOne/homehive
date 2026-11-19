/**
 * Proves the one occupancy engine answers "is this property full?" the same way
 * everywhere, and never from a marketing field.
 *
 * Worth a script because this is the figure a landlord checks first and cannot
 * verify: the screen either agrees with the building they own or it does not,
 * and when it does not there is no error — just a confident wrong number on the
 * page they open every morning.
 *
 * The bug it was written for: a landlord with every room of a six-bedroom house
 * let through HomeHive — lease signed here, payment plan built here, rent
 * collected here — was told "0 of 6 rooms filled" on the Overview, because that
 * screen read `properties.available`, the number of rooms the landlord is
 * *advertising*. Nothing writes it when a lease is signed. Meanwhile the
 * Financials page, which counted payers, said 100%. Two screens, one building,
 * opposite answers.
 *
 * Run: npm run verify:occupancy
 */
const {
  occupancyOf, portfolioOccupancy, roomsHeld, leasePhase, tenantCountOf,
} = await import('../src/lib/occupancy.ts')
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

const byRoom = (over = {}) => ({ total_rooms: 6, rental_mode: 'by_room', ...over })
const whole = (over = {}) => ({ total_rooms: 4, rental_mode: 'whole_home', ...over })
const lease = (over = {}) => ({
  start_date: shift(-100), end_date: shift(200), is_demo: false,
  unit_number: null, tenantCount: 1, ...over,
})

// ── Phase, on the billing calendar ──────────────────────────────────────────

check('a lease starting today is running',
  leasePhase({ start_date: TODAY, end_date: shift(300) }, TODAY), 'current')
check('a lease ending today is still running',
  leasePhase({ start_date: shift(-300), end_date: TODAY }, TODAY), 'current')
check('a lease that ended yesterday is past',
  leasePhase({ start_date: shift(-300), end_date: shift(-1) }, TODAY), 'past')
check('a lease starting tomorrow is upcoming',
  leasePhase({ start_date: shift(1), end_date: shift(300) }, TODAY), 'upcoming')
check('a tenancy with no end date is running, not ended',
  leasePhase({ start_date: shift(-300), end_date: null }, TODAY), 'current')

// ── What one lease takes ────────────────────────────────────────────────────

check('a by-the-room lease holds one room per head',
  roomsHeld(lease({ tenantCount: 4 }), byRoom(), 6), 4)
check('a named room is one room, however many sleep in it',
  roomsHeld(lease({ unit_number: 'Master Bedroom', tenantCount: 2 }), byRoom(), 6), 1)
check('a blank unit number is not a named room',
  roomsHeld(lease({ unit_number: '   ', tenantCount: 3 }), byRoom(), 6), 3)
check('a whole-home lease takes the whole building',
  roomsHeld(lease({ tenantCount: 2 }), whole(), 4), 4)
// The failure mode this guards: a tenancy entered before its tenant rows were,
// reading as a vacancy on a room somebody is living in.
check('a lease with no tenants recorded still holds a room',
  roomsHeld(lease({ tenantCount: 0 }), byRoom(), 6), 1)

// ── The advertised figure decides nothing ───────────────────────────────────

{
  // Advertising all six rooms; all six are let. The bug, exactly.
  const o = occupancyOf(byRoom({ available: 6 }), [lease({ tenantCount: 6 })], TODAY)
  check('a fully let house reads full however it is advertised',
    [o.occupied, o.vacant, o.pct, o.full], [6, 0, 100, true])
}
{
  // Advertising nothing, letting nothing. The old rule called this full.
  const o = occupancyOf(byRoom({ available: 0 }), [], TODAY)
  check('an empty house reads empty however it is advertised',
    [o.occupied, o.open, o.pct, o.full], [0, 6, 0, false])
}

// ── Demo leases, ended leases ───────────────────────────────────────────────

check('a demo lease houses nobody',
  occupancyOf(byRoom(), [lease({ is_demo: true, tenantCount: 5 })], TODAY).occupied, 0)
check('a lease that ended yesterday frees its rooms',
  occupancyOf(byRoom(), [lease({ start_date: shift(-400), end_date: shift(-1), tenantCount: 5 })], TODAY).occupied, 0)

// ── Filled today versus spoken for ──────────────────────────────────────────

{
  const o = occupancyOf(byRoom({ total_rooms: 6 }), [
    lease({ tenantCount: 4 }),
    lease({ start_date: shift(30), end_date: shift(400), tenantCount: 2 }),
  ], TODAY)
  check('a lease starting later does not fill a room today', o.occupied, 4)
  check('but it does spoken-for the room', [o.committed, o.upcoming], [6, 2])
  check('so two rooms are vacant and none is open to let', [o.vacant, o.open], [2, 0])
  check('and occupancy is today, not the promise', o.pct, 67)
}

// ── The cap ─────────────────────────────────────────────────────────────────

{
  // A changeover counted twice, a couple sharing, a stale room count. Must read
  // as full, never 120%, never negative vacancy.
  const o = occupancyOf(byRoom({ total_rooms: 2 }), [lease({ tenantCount: 9 })], TODAY)
  check('more let than declared still reads as full', [o.occupied, o.pct], [2, 100])
  check('and vacancy never goes negative', [o.vacant, o.open], [0, 0])
}

// ── No declared room count ──────────────────────────────────────────────────

{
  const o = occupancyOf({ total_rooms: 0, rental_mode: 'by_room' }, [lease({ tenantCount: 3 })], TODAY)
  check('without a room count there is no percentage', [o.known, o.pct, o.totalRooms], [false, null, null])
  check('but "somebody lives here" is still answerable', [o.occupied, o.full], [3, true])
  check('and nothing is claimed about what is empty', [o.vacant, o.open], [0, 0])
}

// ── The portfolio ───────────────────────────────────────────────────────────

{
  const full = occupancyOf(byRoom({ total_rooms: 6 }), [lease({ tenantCount: 6 })], TODAY)
  const half = occupancyOf(byRoom({ total_rooms: 4 }), [lease({ tenantCount: 2 })], TODAY)
  const p = portfolioOccupancy([full, half])
  check('the portfolio adds the rooms, not the percentages', [p.totalRooms, p.occupied], [10, 8])
  check('and divides once at the end', p.pct, 80)
  check('open rooms roll up too', p.open, 2)
}
{
  // Counting an unconfigured listing as empty would drag the portfolio figure
  // down because of a blank field on a form, which a landlord cannot tell apart
  // from a real vacancy.
  const full = occupancyOf(byRoom({ total_rooms: 6 }), [lease({ tenantCount: 6 })], TODAY)
  const unknown = occupancyOf({ total_rooms: null, rental_mode: 'by_room' }, [], TODAY)
  const p = portfolioOccupancy([full, unknown])
  check('a listing with no room count is excluded, not counted empty', p.pct, 100)
  check('and is reported as unknown', p.unknown, 1)
}

// ── The roster adapter ──────────────────────────────────────────────────────

check('the fuller roster wins', tenantCountOf([1, 2, 3], [1]), 3)
check('and a plan-only roster still counts', tenantCountOf(null, [1, 2]), 2)
check('and nothing recorded is zero, not a crash', tenantCountOf(null, null), 0)

// ── Report ──────────────────────────────────────────────────────────────────

for (const line of pass) console.log(`  ok   ${line}`)
if (fail.length) {
  console.log(`\n${pass.length} passed\n\n${fail.length} FAILED:`)
  for (const line of fail) console.log(`  ✗ ${line}`)
  process.exit(1)
}
console.log(`\n${pass.length} passed`)
console.log('✓ occupancy is derived from leases, capped at the declared rooms, and never read from the advertised figure')
