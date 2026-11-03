/**
 * Proves the lease-amendment engine's policy.
 *
 * Worth a script rather than a reading, because every way of getting this wrong
 * is silent and most of them are legally expensive:
 *
 *   • a document that lost the clause saying the rest of the lease is unchanged
 *     — a tenant signs a pet addendum and has arguably agreed to anything
 *   • a charge clause that names a figure without closing the list, leaving a
 *     pet deposit and a cleaning fee open
 *   • a backdated signature, which a free date field allows by accident
 *   • a one-character "signature" that binds nobody
 *   • a signed amendment whose charge nobody is collecting, reported as done
 *   • "expired"/"in force" stored rather than derived — the mistake
 *     `late_fees_applied` already cost this codebase once
 *
 * Run: npm run verify:amendments
 */
const {
  buildPetAdditionDocument, verifyAmendmentDocument, renderAmendmentText,
  describePet, dollarsInWords, fmtMoneyWithWords, fmtDollars, fmtLegalDate,
  monthName, amendmentPath, signingToday,
  checkSignatureName, checkSignatureDate,
  amendmentPhase, nextAction, sortAmendments, signatureOf,
  CLAUSE_NO_MODIFICATION, CLAUSE_NO_OTHER_CHARGES, STATUS_META,
} = await import('../src/lib/leaseAmendments.ts')

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

// Noon UTC on 3 Nov 2026 is still 3 Nov in Phoenix, so "today" is unambiguous.
const NOW = new Date('2026-11-03T19:00:00Z')
const TODAY = '2026-11-03'

const input = (over = {}) => ({
  propertyAddress: '820 W 9th Street, Tempe, AZ 85281',
  landlordName: 'Heran Maharaja',
  tenantName: 'Aleeya Cruz',
  leaseStartDate: '2026-08-03',
  leaseEndDate: '2027-07-31',
  effectiveDate: '2026-11-03',
  agreementDate: '2026-11-03',
  monthlyPetRent: 65,
  pet: { name: 'Dewey', species: 'Dog', breed: 'Labrador mix', weightLbs: 45, color: 'black and tan', sterilized: true, vaccinated: true },
  ...over,
})

const doc = buildPetAdditionDocument(input())
const allText = [...doc.recitals, ...doc.clauses.flatMap(c => c.paragraphs)].join('\n')

// ── Dates and money ─────────────────────────────────────────────────────────

check('today is the Phoenix day, not UTC', signingToday(NOW), TODAY)
check('a contract names a date in full', fmtLegalDate('2026-11-03'), 'November 3, 2026')
check('a charge names its month', monthName('2026-11-03'), 'November 2026')
check('money is written to the cent', fmtDollars(65), '$65.00')
check('and spelled out beside the figure', fmtMoneyWithWords(65), '$65.00 (sixty-five dollars)')
check('words handle the awkward teens', dollarsInWords(17), 'seventeen dollars')
check('and the hundreds', dollarsInWords(145), 'one hundred forty-five dollars')
check('and the thousands', dollarsInWords(1250), 'one thousand two hundred fifty dollars')
check('one dollar is singular', dollarsInWords(1), 'one dollar')
check('a figure out of range omits the words rather than inventing them',
  dollarsInWords(1_000_000), null)
check('and the formatter falls back to the figure alone',
  fmtMoneyWithWords(1_000_000), '$1,000,000.00')

// ── The document says what it must ──────────────────────────────────────────

check('a well-formed document has no problems', verifyAmendmentDocument(doc), [])

check('it states that the rest of the lease is unchanged',
  allText.includes(CLAUSE_NO_MODIFICATION), true)
check('and that clause names rent, deposit and term explicitly',
  ['monthly rent', 'security deposit', 'lease term'].every(s => CLAUSE_NO_MODIFICATION.includes(s)),
  true)
check('the non-modification clause is the last word',
  doc.clauses[doc.clauses.length - 1].paragraphs.includes(CLAUSE_NO_MODIFICATION), true)

