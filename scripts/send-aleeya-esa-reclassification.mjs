/**
 * Reclassify Dewey as an assistance animal, take the pet rent off Aleeya's
 * account, and send her the change agreement — from the command line.
 *
 * The companion to `send-aleeya-pet-amendment.mjs`, and its reversal. That
 * script added a $65/month pet charge and mailed a pet addendum for signature.
 * The animal is an emotional support animal, so under the Fair Housing Act the
 * charge may not exist at all: this script removes it everywhere it was
 * written and replaces the addendum with one that says why.
 *
 * It imports `buildAssistanceAnimalDocument`, `verifyAmendmentDocument` and
 * `buildAmendmentAdjustmentEmail` — the same functions the portal would call —
 * so the document, the guard and the email are what the app would produce.
 *
 * **Order matters, and it is deliberate.** The money comes off *before* the
 * email goes out, because the email tells her the charge is already gone. If
 * the send then fails, the amendment row is deleted and nothing is recorded as
 * sent — but the money stays corrected, because a charge that should not exist
 * should not sit on her account waiting for an email to succeed.
 *
 * Dry run (default — prints the document, the email and every write it would
 * make, touches nothing):
 *   node --experimental-strip-types --no-warnings --env-file=.env.local \
 *     --import ./scripts/ts-resolve.mjs scripts/send-aleeya-esa-reclassification.mjs
 *
 * For real:
 *   … scripts/send-aleeya-esa-reclassification.mjs --send
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const {
  buildAssistanceAnimalDocument, verifyAmendmentDocument, renderAmendmentText,
  amendmentPath, signingToday, fmtDollars, monthlyRemoved,
} = await import('../src/lib/leaseAmendments.ts')
const { buildAmendmentAdjustmentEmail } = await import('../src/lib/amendmentEmails.ts')

const SEND = process.argv.includes('--send')

// ── What this run changes ───────────────────────────────────────────────────
//
// Hard-coded for the same reason the pet script was: a script that mails a
// contract to a real tenant and rewrites her ledger should be read before it is
// run, and these values are the thing a reader needs to check.
const PLAN = {
  leaseId:       '4fa8fbdb-88f1-45ff-b891-bb703b2be9d8',
  ownerId:       '16f7ab29-9a38-4883-9fa9-816185f73f60',
  propertyId:    'd1de6fed-a6d0-4814-96c8-5ef3269d3bf5',
  leaseTenantId: 'a5fe319e-bbb1-45c9-985f-2782d18c67e9',
  planId:        '6c952c27-93c3-4c7f-9dc4-4326a63d056e',
  planTenantId:  '3c12ec75-7579-4005-b1fc-02e06f2a6725',

  premises:      '820 W 9th Street, Tempe, AZ 85281',
  landlordName:  'Heran Patel',
  tenantName:    'Aleeya Cruz',
  tenantEmail:   'cruzaleeya6@gmail.com',
  leaseStart:    '2026-08-03',
  leaseEnd:      '2027-07-31',

  // Back to the date the pet rent was itself made effective, so there is no
  // month in between in which she owed pet rent. She never paid any.
  effectiveDate: '2026-11-01',
  respondBy:     '2026-11-28',

  // The charge being removed, and the one unpaid month billed on its own.
  monthlyPetRent:      65,
  petFeeLineItemId:    'c1d51469-9e18-4a17-b290-2cbdfbc275e3',
  novemberSpecialId:   'ed86cd59-0a78-4d5b-a61e-1c5ea39bb666',
  // The pet addendum this supersedes. Sent, never signed.
  supersedesAmendmentId: 'f8b4129c-4f1e-48d0-b8ae-071e579840a3',

  // Dewey, identified exactly as the pet addendum identified him — same animal,
  // so there is no argument about which animal was reclassified.
  animal: {
    name: 'Dewey',
    species: 'Dog',
    breed: 'Alaskan Husky',
    color: 'Brown',
    sex: 'Male',
    weight: '33 lbs 15 oz',
    dob: '2024-09-16',
    microchip: '985113014014128',
    recordNumber: 'A861983',
    sterilized: true,
    vaccinated: true,
  },

  // Left false on purpose. The document would otherwise recite that the
  // landlord holds documentation it considers reliable, and that is a statement
  // of fact in a contract that nobody has confirmed. "Landlord has approved the
  // request" is true either way. Flip it only if the letter is on file.
  documentationOnFile: false,
}

const SITE = process.env.NEXT_PUBLIC_SITE_URL?.includes('localhost')
  ? 'https://homehive.live'
  : (process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live')

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const money = n => Math.round(Number(n) * 100) / 100

// ── Read the ledger as it stands ────────────────────────────────────────────
//
// The new monthly total is computed from the line items that will remain, never
// typed in. A hard-coded 870.66 would be wrong the first time anybody edits her
// internet share, and wrong silently.

const { data: planTenant, error: ptErr } = await db
  .from('payment_plan_tenants')
  .select('id, name, email, monthly_total, status')
  .eq('id', PLAN.planTenantId)
  .single()
if (ptErr || !planTenant) {
  console.error('Could not read her payment plan row:', ptErr)
  process.exit(1)
}

const { data: lineItems, error: liErr } = await db
  .from('payment_line_items')
  .select('id, category, label, amount')
  .eq('plan_tenant_id', PLAN.planTenantId)
if (liErr) {
  console.error('Could not read her line items:', liErr)
  process.exit(1)
}

const petItem = lineItems.find(li => li.id === PLAN.petFeeLineItemId)
const remaining = lineItems.filter(li => li.id !== PLAN.petFeeLineItemId)
const newMonthlyTotal = money(remaining.reduce((s, li) => s + Number(li.amount), 0))
const baseRent = money(
  remaining.filter(li => li.category === 'rent').reduce((s, li) => s + Number(li.amount), 0)
)
const oldMonthlyTotal = money(planTenant.monthly_total)

if (!petItem) {
  console.error(
    `\nREFUSED — the pet rent line item ${PLAN.petFeeLineItemId} is not on her plan.\n` +
    `Somebody may have removed it already. Nothing has been changed.`
  )
  process.exit(1)
}
if (money(petItem.amount) !== PLAN.monthlyPetRent) {
  console.error(
    `\nREFUSED — the pet rent on her plan is ${fmtDollars(money(petItem.amount))}, not ` +
    `${fmtDollars(PLAN.monthlyPetRent)}. Check the figure before running this.`
  )
  process.exit(1)
}

// Only rows that are still pending may be re-amounted. A `processing` row has a
// Stripe intent against its amount and a settled row is history; rewriting
// either is how a ledger starts lying about what was actually collected.
const { data: scheduled, error: schErr } = await db
  .from('scheduled_payments')
  .select('id, due_date, amount, status, paid_amount, submitted_at')
  .eq('plan_tenant_id', PLAN.planTenantId)
  .gte('due_date', PLAN.effectiveDate)
  .order('due_date', { ascending: true })
if (schErr) {
  console.error('Could not read her scheduled payments:', schErr)
  process.exit(1)
}

const repriceable = scheduled.filter(
  r => r.status === 'pending' && money(r.amount) === oldMonthlyTotal
)
const untouchable = scheduled.filter(r => r.status !== 'pending')
const oddAmounts = scheduled.filter(
  r => r.status === 'pending' && money(r.amount) !== oldMonthlyTotal
)

const { data: special, error: spErr } = await db
  .from('special_payments')
  .select('id, label, amount, status, due_date')
  .eq('id', PLAN.novemberSpecialId)
  .maybeSingle()
if (spErr) {
  console.error('Could not read the November pet-rent charge:', spErr)
  process.exit(1)
}

// ── Build and check the document ────────────────────────────────────────────

const doc = buildAssistanceAnimalDocument({
  propertyAddress: PLAN.premises,
  landlordName: PLAN.landlordName,
  tenantName: PLAN.tenantName,
  leaseStartDate: PLAN.leaseStart,
  leaseEndDate: PLAN.leaseEnd,
  effectiveDate: PLAN.effectiveDate,
  agreementDate: signingToday(),
  animal: PLAN.animal,
  role: 'emotional_support',
  removedMonthlyPetRent: PLAN.monthlyPetRent,
  monthlyTotalAfter: newMonthlyTotal,
  baseMonthlyRent: baseRent,
  documentationOnFile: PLAN.documentationOnFile,
  supersedes: {
    title: 'Residential Change Lease Agreement',
    effectiveDate: '2026-11-01',
    wasSigned: false,
  },
  respondBy: PLAN.respondBy,
})

const problems = verifyAmendmentDocument(doc)
if (problems.length > 0) {
  console.error('REFUSED — the document is not safe to send:')
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}

const cancelledCharge = special && special.status === 'pending'
  ? { label: special.label, amount: money(special.amount) }
  : null

// ── Say exactly what will happen ────────────────────────────────────────────

console.log(renderAmendmentText(doc, null))
console.log('\n════════════════════════════════════════════════════════════════')
console.log(`guard            ✓ passes verifyAmendmentDocument`)
console.log(`recipient        ${PLAN.tenantName} <${PLAN.tenantEmail}>`)
console.log(`removes          ${fmtDollars(monthlyRemoved(doc))}/month from ${doc.effectiveDate}`)
console.log(`backdated        ${doc.isBackdated ? 'yes — stated in the document' : 'no'}`)
console.log(`\nLEDGER CHANGES`)
console.log(`  line item      delete ${petItem.id} — "${petItem.label}" ${fmtDollars(money(petItem.amount))}`)
console.log(`  monthly total  ${fmtDollars(oldMonthlyTotal)} → ${fmtDollars(newMonthlyTotal)}`)
console.log(`                 (${remaining.map(li => `${li.label} ${fmtDollars(money(li.amount))}`).join(' + ')})`)
console.log(`  pending months ${repriceable.length} row(s) re-amounted to ${fmtDollars(newMonthlyTotal)}:`)
for (const r of repriceable) {
  console.log(`                 ${r.due_date}  ${fmtDollars(money(r.amount))} → ${fmtDollars(newMonthlyTotal)}`)
}
if (oddAmounts.length > 0) {
  console.log(`  !! skipped     ${oddAmounts.length} pending row(s) whose amount is not ${fmtDollars(oldMonthlyTotal)}:`)
  for (const r of oddAmounts) console.log(`                 ${r.due_date}  ${fmtDollars(money(r.amount))} — left alone, check by hand`)
}
if (untouchable.length > 0) {
  console.log(`  untouched      ${untouchable.length} row(s) already paid/processing:`)
  for (const r of untouchable) console.log(`                 ${r.due_date}  ${fmtDollars(money(r.amount))}  ${r.status}`)
}
console.log(
  `  november       ${special
    ? special.status === 'pending'
      ? `waive ${special.id} — "${special.label}" ${fmtDollars(money(special.amount))} (unpaid)`
      : `LEFT ALONE — status is "${special.status}", not pending. Check by hand.`
    : 'not found — nothing to waive'}`
)
console.log(`  old addendum   withdraw ${PLAN.supersedesAmendmentId}`)
console.log(`  new addendum   insert kind=assistance_animal, no charges`)

if (special && special.status === 'paid') {
  console.log(
    `\n  !! She has PAID the November pet rent. This script does not issue refunds —\n` +
    `     refund ${fmtDollars(money(special.amount))} to her separately, and note it here.`
  )
}

const built = buildAmendmentAdjustmentEmail({
  doc,
  tenantName: PLAN.tenantName,
  landlordName: PLAN.landlordName,
  signUrl: `${SITE}${amendmentPath('PREVIEW-TOKEN')}`,
  newMonthlyTotal,
  cancelledCharge,
})
console.log(`\nEMAIL`)
console.log(`  subject        "${built.subject}"`)
console.log(`${built.text.split('\n').map(l => `  │ ${l}`).join('\n')}`)

if (!SEND) {
  console.log('\nDRY RUN — nothing was written and nothing was sent. Re-run with --send.')
  process.exit(0)
}

// ── 1. Withdraw the pet addendum ────────────────────────────────────────────
//
// First, because the table forbids two live amendments for one tenant, and
// because leaving a live "please sign this, it costs $65/month" in her account
// while mailing her "that charge is cancelled" is the one outcome guaranteed to
// confuse her.
{
  const { data, error } = await db
    .from('lease_amendments')
    .update({ status: 'withdrawn' })
    .eq('id', PLAN.supersedesAmendmentId)
    .eq('status', 'sent')
    .select('id')
    .maybeSingle()
  if (error) {
    console.error('\nCould not withdraw the pet addendum:', error)
    process.exit(1)
  }
  console.log(data
    ? `\nwithdrew       pet addendum ${PLAN.supersedesAmendmentId}`
    : `\nnote           pet addendum was not in "sent" state — left as it is`)
}

// ── 2. Take the money off ───────────────────────────────────────────────────
//
// Before the email, so the email's "already off your account" is true when she
// reads it.
{
  const { error } = await db
    .from('payment_line_items').delete().eq('id', PLAN.petFeeLineItemId)
  if (error) {
    console.error('Could not delete the pet rent line item:', error)
    process.exit(1)
  }
  console.log(`deleted        pet rent line item (${fmtDollars(PLAN.monthlyPetRent)}/mo)`)
}
{
  const { error } = await db
    .from('payment_plan_tenants')
    .update({ monthly_total: newMonthlyTotal })
    .eq('id', PLAN.planTenantId)
  if (error) {
    console.error('Could not update her monthly total:', error)
    process.exit(1)
  }
  console.log(`monthly total  ${fmtDollars(oldMonthlyTotal)} → ${fmtDollars(newMonthlyTotal)}`)
}
{
  // Re-amount by id, and only the ids checked above. A blanket
  // `.eq('status','pending')` update would race anything that moved a row to
  // processing while this script was printing its preview.
  let done = 0
  for (const r of repriceable) {
    const { data, error } = await db
      .from('scheduled_payments')
      .update({ amount: newMonthlyTotal })
      .eq('id', r.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (error) {
      console.error(`Could not re-amount ${r.due_date}:`, error)
      process.exit(1)
    }
    if (data) done++
    else console.log(`  note         ${r.due_date} is no longer pending — left alone`)
  }
  console.log(`re-amounted    ${done} pending month(s) to ${fmtDollars(newMonthlyTotal)}`)
}
if (special && special.status === 'pending') {
  const { error } = await db
    .from('special_payments')
    .update({
      status: 'waived',
      notes:
        `Cancelled ${signingToday()}. Dewey is recorded on the lease as an emotional support ` +
        `animal, not a pet, so no pet rent is owed for any period — including November 2026. ` +
        `This charge was never paid and nothing is owed on it. See the assistance animal ` +
        `change lease agreement effective ${PLAN.effectiveDate}.`,
    })
    .eq('id', PLAN.novemberSpecialId)
    .eq('status', 'pending')
  if (error) {
    console.error('Could not cancel the November pet rent:', error)
    process.exit(1)
  }
  console.log(`cancelled      November pet rent ${fmtDollars(money(special.amount))} (waived, unpaid)`)
}

// ── 3. Record the new amendment ─────────────────────────────────────────────

const { data: amendment, error: insertErr } = await db
  .from('lease_amendments')
  .insert({
    lease_id: PLAN.leaseId,
    owner_id: PLAN.ownerId,
    property_id: PLAN.propertyId,
    lease_tenant_id: PLAN.leaseTenantId,
    kind: 'assistance_animal',
    title: doc.title,
    effective_date: PLAN.effectiveDate,
    // Nothing is charged by this amendment. The columns are the charge
    // columns, and a removal is not a charge — it is in the document.
    monthly_charge: 0,
    monthly_charge_label: null,
    deposit_amount: 0,
    one_time_fee_amount: 0,
    respond_by: PLAN.respondBy,
    document: doc,
    tenant_name: PLAN.tenantName,
    tenant_email: PLAN.tenantEmail.toLowerCase(),
  })
  .select('*')
  .single()

if (insertErr || !amendment) {
  console.error('\nInsert failed — the money is already corrected, but no document was recorded:', insertErr)
  process.exit(1)
}
console.log(`row created    ${amendment.id}`)

// ── 4. Send it ──────────────────────────────────────────────────────────────

const { data: image } = await db
  .from('property_images')
  .select('url').eq('property_id', PLAN.propertyId)
  .order('position', { ascending: true }).limit(1).maybeSingle()

const { data: profile } = await db
  .from('profiles').select('email, full_name').eq('id', PLAN.ownerId).maybeSingle()

const email = buildAmendmentAdjustmentEmail({
  doc,
  tenantName: PLAN.tenantName,
  landlordName: profile?.full_name ?? PLAN.landlordName,
  signUrl: `${SITE}${amendmentPath(amendment.token)}`,
  heroImage: image?.url ?? null,
  newMonthlyTotal,
  cancelledCharge,
})

const resend = new Resend(process.env.RESEND_API_KEY)
try {
  const { error } = await resend.emails.send({
    from: 'HomeHive <hello@homehive.live>',
    to: PLAN.tenantEmail,
    replyTo: profile?.email || undefined,
    subject: email.subject,
    html: email.html,
    text: email.text,
  })
  if (error) throw error
} catch (e) {
  // The row goes; the ledger correction stays. See the note at the top.
  await db.from('lease_amendments').delete().eq('id', amendment.id)
  console.error(
    '\nSend failed — the amendment row was removed, so nothing is recorded as sent.\n' +
    'The pet rent is still off her account, which is correct regardless:', e
  )
  process.exit(1)
}

await db.from('lease_amendment_sends').insert({
  amendment_id: amendment.id,
  owner_id: PLAN.ownerId,
  kind: 'request',
  recipient: PLAN.tenantEmail,
  subject: email.subject,
})

console.log(`email sent     "${email.subject}"`)
console.log(`               → ${PLAN.tenantEmail}`)
console.log(`she signs at   ${SITE}${amendmentPath(amendment.token)}`)
console.log(`you track at   ${SITE}/landlord/leases/${PLAN.leaseId}?tab=amendments`)
