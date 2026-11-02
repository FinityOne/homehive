/**
 * Pins how a rent payment is broken down in the emails.
 *
 * Rent is billed as the payer's whole monthly obligation, so a $770.67 charge
 * is really $749 rent plus a $21.67 share of the house internet. The receipts
 * used to print the total alone, which reads to a tenant as "my rent went up"
 * and to a landlord as "utility money is rent income".
 *
 * Two rules here are worth protecting, because breaking either produces an
 * email that is confidently wrong rather than merely sparse:
 *
 *   1. the buckets must always add up to the money that moved
 *   2. a breakdown that does not reconcile to its own total must be dropped
 *
 * Run: npm run verify:payment-emails
 */
import {
  bucketsOf, bucketLines, buildRentReceiptEmail, buildLandlordRentPaidEmail,
} from '../src/lib/rentPaymentEmails.ts'
import { describeRows } from '../src/lib/rentPaymentNotify.ts'

let failures = 0
const check = (name, cond, detail) => {
  if (cond) { console.log('  ✓ ' + name); return }
  failures++
  console.log('  ✗ ' + name + (detail ? '\n      ' + detail : ''))
}
const near = (a, b) => Math.abs(a - b) < 0.005

// The real shape of the University Dr lease: rent plus a share of the internet.
const rentWithInternet = {
  label: 'Rent — November 2026',
  amount: 770.67,
  kind: 'rent',
  parts: [
    { label: 'Rent', amount: 749, kind: 'rent' },
    { label: 'Internet', amount: 21.67, kind: 'utility' },
  ],
}

console.log('\nbuckets')
{
  const b = bucketsOf([rentWithInternet])
  check('rent and utilities are separated', near(b.rent, 749) && near(b.utilities, 21.67),
    JSON.stringify(b))
  check('buckets add up to the charge',
    near(b.rent + b.utilities + b.charges + b.fees, 770.67), JSON.stringify(b))
}
{
  // A mixed payment: rent (with a utility inside), a one-off utility billed on
  // its own, a deposit-style charge, and a late fee.
  const rows = [
    rentWithInternet,
    { label: 'Water — October', amount: 40, kind: 'utility' },
    { label: 'Parking remote', amount: 25, kind: 'charge' },
    { label: 'Late fee — October 2026 rent', amount: 60, kind: 'late_fee' },
  ]
  const b = bucketsOf(rows)
  const total = rows.reduce((s, r) => s + r.amount, 0)
  check('every category lands in its own bucket',
    near(b.rent, 749) && near(b.utilities, 61.67) && near(b.charges, 25) && near(b.fees, 60),
    JSON.stringify(b))
  check('buckets still add up across four categories',
    near(b.rent + b.utilities + b.charges + b.fees, total), `${total} vs ${JSON.stringify(b)}`)
  check('only non-zero categories are listed, in reading order',
    bucketLines(b).map(l => l.label).join(',') === 'Rent,Utilities,Other charges,Late fees')
}
{
  const b = bucketsOf([{ label: 'Rent — November 2026', amount: 900, kind: 'rent' }])
  check('an all-rent payment still reports one Rent line',
    bucketLines(b).length === 1 && near(bucketLines(b)[0].amount, 900))
}

console.log('\ntenant receipt')
{
  const { html, text } = buildRentReceiptEmail({
    tenantName: 'Elise Graves', propertyName: 'University Dr Palace', event: 'paid',
    rows: [rentWithInternet], rent: 770.67, fee: 38.53, method: 'card',
    remaining: 0, paidOn: new Date('2026-11-02T00:03:00Z'), payUrl: 'https://x/lease',
  })
  check('the utility is named in the HTML', html.includes('Internet'))
  check('the utility is named in the text', text.includes('Internet'))
  check('the breakdown is indented under its charge', text.includes('    Internet (utility) — $21.67'))
  check('the totals block separates rent from utilities',
    html.includes('>Rent<') && html.includes('>Utilities<'))
  check('the fee is still shown apart from the rent', html.includes('Processing fee'))
  check('the total still includes the fee', html.includes('$809.20') || text.includes('$809.20'))
}
{
  // One line item, so a breakdown would only repeat the total.
  const { html } = buildRentReceiptEmail({
    tenantName: 'Gauge', propertyName: 'University Dr Palace', event: 'paid',
    rows: [{ label: 'Rent — November 2026', amount: 900, kind: 'rent',
             parts: [{ label: 'Rent', amount: 900, kind: 'rent' }] }],
    rent: 900, fee: 45, method: 'card', remaining: 0,
    paidOn: new Date('2026-11-02T00:03:00Z'), payUrl: 'https://x/lease',
  })
  check('a single-line charge prints no sub-line',
    (html.match(/· utility/g) ?? []).length === 0 && html.includes('$900'))
}

