/**
 * Draw up one lease amendment and send it for signature, from the command line.
 *
 * This exists because the first amendment on a brand-new table has to be
 * created by somebody, and the landlord UI that normally does it ships in the
 * same change. It is the admin path, not a second implementation: it imports
 * `buildPetAdditionDocument`, `verifyAmendmentDocument` and
 * `buildAmendmentRequestEmail` — the same three functions POST
 * /api/lease-amendments calls — so the document, the guard and the email are
 * byte-for-byte what the portal would have produced. The only thing it skips
 * is the bearer-token check, because there is no browser session here.
 *
 * It keeps the route's one real safety property: **the row and the email are
 * one action**. If the send fails, the row is deleted and nothing is recorded,
 * because a landlord who believes they have asked and has not is worse off
 * than one who knows the send failed.
 *
 * Dry run (default — prints the document and the email subject, sends nothing):
 *   node --experimental-strip-types --no-warnings --env-file=.env.local \
 *     --import ./scripts/ts-resolve.mjs scripts/send-amendment.mjs
 *
 * For real:
 *   … scripts/send-amendment.mjs --send
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const {
  buildPetAdditionDocument, verifyAmendmentDocument, renderAmendmentText,
  amendmentPath, signingToday, fmtDollars, dueOnExecution, monthlyTotal,
} = await import('../src/lib/leaseAmendments.ts')
const { buildAmendmentRequestEmail } = await import('../src/lib/amendmentEmails.ts')

const SEND = process.argv.includes('--send')

// ── The one amendment this run creates ──────────────────────────────────────
//
// Hard-coded rather than taken from flags: a script that mails a contract to a
// real tenant should be read before it is run, and the thing a reader needs to
// check is these values. A flag-driven version would be easier to misfire.
const PLAN = {
  leaseId:       '4fa8fbdb-88f1-45ff-b891-bb703b2be9d8',
  ownerId:       '16f7ab29-9a38-4883-9fa9-816185f73f60',
  propertyId:    'd1de6fed-a6d0-4814-96c8-5ef3269d3bf5',
  leaseTenantId: 'a5fe319e-bbb1-45c9-985f-2782d18c67e9',

  premises:      '820 W 9th Street, Tempe, AZ 85281',
  landlordName:  'Heran Patel',
  tenantName:    'Aleeya Cruz',
  tenantEmail:   'cruzaleeya6@gmail.com',
  leaseStart:    '2026-08-03',
  leaseEnd:      '2027-07-31',

  // Backdated to the 1st by the landlord's instruction. The document states
  // that it is retroactive, in a recital and again in the rent clause.
  effectiveDate: '2026-11-01',
  respondBy:     '2026-11-19',

  monthlyPetRent: 65,
  petDeposit:     300,
  cleaningFee:    100,

  pet: {
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
  // Six tenants on this lease, so the housemate-consent clause applies.
  requireCotenantConsent: true,
}

const SITE = process.env.NEXT_PUBLIC_SITE_URL?.includes('localhost')
  ? 'https://homehive.live'
  : (process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live')

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

// ── Build and check ─────────────────────────────────────────────────────────

const doc = buildPetAdditionDocument({
  propertyAddress: PLAN.premises,
  landlordName: PLAN.landlordName,
  tenantName: PLAN.tenantName,
  leaseStartDate: PLAN.leaseStart,
  leaseEndDate: PLAN.leaseEnd,
  effectiveDate: PLAN.effectiveDate,
  agreementDate: signingToday(),
  monthlyPetRent: PLAN.monthlyPetRent,
  petDeposit: PLAN.petDeposit,
  cleaningFee: PLAN.cleaningFee,
  respondBy: PLAN.respondBy,
  requireCotenantConsent: PLAN.requireCotenantConsent,
  pet: PLAN.pet,
})

const problems = verifyAmendmentDocument(doc)
if (problems.length > 0) {
  console.error('REFUSED — the document is not safe to send:')
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}

console.log(renderAmendmentText(doc, null))
console.log('\n────────────────────────────────────────────────────────────────')
console.log(`guard         ✓ passes verifyAmendmentDocument`)
console.log(`recipient     ${PLAN.tenantName} <${PLAN.tenantEmail}>`)
console.log(`due on signing ${fmtDollars(dueOnExecution(doc))}`)
console.log(`then          ${fmtDollars(monthlyTotal(doc))}/month from ${doc.effectiveDate}`)
console.log(`backdated     ${doc.isBackdated ? 'yes — stated in the document' : 'no'}`)

if (!SEND) {
  console.log('\nDRY RUN — nothing was written and nothing was sent. Re-run with --send.')
  process.exit(0)
}

// ── Guard against a double send ─────────────────────────────────────────────
//
// The table's partial unique index already forbids two live amendments for one
// tenant, but failing here with a sentence beats failing on a 23505.
const { data: existing } = await db
  .from('lease_amendments')
  .select('id, status, token')
  .eq('lease_id', PLAN.leaseId)
  .eq('lease_tenant_id', PLAN.leaseTenantId)
  .eq('status', 'sent')
  .maybeSingle()

if (existing) {
  console.error(`\nREFUSED — ${PLAN.tenantName} already has an unsigned amendment (${existing.id}).`)
  console.error('Withdraw it in the portal before sending another.')
  process.exit(1)
}

// ── Insert ──────────────────────────────────────────────────────────────────

const { data: amendment, error: insertErr } = await db
  .from('lease_amendments')
  .insert({
    lease_id: PLAN.leaseId,
    owner_id: PLAN.ownerId,
    property_id: PLAN.propertyId,
    lease_tenant_id: PLAN.leaseTenantId,
    kind: 'pet_addition',
    title: doc.title,
    effective_date: PLAN.effectiveDate,
    monthly_charge: PLAN.monthlyPetRent,
    monthly_charge_label: doc.charges.find(c => c.kind === 'monthly')?.label ?? null,
    deposit_amount: PLAN.petDeposit,
    one_time_fee_amount: PLAN.cleaningFee,
    respond_by: PLAN.respondBy,
    document: doc,
    tenant_name: PLAN.tenantName,
    tenant_email: PLAN.tenantEmail.toLowerCase(),
  })
  .select('*')
  .single()

if (insertErr || !amendment) {
  console.error('\nInsert failed:', insertErr)
  process.exit(1)
}
console.log(`\nrow created   ${amendment.id}`)

// ── Send, and roll back the row if it does not leave the building ──────────

const { data: image } = await db
  .from('property_images')
  .select('url').eq('property_id', PLAN.propertyId)
  .order('position', { ascending: true }).limit(1).maybeSingle()

const { data: profile } = await db
  .from('profiles').select('email, full_name').eq('id', PLAN.ownerId).maybeSingle()

const built = buildAmendmentRequestEmail({
  doc,
  tenantName: PLAN.tenantName,
  landlordName: profile?.full_name ?? PLAN.landlordName,
  signUrl: `${SITE}${amendmentPath(amendment.token)}`,
  heroImage: image?.url ?? null,
})

const resend = new Resend(process.env.RESEND_API_KEY)
try {
  const { error } = await resend.emails.send({
    from: 'HomeHive <hello@homehive.live>',
    to: PLAN.tenantEmail,
    replyTo: profile?.email || undefined,
    subject: built.subject,
    html: built.html,
    text: built.text,
  })
  if (error) throw error
} catch (e) {
  await db.from('lease_amendments').delete().eq('id', amendment.id)
  console.error('\nSend failed — the row was removed, so nothing is recorded:', e)
  process.exit(1)
}

await db.from('lease_amendment_sends').insert({
  amendment_id: amendment.id,
  owner_id: PLAN.ownerId,
  kind: 'request',
  recipient: PLAN.tenantEmail,
  subject: built.subject,
})

console.log(`email sent    "${built.subject}"`)
console.log(`              → ${PLAN.tenantEmail}`)
console.log(`she signs at  ${SITE}${amendmentPath(amendment.token)}`)
console.log(`you track at  ${SITE}/landlord/leases/${PLAN.leaseId}?tab=amendments`)
