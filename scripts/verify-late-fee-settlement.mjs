/**
 * Proves the fee-only settlement path, against an in-memory stand-in for
 * Supabase rather than the real database.
 *
 * The logic worth testing here is ours, not Postgres's: does a repeat run apply
 * the fee twice, does a clearing ACH debit get counted as collected, does a
 * bounce take the money back off, and is the rent on the row left strictly
 * alone. A fake client exercises all of that with no risk to live tenant money
 * — and the one thing it cannot prove, that the unique constraint really
 * exists, is checked directly against the database schema instead.
 *
 * The fake implements only the narrow surface `rentSettlement` uses, and throws
 * on anything else so a future change cannot silently pass by going unnoticed.
 *
 * Run: npm run verify:late-fees
 *
 * (The bare `node --experimental-strip-types` form cannot resolve the app's
 * extensionless imports — see scripts/ts-resolve.mjs. The placeholder Supabase
 * env in the npm script is only there because a module on the import path
 * builds a client at load time; nothing here connects to anything.)
 */
const { settleRentPayment, revertRentPayment } = await import('../src/lib/rentSettlement.ts')

const CHARGE = 'charge-1'
/** A second month, for proving one charge's fee is never booked against another. */
const OTHER = 'charge-2'

function makeDb(initial, extra = []) {
  const state = {
    scheduled_payments: [
      { id: CHARGE, plan_id: 'plan-1', ...initial },
      ...extra.map((r, i) => ({ id: `charge-${i + 2}`, plan_id: 'plan-1', ...r })),
    ],
    late_fee_payments: [],
    special_payments: [],
  }

  const builder = (table) => {
    const filters = []
    let op = null
    let payload = null
    let selectCols = null

    const matches = (row) =>
      filters.every(([col, val]) => (Array.isArray(val) ? val.includes(row[col]) : row[col] === val))

    const api = {
      select(cols) { selectCols = cols; if (!op) op = 'select'; return api },
      insert(rows) { op = 'insert'; payload = Array.isArray(rows) ? rows : [rows]; return api },
      update(patch) { op = 'update'; payload = patch; return api },
      delete() { op = 'delete'; return api },
      eq(col, val) { filters.push([col, val]); return api },
      in(col, vals) { filters.push([col, vals]); return api },
      not() { return api },
      order() { return api },
      // Must actually run: an earlier version returned the builder here, every
      // single-row read came back as an array, and three tests failed against
      // perfectly good settlement code.
      maybeSingle() { return run(true) },
      single() { return run(true) },
      then(resolve, reject) { return run(false).then(resolve, reject) },
    }

    async function run(single) {
      // The notification path claims the right to send by inserting into
      // `rent_payment_notifications`. Reporting that claim as already taken
      // makes `notifyRentPayment` bail out before it builds an email, which is
      // what keeps this test offline — settlement, not mail, is under test.
      if (table === 'rent_payment_notifications') {
        return { data: null, error: { code: '23505', message: 'already claimed' } }
      }
      if (!state[table]) {
        throw new Error(`fake db: unexpected table "${table}" — extend the fake`)
      }
      const rows = state[table]
      if (op === 'insert') {
        for (const row of payload) {
          // The unique (scheduled_payment_id, stripe_payment_intent_id) that the
          // migration declares. Postgres reports a violation as 23505, and that
          // code is the entire contract settlement relies on.
          if (table === 'late_fee_payments') {
            const clash = rows.some(
              r => r.scheduled_payment_id === row.scheduled_payment_id &&
                   r.stripe_payment_intent_id === row.stripe_payment_intent_id,
            )
            if (clash) return { data: null, error: { code: '23505', message: 'duplicate key' } }
          }
          // Postgres fills a default primary key; the revert path deletes by it.
          rows.push({ id: `${table}-${rows.length + 1}`, ...row })
        }
        return { data: payload, error: null }
      }
      if (op === 'update') {
        const hit = rows.filter(matches)
        for (const r of hit) Object.assign(r, payload)
        return { data: hit, error: null }
      }
      if (op === 'delete') {
        state[table] = rows.filter(r => !matches(r))
        return { data: null, error: null }
      }
      const found = rows.filter(matches)
      void selectCols
      return single
        ? { data: found[0] ?? null, error: null }
        : { data: found, error: null }
    }

    return api
  }

  return { from: (table) => builder(table), _state: state }
}

const intent = (id, amount) => ({
  id,
  metadata: {
    type: 'rent_payment', method: 'card', userId: 'u1', feeCents: '250',
    scheduledIds: '', specialIds: '',
    lateFeeIds: CHARGE, lateFeeAmounts: amount,
  },
})