console.log('\nlandlord notification')
{
  const { html, text } = buildLandlordRentPaidEmail({
    landlordName: 'Heran Patel', tenantName: 'Elise Graves',
    propertyName: 'University Dr Palace', event: 'paid',
    rows: [rentWithInternet], rent: 770.67, method: 'card',
    paidOn: new Date('2026-11-02T00:03:00Z'), tenantOutstanding: 0, planOutstanding: 120,
    planUrl: 'https://x/financials',
  })
  check('the split is shown', html.includes('Where it goes') && html.includes('Utilities'))
  check('utility money is flagged as not rent', html.includes("isn't rent"))
  check('the text version carries the split too', text.includes('Utilities: $21.67'))
  check('a part-utility payment is not announced as rent received',
    html.includes('Payment received') && !html.includes('Rent received'))
}
{
  const { html } = buildLandlordRentPaidEmail({
    landlordName: 'Heran Patel', tenantName: 'Gauge',
    propertyName: 'University Dr Palace', event: 'paid',
    rows: [{ label: 'Rent — November 2026', amount: 900, kind: 'rent' }],
    rent: 900, method: 'card', paidOn: new Date(), tenantOutstanding: 0, planOutstanding: 0,
    planUrl: 'https://x/financials',
  })
  check('a pure rent payment still says rent received',
    html.includes('Rent received') && !html.includes('Where it goes'))
}
{
  // ACH clearing days later is its own event, and the landlord is told.
  const { subject, html } = buildLandlordRentPaidEmail({
    landlordName: 'Heran Patel', tenantName: 'Gina',
    propertyName: 'University Dr Palace', event: 'paid',
    rows: [rentWithInternet], rent: 770.66, method: 'ach',
    paidOn: new Date('2026-11-09T12:00:00Z'), tenantOutstanding: 0, planOutstanding: 0,
    planUrl: 'https://x/financials',
  })
  check('a cleared bank transfer reads as settled, with its split',
    subject.startsWith('Rent paid') && html.includes('Bank transfer') && html.includes('Utilities'))
}

console.log('\nreconciliation guard')
{
  // A stub standing in for PostgREST: every call is .from().select().in().
  const stub = tables => ({
    from: table => ({
      select: () => ({ in: () => Promise.resolve({ data: tables[table] ?? [], error: null }) }),
    }),
  })
  const rentRow = { kind: 'scheduled', id: 'sp1', amount: 770.67, label: 'Rent — November 2026' }

  const agreeing = await describeRows(stub({
    scheduled_payments: [{ id: 'sp1', plan_tenant_id: 'pt1' }],
    payment_line_items: [
      { plan_tenant_id: 'pt1', category: 'rent', label: 'Rent', amount: 749, utility_id: null },
      { plan_tenant_id: 'pt1', category: 'internet', label: 'Internet', amount: 21.67, utility_id: 'u1' },
    ],
  }), [rentRow])
  check('line items that reconcile become the breakdown',
    agreeing[0].parts?.length === 2 && agreeing[0].parts[1].kind === 'utility',
    JSON.stringify(agreeing[0]))

  const stale = await describeRows(stub({
    scheduled_payments: [{ id: 'sp1', plan_tenant_id: 'pt1' }],
    // The landlord has since raised the rent: these no longer add up to $770.67.
    payment_line_items: [
      { plan_tenant_id: 'pt1', category: 'rent', label: 'Rent', amount: 799, utility_id: null },
      { plan_tenant_id: 'pt1', category: 'internet', label: 'Internet', amount: 21.67, utility_id: 'u1' },
    ],
  }), [rentRow])
  check('line items that do NOT reconcile are dropped, not shown',
    stale[0].parts === undefined, JSON.stringify(stale[0]))
  check('a dropped breakdown still buckets the whole charge as rent',
    near(bucketsOf(stale).rent, 770.67))

  const oneOffs = await describeRows(stub({
    special_payments: [
      { id: 'x1', utility_id: 'u1' },
      { id: 'x2', utility_id: null },
    ],
  }), [
    { kind: 'special', id: 'x1', amount: 40, label: 'Water — October' },
    { kind: 'special', id: 'x2', amount: 25, label: 'Parking remote' },
  ])
  check('a one-off from a declared utility is a utility',
    oneOffs[0].kind === 'utility' && oneOffs[1].kind === 'charge',
    JSON.stringify(oneOffs))

  const fee = await describeRows(stub({}), [
    { kind: 'late_fee', id: 'sp1', amount: 60, label: 'Late fee — October 2026 rent' },
  ])
  check('a fee collected on its own stays a late fee', fee[0].kind === 'late_fee')
}

console.log(failures === 0 ? '\nAll breakdown checks passed.\n' : `\n${failures} check(s) FAILED.\n`)
process.exit(failures === 0 ? 0 : 1)
