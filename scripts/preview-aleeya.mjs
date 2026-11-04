/**
 * Prints Aleeya's pet addendum exactly as the send route would build it.
 *
 * A read-only preview: it touches no database and sends no email. It exists so
 * the wording of a real contract can be reviewed before it is mailed to a real
 * tenant, which is the one review this feature cannot do for itself.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs scripts/preview-aleeya.mjs
 */
const { buildPetAdditionDocument, verifyAmendmentDocument, renderAmendmentText } =
  await import('../src/lib/leaseAmendments.ts')

const EFFECTIVE = process.argv[2] || '2026-12-01'
const RESPOND_BY = process.argv[3] || '2026-11-17'

const doc = buildPetAdditionDocument({
  propertyAddress: '820 W 9th Street, Tempe, AZ 85281',
  landlordName: 'Heran Maharaja',
  tenantName: 'Aleeya Cruz',
  leaseStartDate: '2026-08-03',
  leaseEndDate: '2027-07-31',
  effectiveDate: EFFECTIVE,
  agreementDate: '2026-11-03',
  monthlyPetRent: 65,
  petDeposit: 300,
  cleaningFee: 100,
  respondBy: RESPOND_BY,
  requireCotenantConsent: true,
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
})

const problems = verifyAmendmentDocument(doc)
if (problems.length > 0) {
  console.log('REFUSED — this document would not be sent:')
  for (const p of problems) console.log(`  ✗ ${p}`)
  process.exit(1)
}

console.log(renderAmendmentText(doc, null))
console.log('\n── guard ───────────────────────────────────────────────────────')
console.log('✓ passes verifyAmendmentDocument — safe to send')