check('it closes the list of money', allText.includes(CLAUSE_NO_OTHER_CHARGES), true)
check('naming the four charges a pet clause usually leaves open',
  ['pet deposit', 'one-time pet fee', 'additional security deposit', 'pet cleaning fee']
    .every(s => CLAUSE_NO_OTHER_CHARGES.includes(s)),
  true)
check('while preserving the existing damage obligation',
  CLAUSE_NO_OTHER_CHARGES.includes('actual damage'), true)

check('the charge is named with the figure and the words',
  allText.includes('$65.00 (sixty-five dollars) per month'), true)
check('and the month it starts', allText.includes('November 2026'), true)
check('the premises is named', doc.premises, '820 W 9th Street, Tempe, AZ 85281')
check('both parties are named', [doc.landlordName, doc.tenantName], ['Heran Maharaja', 'Aleeya Cruz'])
check('the lease it amends is named by its term',
  allText.includes('August 3, 2026') && allText.includes('July 31, 2027'), true)
check('the signature statement cites the Arizona act',
  doc.signatureStatement.includes('A.R.S. § 44-7001'), true)
check('and the federal one', doc.signatureStatement.includes('E-SIGN'), true)

{
  // The guard is the feature. A document that lost its protection must not be
  // sendable, whatever else is right about it.
  const stripped = { ...doc, clauses: doc.clauses.filter(c => !c.paragraphs.includes(CLAUSE_NO_MODIFICATION)) }
  const problems = verifyAmendmentDocument(stripped)
  check('a document missing the non-modification clause is rejected', problems.length > 0, true)
  check('and says so in terms a landlord can act on',
    problems[0].includes('rest of the lease is unchanged'), true)
}
{
  const stripped = {
    ...doc,
    clauses: doc.clauses.map(c => ({ ...c, paragraphs: c.paragraphs.filter(p => p !== CLAUSE_NO_OTHER_CHARGES) })),
  }
  check('a charge with no "nothing else" clause is rejected',
    verifyAmendmentDocument(stripped).length > 0, true)
}
{
  // A free-charge amendment needs no charge clause, so the same check must not
  // block one — an over-strict guard that refuses valid documents is its own bug.
  const free = buildPetAdditionDocument(input({ monthlyPetRent: 0 }))
  check('a no-charge amendment still passes', verifyAmendmentDocument(free), [])
  check('and does not promise a charge it has no clause for', free.monthlyCharge, 0)
}
{
  check('a nameless tenant is refused',
    verifyAmendmentDocument({ ...doc, tenantName: '' }).some(p => p.includes('tenant')), true)
  check('and a nameless landlord',
    verifyAmendmentDocument({ ...doc, landlordName: '' }).some(p => p.includes('landlord')), true)
}

// ── The pet is identified, which is what makes permission limited ───────────

check('the animal is described in full',
  describePet(input().pet),
  'one (1) black and tan Labrador mix dog named "Dewey", approximately 45 lbs at adult weight')
check('a bare description still identifies one animal',
  describePet({ name: 'Mo', species: 'Cat' }), 'one (1) cat named "Mo"')
check('permission does not extend to a second animal',
  allText.includes('does not extend to any other animal'), true)
check('nor to a replacement for this one',
  allText.includes('replacement for'), true)

// ── Optional clauses appear only when claimed ──────────────────────────────

{
  const plain = buildPetAdditionDocument(input({
    pet: { name: 'Mo', species: 'Cat', sterilized: false, vaccinated: false },
  }))
  const t = plain.clauses.flatMap(c => c.paragraphs).join('\n')
  check('an unvaccinated pet gets no vaccination covenant', t.includes('vaccinated as required'), false)
  check('and no spay representation is invented', t.includes('spayed or neutered'), false)
  check('but the waste and nuisance duties are not optional',
    t.includes('pet waste') && t.includes('quiet enjoyment'), true)
}
{
  const extra = buildPetAdditionDocument(input({ additionalTerms: 'No pet in the jacuzzi area.' }))
  const headings = extra.clauses.map(c => c.heading)
  check('a free-text addition becomes its own clause',
    headings.includes('Additional terms'), true)
  check('and cannot be read as an exception to the non-modification clause',
    headings[headings.length - 1], 'The rest of the Lease is unchanged')
}