// Rent settled months ago, fee never collected — the shape every outstanding
// fee on the real database has.
const SETTLED_RENT = {
  amount: 500, paid_amount: 500, status: 'paid', paid_date: '2026-02-01',
  late_fee_paid: 0, stripe_payment_intent_id: null,
}

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

const snap = (db) => {
  const row = db._state.scheduled_payments[0]
  return {
    feePaid: Number(row.late_fee_paid),
    status: row.status,
    paidAmount: Number(row.paid_amount),
    paidDate: row.paid_date,
    rentIntent: row.stripe_payment_intent_id,
    claims: db._state.late_fee_payments.length,
  }
}

// ── 1. A fee paid on its own ───────────────────────────────────────────────
{
  const db = makeDb(SETTLED_RENT)
  const r = await settleRentPayment(db, intent('pi_1', '45.00'), 'paid')
  check('applies one fee', [r.lateFees, r.lateFeeTotal], [1, 45])
  const s = snap(db)
  check('credits late_fee_paid', s.feePaid, 45)
  check('records one claim', s.claims, 1)
  check('surcharge recorded on the fee', Number(db._state.late_fee_payments[0].processing_fee), 2.5)
  // The point of the whole feature: rent settled long ago is not disturbed.
  check('rent left exactly alone', [s.status, s.paidAmount, s.paidDate, s.rentIntent],
        ['paid', 500, '2026-02-01', null])
}

// ── 2. Webhook and browser confirm both settle the same intent ────────────
{
  const db = makeDb(SETTLED_RENT)
  await settleRentPayment(db, intent('pi_1', '45.00'), 'paid')
  const again = await settleRentPayment(db, intent('pi_1', '45.00'), 'paid')
  check('repeat run applies nothing', [again.lateFees, again.lateFeeTotal], [0, 0])
  check('no double charge', snap(db).feePaid, 45)
  check('still one claim', snap(db).claims, 1)
}

// ── 3. Two separate fee payments on the same charge ───────────────────────
{
  const db = makeDb(SETTLED_RENT)
  await settleRentPayment(db, intent('pi_1', '45.00'), 'paid')
  const second = await settleRentPayment(db, intent('pi_2', '20.00'), 'paid')
  check('second payment applies', second.lateFees, 1)
  check('total accumulates rather than overwrites', snap(db).feePaid, 65)
  check('two claims', snap(db).claims, 2)
}

// ── 4. An ACH fee still clearing is not income yet ────────────────────────
{
  const db = makeDb(SETTLED_RENT)
  await settleRentPayment(db, intent('pi_3', '10.00'), 'processing')
  check('clearing fee not counted as collected', snap(db).feePaid, 0)
  check('but it is claimed, so it cannot double-apply', snap(db).claims, 1)
}

// ── 5. That clearing debit bounces ────────────────────────────────────────
{
  const db = makeDb(SETTLED_RENT)
  await settleRentPayment(db, intent('pi_3', '10.00'), 'processing')
  await revertRentPayment(db, intent('pi_3', '10.00'))
  check('bounce of a clearing fee changes no total', snap(db).feePaid, 0)
  check('claim withdrawn so a retry can apply', snap(db).claims, 0)
}

// ── 6. A collected fee payment bounces ────────────────────────────────────
{
  const db = makeDb(SETTLED_RENT)
  await settleRentPayment(db, intent('pi_1', '45.00'), 'paid')
  await settleRentPayment(db, intent('pi_2', '20.00'), 'paid')
  await revertRentPayment(db, intent('pi_2', '20.00'))
  const s = snap(db)
  check('bounce debits only its own amount', s.feePaid, 45)
  check('only its claim withdrawn', s.claims, 1)
  check('rent untouched throughout', [s.status, s.paidAmount], ['paid', 500])
}

// ── 7. A fee on rent that is still unpaid ─────────────────────────────────
{
  const db = makeDb({
    amount: 500, paid_amount: 0, status: 'pending', paid_date: null,
    late_fee_paid: 0, stripe_payment_intent_id: null,
  })
  await settleRentPayment(db, intent('pi_4', '15.00'), 'paid')
  const s = snap(db)
  check('fee collected without settling the rent', [s.feePaid, s.status, s.paidAmount],
        [15, 'pending', 0])
}

// ── 8. Malformed metadata is skipped, not guessed at ──────────────────────
{
  const db = makeDb(SETTLED_RENT)
  const r = await settleRentPayment(db, intent('pi_5', 'not-a-number'), 'paid')
  check('unparseable amount applies nothing', [r.lateFees, snap(db).feePaid, snap(db).claims], [0, 0, 0])
}

