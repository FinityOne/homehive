/**
 * Proves the waiver half of the late-fee feature: the written-off ledger the
 * landlord reads, and the two emails a write-off sends.
 *
 * The things worth pinning down here are not arithmetic, they are promises:
 *
 *   • A waived fee must leave the pending ledger and appear in the written-off
 *     one. Falling out of both is the bug this whole surface exists to fix —
 *     the money vanishes and nobody can explain the gap between fees assessed
 *     and fees collected.
 *   • The totals must agree: what `lateFeeLedger` reports as `waived` is what
 *     `waivedLedger` lists row by row.
 *   • A waiver nobody was told about must be counted as such, because that is
 *     the only state in there with an action left on it.
 *   • The tenant's email must never contain the landlord's private reason, and
 *     must never carry a payment link. A forgiveness email that asks for money
 *     is a demand.
 *
 * Pure functions and string building, so no database and no network.
 *
 * Run: node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/verify-late-fee-waivers.mjs
 */
const { lateFeeLedger } = await import('../src/lib/lateFees.ts')
const { waivedLedger } = await import('../src/lib/lateFeeWaivers.ts')
const { buildWaiverTenantEmail, buildWaiverLandlordEmail } =
  await import('../src/lib/lateFeeWaiverEmails.ts')

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

// $15 a day, no grace, no ceiling — the rule every plan on this database uses.
const DAILY = { grace_period_days: 0, fee_amount: 15, frequency_days: 1, max_total_fees: null }
const NOW = new Date('2026-11-02T12:00:00Z')

const charge = over => ({
  id: over.id,
  plan_tenant_id: 'payer-1',
  due_date: '2026-09-01',
  amount: 900,
  paid_amount: 900,
  paid_date: '2026-09-04',
  submitted_at: null,
  status: 'paid',
  late_fee_paid: 0,
  late_fee_reminder_count: 0,
  late_fee_reminder_sent_at: null,
  ...over,
})

const plan = scheduled => ({
  id: 'plan-1',
  lease_id: 'lease-1',
  name: 'Unit 4 — 2026/27',
  property: { name: 'Palo Verde' },
  late_fee_rule: DAILY,
  tenants: [{ id: 'payer-1', name: 'Dana Reyes', email: 'dana@example.com', status: 'active' }],
  scheduled_payments: scheduled,
})

// Two late months: September settled 3 days late ($45), October 5 days ($75).
const plans = [plan([
  charge({ id: 'sp-sep' }),
  charge({ id: 'sp-oct', due_date: '2026-10-01', paid_date: '2026-10-06' }),
])]

// ── 1. Nothing waived: both fees are owed, nothing is written off ──────────
{
  const owed = lateFeeLedger(plans, [], NOW)
  const off = waivedLedger(plans, [])
  check('unwaived: both fees pending', [owed.feeCount, owed.total], [2, 120])
  check('unwaived: nothing written off', [off.empty, off.total], [true, 0])
}

// ── 2. One waived: it moves across, it does not disappear ─────────────────
{
  const waivers = [{
    scheduled_payment_id: 'sp-sep',
    amount: 45,
    reason: 'Rent settled months ago — not worth pursuing',
    created_at: '2026-11-01T18:00:00Z',
    tenant_note: 'You have been on time all year — this one is on us.',
    tenant_notified_at: '2026-11-01T18:00:02Z',
    tenant_notified_email: 'dana@example.com',
  }]
  const owed = lateFeeLedger(plans, waivers, NOW)
  const off = waivedLedger(plans, waivers)

  check('waived: only October is still owed', [owed.feeCount, owed.total], [1, 75])
  check('waived: the ledger reports what was forgiven', owed.waived, 45)
  // The invariant that matters: the forgiven money is listed, not merely netted.
  check('waived: and it is listed row by row', [off.feeCount, off.total], [1, 45])
  check('waived: totals agree across the two ledgers', off.total, owed.waived)
  check('waived: grouped under the payer', [off.payerCount, off.groups[0].name], [1, 'Dana Reyes'])
  check('waived: the tenant was told', off.unannouncedCount, 0)
  check('waived: the private reason is kept', Boolean(off.groups[0].fees[0].reason), true)
}

// ── 3. Waived in silence: counted as such, with an action left on it ──────
{
  const waivers = [{
    scheduled_payment_id: 'sp-oct',
    amount: 75,
    reason: null,
    created_at: '2026-11-02T09:00:00Z',
    tenant_note: null,
    tenant_notified_at: null,
    tenant_notified_email: null,
  }]
  const off = waivedLedger(plans, waivers)
  check('silent: flagged as never announced', [off.unannouncedCount, off.unannouncedTotal], [1, 75])
  check('silent: the group carries it too', off.groups[0].unannounced, 1)
}