// ── The plain-text render ──────────────────────────────────────────────────

{
  const text = renderAmendmentText(doc, null)
  check('an unsigned render leaves the signature line blank',
    text.includes('Signed by:   ____________________________'), true)
  const signed = renderAmendmentText(doc, { name: 'Aleeya Cruz', date: TODAY })
  check('a signed render carries the name', signed.includes('Signed by:   Aleeya Cruz'), true)
  check('and the date it was signed', signed.includes('Date signed: November 3, 2026'), true)
  check('the text render says everything the clauses do',
    signed.includes('REST OF THE LEASE IS UNCHANGED'), true)
  check('and wraps to a readable measure',
    signed.split('\n').every(l => l.length <= 80), true)
}

// ── The signature: name ────────────────────────────────────────────────────

check('a full name signs', checkSignatureName('Aleeya Cruz', 'Aleeya Cruz'), null)
check('a middle name is fine', checkSignatureName('Aleeya M. Cruz', 'Aleeya Cruz'), null)
check('so is a changed surname, since the first name still matches',
  checkSignatureName('Aleeya Rivera', 'Aleeya Cruz'), null)
check('case and spacing do not matter',
  checkSignatureName('  aleeya   cruz ', 'Aleeya Cruz'), null)
check('a single name is not a signature',
  checkSignatureName('Aleeya', 'Aleeya Cruz') !== null, true)
check('nor is an initial', checkSignatureName('x', 'Aleeya Cruz') !== null, true)
check('nor is "ok"', checkSignatureName('ok', 'Aleeya Cruz') !== null, true)
check('nor is a number', checkSignatureName('12 34', 'Aleeya Cruz') !== null, true)
check('a different person cannot sign for them',
  checkSignatureName('Brooklyn Buck', 'Aleeya Cruz') !== null, true)
check('and is told to fix the record rather than sign a wrong name',
  checkSignatureName('Brooklyn Buck', 'Aleeya Cruz').includes('contact your landlord'), true)
check('with no name on file, a plausible full name is accepted',
  checkSignatureName('Aleeya Cruz', null), null)

// ── The signature: date ────────────────────────────────────────────────────

check('today signs', checkSignatureDate(TODAY, NOW), null)
check('yesterday does not — backdating is the whole risk',
  checkSignatureDate('2026-11-02', NOW) !== null, true)
check('tomorrow does not either', checkSignatureDate('2026-11-04', NOW) !== null, true)
check('and the error names the only acceptable date',
  checkSignatureDate('2026-11-02', NOW).includes('November 3, 2026'), true)
check('a non-date is refused', checkSignatureDate('soon', NOW) !== null, true)

// ── Status, derived rather than stored ─────────────────────────────────────

const row = (over = {}) => ({
  id: 'a1', lease_id: 'l1', owner_id: 'o1', property_id: 'p1',
  lease_tenant_id: 'lt1', kind: 'pet_addition', title: doc.title,
  effective_date: '2026-11-03', monthly_charge: 65, monthly_charge_label: 'Pet rent',
  document: doc, status: 'sent', tenant_name: 'Aleeya Cruz',
  tenant_email: 'cruzaleeya6@gmail.com', token: 'tok',
  sent_at: '2026-11-03T18:00:00Z',
  signed_at: null, signature_name: null, signature_date: null,
  signature_ip: null, signature_user_agent: null, signed_by_user_id: null,
  declined_at: null, decline_reason: null, billed_at: null,
  created_at: '2026-11-03T18:00:00Z', updated_at: '2026-11-03T18:00:00Z',
  ...over,
})

const signedRow = (over = {}) => row({
  status: 'signed', signed_at: '2026-11-03T19:00:00Z',
  signature_name: 'Aleeya Cruz', signature_date: TODAY, ...over,
})