// A payment that settles rent, optionally alongside a fee on another charge.
// `lateFeeCents` is the whole-payment fee total the route sends, which is what
// settlement used to mistakenly write onto the rent row.
const rentIntent = (id, { rent = CHARGE, feeOn = null, feeAmount = '0' } = {}) => ({
  id,
  metadata: {
    type: 'rent_payment', method: 'card', userId: 'u1', feeCents: '250',
    scheduledIds: rent, specialIds: '',
    lateFeeCents: String(Math.round(Number(feeAmount) * 100)),
    lateFeeIds: feeOn ?? '', lateFeeAmounts: feeOn ? feeAmount : '',
  },
})

const UNPAID_RENT = {
  amount: 500, paid_amount: 0, status: 'pending', paid_date: null,
  late_fee_paid: 0, stripe_payment_intent_id: null,
}
const feePaidOn = (db, id) =>
  Number(db._state.scheduled_payments.find(r => r.id === id).late_fee_paid)

// ── 9. Rent and another month's fee in one payment ────────────────────────
//
// The fee belongs to `CHARGE`. Booking it against the rent row as well counted
// the same money twice in the landlord's collected total — `financialsRollup`
// sums `late_fee_paid` across every row — and credited a month that was never
// charged a fee, wiping its own fee liability.
{
  const db = makeDb(SETTLED_RENT, [UNPAID_RENT])
  await settleRentPayment(db, rentIntent('pi_6', { rent: OTHER, feeOn: CHARGE, feeAmount: '45.00' }), 'paid')
  check('fee credited to the charge that owed it', feePaidOn(db, CHARGE), 45)
  check('fee NOT also credited to the rent row', feePaidOn(db, OTHER), 0)
  check('collected fee total counted once', [CHARGE, OTHER].reduce((s, id) => s + feePaidOn(db, id), 0), 45)
  check('the rent itself still settled', [
    db._state.scheduled_payments.find(r => r.id === OTHER).status,
    Number(db._state.scheduled_payments.find(r => r.id === OTHER).paid_amount),
  ], ['paid', 500])
}

// ── 10. Fee paid first, rent paid afterwards ──────────────────────────────
//
// The order a tenant chasing a late charge actually uses. Settling the rent
// overwrote `late_fee_paid` with this payment's fee total — zero — destroying
// the $45 already collected and putting the fee back on the tenant.
{
  const db = makeDb(UNPAID_RENT)
  await settleRentPayment(db, intent('pi_7', '45.00'), 'paid')
  check('fee collected while the rent was unpaid', feePaidOn(db, CHARGE), 45)
  await settleRentPayment(db, rentIntent('pi_8'), 'paid')
  check('paying the rent does not wipe the collected fee', feePaidOn(db, CHARGE), 45)
  check('rent settled too', [snap(db).status, snap(db).paidAmount], ['paid', 500])
}

// ── 11. An ACH fee that clears ────────────────────────────────────────────
//
// `processing` claims the fee without counting it, so the `paid` run that
// follows hit its own claim's unique violation and returned early — the money
// landed at Stripe and was never recorded anywhere.
{
  const db = makeDb(SETTLED_RENT)
  await settleRentPayment(db, intent('pi_9', '30.00'), 'processing')
  const cleared = await settleRentPayment(db, intent('pi_9', '30.00'), 'paid')
  check('clearing is reported as applied', [cleared.lateFees, cleared.lateFeeTotal], [1, 30])
  check('cleared ACH fee is counted as collected', feePaidOn(db, CHARGE), 30)
  check('claim promoted, not duplicated', [
    db._state.late_fee_payments.length,
    db._state.late_fee_payments[0].status,
  ], [1, 'paid'])
  // And it must still be idempotent once settled.
  const again = await settleRentPayment(db, intent('pi_9', '30.00'), 'paid')
  check('a third run applies nothing', [again.lateFees, feePaidOn(db, CHARGE)], [0, 30])
}

// ── 12. Rent bounces, on a charge whose fee was collected separately ──────
//
// The revert zeroed `late_fee_paid`, so an unrelated bounced rent debit erased
// a fee payment that had genuinely cleared.
{
  const db = makeDb(UNPAID_RENT)
  await settleRentPayment(db, intent('pi_10', '45.00'), 'paid')
  await settleRentPayment(db, rentIntent('pi_11'), 'processing')
  await revertRentPayment(db, rentIntent('pi_11'))
  check('bounced rent is owed again', [snap(db).status, snap(db).paidAmount], ['pending', 0])
  check('separately collected fee survives the bounce', feePaidOn(db, CHARGE), 45)
  check('its claim survives too', db._state.late_fee_payments.length, 1)
}

console.log(`${pass.length} passed`)
for (const p of pass) console.log('  ok   ' + p)
if (fail.length) {
  console.log(`\n${fail.length} FAILED`)
  for (const f of fail) console.log('  FAIL ' + f)
  process.exit(1)
}
console.log('\nall good — no database was touched')