// ── 4. Both waived, one announced: the un-told group sorts first ──────────
{
  const waivers = [
    {
      scheduled_payment_id: 'sp-sep', amount: 45, reason: null,
      created_at: '2026-10-20T10:00:00Z', tenant_note: null,
      tenant_notified_at: '2026-10-20T10:00:05Z', tenant_notified_email: 'dana@example.com',
    },
    {
      scheduled_payment_id: 'sp-oct', amount: 75, reason: null,
      created_at: '2026-11-02T09:00:00Z', tenant_note: null,
      tenant_notified_at: null, tenant_notified_email: null,
    },
  ]
  const owed = lateFeeLedger(plans, waivers, NOW)
  const off = waivedLedger(plans, waivers)
  check('both: the pending list reaches zero', [owed.empty, owed.total], [true, 0])
  check('both: all of it is accounted for', off.total, 120)
  check('both: the un-told part is isolated', off.unannouncedTotal, 75)
  // Most recent first within a group, so the one just acted on is at the top.
  check('both: newest waiver first', off.groups[0].fees[0].label, 'October 2026 rent')
}

// ── 5. A waiver for a charge this page cannot see is not counted ──────────
{
  const off = waivedLedger(plans, [{
    scheduled_payment_id: 'sp-not-in-view', amount: 999, reason: null,
    created_at: '2026-11-02T09:00:00Z', tenant_note: null,
    tenant_notified_at: null, tenant_notified_email: null,
  }])
  check('out of scope: excluded rather than guessed at', [off.empty, off.total], [true, 0])
}

// ── 6. The tenant's email keeps its promises ──────────────────────────────
{
  const privateReason = 'Unenforceable this late — do not chase'
  const built = buildWaiverTenantEmail({
    tenantName: 'Dana Reyes',
    propertyName: 'Palo Verde',
    rows: [
      { label: 'September 2026 rent', dueDate: '2026-09-01', amount: 45, askedBefore: true },
      { label: 'October 2026 rent', dueDate: '2026-10-01', amount: 75, askedBefore: false },
    ],
    tenantNote: 'You have been on time all year — this one is on us.',
    landlordName: 'Sam Okafor',
    landlordEmail: 'sam@example.com',
    rentOutstanding: 0,
  })
  const body = built.html + built.text

  check('tenant email: the total is stated', built.subject.includes('$120.00'), true)
  check('tenant email: says waived, not owed', built.subject.includes('waived'), true)
  // The two notes are deliberately different fields; the private one must not
  // be reachable from this builder at all.
  check('tenant email: carries no private reason', body.includes(privateReason), false)
  // No pay link, no "settle this", no demand of any kind.
  check('tenant email: offers no payment link', /\/dashboard\/lease\?tab=payments/.test(body), false)
  check('tenant email: does not ask to settle', /settle this now/i.test(body), false)
  check('tenant email: tells them to ignore the earlier chase', /disregard/i.test(body), true)
  check('tenant email: both months named', body.includes('September 2026 rent') && body.includes('October 2026 rent'), true)
  check('tenant email: the landlord note is shown', body.includes('on time all year'), true)
}

// ── 7. Unpaid rent is stated once, as a fact, with no button ──────────────
{
  const built = buildWaiverTenantEmail({
    tenantName: 'Dana Reyes',
    propertyName: 'Palo Verde',
    rows: [{ label: 'October 2026 rent', dueDate: '2026-10-01', amount: 75, askedBefore: false }],
    rentOutstanding: 900,
  })
  check('rent owed: named in the email', built.text.includes('$900.00'), true)
  check('rent owed: still no payment link', /http/.test(built.html.replace(/http:\/\/www\.w3\.org[^"']*/g, '')), false)
  check('rent owed: scoped to the fee only', /covers the late fee only/i.test(built.text), true)
}

// ── 8. The landlord's receipt is the traceable half ───────────────────────
{
  const copy = buildWaiverLandlordEmail({
    landlordName: 'Sam Okafor',
    tenantName: 'Dana Reyes',
    tenantEmail: 'dana@example.com',
    propertyName: 'Palo Verde',
    leaseName: 'Unit 4 — 2026/27',
    rows: [{ label: 'September 2026 rent', dueDate: '2026-09-01', amount: 45, askedBefore: true }],
    reason: 'Unenforceable this late — do not chase',
    tenantNote: 'This one is on us.',
    tenantNotified: true,
    ledgerUrl: 'https://homehive.live/landlord/financials',
  })
  check('receipt: amount and tenant named', copy.subject.includes('$45.00') && copy.subject.includes('Dana Reyes'), true)
  // Their own copy is the one place the private note belongs.
  check('receipt: keeps the private reason', copy.text.includes('Unenforceable this late'), true)
  check('receipt: says the tenant was told', /has been emailed/.test(copy.text), true)
  check('receipt: links back to the ledger', copy.html.includes('/landlord/financials'), true)

  const silent = buildWaiverLandlordEmail({
    landlordName: 'Sam Okafor',
    tenantName: 'Dana Reyes',
    propertyName: 'Palo Verde',
    leaseName: 'Unit 4 — 2026/27',
    rows: [{ label: 'September 2026 rent', dueDate: '2026-09-01', amount: 45, askedBefore: false }],
    tenantNotified: false,
  })
  check('receipt: says plainly when nobody was told', /has not been told/.test(silent.text), true)
}

console.log(`${pass.length} passed`)
for (const p of pass) console.log('  ok   ' + p)
if (fail.length) {
  console.log(`\n${fail.length} FAILED`)
  for (const f of fail) console.log('  FAIL ' + f)
  process.exit(1)
}
console.log('\nall good')