check('an unsigned amendment is in no phase at all', amendmentPhase(row(), NOW), 'unsigned')
check('signed and the date has arrived means in force',
  amendmentPhase(signedRow(), NOW), 'in_force')
check('signed with a future start is pending, not in force',
  amendmentPhase(signedRow({ effective_date: '2026-12-01' }), NOW), 'pending')
check('and that flips by arithmetic alone, with no write',
  amendmentPhase(signedRow({ effective_date: '2026-12-01' }), new Date('2026-12-01T19:00:00Z')),
  'in_force')
check('a declined amendment is closed', amendmentPhase(row({ status: 'declined', declined_at: 'x' }), NOW), 'closed')
check('as is a withdrawn one', amendmentPhase(row({ status: 'withdrawn' }), NOW), 'closed')

check('the four statuses are the only ones with meta',
  Object.keys(STATUS_META).sort(), ['declined', 'sent', 'signed', 'withdrawn'])

check('a signature is only read off a signed row', signatureOf(row()), null)
check('and a signed row yields the name and date',
  signatureOf(signedRow()), { name: 'Aleeya Cruz', date: TODAY, signedAt: '2026-11-03T19:00:00Z' })
check('a row claiming signed with no name yields nothing rather than a blank signature',
  signatureOf(row({ status: 'signed' })), null)

// ── The next action, which is where the money is won or lost ───────────────

{
  const a = nextAction(row(), NOW)
  check('an unsigned amendment is waiting on the tenant', a.kind, 'await')
  check('and says nothing is in force yet', a.detail.includes('Nothing is in force'), true)
}
{
  const a = nextAction(row({ sent_at: '2026-10-29T18:00:00Z' }), NOW)
  check('a stale one counts the days', a.detail.includes('5 days ago'), true)
}
{
  const a = nextAction(signedRow(), NOW)
  check('a signed amendment with an unbilled charge is a task', a.kind, 'bill')
  check('that names the amount', a.label.includes('$65.00'), true)
  check('and warns it will otherwise never be collected',
    a.detail.includes('never be collected'), true)
  check('and names the month it should start from',
    a.detail.includes('November 2026'), true)
}
check('once billed, it stops asking',
  nextAction(signedRow({ billed_at: '2026-11-03T20:00:00Z' }), NOW).kind, 'none')
check('a signed amendment with no charge never asks',
  nextAction(signedRow({ monthly_charge: 0 }), NOW).kind, 'none')
check('a declined one is not a task either',
  nextAction(row({ status: 'declined', declined_at: 'x' }), NOW).kind, 'none')

// ── Ordering: the thing somebody is waiting on comes first ────────────────

{
  const ordered = sortAmendments([
    signedRow({ id: 'signed' }),
    row({ id: 'declined', status: 'declined', declined_at: 'x' }),
    row({ id: 'pending' }),
    row({ id: 'withdrawn', status: 'withdrawn' }),
  ]).map(a => a.id)
  check('unsigned first, then signed, then the dead ones',
    ordered, ['pending', 'signed', 'declined', 'withdrawn'])
}
{
  const ordered = sortAmendments([
    row({ id: 'old', sent_at: '2026-10-01T00:00:00Z' }),
    row({ id: 'new', sent_at: '2026-11-01T00:00:00Z' }),
  ]).map(a => a.id)
  check('within a status, newest first', ordered, ['new', 'old'])
}

// ── The link ──────────────────────────────────────────────────────────────

check('the tenant signs behind the login, not on a bare token page',
  amendmentPath('tok').startsWith('/dashboard/'), true)

// ── Report ────────────────────────────────────────────────────────────────
console.log(`\n${pass.length} passed`)
if (fail.length) {
  console.log(`\n${fail.length} FAILED:`)
  for (const f of fail) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(
  '✓ an amendment always states that the rest of the lease is unchanged and ' +
  'that no other charge arises, cannot be backdated or signed with half a name, ' +
  'derives "in force" rather than storing it, and keeps asking until the agreed ' +
  'charge reaches the ledger\n'
)
